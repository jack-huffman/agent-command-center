// Conflict-aware dispatch (D-093): a task that shares files with work in flight waits, and starts on its own
// once it may. These were dispatch.test.ts's; they're their own file so npm test runs them beside it (T-57).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { dispatch, type DispatchOptions } from '../src/dispatch.ts';
import { startHeld, stopWaiting } from '../src/held.ts';
import { run } from '../src/exec.ts';
import { displayState, moveTask, mutate, noGateHooks, readLedger, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { acc, fakeClaude, IGNORE, tasksOf, trustingHome } from './dispatch-support.ts';
import { bad, fakeRunner, GENERIC_CONFIG, launchedSessions, makeRepo, ok, writePlan } from './support.ts';

// ---------------------------------------------------------------- conflict-aware dispatch (D-093)

/**
 * A repo whose tasks plan these files, with a stand-in claude. T-1 is dispatched first in most tests:
 * whatever plans src/a.ts then shares a file with it.
 */
function swarm(plans: Record<string, string[] | null>, o: { max?: number } = {}) {
  const repo = realpathSync(makeRepo({
    '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, agents: { max: o.max ?? 5 }, autopilot: { appendOnly: ['docs/DECISIONS.md'] } }),
    'src/a.ts': 'a\n', 'src/b.ts': 'b\n', 'src/c.ts': 'c\n', 'docs/DECISIONS.md': '# Decisions\n', ...IGNORE,
  }));
  const config = parseConfig(JSON.parse(readFileSync(join(repo, '.acc', 'config.json'), 'utf8'))).config!;
  const paths = repoPaths(repo, run);
  const ids = Object.keys(plans);
  mutate(paths, () => new Date(), (l, emit) => { upsertTasks(l, config, ids.map((id) => ({ source: { kind: 'manual' as const, key: id }, title: `Work on ${id}` })), 'human', 'human:test', emit, () => new Date()); });
  for (const [id, files] of Object.entries(plans)) if (files) writePlan(paths.analyses, id, files);
  const calls: string[] = [];
  let launch = ok('backgrounded');
  const runner = fakeRunner({ 'claude --bg': () => launch, 'claude agents --json': launchedSessions(calls), 'claude stop': ok() }, calls);
  // Each step a second apart, so the oldest hold is plain.
  let clock = Date.parse('2026-10-06T10:00:00.000Z');
  const now = () => new Date((clock += 1000));
  const deps = { run: runner, now, accBinDir: '/acc/bin', env: { HOME: trustingHome(repo), PATH: '/usr/bin' }, findSessionMs: 0 };
  const go = (id: string, extra: Partial<DispatchOptions> = {}) => dispatch(paths, config, id, deps, { actor: 'human', by: 'human:test', ...extra });
  const task = (id: string) => readLedger(paths.ledger).tasks.find((t) => t.id === id)!;
  const moves = (id: string) => readFileSync(paths.events, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.type === 'task.moved' && e.task === id);
  const finish = (id: string) => moveTask(paths, config, id, { to: 'done', actor: 'human', by: 'human:test', force: true, reason: 'merged' }, noGateHooks, now);
  return {
    repo, paths, config, deps, go, task, moves, finish,
    held: () => startHeld(paths, config, deps, { actor: 'human', by: 'human:test' }),
    launches: () => calls.filter((c) => c.startsWith('claude --bg')).length,
    /** How many times work in flight was looked at: its worktree's untracked files. */
    looks: () => calls.filter((c) => c.startsWith('git ls-files --others')).length,
    failLaunch: () => { launch = bad('Claude Code needs you to log in'); },
  };
}

test('a task that shares files with work in flight waits while another Ready task shares none, and nothing is created (D-093)', () => {
  const s = swarm({ 'T-1': ['src/a.ts'], 'T-2': ['./src/a.ts', 'src/b.ts'], 'T-3': ['src/c.ts'] });
  assert.equal(s.go('T-1').held, false);
  const r = s.go('T-2');
  assert.ok(r.held);
  assert.deepEqual(r.waitsFor, [{ task: 'T-1', files: ['src/a.ts'] }]);
  assert.deepEqual(r.first, ['T-3']);
  const t = s.task('T-2');
  assert.equal(t.state, 'todo');
  assert.deepEqual([t.held?.by, t.held?.waitsFor, t.held?.first], ['human:test', [{ task: 'T-1', files: ['src/a.ts'] }], ['T-3']]);
  assert.equal(existsSync(join(s.repo, '.claude', 'worktrees', 'T-2')), false, 'no worktree');
  assert.equal(s.launches(), 1, 'no builder');
  assert.equal(displayState(readLedger(s.paths.ledger), t), 'ready', 'it stays in the Ready lane');
  // Asked again, it keeps its place in the queue.
  const again = s.go('T-2');
  assert.ok(again.held);
  assert.equal(s.task('T-2').held?.at, t.held?.at);
});

test('no overlap, an overlap only in an append-only file, or no analysis: it starts (D-093)', () => {
  const s = swarm({ 'T-1': ['src/a.ts', 'docs/DECISIONS.md'], 'T-2': ['src/b.ts'], 'T-3': ['docs/DECISIONS.md', 'src/c.ts'], 'T-4': null, 'T-5': ['src/c.ts'] });
  s.go('T-1');
  const free = s.go('T-2');
  assert.ok(!free.held);
  assert.deepEqual(free.shares, []);
  const log = s.go('T-3');
  assert.ok(!log.held, 'both append to the decision log: that never counts');
  assert.deepEqual(log.shares, []);
  // T-4 has no analysis: its files aren't known, so it never waits, though T-5 is Ready and free, and
  // nothing in flight is looked at for it.
  const looked = s.looks();
  const unknown = s.go('T-4');
  assert.ok(!unknown.held);
  assert.equal(s.task('T-4').state, 'running');
  assert.equal(s.looks(), looked, 'no git calls for work in flight');
});

test('an analysis that names no files: it starts, and nothing in flight is looked at (D-093)', () => {
  const s = swarm({ 'T-1': ['src/a.ts'], 'T-2': [], 'T-3': ['src/c.ts'] });
  s.go('T-1');
  const looked = s.looks();
  const r = s.go('T-2');
  assert.ok(!r.held);
  assert.deepEqual(r.shares, []);
  assert.equal(s.looks(), looked);
});

test('when nothing else is ready, a task that shares files starts anyway, and says what it shares (D-093)', () => {
  const s = swarm({ 'T-1': ['src/a.ts'], 'T-2': ['src/a.ts', 'src/b.ts'] });
  s.go('T-1');
  // T-1's builder has touched src/b.ts too, uncommitted: its branch's files count beside its plan.
  writeFileSync(join(s.repo, '.claude', 'worktrees', 'T-1', 'src', 'b.ts'), 'b2\n');
  const r = s.go('T-2');
  assert.ok(!r.held);
  assert.deepEqual(r.shares, [{ task: 'T-1', files: ['src/a.ts', 'src/b.ts'] }]);
  assert.deepEqual(s.task('T-2').run?.shares, [{ task: 'T-1', files: ['src/a.ts', 'src/b.ts'] }]);
  assert.deepEqual(s.moves('T-2').at(-1).data.shares, [{ task: 'T-1', files: ['src/a.ts', 'src/b.ts'] }]);
  assert.equal(s.moves('T-2').at(-1).data.anyway, undefined);
});

test('a person dispatches anyway: it starts at once, and its move records the overlap (D-093)', () => {
  const s = swarm({ 'T-1': ['src/a.ts'], 'T-2': ['src/a.ts'], 'T-3': ['src/c.ts'] });
  s.go('T-1');
  assert.ok(s.go('T-2').held);
  const r = s.go('T-2', { anyway: true });
  assert.ok(!r.held);
  const t = s.task('T-2');
  assert.equal(t.state, 'running');
  assert.equal(t.held, null, 'the move ended its wait');
  const move = s.moves('T-2').at(-1);
  assert.deepEqual([move.data.anyway, move.data.shares], [true, [{ task: 'T-1', files: ['src/a.ts'] }]]);
  // Only a person says anyway.
  const s2 = swarm({ 'T-1': ['src/a.ts'], 'T-2': ['src/a.ts'], 'T-3': ['src/c.ts'] });
  s2.go('T-1');
  assert.ok(s2.go('T-2', { anyway: true, actor: 'orchestrator', by: 'orchestrator:test' }).held);
});

test('anyway is recorded only when it overrode a wait: with nothing else ready, it would have started (D-093)', () => {
  const s = swarm({ 'T-1': ['src/a.ts'], 'T-2': ['src/a.ts'] });
  s.go('T-1');
  const r = s.go('T-2', { anyway: true });
  assert.ok(!r.held);
  const move = s.moves('T-2').at(-1);
  assert.deepEqual([move.data.anyway, move.data.shares], [undefined, [{ task: 'T-1', files: ['src/a.ts'] }]]);
});

test('a rework\'s re-dispatch never waits: its branch already holds its change (D-093)', () => {
  const s = swarm({ 'T-1': ['src/a.ts'], 'T-2': ['src/a.ts'], 'T-3': ['src/c.ts'] });
  s.go('T-1');
  s.go('T-2', { anyway: true });
  moveTask(s.paths, s.config, 'T-1', { to: 'review', actor: 'human', by: 'human:test', force: true, reason: 'finished' }, noGateHooks, s.deps.now);
  moveTask(s.paths, s.config, 'T-1', { to: 'rework', actor: 'human', by: 'human:test', reason: 'needs more' }, noGateHooks, s.deps.now);
  const r = s.go('T-1');
  assert.ok(!r.held);
  assert.equal(s.task('T-1').state, 'running');
});

test('a held task starts on its own once the task it waits for is done, and only once (D-093)', () => {
  const s = swarm({ 'T-1': ['src/a.ts'], 'T-2': ['src/a.ts'], 'T-3': ['src/c.ts'] });
  s.go('T-1');
  assert.ok(s.go('T-2').held);
  // Still overlapping, and T-3 could go first: it keeps waiting.
  const still = s.held();
  assert.deepEqual(still.started, []);
  assert.equal(still.waiting[0]!.task, 'T-2');
  assert.match(still.waiting[0]!.reason, /^Waits for T-1's files: src\/a\.ts, while T-3 is ready to start\.$/);
  s.finish('T-1');
  const r = s.held();
  assert.deepEqual(r.started.map((x) => [x.task, x.waitedFor, x.shares]), [['T-2', ['T-1'], []]]);
  assert.equal(s.task('T-2').state, 'running');
  assert.equal(s.moves('T-2').at(-1).data.held.waitedFor[0], 'T-1');
  assert.deepEqual(s.held(), { started: [], waiting: [], failed: [] }, 'called again, there\'s nothing to start');
  assert.equal(s.launches(), 2, 'T-1 and T-2, each once');
});

test('a held task starts once nothing else is ready, sharing files; at the cap it waits (D-093)', () => {
  const s = swarm({ 'T-1': ['src/a.ts'], 'T-2': ['src/a.ts'], 'T-3': ['src/c.ts'] }, { max: 2 });
  s.go('T-1');
  assert.ok(s.go('T-2').held);
  s.go('T-3');
  const capped = s.held();
  assert.deepEqual(capped.started, []);
  assert.match(capped.waiting[0]!.reason, /2 builders are running in this project, and its cap is 2 \(agents\.max\)\./);
  s.finish('T-3');
  const r = s.held();
  assert.deepEqual(r.started.map((x) => [x.task, x.shares]), [['T-2', [{ task: 'T-1', files: ['src/a.ts'] }]]], 'nothing else is ready: it starts beside T-1');
  assert.deepEqual(s.task('T-2').run?.shares, [{ task: 'T-1', files: ['src/a.ts'] }]);
});

test('held tasks start oldest first, and one a just-started task now overlaps keeps waiting, naming it (D-093)', () => {
  const s = swarm({ 'T-1': ['src/a.ts'], 'T-2': ['src/a.ts'], 'T-4': ['src/a.ts', 'src/b.ts'], 'T-3': ['src/c.ts'] });
  s.go('T-1');
  assert.ok(s.go('T-2').held);
  assert.ok(s.go('T-4').held);
  s.finish('T-1');
  const r = s.held();
  assert.deepEqual(r.started.map((x) => x.task), ['T-2'], 'the older hold');
  assert.deepEqual(r.waiting.map((w) => [w.task, w.waitsFor]), [['T-4', [{ task: 'T-2', files: ['src/a.ts'] }]]]);
  assert.match(r.waiting[0]!.reason, /Waits for T-2's files/);
  assert.equal(s.task('T-4').state, 'todo');
});

test('a held task\'s start that fails is written on it, needs a person, and isn\'t tried again (D-093)', () => {
  const s = swarm({ 'T-1': ['src/a.ts'], 'T-2': ['src/a.ts'], 'T-3': ['src/c.ts'] });
  s.go('T-1');
  assert.ok(s.go('T-2').held);
  s.finish('T-1');
  s.failLaunch();
  const r = s.held();
  assert.deepEqual(r.failed.map((f) => f.task), ['T-2']);
  assert.match(r.failed[0]!.reason, /Claude Code didn't start the agent: Claude Code needs you to log in/);
  const t = s.task('T-2');
  assert.match(t.held?.failed?.reason ?? '', /log in/);
  assert.equal(t.held?.starting, null, 'its claim is let go');
  assert.equal(displayState(readLedger(s.paths.ledger), t), 'needs-you');
  const launches = s.launches();
  assert.deepEqual(s.held(), { started: [], waiting: [], failed: [] });
  assert.equal(s.launches(), launches, 'not launched again');
  // A person stops it waiting: it's an ordinary task to do again.
  assert.equal(stopWaiting(s.paths, s.deps.now, 'T-2', 'human', 'human:test').held, null);
  assert.equal(displayState(readLedger(s.paths.ledger), s.task('T-2')), 'ready');
  assert.throws(() => stopWaiting(s.paths, s.deps.now, 'T-2', 'human', 'human:test'), /isn't waiting for anything/);
});

test('acc dispatch: a held task says what it waits for, --held starts it once it may, --anyway and --stop-waiting (D-093)', () => {
  const repo = realpathSync(makeRepo({
    '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, agents: { max: 5 }, dispatch: { shared: ['README.md'] } }),
    'src/a.ts': 'a\n', 'src/c.ts': 'c\n', ...IGNORE,
  }));
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  for (const title of ['One', 'Two', 'Three', 'Four']) acc(repo, ['add', title]);
  const analyses = join(repo, '.git', 'acc', 'analyses');
  writePlan(analyses, 'T-1', ['src/a.ts', 'README.md']);
  writePlan(analyses, 'T-2', ['src/a.ts', 'README.md']);
  writePlan(analyses, 'T-3', ['src/c.ts']);
  writePlan(analyses, 'T-4', ['src/a.ts']);
  assert.equal(acc(repo, ['dispatch', 'T-1'], env).code, 0);

  const held = acc(repo, ['dispatch', 'T-2', '--json'], env);
  assert.equal(held.code, 0, held.err);
  assert.deepEqual(held.json().held, true);
  assert.deepEqual(held.json().waitsFor, [{ task: 'T-1', files: ['src/a.ts'] }], 'README.md is shared by every task: it never counts');
  const words = acc(repo, ['dispatch', 'T-4'], env);
  assert.equal(words.code, 0, words.err);
  assert.match(words.out, /T-4 waits for T-1's files: src\/a\.ts\.\n {2}T-3 shares no files with work in flight, so it goes first\.\n {2}T-4 starts on its own once T-1 merges, or once nothing else is ready to start/);
  assert.match(words.out, /acc dispatch T-4 --anyway/);
  assert.match(acc(repo, ['show', 'T-2'], env).out, /Waits for T-1's files: src\/a\.ts, while T-3 is ready to start\. It starts on its own once they're free, or: acc dispatch T-2 --anyway/);
  assert.match(acc(repo, ['show', 'T-3'], env).out, /^(?!.*Shares files)/s, 'T-3 shares nothing');

  // A person stops T-4 waiting, and starts T-2 anyway.
  assert.equal(acc(repo, ['dispatch', 'T-4', '--stop-waiting'], env).code, 0);
  assert.equal(JSON.parse(readFileSync(join(repo, '.git', 'acc', 'ledger.json'), 'utf8')).tasks[3].held, null);
  const anyway = acc(repo, ['dispatch', 'T-2', '--anyway'], env);
  assert.equal(anyway.code, 0, anyway.err);
  assert.match(anyway.out, /T-2 → .*Running[\s\S]*Shares files with T-1: src\/a\.ts\. The second pull request to merge may conflict there\./);
  assert.match(acc(repo, ['show', 'T-2'], env).out, /Shares files with T-1: src\/a\.ts\./);

  // T-4 waits again; once T-1 is done, --held starts it.
  assert.ok(acc(repo, ['dispatch', 'T-4', '--json'], env).json().held);
  assert.match(acc(repo, ['dispatch', '--held'], env).out, /… T-4 {2}Waiting: Waits for T-1's files: src\/a\.ts, and T-2's: src\/a\.ts, while T-3 is ready to start\./);
  assert.equal(acc(repo, ['set', 'T-1', 'done', '--force', '--reason', 'merged'], env).code, 0);
  assert.equal(acc(repo, ['set', 'T-2', 'done', '--force', '--reason', 'merged'], env).code, 0);
  const started = acc(repo, ['dispatch', '--held', '--json'], env);
  assert.equal(started.code, 0, started.err);
  assert.deepEqual(started.json().started.map((s: { task: string; waitedFor: string[] }) => [s.task, s.waitedFor]), [['T-4', ['T-1', 'T-2']]]);
  assert.equal(tasksOf(repo)[3]!.state, 'running');
  assert.equal(acc(repo, ['dispatch', '--held'], env).out, 'No task waits for another\'s files.\n');
  assert.equal(acc(repo, ['dispatch', 'T-3', '--held'], env).code, 2, '--held takes no id');
  assert.match(acc(repo, ['show', 'T-3'], env).out, /^T-3 /);
});

test('acc show says when a task\'s files aren\'t known (D-093)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE }));
  acc(repo, ['add', 'Unplanned']);
  assert.match(acc(repo, ['show', 'T-1']).out, /Its files aren't known: it has no analysis, so it never waits for another task's\./);
  assert.equal(acc(repo, ['show', 'T-1', '--json']).json().files.known, false);
  // An analysis that names no files isn't told it has none.
  acc(repo, ['add', 'Planned, with no files']);
  writePlan(repoPaths(repo, run).analyses, 'T-2', []);
  assert.match(acc(repo, ['show', 'T-2']).out, /Its files aren't known: its analysis names no files, so it never waits for another task's\./);
});

test('a held task keeps the model a person picked when they dispatched it, and starts with it (D-093, D-086)', () => {
  const s = swarm({ 'T-1': ['src/a.ts'], 'T-2': ['src/a.ts'], 'T-3': ['src/c.ts'] });
  s.go('T-1');
  assert.ok(s.go('T-2', { model: 'claude-sonnet-5-5' }).held);
  assert.equal(s.task('T-2').held?.model, 'claude-sonnet-5-5');
  // Asked again without one, it keeps the model.
  assert.ok(s.go('T-2').held);
  assert.equal(s.task('T-2').held?.model, 'claude-sonnet-5-5');
  s.finish('T-1');
  assert.deepEqual(s.held().started.map((x) => x.task), ['T-2']);
  assert.deepEqual([s.task('T-2').run?.model, s.task('T-2').run?.modelPicked], ['claude-sonnet-5-5', true]);
});

test('a held task keeps the effort a person picked when they dispatched it, and starts with it (D-093, D-128)', () => {
  const s = swarm({ 'T-1': ['src/a.ts'], 'T-2': ['src/a.ts'], 'T-3': ['src/c.ts'] });
  s.go('T-1');
  assert.ok(s.go('T-2', { effort: 'xhigh' }).held);
  assert.equal(s.task('T-2').held?.effort, 'xhigh');
  assert.ok(s.go('T-2').held);
  assert.equal(s.task('T-2').held?.effort, 'xhigh', 'asked again without one, it keeps the effort');
  s.finish('T-1');
  assert.deepEqual(s.held().started.map((x) => x.task), ['T-2']);
  assert.deepEqual([s.task('T-2').run?.effort, s.task('T-2').run?.effortPicked], ['xhigh', true]);
});

test('a held task\'s picked effort is dropped by --effort default, or by a model picked that doesn\'t take it, and its start keeps none (D-093, D-128)', () => {
  const s = swarm({ 'T-1': ['src/a.ts'], 'T-2': ['src/a.ts'], 'T-3': ['src/c.ts'], 'T-4': ['src/a.ts'] });
  s.go('T-1');
  assert.ok(s.go('T-2', { effort: 'xhigh' }).held);
  const r = s.go('T-2', { model: 'claude-haiku-4-5-20251001' });
  assert.ok(r.held);
  assert.equal(r.effortDropped, 'xhigh', 'said, so acc can say so');
  assert.deepEqual([s.task('T-2').held?.model, s.task('T-2').held?.effort], ['claude-haiku-4-5-20251001', 'default']);
  assert.ok(s.go('T-4', { effort: 'max' }).held);
  assert.equal(s.go('T-4', { effort: 'default' }).effortDropped, undefined, 'asked for, so not news');
  assert.equal(s.task('T-4').held?.effort, 'default');
  s.finish('T-1');
  assert.deepEqual(s.held().started.map((x) => x.task), ['T-2'], 'T-4 now waits for T-2');
  assert.deepEqual([s.task('T-2').run?.model, s.task('T-2').run?.effort, s.task('T-2').run?.effortPicked], ['claude-haiku-4-5-20251001', undefined, undefined]);
});

test('a person\'s dispatch of a held task claims it first, and lets go of the claim if the launch fails (D-093)', () => {
  const s = swarm({ 'T-1': ['src/a.ts'], 'T-2': ['src/a.ts'], 'T-3': ['src/c.ts'] });
  s.go('T-1');
  assert.ok(s.go('T-2').held);
  s.failLaunch();
  assert.throws(() => s.go('T-2', { anyway: true }), /log in/);
  const t = s.task('T-2');
  assert.equal(t.state, 'todo');
  assert.ok(t.held, 'it still waits');
  assert.equal(t.held?.starting, null, 'its claim is let go, so a held start can take it');
});

test('a held task being started elsewhere isn\'t started twice (D-093)', () => {
  const s = swarm({ 'T-1': ['src/a.ts'], 'T-2': ['src/a.ts'], 'T-3': ['src/c.ts'] });
  s.go('T-1');
  assert.ok(s.go('T-2').held);
  s.finish('T-1');
  // Another window claimed it a moment ago.
  mutate(s.paths, s.deps.now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === 'T-2')!;
    t.held!.starting = { at: s.deps.now().toISOString(), by: 'orchestrator:autopilot' };
    emit({ type: 'task.updated', task: 'T-2', actor: 'orchestrator', by: 'orchestrator:autopilot', data: { held: t.held } });
  });
  const r = s.held();
  assert.deepEqual(r.started, []);
  assert.match(r.waiting[0]!.reason, /orchestrator:autopilot is starting it/);
  assert.throws(() => s.go('T-2'), /orchestrator:autopilot is starting it/);
  assert.equal(s.launches(), 1);
});
