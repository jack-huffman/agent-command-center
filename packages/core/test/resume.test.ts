import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { awakePath } from '../src/awake.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { run, type RunResult } from '../src/exec.ts';
import { remindedPath } from '../src/hooks.ts';
import { autopilotFailure, type ClaudeSession, displayState, type LedgerEvent, mutate, readLedger, type Run, type State, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { endResume, type Launcher, resume, resumeCommand, resumeMessage, resuming, resumingPath } from '../src/resume.ts';
import { transcriptDir } from '../src/transcript.ts';
import { bad, fakeAwake, fakeRunner, GENERIC_CONFIG, gh41Lines, gitIn, makeRepo, ok, SLEPT, tempDir } from './support.ts';

const now = () => new Date('2026-10-05T23:58:36Z');
const SID = '5018b73a-d2ee-4571-8068-80020e554d32';
const RAW = { ...GENERIC_CONFIG, agents: { builder: { model: 'opus', effort: 'medium' } } };
/** A pid no process has: what the stand-in launcher says the resumed claude got. */
const PID = 4_000_001;

/** GH-41 after the Mac slept: running, its background session blocked with no process, its transcript ending in the API error. */
function setup(o: { state?: State; sessionId?: string | null; sessions?: ClaudeSession[] | null; run?: Partial<Run> } = {}) {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(RAW) });
  // This clone's own effort wins over the project's (D-036).
  gitIn(dir, 'config', 'acc.builder.effort', 'high');
  const config = parseConfig(RAW).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'github', key: '#41', url: 'https://github.com/acme/tool/issues/41' }, title: 'Ticket updates are drafts' }], 'human', 'human:test', emit, now);
    const t = l.tasks[0]!;
    t.state = o.state ?? 'running';
    t.run = { bgId: '5018b73a', ...(o.sessionId === null ? {} : { sessionId: o.sessionId ?? SID }), worktree: dir, branch: 'main', startedAt: '2026-10-05T21:52:13Z', ...o.run };
  });
  const projects = tempDir('projects-');
  mkdirSync(transcriptDir(projects, dir), { recursive: true });
  writeFileSync(join(transcriptDir(projects, dir), `${SID}.jsonl`), gh41Lines(SID, dir).join('\n') + '\n');
  const sessions = o.sessions === undefined ? [{ id: '5018b73a', sessionId: SID, kind: 'background', name: 'GH-41', cwd: dir, state: 'blocked' }] : o.sessions;
  const calls: string[] = [];
  const fixtures: Record<string, RunResult> = { 'claude agents --json': sessions ? ok(JSON.stringify(sessions)) : bad('claude agents timed out'), 'claude stop 5018b73a': ok('stopped 5018b73a') };
  const launched: { cmd: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; log: string }[] = [];
  const launch: Launcher = (cmd, args, l) => { launched.push({ cmd, args, ...l }); return PID; };
  const awake = fakeAwake();
  const deps = { run: fakeRunner(fixtures, calls), now, env: { PATH: '/usr/bin', HOME: '/home/me' }, accBinDir: '/acc/bin', accCommand: 'acc', launch, projectsDir: projects, awake: awake.deps };
  return { dir, config, paths, calls, launched, awake, deps, head: gitIn(dir, 'log', '-1', '--format=%h') };
}

const events = (file: string): LedgerEvent[] => readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('Resume carries the session on in its folder, with the rules it was dispatched with and this clone\'s model and effort (D-067)', () => {
  const s = setup();
  const r = resume(s.paths, s.config, 'GH-41', s.deps, { actor: 'human', by: 'human:jack' });
  assert.equal(s.launched.length, 1);
  const l = s.launched[0]!;
  assert.equal(l.cmd, 'claude');
  assert.equal(l.cwd, s.dir, 'in the folder its conversation is saved under (D-046)');
  assert.deepEqual(l.args.slice(0, 1), ['-p']);
  assert.equal(l.args[1], r.message);
  assert.deepEqual(l.args.slice(2, 10), ['--resume', SID, '--permission-mode', 'acceptEdits', '--model', 'opus', '--effort', 'high']);
  assert.equal(l.args.at(-2), '--settings');
  const settings = JSON.parse(l.args.at(-1)!);
  assert.deepEqual([settings.env.ACC_ROLE, settings.env.ACC_TASK, settings.env.PATH], ['builder', 'GH-41', '/acc/bin:/usr/bin']);
  assert.ok(settings.permissions.deny.includes('Bash(acc resume*)'), 'a builder can\'t resume itself, or anyone');
  assert.ok(settings.hooks, 'its questions still come to the Command Center');
  assert.deepEqual([l.env.ACC_ROLE, l.env.ACC_TASK, l.env.HOME], ['builder', 'GH-41', '/home/me']);
  assert.equal(l.log, join(s.paths.logs, 'GH-41.resume.log'));
  assert.match(readFileSync(l.log, 'utf8'), /GH-41 resumed by human:jack/);
  // What it last said, read from its transcript.
  assert.equal(r.said, SLEPT);
  assert.equal(r.stopped, null, 'a background session with no process has nothing to stop');
  // The Mac stays awake while the resumed claude lives.
  assert.deepEqual(s.awake.spawned, [['caffeinate', '-i', '-w', String(PID)]]);
  assert.equal(JSON.parse(readFileSync(awakePath(s.paths, 'GH-41'), 'utf8')).watch, PID);
});

test('a resume is written down: the marker, the run\'s resumes, an event, and the Stop hook\'s reminder cleared', () => {
  const s = setup();
  mkdirSync(join(s.paths.stateDir, 'hooks'), { recursive: true });
  writeFileSync(remindedPath(s.paths.stateDir, SID), 'reminded');
  resume(s.paths, s.config, 'GH-41', s.deps, { actor: 'human', by: 'human:jack' });
  assert.deepEqual(JSON.parse(readFileSync(resumingPath(s.paths, 'GH-41'), 'utf8')), { sessionId: SID, pid: PID, startedAt: now().toISOString(), by: 'human:jack', log: join(s.paths.logs, 'GH-41.resume.log') });
  assert.equal(existsSync(remindedPath(s.paths.stateDir, SID)), false, 'the resumed turn is reminded of the finish line too');
  const t = readLedger(s.paths.ledger).tasks[0]!;
  assert.deepEqual(t.run?.resumes, [{ at: now().toISOString(), actor: 'human', by: 'human:jack' }]);
  assert.equal(t.state, 'running');
  const e = events(s.paths.events).at(-1)!;
  assert.deepEqual([e.type, e.by, e.data], ['task.updated', 'human:jack', { resumed: { said: SLEPT } }]);
  // Its process gone, it isn't resuming any more; while it lives, it is.
  assert.equal(resuming(s.paths, 'GH-41'), null);
  writeFileSync(resumingPath(s.paths, 'GH-41'), JSON.stringify({ sessionId: SID, pid: process.pid, startedAt: now().toISOString(), by: 'human:jack', log: 'x' }));
  assert.equal(resuming(s.paths, 'GH-41')?.pid, process.pid);
});

test('a resume clears autopilot\'s failed resume, so the task stops needing you while its builder works (D-055)', () => {
  const s = setup();
  mutate(s.paths, now, (l, emit) => {
    const failed = { step: 'resume' as const, sha: s.head, state: 'running' as const, reason: 'its background session wouldn\'t stop', at: now().toISOString() };
    l.tasks[0]!.autopilot = { failed };
    emit({ type: 'task.updated', task: 'GH-41', actor: 'orchestrator', by: 'orchestrator:autopilot', data: { autopilot: { failed } } });
  });
  const before = readLedger(s.paths.ledger);
  assert.equal(displayState(before, before.tasks[0]!), 'needs-you', 'autopilot couldn\'t resume it');
  resume(s.paths, s.config, 'GH-41', s.deps, { actor: 'human', by: 'human:jack' });
  const after = readLedger(s.paths.ledger);
  const t = after.tasks[0]!;
  assert.equal(t.autopilot?.failed, null);
  assert.equal(autopilotFailure(t), null);
  assert.equal(displayState(after, t), 'running', 'done by hand, it clears what autopilot couldn\'t do');
});

test('an idle background session with a process is stopped first, so the conversation runs in one place (D-060)', () => {
  const s = setup({ sessions: [{ id: '5018b73a', sessionId: SID, kind: 'background', name: 'GH-41', pid: 31337, state: 'done', status: 'idle' }] });
  const r = resume(s.paths, s.config, 'GH-41', s.deps, { actor: 'human', by: 'human:jack' });
  assert.equal(r.stopped, '5018b73a');
  const stop = s.calls.indexOf('claude stop 5018b73a');
  assert.ok(stop > s.calls.indexOf('claude agents --json'), 'it looks, then stops');
  assert.equal(s.launched.length, 1);
});

test('Resume refuses unless the task is running, with a session, its worktree, and nothing carrying it on', () => {
  const refuse = (s: ReturnType<typeof setup>, pattern: RegExp, code = 'refused') => {
    assert.throws(() => resume(s.paths, s.config, 'GH-41', s.deps, { actor: 'human', by: 'human:jack' }), (e: Error & { code?: string }) => {
      assert.match(e.message, pattern);
      assert.equal(e.code, code);
      return true;
    });
    assert.equal(s.launched.length, 0, 'nothing started');
  };
  refuse(setup({ state: 'review' }), /GH-41 is review\. Only a running task's builder is resumed\./);
  refuse(setup({ sessionId: null }), /has no session to carry on/);
  refuse(setup({ sessions: [{ id: '5018b73a', sessionId: SID, kind: 'background', pid: 9, state: 'working', status: 'busy' }] }), /GH-41's agent is still working\./, 'agent-active');
  refuse(setup({ sessions: [{ id: '5018b73a', sessionId: SID, kind: 'background', pid: 9, state: 'blocked', status: 'waiting' }] }), /waiting for you in its own prompt/, 'agent-active');
  refuse(setup({ sessions: [{ sessionId: SID, kind: 'interactive', pid: 9, status: 'idle' }] }), /open in a terminal or a Claude Code tab/, 'agent-active');
  refuse(setup({ sessions: null }), /claude agents didn't answer/);
  const s = setup();
  mkdirSync(join(s.paths.stateDir, 'resumes'), { recursive: true });
  writeFileSync(resumingPath(s.paths, 'GH-41'), JSON.stringify({ sessionId: SID, pid: process.pid, startedAt: now().toISOString(), by: 'human:jack', log: 'x' }));
  refuse(s, /already being resumed/);
});

test('two Resumes at once start one claude: the first claims the marker before it looks at anything; a refusal or a dead claim leaves nothing in the way', () => {
  const s = setup();
  let second: Error | null = null;
  const launch: Launcher = (cmd, args, l) => {
    // Autopilot's pass, or a second window, while the first is between its check and its launch.
    try { resume(s.paths, s.config, 'GH-41', s.deps, { actor: 'orchestrator', by: 'orchestrator:autopilot' }); } catch (e) { second = e as Error; }
    s.launched.push({ cmd, args, ...l });
    return PID;
  };
  resume(s.paths, s.config, 'GH-41', { ...s.deps, launch }, { actor: 'human', by: 'human:jack' });
  assert.match(second!.message, /GH-41 is already being resumed \(pid \d+\)\./);
  assert.equal(s.launched.length, 1, 'one conversation, run once');
  assert.equal(JSON.parse(readFileSync(resumingPath(s.paths, 'GH-41'), 'utf8')).pid, PID, 'the launched claude holds the marker now');

  const refused = setup({ sessions: null });
  assert.throws(() => resume(refused.paths, refused.config, 'GH-41', refused.deps, { actor: 'human', by: 'human:jack' }), /claude agents didn't answer/);
  assert.equal(existsSync(resumingPath(refused.paths, 'GH-41')), false, 'a refusal gives its claim back');

  const stale = setup();
  mkdirSync(join(stale.paths.stateDir, 'resumes'), { recursive: true });
  writeFileSync(resumingPath(stale.paths, 'GH-41'), JSON.stringify({ sessionId: SID, pid: PID + 1, startedAt: now().toISOString(), by: 'human:jack', log: 'x' }));
  resume(stale.paths, stale.config, 'GH-41', stale.deps, { actor: 'human', by: 'human:jack' });
  assert.equal(stale.launched.length, 1, 'a claim whose process has gone is taken over');
});

test('a resume that can\'t be recorded is ended, and leaves nothing behind', () => {
  const s = setup();
  const launch: Launcher = (cmd, args, l) => {
    s.launched.push({ cmd, args, ...l });
    // A person moved it meanwhile.
    mutate(s.paths, now, (led, emit) => { led.tasks[0]!.state = 'blocked'; emit({ type: 'task.updated', task: 'GH-41', actor: 'human', by: 'human:test', data: {} }); });
    return PID;
  };
  assert.throws(() => resume(s.paths, s.config, 'GH-41', { ...s.deps, launch }, { actor: 'human', by: 'human:jack' }), /left running meanwhile/);
  assert.equal(existsSync(resumingPath(s.paths, 'GH-41')), false);
  assert.equal(existsSync(awakePath(s.paths, 'GH-41')), false);
  assert.equal(endResume(s.paths, 'GH-41'), false, 'nothing left to end');
});

test('the ready message names the task, quotes what it last said, names its latest commit, and ends with the finish line', () => {
  const m = resumeMessage({ id: 'GH-41', title: 'Ticket updates are drafts' }, `${SLEPT}\n`, 'af9971f');
  assert.match(m, /^You are the builder for GH-41: Ticket updates are drafts\. Your last turn ended before you ran acc done or acc block, so GH-41 is still running\./);
  assert.ok(m.includes(`> ${SLEPT}`));
  assert.match(m, /If you were cut off, carry on from where you left off\. If you stopped to ask something, decide it yourself where the task allows, or block and ask\./);
  assert.match(m, /Start with `git status` and `git log --oneline -3` \(your branch's latest commit is af9971f\), then finish the task and its finish line: commit everything, run exactly `acc gate run`, then run exactly `acc done`\. If you're stuck, run exactly `acc block "<what you need>"` and stop\.$/);
  const bare = resumeMessage({ id: 'GH-41', title: 'Ticket updates are drafts' }, null, null);
  assert.doesNotMatch(bare, /^> /m, 'no quote without words');
  assert.doesNotMatch(bare, /The last thing you said/);
  assert.doesNotMatch(bare, /latest commit is/);
});

test('the command is the same for a resume and a reply: claude -p <message> --resume <session> with the builder\'s settings', () => {
  const s = setup();
  const task = readLedger(s.paths.ledger).tasks[0]!;
  const c = resumeCommand(task, s.config, { sessionId: SID, message: 'Carry on.', accBinDir: '/acc/bin', basePath: '/usr/bin' });
  assert.deepEqual(c.args.slice(0, 8), ['-p', 'Carry on.', '--resume', SID, '--permission-mode', 'acceptEdits', '--model', 'opus']);
  assert.deepEqual(c.args.slice(8, 10), ['--effort', 'medium'], 'the project\'s effort: the clone\'s is merged in by whoever calls it (withCloneAgents)');
  assert.deepEqual(c.env, { ACC_ROLE: 'builder', ACC_TASK: 'GH-41' });
  assert.equal(JSON.parse(c.args.at(-1)!).hooks, undefined, 'no hooks without a way to run acc');
  assert.equal(c.model, 'opus');
});

test('a model picked for the task carries on in a resume and a reply, over the builder\'s, and the run records it (D-???)', () => {
  const s = setup({ run: { model: 'sonnet', modelPicked: true } });
  const task = readLedger(s.paths.ledger).tasks[0]!;
  // D-060's reply to a builder runs this same command.
  const c = resumeCommand(task, s.config, { sessionId: SID, message: 'Carry on.', accBinDir: '/acc/bin', basePath: '/usr/bin' });
  assert.deepEqual(c.args.slice(6, 10), ['--model', 'sonnet', '--effort', 'medium'], 'the pick, with the builder\'s effort');
  resume(s.paths, s.config, 'GH-41', s.deps, { actor: 'human', by: 'human:jack' });
  assert.deepEqual(s.launched[0]!.args.slice(6, 10), ['--model', 'sonnet', '--effort', 'high']);
  const run = readLedger(s.paths.ledger).tasks[0]!.run!;
  assert.deepEqual([run.model, run.modelPicked], ['sonnet', true]);
});

test('a task nobody picked a model for resumes with the builder\'s model as it is now, and the run records it (D-???)', () => {
  const s = setup({ run: { model: 'haiku' } });
  resume(s.paths, s.config, 'GH-41', s.deps, { actor: 'human', by: 'human:jack' });
  assert.deepEqual(s.launched[0]!.args.slice(6, 8), ['--model', 'opus'], 'the project\'s, not the one it was started with');
  const run = readLedger(s.paths.ledger).tasks[0]!.run!;
  assert.equal(run.model, 'opus');
  assert.equal(run.modelPicked, undefined);
  const c = resumeCommand({ ...readLedger(s.paths.ledger).tasks[0]!, run: {} }, parseConfig(GENERIC_CONFIG).config!, { sessionId: SID, message: 'Carry on.', accBinDir: '/acc/bin', basePath: '/usr/bin' });
  assert.deepEqual(c.args.slice(6, 8), ['--model', 'claude-opus-5-5'], 'acc\'s default when nobody chose one');
});
