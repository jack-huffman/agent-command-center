// This repo's near-tests gate (GH-73, GH-95): it builds first when a test near the change reads the build,
// runs only the tests near the change, passes when none is, and fails when acc didn't say which. After
// GH-94's split, every area module still has tests near it.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { nearTests, readsNearTests } from '../../packages/core/src/gates.ts';
import { fakeBin, tempDir } from '../../packages/core/test/support.ts';
import { areaFiles, FOLDERS } from '../areas.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const PASS = 'import { test } from \'node:test\';\ntest(\'a near test passes\', () => {});\n';
const FAIL = 'import { test } from \'node:test\';\ntest(\'a near test fails\', () => { throw new Error(\'no\'); });\n';

/** Runs the gate in a folder holding these tests, with npm a stand-in that logs what it's asked and exits with `npmExit`. */
function gate(near: string | undefined, tests: Record<string, string> = {}, npmExit = 0) {
  const dir = tempDir('near-tests-');
  for (const [rel, text] of Object.entries(tests)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  const log = join(dir, 'npm.log');
  const env = fakeBin('npm', `echo "$*" >> '${log}'\nexit ${npmExit}\n`);
  // Not a test this runner started: the gate's own node --test reports for itself.
  delete env.NODE_TEST_CONTEXT;
  if (near === undefined) delete env.ACC_NEAR_TESTS;
  else env.ACC_NEAR_TESTS = near;
  const r = spawnSync(process.execPath, ['--no-warnings', join(ROOT, 'scripts', 'near-tests.mjs')], { cwd: dir, env, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr, npm: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

test('the gate builds first when a test near the change reads the build: the extension\'s, the scripts\' or the launcher\'s', () => {
  for (const t of ['extension/test/tabs.test.mjs', 'scripts/test/docs.test.mjs', 'packages/cli/test/launcher.test.ts']) {
    const r = gate(`${t}\npackages/core/test/ledger.test.mjs`, { [t]: PASS, 'packages/core/test/ledger.test.mjs': PASS });
    assert.equal(r.code, 0, r.out);
    assert.equal(r.npm, 'run build\n', t);
    assert.match(r.out, /✔ a near test passes/);
  }
});

test('the gate runs the near tests without a build when none reads it, and fails when one fails', () => {
  const r = gate('packages/core/test/ledger.test.mjs', { 'packages/core/test/ledger.test.mjs': PASS, 'packages/core/test/other.test.mjs': FAIL });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.npm, '', 'no build');
  assert.match(r.out, /✔ a near test passes/);
  assert.doesNotMatch(r.out, /a near test fails/, 'only the tests near the change');
  assert.equal(gate('packages/core/test/other.test.mjs', { 'packages/core/test/other.test.mjs': FAIL }).code, 1);
});

test('a build that fails fails the gate before any test runs', () => {
  const r = gate('extension/test/tabs.test.mjs', { 'extension/test/tabs.test.mjs': PASS }, 2);
  assert.equal(r.code, 2);
  assert.doesNotMatch(r.out, /a near test passes/);
});

test('the gate passes when no test is near the change, running nothing, and fails when acc didn\'t say which are', () => {
  const none = gate('');
  assert.deepEqual([none.code, none.npm], [0, '']);
  assert.match(none.out, /No tests near the change\./);
  const unset = gate(undefined);
  assert.equal(unset.code, 1);
  assert.match(unset.out, /ACC_NEAR_TESTS isn't set/);
});

test('acc gives this repo\'s near-tests gate ACC_NEAR_TESTS, and its typecheck and full check go without', () => {
  const { gates } = JSON.parse(readFileSync(join(ROOT, '.acc', 'config.json'), 'utf8')) as { gates: { commands: Record<string, string> } };
  assert.equal(readsNearTests(ROOT, gates.commands['near-tests']!), true);
  assert.equal(readsNearTests(ROOT, gates.commands.typecheck!), false);
  assert.equal(readsNearTests(ROOT, gates.commands.check!), false);
});

test('after the split (D-099), every area module has tests near it: the CLI\'s are cli.test.ts, and an extension area\'s include its entry\'s', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  const read = (f: string): string | null => {
    try {
      return readFileSync(join(ROOT, f), 'utf8');
    } catch {
      return null;
    }
  };
  // What loads each folder's index, whose tests count for every module in it.
  const entry: Record<string, string> = {
    'packages/cli/src/commands': 'packages/cli/test/cli.test.ts',
    'extension/src': 'extension/test/activate.test.ts',
    'extension/webview': 'extension/test/screenshot.test.ts',
  };
  let checked = 0;
  for (const folder of FOLDERS) {
    for (const file of areaFiles(folder).map((f) => `${folder.dir}/${f}`)) {
      const near = nearTests([file], tracked, read);
      assert.ok(near.length, `${file} has tests near it`);
      if (entry[folder.dir]) assert.ok(near.includes(entry[folder.dir]!), `${file}: ${near.join(', ')}`);
      checked++;
    }
  }
  assert.ok(checked >= 50, `${checked} area modules`);
});
