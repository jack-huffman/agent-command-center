// acc's notices in Slack (GH-58): what's sent, what never is, once only across windows and restarts, the
// turn-on time, the kinds, failures and pacing. The sender runs with stand-ins for VSCode's secrets and
// globalState, fetch and the clock, and a claim folder of its own.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AutopilotRecord } from '../../packages/core/src/autopilot.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import type { Update } from '../../packages/core/src/updates.ts';
import { autopilotNotices, taskNotices, type TaskRow } from '../src/logic.ts';
import { homeModel, isFromWebview } from '../src/model.ts';
import { News, type NewsInput } from '../src/news.ts';
import {
  autopilotEvent, blankSlack, draftEvents, draftKey, isSlackWebhook, questionEvent, Slack, SLACK_KINDS, SLACK_SECRET, SLACK_SPACING_MS, slackCard, slackEscape, type SlackEvent, slackMessage,
  type SlackPayload, type SlackProject, type SlackState, slackState, taskEvent, taskLink,
} from '../src/slack.ts';

const HOOK = 'https://hooks.slack.com/services/T0ACME01/B0ACME02/abcdEFGHijklMNOPqrstUVWX';
const LEDGER = '/Users/me/code/acme/.git/acc/ledger.json';
const T0 = Date.parse('2026-10-06T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

/** Words that must never leave the machine: each is somewhere a notice's own text can reach. */
const SENTINEL = {
  summary: 'SENTINEL-REVIEW-SUMMARY', said: 'SENTINEL-AGENT-SAID', reason: 'SENTINEL-AUTOPILOT-REASON', question: 'SENTINEL-QUESTION-TEXT',
  command: 'SENTINEL-PERMISSION-COMMAND', draft: 'SENTINEL-DRAFT-TEXT', file: 'SENTINEL-CONFLICT-FILE.cls', brief: 'SENTINEL-TICKET-DESCRIPTION', blocker: 'SENTINEL-BLOCKER',
};

/** The machine one or more windows share: VSCode's secret storage and globalState, and the claim folder. */
function machine(o: { webhook?: string | null; state?: Partial<SlackState> } = {}) {
  const secrets = new Map<string, string>();
  if (o.webhook !== null) secrets.set(SLACK_SECRET, o.webhook ?? HOOK);
  return { secrets, state: (o.state ? { ...blankSlack(), ...o.state } : undefined) as unknown, dir: mkdtempSync(join(tmpdir(), 'acc-slack-')) };
}
type Machine = ReturnType<typeof machine>;

/** One window's sender on a machine: what it posted and logged, on a clock only its waits move. */
function window(m: Machine, respond: (n: number) => Response | Promise<Response> = () => new Response('ok', { status: 200 })) {
  const w = { posts: [] as { url: string; body: SlackPayload; at: number }[], redirects: [] as (string | undefined)[], logs: [] as string[], paused: [] as string[], clock: T0 + 60_000 };
  const slack = new Slack({
    secrets: { get: async (k) => m.secrets.get(k), store: async (k, v) => { m.secrets.set(k, v); }, delete: async (k) => { m.secrets.delete(k); } },
    state: { get: () => m.state, set: (s) => { m.state = s; } },
    log: (line) => w.logs.push(line),
    paused: (reason) => w.paused.push(reason),
    fetch: (async (url: string, init: { body: string; redirect?: string }) => {
      w.posts.push({ url, body: JSON.parse(init.body) as SlackPayload, at: w.clock });
      w.redirects.push(init.redirect);
      return respond(w.posts.length);
    }) as unknown as typeof fetch,
    dir: m.dir,
    now: () => w.clock,
    sleep: async (ms) => { w.clock += ms; },
  });
  return Object.assign(w, { slack });
}

const on = (more: Partial<SlackState> = {}) => machine({ state: { on: true, since: T0, tail: 'UVWX', ...more } });
const ev = (key: string, more: Partial<SlackEvent> = {}): SlackEvent => ({ key, kind: 'needs-you', project: 'Acme', task: 'ACME-12', title: 'Case escalation rules', what: 'It\'s blocked.', link: null, at: T0 + 1, ...more });

test('only a Slack incoming webhook is taken', () => {
  assert.ok(isSlackWebhook('https://hooks.slack.com/services/T/B/x'));
  assert.ok(isSlackWebhook(HOOK));
  for (const bad of ['', 'http://hooks.slack.com/services/T/B/x', 'https://hooks.slack.com.evil.example/services/T/B/x', 'https://example.com/services/T/B/x',
    'https://hooks.slack.com/triggers/T/B/x', 'https://hooks.slack.com/services/T/B', `${HOOK}?x=1`, ` ${HOOK}`, `${HOOK}/more`]) assert.ok(!isSlackWebhook(bad), bad);
});

test('off until a person turns it on: with nothing set up, nothing is sent and nothing is claimed', async () => {
  const m = machine({ webhook: null });
  const w = window(m);
  for (const kind of SLACK_KINDS) w.slack.offer(ev(`k:${kind}`, { kind }));
  await w.slack.settled();
  assert.equal(w.posts.length, 0);
  assert.deepEqual(readdirSync(m.dir), []);
  assert.equal(slackCard(w.slack.state()).state, 'none');
  // A webhook kept but sending turned off: still nothing.
  const kept = machine({ state: { tail: 'UVWX' } });
  const w2 = window(kept);
  for (const kind of SLACK_KINDS) w2.slack.offer(ev(`k:${kind}`, { kind }));
  await w2.slack.settled();
  assert.equal(w2.posts.length, 0);
});

// ------------------------------------------------------------ what's sent, and what never is

const row = (id: string, state: string, more: Partial<TaskRow> = {}): TaskRow => ({
  id, title: `Title of ${id}`, state, display: state as TaskRow['display'], environment: 'dev', deps: [], source: { kind: 'jira', url: `https://acme.atlassian.net/browse/${id}` }, ...more,
});
const ledgerTask = (id: string, state: string, history: [string, string][] = [], run?: Task['run']): Pick<Task, 'id' | 'title' | 'history' | 'run' | 'source' | 'brief' | 'blocker'> => ({
  id, title: `Title of ${id}`, brief: SENTINEL.brief, blocker: SENTINEL.blocker, source: { kind: 'jira', key: id, url: `https://acme.atlassian.net/browse/${id}` } as Task['source'],
  run: run ?? { startedAt: iso(T0 - 3_600_000) }, history: history.map(([to, at]) => ({ at, from: null, to, actor: 'human', by: 'human:jordan' }) as Task['history'][number]),
});
const pr = (more: Partial<NonNullable<TaskRow['pr']>> = {}): NonNullable<TaskRow['pr']> => ({ number: 44, url: 'https://github.com/acme/service/pull/44', state: 'open', ci: 'passing', changesRequested: false, conflicts: [], ...more });
const ask = { id: 'q1', question: SENTINEL.question, why: 'w', suggested: 's' };
const analysis = (verdict: 'ready' | 'questions' | 'split', at: string, open = [ask]) => ({ verdict, at, open, split: [] });

/** For each kind of task notice, the rows before and after, and the ledger task. */
const MOVES: { kind: string; before: TaskRow; after: TaskRow; sent: boolean }[] = [
  { kind: 'waiting', before: row('ACME-1', 'running'), after: row('ACME-1', 'running', { display: 'needs-you' }), sent: true },
  { kind: 'stopped', before: row('ACME-2', 'running'), after: row('ACME-2', 'running', { display: 'needs-you', stopped: { said: SENTINEL.said } }), sent: true },
  { kind: 'blocked', before: row('ACME-3', 'running'), after: row('ACME-3', 'blocked'), sent: true },
  { kind: 'rework', before: row('ACME-4', 'review'), after: row('ACME-4', 'rework', { review: { verdict: 'changes', summary: SENTINEL.summary, current: true, at: iso(T0 + 5) } }), sent: true },
  { kind: 'passed', before: row('ACME-5', 'review'), after: row('ACME-5', 'review', { review: { verdict: 'pass', summary: SENTINEL.summary, current: true, at: iso(T0 + 6) } }), sent: true },
  { kind: 'ci-failed', before: row('ACME-6', 'review', { pr: pr() }), after: row('ACME-6', 'review', { pr: pr({ ci: 'failing' }) }), sent: true },
  { kind: 'changes', before: row('ACME-7', 'review', { pr: pr() }), after: row('ACME-7', 'review', { pr: pr({ changesRequested: true }) }), sent: true },
  { kind: 'conflicts', before: row('ACME-8', 'review', { pr: pr() }), after: row('ACME-8', 'review', { pr: pr({ conflicts: [SENTINEL.file] }) }), sent: true },
  { kind: 'analysis-questions', before: row('ACME-9', 'todo'), after: row('ACME-9', 'todo', { analysis: analysis('questions', iso(T0 + 7)) }), sent: true },
  { kind: 'analysis-split', before: row('ACME-10', 'todo'), after: row('ACME-10', 'todo', { analysis: analysis('split', iso(T0 + 8)) }), sent: true },
  // Not sent (a person decided): ready for review, merged, an analysis ready or back.
  { kind: 'review', before: row('ACME-11', 'running'), after: row('ACME-11', 'review'), sent: false },
  { kind: 'merged', before: row('ACME-12', 'review', { pr: pr() }), after: row('ACME-12', 'done', { pr: pr({ state: 'merged' }) }), sent: false },
  { kind: 'analysis-ready', before: row('ACME-13', 'todo'), after: row('ACME-13', 'todo', { analysis: analysis('ready', iso(T0 + 9), []) }), sent: false },
  { kind: 'analysis-back', before: row('ACME-14', 'review'), after: row('ACME-14', 'review', { analysis: analysis('questions', iso(T0 + 10)) }), sent: false },
];

function project(rows: TaskRow[], tasks = rows.map((r) => ledgerTask(r.id, r.state, [[r.state, iso(T0 + 2)]]))): SlackProject {
  return { name: 'Acme <Service>', ledgerPath: LEDGER, rows, tasks };
}

const steps: AutopilotRecord[] = [
  ...(['review', 'land', 'dispatch', 'refresh', 'resume'] as const).map((step, i): AutopilotRecord => ({ seq: 10 + i, at: iso(T0 + 100 + i), task: 'ACME-20', step, outcome: 'failed', reason: SENTINEL.reason })),
  { seq: 20, at: iso(T0 + 200), task: 'ACME-20', step: 'review', outcome: 'done', verdict: 'pass' },
  { seq: 21, at: iso(T0 + 201), task: 'ACME-20', step: 'review', outcome: 'done', verdict: 'changes', reason: SENTINEL.reason },
  { seq: 22, at: iso(T0 + 202), task: 'ACME-20', step: 'land', outcome: 'done', pr: { number: 51, url: 'https://github.com/acme/service/pull/51', opened: true } },
  // Not sent: a pull request updated, a re-dispatch, a resume, a refresh.
  { seq: 23, at: iso(T0 + 203), task: 'ACME-20', step: 'land', outcome: 'done', pr: { number: 51, url: 'https://github.com/acme/service/pull/51', opened: false } },
  { seq: 24, at: iso(T0 + 204), task: 'ACME-20', step: 'dispatch', outcome: 'done' },
  { seq: 25, at: iso(T0 + 205), task: 'ACME-20', step: 'resume', outcome: 'done', reason: SENTINEL.said },
  { seq: 26, at: iso(T0 + 206), task: 'ACME-20', step: 'refresh', outcome: 'done', base: 'dev' },
];

const draft = (id: string, event: Update['event'], more: Partial<Update> = {}): Update => ({
  v: 1, id, task: id.split('.')[0]!, tracker: 'jira', key: id.split('.')[0]!, url: `https://acme.atlassian.net/browse/${id.split('.')[0]}`, event, text: SENTINEL.draft, state: 'draft', createdAt: iso(T0 + 300), by: 'acc land', ...more,
});

test('each message is a fixed template: the repo, the task, what happened in fixed words, one link; never what the toast quotes', () => {
  const payloads: { kind: string; toast: string; body: SlackPayload }[] = [];
  for (const mv of MOVES) {
    const notices = taskNotices([mv.before], [mv.after]);
    assert.equal(notices.length, 1, mv.kind);
    assert.equal(notices[0]!.kind, mv.kind);
    const e = taskEvent(project([mv.after]), notices[0]!, T0 + 50);
    assert.equal(!!e, mv.sent, `${mv.kind} is ${mv.sent ? '' : 'not '}sent`);
    if (e) payloads.push({ kind: mv.kind, toast: notices[0]!.text, body: slackMessage(e) });
  }
  const p = project([row('ACME-20', 'review', { pr: pr({ number: 51, url: 'https://github.com/acme/service/pull/51' }) })]);
  for (const n of autopilotNotices(steps, p.tasks.map((t) => ({ id: t.id, source: { kind: t.source.kind, key: t.source.key ?? null }, history: t.history })))) {
    const e = autopilotEvent(p, n.step!, n.urgent);
    assert.equal(!!e, n.step!.seq < 23, `autopilot step ${n.step!.seq} is ${n.step!.seq < 23 ? '' : 'not '}sent`);
    if (e) payloads.push({ kind: `autopilot:${n.step!.step}:${n.step!.outcome}`, toast: n.text, body: slackMessage(e) });
  }
  const q = project([row('ACME-30', 'running')]);
  for (const tool of ['AskUserQuestion', 'Bash', 'ExitPlanMode']) {
    // The whole question, as the hook wrote it: its text and command never reach the message.
    const full = { id: `q-${tool}`, tool, at: T0 + 400, input: { command: SENTINEL.command, questions: [{ question: SENTINEL.question }] } };
    payloads.push({ kind: `question:${tool}`, toast: '', body: slackMessage(questionEvent(full, q, 'ACME-30')!) });
  }
  const d = project([row('ACME-40', 'review')]);
  for (const e of draftEvents(d, (['pr-opened', 'pr-updated', 'merged', 'deployed', 'blocked', 'question'] as const).map((event, i) => draft(`ACME-40.${i + 1}`, event)), [], () => false)) {
    payloads.push({ kind: `draft:${e.key}`, toast: '', body: slackMessage(e) });
  }
  assert.equal(payloads.length, 10 + 8 + 3 + 6);
  // The toasts did carry the words, so the test has teeth.
  const toasts = payloads.map((x) => x.toast).join('\n');
  for (const s of [SENTINEL.summary, SENTINEL.said, SENTINEL.reason, SENTINEL.file]) assert.ok(toasts.includes(s), `a toast says ${s}`);
  for (const { kind, body } of payloads) {
    const json = JSON.stringify(body);
    for (const s of Object.values(SENTINEL)) assert.ok(!json.includes(s), `${kind} leaks ${s}`);
    assert.equal(body.unfurl_links, false);
    assert.equal(body.unfurl_media, false);
    assert.deepEqual(Object.keys(body).sort(), ['text', 'unfurl_links', 'unfurl_media']);
    assert.match(body.text, /^:\w+: \*(Needs you|Review finished|Pull request opened|Draft update waiting)\* · Acme &lt;Service&gt;\n\*ACME-\d+\* Title of ACME-\d+\n/, kind);
  }
  const text = (k: string) => payloads.find((x) => x.kind === k)!.body.text;
  assert.equal(text('blocked'), ':bell: *Needs you* · Acme &lt;Service&gt;\n*ACME-3* Title of ACME-3\nIt\'s blocked.\n<https://acme.atlassian.net/browse/ACME-3|The ticket>');
  assert.match(text('passed'), /^:mag: \*Review finished\*/);
  assert.match(text('rework'), /^:mag: \*Review finished\*/, 'a review asking for changes is a review finished');
  assert.match(text('ci-failed'), /Checks failed on pull request #44\.\n<https:\/\/github\.com\/acme\/service\/pull\/44\|Pull request #44>$/);
  assert.match(text('autopilot:land:failed'), /^:bell: \*Needs you\*[^]*Autopilot couldn't land it\. It waits for you\./);
  assert.match(text('autopilot:land:done'), /^:arrow_heading_up: \*Pull request opened\*[^]*Autopilot opened pull request #51\. Its update for the ticket waits for you to review and post\./);
  assert.match(text('question:Bash'), /Its agent asks for your permission\./);
  assert.match(text('question:AskUserQuestion'), /Its agent has a question for you\./);
  assert.match(text(`draft:${draftKey(LEDGER, 'ACME-40.1')}`), /^:memo: \*Draft update waiting\*[^]*An update for its ticket waits for you to post: ready for review\./);
});

test('the link is the pull request, else the ticket, else none; a title can\'t mention anyone', () => {
  assert.deepEqual(taskLink(row('A-1', 'review', { pr: pr() })), { url: 'https://github.com/acme/service/pull/44', label: 'Pull request #44' });
  assert.deepEqual(taskLink(row('A-1', 'todo')), { url: 'https://acme.atlassian.net/browse/A-1', label: 'The ticket' });
  assert.equal(taskLink(row('A-1', 'todo', { source: { kind: 'acc', url: null } })), null);
  // A link Slack would read as markup isn't sent as one.
  assert.equal(taskLink(row('A-1', 'todo', { source: { kind: 'jira', url: 'https://x.example/a|<!channel>' } })), null);
  assert.equal(taskLink(row('A-1', 'todo', { source: { kind: 'jira', url: 'javascript:alert(1)' } })), null);
  assert.equal(slackEscape('<!channel> & <x>'), '&lt;!channel&gt; &amp; &lt;x&gt;');
  const body = slackMessage(ev('k', { title: '<!channel> & <@U123> <https://evil.example|click>', project: '<!here>' }));
  assert.ok(!/<!|<@|<https:\/\/evil/.test(body.text), body.text);
  assert.ok(body.text.includes('&lt;!channel&gt; &amp; &lt;@U123&gt;'));
  assert.ok(!slackMessage(ev('k', { title: 'one\nline\n:bell: *Needs you*' })).text.includes('one\nline'), 'a title stays on its line');
});

// ------------------------------------------------------------ once only

test('once only: two windows offered the same moment send it once, a restart sends nothing, two moments send two', async () => {
  const m = on();
  const a = window(m);
  const b = window(m);
  a.slack.offer(ev('t:x:ACME-3:blocked:1'));
  b.slack.offer(ev('t:x:ACME-3:blocked:1'));
  await Promise.all([a.slack.settled(), b.slack.settled()]);
  assert.equal(a.posts.length + b.posts.length, 1);
  assert.equal(a.posts[0]?.url, HOOK);
  const later = window(m);
  later.slack.offer(ev('t:x:ACME-3:blocked:1'));
  await later.slack.settled();
  assert.equal(later.posts.length, 0, 'claimed before the restart');
  assert.ok(later.slack.told('t:x:ACME-3:blocked:1'));
  later.slack.offer(ev('t:x:ACME-3:blocked:2'));
  later.slack.offer(ev('q:abc'));
  await later.slack.settled();
  assert.equal(later.posts.length, 2);
  // The claim folder holds hashes, not keys: nothing about a task is written there.
  assert.ok(readdirSync(m.dir).every((n) => /^[0-9a-f]{64}$/.test(n)));
});

test('nothing from before Slack was turned on, no unticked kind, and nothing once it\'s off', async () => {
  const m = on({ kinds: ['needs-you', 'pr'] });
  const w = window(m);
  w.slack.offer(ev('early', { at: T0 - 1 }));
  w.slack.offer(ev('review', { kind: 'review' }));
  w.slack.offer(ev('draft', { kind: 'draft' }));
  await w.slack.settled();
  assert.equal(w.posts.length, 0);
  assert.ok(!w.slack.told('early') && !w.slack.told('review'), 'dropped, not claimed: ticked later, it would still go');
  w.slack.offer(ev('pr', { kind: 'pr' }));
  await w.slack.settled();
  assert.equal(w.posts.length, 1);
  await w.slack.off();
  w.slack.offer(ev('after-off'));
  await w.slack.settled();
  assert.equal(w.posts.length, 1);
  // On again: from now, not from the first time.
  w.clock += 60_000;
  await w.slack.on();
  w.slack.offer(ev('while-off', { at: w.clock - 1 }));
  w.slack.offer(ev('since-on', { at: w.clock }));
  await w.slack.settled();
  assert.equal(w.posts.length, 2);
  // A question asked before the turn-on time sends nothing either.
  const q = questionEvent({ id: 'old', tool: 'Bash', at: T0 - 5 }, project([row('ACME-30', 'running')]), 'ACME-30');
  w.slack.offer(q);
  await w.slack.settled();
  assert.equal(w.posts.length, 2);
  // A question no task asks isn't sent: the message names a task.
  assert.equal(questionEvent({ id: 'mine', tool: 'Bash', at: T0 + 5 }, project([row('ACME-30', 'running')]), null), null);
});

// ------------------------------------------------------------ failures

test('a refusal pauses sending with Slack\'s reason until a test goes through; one warning says so', async () => {
  let answer = () => new Response('no_service', { status: 404 });
  const m = on();
  const w = window(m, () => answer());
  w.slack.offer(ev('one'));
  await w.slack.settled();
  assert.equal(w.posts.length, 1);
  assert.equal(w.slack.state().paused, 'Slack refused it: no_service');
  assert.deepEqual(w.paused, ['Slack refused it: no_service']);
  const card = slackCard(w.slack.state());
  assert.deepEqual([card.state, card.look.tone, card.look.icon, card.look.label], ['paused', 'orange', 'warning', 'Paused: Slack refused it: no_service']);
  assert.ok(card.lookAt && !card.last, 'the refusal is said once, on the state\'s line');
  // Paused: nothing more is sent, and nothing is claimed, so it isn't lost for a window that's fixed.
  w.slack.offer(ev('two'));
  await w.slack.settled();
  assert.equal(w.posts.length, 1);
  assert.ok(!w.slack.told('two'));
  // A test that fails again stays paused; one that goes through sends again.
  assert.equal((await w.slack.test()).ok, false);
  assert.ok(w.slack.state().paused);
  answer = () => new Response('ok', { status: 200 });
  assert.deepEqual(await w.slack.test(), { ok: true });
  assert.equal(w.slack.state().paused, null);
  w.slack.offer(ev('three'));
  await w.slack.settled();
  assert.equal(w.posts.length, 4);
  assert.deepEqual(slackCard(w.slack.state()).last?.look, { label: 'Last message sent', icon: 'check', tone: 'blue' });
  assert.equal(w.paused.length, 1, 'one warning');
  // Replacing the webhook unpauses too.
  answer = () => new Response('channel_is_archived', { status: 410 });
  w.slack.offer(ev('four'));
  await w.slack.settled();
  assert.equal(w.slack.state().paused, 'Slack refused it: channel_is_archived');
  answer = () => new Response('ok', { status: 200 });
  assert.deepEqual(await w.slack.connect('https://hooks.slack.com/services/T0ACME01/B0ACME03/zzzzzzzzzzzzzzzzzzzzzzzz'), { ok: true });
  assert.equal(w.slack.state().paused, null);
  assert.equal(w.slack.state().tail, 'zzzz');
});

test('turned off after a refusal, the card says off and Environments no longer needs you; turned on again, it stays paused', async () => {
  const w = window(on(), () => new Response('no_service', { status: 404 }));
  w.slack.offer(ev('one'));
  await w.slack.settled();
  assert.equal(slackCard(w.slack.state()).state, 'paused');
  await w.slack.off();
  const card = slackCard(w.slack.state());
  assert.deepEqual([card.state, card.look.tone, card.look.icon, card.look.label], ['off', 'neutral', 'debug-pause', 'Off: turned off on this machine']);
  const env = (c: typeof card) => homeModel({ hub: { projects: [], agents: [], agentsError: null, taskRows: () => [], projectFor: () => undefined }, section: 'environments', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() }, slack: c }).nav.find((n) => n.section === 'environments')!;
  assert.deepEqual([env(card).attention, env(card).hint], [false, 'Branches, orgs, your GitHub account and Slack']);
  await w.slack.on();
  assert.equal(slackCard(w.slack.state()).state, 'paused', 'still paused until a test goes through');
  assert.equal(env(slackCard(w.slack.state())).attention, true);
});

test('a 429, a 5xx, a timeout or a network error loses that one message, says why, and is never retried', async () => {
  const cases: [string, () => Response | Promise<Response>, string][] = [
    ['429', () => new Response('rate_limited', { status: 429 }), 'Slack is rate-limiting this webhook (429)'],
    ['500', () => new Response('<html>oops</html>', { status: 500 }), 'Slack had an error (HTTP 500)'],
    ['timeout', () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')), 'Slack didn\'t answer within 10 s'],
    ['network', () => Promise.reject(new TypeError(`fetch failed for ${HOOK}: ECONNRESET`)), 'couldn\'t reach Slack: fetch failed for the webhook: ECONNRESET'],
  ];
  for (const [name, fail, why] of cases) {
    let n = 0;
    const m = on();
    const w = window(m, () => (++n === 1 ? fail() : new Response('ok', { status: 200 })));
    w.slack.offer(ev('lost'));
    await w.slack.settled();
    assert.equal(w.posts.length, 1, `${name}: one try`);
    assert.equal(w.slack.state().paused, null, `${name}: not paused`);
    assert.deepEqual(w.slack.state().last, { at: w.clock, ok: false, text: why }, name);
    assert.deepEqual(slackCard(w.slack.state()).last?.look, { label: `Last message didn't go: ${why}`, icon: 'warning', tone: 'orange' });
    w.slack.offer(ev('lost'));
    w.slack.offer(ev('next'));
    await w.slack.settled();
    assert.equal(w.posts.length, 2, `${name}: the lost one isn't tried again; the next one goes`);
    for (const line of w.logs) assert.ok(!line.includes(HOOK) && !line.includes('hooks.slack.com'), `${name}: ${line}`);
    assert.ok(!JSON.stringify(m.state).includes('hooks.slack.com'), `${name}: the state holds no webhook`);
    assert.deepEqual(w.paused, []);
  }
});

test('a message only ever goes to the webhook pasted: a redirect is refused, not followed (D-078)', async () => {
  const w = window(on());
  w.slack.offer(ev('one'));
  w.slack.offer(ev('two'));
  await w.slack.settled();
  assert.deepEqual([w.posts.length, w.redirects], [2, ['error', 'error']]);
});

test('autopilot that couldn\'t send a task back for its failing checks needs you, in its own words (D-076)', () => {
  const p = { name: 'Acme', ledgerPath: '/r/.git/acc/ledger.json', rows: [], tasks: [] } as unknown as Parameters<typeof autopilotEvent>[0];
  const e = autopilotEvent(p, { seq: 9, at: '2026-10-06T12:00:00.000Z', task: 'ACME-34', step: 'checks', outcome: 'failed', reason: 'Checks failed on GitHub again: Apex tests.' } as never, true);
  assert.deepEqual([e?.kind, e?.what], ['needs-you', 'Autopilot couldn\'t send it back for its failing checks. It waits for you.']);
});

test('a merge autopilot couldn\'t make needs you; one it made isn\'t sent, as no merge is (GH-67, D-078)', () => {
  const p = { name: 'Acme', ledgerPath: '/r/.git/acc/ledger.json', rows: [], tasks: [] } as unknown as Parameters<typeof autopilotEvent>[0];
  const at = '2026-10-06T12:00:00.000Z';
  const failed = autopilotEvent(p, { seq: 10, at, task: 'ACME-35', step: 'merge', outcome: 'failed', reason: 'It changes .acc/, which a person merges: .acc/config.json.' }, true);
  assert.deepEqual([failed?.kind, failed?.what, failed?.key], ['needs-you', 'Autopilot couldn\'t merge its pull request. It waits for you.', 'a:/r/.git/acc/ledger.json:10']);
  assert.ok(!JSON.stringify(failed).includes('.acc/config.json'), 'autopilot\'s reason stays out of Slack');
  assert.equal(autopilotEvent(p, { seq: 11, at, task: 'ACME-35', step: 'merge', outcome: 'done', pr: { number: 72, url: 'https://github.com/acme/tool/pull/72', opened: false } }, false), null);
});

test('messages go a second apart, a burst is cut short with one line saying how many more, and no log line holds the webhook', async () => {
  const w = window(on());
  for (let i = 0; i < 25; i++) w.slack.offer(ev(`burst-${i}`));
  await w.slack.settled();
  assert.equal(w.posts.length, 22, 'the one on its way, twenty waiting, then one saying how many more');
  for (let i = 1; i < w.posts.length; i++) assert.ok(w.posts[i]!.at - w.posts[i - 1]!.at >= SLACK_SPACING_MS, `${i}: ${w.posts[i]!.at - w.posts[i - 1]!.at} ms`);
  assert.match(w.posts.at(-1)!.body.text, /4 more notices weren't sent/);
  assert.ok(w.logs.length >= 21);
  for (const line of w.logs) assert.ok(!line.includes('hooks.slack.com'), line);
});

test('the webhook is kept only in secret storage: the state, the card and the page\'s model hold its last four characters', async () => {
  const m = machine({ webhook: null });
  const w = window(m);
  assert.deepEqual(await w.slack.connect('https://example.com/services/T/B/x'), { ok: false, error: 'That isn\'t a Slack incoming webhook. It starts https://hooks.slack.com/services/.' });
  assert.equal(m.secrets.size, 0);
  assert.deepEqual(await w.slack.connect(` ${HOOK} `), { ok: true });
  assert.equal(m.secrets.get(SLACK_SECRET), HOOK);
  assert.equal(w.posts.length, 1, 'connecting sends a test');
  assert.match(w.posts[0]!.body.text, /acc can post here/);
  const s = w.slack.state();
  assert.deepEqual([s.on, s.tail, s.kinds, s.since], [true, 'UVWX', [...SLACK_KINDS], w.clock], 'every kind is ticked the first time');
  const card = slackCard(s);
  assert.deepEqual([card.state, card.look.tone, card.look.icon, card.look.label], ['on', 'blue', 'pass', 'On: notices go to Slack']);
  const home = homeModel({ hub: { projects: [], agents: [], agentsError: null, taskRows: () => [], projectFor: () => undefined }, section: 'environments', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() }, slack: card });
  assert.equal(home.environments.slack?.tail, 'UVWX');
  for (const where of [JSON.stringify(home), JSON.stringify(m.state), w.logs.join('\n')]) assert.ok(!where.includes('hooks.slack.com') && !where.includes('abcdEFGH'), where.slice(0, 200));
  await w.slack.setKinds(['draft', 'needs-you']);
  assert.deepEqual(w.slack.state().kinds, ['needs-you', 'draft']);
  await w.slack.off();
  assert.deepEqual([slackCard(w.slack.state()).state, slackCard(w.slack.state()).look.label], ['off', 'Off: turned off on this machine']);
  await w.slack.remove();
  assert.equal(m.secrets.has(SLACK_SECRET), false, 'Remove deletes the secret');
  assert.equal(slackCard(w.slack.state()).state, 'none');
  assert.deepEqual(w.slack.state().kinds, ['needs-you', 'draft'], 'the kinds chosen are kept for next time');
  // A state that isn't one reads as the blank one.
  assert.deepEqual(slackState({ on: 'yes', kinds: ['bogus', 'pr'], tail: HOOK }), { ...blankSlack(), kinds: ['pr'], tail: 'UVWX' });
});

test('claims older than thirty days are forgotten at start', () => {
  const m = on();
  const w = window(m);
  writeFileSync(join(m.dir, 'a'.repeat(64)), '1');
  writeFileSync(join(m.dir, 'b'.repeat(64)), '1');
  writeFileSync(join(m.dir, 'not-a-claim'), '1');
  const old = (w.clock - 31 * 24 * 3_600_000) / 1000;
  const recent = (w.clock - 24 * 3_600_000) / 1000;
  utimesSync(join(m.dir, 'a'.repeat(64)), old, old);
  utimesSync(join(m.dir, 'b'.repeat(64)), recent, recent);
  utimesSync(join(m.dir, 'not-a-claim'), old, old);
  w.slack.prune();
  assert.deepEqual(readdirSync(m.dir).sort(), ['b'.repeat(64), 'not-a-claim']);
});

// ------------------------------------------------------------ what each window works out (News)

function input(rows: TaskRow[], more: Partial<NewsInput> = {}): NewsInput {
  return { root: '/r', name: 'Acme', ledgerPath: LEDGER, rows, log: [], tasks: rows.map((r) => ledgerTask(r.id, r.state, [[r.state, iso(T0 + 2)]])), updates: [], ...more };
}

test('each window works out the same moment with the same key, whenever it looks, toasts or not', () => {
  const before = [row('ACME-3', 'running')];
  const after = [row('ACME-3', 'blocked')];
  const tasks = [ledgerTask('ACME-3', 'blocked', [['running', iso(T0 - 100)], ['blocked', iso(T0 + 2)]])];
  // Window A looks every 3 s, window B every 15 s, at another time: the key is the ledger's, not theirs.
  const a = new News(() => false, () => T0 + 10);
  const b = new News(() => false, () => T0 + 99_999);
  a.arm([input(before, { tasks })]);
  b.arm([input(before, { tasks })]);
  const ra = a.look(input(after, { tasks }));
  const rb = b.look(input(after, { tasks }));
  assert.equal(ra.notices.length, 1, 'a toast, if one shows');
  assert.equal(ra.slack.length, 1);
  assert.equal(ra.slack[0]!.key, rb.slack[0]!.key);
  assert.equal(ra.slack[0]!.key, `t:${LEDGER}:ACME-3:blocked:${iso(T0 + 2)}`);
  assert.equal(ra.slack[0]!.at, T0 + 2);
  // Nothing new: nothing at all.
  assert.deepEqual(a.look(input(after, { tasks })), { notices: [], slack: [] });
  // Blocked again later is a new moment.
  const again = [ledgerTask('ACME-3', 'blocked', [['running', iso(T0 - 100)], ['blocked', iso(T0 + 2)], ['running', iso(T0 + 3)], ['blocked', iso(T0 + 4)]])];
  a.look(input([row('ACME-3', 'running')], { tasks: again }));
  assert.equal(a.look(input([row('ACME-3', 'blocked')], { tasks: again })).slack[0]!.key, `t:${LEDGER}:ACME-3:blocked:${iso(T0 + 4)}`);
});

test('before the first full load, and for what was there then, nothing is news', () => {
  const n = new News();
  assert.deepEqual(n.look(input([row('ACME-3', 'running')])), { notices: [], slack: [] });
  assert.deepEqual(n.look(input([row('ACME-3', 'blocked')])), { notices: [], slack: [] }, 'not armed');
  n.arm([input([row('ACME-3', 'blocked')], { updates: [draft('ACME-3.1', 'blocked')], log: [steps[0]!] })]);
  assert.deepEqual(n.look(input([row('ACME-3', 'blocked')], { updates: [draft('ACME-3.1', 'blocked')], log: [steps[0]!] })), { notices: [], slack: [] });
});

test('a new draft is told once; one that replaces a draft already told isn\'t (D-071); autopilot\'s pull request tells its own', () => {
  const sent = new Set<string>();
  const n = new News((k) => sent.has(k));
  const rows = [row('ACME-12', 'review', { pr: pr({ number: 38, url: 'https://github.com/acme/service/pull/38' }) })];
  n.arm([input(rows)]);
  const first = draft('ACME-12.1', 'pr-opened', { pr: { number: 38, url: 'https://github.com/acme/service/pull/38' } });
  const r1 = n.look(input(rows, { updates: [first] }));
  assert.deepEqual(r1.notices, [], 'a draft has no toast of its own');
  assert.deepEqual(r1.slack.map((e) => [e.key, e.kind, e.link?.label]), [[draftKey(LEDGER, 'ACME-12.1'), 'draft', 'Pull request #38']]);
  sent.add(r1.slack[0]!.key);
  // The pull request is updated before anyone posts: the new draft replaces the first, and isn't told again.
  const second = draft('ACME-12.2', 'pr-updated', { replaces: ['ACME-12.1'], createdAt: iso(T0 + 400) });
  assert.deepEqual(n.look(input(rows, { updates: [{ ...first, state: 'discarded' }, second] })).slack, []);
  // Posted, then merged: news again.
  assert.equal(n.look(input(rows, { updates: [second, draft('ACME-12.3', 'merged')] })).slack.length, 1);
  // Autopilot lands a ticketed task: one message, the pull request's, saying its update waits.
  const land: AutopilotRecord = { seq: 30, at: iso(T0 + 500), task: 'ACME-12', step: 'land', outcome: 'done', pr: { number: 38, url: 'https://github.com/acme/service/pull/38', opened: true } };
  const m = new News(() => false);
  m.arm([input(rows)]);
  const r = m.look(input(rows, { log: [land], updates: [draft('ACME-12.1', 'pr-opened', { pr: { number: 38, url: 'https://github.com/acme/service/pull/38' } })] }));
  assert.deepEqual(r.slack.map((e) => [e.kind, e.key]), [['pr', `a:${LEDGER}:30`]]);
  assert.match(r.slack[0]!.what, /Its update for the ticket waits for you/);
  // Its draft arriving a reload after the land is still told by the land.
  const late = new News(() => false);
  late.arm([input(rows)]);
  assert.equal(late.look(input(rows, { log: [land] })).slack.length, 1);
  assert.deepEqual(late.look(input(rows, { log: [land], updates: [draft('ACME-12.1', 'pr-opened', { pr: { number: 38, url: 'https://github.com/acme/service/pull/38' } })] })).slack, []);
});

test('a stopped builder is told once a run, and a review\'s pass by the review: not by when a window saw it', () => {
  const run = { startedAt: iso(T0 - 1000), resumes: [{ at: iso(T0 - 10), actor: 'human' as const, by: 'human:jordan' }] };
  const tasks = [ledgerTask('ACME-2', 'running', [], run)];
  const p = project([row('ACME-2', 'running', { stopped: { said: null }, display: 'needs-you' })], tasks);
  const e = taskEvent(p, { kind: 'stopped', task: 'ACME-2', text: '', urgent: true }, T0 + 77);
  assert.equal(e?.key, `t:${LEDGER}:ACME-2:stopped:${iso(T0 - 10)}`, 'its newest start: the resume');
  const passed = project([row('ACME-5', 'review', { review: { verdict: 'pass', summary: '', current: true, at: iso(T0 + 6) } })]);
  assert.equal(taskEvent(passed, { kind: 'passed', task: 'ACME-5', text: '', urgent: false }, T0 + 77)?.key, `t:${LEDGER}:ACME-5:passed:${iso(T0 + 6)}`);
  const ci = project([row('ACME-6', 'review', { pr: pr({ ci: 'failing' }) })], [ledgerTask('ACME-6', 'review', [], run)]);
  assert.equal(taskEvent(ci, { kind: 'ci-failed', task: 'ACME-6', text: '', urgent: true }, T0 + 77)?.key, `t:${LEDGER}:ACME-6:ci-failed:44:${iso(T0 - 10)}`);
});

test('the page\'s Slack messages are checked: a webhook only, known actions only, known kinds only', () => {
  assert.ok(isFromWebview({ type: 'slack-connect', url: HOOK }));
  assert.ok(isFromWebview({ type: 'slack-connect', url: ` ${HOOK}\n` }));
  for (const url of ['https://example.com/services/T/B/x', 'http://hooks.slack.com/services/T/B/x', '', 42, null]) assert.ok(!isFromWebview({ type: 'slack-connect', url }), String(url));
  for (const action of ['test', 'on', 'off', 'remove']) assert.ok(isFromWebview({ type: 'slack', action }), action);
  for (const action of ['send', '', undefined, 'connect']) assert.ok(!isFromWebview({ type: 'slack', action }), String(action));
  assert.ok(isFromWebview({ type: 'slack-kinds', kinds: [] }));
  assert.ok(isFromWebview({ type: 'slack-kinds', kinds: ['needs-you', 'draft'] }));
  for (const kinds of [['everything'], 'needs-you', null, [1], ['needs-you', 'review', 'pr', 'draft', 'pr']]) assert.ok(!isFromWebview({ type: 'slack-kinds', kinds }), JSON.stringify(kinds));
});
