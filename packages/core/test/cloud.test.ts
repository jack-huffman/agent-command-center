// Cloud builders (GH-69): what a project needs, the routine's token and fire, the finish marker, the fire's
// text, a cloud dispatch's choice and refusals, and acc following a branch on a fake GitHub (a bare origin)
// from fired to collected, with the main-moved notice. Off by default: a project that hasn't opted in sees
// no change, and a local dispatch passes exactly the arguments it did before.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { branchMoves, clearBranchMoves, followBranches, knownMerges, moveUrl, moveWords, readBranches, squashOf, unexplained } from '../src/branches.ts';
import { BLOCKED_TRAILER, CLOUD_TOKEN_ENV, cloudChecks, cloudNeeds, cloudOffered, cloudQuiet, cloudReason, cloudText, cloudWait, collect, DONE_TRAILER, fireRoutine, followCloud, parseFinish, readCloudToken, remoteHead, ROUTINE_BETA, writeCloudToken } from '../src/cloud.ts';
import { GUARD_PATH, installGuard, RECORD_LINE } from '../src/cloud-guard.ts';
import { parseConfig } from '../src/config.ts';
import { builderPlace, dispatch } from '../src/dispatch.ts';
import { run } from '../src/exec.ts';
import { builders, checkMove, emptyLedger, mutate, noGateHooks, readLedger, sessionsOf, type Task, upsertTasks } from '../src/ledger.ts';
import { machineCapWords, setMachineAgents } from '../src/limits.ts';
import { renderPacket } from '../src/packet.ts';
import { repoPaths } from '../src/paths.ts';
import { branchProtection, environmentProtection, protectionWarnings } from '../src/protection.ts';
import { sync } from '../src/sync.ts';
import { bad, fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, ok, tempDir } from './support.ts';

const now = () => new Date('2026-10-09T12:00:00Z');
const CLOUD = { routine: 'trig_01ABCDEFGHJKLMNOPQRSTUVW', default: 'local' as const, quietMinutes: 120, max: 3 };
/** A generic project on GitHub that opted in, with no checks, so a collect needs none (GH-103 off). */
const RAW = { ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'acme-bot' }, commitIdentity: { name: 'Acme Bot', email: 'bot@example.com' }, agents: { max: 2, cloud: CLOUD }, strayFiles: { required: false } };
const cfg = (raw: Record<string, unknown> = RAW) => parseConfig(JSON.parse(JSON.stringify(raw))).config!;
const FIRED = JSON.stringify({ type: 'routine_fire', claude_code_session_id: 'session_01TEST', claude_code_session_url: 'https://claude.ai/code/session_01TEST' });
/** The commands a cloud dispatch runs besides git: claude's sign-in, the keychain, and curl's fire. */
const CLOUD_FIXTURES = {
  'claude auth status': ok(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'me@example.com' })),
  'security find-generic-password': ok('tok_0123456789abcdefghij\n'),
  curl: ok(`${FIRED}\n200`),
};

/**
 * A repo whose origin is a local bare repo, as a dispatch leaves it: the config committed, T-1 to do. A
 * second clone stands in for the cloud session, which pushes to origin.
 */
function repoWithOrigin(raw: Record<string, unknown> = RAW, opts: { guard?: boolean } = {}) {
  const origin = join(tempDir('origin-'), 'repo.git');
  run('git', ['init', '-q', '--bare', origin]);
  const root = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(raw, null, 2), '.gitignore': '.claude/worktrees/\n' }));
  // The push guard, committed as acc cloud enable leaves it to commit (GH-69): the cloud loads it from the commit.
  if (opts.guard !== false) {
    installGuard(root);
    gitIn(root, 'add', '-A');
    gitIn(root, 'commit', '-q', '-m', 'the push guard');
  }
  gitIn(root, 'remote', 'add', 'origin', origin);
  gitIn(root, 'push', '-q', '-u', 'origin', 'main');
  gitIn(root, 'remote', 'set-head', 'origin', 'main');
  const config = cfg(raw);
  const paths = repoPaths(root, run);
  mutate(paths, now, (l, emit) => upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'A thing', brief: 'Do it.' }], 'human', 'h', emit, now));
  return { root, origin, config, paths };
}

/** The cloud session's clone: it checks the task branch out, commits, and pushes it, as the session does. */
function cloudClone(origin: string, branch: string): string {
  const dir = tempDir('cloud-');
  run('git', ['clone', '-q', origin, dir]);
  gitIn(dir, 'config', 'user.name', 'Cloud');
  gitIn(dir, 'config', 'user.email', 'cloud@example.com');
  gitIn(dir, 'config', 'commit.gpgsign', 'false');
  gitIn(dir, 'switch', '-q', branch);
  return dir;
}

const commitAndPush = (dir: string, branch: string, file: string, message: string): string => {
  writeFileSync(join(dir, file), `${message}\n`);
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', message);
  gitIn(dir, 'push', '-q', 'origin', branch);
  return gitIn(dir, 'rev-parse', 'HEAD');
};

const task = (paths: ReturnType<typeof repoPaths>, id = 'T-1'): Task => readLedger(paths.ledger).tasks.find((t) => t.id === id)!;

// ---------------------------------------------------------------- off by default

test('off by default: a project with no agents.cloud offers no cloud, says why, and a plain dispatch is local (GH-69)', () => {
  const plain = cfg({ ...GENERIC_CONFIG, github: { repo: 'a/b', account: 'x' } });
  assert.equal(plain.agents.cloud, null);
  assert.equal(builderPlace(plain), 'local');
  assert.equal(cloudReason(cloudOffered(plain)), 'Cloud builders are off for this project: opt in under Settings');
  const noGithub = cfg(GENERIC_CONFIG);
  assert.equal(cloudReason(cloudOffered(noGithub)), 'Cloud builders need the repo on GitHub');
  const noRoutine = cfg({ ...RAW, agents: { cloud: { routine: null } } });
  assert.equal(cloudReason(cloudOffered(noRoutine)), 'Cloud builders need a routine for the repo: Setup says how');
  assert.equal(cloudReason(cloudOffered(cfg())), null);
  // The config's choice applies when no flag does, and a flag wins over it; local is never the cloud's default.
  assert.equal(builderPlace(cfg()), 'local');
  assert.equal(builderPlace(cfg({ ...RAW, agents: { cloud: { ...CLOUD, default: 'cloud' } } })), 'cloud');
  assert.equal(builderPlace(cfg({ ...RAW, agents: { cloud: { ...CLOUD, default: 'cloud' } } }), 'local'), 'local');
  assert.equal(builderPlace(cfg(), 'cloud'), 'cloud');
});

test('agents.cloud parses with its defaults, refuses bad values, and round-trips; a section that\'s there opts in even empty', () => {
  const c = cfg({ ...RAW, agents: { cloud: {} } });
  assert.deepEqual(c.agents.cloud, { routine: null, default: 'local', quietMinutes: 120, max: 3 });
  assert.deepEqual(cfg().agents.cloud, CLOUD);
  const errors = (cloud: unknown) => parseConfig({ ...RAW, agents: { cloud } }).errors;
  assert.match(errors({ routine: 'nope' }).join(' '), /agents\.cloud\.routine/);
  assert.match(errors({ default: 'mars' }).join(' '), /agents\.cloud\.default/);
  assert.match(errors({ quietMinutes: 1 }).join(' '), /agents\.cloud\.quietMinutes/);
  assert.match(errors({ max: 99 }).join(' '), /agents\.cloud\.max/);
  assert.match(errors('yes').join(' '), /"agents\.cloud" must be an object/);
});

test('the needs: the token comes from the environment or the keychain, and the sign-in from claude auth status', () => {
  const env = { [CLOUD_TOKEN_ENV]: 'tok_0123456789abcdefghij' };
  const calls: string[] = [];
  const r = fakeRunner(CLOUD_FIXTURES, calls);
  assert.equal(readCloudToken(r, 'acme/tool', env), 'tok_0123456789abcdefghij');
  assert.ok(!calls.some((c) => c.startsWith('security')), 'the environment\'s token needs no keychain');
  assert.equal(readCloudToken(r, 'acme/tool', {}), 'tok_0123456789abcdefghij');
  assert.ok(calls.some((c) => c === 'security find-generic-password -s acc-cloud-routine -a acme/tool -w'));
  assert.equal(readCloudToken(fakeRunner({ 'security find-generic-password': bad('not found', 44) }), 'acme/tool', {}), null);
  // Writing goes through security's own stdin, never the command line.
  const wrote: string[] = [];
  const w = fakeRunner({ 'security -i': (o) => { wrote.push(o?.input ?? ''); return ok(); } });
  writeCloudToken(w, 'acme/tool', 'tok_0123456789abcdefghij', {});
  assert.equal(wrote[0], 'add-generic-password -U -s "acc-cloud-routine" -a "acme/tool" -w "tok_0123456789abcdefghij"\n');
  assert.throws(() => writeCloudToken(w, 'acme/tool', 'short', {}), /doesn't look like a routine's API token/);
  const needs = cloudNeeds(cfg(), r, env);
  assert.deepEqual(needs.map((n) => [n.id, n.ok]), [['github', true], ['opted-in', true], ['routine', true], ['token', true], ['login', true]]);
  const apiKey = fakeRunner({ ...CLOUD_FIXTURES, 'claude auth status': ok(JSON.stringify({ loggedIn: true, authMethod: 'console' })) });
  const login = cloudNeeds(cfg(), apiKey, env).find((n) => n.id === 'login')!;
  assert.equal(login.ok, false);
  assert.match(login.fix, /cloud sessions need a claude\.ai account.*claude auth login/);
  assert.equal(cloudReason(cloudNeeds(cfg(), fakeRunner({ ...CLOUD_FIXTURES, 'security find-generic-password': bad() }), {})), 'Cloud builders need the routine\'s token: Setup says how');
});

test('the fire: curl posts the text with the beta headers from a file only this user can read, and the reply names the session', () => {
  const paths = { stateDir: tempDir('state-') };
  const calls: { args: string[]; headers: string; body: string }[] = [];
  const r = fakeRunner({
    curl: (o) => { void o; return ok(`${FIRED}\n200`); },
  });
  const recording: typeof r = (cmd, args, o) => {
    if (cmd === 'curl') {
      const h = args[args.indexOf('-H') + 1]!.slice(1);
      const b = args[args.indexOf('--data-binary') + 1]!.slice(1);
      calls.push({ args, headers: readFileSync(h, 'utf8'), body: readFileSync(b, 'utf8') });
    }
    return r(cmd, args, o);
  };
  const fired = fireRoutine(paths, recording, 'trig_01ABCDEFGHJKLMNOPQRSTUVW', 'tok_secret_0123456789', 'Build T-1.', {});
  assert.deepEqual(fired, { sessionId: 'session_01TEST', url: 'https://claude.ai/code/session_01TEST' });
  const c = calls[0]!;
  assert.ok(c.args.includes('https://api.anthropic.com/v1/claude_code/routines/trig_01ABCDEFGHJKLMNOPQRSTUVW/fire'));
  assert.ok(!c.args.some((a) => a.includes('tok_secret')), 'the token never goes on the command line');
  assert.match(c.headers, /^Authorization: Bearer tok_secret_0123456789\n/);
  assert.ok(c.headers.includes(`anthropic-beta: ${ROUTINE_BETA}`) && c.headers.includes('anthropic-version: 2023-06-01'));
  assert.deepEqual(JSON.parse(c.body), { text: 'Build T-1.' });
  assert.ok(!existsSync(c.args[c.args.indexOf('-H') + 1]!.slice(1)), 'the header file is removed once curl has answered');
  assert.throws(() => fireRoutine(paths, fakeRunner({ curl: ok('{"error":"unauthorized"}\n401') }), 'trig_01ABCDEFGHJKLMNOPQRSTUVW', 't', 'x', {}), /HTTP 401.*generate a new one/);
  assert.throws(() => fireRoutine(paths, fakeRunner({ curl: ok('{}\n429') }), 'trig_01ABCDEFGHJKLMNOPQRSTUVW', 't', 'x', {}), /hourly limit/);
  assert.throws(() => fireRoutine(paths, fakeRunner({ curl: ok('{"type":"routine_fire"}\n200') }), 'trig_01ABCDEFGHJKLMNOPQRSTUVW', 't', 'x', {}), /named no session/);
  assert.throws(() => fireRoutine(paths, fakeRunner({}), 'trig_01ABCDEFGHJKLMNOPQRSTUVW', 't', 'x', {}), /curl isn't on PATH/);
});

test('the finish marker: Acc-Done with the task\'s id, Acc-Blocked with a reason, and the note\'s trailers, a line each', () => {
  const done = parseFinish(`T-1: add the thing\n\nBody.\n\n${DONE_TRAILER}: T-1\nAcc-Landed: The thing\nAcc-Landed: And its test\nAcc-Moved: tests 3 → 5\nAcc-Open: none\n`, 'T-1');
  // "none" says there was nothing, as acc done takes it: an empty part.
  assert.deepEqual(done, { done: true, blocked: null, note: { landed: ['The thing', 'And its test'], moved: ['tests 3 → 5'], open: [] } });
  assert.equal(parseFinish(`${DONE_TRAILER}: T-2\n`, 'T-1').done, false, 'another task\'s marker isn\'t this one\'s');
  assert.equal(parseFinish('acc-done: t-1\n', 'T-1').done, true, 'case doesn\'t matter');
  const blocked = parseFinish(`WIP\n\n${BLOCKED_TRAILER}: Which queue takes the leftovers?\n`, 'T-1');
  assert.deepEqual(blocked, { done: false, blocked: 'Which queue takes the leftovers?', note: {} });
  assert.deepEqual(parseFinish('Just a commit\n\nRefs: #1\n', 'T-1'), { done: false, blocked: null, note: null });
});

test('the fire\'s text wraps the packet: the branch on GitHub, the checks by command, the ones only the Mac runs, and a finish line of trailers', () => {
  const sf = cfg({ ...RAW, profile: 'salesforce', environments: [{ name: 'Dev', type: 'developer', org: 'Acme Dev', default: true }], gates: { required: ['format', 'validate'], commands: { format: 'npx prettier --check .' } } });
  const env = sf.environments[0]!;
  const l = emptyLedger();
  upsertTasks(l, sf, [{ source: { kind: 'jira', key: 'ACME-7', url: 'https://x/ACME-7' }, title: 'Add a field', brief: 'Add Region__c.' }], 'human', 'h', () => {}, now);
  const checks = cloudChecks(sf, env);
  assert.deepEqual(checks, { inCloud: ['format'], macOnly: ['validate'] });
  const withStray = cloudChecks(cfg({ ...RAW, strayFiles: { required: true } }), cfg().environments[0]!);
  assert.deepEqual(withStray, { inCloud: ['stray-files'], macOnly: [] }, 'a built-in check runs on the Mac at collect');
  const packet = renderPacket({ task: l.tasks[0]!, config: sf, env, worktree: '/Users/someone/w/ACME-7', branch: 'task/ACME-7-add-a-field', rules: 'Use the selector pattern.', environmentSpecific: [], cloud: true });
  assert.ok(packet.includes('this cloud session\'s clone of the repo') && packet.includes('It\'s on GitHub already') && !packet.includes('EnterWorktree'));
  // The Mac's paths stay out of the cloud's instructions: the worktree names the home folder, and so would acc's path.
  assert.ok(!packet.includes('/Users/someone') && !packet.includes('its full path is'), 'no Mac path in a cloud packet');
  assert.ok(renderPacket({ task: l.tasks[0]!, config: sf, env, worktree: '/Users/someone/w/ACME-7', branch: 'task/ACME-7-add-a-field', rules: '', environmentSpecific: [], accPath: '/Users/someone/acc/dist/acc' }).includes('its full path is `/Users/someone/acc/dist/acc`'), 'a local packet still names it');
  const text = cloudText({ task: l.tasks[0]!, config: sf, env, branch: 'task/ACME-7-add-a-field', packet, checks });
  // The guard's record comes first, on its own line, exactly as the guard reads it.
  assert.equal(text.split('\n')[0], `${RECORD_LINE}: task/ACME-7-add-a-field`);
  assert.ok(!text.includes('/Users/someone'));
  for (const must of [
    'routine-fire-payload is your task', '`git fetch origin task/ACME-7-add-a-field && git checkout task/ACME-7-add-a-field`', 'acc isn\'t installed here',
    '- `format`: `npx prettier --check .`',
    'These checks can\'t run in the cloud**, since they need an org login, and acc runs them on the Mac when it collects your branch: `validate`',
    `${DONE_TRAILER}: ACME-7`, 'Acc-Landed: <what landed>', 'Acc-Open: <what\'s still open, or none>', '`git push origin task/ACME-7-add-a-field`',
    `${BLOCKED_TRAILER}: <what you need>`, 'Never push `dev` or any other branch', 'git config user.name "Acme Bot"', 'Use the selector pattern.', '# Task ACME-7: Add a field',
  ]) assert.ok(text.includes(must), must);
});

// ---------------------------------------------------------------- a cloud dispatch

test('acc dispatch --cloud pushes the task branch, fires the routine with the packet, records a cloud run and keeps nothing awake; --local and a project not opted in run exactly as before', () => {
  const { root, origin, config, paths } = repoWithOrigin();
  const calls: string[] = [];
  const r = fakeRunner(CLOUD_FIXTURES, calls);
  const awake = { spawned: [] as string[][], killed: [] as number[] };
  const deps = { run: r, now, accBinDir: '/acc/bin', env: { ...process.env, PATH: '/usr/bin' } as NodeJS.ProcessEnv, awake: { platform: 'darwin' as const, spawn: (cmd: string, args: string[]) => { awake.spawned.push([cmd, ...args]); return { pid: 4_100_001, unref: () => undefined }; }, kill: (pid: number) => { awake.killed.push(pid); } } };
  // --cloud with --foreground is a usage error, before anything is made.
  assert.throws(() => dispatch(paths, config, 'T-1', deps, { actor: 'human', by: 'h', where: 'cloud', foreground: true }), /--cloud or --foreground, not both/);
  assert.ok(!existsSync(join(root, '.claude', 'worktrees', 'T-1')));
  const out = dispatch(paths, config, 'T-1', deps, { actor: 'human', by: 'h', where: 'cloud' });
  assert.equal(out.held, false);
  if (out.held) return;
  assert.equal(out.where, 'cloud');
  assert.deepEqual(out.cloud, { sessionId: 'session_01TEST', url: 'https://claude.ai/code/session_01TEST' });
  assert.equal(out.bgId, null);
  // The branch went to origin before the fire, and only it: origin's main didn't move.
  assert.equal(run('git', ['rev-parse', 'refs/heads/task/T-1-a-thing'], { cwd: origin }).code, 0, 'the task branch is on origin');
  assert.equal(gitIn(origin, 'rev-parse', 'main'), gitIn(root, 'rev-parse', 'main'));
  const push = calls.findIndex((c) => c.startsWith('git push'));
  const fire = calls.findIndex((c) => c.startsWith('curl'));
  assert.ok(push >= 0 && fire > push, `push (${push}) before the fire (${fire})`);
  assert.ok(calls[push]!.endsWith('origin task/T-1-a-thing:task/T-1-a-thing'));
  assert.ok(!calls.some((c) => c.startsWith('claude --bg')), 'no local session');
  assert.deepEqual(awake.spawned, [], 'no caffeinate for a cloud builder (D-067)');
  const t = task(paths);
  assert.equal(t.state, 'running');
  assert.equal(t.run?.where, 'cloud');
  assert.equal(t.run?.cloud?.sessionId, 'session_01TEST');
  assert.equal(t.run?.cloud?.head, gitIn(root, 'rev-parse', 'task/T-1-a-thing'));
  assert.equal(t.run?.cloud?.lastPushAt, now().toISOString());
  assert.ok(t.run?.worktree && existsSync(t.run.worktree), 'the worktree is still made, for the work to land in');
  assert.deepEqual(sessionsOf(t, [{ id: 'x', kind: 'background', name: t.run!.name }]), [], 'no local session is ever its builder');
  // The cloud cap counts cloud runs, the local cap doesn't (GH-69).
  const l = readLedger(paths.ledger);
  assert.equal(builders(l, '', 'cloud'), 1);
  assert.equal(builders(l, ''), 0);
  // A second task to do can still go to this Mac, under agents.max; and the cloud cap refuses in its own words.
  mutate(paths, now, (ledger, emit) => upsertTasks(ledger, config, [{ source: { kind: 'manual', key: 'T-2' }, title: 'Another' }, { source: { kind: 'manual', key: 'T-3' }, title: 'Third' }], 'human', 'h', emit, now));
  const full = { ...config, agents: { ...config.agents, cloud: { ...config.agents.cloud!, max: 1 } } };
  const problems = checkMove(readLedger(paths.ledger), full, task(paths, 'T-2'), { to: 'running', actor: 'human', by: 'h', where: 'cloud' }, noGateHooks);
  assert.deepEqual(problems, ['1 cloud builder is running for this project, and its cap is 1 (agents.cloud.max).']);
  assert.deepEqual(checkMove(readLedger(paths.ledger), full, task(paths, 'T-2'), { to: 'running', actor: 'human', by: 'h' }, noGateHooks), []);
  const off = cfg({ ...RAW, agents: { max: 2 } });
  assert.deepEqual(checkMove(readLedger(paths.ledger), off, task(paths, 'T-2'), { to: 'running', actor: 'human', by: 'h', where: 'cloud' }, noGateHooks), ['This project hasn\'t opted in to cloud builders (agents.cloud).']);
  // Not opted in: --cloud is refused with every unmet need, and nothing is pushed or fired.
  const before = calls.length;
  assert.throws(() => dispatch(paths, off, 'T-2', deps, { actor: 'human', by: 'h', where: 'cloud' }), /Can't dispatch T-2 to the cloud:\n- The project has opted in: Cloud builders are off/);
  assert.ok(!calls.slice(before).some((c) => c.startsWith('git push') || c.startsWith('curl')));
  // A missing token or sign-in is refused the same way, naming it.
  assert.throws(() => dispatch(paths, config, 'T-2', { ...deps, run: fakeRunner({ ...CLOUD_FIXTURES, 'security find-generic-password': bad() }) }, { actor: 'human', by: 'h', where: 'cloud' }), /The routine's token is in this Mac's keychain: Generate the API trigger's token/);
  // GitHub's rules behind the guard: gh couldn't say here (no fixture signs it in), so the dispatch warned, and went on.
  assert.ok(out.warnings?.some((w) => /gh couldn't read main's protection: gh isn't logged in as acme-bot/.test(w) && /isn't known/.test(w)), `warned, didn't refuse: ${JSON.stringify(out.warnings)}`);
});

test('a cloud dispatch skips this machine\'s total, which counts this Mac\'s builders only; a local one still waits for it (GH-69, GH-111)', () => {
  const { paths, config } = repoWithOrigin();
  const env = { ...process.env, PATH: '/usr/bin', ACC_MACHINE_FILE: join(tempDir('machine-'), 'machine.json') } as NodeJS.ProcessEnv;
  setMachineAgents(1, env);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-2' }, title: 'Second' }, { source: { kind: 'manual', key: 'T-3' }, title: 'Third' }], 'human', 'h', emit, now);
    // One builder on this Mac already: the machine's total of 1 is reached.
    const t = l.tasks.find((x) => x.id === 'T-2')!;
    t.state = 'running';
    t.run = { worktree: '/w', branch: 'task/T-2-second' };
    emit({ type: 'task.updated', task: 'T-2', actor: 'human', by: 'h', data: {} });
  });
  const deps = { run: fakeRunner(CLOUD_FIXTURES), now, accBinDir: '/acc/bin', env, awake: { platform: 'darwin' as const, spawn: () => ({ pid: 4_100_003, unref: () => undefined }), kill: () => undefined } };
  assert.throws(() => dispatch(paths, config, 'T-1', deps, { actor: 'human', by: 'h', where: 'local' }), (e: Error & { code?: string }) => e.code === 'move-refused' && e.message.includes(machineCapWords(1, 1)), 'a local builder waits for the machine');
  const out = dispatch(paths, config, 'T-1', deps, { actor: 'human', by: 'h', where: 'cloud' });
  assert.equal(out.held, false, 'the cloud needs none of this Mac');
  assert.equal(task(paths).state, 'running');
});

test('a cloud dispatch refuses, pushing and firing nothing, unless the guard is committed on the branch the cloud clones and on the task branch; it reads the commits, not the files on disk', () => {
  // The repo never committed the guard: writing it on disk isn't enough.
  const { root, paths, config } = repoWithOrigin(RAW, { guard: false });
  installGuard(root);
  const calls: string[] = [];
  const deps = { run: fakeRunner(CLOUD_FIXTURES, calls), now, accBinDir: '/acc/bin', env: { ...process.env, PATH: '/usr/bin' } as NodeJS.ProcessEnv, awake: { platform: 'darwin' as const, spawn: () => ({ pid: 4_100_004, unref: () => undefined }), kill: () => undefined } };
  assert.throws(() => dispatch(paths, config, 'T-1', deps, { actor: 'human', by: 'h', where: 'cloud' }), (e: Error & { code?: string }) => e.code === 'cloud-unguarded' && /push guard isn't committed where the cloud session would load it. refs\/remotes\/origin\/main doesn't carry \.claude\/hooks\/acc-push-guard\.mjs: run acc cloud enable, commit/.test(e.message));
  assert.ok(!calls.some((c) => c.startsWith('git push') || c.startsWith('curl')), 'nothing pushed or fired');
  assert.equal(task(paths).state, 'todo');
  assert.equal(run('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/task/T-1-a-thing'], { cwd: root }).code, 0, 'the worktree and branch are kept');
  // Committed on main, but origin's main doesn't have it yet: the cloud clones origin's.
  gitIn(root, 'add', '-A');
  gitIn(root, 'commit', '-q', '-m', 'guard');
  assert.throws(() => dispatch(paths, config, 'T-1', deps, { actor: 'human', by: 'h', where: 'cloud' }), /refs\/remotes\/origin\/main doesn't carry/);
  gitIn(root, 'push', '-q', 'origin', 'main');
  // origin has it; the task branch, made before, doesn't: it started from the older main.
  assert.throws(() => dispatch(paths, config, 'T-1', deps, { actor: 'human', by: 'h', where: 'cloud' }), /refs\/heads\/task\/T-1-a-thing doesn't carry/);
  // Merged into the task branch, the dispatch goes.
  const wt = task(paths).run?.worktree ?? join(root, '.claude', 'worktrees', 'T-1');
  gitIn(wt, 'merge', '-q', 'main');
  const out = dispatch(paths, config, 'T-1', deps, { actor: 'human', by: 'h', where: 'cloud' });
  assert.equal(out.held, false);
  assert.ok(calls.some((c) => c.startsWith('git push')) && calls.some((c) => c.startsWith('curl')));
});

test('what GitHub enforces on a branch, through gh api: protection, a ruleset, none, not offered on the plan, or unknown; dispatch and Settings warn on all but enforced', () => {
  const page = (status: number, body: unknown) => ok(`HTTP/2.0 ${status} X\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}`);
  const upgrade = page(403, { message: 'Upgrade to GitHub Pro or make this repository public to enable this feature.' });
  const at = (fixtures: Record<string, ReturnType<typeof ok>>) => branchProtection(fakeRunner(fixtures), 'acme/tool', 'main', {});
  const protectedBranch = at({ 'gh api repos/acme/tool/branches/main/protection': page(200, { required_pull_request_reviews: {}, required_status_checks: {}, enforce_admins: { enabled: true }, allow_force_pushes: { enabled: false } }) });
  assert.deepEqual([protectedBranch.state, protectedBranch.why], ['enforced', 'GitHub protects main: a pull request with reviews, passing checks, no admin bypass, no force pushes.']);
  const ruleset = at({ 'gh api repos/acme/tool/branches/main/protection': page(404, { message: 'Branch not protected' }), 'gh api repos/acme/tool/rules/branches/main': page(200, [{ type: 'pull_request' }, { type: 'deletion' }]) });
  assert.deepEqual([ruleset.state, ruleset.why], ['enforced', 'A ruleset applies to main: pull request, deletion.']);
  const none = at({ 'gh api repos/acme/tool/branches/main/protection': page(404, { message: 'Branch not protected' }), 'gh api repos/acme/tool/rules/branches/main': page(200, []) });
  assert.equal(none.state, 'none');
  assert.match(none.why, /enforces no protection and no ruleset on main: a push the guard didn't catch would be caught by acc's next sync, after the fact, not prevented/);
  const free = at({ 'gh api repos/acme/tool/branches/main/protection': upgrade });
  assert.equal(free.state, 'unavailable');
  assert.match(free.why, /a private repo on the free plan. A push the guard didn't catch would be caught by acc's next sync, after the fact, not prevented/);
  const offline = at({ 'gh api': bad('connection refused') });
  assert.equal(offline.state, 'unknown');
  assert.match(offline.why, /gh couldn't read main's protection: connection refused/);
  // Each environment branch, as the repo's account; the warnings leave out what's enforced.
  const fixtures = { 'gh auth token -u acme-bot': ok('ghs_x\n'), 'gh api repos/acme/tool/branches/main/protection': upgrade, 'gh api repos/acme/tool/branches/dev/protection': page(200, {}) };
  const found = environmentProtection(fakeRunner(fixtures), 'acme/tool', 'acme-bot', ['main', 'dev'], {});
  assert.deepEqual(found.map((p) => [p.branch, p.state]), [['main', 'unavailable'], ['dev', 'enforced']]);
  assert.deepEqual(protectionWarnings(found).length, 1);
  assert.match(protectionWarnings(found)[0]!, /free plan/);
  assert.match(protectionWarnings([offline])[0]!, /Whether a push the guard didn't catch would be prevented isn't known/);
  assert.deepEqual(environmentProtection(fakeRunner({}), 'acme/tool', 'acme-bot', ['main'], {}).map((p) => p.state), ['unknown'], 'gh not signed in: unknown, never a throw');
  // A dispatch carries the warning, and goes on.
  const { paths, config } = repoWithOrigin();
  const out = dispatch(paths, config, 'T-1', { run: fakeRunner({ ...CLOUD_FIXTURES, ...fixtures }), now, accBinDir: '/acc/bin', env: { ...process.env, PATH: '/usr/bin' } as NodeJS.ProcessEnv, awake: { platform: 'darwin' as const, spawn: () => ({ pid: 4_100_005, unref: () => undefined }), kill: () => undefined } }, { actor: 'human', by: 'h', where: 'cloud' });
  assert.equal(out.held, false);
  if (out.held) return;
  assert.deepEqual(out.warnings?.map((w) => /free plan/.test(w)), [true]);
  assert.equal(task(paths).state, 'running');
});

// ---------------------------------------------------------------- following by branch, and collecting

/** A cloud dispatch of T-1, done, with the clone that stands in for its session. */
function fired(raw: Record<string, unknown> = RAW) {
  const repo = repoWithOrigin(raw);
  const r = fakeRunner(CLOUD_FIXTURES);
  const deps = { run: r, now, accBinDir: '/acc/bin', env: { ...process.env, PATH: '/usr/bin' } as NodeJS.ProcessEnv, awake: { platform: 'darwin' as const, spawn: () => ({ pid: 4_100_002, unref: () => undefined }), kill: () => undefined } };
  const out = dispatch(repo.paths, repo.config, 'T-1', deps, { actor: 'human', by: 'h', where: 'cloud' });
  assert.equal(out.held, false);
  const branch = task(repo.paths).run!.branch!;
  return { ...repo, branch, clone: cloudClone(repo.origin, branch), follow: { run: r, now, env: deps.env } };
}

test('acc follows a cloud builder through its branch: a push is noted, no push for the set time needs you, an Acc-Done head is collected into the worktree and the task goes to review with the note', () => {
  const { paths, config, branch, clone, follow } = fired();
  const before = task(paths).run!.cloud!;
  // Nothing new: the branch stands where the fire left it.
  assert.deepEqual(followCloud(paths, config, follow).map((c) => c.outcome), ['unchanged']);
  assert.equal(cloudWait(task(paths), config, now()), null);
  // The session pushes a commit: acc notes the new head and the time, and the task keeps running.
  const later = () => new Date('2026-10-09T12:30:00Z');
  const first = commitAndPush(clone, branch, 'a.txt', 'T-1: first part');
  const pushed = followCloud(paths, config, { ...follow, now: later });
  assert.deepEqual(pushed.map((c) => [c.outcome, c.head]), [['pushed', first]]);
  const after = task(paths);
  assert.equal(after.state, 'running');
  assert.equal(after.run?.cloud?.head, first);
  assert.equal(after.run?.cloud?.lastPushAt, later().toISOString());
  assert.notEqual(after.run?.cloud?.lastPushAt, before.lastPushAt);
  // Quiet for longer than agents.cloud.quietMinutes: it needs you, with a reason that names the wait.
  const hours = new Date('2026-10-09T15:00:00Z');
  assert.equal(cloudQuiet(after, config, hours), true);
  assert.match(cloudWait(after, config, hours)!, /no word from its cloud builder for 150 minutes/);
  assert.equal(cloudQuiet(after, config, new Date('2026-10-09T13:00:00Z')), false);
  assert.equal(cloudQuiet(after, { agents: { ...config.agents, cloud: { ...config.agents.cloud!, quietMinutes: 10 } } }, new Date('2026-10-09T12:45:00Z')), true);
  // The finish marker lands: acc fetches, fast-forwards the worktree, runs the checks here (none in this
  // project), and moves it to review with the trailers' note, as acc done would.
  const done = commitAndPush(clone, branch, 'b.txt', `T-1: finish\n\n${DONE_TRAILER}: T-1\nAcc-Landed: The thing, in a.txt and b.txt\nAcc-Moved: none\nAcc-Open: Tidy a.txt\n`);
  const collected = followCloud(paths, config, { ...follow, now: () => hours });
  assert.equal(collected[0]?.outcome, 'collected', collected[0]?.note ?? 'nothing followed');
  assert.equal(collected[0]?.head, done);
  const t = task(paths);
  assert.equal(t.state, 'review');
  assert.equal(gitIn(t.run!.worktree!, 'rev-parse', 'HEAD'), done, 'the worktree is at the cloud\'s head');
  assert.ok(existsSync(join(t.run!.worktree!, 'b.txt')));
  assert.deepEqual([t.run?.note?.landed, t.run?.note?.moved, t.run?.note?.open], [['The thing, in a.txt and b.txt'], [], ['Tidy a.txt']]);
  assert.equal(t.run?.note?.by, 'builder:T-1');
  assert.equal(t.run?.cloud?.finished, true);
  assert.match(t.history.at(-1)!.reason!, /Collected from its cloud session/);
  // Collected once: the next look has nothing to follow.
  assert.deepEqual(followCloud(paths, config, { ...follow, now: () => hours }), []);
  assert.equal(cloudWait(t, config, hours), null, 'a task in review waits on nobody for its cloud');
});

test('a cloud builder that blocks moves its task to blocked with its reason; one whose checks fail here stays running, needing you, and collects again once fixed', () => {
  // A check that fails the first time and passes the second: a script the project names.
  const script = join(tempDir('gate-'), 'check.sh');
  writeFileSync(script, '#!/bin/sh\ntest -f passes.txt\n');
  run('chmod', ['755', script]);
  const raw = { ...RAW, gates: { required: ['check'], commands: { check: `sh ${script}` } } };
  const repo = fired(raw);
  // The check really runs: anything the fixtures don't answer goes to the real program.
  const fake = repo.follow.run;
  const passthrough: typeof fake = (cmd, args, o) => { const r = fake(cmd, args, o); return r.code === 127 && r.stderr.startsWith('no fixture') ? run(cmd, args, o) : r; };
  const { paths, config, branch, clone } = repo;
  const follow = { ...repo.follow, run: passthrough };
  const blocked = commitAndPush(clone, branch, 'a.txt', `T-1: stuck\n\n${BLOCKED_TRAILER}: Which queue takes the leftovers?\n`);
  assert.deepEqual(followCloud(paths, config, follow).map((c) => [c.outcome, c.head]), [['blocked', blocked]]);
  assert.equal(task(paths).state, 'blocked');
  assert.equal(task(paths).blocker, 'Which queue takes the leftovers?');
  assert.equal(task(paths).history.at(-1)!.by, 'builder:T-1');
  // A person sends it on: back to running, in the cloud still (its session carries on after an answer).
  mutate(paths, now, (l, emit) => { const t = l.tasks[0]!; t.state = 'running'; emit({ type: 'task.updated', task: t.id, actor: 'human', by: 'h', data: {} }); });
  const failing = commitAndPush(clone, branch, 'b.txt', `T-1: done, I think\n\n${DONE_TRAILER}: T-1\nAcc-Landed: Something\nAcc-Moved: none\nAcc-Open: none\n`);
  const slots = { dir: tempDir('slots-'), slots: 1 };
  const r1 = followCloud(paths, config, { ...follow, slots });
  assert.equal(r1[0]!.outcome, 'collect-failed');
  assert.match(r1[0]!.note, /check failed/);
  const t = task(paths);
  assert.equal(t.state, 'running', 'the task stays running');
  assert.equal(t.run?.cloud?.head, failing);
  assert.match(t.run?.cloud?.collect?.reason ?? '', /check failed.*acc collect T-1/);
  assert.match(cloudWait(t, config, now())!, /acc couldn't collect its work: check failed/);
  assert.equal(gitIn(t.run!.worktree!, 'rev-parse', 'HEAD'), failing, 'the worktree was still fast-forwarded');
  // Fixed on the branch and pushed again: the next look collects it, and the old failure clears.
  const fixed = commitAndPush(clone, branch, 'passes.txt', `T-1: fix the check\n\n${DONE_TRAILER}: T-1\nAcc-Landed: Something, checked\nAcc-Moved: check passes\nAcc-Open: none\n`);
  const r2 = followCloud(paths, config, { ...follow, slots });
  assert.deepEqual(r2.map((c) => [c.outcome, c.head]), [['collected', fixed]]);
  assert.equal(task(paths).state, 'review');
  assert.equal(task(paths).run?.cloud?.collect, null);
  assert.equal(cloudWait(task(paths), config, now()), null);
});

test('collect refuses a dirty or diverged worktree with nothing changed, a local builder, and a task that isn\'t running', () => {
  const { paths, config, branch, clone, follow } = fired();
  const t = task(paths);
  const wt = t.run!.worktree!;
  const head = commitAndPush(clone, branch, 'a.txt', `T-1: done\n\n${DONE_TRAILER}: T-1\nAcc-Landed: x\nAcc-Moved: none\nAcc-Open: none\n`);
  // Dirty: a file nobody committed in the worktree.
  writeFileSync(join(wt, 'scratch.txt'), 'wip\n');
  assert.throws(() => collect(paths, config, 'T-1', follow, { actor: 'human', by: 'h' }), /has changes nobody committed/);
  assert.notEqual(gitIn(wt, 'rev-parse', 'HEAD'), head, 'nothing moved');
  assert.equal(task(paths).state, 'running');
  assert.match(task(paths).run?.cloud?.collect?.reason ?? '', /changes nobody committed/);
  run('rm', [join(wt, 'scratch.txt')]);
  // Diverged: a commit made here that origin's branch doesn't have.
  writeFileSync(join(wt, 'local.txt'), 'here\n');
  gitIn(wt, 'add', '-A');
  gitIn(wt, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'T-1: a local commit');
  const local = gitIn(wt, 'rev-parse', 'HEAD');
  assert.throws(() => collect(paths, config, 'T-1', follow, { actor: 'human', by: 'h' }), /has diverged.*Bring them together by hand/);
  assert.equal(gitIn(wt, 'rev-parse', 'HEAD'), local, 'never forced');
  // A local builder's task, and one not running, are refused in words.
  mutate(paths, now, (l, emit) => upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-2' }, title: 'Local' }], 'human', 'h', emit, now));
  assert.throws(() => collect(paths, config, 'T-2', follow, { actor: 'human', by: 'h' }), /T-2 is todo/);
  mutate(paths, now, (l, emit) => { const x = l.tasks.find((y) => y.id === 'T-2')!; x.state = 'running'; x.run = { worktree: '/w', branch: 'task/T-2-local' }; emit({ type: 'task.updated', task: 'T-2', actor: 'human', by: 'h', data: {} }); });
  assert.throws(() => collect(paths, config, 'T-2', follow, { actor: 'human', by: 'h' }), /runs on this Mac, and finishes with acc done itself/);
});

// ---------------------------------------------------------------- environment branches that move

/** A task branch in the Mac's clone with two commits, pushed to origin, as a dispatch and a cloud builder leave it. */
function taskBranch(root: string, branch: string, stem: string): string[] {
  gitIn(root, 'switch', '-q', '-c', branch, 'main');
  const shas: string[] = [];
  for (const n of [1, 2]) {
    writeFileSync(join(root, `${stem}-${n}.txt`), `${stem} ${n}\n`);
    gitIn(root, 'add', '-A');
    gitIn(root, 'commit', '-q', '-m', `${stem}: part ${n}`);
    shas.push(gitIn(root, 'rev-parse', 'HEAD'));
  }
  gitIn(root, 'push', '-q', 'origin', branch);
  gitIn(root, 'switch', '-q', 'main');
  return shas;
}

test('an environment branch moved by acc\'s own merge passes by its recorded commit, as a merge commit, a squash or a rebase; a hand-pushed commit that merely names a number is flagged until a person clears it (GH-69)', () => {
  const { root, origin, paths, config } = repoWithOrigin();
  const r = fakeRunner({ ...CLOUD_FIXTURES, gh: bad('offline') });
  const deps = { run: r, now, env: process.env };
  const ledger = () => readLedger(paths.ledger);
  const record = (id: string, pr: Record<string, unknown>, branch: string, merged?: { sha: string; number: number }) => mutate(paths, now, (l, emit) => {
    if (!l.tasks.some((x) => x.id === id)) upsertTasks(l, config, [{ source: { kind: 'manual', key: id }, title: id }], 'human', 'h', emit, now);
    const t = l.tasks.find((x) => x.id === id)!;
    t.pr = pr as never;
    t.run = { ...t.run, branch };
    if (merged) t.autopilot = { failed: null, merged: { sha: merged.sha, pr: { number: merged.number, url: 'https://x' }, method: 'merge', at: now().toISOString() } };
    emit({ type: 'task.updated', task: id, actor: 'human', by: 'h', data: {} });
  });
  // The first look only records where main stands.
  assert.deepEqual(followBranches(paths, config, ledger(), deps), []);
  const main0 = gitIn(root, 'rev-parse', 'main');
  assert.equal(readBranches(paths).main?.head, main0);
  assert.equal(remoteHead(r, root, 'main', process.env), main0);
  // A person's clone, which merges on GitHub's behalf: a merge commit, as autopilot's first choice makes (merge.ts).
  const other = cloudClone(origin, 'main');
  const t1 = taskBranch(root, 'task/T-1-a-thing', 'T-1');
  gitIn(other, 'fetch', '-q', 'origin', 'task/T-1-a-thing');
  gitIn(other, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #12 from acme/task/T-1-a-thing', 'origin/task/T-1-a-thing');
  const mergeCommit = gitIn(other, 'rev-parse', 'HEAD');
  gitIn(other, 'push', '-q', 'origin', 'main');
  // The task's commits came in with it, "T-1: part 1" and "T-1: part 2", which name no pull request:
  // read along the first-parent line, the move is the one merge commit, explained by the sha sync recorded.
  record('T-1', { number: 12, url: 'https://x/12', state: 'merged', mergeSha: mergeCommit }, 'task/T-1-a-thing');
  assert.deepEqual(followBranches(paths, config, ledger(), deps), [], 'acc\'s merge commit passes');
  assert.equal(readBranches(paths).main?.head, mergeCommit);
  // The same move, explained other ways: the merge commit's second parent is the head acc landed (pr.sha),
  // or the head autopilot merged, before sync has recorded the merge's own sha; the subject alone never does.
  const known = (k: Parameters<typeof unexplained>[4]) => unexplained(r, root, main0, mergeCommit, k).commits.map((c) => c.subject);
  assert.deepEqual(known([{ number: 12, head: t1[1]! }]), [], 'by the landed head');
  assert.deepEqual(known(knownMerges({ tasks: [{ id: 'T-1', autopilot: { merged: { sha: t1[1]!, pr: { number: 12, url: 'https://x/12' } } }, run: { branch: 'task/T-1-a-thing' } }] } as never)), [], 'by autopilot\'s merged head, before sync has seen the merge');
  assert.deepEqual(known([{ number: 12 }]), ['Merge pull request #12 from acme/task/T-1-a-thing'], 'a merge commit is never explained by its subject');
  assert.deepEqual(known([]), ['Merge pull request #12 from acme/task/T-1-a-thing']);
  // A squash: one commit on main, as GitHub writes it, "Title (#13)".
  taskBranch(root, 'task/T-2-second', 'T-2');
  gitIn(other, 'fetch', '-q', 'origin', 'task/T-2-second');
  gitIn(other, 'merge', '-q', '--squash', 'origin/task/T-2-second');
  gitIn(other, 'commit', '-q', '-m', 'Second thing (#13)');
  const squash = gitIn(other, 'rev-parse', 'HEAD');
  gitIn(other, 'push', '-q', 'origin', 'main');
  record('T-2', { number: 13, url: 'https://x/13', state: 'merged', mergeSha: squash }, 'task/T-2-second');
  assert.deepEqual(followBranches(paths, config, ledger(), deps), [], 'by the squash\'s recorded sha');
  assert.deepEqual(unexplained(r, root, mergeCommit, squash, [{ number: 13 }]).commits, [], 'or, sync not yet there, by GitHub\'s squash subject naming a pull request the ledger knows');
  assert.deepEqual(unexplained(r, root, mergeCommit, squash, [{ number: 14 }]).commits.map((c) => c.subject), ['Second thing (#13)'], 'but not another number');
  assert.deepEqual(unexplained(r, root, mergeCommit, squash, [{ number: 13, mergeSha: mergeCommit }]).commits.map((c) => c.subject), ['Second thing (#13)'], 'and not a pull request whose merge sync did record, as another commit: the subject stands in only where the sha is unknown');
  assert.deepEqual([squashOf('Second thing (#13)'), squashOf('Hotfix, see #12'), squashOf('Merge pull request #12 from x'), squashOf('Tidy (#13) later')], [13, null, null, null]);
  // A rebase: the branch's commits copied onto main with new shas. GitHub records the last as the merge's;
  // git cherry finds the rest by their patches, against the branch the Mac's clone still has.
  const t3 = taskBranch(root, 'task/T-3-third', 'T-3');
  gitIn(other, 'fetch', '-q', 'origin', 'task/T-3-third');
  gitIn(other, 'cherry-pick', ...t3);
  const rebased = gitIn(other, 'rev-parse', 'HEAD');
  assert.notEqual(rebased, t3[1], 'new shas');
  gitIn(other, 'push', '-q', 'origin', 'main');
  record('T-3', { number: 15, url: 'https://x/15', state: 'merged', mergeSha: rebased }, 'task/T-3-third');
  assert.deepEqual(followBranches(paths, config, ledger(), deps), [], 'a rebase merge passes');
  assert.deepEqual(unexplained(r, root, squash, rebased, [{ number: 15, mergeSha: rebased }]).commits.map((c) => c.subject), ['T-3: part 1'], 'without the branch, only the recorded commit is known');
  assert.deepEqual(unexplained(r, root, squash, rebased, [{ number: 15, branch: 'task/T-3-third' }]).commits, [], 'with it, every copied commit is');
  // A hand-pushed commit that names a pull request isn't acc's merge, whatever it says: flagged, naming it.
  const hot = commitAndPush(other, 'main', 'hot.txt', 'Hotfix, see #12');
  const moves = followBranches(paths, config, ledger(), deps);
  assert.equal(moves.length, 1);
  assert.deepEqual([moves[0]!.branch, moves[0]!.from, moves[0]!.to, moves[0]!.commits], ['main', rebased, hot, [`${hot.slice(0, 7)} Hotfix, see #12`]]);
  assert.match(moveWords(moves[0]!), /^main moved from \w{7} to \w{7} by 1 commit that isn't acc's merges: \w{7} Hotfix, see #12\. Look before anything builds on it\.$/);
  assert.equal(moveUrl('acme/tool', moves[0]!), `https://github.com/acme/tool/compare/${rebased}...${hot}`);
  assert.equal(branchMoves(paths).length, 1);
  // Seen again: still waiting, found once; sync carries every move still waiting, each run, until a person clears it.
  assert.deepEqual(followBranches(paths, config, ledger(), deps), []);
  assert.deepEqual(sync(paths, config, deps).branches.map((m) => m.to), [hot]);
  assert.deepEqual(sync(paths, config, deps).branches.map((m) => m.to), [hot], 'and again');
  // A second move nobody explains, while the first waits: one item, from the earliest head, with both commits, newest first.
  const hot2 = commitAndPush(other, 'main', 'hot2.txt', 'Another by hand');
  const second = followBranches(paths, config, ledger(), deps);
  assert.deepEqual(second.map((m) => [m.from, m.to, m.commits]), [[rebased, hot2, [`${hot2.slice(0, 7)} Another by hand`, `${hot.slice(0, 7)} Hotfix, see #12`]]], 'the earliest from is kept, and the new commit added');
  assert.equal(branchMoves(paths).length, 1);
  assert.match(moveWords(second[0]!), /by 2 commits that aren't acc's merges: \w{7} Another by hand, \w{7} Hotfix, see #12\./);
  // Another of acc's merges after it: the branch moves on, the earlier move still waits.
  gitIn(other, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #16 from acme/task/T-4', 'origin/task/T-2-second');
  const later = gitIn(other, 'rev-parse', 'HEAD');
  gitIn(other, 'push', '-q', 'origin', 'main');
  record('T-4', { number: 16, url: 'https://x/16', state: 'merged', mergeSha: later }, 'task/T-4');
  assert.deepEqual(followBranches(paths, config, ledger(), deps), []);
  assert.equal(readBranches(paths).main?.head, later);
  assert.equal(readBranches(paths).main?.moved?.to, hot2, 'the earlier move still waits for a person');
  // A force push back: git can't list what came in, and that's flagged as a rewrite on top of the move still waiting.
  gitIn(other, 'reset', '-q', '--hard', 'HEAD~3');
  gitIn(other, 'push', '-q', '--force', 'origin', 'main');
  const back = gitIn(other, 'rev-parse', 'HEAD');
  const rewrite = followBranches(paths, config, ledger(), deps);
  assert.deepEqual([rewrite[0]?.from, rewrite[0]?.to, rewrite[0]?.commits.length, rewrite[0]?.rewritten], [rebased, back, 2, true]);
  assert.match(moveWords(rewrite[0]!), /then moved again in a way git couldn't list: a force push or a rewrite/);
  // A rewrite with nothing waiting: flagged on its own.
  assert.deepEqual(clearBranchMoves(paths), ['main']);
  gitIn(other, 'reset', '-q', '--hard', 'HEAD~1');
  gitIn(other, 'push', '-q', '--force', 'origin', 'main');
  const back2 = gitIn(other, 'rev-parse', 'HEAD');
  const alone = followBranches(paths, config, ledger(), deps);
  assert.deepEqual([alone[0]?.from, alone[0]?.to, alone[0]?.commits], [back, back2, []]);
  assert.match(moveWords(alone[0]!), /git couldn't list how: a force push or a rewrite/);
  // A person clears it.
  assert.deepEqual(clearBranchMoves(paths), ['main']);
  assert.deepEqual(branchMoves(paths), []);
  assert.deepEqual(sync(paths, config, deps).branches, []);
  assert.deepEqual(clearBranchMoves(paths), []);
  // A project that hasn't opted in looks at no branch: nothing is read, and nothing is flagged.
  const off = cfg({ ...RAW, agents: { max: 2 } });
  const calls: string[] = [];
  assert.deepEqual(sync(paths, off, { ...deps, run: fakeRunner({ ...CLOUD_FIXTURES, gh: bad('offline') }, calls) }).branches, []);
  assert.ok(!calls.some((c) => c.startsWith('git ls-remote')), 'off by default: no look at origin');
});

test('sync follows a running cloud builder\'s branch too, and a project with no GitHub section has nothing to follow', () => {
  const { paths, config, branch, clone, follow } = fired();
  const r = fakeRunner({ ...CLOUD_FIXTURES, gh: bad('offline') });
  const done = commitAndPush(clone, branch, 'a.txt', `T-1: done\n\n${DONE_TRAILER}: T-1\nAcc-Landed: x\nAcc-Moved: none\nAcc-Open: none\n`);
  const s = sync(paths, config, { ...follow, run: r });
  assert.deepEqual(s.cloud.map((c) => [c.task, c.outcome, c.head]), [['T-1', 'collected', done]]);
  assert.equal(task(paths).state, 'review');
  const plain = cfg(GENERIC_CONFIG);
  const local = repoPaths(realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) })), run);
  mkdirSync(local.stateDir, { recursive: true });
  assert.deepEqual(sync(local, plain, { run: r, now, env: process.env }), { checked: 0, changes: [], cloud: [], branches: [] });
});
