// A builder that never started (T-92): the dispatch proves it started, or leaves the task at Needs you and
// stops what half-started; "can't tell" is a state of its own; Dispatch again; and stale sessions don't count.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { AGAIN_REASON, dispatchAgain } from '../src/again.ts';
import { nextStep } from '../src/autopilot-rules.ts';
import { parseConfig } from '../src/config.ts';
import { dispatch } from '../src/dispatch.ts';
import { run, type RunResult } from '../src/exec.ts';
import { builderStopped, displayState, mutate, readLedger, RUN_SLACK_MS, sessionsOf, type Task, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { listSessions } from '../src/resume.ts';
import { awaitStart, builderUnseen, DISPATCH_AGAIN, noteAnswer, NOT_STARTED, quietMs, SERVICE_DOWN, START_WAIT_MS, transcriptWrittenAt, UNSEEN_WORDS } from '../src/started.ts';
import { transcriptDir } from '../src/transcript.ts';
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
  const r = dispatchAgain(s.paths, s.config, 'T-1', s.deps, { actor: 'human', by: 'human:test' });
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
  assert.match(UNSEEN_WORDS.unanswered.wayOn, /claude agents.*restart Claude Code/);
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
  assert.deepEqual(sessionsOf({ id: 'T-1', run }, [old, fresh, undated]).map((s) => s.id), ['bg-new', 'bg-?']);
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
  assert.match(blind.out, /Claude Code's background sessions aren't answering, so acc can't see this builder\. Open a terminal and run claude agents, or restart Claude Code\./);
  assert.equal(acc(repo, ['show', 'T-1', '--json'], env).json().unseen, 'unanswered');
  rmSync(join(claude.dir, 'down'));
  const back = acc(repo, ['show', 'T-1'], env);
  assert.doesNotMatch(back.out, /can't see this builder/, 'it answered again');
  assert.match(back.out, /T-1 {2}.*Running/);
  // A builder that didn't start: its line names the way on.
  mutate(paths, () => new Date(), (l, emit) => { const t = l.tasks[0]!; t.state = 'todo'; t.notStarted = { at: new Date().toISOString(), by: 'human:test', reason: NOT_STARTED, where: 'local' }; emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'human:test', data: {} }); });
  assert.match(acc(repo, ['show', 'T-1'], env).out, /! Its builder didn't start: Claude Code's background sessions aren't answering\. Dispatch again: acc dispatch T-1 --again/);
});

test('acc dispatch --again refuses a pick of its own and a task with nothing to dispatch again (T-92)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE }));
  assert.equal(acc(repo, ['add', 'Write the changelog']).code, 0);
  assert.match(acc(repo, ['dispatch', 'T-1', '--again', '--model', 'claude-opus-5-5']).err, /--again starts it with the model, effort and place it had/);
  assert.match(acc(repo, ['dispatch', 'T-1', '--again']).err, /dispatch it as usual/);
});
