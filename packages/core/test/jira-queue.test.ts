// Jira Service Management queues as boards (T-128): the queue list, a queue's JQL read, a project that isn't a
// service desk, no agent access, the place check, and internal comments, against stand-in Jira and JSM answers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeJira } from './support.ts';
import { JIRA } from '../src/trackers/connect.ts';
import { JiraClient, jiraQueueList } from '../src/trackers/jira.ts';
import {
  isServiceDesk, type JiraQueue, type JiraReq, jiraQueues, noAgentWords, queueDetail, queuesJql, queueWords, SERVICE_DESK_TYPE, serviceDeskId, serviceDeskName, splitJql, statusColumns,
} from '../src/trackers/jira-queue.ts';
import { placeText, TrackerError } from '../src/trackers/types.ts';

const SITE = 'acme.atlassian.net';
const DESK = { projectTypeKey: SERVICE_DESK_TYPE, key: 'SUP' };
const QUEUES = '/rest/servicedeskapi/servicedesk/projectKey:SUP/queue';
const UNASSIGNED: JiraQueue = { id: 12, name: 'Unassigned issues', jql: 'project = SUP AND assignee is EMPTY AND resolution = Unresolved ORDER BY "Time to first response" ASC', count: 3 };
const WAITING: JiraQueue = { id: 14, name: 'Waiting for support', jql: 'project = SUP AND status = "Waiting for support" ORDER BY created DESC', count: 0 };
const queueAnswer = (qs: JiraQueue[], last = true) => ({ isLastPage: last, values: qs.map((q) => ({ id: String(q.id), name: q.name, jql: q.jql, issueCount: q.count })) });
const st = (id: string, name: string, key: string) => ({ id, name, statusCategory: { key } });
const issue = (key: string, s: ReturnType<typeof st>, project = 'SUP') => ({ key, fields: { summary: `Ticket ${key}`, status: s, assignee: null, issuetype: { name: '[System] Service request' }, priority: { name: 'Medium' }, labels: [], project: { key: project } } });
const jqlOf = (path: string) => new URL(`https://x${path}`).searchParams.get('jql') ?? '';
const client = (f: typeof fetch, queues = [12]) => new JiraClient({ site: SITE, project: 'SUP', email: 'e', token: 't', queues, fetch: f });
const ctx = (f: typeof fetch, values: Record<string, string | string[] | null> = { project: 'SUP' }) => ({ host: SITE, signIn: { method: 'token', fields: { email: 'e', token: 't' }, header: null, gh: null }, values, fetch: f, exec: async () => ({ code: 0, stdout: '', stderr: '' }) });

test('the queue list: each queue of a service desk with its name and ticket count, as Connect cards', async () => {
  const { fetch: f, calls } = fakeJira({ 'GET /rest/api/3/project/SUP': DESK, [`GET ${QUEUES}?start=0`]: queueAnswer([UNASSIGNED], false), [`GET ${QUEUES}?start=50`]: queueAnswer([WAITING]) });
  const qs = await jiraQueueList(SITE, 'SUP', 'e', 't', f);
  assert.deepEqual(qs?.map((q) => [q.id, q.name, q.count]), [[12, 'Unassigned issues', 3], [14, 'Waiting for support', 0]]);
  // Get queues takes the project's key as its service desk, and asks for the counts.
  assert.ok(calls.some((c) => c.path === `${QUEUES}?start=0&limit=50&includeCount=true`));
  assert.equal(serviceDeskId('SUP'), 'projectKey:SUP');
  const picker = JIRA.pickers.find((p) => p.key === 'queues')!;
  const options = await picker.load(ctx(f));
  assert.deepEqual(options, [{ value: '12', label: 'Unassigned issues', detail: '3 tickets' }, { value: '14', label: 'Waiting for support', detail: '0 tickets' }]);
  assert.equal(queueDetail({ ...UNASSIGNED, count: null }), undefined, 'no count asked: no detail');
  assert.equal(queueDetail({ ...UNASSIGNED, count: 1 }), '1 ticket');
});

test('a project that isn\'t a service desk has no queues: the list is empty and the queue API is never asked', async () => {
  const { fetch: f, calls } = fakeJira({ 'GET /rest/api/3/project/SUP': { projectTypeKey: 'software' } });
  assert.equal(await jiraQueueList(SITE, 'SUP', 'e', 't', f), null);
  assert.deepEqual(await JIRA.pickers.find((p) => p.key === 'queues')!.load(ctx(f)), []);
  assert.ok(!calls.some((c) => c.path.includes('servicedeskapi')));
  const req: JiraReq = async <T>() => ({ projectTypeKey: 'business' }) as T;
  assert.equal(await isServiceDesk(req, 'SUP'), false);
});

test('no agent access: a sign-in Jira refuses the queues to is told in plain words, and no queue is offered', async () => {
  const { fetch: f } = fakeJira({ 'GET /rest/api/3/project/SUP': DESK, [`GET ${QUEUES}`]: { errorMessages: ['You do not have permission'] } }, { [`GET ${QUEUES}`]: 403 });
  await assert.rejects(jiraQueueList(SITE, 'SUP', 'e', 't', f), (e: unknown) => e instanceof TrackerError && e.kind === 'refused' && e.message === noAgentWords('SUP'));
  await assert.rejects(JIRA.pickers.find((p) => p.key === 'queues')!.load(ctx(f)), /Only a Jira Service Management agent can see the SUP service desk's queues/);
  assert.doesNotMatch(noAgentWords('SUP'), /acc |npm |\.acc\/|servicedeskapi/, 'plain words, with no command or path in them');
  // Another failure, such as Jira being down, is said as it is, not as no access.
  const down = fakeJira({ 'GET /rest/api/3/project/SUP': DESK, [`GET ${QUEUES}`]: { errorMessages: ['down'] } }, { [`GET ${QUEUES}`]: 503 });
  await assert.rejects(jiraQueueList(SITE, 'SUP', 'e', 't', down.fetch), (e: unknown) => e instanceof TrackerError && e.kind === 'other' && /down/.test(e.message));
  // jiraQueues itself, with counts left out, as a board reads them.
  const asked: string[] = [];
  const req: JiraReq = async <T>(_m: string, path: string) => { asked.push(path); return (path.includes('/project/') ? DESK : queueAnswer([WAITING])) as T; };
  assert.deepEqual((await jiraQueues(req, 'SUP', false))?.map((q) => q.name), ['Waiting for support']);
  assert.ok(!asked.some((p) => p.includes('includeCount')));
});

test('a queue\'s board reads its tickets by the queue\'s own JQL, held to the project, in status columns by category', async () => {
  const done = st('5', 'Resolved', 'done');
  const waiting = st('3', 'Waiting for support', 'indeterminate');
  const open = st('1', 'Open', 'new');
  const { fetch: f, calls } = fakeJira({
    'GET /rest/api/3/project/SUP': DESK,
    [`GET ${QUEUES}`]: queueAnswer([UNASSIGNED, WAITING]),
    'GET /rest/servicedeskapi/servicedesk/projectKey:SUP': { projectName: 'Acme Support' },
    'GET /rest/api/3/search/jql': (() => {
      let n = 0;
      return () => (n++ === 0 ? { issues: [issue('SUP-9', done), issue('SUP-8', waiting), issue('OPS-1', open, 'OPS')], nextPageToken: 'p2', isLast: false } : { issues: [issue('SUP-7', open)], isLast: true });
    })(),
  });
  const b = await client(f).board();
  const searches = calls.filter((c) => c.path.startsWith('/rest/api/3/search/jql'));
  assert.equal(jqlOf(searches[0]!.path), 'project = "SUP" AND (project = SUP AND assignee is EMPTY AND resolution = Unresolved) ORDER BY "Time to first response" ASC');
  assert.match(searches[1]!.path, /nextPageToken=p2/, 'the second page by its token');
  assert.equal(b.source, 'jira-queue');
  assert.equal(b.title, 'Unassigned issues');
  assert.deepEqual(b.cards.map((c) => c.key), ['SUP-9', 'SUP-8', 'SUP-7'], 'another project\'s ticket is left out (D-072)');
  assert.deepEqual(b.columns.map((c) => [c.name, c.category, c.statusIds]), [['Open', 'todo', ['1']], ['Waiting for support', 'doing', ['3']], ['Resolved', 'done', ['5']]]);
  assert.equal(b.place, 'Jira · SUP · service desk Acme Support · queue Unassigned issues');
  assert.equal(b.notice, null);
  assert.match(b.url ?? '', /\/jira\/servicedesk\/projects\/SUP\/queues\/custom\/12$/);
});

test('an empty queue says so, and a queue gone from the service desk fails with what to do', async () => {
  const empty = fakeJira({ 'GET /rest/api/3/project/SUP': DESK, [`GET ${QUEUES}`]: queueAnswer([WAITING]), 'GET /rest/servicedeskapi/servicedesk/projectKey:SUP': { errorMessages: ['x'] }, 'GET /rest/api/3/search/jql': { issues: [], isLast: true } }, { 'GET /rest/servicedeskapi/servicedesk/projectKey:SUP?': 500 });
  const b = await client(empty.fetch, [14]).board();
  assert.deepEqual([b.cards, b.columns], [[], []]);
  assert.match(b.notice ?? '', /Waiting for support holds no tickets now/);
  const gone = fakeJira({ 'GET /rest/api/3/project/SUP': DESK, [`GET ${QUEUES}`]: queueAnswer([WAITING]) });
  await assert.rejects(client(gone.fetch, [12]).board(), (e: unknown) => e instanceof TrackerError && e.kind === 'not-found' && /Queue 12 isn't in the SUP service desk now/.test(e.message));
  const notDesk = fakeJira({ 'GET /rest/api/3/project/SUP': { projectTypeKey: 'software' } });
  await assert.rejects(client(notDesk.fetch).board(), /isn't a Jira Service Management service desk now/);
  // The desk's name couldn't be read: the board still shows, and its place names the project.
  assert.equal(await serviceDeskName(async () => { throw new TrackerError('other', 'x'); }, 'SUP'), null);
});

test('the place check takes a ticket in any of the project\'s queues as inside, and names the queues it isn\'t in', async () => {
  const inside = queuesJql([UNASSIGNED, WAITING]);
  assert.equal(inside, '((project = SUP AND assignee is EMPTY AND resolution = Unresolved) OR (project = SUP AND status = "Waiting for support"))');
  const { fetch: f, calls } = fakeJira({
    'GET /rest/api/3/project/SUP': DESK,
    [`GET ${QUEUES}`]: queueAnswer([UNASSIGNED, WAITING]),
    'GET /rest/api/3/issue/SUP-7?fields=project': { key: 'SUP-7', fields: { project: { key: 'SUP' } } },
    'GET /rest/api/3/issue/SUP-8?fields=project': { key: 'SUP-8', fields: { project: { key: 'SUP' } } },
    'GET /rest/api/3/issue/OPS-1?fields=project': { key: 'OPS-1', fields: { project: { key: 'OPS' } } },
    [`GET /rest/api/3/search/jql?jql=${encodeURIComponent(`key = SUP-7 AND ${inside}`)}`]: { issues: [{ key: 'SUP-7' }] },
    [`GET /rest/api/3/search/jql?jql=${encodeURIComponent(`key = SUP-8 AND ${inside}`)}`]: { issues: [] },
  });
  // The board's own queue first, then the project's other queue board: a ticket in either is inside.
  const out = await client(f, [12, 14]).outside(['SUP-7', 'SUP-8', 'OPS-1']);
  assert.deepEqual(out, [{ key: 'SUP-8', why: 'it isn\'t in queues Unassigned issues or Waiting for support' }, { key: 'OPS-1', why: 'it\'s in project OPS' }]);
  // The project alone counts when asked so: no queue's JQL is read for it.
  const before = calls.length;
  assert.deepEqual(await client(f, [12, 14]).outside(['SUP-8'], { project: true }), []);
  assert.ok(!calls.slice(before).some((c) => c.path.includes('search/jql')));
  assert.equal(queueWords(['Unassigned issues']), 'queue Unassigned issues');
});

test('splitJql keeps an ORDER BY inside quotes, and a queue with no ORDER BY has none to move', () => {
  assert.deepEqual(splitJql('summary ~ "order by date" ORDER BY created'), { filter: 'summary ~ "order by date"', order: 'ORDER BY created' });
  assert.deepEqual(splitJql('project = SUP'), { filter: 'project = SUP', order: null });
  assert.deepEqual(splitJql('ORDER BY created DESC'), { filter: '', order: 'ORDER BY created DESC' });
  assert.equal(queuesJql([{ jql: 'ORDER BY created' }]), '', 'a queue with no filter adds none');
  assert.deepEqual(statusColumns([]), [], 'no tickets: no columns');
});

test('every comment acc posts to a queue\'s ticket is internal, never the customer-facing Jira comment', async () => {
  const { fetch: f, calls } = fakeJira({ 'POST /rest/servicedeskapi/request/': { id: '1' } });
  const jira = client(f);
  await jira.comment('SUP-7', 'Built on the dev branch.\n\n- one\n- two');
  await jira.comment('sup-8', 'Second note');
  const posts = calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 2);
  for (const p of posts) {
    assert.match(p.path, /^\/rest\/servicedeskapi\/request\/(SUP-7|sup-8)\/comment$/);
    assert.equal((p.body as { public: boolean }).public, false, 'internal: public false');
  }
  assert.equal((posts[0]!.body as { body: string }).body, 'Built on the dev branch.\n\n- one\n- two');
  assert.ok(!calls.some((c) => /\/rest\/api\/3\/issue\/[^/]+\/comment/.test(c.path)), 'never Jira\'s own comment, which a customer would see');
  await assert.rejects(jira.comment('SUP-7', '  '), /empty/);
});

test('a comment on a service desk\'s ticket is internal without a queue board too, and a failed project read never posts', async () => {
  const { fetch: f, calls } = fakeJira({ 'GET /rest/api/3/project/SUP': DESK, 'GET /rest/api/3/project/ENG': { projectTypeKey: 'software' }, 'POST /rest/servicedeskapi/request/': { id: '1' }, 'POST /rest/api/3/issue/': { id: '2' } });
  const whole = new JiraClient({ site: SITE, project: 'SUP', email: 'e', token: 't', fetch: f });
  await whole.comment('SUP-3', 'Note');
  await whole.comment('SUP-4', 'Note');
  await whole.comment('ENG-1', 'Note');
  assert.deepEqual(calls.filter((c) => c.method === 'POST').map((c) => c.path), ['/rest/servicedeskapi/request/SUP-3/comment', '/rest/servicedeskapi/request/SUP-4/comment', '/rest/api/3/issue/ENG-1/comment']);
  assert.equal(calls.filter((c) => c.path === '/rest/api/3/project/SUP').length, 1, 'asked once per project');
  const failed = fakeJira({ 'GET /rest/api/3/project/SUP': { errorMessages: ['down'] } }, { 'GET /rest/api/3/project/SUP': 503 });
  await assert.rejects(new JiraClient({ site: SITE, project: 'SUP', email: 'e', token: 't', fetch: failed.fetch }).comment('SUP-3', 'Note'));
  assert.ok(!failed.calls.some((c) => c.method === 'POST'));
});

test('a queue board\'s place before it loads names the queue by its id; with no queue, the project\'s place is unchanged', () => {
  assert.equal(client(fakeJira({}).fetch).place, 'Jira · SUP · queue 12');
  assert.equal(placeText({ kind: 'jira', project: 'SUP', queue: 12, queueName: 'Unassigned issues' }), 'Jira · SUP · queue Unassigned issues');
  assert.equal(placeText({ kind: 'jira', project: 'SUP', queue: null, epics: ['SUP-3'] }), 'Jira · SUP · epic SUP-3');
});

const BASE = { schema: 1, project: 'P', profile: 'generic', environments: [{ name: 'main', default: true }] };
const QUEUE_TRACKER = { kind: 'jira', site: SITE, project: 'SUP', queue: 12 };

test('the config keeps a queue board, refuses a queue that isn\'t one, and two queues of one desk give no key warning', async () => {
  const { deskQueues, parseConfig, queueProblem, sameDesk } = await import('../src/config.ts');
  const ok = parseConfig({ ...BASE, trackers: [QUEUE_TRACKER, { ...QUEUE_TRACKER, queue: 14 }] });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.config!.trackers.map((t) => t.queue), [12, 14]);
  assert.deepEqual(ok.warnings.filter((w) => /keys like/.test(w)), [], 'a service desk\'s queue boards share its keys on purpose');
  assert.ok(sameDesk(ok.config!.trackers[0]!, ok.config!.trackers[1]!));
  assert.deepEqual(deskQueues(ok.config!.trackers, ok.config!.trackers[1]!), [14, 12], 'its own queue first, then the other');
  // Opened again on the Connect page, a queue board has its queue ticked, and no epics, board or sprint.
  assert.deepEqual(JIRA.fromConfig(ok.config!.trackers[0]!, null), { host: SITE, values: { project: 'SUP', queues: ['12'], epics: null, board: null, sprint: null } });
  // A queue board beside the project's own board reads one source, one project on one site (T-127): a ticket both
  // show is one task, posted through the same project, so their keys don't clash.
  const mixed = parseConfig({ ...BASE, trackers: [{ kind: 'jira', site: SITE, project: 'SUP' }, QUEUE_TRACKER] });
  assert.equal(mixed.warnings.filter((w) => /keys like SUP-12/.test(w)).length, 0);
  assert.deepEqual(deskQueues(mixed.config!.trackers, mixed.config!.trackers[0]!), [], 'no queue: no queues');
  const refused: [Record<string, unknown>, RegExp][] = [
    [{ ...QUEUE_TRACKER, queue: 0 }, /must be a Jira Service Management queue's id/],
    [{ ...QUEUE_TRACKER, queue: '12' }, /must be a Jira Service Management queue's id/],
    [{ kind: 'github', repo: 'o/r', queue: 12 }, /applies only to a Jira tracker/],
    [{ ...QUEUE_TRACKER, epics: ['SUP-3'] }, /takes no "epic", "epics" or "sprint"/],
    [{ ...QUEUE_TRACKER, sprint: 'active' }, /takes no "epic", "epics" or "sprint"/],
  ];
  for (const [t, why] of refused) {
    assert.match(parseConfig({ ...BASE, trackers: [t] }).errors.join('\n'), why);
    assert.match(queueProblem(t) ?? '', why);
  }
  assert.equal(queueProblem({ ...QUEUE_TRACKER, epics: [] }), null, 'an empty epics list is no epic');
});

test('adding a second queue of a desk adds a tracker, and adding the same queue again replaces it, never another', async () => {
  const { withTracker } = await import('../src/config.ts');
  const one = withTracker([], QUEUE_TRACKER);
  const two = withTracker(one, { ...QUEUE_TRACKER, queue: 14 });
  assert.deepEqual(two.map((t) => t.queue), [12, 14]);
  assert.deepEqual(withTracker(two, { ...QUEUE_TRACKER, edits: true }).map((t) => [t.queue, t.edits ?? false]), [[12, true], [14, false]]);
  // The project's own board is another tracker from its queues: re-adding it leaves the queues alone.
  assert.equal(withTracker(two, { kind: 'jira', site: SITE, project: 'SUP', queue: null }).length, 3);
});

test('Connect: queues ticked make one tracker each with no board, epics or sprint; none ticked is the project as before', () => {
  const chosen = (values: Record<string, string | string[] | null>) => ({ host: SITE, values, defaults: [], ownRepo: null });
  const c = chosen({ project: 'SUP', queues: ['14', '12'], epics: ['SUP-3'], board: '7', sprint: 'active' });
  assert.deepEqual(JIRA.toConfig(c), { kind: 'jira', site: SITE, project: 'SUP', queue: 14, board: null, epic: null, epics: null, sprint: null });
  assert.deepEqual(JIRA.more!(c), [{ kind: 'jira', site: SITE, project: 'SUP', queue: 12, board: null, epic: null, epics: null, sprint: null }]);
  const plain = chosen({ project: 'SUP', queues: null, epics: ['SUP-3'], board: '7', sprint: null });
  assert.deepEqual(JIRA.toConfig(plain), { kind: 'jira', site: SITE, project: 'SUP', board: 7, epic: 'SUP-3', epics: null, sprint: null, queue: null });
  assert.deepEqual(JIRA.more!(plain), [], 'no queue ticked: no other tracker');
  // The preview of ticked queues is the first one's board; with none, the project's.
  assert.equal((JIRA.preview(ctx(fakeJira({}).fetch, { project: 'SUP', queues: ['14', '12'] })) as JiraClient).place, 'Jira · SUP · queue 14');
  assert.equal((JIRA.preview(ctx(fakeJira({}).fetch, { project: 'SUP', queues: null })) as JiraClient).place, 'Jira · SUP');
  const queuesPicker = JIRA.pickers.find((p) => p.key === 'queues')!;
  assert.deepEqual([queuesPicker.multi, queuesPicker.hideEmpty, queuesPicker.dependsOn], [true, true, ['project']]);
  assert.deepEqual(JIRA.pickers.filter((p) => p.unless === 'queues').map((p) => p.key), ['epics', 'board', 'sprint']);
});

test('edge case: a queue\'s cards say when each last changed, from the one search read, and one without leaves it out (T-141)', async () => {
  const open = st('1', 'Open', 'new');
  const { fetch: f, calls } = fakeJira({
    'GET /rest/api/3/project/SUP': DESK,
    [`GET ${QUEUES}`]: queueAnswer([UNASSIGNED]),
    'GET /rest/servicedeskapi/servicedesk/projectKey:SUP': { projectName: 'Acme Support' },
    'GET /rest/api/3/search/jql': { issues: [{ ...issue('SUP-9', open), fields: { ...issue('SUP-9', open).fields, updated: '2026-10-28T08:00:00.000+0000' } }, issue('SUP-8', open)], isLast: true },
  });
  const b = await client(f).board();
  assert.deepEqual(b.cards.map((c) => [c.key, c.updated]), [['SUP-9', '2026-10-28T08:00:00.000+0000'], ['SUP-8', undefined]]);
  const search = calls.filter((c) => c.path.startsWith('/rest/api/3/search/jql'));
  assert.equal(search.length, 1);
  assert.match(new URL(`https://x${search[0]!.path}`).searchParams.get('fields') ?? '', /\bupdated\b/);
});
