import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DISPLAY } from '../../core/src/index.ts';
import { GENERIC_CONFIG, makeRepo, tempDir } from '../../core/test/support.ts';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));
// A builder's `acc gate run` runs these tests with its own ACC_TASK set, holding the machine's heavy-check slot.
const HEAVY_DIR = join(tempDir('acc-heavy-'), 'slots');

function acc(cwd: string, args: string[], input?: string, env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(process.execPath, ['--no-warnings', MAIN, ...args], {
    cwd, input, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ACC_ROLE: '', ACC_TASK: '', ACC_HEAVY_DIR: HEAVY_DIR, ...env },
  });
  return { code: r.status ?? 1, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
}

function repoWithConfig(config: unknown = GENERIC_CONFIG): string {
  return makeRepo({ '.acc/config.json': JSON.stringify(config) });
}

test('help, version and bad usage', () => {
  const dir = makeRepo();
  assert.equal(acc(dir, ['--version']).out.trim(), '0.1.0');
  assert.match(acc(dir, ['help']).out, /acc doctor/);
  assert.equal(acc(dir, ['nope']).code, 2);
  assert.equal(acc(dir, ['--nope']).code, 2);
});

test('init --profile generic writes a config that doctor accepts', () => {
  const dir = makeRepo();
  const r = acc(dir, ['init', '--profile', 'generic', '--project', 'Tool', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().config.environments[0].branch, 'main');
  const cfg = JSON.parse(readFileSync(join(dir, '.acc', 'config.json'), 'utf8'));
  assert.equal(cfg.project, 'Tool');
  assert.equal(acc(dir, ['init', '--profile', 'generic']).code, 1, 'refuses to overwrite without --force');
  const doctor = acc(dir, ['doctor', '--part', 'project', '--json']).json() as { id: string; status: string }[];
  assert.equal(doctor.find((d) => d.id === 'B0.config')!.status, 'pass');
});

test('add, list, ready, set and show: a task through its life', () => {
  const dir = repoWithConfig();
  assert.equal(acc(dir, ['add', 'First thing']).code, 0);
  assert.equal(acc(dir, ['add', 'Second thing', '--dep', 'T-1', '--brief', 'Needs the first']).code, 0);
  const ready = acc(dir, ['ready', '--json']).json() as { id: string }[];
  assert.deepEqual(ready.map((t) => t.id), ['T-1']);
  assert.match(acc(dir, ['list']).out, /T-2\s+○ To do\s+main\s+Second thing\s+T-1/);

  const refused = acc(dir, ['set', 'T-2', 'running']);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /waiting on T-1, which is todo/);

  assert.equal(acc(dir, ['set', 'T-1', 'running']).code, 0);
  assert.equal(acc(dir, ['set', 't-1', 'review', '--as', 'builder']).code, 0, 'ids are case-insensitive');
  assert.equal(acc(dir, ['set', 'T-1', 'done', '--as', 'builder']).code, 1, 'a builder cannot mark work done');
  assert.equal(acc(dir, ['set', 'T-1', 'done']).code, 0);
  assert.deepEqual((acc(dir, ['ready', '--json']).json() as { id: string }[]).map((t) => t.id), ['T-2']);

  const show = acc(dir, ['show', 'T-1']).out;
  assert.match(show, /todo → running {2}by human:/);
  assert.match(show, /review → done/);
});

test('status: one line of counts by display state, nothing in play, and every state in --json', () => {
  const dir = repoWithConfig();
  // A claude that leaves a mark, to prove status never starts one.
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  const mark = join(dir, 'claude-ran');
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\ntouch "${mark}"\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const status = (...args: string[]) => acc(dir, ['status', ...args], undefined, { PATH: `${bin}:${process.env.PATH}` });

  assert.equal(status().out.trim(), 'Nothing in play.');
  const zero = Object.fromEntries(Object.keys(DISPLAY).map((s) => [s, 0]));
  assert.deepEqual(status('--json').json(), { counts: zero });

  const ledgerPath = join(dir, '.git', 'acc', 'ledger.json');
  const put = (tasks: { title: string; deps?: string[] }[], states: Record<string, Record<string, unknown>>) => {
    acc(dir, ['import'], JSON.stringify(tasks.map((t) => ({ source: { kind: 'manual' }, ...t }))));
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    for (const t of ledger.tasks) Object.assign(t, states[t.id]);
    writeFileSync(ledgerPath, JSON.stringify(ledger));
  };
  put([{ title: 'Merged' }], { 'T-1': { state: 'done' } });
  assert.equal(status().out.trim(), 'Nothing in play.', 'done is left out');

  put([{ title: 'Fails CI' }, { title: 'In review' }, { title: 'Building' }, { title: 'Next up' }, { title: 'Also next' }, { title: 'Stuck' }, { title: 'Later', deps: ['T-5'] }], {
    'T-2': { state: 'review', pr: { number: 2, url: 'https://github.com/o/r/pull/2', state: 'open', ci: 'failing' } },
    'T-3': { state: 'review' },
    'T-4': { state: 'running' },
    'T-7': { state: 'blocked', blocker: 'needs a sandbox' },
  });

  const line = status();
  assert.equal(line.code, 0, line.err);
  assert.equal(line.out, '1 running · 1 needs you · 1 in review · 1 blocked · 2 ready · 1 to do\n');
  assert.deepEqual(status('--json').json(), { counts: { ...zero, running: 1, 'needs-you': 1, review: 1, blocked: 1, ready: 2, todo: 1, done: 1 } });
  assert.ok(!existsSync(mark), 'status never starts claude');
  assert.match(acc(dir, ['help']).out, /Tasks\n(?:.+\n)*? {2}acc status /);
});

test('builders are identified from ACC_ROLE and ACC_TASK', () => {
  const dir = repoWithConfig();
  acc(dir, ['add', 'Work']);
  acc(dir, ['set', 'T-1', 'running']);
  const r = acc(dir, ['set', 'T-1', 'blocked', '--reason', 'org is down', '--json'], undefined, { ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().entry.by, 'builder:T-1');
  assert.equal(r.json().task.blocker, 'org is down');
});

test('forced moves need a person and a reason, and are marked as overrides', () => {
  const dir = repoWithConfig();
  acc(dir, ['add', 'Work']);
  assert.match(acc(dir, ['set', 'T-1', 'done']).err, /A human can't move a task from todo to done/);
  assert.match(acc(dir, ['set', 'T-1', 'done', '--force']).err, /needs --reason/);
  const r = acc(dir, ['set', 'T-1', 'done', '--force', '--reason', 'finished by hand', '--json']);
  assert.equal(r.code, 0);
  assert.equal(r.json().entry.override, true);
});

test('import adds and refreshes tasks from tracker JSON', () => {
  const dir = repoWithConfig();
  const items = [
    { source: { kind: 'github', key: '#3', url: 'https://github.com/o/r/issues/3' }, title: 'Login page', deps: ['#2'] },
    { source: { kind: 'github', key: '#2' }, title: 'Auth service' },
  ];
  const first = acc(dir, ['import', '--json'], JSON.stringify(items)).json();
  assert.deepEqual(first.added, ['GH-3', 'GH-2']);
  items[0]!.title = 'Login page v2';
  const file = join(dir, 'tasks.json');
  writeFileSync(file, JSON.stringify(items));
  const again = acc(dir, ['import', '--file', file, '--json']).json();
  assert.deepEqual(again.updated, ['GH-3']);
  assert.deepEqual(again.unchanged, ['GH-2']);
  assert.equal(acc(dir, ['import'], '{"not":"a list"}').code, 2);
});

test('commands that need a config say how to get one', () => {
  const r = acc(makeRepo(), ['list']);
  assert.equal(r.code, 1);
  assert.match(r.err, /Run "acc init" first/);
  assert.match(acc(makeRepo(), ['list', '--json']).out, /"error":\s*"no-config"/);
});

test('doctor --step runs only the named checks, and rejects unknown ids', () => {
  const dir = repoWithConfig();
  const r = acc(dir, ['doctor', '--step', 'B0.config', '--step', 'B0.repo', '--json']).json() as { id: string }[];
  assert.deepEqual(r.map((x) => x.id).sort(), ['B0.config', 'B0.repo']);
  assert.equal(acc(dir, ['doctor', '--step', 'Z9.nope']).code, 2);
});

test('intake github reads open issues as the repo\'s account and upserts them', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, github: { repo: 'o/r', account: 'me' } });
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  const issues = JSON.stringify([{ number: 4, title: 'Fix login', body: 'Depends on #3', url: 'https://github.com/o/r/issues/4', labels: [] }]);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
case "$1 $2" in
  "auth token") [ "$4" = "me" ] && echo tok-me || exit 1 ;;
  "issue list") [ "$GH_TOKEN" = "tok-me" ] || { echo "wrong account" >&2; exit 1; }; echo '${issues}' ;;
  *) exit 1 ;;
esac
`);
  chmodSync(join(bin, 'gh'), 0o755);
  const r = acc(dir, ['intake', 'github', '--json'], undefined, { PATH: `${bin}:${process.env.PATH}` });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json().added, ['GH-4']);
  assert.equal(acc(dir, ['intake', 'jira']).code, 2, 'Jira intake goes through the plugin');
});

test('intake github moves closed issues\' tasks to done, removes skipped ones, and names those that started', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, github: { repo: 'o/r', account: 'me' }, trackers: [{ kind: 'github', skipLabels: ['milestone'] }] });
  const items = [3, 5, 6].map((n) => ({ source: { kind: 'github', key: `#${n}` }, title: `Issue ${n}` }));
  assert.equal(acc(dir, ['import'], JSON.stringify(items)).code, 0);
  assert.equal(acc(dir, ['set', 'GH-6', 'running']).code, 0);
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  const issues = JSON.stringify([{ number: 3, title: 'M3', body: '', url: 'u3', labels: [{ name: 'milestone' }] }, { number: 4, title: 'Issue 4', body: '', url: 'u4', labels: [] }]);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
case "$1 $2" in
  "auth token") echo tok ;;
  "issue list") echo '${issues}' ;;
  "issue view") echo "{\\"number\\": $3, \\"state\\": \\"CLOSED\\", \\"labels\\": []}" ;;
  *) exit 1 ;;
esac
`);
  chmodSync(join(bin, 'gh'), 0o755);
  const env = { PATH: `${bin}:${process.env.PATH}` };
  const text = acc(dir, ['intake', 'github'], undefined, env);
  assert.equal(text.code, 0, text.err);
  assert.deepEqual(text.out.trim().split('\n'), [
    'Added GH-4',
    'Done GH-5: closed on GitHub before work started',
    'Removed GH-3: their issues have a label in skipLabels',
    '! #6 was closed on GitHub; GH-6 is still running',
  ]);
  const json = acc(dir, ['intake', 'github', '--json'], undefined, env).json();
  assert.deepEqual([json.closed, json.removed, json.unchanged], [[], [], ['GH-4']]);
  assert.deepEqual(json.leftAlone, [{ task: 'GH-6', issue: '#6', state: 'running', note: '#6 was closed on GitHub; GH-6 is still running' }]);
  assert.deepEqual((acc(dir, ['list', '--json']).json() as { id: string; state: string }[]).map((t) => `${t.id} ${t.state}`), ['GH-5 done', 'GH-6 running', 'GH-4 todo']);
});

test('gate run records receipts on the commit, exits 1 while a required check fails, and gate list shows them', () => {
  const heavy = { ACC_HEAVY_DIR: join(makeRepo(), 'slots') };
  const cfg = { ...GENERIC_CONFIG, gates: { required: ['lint', 'test'], commands: { lint: 'true', test: 'echo "1 failing"; exit 3' } } };
  const dir = repoWithConfig(cfg);
  const failing = acc(dir, ['gate', 'run'], undefined, heavy);
  assert.equal(failing.code, 1, failing.err);
  assert.match(failing.out, /✓ pass\s+lint/);
  assert.match(failing.out, /✗ fail\s+test\s+1 failing/);
  assert.match(failing.out, /1 to fix: test\./);
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  assert.equal(JSON.parse(readFileSync(join(dir, '.git', 'acc', 'receipts', sha, 'test.json'), 'utf8')).status, 'fail');

  writeFileSync(join(dir, '.acc', 'config.json'), JSON.stringify({ ...cfg, gates: { ...cfg.gates, commands: { lint: 'true', test: 'true' } } }));
  assert.match(acc(dir, ['gate', 'run'], undefined, heavy).out, /Not recorded: there are uncommitted changes/);
  spawnSync('git', ['commit', '-qam', 'fix the test'], { cwd: dir });
  const passing = acc(dir, ['gate', 'run'], undefined, heavy);
  assert.equal(passing.code, 0, passing.err);
  assert.match(passing.out, /All recorded\. acc done will accept this commit\./);
  const list = acc(dir, ['gate', 'list', '--json']).json() as { gates: { name: string; required: boolean; heavy: boolean; receipt: { status: string } | null }[] };
  assert.deepEqual(list.gates.map((g) => [g.name, g.required, g.heavy, g.receipt?.status]), [['lint', true, false, 'pass'], ['test', true, true, 'pass']]);
  assert.equal(acc(dir, ['gate', 'run', 'nope']).code, 2, 'an unknown gate is a usage error');
  assert.equal(acc(dir, ['gate', 'run', 'lint', '--test', 'not a class']).code, 2);
  assert.match(acc(dir, ['drift', 'main']).err, /no orgs/);
});

test('acc gate waive: a person waives a task\'s failing check with a reason; a builder never can (D-031)', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, gates: { required: ['test'], commands: { test: 'exit 3' } } });
  assert.equal(acc(dir, ['add', 'Try the process', '--json']).code, 0);
  const branch = spawnSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  const ledgerPath = join(dir, '.git', 'acc', 'ledger.json');
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  ledger.tasks[0].run = { branch };
  writeFileSync(ledgerPath, JSON.stringify(ledger));
  const id = ledger.tasks[0].id as string;
  // Its own slots, so it never waits on a real check, such as the one running these tests.
  const heavy = { ACC_HEAVY_DIR: join(makeRepo(), 'slots') };
  assert.equal(acc(dir, ['gate', 'run'], undefined, heavy).code, 1);
  const builder = acc(dir, ['gate', 'waive', 'test', '--task', id, '--reason', 'mine', '--as', 'human'], undefined, { ACC_ROLE: 'builder', ACC_TASK: id });
  assert.equal(builder.code, 1);
  assert.match(builder.err, /A builder can't waive its own checks/);
  assert.match(acc(dir, ['gate', 'waive', 'test', '--task', id]).err, /Say why/);
  const r = acc(dir, ['gate', 'waive', 'test', '--task', id, '--reason', 'a test task, never promoted', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().waived[0].waived.was, 'fail');
  const list = acc(dir, ['gate', 'list', '--json']).json();
  assert.equal(list.gates[0].receipt.status, 'skip');
});

test('acc autopilot: manual does nothing; dispatch isn\'t built yet, and full is read as it; usage, roles and the lock (D-055)', () => {
  const GH = { ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'jordan-kim' } };
  const dir = repoWithConfig(GH);
  const setAutonomy = (autonomy: string, config: object = GH) => writeFileSync(join(dir, '.acc', 'config.json'), JSON.stringify({ ...config, autonomy }));
  assert.equal(acc(dir, ['add', 'Ready to start']).code, 0);
  const ledgerFile = join(dir, '.git', 'acc', 'ledger.json');
  const ledger = readFileSync(ledgerFile, 'utf8');

  const manual = acc(dir, ['autopilot', '--json']);
  assert.equal(manual.code, 0, manual.err);
  assert.deepEqual(manual.json(), { autonomy: 'manual', warnings: [], steps: [], pendingComments: [] });
  assert.match(acc(dir, ['autopilot']).out, /autonomy is "manual" in \.acc\/config\.json, so autopilot does nothing/);
  assert.equal(readFileSync(ledgerFile, 'utf8'), ledger, 'the ledger is untouched');
  assert.ok(!existsSync(join(dir, '.git', 'acc', 'autopilot.lock')));

  setAutonomy('dispatch');
  const dispatch = acc(dir, ['autopilot']);
  assert.equal(dispatch.code, 1);
  assert.match(dispatch.err, /not built yet/);
  setAutonomy('full');
  const full = acc(dir, ['autopilot']);
  assert.equal(full.code, 1);
  assert.match(full.err, /warning: autonomy "full" is read as "dispatch"\.[\s\S]*not built yet/);
  assert.equal(readFileSync(ledgerFile, 'utf8'), ledger, 'refused before doing anything');

  setAutonomy('review');
  assert.equal(acc(dir, ['autopilot', '--once', '--every', '60']).code, 2, 'one pass, or repeated: not both');
  assert.equal(acc(dir, ['autopilot', '--every', '5']).code, 2, 'at least 30 seconds between passes');
  for (const role of ['builder', 'reviewer', 'analyst']) {
    const r = acc(dir, ['autopilot'], undefined, { ACC_ROLE: role, ACC_TASK: 'T-1' });
    assert.equal(r.code, 1, role);
    assert.match(r.err, new RegExp(`A ${role} can't run autopilot`));
  }
  const once = acc(dir, ['autopilot', '--once', '--json']);
  assert.equal(once.code, 0, once.err);
  assert.deepEqual(once.json().steps.map((s: { task: string; step: string | null; outcome: string }) => [s.task, s.step, s.outcome]), [['T-1', null, 'skipped']], 'a task to do is never started');
  assert.equal(acc(dir, ['autopilot']).out.trim(), 'Nothing for autopilot to do.');

  // Another autopilot holds the lock: this test's own process stands in for it.
  const lock = join(dir, '.git', 'acc', 'autopilot.lock');
  mkdirSync(lock);
  writeFileSync(join(lock, 'owner'), JSON.stringify({ pid: process.pid, at: Date.now() }));
  const second = acc(dir, ['autopilot']);
  assert.equal(second.code, 1);
  assert.match(second.err, new RegExp(`Autopilot is already running here \\(pid ${process.pid}\\)`));

  setAutonomy('review', GENERIC_CONFIG);
  assert.match(acc(dir, ['autopilot']).err, /no "github" section/, 'it couldn\'t land anything');
});

test('acc autopilot runs on a repo where no task was ever added, which has no state folder yet', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'jordan-kim' }, autonomy: 'review' });
  assert.ok(!existsSync(join(dir, '.git', 'acc')));
  const once = acc(dir, ['autopilot', '--once', '--json']);
  assert.equal(once.code, 0, once.err);
  assert.deepEqual(once.json().steps, []);
  assert.equal(acc(dir, ['autopilot']).out.trim(), 'Nothing for autopilot to do.');
  assert.ok(!existsSync(join(dir, '.git', 'acc', 'autopilot.lock')), 'let go when it ends');
});

test('a task autopilot couldn\'t move on shows as needs you, and acc show says why (D-055)', () => {
  const dir = repoWithConfig();
  assert.equal(acc(dir, ['add', 'Add a sum function']).code, 0);
  assert.equal(acc(dir, ['set', 'T-1', 'running']).code, 0);
  assert.equal(acc(dir, ['set', 'T-1', 'review', '--as', 'builder']).code, 0);
  const file = join(dir, '.git', 'acc', 'ledger.json');
  const l = JSON.parse(readFileSync(file, 'utf8'));
  l.tasks[0].autopilot = { failed: { step: 'land', sha: 'abcdef0123456789abcdef0123456789abcdef01', state: 'review', reason: 'git push refused task/T-1-add-a-sum-function: rejected', at: '2026-10-05T12:00:00.000Z' } };
  writeFileSync(file, JSON.stringify(l));
  assert.match(acc(dir, ['show', 'T-1']).out, /T-1 {2}! Needs you {2}Add a sum function\n[\s\S]*! Autopilot couldn't land abcdef0: git push refused task\/T-1-add-a-sum-function: rejected/);
  assert.equal(acc(dir, ['list', '--json']).json()[0].display, 'needs-you');
  assert.match(acc(dir, ['status']).out, /1 needs you/);

  // A pull request it couldn't update from its base (D-058), in words.
  l.tasks[0].autopilot.failed = { ...l.tasks[0].autopilot.failed, step: 'refresh', reason: 'Conflicts with main that autopilot can\'t resolve: sum.js. The branch is as it was, at abcdef0, and nothing was pushed.' };
  writeFileSync(file, JSON.stringify(l));
  assert.match(acc(dir, ['show', 'T-1']).out, /! Autopilot couldn't update abcdef0 from its base: Conflicts with main that autopilot can't resolve: sum\.js\./);
});
