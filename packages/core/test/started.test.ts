// A builder that never started (T-92): the dispatch proves it started, or leaves the task at Needs you and
// stops what half-started; "can't tell" is a state of its own; Dispatch again; and stale sessions don't count.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { AGAIN_REASON, againRefusal, dispatchAgain } from '../src/again.ts';
import { nextStep } from '../src/autopilot-rules.ts';
import { parseConfig } from '../src/config.ts';
import { dispatch, findSession } from '../src/dispatch.ts';
import { run, type RunResult } from '../src/exec.ts';
import { builderStopped, displayState, mutate, readLedger, RUN_SLACK_MS, sessionsOf, type Task, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { askAgents, listSessions } from '../src/resume.ts';
import { awaitStart, builderUnseen, DISPATCH_AGAIN, MISSING_WORDS, noteAnswer, NOT_STARTED, quietMs, SERVICE_DOWN, START_WAIT_MS, transcriptWrittenAt, UNSEEN_WORDS } from '../src/started.ts';
import { transcriptDir } from '../src/transcript.ts';
import { runWrittenAt, unseenFrom, unseenNow, unseenOf } from '../src/unseen.ts';
import { acc, fakeClaude, IGNORE, trustingHome } from './dispatch-support.ts';
import { bad, fakeRunner, GENERIC_CONFIG, launchedSessions, makeRepo, ok, tempDir } from './support.ts';

/** A repo with T-1 to do, a stand-in claude whose `claude agents` answers as `agents` says, and a projects folder. */
function setup(agents: (calls: string[]) => () => RunResult, o: { onLaunch?: (wt: string) => void } = {}) {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE }));
  const config = parseConfig(GENERIC_CONFIG).config!;
  const paths = repoPaths(repo, run);
  mutate(paths, () => new Date(), (l, emit) => { upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'Write the changelog' }], 'human', 'human:test', emit, () => new Date()); });
  const calls: string[] = [];
  const projectsDir = tempDir('projects-');
  const wt = join(repo, '.claude', 'worktrees', 'T-1');
  const runner = fakeRunner({ 'claude --bg': () => { o.onLaunch?.(wt); return ok('backgrounded'); }, 'claude agents --json': agents(calls), 'claude stop': ok() }, calls);
  const deps = { run: runner, now: () => new Date(), accBinDir: '/acc/bin', env: { HOME: trustingHome(repo), PATH: '/usr/bin' }, findSessionMs: 0, startWaitMs: 0, projectsDir };
  const task = () => readLedger(paths.ledger).tasks.find((t) => t.id === 'T-1')!;
  return { repo, config, paths, calls, deps, projectsDir, wt, task, go: () => dispatch(paths, config, 'T-1', deps, { actor: 'human', by: 'human:test', model: 'claude-sonnet-5-5', effort: 'medium' }) };
}

const noSession = () => () => ok('[]');
/** A session listed by its name, but with no process: Claude Code's service took it, and nothing runs it. */
const noPid = (calls: string[]) => () => ok(JSON.stringify(calls.filter((c) => c.startsWith('claude --bg ')).map(() => ({ id: 'bg7', sessionId: 'sess-7', name: 'Tool · T-1 Write the changelog · builder', kind: 'background', startedAt: Date.now(), state: 'blocked' }))));

test('a dispatch whose session never appears ends at Needs you with the reason, and nothing is stopped (T-92)', () => {
  const s = setup(noSession);
  const r = s.go();
  assert.ok(!r.held);
  assert.deepEqual(r.notStarted, { reason: NOT_STARTED, stopped: null });
  const t = s.task();
  assert.equal(t.state, 'todo', 'it was never moved to Running');
  assert.equal(t.notStarted?.reason, NOT_STARTED);
  assert.deepEqual([t.notStarted?.where, t.notStarted?.model, t.notStarted?.effort], ['local', 'claude-sonnet-5-5', 'medium'], 'what it was dispatched with is kept');
  assert.equal(displayState(readLedger(s.paths.ledger), t), 'needs-you');
  assert.equal(s.calls.filter((c) => c.startsWith('claude stop')).length, 0, 'no session to stop');
  assert.ok(!t.history.some((h) => h.to === 'running'));
});

test('a session with no pid and no conversation is stopped, and the task needs you (T-92)', () => {
  const s = setup(noPid);
  const r = s.go();
  assert.ok(!r.held);
  assert.deepEqual(r.notStarted, { reason: NOT_STARTED, stopped: 'bg7' });
  assert.ok(s.calls.includes('claude stop bg7'), 'the half-started session is stopped');
  assert.equal(s.task().state, 'todo');
  assert.equal(s.task().run, null, 'no run is recorded, so no bgId points at it');
});

test('a session with no pid whose conversation was written did start: the dispatch is unchanged (T-92)', () => {
  // Its conversation, saved under the worktree's folder, once it's launched.
  const s2 = setup(noPid, { onLaunch: (wt) => { const d = transcriptDir(s2.projectsDir, wt); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'sess-7.jsonl'), '{}\n'); } });
  const r = s2.go();
  assert.ok(!r.held);
  assert.equal(r.notStarted, undefined);
  assert.equal(s2.task().state, 'running');
  assert.equal(s2.task().run?.bgId, 'bg7');
  assert.ok(!s2.calls.some((c) => c.startsWith('claude stop')));
});

test('a dispatch whose session starts with a process is unchanged (T-92)', () => {
  const s = setup(launchedSessions);
  const r = s.go();
  assert.ok(!r.held);
  assert.equal(r.notStarted, undefined);
  assert.equal(s.task().state, 'running');
  assert.equal(s.task().notStarted, undefined);
  assert.equal(r.bgId, 'bg1');
});

test('Dispatch again starts a task whose builder didn\'t start with the same model, effort and place, its reason in History (T-92)', () => {
  let up = false;
  const s = setup((calls) => () => (up ? launchedSessions(calls)() : ok('[]')));
  s.go();
  up = true;
  const r = dispatchAgain(s.paths, s.config, 'T-1', s.deps, { actor: 'human', by: 'human:test' });
  assert.ok(!r.held && !r.notStarted);
  const t = s.task();
  assert.equal(t.state, 'running');
  assert.equal(t.notStarted, null, 'the move ends it');
  assert.deepEqual([t.run?.model, t.run?.effort, t.run?.where ?? 'local'], ['claude-sonnet-5-5', 'medium', 'local']);
  assert.equal(t.history.at(-1)?.reason, `Dispatched again: ${NOT_STARTED}`);
});

test('Dispatch again on a running task acc can\'t see sets it back, stops its session and dispatches, in one step (T-92)', () => {
  const s = setup(launchedSessions);
  s.go();
  const r = dispatchAgain(s.paths, s.config, 'T-1', s.deps, { actor: 'human', by: 'human:test', unseen: 'quiet' });
  assert.ok(!r.held && !r.notStarted);
  const t = s.task();
  assert.equal(t.state, 'running');
  assert.ok(s.calls.includes('claude stop bg1'), 'the old session is stopped');
  const last = t.history.slice(-2).map((h) => [h.from, h.to, h.reason]);
  assert.deepEqual(last, [['running', 'todo', `Dispatched again: ${AGAIN_REASON}`], ['todo', 'running', `Dispatched again: ${AGAIN_REASON}`]]);
  assert.equal(t.run?.n, 2, 'a new builder');
});

test('Dispatch again is refused for an agent, for a task that isn\'t running or didn\'t fail to start, and for a cloud builder (T-92)', () => {
  const s = setup(launchedSessions);
  assert.throws(() => dispatchAgain(s.paths, s.config, 'T-1', s.deps, { actor: 'orchestrator', by: 'x' }), /person's/);
  assert.throws(() => dispatchAgain(s.paths, s.config, 'T-1', s.deps, { actor: 'human', by: 'x' }), /dispatch it as usual/);
  assert.throws(() => dispatchAgain(s.paths, s.config, 'T-9', s.deps, { actor: 'human', by: 'x' }), /No task T-9/);
  s.go();
  mutate(s.paths, () => new Date(), (l, emit) => { l.tasks[0]!.run!.where = 'cloud'; emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'human:test', data: {} }); });
  assert.throws(() => dispatchAgain(s.paths, s.config, 'T-1', s.deps, { actor: 'human', by: 'x' }), /cloud/);
});

test('autopilot leaves a task whose builder didn\'t start for a person, in rework too (T-92)', () => {
  const s = setup(noSession);
  s.go();
  const t = s.task();
  const d = nextStep(readLedger(s.paths.ledger), s.config, t, {} as never);
  assert.equal(d.step, null);
  assert.match(d.reason, /didn't start.*waits for a person/);
  const rework = { ...t, state: 'rework' as const };
  assert.equal(displayState(readLedger(s.paths.ledger), rework), 'needs-you');
});

// ---------------------------------------------------------------- proof of a start

test('awaitStart: a pid or a written conversation proves it; nothing by the end of the wait does not; a later look keeps earlier ids (T-92)', () => {
  const none = { bgId: null, sessionId: null, pid: null };
  assert.equal(awaitStart({ ...none, pid: 5 }, () => none, () => false, 0).started, true);
  assert.equal(awaitStart(none, () => none, () => true, 0).started, true);
  assert.deepEqual(awaitStart({ ...none, bgId: 'bg1' }, () => none, () => false, 0), { bgId: 'bg1', sessionId: null, pid: null, started: false });
  let n = 0;
  const later = awaitStart(none, () => (++n >= 1 ? { bgId: 'bg2', sessionId: 's', pid: 9 } : none), () => false, 5_000);
  assert.deepEqual(later, { bgId: 'bg2', sessionId: 's', pid: 9, started: true }, 'a step that finishes during the wait');
  assert.equal(START_WAIT_MS, 60_000);
});

test('transcriptWrittenAt: the session\'s own file anywhere, or the newest under the worktree since the start; none is null (T-92)', () => {
  const dir = tempDir('projects-');
  assert.equal(transcriptWrittenAt(dir, { worktree: '/w/T-1', since: 0 }), null, 'an empty projects folder');
  assert.equal(transcriptWrittenAt(join(dir, 'missing'), { worktree: '/w/T-1', since: 0 }), null, 'no projects folder at all');
  const wtDir = transcriptDir(dir, '/w/T-1');
  mkdirSync(wtDir, { recursive: true });
  writeFileSync(join(wtDir, 'old.jsonl'), '{}\n');
  utimesSync(join(wtDir, 'old.jsonl'), 1000, 1000);
  assert.equal(transcriptWrittenAt(dir, { worktree: '/w/T-1', since: 5_000_000 }), null, 'an older run\'s conversation doesn\'t count');
  const other = transcriptDir(dir, '/main');
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, 'sess-1.jsonl'), '{}\n');
  utimesSync(join(other, 'sess-1.jsonl'), 2000, 2000);
  assert.equal(transcriptWrittenAt(dir, { worktree: '/w/T-1', sessionId: 'sess-1', since: 5_000_000 }), 2_000_000, 'its own file, wherever it was saved');
});

// ---------------------------------------------------------------- can't tell (item 2)

const running = (startedAt: string, extra: Partial<Task['run'] & object> = {}): Pick<Task, 'state' | 'run'> => ({ state: 'running', run: { worktree: '/w', branch: 'b', startedAt, ...extra } as Task['run'] });
const T0 = Date.parse('2026-10-21T10:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000);
const Q = quietMs(null);

test('builderUnseen: claude agents not answering past the grace shows it; answering again clears it (T-92)', () => {
  const t = running(at(0).toISOString());
  const base = { now: at(30), resuming: false, writtenAt: at(29).getTime(), quietMs: Q };
  assert.equal(builderUnseen(t, { ...base, silentSince: at(20).getTime() }), 'unanswered');
  assert.equal(builderUnseen(t, { ...base, silentSince: at(29).getTime() }), null, 'within the grace');
  assert.equal(builderUnseen(t, { ...base, silentSince: null }), null, 'it answered again');
  assert.equal(builderUnseen(running(at(29).toISOString()), { ...base, silentSince: at(0).getTime() }), null, 'a run just started');
  assert.equal(builderUnseen(t, { ...base, silentSince: at(0).getTime(), resuming: true }), null, 'a resume under way');
  assert.equal(builderUnseen(running(at(0).toISOString(), { where: 'cloud' }), { ...base, silentSince: at(0).getTime() }), null, 'a cloud builder: its branch says');
  assert.equal(builderUnseen({ ...t, state: 'review' }, { ...base, silentSince: at(0).getTime() }), null, 'not running');
});

test('builderUnseen: a running task with an old conversation, or none at all, and no answer is quiet (T-92)', () => {
  const t = running(at(0).toISOString());
  const late = at(200);
  assert.equal(builderUnseen(t, { now: late, resuming: false, silentSince: at(100).getTime(), writtenAt: at(10).getTime(), quietMs: Q }), 'quiet');
  assert.equal(builderUnseen(t, { now: late, resuming: false, silentSince: at(100).getTime(), writtenAt: null, quietMs: Q }), 'quiet', 'nothing was ever written');
  assert.equal(builderUnseen(t, { now: late, resuming: false, silentSince: at(100).getTime(), writtenAt: at(190).getTime(), quietMs: Q }), 'unanswered', 'written lately');
  assert.equal(quietMs({ agents: { cloud: { quietMinutes: 30 } } }), 30 * 60_000, 'the project\'s quiet setting');
  assert.equal(Q, 120 * 60_000, 'else the default');
  assert.match(UNSEEN_WORDS.quiet.wayOn, new RegExp(`^${DISPATCH_AGAIN}`));
  assert.match(UNSEEN_WORDS.unanswered.wayOn, /Claude Code lists its background agents, or restart Claude Code/);
  // builderStopped still reads no answer as "can't judge stopped": builderUnseen is what says so.
  assert.equal(builderStopped({ id: 'T-1', ...t }, null, { resuming: false, now: late }), false);
});

test('noteAnswer: a first silence starts the clock, a later one keeps it, an answer clears it, and an unreadable file starts afresh (T-92)', () => {
  const paths = { stateDir: join(tempDir(), 'acc') };
  assert.equal(noteAnswer(paths, true, at(0)), null, 'before the first answer arrives, with no file');
  assert.equal(noteAnswer(paths, false, at(1)), at(1).getTime());
  assert.equal(noteAnswer(paths, false, at(5)), at(1).getTime());
  assert.equal(noteAnswer(paths, true, at(6)), null);
  writeFileSync(join(paths.stateDir, 'agents-silent.json'), 'not json');
  assert.equal(noteAnswer(paths, false, at(7)), at(7).getTime());
  assert.deepEqual(JSON.parse(readFileSync(join(paths.stateDir, 'agents-silent.json'), 'utf8')), { since: at(7).getTime() });
});

test('listSessions: a missing service socket is no answer, even with an exit of 0; a failure is none either (T-92)', () => {
  const sock = 'Error: connect ENOENT /tmp/cc-daemon-502/abc/control.sock';
  assert.ok(SERVICE_DOWN.test(sock));
  assert.equal(listSessions(fakeRunner({ 'claude agents --json': { code: 0, stdout: '[]', stderr: sock } }), '/'), null);
  assert.equal(listSessions(fakeRunner({ 'claude agents --json': bad(sock) }), '/'), null);
  assert.deepEqual(listSessions(fakeRunner({ 'claude agents --json': ok('[]') }), '/'), []);
});

// ---------------------------------------------------------------- stale sessions (item 4)

test('sessionsOf: by name, only this run\'s session counts, not an old blocked one of the same name (T-92)', () => {
  const name = 'Tool · T-1 Write the changelog · builder';
  const run = { worktree: '/w', branch: 'b', startedAt: at(100).toISOString(), name };
  const old = { id: 'bg-old', name, kind: 'background', state: 'blocked', startedAt: at(-3 * 24 * 60).getTime() };
  const fresh = { id: 'bg-new', name, kind: 'background', state: 'working', pid: 4, startedAt: at(100).getTime() - RUN_SLACK_MS + 1 };
  const undated = { id: 'bg-?', name, kind: 'background' };
  assert.deepEqual(sessionsOf({ id: 'T-1', run }, [old, fresh, undated]).map((s) => s.id), ['bg-new'], 'an undated one is dropped too (T-93)');
  assert.deepEqual(sessionsOf({ id: 'T-1', run: { ...run, startedAt: undefined as never } }, [old]).map((s) => s.id), ['bg-old'], 'a run with no start time can\'t be told apart');
});

// ---------------------------------------------------------------- acc show and acc dispatch --again

test('acc show: no answer past the grace shows the Needs you line, an answer again clears it, and a builder that didn\'t start says Dispatch again (T-92)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE }));
  const claude = fakeClaude();
  // Claude Code's config folder holds its trust and its projects, where no conversation is saved for it.
  const home = trustingHome(repo);
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: home, CLAUDE_CONFIG_DIR: home };
  assert.equal(acc(repo, ['add', 'Write the changelog'], env).code, 0);
  const d = acc(repo, ['dispatch', 'T-1'], env);
  assert.equal(d.code, 0, d.err + d.out);
  const paths = repoPaths(repo, run);
  // It started ten minutes ago, and Claude Code went quiet five minutes ago.
  mutate(paths, () => new Date(), (l, emit) => { l.tasks[0]!.run!.startedAt = new Date(Date.now() - 10 * 60_000).toISOString(); emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'human:test', data: {} }); });
  writeFileSync(join(claude.dir, 'down'), '');
  const first = acc(repo, ['show', 'T-1'], env);
  assert.doesNotMatch(first.out, /can't see this builder/, 'the first look without an answer starts the clock');
  writeFileSync(join(paths.stateDir, 'agents-silent.json'), JSON.stringify({ since: Date.now() - 5 * 60_000 }));
  const blind = acc(repo, ['show', 'T-1'], env);
  assert.match(blind.out, /T-1 {2}! Needs you/);
  assert.match(blind.out, /Claude Code's background sessions aren't answering, so the Command Center can't see this builder\. Open a terminal and check that Claude Code lists its background agents, or restart Claude Code\. In a terminal: claude agents/);
  assert.equal(acc(repo, ['show', 'T-1', '--json'], env).json().unseen, 'unanswered');
  rmSync(join(claude.dir, 'down'));
  const back = acc(repo, ['show', 'T-1'], env);
  assert.doesNotMatch(back.out, /can't see this builder/, 'it answered again');
  assert.match(back.out, /T-1 {2}.*Running/);
  // A builder that didn't start: its line names the way on.
  mutate(paths, () => new Date(), (l, emit) => { const t = l.tasks[0]!; t.state = 'todo'; t.notStarted = { at: new Date().toISOString(), by: 'human:test', reason: NOT_STARTED, where: 'local' }; emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'human:test', data: {} }); });
  assert.match(acc(repo, ['show', 'T-1'], env).out, /! Its builder didn't start: Claude Code's background sessions aren't answering\. Build it again: acc dispatch T-1 --again/);
});

test('acc dispatch --again refuses a pick of its own and a task with nothing to dispatch again (T-92)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE }));
  assert.equal(acc(repo, ['add', 'Write the changelog']).code, 0);
  assert.match(acc(repo, ['dispatch', 'T-1', '--again', '--model', 'claude-opus-5-5']).err, /--again starts it with the model, effort and place it had/);
  assert.match(acc(repo, ['dispatch', 'T-1', '--again']).err, /dispatch it as usual/);
});

test('Dispatch again on a running builder acc can see is refused with the reason, and stops nothing (T-93)', () => {
  const s = setup(launchedSessions);
  s.go();
  const before = s.task();
  for (const unseen of [undefined, null] as const) {
    assert.throws(() => dispatchAgain(s.paths, s.config, 'T-1', s.deps, { actor: 'human', by: 'human:test', unseen }), (e: Error) => e.message === againRefusal('T-1'));
  }
  assert.ok(!s.calls.some((c) => c.startsWith('claude stop')), 'the working builder isn\'t stopped');
  assert.deepEqual(s.task().run, before.run, 'edge: its run is untouched');
  assert.equal(s.task().history.length, before.history.length, 'and nothing is recorded');
});

test('unseenNow judges just now: claude answering is seen, no answer past the grace is unanswered, an answer clears it (T-93)', () => {
  const s = setup(launchedSessions);
  s.go();
  const t0 = s.task();
  const started = Date.parse(t0.run!.startedAt!);
  const later = (min: number) => () => new Date(started + min * 60_000);
  assert.equal(unseenNow(s.paths, s.config, t0, { ...s.deps, now: later(30) }), null, 'it answers');
  const silent = fakeRunner({ 'claude agents --json': bad('connect ENOENT control.sock') });
  assert.equal(unseenNow(s.paths, s.config, t0, { ...s.deps, run: silent, now: later(20) }), null, 'edge: the first silence only starts the clock');
  assert.equal(unseenNow(s.paths, s.config, t0, { ...s.deps, run: silent, now: later(40) }), 'unanswered');
  assert.equal(unseenNow(s.paths, s.config, t0, { ...s.deps, run: silent, now: later(40) }, started + 25 * 60_000), 'unanswered', 'a clock the caller kept counts too');
  assert.equal(unseenNow(s.paths, s.config, t0, { ...s.deps, now: later(50) }), null, 'it answers again, and the silence ends');
  assert.equal(unseenNow(s.paths, s.config, { ...t0, state: 'done' }, s.deps), null, 'edge: a task that isn\'t running');
  unseenOf(s.paths, s.config, 'T-1', { ...s.deps, run: silent, now: later(51) });
  assert.equal(unseenOf(s.paths, s.config, 'T-1', { ...s.deps, run: silent, now: later(70) }), 'unanswered', 'by id');
  assert.equal(unseenOf(s.paths, s.config, 'T-9', s.deps), null, 'edge: no such task');
});

test('an earlier run\'s conversation in a reused worktree isn\'t this run\'s writing (T-93)', () => {
  const s = setup(launchedSessions);
  s.go();
  const t = s.task();
  const started = Date.parse(t.run!.startedAt!);
  const env = { CLAUDE_CONFIG_DIR: tempDir('claude-') };
  const dir = transcriptDir(join(env.CLAUDE_CONFIG_DIR, 'projects'), t.run!.worktree!);
  mkdirSync(dir, { recursive: true });
  const old = join(dir, 'earlier-run.jsonl');
  writeFileSync(old, '{}\n');
  utimesSync(old, new Date(started - 3_600_000), new Date(started - 3_600_000));
  const asTask = { ...t, run: { ...t.run!, sessionId: undefined } };
  assert.equal(runWrittenAt(asTask, env), null, 'only an older conversation: nothing written by this run');
  const fresh = join(dir, 'this-run.jsonl');
  writeFileSync(fresh, '{}\n');
  assert.ok((runWrittenAt(asTask, env) ?? 0) >= started, 'this run\'s own conversation counts');
  assert.equal(unseenFrom(asTask as never, s.config, { silentSince: null, now: new Date(), resuming: false, env }), null, 'edge: nothing is read while claude answers');
});

test('findSession and sessionsOf both drop a same-named session with no start time once the run has one (T-93)', () => {
  const name = 'Tool · T-1 · builder';
  const listed = [{ id: 'old', sessionId: 's-old', name, kind: 'background', cwd: '/w', pid: 4 }, { id: 'new', sessionId: 's-new', name, kind: 'background', cwd: '/w', startedAt: Date.now(), pid: 5 }];
  const runner = fakeRunner({ 'claude agents --json': ok(JSON.stringify(listed)) });
  const found = findSession(runner, '/w', name, 0, { since: Date.now() - 60_000 });
  assert.deepEqual(found, { bgId: 'new', sessionId: 's-new', pid: 5 });
  const only = findSession(fakeRunner({ 'claude agents --json': ok(JSON.stringify(listed.slice(0, 1))) }), '/w', name, 0, { since: Date.now() - 60_000 });
  assert.equal(only.bgId, null, 'an undated old session alone is no session of this run');
  const task = { id: 'T-1', run: { name, startedAt: new Date().toISOString() } as never };
  assert.deepEqual(sessionsOf(task, listed as never).map((x) => x.id), ['new']);
  assert.deepEqual(sessionsOf({ id: 'T-1', run: { name } as never }, listed as never).map((x) => x.id), ['old', 'new'], 'edge: a run with no start time keeps both');
});

// ---------------------------------------------------------------- no claude at all (T-94)

test('askAgents: exit 127 is no claude, a timeout or another failure is only no answer, and an answer lists the sessions (T-94)', () => {
  assert.deepEqual(askAgents(fakeRunner({}), '/'), { sessions: null, missing: true }, 'no claude: the runner\'s 127');
  assert.deepEqual(askAgents(fakeRunner({ 'claude agents --json': { code: 127, stdout: '', stderr: 'stopped', timedOut: true } }), '/'), { sessions: null, missing: false }, 'edge: a timeout is no answer, not a missing claude');
  assert.deepEqual(askAgents(fakeRunner({ 'claude agents --json': bad('connect ENOENT control.sock') }), '/'), { sessions: null, missing: false });
  assert.deepEqual(askAgents(fakeRunner({ 'claude agents --json': ok('[]') }), '/'), { sessions: [], missing: false });
  assert.deepEqual(askAgents(fakeRunner({ 'claude agents --json': ok('not json') }), '/'), { sessions: null, missing: false }, 'edge: an answer it can\'t read');
});

test('unseenNow judges from sessions it is given, asking claude nothing, and unseenOf says missing with no claude (T-94)', () => {
  const s = setup(launchedSessions);
  s.go();
  const t0 = s.task();
  const started = Date.parse(t0.run!.startedAt!);
  const later = (min: number) => () => new Date(started + min * 60_000);
  const calls: string[] = [];
  const counting = fakeRunner({}, calls);
  assert.equal(unseenNow(s.paths, s.config, t0, { ...s.deps, run: counting, now: later(30) }, null, []), null, 'given an answer, it is seen');
  unseenNow(s.paths, s.config, t0, { ...s.deps, run: counting, now: later(31) }, null, null);
  assert.equal(unseenNow(s.paths, s.config, t0, { ...s.deps, run: counting, now: later(50) }, null, null), 'unanswered', 'given no answer, past the grace');
  assert.deepEqual(calls, [], 'claude was never asked');
  assert.equal(unseenOf(s.paths, s.config, 'T-1', { ...s.deps, run: fakeRunner({}), now: later(51) }), 'missing');
  // Edge cases: a task Dispatch again wouldn't start a builder for here asks nothing.
  const asked: string[] = [];
  mutate(s.paths, () => new Date(), (l, emit) => { l.tasks[0]!.run!.where = 'cloud'; emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'human:test', data: {} }); });
  assert.equal(unseenOf(s.paths, s.config, 'T-1', { ...s.deps, run: fakeRunner({}, asked) }), null, 'a cloud builder');
  assert.equal(unseenOf(s.paths, s.config, 'T-9', { ...s.deps, run: fakeRunner({}, asked) }), null, 'no such task');
  assert.deepEqual(asked, []);
});

test('Dispatch again with no claude is refused in the Command Center\'s words, for a running task and one that didn\'t start, and stops nothing (T-94)', () => {
  const s = setup(launchedSessions);
  s.go();
  const before = s.task();
  assert.match(MISSING_WORDS, /^Claude Code isn't on this Mac's path, so the Command Center can't see this builder, and Build it again needs it to start another\. Install Claude Code/);
  assert.throws(() => dispatchAgain(s.paths, s.config, 'T-1', s.deps, { actor: 'human', by: 'human:test', unseen: 'missing' }), (e: Error) => e.message === MISSING_WORDS);
  assert.ok(!s.calls.some((c) => c.startsWith('claude stop')), 'nothing is stopped');
  assert.equal(s.task().history.length, before.history.length, 'and nothing is recorded');
  mutate(s.paths, () => new Date(), (l, emit) => { const t = l.tasks[0]!; t.state = 'todo'; t.notStarted = { at: new Date().toISOString(), by: 'human:test', reason: NOT_STARTED, where: 'local' }; emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'human:test', data: {} }); });
  assert.equal(unseenOf(s.paths, s.config, 'T-1', { ...s.deps, run: fakeRunner({}) }), 'missing', 'a builder that didn\'t start asks too');
  assert.throws(() => dispatchAgain(s.paths, s.config, 'T-1', s.deps, { actor: 'human', by: 'human:test', unseen: 'missing' }), (e: Error) => e.message === MISSING_WORDS);
});

test('acc dispatch --again with no claude on the path refuses with the missing words (T-94)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE }));
  const claude = fakeClaude();
  const home = trustingHome(repo);
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: home, CLAUDE_CONFIG_DIR: home };
  assert.equal(acc(repo, ['add', 'Write the changelog'], env).code, 0);
  assert.equal(acc(repo, ['dispatch', 'T-1'], env).code, 0);
  // The path without any claude: the stand-in's folder and every folder that holds one are left out.
  const bare = (process.env.PATH ?? '').split(':').filter((d) => d && !existsSync(join(d, 'claude'))).join(':');
  const r = acc(repo, ['dispatch', 'T-1', '--again'], { ...env, PATH: bare });
  assert.notEqual(r.code, 0);
  assert.ok(r.err.includes(MISSING_WORDS), r.err);
  assert.equal(readLedger(repoPaths(repo, run).ledger).tasks[0]!.state, 'running', 'it stays running');
});
