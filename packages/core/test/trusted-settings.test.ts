// The project's settings as a run trusts them (D-T-115): read from the main checkout in a worktree, else
// from the environment's branch with origin's copy first; and a run in a worktree runs a command gate or a
// ratchet only as those settings have it, refusing one the worktree's own copy adds or changes.
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type Config, parseConfig } from '../src/config.ts';
import { run } from '../src/exec.ts';
import { runGates } from '../src/gates.ts';
import { repoPaths } from '../src/paths.ts';
import { readReceipt } from '../src/receipts.ts';
import { type TrustedRun, type TrustedSettings, trustedSettings, untrustedGates } from '../src/trusted-settings.ts';
import { fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, ok, tempDir } from './support.ts';

const now = () => new Date('2026-10-23T12:00:00Z');
const config = (raw: unknown): Config => {
  const r = parseConfig(raw);
  assert.deepEqual(r.errors, []);
  return r.config!;
};
const write = (dir: string, rel: string, text: string) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const commitAll = (dir: string, msg = 'change') => { gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-q', '-m', msg); };
/** A generic project whose main checkout runs lint and a tests ratchet; stray-files has its own tests (GH-103). */
const RAW = { ...GENERIC_CONFIG, strayFiles: { required: false }, gates: { required: ['lint'], commands: { lint: 'echo lint' }, ratchets: { tests: { command: 'echo 5', limit: 'floor', label: 'tests' } } } };

/** A main checkout on main with RAW committed, and T-1's worktree on its own branch beside it, as acc dispatch leaves it. */
function worktreeFixture() {
  const main = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(RAW), '.gitignore': '.claude/\n', 'src/a.js': 'a\n' }));
  const wt = join(main, '.claude', 'worktrees', 'T-1');
  gitIn(main, 'worktree', 'add', '-q', '-b', 'task/T-1-thing', wt, 'main');
  const paths = repoPaths(wt, run);
  const env = config(RAW).environments[0]!;
  /** The worktree's settings written and committed as `raw` says, with a change to a source file beside them. */
  const settle = (raw: unknown, msg: string) => {
    write(wt, '.acc/config.json', JSON.stringify(raw));
    write(wt, 'src/a.js', `${msg}\n`);
    commitAll(wt, msg);
    return config(raw);
  };
  const calls: string[] = [];
  const runner = fakeRunner({ 'nice -n 15 sh -c': ok('ok') }, calls);
  const gates = (c: Config, names: string[] = []) => runGates(paths, c, env, names, [], { run: runner, now, slots: { dir: tempDir('slots-') }, task: 'T-1' });
  return { main, wt, paths, env, settle, gates, calls, trusted: { paths, runner: run } as TrustedRun };
}

test('a worktree whose settings add a command gate the main checkout lacks is refused by acc gate run, naming the gate and where the project\'s settings were read', () => {
  const f = worktreeFixture();
  const added = f.settle({ ...RAW, gates: { ...RAW.gates, required: ['lint', 'sneaky'], commands: { ...RAW.gates.commands, sneaky: 'git push origin main' } } }, 'add a gate');
  assert.throws(() => f.gates(added), (e: Error & { code?: string }) => e.code === 'refused' && /^This checkout's \.acc\/config\.json names a check the project's settings don't, or with another command: gates\.commands\.sneaky isn't in the main checkout's settings \(.*\)\. A check runs only as the project's settings have it \(D-T-115\): a person changes them in the main checkout, and the task's branch takes the change with acc refresh\.$/.test(e.message));
  assert.throws(() => f.gates(added, ['lint']), /gates\.commands\.sneaky isn't in/, 'however few gates the run names: the settings are refused whole');
  assert.deepEqual(f.calls.filter((c) => c.startsWith('nice')), [], 'nothing ran');
  assert.equal(readReceipt(f.paths, gitIn(f.wt, 'rev-parse', 'HEAD'), 'lint'), null, 'no receipt');
  assert.match(untrustedGates(f.trusted, added, f.env)!, /gates\.commands\.sneaky isn't in the main checkout's settings/);
});

test('a command gate or a ratchet whose command differs from the main checkout\'s is refused, and the same settings run; a worktree with no command gate or ratchet compares nothing', () => {
  const f = worktreeFixture();
  const changed = f.settle({ ...RAW, gates: { ...RAW.gates, commands: { lint: 'echo lint; git push origin main' } } }, 'change lint');
  assert.throws(() => f.gates(changed), /gates\.commands\.lint runs "echo lint; git push origin main" here and "echo lint" in the main checkout's settings/);
  const ratchet = f.settle({ ...RAW, gates: { ...RAW.gates, ratchets: { tests: { command: 'echo 500', limit: 'floor', label: 'tests' } } } }, 'change the ratchet');
  assert.throws(() => f.gates(ratchet), /gates\.ratchets\.tests runs "echo 500" here and "echo 5" in the main checkout's settings/);
  const extra = f.settle({ ...RAW, gates: { ...RAW.gates, ratchets: { ...RAW.gates.ratchets, lines: { command: 'wc -l', limit: 'ceiling', label: 'lines' } } } }, 'add a ratchet');
  assert.throws(() => f.gates(extra), /gates\.ratchets\.lines isn't in the main checkout's settings/);
  // Both differ: each is named, commands first.
  const both = f.settle({ ...RAW, gates: { ...RAW.gates, commands: { lint: 'echo x' }, ratchets: { tests: { command: 'echo 9', limit: 'floor', label: 'tests' } } } }, 'change both');
  assert.match(untrustedGates(f.trusted, both, f.env)!, /gates\.commands\.lint runs "echo x" here .*; gates\.ratchets\.tests runs "echo 9" here/);
  // The same settings as the main checkout's: the run goes, and lint passes.
  const same = f.settle(RAW, 'back to the project\'s');
  assert.equal(untrustedGates(f.trusted, same, f.env), null);
  const r = f.gates(same, ['lint']);
  assert.deepEqual(r.results.map((x) => [x.gate, x.status]), [['lint', 'pass']]);
  assert.ok(f.calls.some((c) => c.startsWith('nice -n 15 sh -c echo lint')), 'the project\'s command ran');
  // Nothing to compare: a checkout with no command gate or ratchet, whatever the main checkout has.
  const none = f.settle({ ...RAW, gates: { required: [] } }, 'no gates');
  assert.equal(untrustedGates(f.trusted, none, f.env), null);
  assert.deepEqual(f.gates(none).results.map((x) => [x.gate, x.status]), [['stray-files', 'skip']], 'nothing required: the built-in alone runs, and skips where the project turned it off (GH-103)');
});

test('in the main checkout nothing is compared, and a main checkout whose settings can\'t be read refuses a worktree\'s command gate rather than run it', () => {
  // The main checkout's own settings are the person's: a command gate there runs as written.
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(RAW) });
  const c = config({ ...RAW, gates: { ...RAW.gates, commands: { lint: 'echo other' } } });
  assert.equal(untrustedGates({ paths: repoPaths(dir, run), runner: run }, c, c.environments[0]!), null);
  const calls: string[] = [];
  runGates(repoPaths(dir, run), c, c.environments[0]!, ['lint'], [], { run: fakeRunner({ 'nice -n 15 sh -c': ok('') }, calls), now, slots: { dir: tempDir('slots-') } });
  assert.ok(calls.some((x) => x.startsWith('nice -n 15 sh -c echo other')));
  // The main checkout's settings gone: a worktree's command gate is refused, not run on trust.
  const f = worktreeFixture();
  const same = f.settle(RAW, 'the same');
  write(f.main, '.acc/config.json', '{ not json');
  assert.throws(() => f.gates(same, ['lint']), /Couldn't read the project's settings from the main checkout.*A check runs only as the project's settings have it/);
  assert.deepEqual(f.calls.filter((c) => c.startsWith('nice')), [], 'nothing ran');
  // Not a repository at all: the comparison steps aside, and the run fails on that first.
  const nowhere = tempDir('nowhere-');
  assert.equal(untrustedGates({ paths: { ...f.paths, root: nowhere }, runner: run }, same, f.env), null);
});

test('on the environment\'s own branch the settings come from origin\'s copy after a fetch, before this clone\'s branch, which anyone could have moved; with no origin, the local branch', () => {
  const origin = tempDir('origin-');
  run('git', ['init', '-q', '--bare', origin]);
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(RAW), 'src/a.js': 'a\n' });
  const paths = repoPaths(dir, run);
  const env = { branch: 'main' };
  // No origin yet: the local branch is all there is.
  const local = trustedSettings({ paths, runner: run }, env) as TrustedSettings;
  assert.equal(local.from, 'main\'s committed settings (refs/heads/main)');
  assert.deepEqual(Object.keys(local.config.gates.commands), ['lint']);
  gitIn(dir, 'remote', 'add', 'origin', origin);
  gitIn(dir, 'push', '-q', 'origin', 'main');
  // Local main moves on with other settings; origin's copy says otherwise, and wins.
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-1-thing');
  gitIn(dir, 'checkout', '-q', 'main');
  write(dir, '.acc/config.json', JSON.stringify({ ...RAW, gates: { ...RAW.gates, commands: { lint: 'echo lint', sneaky: 'git push' } } }));
  commitAll(dir, 'local main moved');
  gitIn(dir, 'checkout', '-q', 'task/T-1-thing');
  // Forgotten here, so only the fetch finds origin's copy.
  run('git', ['update-ref', '-d', 'refs/remotes/origin/main'], { cwd: dir });
  const fetched = trustedSettings({ paths, runner: run }, env) as TrustedSettings;
  assert.equal(fetched.from, 'main\'s committed settings (refs/remotes/origin/main)');
  assert.deepEqual(Object.keys(fetched.config.gates.commands), ['lint'], 'origin\'s, not the moved local branch\'s');
  assert.equal(fetched.read('src/a.js'), 'a\n');
  assert.equal(fetched.read('src/none.js'), null);
  // A branch origin hasn't falls back to the local one, and one nowhere says which refs were tried, origin's first.
  gitIn(dir, 'branch', 'only-here', 'main');
  assert.equal((trustedSettings({ paths, runner: run }, { branch: 'only-here' }) as TrustedSettings).from, 'only-here\'s committed settings (refs/heads/only-here)');
  assert.match((trustedSettings({ paths, runner: run }, { branch: 'nowhere' }) as { problem: string }).problem, /^Couldn't read the project's settings from refs\/remotes\/origin\/nowhere or refs\/heads\/nowhere\./);
});
