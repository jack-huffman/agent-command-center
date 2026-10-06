import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../src/config.ts';
import { awakePath } from '../src/awake.ts';
import { builderSettings, dispatch, findSession, renderPacket, slugify, taskBranch, worktreeRoot } from '../src/dispatch.ts';
import { run } from '../src/exec.ts';
import { emptyLedger, mutate, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { fakeAwake, fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, ok, SF_CONFIG, tempDir } from './support.ts';

const MAIN = fileURLToPath(new URL('../../cli/src/main.ts', import.meta.url));

/** A stand-in claude: records every call, starts "sessions", and lists them like `claude agents --json`. */
function fakeClaude(): { bin: string; dir: string; calls: () => { args: string[]; cwd: string }[] } {
  const dir = tempDir('fake-claude-');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const dir = ${JSON.stringify(dir)};
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
const sessions = fs.existsSync(path.join(dir, 'sessions.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8')) : [];
if (args[0] === '--bg') {
  const name = args[args.indexOf('--name') + 1];
  const n = sessions.length + 1;
  // A pid no process has, as Claude Code lists a background session's own process.
  sessions.push({ id: 'bg' + n, sessionId: 'sess-' + n, name, kind: 'background', cwd: process.cwd(), startedAt: Date.now(), state: 'working', pid: 4000000 + n });
  fs.writeFileSync(path.join(dir, 'sessions.json'), JSON.stringify(sessions));
  console.log('bg' + n);
} else if (args[0] === 'agents') {
  console.log(JSON.stringify(sessions));
}
`);
  chmodSync(join(bin, 'claude'), 0o755);
  const calls = () => (existsSync(join(dir, 'calls.jsonl')) ? readFileSync(join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { bin, dir, calls };
}

/** A home folder whose Claude Code state trusts these repos, so background dispatch is allowed (D-022). */
function trustingHome(...repos: string[]): string {
  const home = tempDir('home-');
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: Object.fromEntries(repos.map((r) => [realpathSync(r), { hasTrustDialogAccepted: true }])) }));
  return home;
}

const IGNORE = { '.gitignore': '.claude/worktrees/\n' };

function acc(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(process.execPath, ['--no-warnings', MAIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ACC_ROLE: '', ACC_TASK: '', CLAUDE_CONFIG_DIR: '', ...env } });
  return { code: r.status ?? 1, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
}

const tasksOf = (repo: string) => JSON.parse(readFileSync(join(repo, '.git', 'acc', 'ledger.json'), 'utf8')).tasks as { id: string; state: string; run?: Record<string, string> }[];

test('names: slugs are short and branch-safe, and worktrees sit beside the repo (D-013)', () => {
  assert.equal(slugify('Fix the Account layout! (urgent)'), 'fix-the-account-layout-urgent');
  assert.equal(slugify('A'.repeat(60)), 'task');
  assert.equal(slugify('one two three four five six seven eight nine ten'), 'one-two-three-four-five-six-seven-eight');
  assert.equal(taskBranch({ id: 'AV-12', title: 'Login page' }), 'task/AV-12-login-page');
  const cfg = parseConfig(JSON.parse(JSON.stringify(GENERIC_CONFIG))).config!;
  assert.equal(worktreeRoot(cfg, '/x/Acme'), '/x/Acme/.claude/worktrees');
  assert.equal(worktreeRoot({ ...cfg, worktrees: { root: '../trees', setup: [] } }, '/x/Acme'), '/x/trees');
});

test('the packet tells a Salesforce builder where it is, how to finish, and what never to touch', () => {
  const config = parseConfig(JSON.parse(JSON.stringify(SF_CONFIG))).config!;
  const l = emptyLedger();
  upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-7', url: 'https://x/ACME-7' }, title: 'Add a field', brief: 'Add Region__c to Account.' }], 'human', 'h', () => {}, () => new Date());
  const env = config.environments.find((e) => e.branch === 'dev')!;
  const p = renderPacket({ task: l.tasks[0]!, config, env, worktree: '/w/ACME-7', branch: 'task/ACME-7-add-a-field', rules: 'Use the selector pattern.', environmentSpecific: ['force-app/main/default/settings/MyDomain.settings-meta.xml'] });
  for (const must of ['# Task ACME-7: Add a field', 'Add Region__c to Account.', 'https://x/ACME-7', '`/w/ACME-7`', '`task/ACME-7-add-a-field`', 'started from `dev`', '`Acme Dev`',
    'validate, never deploy', '`acc done`', '`acc block', '`format`, `validate`', 'push, merge, or open a pull request', '`sf project deploy start`', 'MyDomain.settings-meta.xml', 'Use the selector pattern.']) {
    assert.ok(p.includes(must), must);
  }
  assert.ok(!p.includes('refs #'), 'Jira tasks don\'t get GitHub refs');
  assert.ok(p.includes('running exactly `acc done`, as its own command'), 'the finish line is a bare acc done');
  assert.ok(p.includes('npm scripts'), 'wrappers are ruled out');
  assert.ok(p.includes('run exactly `acc gate run`') && p.includes('`acc gate run --test AccountServiceTest="covers the new discount rule"`'), 'Apex changes add --test to the same command');
  assert.ok(p.indexOf('**Commit**') < p.indexOf('**Checks:**'), 'commit first: receipts vouch for a commit');
  assert.ok(!p.includes('M4'), 'no stopgap for missing gates');
  const withPath = renderPacket({ task: l.tasks[0]!, config, env, worktree: '/w', branch: 'b', rules: null, environmentSpecific: [], accPath: '/opt/acc/bin/acc' });
  assert.ok(withPath.includes('its full path is `/opt/acc/bin/acc`'));
});

test('builder settings: identity, acc on PATH, and the dangerous commands denied even if the user allows them', () => {
  const config = parseConfig(JSON.parse(JSON.stringify(SF_CONFIG))).config!;
  const s = builderSettings({ id: 'ACME-7' } as never, config, '/acc/bin', '/usr/bin') as { env: Record<string, string>; permissions: { allow: string[]; deny: string[] } };
  assert.deepEqual(s.env, { ACC_TASK: 'ACME-7', ACC_ROLE: 'builder', PATH: '/acc/bin:/usr/bin' });
  for (const d of ['Bash(git push*)', 'Bash(gh pr *)', 'Bash(sf project deploy start*)', 'Bash(acc set *)', 'Bash(git checkout *)', 'Bash(acc agents autonomy*)']) assert.ok(s.permissions.deny.includes(d), d);
  assert.ok(s.permissions.allow.includes('Bash(sf project deploy validate *)'));
  for (const a of ['Bash(acc gate run)', 'Bash(acc gate run *)', 'Bash(acc gate list*)']) assert.ok(s.permissions.allow.includes(a), a);
});

test('a builder runs with the project\'s model and this clone\'s effort, when they\'re chosen (D-036)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, agents: { builder: { model: 'opus', effort: 'high' } } }), ...IGNORE }));
  gitIn(repo, 'config', 'acc.builder.effort', 'low');
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  assert.equal(acc(repo, ['add', 'Write the changelog']).code, 0);
  assert.equal(acc(repo, ['dispatch', 'T-1', '--json'], env).code, 0);
  const launch = claude.calls().find((c) => c.args[0] === '--bg')!;
  assert.deepEqual(launch.args.slice(5, 9), ['--model', 'opus', '--effort', 'low']);
});

test('dispatch end to end: worktree from the environment branch, packet, background session, ledger', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE }));
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  assert.equal(acc(repo, ['add', 'Write the changelog', '--brief', 'Add CHANGELOG.md with one entry.']).code, 0);
  const r = acc(repo, ['dispatch', 'T-1', '--json'], env);
  assert.equal(r.code, 0, r.err);
  const out = r.json();
  assert.equal(out.worktree, `${repo}/.claude/worktrees/T-1`);
  assert.equal(out.branch, 'task/T-1-write-the-changelog');
  assert.equal(out.bgId, 'bg1');
  assert.equal(out.sessionId, 'sess-1');
  assert.equal(gitIn(out.worktree, 'rev-parse', '--abbrev-ref', 'HEAD'), 'task/T-1-write-the-changelog');
  assert.equal(gitIn(out.worktree, 'rev-parse', 'HEAD'), gitIn(repo, 'rev-parse', 'main'), 'starts from the environment branch');
  assert.match(readFileSync(out.packetPath, 'utf8'), /Add CHANGELOG.md with one entry./);

  const launch = claude.calls().find((c) => c.args[0] === '--bg')!;
  assert.equal(realpathSync(launch.cwd), repo, 'the session starts in the trusted main checkout');
  assert.ok(launch.args.at(-1)!.includes(`Call the **EnterWorktree** tool with the path \`${out.worktree}\``), 'the agent enters its worktree first');
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).stdout, '', 'the main checkout stays clean');
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: out.worktree, encoding: 'utf8' }).stdout, '', 'the worktree starts clean, linked node_modules or not');
  assert.deepEqual(launch.args.slice(0, 5), ['--bg', '--name', 'T-1', '--permission-mode', 'acceptEdits']);
  const settings = JSON.parse(launch.args[launch.args.indexOf('--settings') + 1]!);
  assert.equal(settings.env.ACC_TASK, 'T-1');
  assert.equal(settings.env.ACC_ROLE, 'builder');
  assert.ok(settings.permissions.deny.includes('Bash(git push*)'));
  assert.ok(settings.permissions.allow.includes('Bash(nice -n 15 node --no-warnings --test*)'), 'tests run under nice need no prompt');
  assert.match(launch.args.at(-1)!, /# Task T-1: Write the changelog/);

  const task = tasksOf(repo).find((t) => t.id === 'T-1')!;
  assert.equal(task.state, 'running');
  assert.equal(task.run!.bgId, 'bg1');
  assert.equal(task.run!.worktree, out.worktree);

  // The builder finishes from inside its worktree, identified by its session environment.
  const done = acc(out.worktree, ['done', '--json'], { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.equal(done.code, 0, done.err);
  assert.equal(done.json().entry.by, 'builder:T-1');
  assert.equal(tasksOf(repo)[0]!.state, 'review');

  // Rework reuses the same worktree and branch.
  assert.equal(acc(repo, ['set', 'T-1', 'rework', '--reason', 'needs a date']).code, 0);
  const again = acc(repo, ['dispatch', 'T-1', '--json'], env);
  assert.equal(again.code, 0, again.err);
  assert.equal(again.json().reused, true);
  assert.equal(again.json().bgId, 'bg2');
});

test('dispatch refuses tasks that aren\'t ready, and stops at the agent cap', () => {
  const repo = makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, agents: { max: 1 } }), ...IGNORE });
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  acc(repo, ['add', 'First']);
  acc(repo, ['add', 'Second', '--dep', 'T-1']);
  acc(repo, ['add', 'Third']);
  assert.match(acc(repo, ['dispatch', 'T-2'], env).err, /waiting on T-1, which is todo/);
  assert.equal(acc(repo, ['dispatch', 'T-1'], env).code, 0);
  assert.match(acc(repo, ['dispatch', 'T-3'], env).err, /1 tasks are already running. The limit is 1/);
  assert.equal(claude.calls().filter((c) => c.args[0] === '--bg').length, 1, 'no session was started for the refused tasks');
});

test('a builder can block with a reason, but can\'t mark work done or move other tasks', () => {
  const repo = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE });
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  acc(repo, ['add', 'Work']);
  const wt = acc(repo, ['dispatch', 'T-1', '--json'], env).json().worktree;
  const b = { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' };
  assert.equal(acc(wt, ['block'], b).code, 2, 'a reason is required');
  assert.equal(acc(wt, ['block', 'The', 'org', 'is', 'down'], b).code, 0);
  const t = tasksOf(repo)[0] as { state: string; blocker?: string };
  assert.equal(t.state, 'blocked');
  assert.equal(t.blocker, 'The org is down');
  assert.match(acc(wt, ['set', 'T-1', 'todo'], b).err, /A builder can't move a task from blocked to todo/);
});

test('Salesforce dispatch points the worktree at the environment\'s org', () => {
  const repo = makeRepo({ '.acc/config.json': JSON.stringify(SF_CONFIG), ...IGNORE });
  gitIn(repo, 'branch', 'dev');
  const claude = fakeClaude();
  acc(repo, ['add', 'A field']);
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  // A Salesforce task waits for its analysis (D-052), unless a person says to go without.
  assert.match(acc(repo, ['dispatch', 'T-1'], env).err, /hasn't been analyzed.*acc analyze T-1/s);
  const r = acc(repo, ['dispatch', 'T-1', '--without-analysis', '--json'], env);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(readFileSync(join(r.json().worktree, '.sf', 'config.json'), 'utf8')), { 'target-org': 'Acme Dev' });
  assert.match(readFileSync(r.json().packetPath, 'utf8'), /validate, never deploy/);
});

test('cleanup keeps a worktree with uncommitted or unmerged work, and removes it once merged', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE }));
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  acc(repo, ['add', 'Docs']);
  const { worktree, branch } = acc(repo, ['dispatch', 'T-1', '--json'], env).json();
  assert.match(acc(repo, ['cleanup', 'T-1']).out, /still running/);
  acc(worktree, ['done'], { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  writeFileSync(join(worktree, 'NOTES.md'), 'draft\n');
  assert.match(acc(repo, ['cleanup', 'T-1']).out, /1 uncommitted change/);
  gitIn(worktree, 'add', 'NOTES.md');
  gitIn(worktree, 'commit', '-q', '-m', 'T-1: notes');
  assert.match(acc(repo, ['cleanup', 'T-1']).out, /1 commit\(s\) that aren't in main yet/);
  gitIn(repo, 'merge', '-q', '--ff-only', branch);
  const ok = acc(repo, ['cleanup', 'T-1', '--json']);
  assert.equal(ok.code, 0, ok.out);
  assert.equal(existsSync(worktree), false);
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repo }).status, 1, 'the merged branch is gone');
});

test('a background dispatch keeps the Mac awake for its session\'s own process, and a builder may never resume (D-067)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE }));
  const config = parseConfig(GENERIC_CONFIG).config!;
  const paths = repoPaths(repo, run);
  mutate(paths, () => new Date(), (l, emit) => { upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'Write the changelog' }], 'human', 'human:test', emit, () => new Date()); });
  const runner = fakeRunner({
    'claude --bg': ok('backgrounded'),
    'claude agents --json': ok(JSON.stringify([{ pid: 4242, id: 'bg1', sessionId: 'sess-1', name: 'T-1', kind: 'background', startedAt: 1, state: 'working', status: 'busy' }])),
  });
  const awake = fakeAwake();
  const r = dispatch(paths, config, 'T-1', { run: runner, now: () => new Date(), accBinDir: '/acc/bin', env: { HOME: trustingHome(repo), PATH: '/usr/bin' }, awake: awake.deps }, { actor: 'human', by: 'human:test' });
  assert.deepEqual([r.bgId, r.sessionId], ['bg1', 'sess-1']);
  assert.deepEqual(awake.spawned, [['caffeinate', '-i', '-w', '4242']], 'acc exits now; caffeinate watches the session instead');
  assert.equal(JSON.parse(readFileSync(awakePath(paths, 'T-1'), 'utf8')).watch, 4242, 'written down, so it ends when the task leaves running');
  const s = builderSettings({ id: 'T-1' } as never, config, '/acc/bin', '/usr/bin') as { permissions: { deny: string[] } };
  assert.ok(s.permissions.deny.includes('Bash(acc resume*)'));
});

test('a session listed before its process is asked for again until its pid shows, so the Mac is still kept awake (D-067)', () => {
  const session = { id: 'bg1', sessionId: 'sess-1', name: 'T-1', kind: 'background', startedAt: 1, state: 'working', status: 'busy' };
  let asked = 0;
  const later: typeof run = (cmd, args) => (cmd === 'claude' && args[0] === 'agents'
    ? { code: 0, stdout: JSON.stringify([++asked < 3 ? session : { ...session, pid: 4242 }]), stderr: '', timedOut: false }
    : { code: 0, stdout: '', stderr: '', timedOut: false });
  assert.deepEqual(findSession(later, '/w', 'T-1', 5_000), { bgId: 'bg1', sessionId: 'sess-1', pid: 4242 });
  assert.equal(asked, 3, 'asked until the pid was there');
  const never: typeof run = () => ({ code: 0, stdout: JSON.stringify([session]), stderr: '', timedOut: false });
  assert.deepEqual(findSession(never, '/w', 'T-1', 1_200), { bgId: 'bg1', sessionId: 'sess-1', pid: null }, 'a pid that never shows still finds the session');
});

test('dispatch refuses before touching anything when Claude Code doesn\'t trust the repo (D-022)', () => {
  const repo = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE });
  const claude = fakeClaude();
  acc(repo, ['add', 'Work']);
  const r = acc(repo, ['dispatch', 'T-1'], { PATH: `${claude.bin}:${process.env.PATH}`, HOME: tempDir('home-') });
  assert.equal(r.code, 1);
  assert.match(r.err, /doesn't trust .* yet.*Run `claude` once in that folder, accept the trust prompt/s);
  assert.equal(existsSync(join(repo, '.claude', 'worktrees', 'T-1')), false, 'no worktree was made');
  assert.equal(claude.calls().length, 0, 'claude was never called');
  assert.equal(tasksOf(repo)[0]!.state, 'todo');
});
