import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../src/config.ts';
import { awakePath } from '../src/awake.ts';
import { builderSettings, dispatch, type DispatchOptions, findSession, renderPacket, slugify, startHeld, stopWaiting, taskBranch, worktreeRoot } from '../src/dispatch.ts';
import { run } from '../src/exec.ts';
import { shortPacket } from '../src/hooks.ts';
import { displayState, emptyLedger, moveTask, mutate, noGateHooks, readLedger, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { bad, fakeAwake, fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, ok, SF_CONFIG, tempDir, writePlan } from './support.ts';

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
    'validate, never deploy', '`acc done`', '`acc block', '`format`, `validate`', 'push, merge a pull request, or open one', '`sf project deploy start`', 'MyDomain.settings-meta.xml', 'Use the selector pattern.']) {
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

test('a rework autopilot sent back for failing checks tells its builder what GitHub said, and no review\'s changes (D-076)', () => {
  const config = parseConfig({ ...GENERIC_CONFIG, gates: { required: ['test'], commands: { test: 'npm test' } } }).config!;
  const l = emptyLedger();
  upsertTasks(l, config, [{ source: { kind: 'github', key: '57', url: 'https://github.com/acme/tool/issues/57' }, title: 'Add sum', brief: 'sum(a, b)' }], 'human', 'h', () => {}, () => new Date());
  const env = config.environments[0]!;
  const sha = 'a'.repeat(40);
  const passed = { v: 1 as const, task: 'GH-57', sha, env: 'main', verdict: 'pass' as const, summary: 'Adds sum.', criteria: [], findings: [], sessionId: 's', at: '2026-10-06T09:00:00.000Z', durationMs: 1, costUsd: null };
  const checks = {
    v: 1 as const, task: 'GH-57', sha, pr: { number: 42, url: 'https://github.com/acme/tool/pull/42' }, required: false, at: '2026-10-06T09:10:00.000Z',
    checks: [
      { name: 'test', workflow: 'CI', link: 'https://github.com/acme/tool/actions/runs/1/job/2', log: 'not ok 1 - sum adds\n# fail 1', noLog: null },
      { name: 'lint', workflow: 'CI', link: 'https://github.com/acme/tool/actions/runs/1/job/3', log: null, noLog: 'failed to get run log: log not found' },
    ],
  };
  const p = renderPacket({ task: l.tasks[0]!, config, env, worktree: '/w/GH-57', branch: 'task/GH-57-add-sum', rules: null, environmentSpecific: [], review: passed, checks });
  for (const must of [
    '## What GitHub\'s checks said', 'pull request #42, and its checks failed on GitHub on aaaaaaa: test, lint', '### test (CI)', 'Link: https://github.com/acme/tool/actions/runs/1/job/2',
    '```text\nnot ok 1 - sum adds\n# fail 1\n```', '### lint (CI)', 'Couldn\'t fetch its log: failed to get run log: log not found.',
    'run `acc block "<what you found>"` and stop', 'run exactly `acc gate run`', 'running exactly `acc done`',
  ]) assert.ok(p.includes(must), must);
  assert.ok(!p.includes('What the review asked for'), 'its review passed');
  assert.ok(p.indexOf('What GitHub\'s checks said') < p.indexOf('## Where you are'), 'before where it works, as a review\'s changes are');
  const plain = renderPacket({ task: l.tasks[0]!, config, env, worktree: '/w/GH-57', branch: 'task/GH-57-add-sum', rules: null, environmentSpecific: [] });
  assert.ok(!plain.includes('What GitHub\'s checks said'), 'a first build has none');
});

test('where the merge queue runs the full check, the packet and the short one name a builder\'s lighter checks, and say the full one runs in the queue (GH-73)', () => {
  const raw = { ...GENERIC_CONFIG, autonomy: 'review', autopilot: { autoMerge: true }, gates: { required: ['check'], builder: ['typecheck', 'near-tests'], commands: { check: 'npm run check', typecheck: 'tsc', 'near-tests': 'node near.mjs' } } };
  const config = parseConfig(raw).config!;
  const l = emptyLedger();
  upsertTasks(l, config, [{ source: { kind: 'github', key: '73', url: 'https://github.com/acme/tool/issues/73' }, title: 'A queue' }], 'human', 'h', () => {}, () => new Date());
  const task = { ...l.tasks[0]!, run: { worktree: '/w/GH-73', branch: 'task/GH-73-a-queue' } };
  const env = config.environments[0]!;
  const p = renderPacket({ task, config, env, worktree: '/w/GH-73', branch: 'task/GH-73-a-queue', rules: null, environmentSpecific: [] });
  assert.ok(p.includes('It runs the required checks (`typecheck`, `near-tests`) on your latest commit'), p);
  assert.ok(p.includes('These are the lighter checks, such as the tests near what you changed. The full check (`check`) runs once, in the merge queue, before your pull request merges'));
  assert.ok(p.includes('- push, merge a pull request, or open one (a person, `acc land` and autopilot do that)'), 'merging the base in isn\'t forbidden');
  assert.match(shortPacket(task, ['typecheck', 'near-tests'], ['check']), /run exactly `acc gate run` \(typecheck, near-tests\), then run exactly `acc done`.*\nThe full check \(check\) runs once, in the merge queue, before the merge\.\nNever push, merge a pull request, open one, or deploy\./s);
  // Elsewhere, as before: the required checks, and nothing about a queue.
  const off = parseConfig({ ...raw, autopilot: { autoMerge: false } }).config!;
  const plain = renderPacket({ task, config: off, env, worktree: '/w/GH-73', branch: 'task/GH-73-a-queue', rules: null, environmentSpecific: [] });
  assert.ok(plain.includes('It runs the required checks (`check`)') && !plain.includes('merge queue'));
  assert.ok(!shortPacket(task, ['check']).includes('merge queue'));
  // A builder may bring its own base in, as the queue asks when it conflicts, with flags or without: only
  // where the queue runs, and no other branch.
  const allows = (c: typeof config, t = task) => (builderSettings(t, c, '/acc/bin', '/usr/bin') as { permissions: { allow: string[] } }).permissions.allow;
  const merges = (c: typeof config, t = task) => allows(c, t).filter((a) => a.startsWith('Bash(git merge'));
  assert.equal(task.environment, 'main');
  assert.deepEqual(merges(config), ['Bash(git merge origin/main)', 'Bash(git merge origin/main *)']);
  assert.ok(!allows(config).some((a) => a.includes('origin/*')), 'not any branch on origin');
  assert.deepEqual(merges(off), [], 'auto-merge off: it asks first, as before');
  assert.deepEqual(merges(parseConfig({ ...raw, autonomy: 'manual' }).config!), [], 'manual autonomy merges nothing on its own');
  const kept = parseConfig({ ...raw, environments: [...GENERIC_CONFIG.environments, { name: 'release', protected: true }] }).config!;
  assert.deepEqual(merges(kept, { ...task, environment: 'release' }), [], 'a protected environment never auto-merges');
  // The config refuses auto-merge in a Salesforce project; set on one anyway, it still isn't allowed.
  const sfParsed = parseConfig({ ...JSON.parse(JSON.stringify(SF_CONFIG)), autonomy: 'review' }).config!;
  const sf = { ...sfParsed, autopilot: { appendOnly: [], autoMerge: true as const } };
  const sfEnv = sf.environments.find((e) => !e.protected)!;
  assert.deepEqual(merges(sf, { ...task, environment: sfEnv.branch }), [], 'never in a Salesforce project');
});

test('builder settings: identity, acc on PATH, and the dangerous commands denied even if the user allows them', () => {
  const config = parseConfig(JSON.parse(JSON.stringify(SF_CONFIG))).config!;
  const s = builderSettings({ id: 'ACME-7' } as never, config, '/acc/bin', '/usr/bin') as { env: Record<string, string>; permissions: { allow: string[]; deny: string[] } };
  assert.deepEqual(s.env, { ACC_TASK: 'ACME-7', ACC_ROLE: 'builder', PATH: '/acc/bin:/usr/bin' });
  for (const d of ['Bash(git push*)', 'Bash(gh pr *)', 'Bash(sf project deploy start*)', 'Bash(acc set *)', 'Bash(git checkout *)', 'Bash(acc agents autonomy*)', 'Bash(acc agents auto-merge*)', 'Bash(gh release create*)', 'Bash(npm run release*)']) assert.ok(s.permissions.deny.includes(d), d);
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

const modelOfLaunch = (args: string[]) => args[args.indexOf('--model') + 1];

test('a builder nobody chose a model for runs acc\'s default, and its run says so without calling it picked (D-086)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE }));
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  acc(repo, ['add', 'Write the changelog']);
  const r = acc(repo, ['dispatch', 'T-1'], env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /model: {4}claude-opus-5-5\n/);
  const launch = claude.calls().find((c) => c.args[0] === '--bg')!;
  assert.deepEqual(launch.args.slice(5, 7), ['--model', 'claude-opus-5-5']);
  assert.equal(launch.args.filter((a) => a === '--model').length, 1);
  const run = tasksOf(repo)[0]!.run!;
  assert.equal(run.model, 'claude-opus-5-5');
  assert.ok(!('modelPicked' in run));
});

test('a model picked for a task reaches claude --bg over the project\'s and the clone\'s, and a rework keeps it (D-086)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, agents: { builder: { model: 'opus', fallbackModel: 'sonnet' } } }), ...IGNORE }));
  gitIn(repo, 'config', 'acc.builder.model', 'haiku');
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  acc(repo, ['add', 'Write the changelog']);
  const r = acc(repo, ['dispatch', 'T-1', '--model', 'sonnet', '--json'], env);
  assert.equal(r.code, 0, r.err);
  const first = claude.calls().filter((c) => c.args[0] === '--bg')[0]!;
  assert.equal(modelOfLaunch(first.args), 'sonnet');
  assert.ok(!first.args.includes('--fallback-model'), 'the fallback is the model itself, which Claude Code refuses');
  assert.deepEqual([tasksOf(repo)[0]!.run!.model, tasksOf(repo)[0]!.run!.modelPicked], ['sonnet', true]);
  assert.equal(r.json().task.run.model, 'sonnet');

  // Sent back for rework, it's re-dispatched with no --model, as autopilot does: the pick stays.
  acc(r.json().worktree, ['done'], { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.equal(acc(repo, ['set', 'T-1', 'rework', '--reason', 'needs a date']).code, 0);
  const again = acc(repo, ['dispatch', 'T-1', '--json'], env);
  assert.equal(again.code, 0, again.err);
  assert.equal(modelOfLaunch(claude.calls().filter((c) => c.args[0] === '--bg')[1]!.args), 'sonnet');
  assert.deepEqual([tasksOf(repo)[0]!.run!.model, tasksOf(repo)[0]!.run!.modelPicked], ['sonnet', true]);

  // Another pick replaces it.
  acc(again.json().worktree, ['done'], { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  acc(repo, ['set', 'T-1', 'rework', '--reason', 'and a heading']);
  assert.equal(acc(repo, ['dispatch', 'T-1', '--model', 'claude-fable-5-1'], env).code, 0);
  assert.equal(modelOfLaunch(claude.calls().filter((c) => c.args[0] === '--bg')[2]!.args), 'claude-fable-5-1');
  assert.equal(tasksOf(repo)[0]!.run!.model, 'claude-fable-5-1');
});

test('a task nobody picked a model for follows the clone\'s choice as it is at each re-dispatch (D-086)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, agents: { builder: { model: 'opus' } } }), ...IGNORE }));
  const claude = fakeClaude();
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  acc(repo, ['add', 'Write the changelog']);
  const r = acc(repo, ['dispatch', 'T-1', '--json'], env);
  assert.equal(modelOfLaunch(claude.calls().filter((c) => c.args[0] === '--bg')[0]!.args), 'opus', 'the project\'s');
  assert.equal(tasksOf(repo)[0]!.run!.model, 'opus');
  acc(r.json().worktree, ['done'], { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  acc(repo, ['set', 'T-1', 'rework', '--reason', 'needs a date']);
  gitIn(repo, 'config', 'acc.builder.model', 'haiku');
  assert.equal(acc(repo, ['dispatch', 'T-1'], env).code, 0);
  assert.equal(modelOfLaunch(claude.calls().filter((c) => c.args[0] === '--bg')[1]!.args), 'haiku', 'the clone\'s, chosen since');
  const run = tasksOf(repo)[0]!.run!;
  assert.equal(run.model, 'haiku');
  assert.ok(!('modelPicked' in run));
});

test('dispatch refuses a model that isn\'t a model name before it makes a worktree (D-086)', () => {
  const repo = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE });
  const claude = fakeClaude();
  acc(repo, ['add', 'Work']);
  const r = acc(repo, ['dispatch', 'T-1', '--model', 'two words'], { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) });
  assert.equal(r.code, 2, 'a usage error');
  assert.match(r.err, /"two words" isn't a model name/);
  assert.equal(existsSync(join(repo, '.claude', 'worktrees', 'T-1')), false, 'no worktree was made');
  assert.equal(claude.calls().length, 0);
  assert.equal(tasksOf(repo)[0]!.state, 'todo');
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
  // Named for its project, task and role (D-087), as Claude Code's session list shows it.
  assert.deepEqual(launch.args.slice(0, 5), ['--bg', '--name', 'Tool · T-1 Write the changelog · builder', '--permission-mode', 'acceptEdits']);
  assert.equal(out.name, 'Tool · T-1 Write the changelog · builder');
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
  assert.equal(task.run!.name, 'Tool · T-1 Write the changelog · builder', 'the name is recorded, so the session is found by it');
  assert.equal(task.run!.n, 1);

  // The builder finishes from inside its worktree, identified by its session environment.
  const done = acc(out.worktree, ['done', '--json'], { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.equal(done.code, 0, done.err);
  assert.equal(done.json().entry.by, 'builder:T-1');
  assert.equal(tasksOf(repo)[0]!.state, 'review');

  // Rework reuses the same worktree and branch, with the task's second builder.
  assert.equal(acc(repo, ['set', 'T-1', 'rework', '--reason', 'needs a date']).code, 0);
  const again = acc(repo, ['dispatch', 'T-1', '--json'], env);
  assert.equal(again.code, 0, again.err);
  assert.equal(again.json().reused, true);
  assert.equal(again.json().bgId, 'bg2');
  const second = claude.calls().filter((c) => c.args[0] === '--bg')[1]!;
  assert.equal(second.args[second.args.indexOf('--name') + 1], 'Tool · T-1 Write the changelog · builder 2');
  assert.deepEqual([tasksOf(repo)[0]!.run!.name, tasksOf(repo)[0]!.run!.n], ['Tool · T-1 Write the changelog · builder 2', 2]);
  assert.match(acc(repo, ['show', 'T-1'], env).out, /Agent: Tool · T-1 Write the changelog · builder 2/);
});

test('a dispatch records its own new session, not an older one of the same name or one named the old way (D-087)', () => {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), ...IGNORE }));
  const claude = fakeClaude();
  const name = 'Tool · T-1 Write the changelog · builder';
  // A builder of an older run named the old way, and one of this name from another clone, an hour ago.
  writeFileSync(join(claude.dir, 'sessions.json'), JSON.stringify([
    { id: 'old', sessionId: 'sess-old', name: 'T-1', kind: 'background', cwd: repo, startedAt: Date.now(), state: 'done', pid: 3999999 },
    { id: 'clone', sessionId: 'sess-clone', name, kind: 'background', cwd: repo, startedAt: Date.now() - 3_600_000, state: 'working', pid: 3999998 },
    { id: 'there', sessionId: 'sess-there', name, kind: 'background', cwd: '/elsewhere/Tool', startedAt: Date.now() + 60_000, state: 'working', pid: 3999997 },
  ]));
  const env = { PATH: `${claude.bin}:${process.env.PATH}`, HOME: trustingHome(repo) };
  assert.equal(acc(repo, ['add', 'Write the changelog']).code, 0);
  const r = acc(repo, ['dispatch', 'T-1', '--json'], env);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json().bgId, r.json().sessionId], ['bg4', 'sess-4']);
  assert.equal(tasksOf(repo)[0]!.run!.bgId, 'bg4');
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
    'claude agents --json': () => ok(JSON.stringify([{ pid: 4242, id: 'bg1', sessionId: 'sess-1', name: 'Tool · T-1 Write the changelog · builder', kind: 'background', startedAt: Date.now(), state: 'working', status: 'busy' }])),
  });
  const awake = fakeAwake();
  const r = dispatch(paths, config, 'T-1', { run: runner, now: () => new Date(), accBinDir: '/acc/bin', env: { HOME: trustingHome(repo), PATH: '/usr/bin' }, awake: awake.deps }, { actor: 'human', by: 'human:test' });
  assert.ok(!r.held);
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

test('a new session is found by its name, in the folder it started in or its worktree, once it started (D-087)', () => {
  const name = 'Tool · T-1 Write the changelog · builder';
  const listed = (...xs: object[]): typeof run => () => ({ code: 0, stdout: JSON.stringify(xs), stderr: '', timedOut: false });
  const at = { since: 1_000, places: ['/repo', '/repo/.claude/worktrees/T-1'] };
  const s = { id: 'bg1', sessionId: 'sess-1', name, kind: 'background', cwd: '/repo', startedAt: 2_000, pid: 7 };
  assert.deepEqual(findSession(listed(s), '/repo', name, 0, at), { bgId: 'bg1', sessionId: 'sess-1', pid: 7 });
  assert.equal(findSession(listed({ ...s, cwd: '/repo/.claude/worktrees/T-1' }), '/repo', name, 0, at).bgId, 'bg1', 'already in its worktree');
  assert.equal(findSession(listed({ ...s, startedAt: 500 }), '/repo', name, 0, at).bgId, null, 'started before this dispatch');
  assert.equal(findSession(listed({ ...s, cwd: '/other/clone' }), '/repo', name, 0, at).bgId, null, 'another clone\'s');
  assert.equal(findSession(listed({ ...s, name: 'T-1' }), '/repo', name, 0, at).bgId, null, 'named the old way');
  assert.equal(findSession(listed({ ...s, kind: 'interactive' }), '/repo', name, 0, at).bgId, null, 'not a background session');
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
  const runner = fakeRunner({ 'claude --bg': () => launch, 'claude agents --json': ok('[]'), 'claude stop': ok() }, calls);
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
  assert.match(capped.waiting[0]!.reason, /2 tasks are already running\. The limit is 2\./);
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

test('a builder can\'t close the issues of tasks already done: its settings deny acc sync --close-done, as guardBash and the CLI refuse it (D-082)', () => {
  const s = builderSettings({ id: 'GH-9' } as never, parseConfig(GENERIC_CONFIG).config!, '/acc/bin', '/usr/bin') as { permissions: { allow: string[]; deny: string[] } };
  assert.ok(s.permissions.deny.includes('Bash(acc sync --close-done*)'));
  assert.ok(!s.permissions.allow.some((a) => a.startsWith('Bash(acc sync')), 'nor is a plain sync pre-approved');
});
