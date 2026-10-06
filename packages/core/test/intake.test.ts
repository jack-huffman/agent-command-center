import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type Config, parseConfig } from '../src/config.ts';
import { run, type RunResult } from '../src/exec.ts';
import { depsFromBody, type GithubIssue, githubIssuesToTasks, intakeGithub, intakeOutside, skipLabelOf } from '../src/intake.ts';
import { allowedMoves, emptyLedger, type LedgerEvent, mutate, noGateHooks, readLedger, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { fakeRunner, GENERIC_CONFIG, makeRepo, ok } from './support.ts';

test('dependencies come from "Depends on" and "Blocked by" lines', () => {
  assert.deepEqual(depsFromBody('Depends on #3'), ['#3']);
  assert.deepEqual(depsFromBody('Blocked by #4 and #5.\nalso depends on #6, #7'), ['#4', '#5', '#6', '#7']);
  assert.deepEqual(depsFromBody('Mentions #9 but depends on nothing'), []);
  assert.deepEqual(depsFromBody(null), []);
});

test('GitHub issues become tasks with ids, links, labels and dependencies', () => {
  const tasks = githubIssuesToTasks([
    { number: 3, title: 'M3 Dispatch', body: 'Depends on #2', url: 'https://github.com/o/r/issues/3', labels: [{ name: 'milestone' }] },
    { number: 2, title: 'M2 Walkthrough', body: null, url: 'https://github.com/o/r/issues/2' },
  ]);
  const config = parseConfig(JSON.parse(JSON.stringify(GENERIC_CONFIG))).config!;
  const l = emptyLedger();
  const r = upsertTasks(l, config, tasks, 'human', 'h', () => {}, () => new Date());
  assert.deepEqual(r.added, ['GH-3', 'GH-2']);
  assert.deepEqual(l.tasks[0]!.deps, ['GH-2']);
  assert.deepEqual(l.tasks[0]!.labels, ['milestone']);
  assert.equal(l.tasks[0]!.source.url, 'https://github.com/o/r/issues/3');
});

test('allowedMoves lists only moves the actor may make, with what would stop them', () => {
  const config = parseConfig(JSON.parse(JSON.stringify(GENERIC_CONFIG))).config!;
  const l = emptyLedger();
  upsertTasks(l, config, [{ source: { kind: 'manual' }, title: 'a' }, { source: { kind: 'manual' }, title: 'b', deps: ['T-1'] }], 'human', 'h', () => {}, () => new Date());
  const moves = allowedMoves(l, config, l.tasks[1]!, 'human', noGateHooks);
  assert.deepEqual(moves.map((m) => m.to), ['running', 'blocked']);
  assert.match(moves[0]!.problems.join(), /waiting on T-1/);
  assert.equal(moves[1]!.needsReason, true);
  assert.deepEqual(allowedMoves(l, config, l.tasks[0]!, 'builder', noGateHooks).map((m) => m.to), ['blocked']);
});

// ---------------------------------------------------------------- acc intake github

const now = () => new Date('2026-10-03T12:00:00Z');
const issue = (number: number, labels: string[] = []): GithubIssue => ({ number, title: `Issue ${number}`, body: '', url: `https://github.com/o/r/issues/${number}`, labels: labels.map((name) => ({ name })) });
const closed = (number: number, labels: string[] = []): RunResult => ok(JSON.stringify({ number, state: 'CLOSED', labels: labels.map((name) => ({ name })) }));

function githubRepo(tracker: Record<string, unknown> = { kind: 'github' }) {
  const raw = { ...GENERIC_CONFIG, github: { repo: 'o/r', account: 'me' }, trackers: [tracker] };
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(raw) });
  return { paths: repoPaths(dir, run), config: parseConfig(raw).config as Config };
}

/** gh as the repo's account: the open issues, and what `gh issue view` says of the others. */
function gh(open: GithubIssue[], views: Record<number, RunResult> = {}, calls: string[] = []) {
  const fixtures: Record<string, RunResult> = {
    'gh auth token -u me': ok('tok\n'),
    'gh issue list': ok(JSON.stringify(open)),
  };
  for (const [n, r] of Object.entries(views)) fixtures[`gh issue view ${n}`] = r;
  return fakeRunner(fixtures, calls);
}

const intake = (s: ReturnType<typeof githubRepo>, runner: ReturnType<typeof gh>) =>
  intakeGithub(s.paths, s.config, { run: runner, now, env: {} }, { actor: 'human', by: 'human:test' });

const events = (s: ReturnType<typeof githubRepo>): LedgerEvent[] =>
  readFileSync(s.paths.events, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as LedgerEvent);

/** Marks a task as dispatched: running, with a run. */
const start = (s: ReturnType<typeof githubRepo>, id: string) => mutate(s.paths, now, (l, emit) => {
  const t = l.tasks.find((x) => x.id === id)!;
  t.state = 'running';
  t.run = { branch: `task/${id}`, worktree: `/tmp/${id}` };
  emit({ type: 'task.updated', task: id, actor: 'human', by: 'test', data: {} });
});

test('intake github: a closed issue whose task never started moves it to done, as sync', () => {
  const s = githubRepo();
  assert.deepEqual(intake(s, gh([issue(3), issue(4)])).added, ['GH-3', 'GH-4']);
  const r = intake(s, gh([issue(4)], { 3: closed(3) }));
  assert.deepEqual([r.closed, r.removed, r.leftAlone], [['GH-3'], [], []]);
  const t = readLedger(s.paths.ledger).tasks.find((x) => x.id === 'GH-3')!;
  assert.equal(t.state, 'done');
  assert.deepEqual(t.history.at(-1), { at: now().toISOString(), actor: 'sync', by: 'acc intake', from: 'todo', to: 'done', reason: 'Issue #3 was closed on GitHub.' });
  assert.deepEqual(events(s).at(-1)!.type, 'task.moved');

  const calls: string[] = [];
  const again = intake(s, gh([issue(4)], {}, calls));
  assert.deepEqual([again.closed, again.leftAlone], [[], []]);
  assert.ok(!calls.some((c) => c.startsWith('gh issue view')), 'a done task\'s issue isn\'t asked about again');
});

test('intake github: a task whose issue closed after it started is left as it is, and named', () => {
  const s = githubRepo();
  intake(s, gh([issue(5), issue(6)]));
  start(s, 'GH-5');
  mutate(s.paths, now, (l, emit) => {
    // Dispatched once, then put back: it still started.
    const t = l.tasks.find((x) => x.id === 'GH-6')!;
    t.run = { branch: 'task/GH-6' };
    emit({ type: 'task.updated', task: 'GH-6', actor: 'human', by: 'test', data: {} });
  });
  const r = intake(s, gh([], { 5: closed(5), 6: closed(6) }));
  assert.deepEqual(r.closed, []);
  assert.deepEqual(r.leftAlone.map((l) => l.note), ['#5 was closed on GitHub; GH-5 is still running', '#6 was closed on GitHub; GH-6 is still todo']);
  assert.deepEqual(readLedger(s.paths.ledger).tasks.map((t) => t.state), ['running', 'todo']);
});

test('intake github: an issue left out by --label, or that GitHub can\'t show, changes nothing', () => {
  const s = githubRepo();
  intake(s, gh([issue(7), issue(8)]));
  const r = intake(s, gh([], { 7: ok(JSON.stringify({ number: 7, state: 'OPEN', labels: [] })) }));
  assert.deepEqual([r.closed, r.removed, r.leftAlone], [[], [], []]);
  assert.deepEqual(readLedger(s.paths.ledger).tasks.map((t) => t.state), ['todo', 'todo']);
});

test('intake github: issues with a skipped label aren\'t imported, and a task already made from one leaves the ledger if it never started', () => {
  const before = githubRepo();
  intake(before, gh([issue(2, ['milestone']), issue(6, ['milestone']), issue(7)]));
  start(before, 'GH-6');
  const s = { ...before, config: parseConfig({ ...GENERIC_CONFIG, github: { repo: 'o/r', account: 'me' }, trackers: [{ kind: 'github', skipLabels: ['milestone'] }] }).config as Config };
  const r = intake(s, gh([issue(2, ['milestone']), issue(6, ['milestone']), issue(7), issue(8, ['Milestone']), issue(9)]));
  assert.deepEqual(r.added, ['GH-9'], 'GH-8 is a milestone too: labels ignore case');
  assert.deepEqual(r.unchanged, ['GH-7']);
  assert.deepEqual(r.removed, ['GH-2']);
  assert.deepEqual(r.leftAlone, [{ task: 'GH-6', issue: '#6', state: 'running', note: '#6 has the label "milestone"; GH-6 is still running' }]);
  assert.deepEqual(readLedger(s.paths.ledger).tasks.map((t) => t.id), ['GH-6', 'GH-7', 'GH-9']);
  const removed = events(s).filter((e) => e.task === 'GH-2');
  assert.deepEqual(removed.map((e) => e.type), ['task.added', 'task.removed'], 'the events log keeps its history');
  assert.equal(removed[1]!.actor, 'sync');
  assert.match(String(removed[1]!.data.reason), /#2 has the label "milestone"/);

  // A closed milestone is still a milestone: it leaves rather than counting as done.
  intake(before, gh([issue(10, ['milestone'])]));
  const c = intake(s, gh([], { 10: closed(10, ['milestone']) }));
  assert.deepEqual([c.removed, c.closed], [['GH-10'], []]);
});

// ---------------------------------------------------------------- the place (D-072)

/** What `gh issue view` says of an issue: open, with these labels, and where it lives now. */
const viewed = (number: number, labels: string[], url = `https://github.com/o/r/issues/${number}`): RunResult => ok(JSON.stringify({ number, state: 'OPEN', labels: labels.map((name) => ({ name })), url }));

test('intake github reads the GitHub tracker\'s repo, and only issues with one of its labels: a list per label, merged', () => {
  const s = githubRepo({ kind: 'github', repo: 'acme/service', labels: ['billing', 'invoices'] });
  const calls: string[] = [];
  const list = 'gh issue list -R acme/service --state open --limit 500';
  const at = (n: number, labels: string[]): GithubIssue => ({ ...issue(n, labels), url: `https://github.com/acme/service/issues/${n}` });
  const runner = fakeRunner({
    'gh auth token -u me': ok('tok\n'),
    [`${list} --label billing`]: ok(JSON.stringify([at(3, ['billing']), at(1, ['billing', 'invoices'])])),
    [`${list} --label invoices`]: ok(JSON.stringify([at(4, ['Invoices']), at(1, ['billing', 'invoices'])])),
  }, calls);
  const r = intake(s, runner);
  assert.deepEqual(r.added, ['GH-4', 'GH-3', 'GH-1'], 'each issue once');
  assert.ok(calls.every((c) => !c.startsWith('gh issue') || c.includes('-R acme/service')), 'the tracker\'s repo, not the project\'s own (o/r)');
  assert.equal(readLedger(s.paths.ledger).tasks.find((t) => t.id === 'GH-4')!.source.url, 'https://github.com/acme/service/issues/4');

  // --label narrows each list, and the place still holds.
  const narrow: string[] = [];
  intakeGithub(s.paths, s.config, { run: fakeRunner({ 'gh auth token -u me': ok('tok\n'), [list]: ok('[]') }, narrow), now, env: {} }, { label: 'urgent', actor: 'human', by: 'human:test' });
  assert.ok(narrow.includes(`${list} --label urgent --label billing --json number,title,body,url,labels`));
  assert.ok(narrow.includes(`${list} --label urgent --label invoices --json number,title,body,url,labels`));
});

test('intake github: a task whose issue left the place leaves the ledger if it never started, and is named if it did', () => {
  const s = githubRepo({ kind: 'github', labels: ['billing'] });
  intake(s, gh([issue(5, ['billing']), issue(6, ['billing']), issue(7, ['billing']), issue(8, ['billing'])]));
  start(s, 'GH-6');
  // The place was narrowed, or the issues changed: 5 and 6 lost the label, 7 moved repo, 8 still has it.
  const r = intake(s, gh([issue(8, ['Billing'])], { 5: viewed(5, ['docs']), 6: viewed(6, []), 7: viewed(7, ['billing'], 'https://github.com/other/repo/issues/2') }));
  assert.deepEqual([r.removed, r.left, r.closed], [['GH-5', 'GH-7'], ['GH-5', 'GH-7'], []]);
  assert.deepEqual(r.leftAlone, [{ task: 'GH-6', issue: '#6', state: 'running', note: '#6 left this repo\'s place: it has no label billing; GH-6 is still running' }]);
  assert.deepEqual(readLedger(s.paths.ledger).tasks.map((t) => `${t.id} ${t.state}`), ['GH-6 running', 'GH-8 todo'], 'the started one stays, on the agent board');
  const removed = events(s).filter((e) => e.type === 'task.removed');
  assert.deepEqual(removed.map((e) => [e.task, e.actor, e.data.reason]), [
    ['GH-5', 'sync', 'Issue #5 left this repo\'s place: it has no label billing.'],
    ['GH-7', 'sync', 'Issue #7 left this repo\'s place: it moved to other/repo.'],
  ]);
});

test('intake jira or azure: tickets the Command Center found outside the place leave the ledger if never started, and are named if they did', () => {
  const s = githubRepo();
  mutate(s.paths, now, (l, emit) => upsertTasks(l, s.config, ['ACME-7', 'ACME-8', 'ACME-9', 'ACME-10'].map((key) => ({ source: { kind: 'jira' as const, key }, title: key })), 'human', 'h', emit, now));
  start(s, 'ACME-8');
  mutate(s.paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === 'ACME-10')!;
    t.state = 'done';
    emit({ type: 'task.updated', task: t.id, actor: 'human', by: 'test', data: {} });
  });
  const r = intakeOutside(s.paths, 'jira', [
    { key: 'acme-7', why: 'it isn\'t in epic ACME-3' }, { key: 'ACME-8', why: 'it\'s in project OPS' },
    { key: 'ACME-10', why: 'it isn\'t in epic ACME-3' }, { key: 'ACME-404', why: 'it isn\'t in epic ACME-3' },
  ], now);
  assert.deepEqual([r.removed, r.left, r.closed, r.added], [['ACME-7'], ['ACME-7'], [], []]);
  assert.deepEqual(r.leftAlone, [{ task: 'ACME-8', issue: 'ACME-8', state: 'running', note: 'ACME-8 left this repo\'s place: it\'s in project OPS; ACME-8 is still running' }]);
  assert.deepEqual(readLedger(s.paths.ledger).tasks.map((t) => t.id), ['ACME-8', 'ACME-9', 'ACME-10'], 'a done task and an unknown key change nothing');
  assert.equal(events(s).at(-1)!.data.reason, 'ACME-7 left this repo\'s place: it isn\'t in epic ACME-3.');
  assert.deepEqual(intakeOutside(s.paths, 'azure', [{ key: 'ACME-9', why: 'x' }], now).removed, [], 'only a task from that kind of tracker');
});

test('skipLabelOf names the matching label, whatever its case', () => {
  assert.equal(skipLabelOf(issue(1, ['bug', 'Milestone']), ['milestone']), 'Milestone');
  assert.equal(skipLabelOf(issue(1, ['bug']), ['milestone']), null);
  assert.equal(skipLabelOf(issue(1, ['milestone']), []), null);
});
