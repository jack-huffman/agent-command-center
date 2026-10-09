import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { CARD_COLUMNS, cardFailure, cardWords, columnFor, followCards, followsCards } from '../src/cards.ts';
import { CARD_STATES, type CardState, loadConfig, parseConfig, type Config, writeConfig } from '../src/config.ts';
import { run, type RunOptions } from '../src/exec.ts';
import { moveTask, mutate, noGateHooks, readLedger, type State, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { GithubClient } from '../src/trackers/github.ts';
import { bad, fakeRunner, GENERIC_CONFIG, makeRepo, ok, tempDir } from './support.ts';

const now = () => new Date('2026-10-09T12:00:00Z');
const GITHUB = { repo: 'acme/tool', account: 'jordan-kim' };
const BOARD = ['Todo', 'In Progress', 'Testing', 'Blocked', 'Done'];
const opts = (names: string[]) => names.map((name, i) => ({ id: `opt-${i}`, name }));

test('each state\'s card goes to the column of that name, ignoring case: review to Testing, or In Review where there\'s no Testing (GH-146)', () => {
  const want: Record<CardState, string> = { todo: 'Todo', ready: 'Todo', running: 'In Progress', rework: 'In Progress', review: 'Testing', blocked: 'Blocked', done: 'Done' };
  assert.deepEqual(Object.keys(CARD_COLUMNS).sort(), [...CARD_STATES].sort(), 'every state has its columns');
  for (const s of CARD_STATES) assert.equal(columnFor(s, opts(BOARD), null)?.name, want[s], s);
  const shouting = opts(BOARD.map((n) => n.toUpperCase()));
  for (const s of CARD_STATES) assert.equal(columnFor(s, shouting, null)?.name, want[s].toUpperCase(), `${s}, in capitals`);
  assert.equal(columnFor('review', opts(['Todo', 'In Review', 'Done']), null)?.name, 'In Review');
  assert.equal(columnFor('review', opts(['In Review', 'Testing']), null)?.name, 'Testing', 'Testing first when it has both');
});

test('statusFor names a state\'s column; ready takes todo\'s; a column the Project hasn\'t means none (GH-146)', () => {
  const board = opts([...BOARD, 'QA', 'Up next', 'Backlog']);
  assert.equal(columnFor('review', board, { review: 'qa' })?.name, 'QA');
  assert.equal(columnFor('running', board, { review: 'QA' })?.name, 'In Progress', 'a state it leaves out keeps its usual column');
  assert.equal(columnFor('ready', board, { todo: 'Backlog' })?.name, 'Backlog');
  assert.equal(columnFor('ready', board, { todo: 'Backlog', ready: 'Up next' })?.name, 'Up next');
  assert.equal(columnFor('review', board, { review: 'Waiting for QA' }), null, 'no falling back to Testing: the person said which');
  assert.equal(columnFor('blocked', opts(['Todo', 'Doing', 'Done']), null), null);
});

/**
 * A stand-in for gh's GraphQL: one Project with these columns, issue #9 on it in `at`. Each read and each
 * write is recorded, with the token it went with; `fail` makes the write fail.
 */
function project(columns = BOARD, at: string | null = 'Todo', o: { fail?: string; onProject?: boolean } = {}) {
  const options = opts(columns);
  const state = { option: options.find((x) => x.name === at)?.id ?? null };
  const calls: string[] = [];
  const writes: { option: string; token: string | undefined }[] = [];
  const fake = fakeRunner({
    'gh auth token -u jordan-kim': ok('gho_token\n'),
    'gh api graphql': (ro?: RunOptions) => {
      const args = calls.at(-1)!;
      if (args.includes('query=mutation')) {
        const option = /option=(\S+)/.exec(args)![1]!;
        if (o.fail) return bad(o.fail);
        writes.push({ option, token: ro?.env?.GH_TOKEN });
        state.option = option;
        return ok(JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'item-9' } } } }));
      }
      const value = state.option ? { optionId: state.option, name: options.find((x) => x.id === state.option)!.name } : null;
      return ok(JSON.stringify({ data: { repository: {
        projectsV2: { nodes: [{ id: 'proj-1', number: 1, closed: false, field: { id: 'field-status', options } }] },
        issue: { projectItems: { nodes: o.onProject === false ? [] : [{ id: 'item-9', project: { id: 'proj-1' }, fieldValueByName: value }] } },
      } } }));
    },
  }, calls);
  const column = () => options.find((x) => x.id === state.option)?.name ?? null;
  return { fake, calls, writes, column, gh: () => calls.filter((c) => c.startsWith('gh ')) };
}

/** A repo whose GitHub tracker is as given, with GH-9 from issue #9, to do. */
function repo(tracker: Record<string, unknown> = { kind: 'github', edits: true }) {
  const raw = { ...GENERIC_CONFIG, github: GITHUB, trackers: [tracker], strayFiles: { required: false } };
  const config = parseConfig(raw).config as Config;
  const paths = repoPaths(makeRepo({ '.acc/config.json': JSON.stringify(raw) }), run);
  mutate(paths, now, (l, emit) => upsertTasks(l, config, [{ source: { kind: 'github', key: '#9', url: 'https://github.com/acme/tool/issues/9' }, title: 'Fix login' }], 'human', 'human:test', emit, now));
  const move = (to: State) => moveTask(paths, config, 'GH-9', { to, actor: 'human', by: 'human:test', reason: 'test', force: true }, noGateHooks, now);
  const task = () => readLedger(paths.ledger).tasks[0]!;
  return { config, paths, move, task };
}

test('as a task moves through its states, its card follows to each one\'s column, as the repo\'s account, with one write a move (GH-146)', () => {
  const s = repo();
  const gh = project();
  const path: [State, string][] = [['running', 'In Progress'], ['review', 'Testing'], ['rework', 'In Progress'], ['blocked', 'Blocked'], ['done', 'Done'], ['todo', 'Todo']];
  for (const [to, column] of path) {
    s.move(to);
    const r = followCards(s.paths, s.config, ['GH-9'], { run: gh.fake, now, env: {} });
    // todo is ready: GH-9 has no deps.
    assert.deepEqual(r, [{ task: 'GH-9', state: to === 'todo' ? 'ready' : to, outcome: 'moved', column }], to);
    assert.equal(gh.column(), column);
    assert.deepEqual(s.task().card, { state: to, column, at: now().toISOString() });
  }
  assert.equal(gh.writes.length, path.length);
  assert.ok(gh.writes.every((w) => w.token === 'gho_token'), 'as the repo\'s account');
  const mutation = gh.calls.find((c) => c.includes('query=mutation'))!;
  assert.match(mutation, /updateProjectV2ItemFieldValue/);
  assert.match(mutation, /-f project=proj-1 -f item=item-9 -f field=field-status -f option=opt-1/, 'the Status field, and nothing else');
  // One already in its column is read, not written.
  s.move('running');
  followCards(s.paths, s.config, ['GH-9'], { run: gh.fake, now, env: {} });
  gh.writes.length = 0;
  s.move('rework');
  assert.deepEqual(followCards(s.paths, s.config, ['GH-9'], { run: gh.fake, now, env: {} }).map((r) => r.outcome), ['already']);
  assert.equal(gh.writes.length, 0);
});

test('statusFor in the tracker\'s record names the column, by name (GH-146)', () => {
  const s = repo({ kind: 'github', edits: true, statusFor: { review: 'QA', running: 'doing' } });
  const gh = project(['Todo', 'Doing', 'QA', 'Done']);
  s.move('running');
  assert.equal(followCards(s.paths, s.config, ['GH-9'], { run: gh.fake, now, env: {} })[0]!.column, 'Doing');
  s.move('review');
  assert.equal(followCards(s.paths, s.config, ['GH-9'], { run: gh.fake, now, env: {} })[0]!.column, 'QA');
  assert.equal(gh.column(), 'QA');
});

test('a Project with no column for the state, an issue not on it, or a statusFor column it hasn\'t, means no write (GH-146)', () => {
  for (const [columns, tracker, onProject, reason] of [
    [['Todo', 'Doing', 'Done'], undefined, true, 'the GitHub Project has no column for blocked'],
    [BOARD, { kind: 'github', edits: true, statusFor: { blocked: 'On hold' } }, true, 'the GitHub Project has no column On hold, which statusFor names for blocked'],
    [BOARD, undefined, false, 'its issue isn\'t on the GitHub Project'],
  ] as const) {
    const s = repo(tracker);
    const gh = project([...columns], 'Todo', { onProject });
    s.move('blocked');
    const seq = readLedger(s.paths.ledger).seq;
    assert.deepEqual(followCards(s.paths, s.config, ['GH-9'], { run: gh.fake, now, env: {} }), [{ task: 'GH-9', state: 'blocked', outcome: 'left', reason }]);
    assert.equal(gh.writes.length, 0, reason);
    assert.ok(!gh.calls.some((c) => c.includes('query=mutation')), reason);
    assert.equal(readLedger(s.paths.ledger).seq, seq, 'and the ledger is left alone');
    assert.equal(s.task().state, 'blocked');
  }
});

test('a write that fails leaves the task\'s move as it is, and is kept on the task while it stays in that state (GH-146)', () => {
  const s = repo();
  const gh = project(BOARD, 'Todo', { fail: 'GraphQL: Resource not accessible by integration (updateProjectV2ItemFieldValue)' });
  s.move('running');
  const [r] = followCards(s.paths, s.config, ['GH-9'], { run: gh.fake, now, env: {} });
  assert.deepEqual(r, { task: 'GH-9', state: 'running', outcome: 'failed', column: 'In Progress', reason: 'GraphQL: Resource not accessible by integration (updateProjectV2ItemFieldValue)' });
  assert.equal(cardWords(r!), 'Couldn\'t move GH-9\'s card to In Progress on its GitHub Project: GraphQL: Resource not accessible by integration (updateProjectV2ItemFieldValue). GH-9 is running all the same.');
  assert.equal(s.task().state, 'running', 'the state changed all the same');
  assert.equal(cardFailure(s.task()), 'GraphQL: Resource not accessible by integration (updateProjectV2ItemFieldValue)');
  const events = readLedger(s.paths.ledger);
  assert.equal(events.tasks[0]!.card?.failed, r!.reason, 'kept once, on the task');
  // Moved on, the failure was another state's: not shown.
  s.move('blocked');
  assert.equal(cardFailure(s.task()), null);
  // gh not signed in as the repo's account: failed too, with the state moved.
  const s2 = repo();
  s2.move('review');
  const noToken = fakeRunner({ 'gh auth token -u jordan-kim': bad('no account') });
  const [r2] = followCards(s2.paths, s2.config, ['GH-9'], { run: noToken, now, env: {} });
  assert.equal(r2!.outcome, 'failed');
  assert.match(r2!.reason!, /gh isn't logged in as jordan-kim/);
  assert.equal(s2.task().state, 'review');
});

test('no card moves without "edits", for a task not from an issue, or for a task acc didn\'t move: gh isn\'t called (GH-146)', () => {
  for (const tracker of [{ kind: 'github' }, { kind: 'github', edits: false }]) {
    const s = repo(tracker);
    const gh = project();
    s.move('running');
    assert.equal(followsCards(s.config), false);
    assert.deepEqual(followCards(s.paths, s.config, ['GH-9'], { run: gh.fake, now, env: {} }), []);
    assert.deepEqual(gh.calls, []);
  }
  const s = repo();
  mutate(s.paths, now, (l, emit) => upsertTasks(l, s.config, [{ source: { kind: 'manual' }, title: 'By hand' }], 'human', 'human:test', emit, now));
  const gh = project();
  assert.deepEqual(followCards(s.paths, s.config, ['T-1'], { run: gh.fake, now, env: {} }), []);
  assert.deepEqual(followCards(s.paths, s.config, [], { run: gh.fake, now, env: {} }), []);
  assert.deepEqual(gh.calls, []);
});

test('reading a GitHub board or ticket writes nothing to the Project (GH-146, D-012)', async () => {
  const calls: string[] = [];
  const options = opts(BOARD);
  const exec = async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args].join(' '));
    const q = args.join(' ');
    if (q.includes('projectsV2(first: 10)')) return { code: 0, stdout: JSON.stringify({ data: { repository: { projectsV2: { nodes: [{ id: 'proj-1', number: 1, title: 'Tool', url: 'https://github.com/orgs/acme/projects/1', closed: false, field: { id: 'field-status', options } }] } } } }), stderr: '' };
    if (q.includes('items(first: 100')) return { code: 0, stdout: JSON.stringify({ data: { node: { items: { pageInfo: { hasNextPage: false, endCursor: '' }, nodes: [] } } } }), stderr: '' };
    if (q.includes('projectItems')) return { code: 0, stdout: JSON.stringify({ data: { repository: { issue: { projectItems: { nodes: [{ id: 'item-9', project: { id: 'proj-1' }, fieldValueByName: { optionId: 'opt-1', name: 'In Progress' } }] } } } } }), stderr: '' };
    if (q.startsWith('issue view')) return { code: 0, stdout: JSON.stringify({ number: 9, title: 'Fix login', body: '', state: 'OPEN', url: 'https://github.com/acme/tool/issues/9', labels: [], assignees: [], comments: [] }), stderr: '' };
    return { code: 1, stdout: '', stderr: `no fixture for ${q}` };
  };
  const client = new GithubClient({ repo: 'acme/tool', token: 't', account: 'jordan-kim', exec });
  const board = await client.board();
  assert.equal(board.source, 'github-project');
  assert.equal((await client.ticket('GH-9')).status.name, 'In Progress');
  assert.ok(calls.length >= 3, 'it read');
  assert.deepEqual(calls.filter((c) => /mutation|item-edit|issue (close|edit|reopen)/.test(c)), [], 'and wrote nothing');
});

test('statusFor is read from a GitHub tracker\'s record, checked, and written back as it was (GH-146)', () => {
  const base = { ...GENERIC_CONFIG, github: GITHUB };
  const ok1 = parseConfig({ ...base, trackers: [{ kind: 'github', edits: true, statusFor: { review: ' QA ', ready: 'Up next' } }] });
  assert.deepEqual(ok1.errors, []);
  assert.deepEqual(ok1.config!.trackers[0]!.statusFor, { review: 'QA', ready: 'Up next' });
  const file = join(tempDir(), 'config.json');
  writeConfig(file, ok1.config!);
  assert.deepEqual(loadConfig(file).config.trackers[0]!.statusFor, { review: 'QA', ready: 'Up next' });
  assert.equal(parseConfig({ ...base, trackers: [{ kind: 'github' }] }).config!.trackers[0]!.statusFor, null);
  for (const statusFor of [{ testing: 'QA' }, { review: '' }, { review: 3 }, ['QA']]) {
    const r = parseConfig({ ...base, trackers: [{ kind: 'github', statusFor }] });
    assert.match(r.errors.join('\n'), /"statusFor" names a GitHub Project column for each state.*Its states: todo, ready, running, review, rework, blocked, done\./, JSON.stringify(statusFor));
  }
  const jira = parseConfig({ ...base, trackers: [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', statusFor: { review: 'QA' } }] });
  assert.match(jira.warnings.join('\n'), /"statusFor" applies only to a GitHub tracker, so it's ignored\./);
  assert.equal(jira.config!.trackers[0]!.statusFor, null);
});
