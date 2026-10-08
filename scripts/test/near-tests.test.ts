// This repo's near-tests gate (GH-73, GH-95, GH-117): it builds first when a test near the change reads the
// build, runs only the tests near the change and those of what reads a per-area file it changed, passes when
// none is, and fails when acc didn't say which. After GH-94's split, every area module still has tests near
// it, and a module of core isn't near tests that only quote an index.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { nearTests } from '../../packages/core/src/gates.ts';
import { fakeBin, makeRepo } from '../../packages/core/test/support.ts';
import { areaFiles, CORE_INDEX, FOLDERS } from '../areas.ts';
import { nearReaders, READS } from '../near-reads.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const PASS = 'import { test } from \'node:test\';\ntest(\'a near test passes\', () => {});\n';
const FAIL = 'import { test } from \'node:test\';\ntest(\'a near test fails\', () => { throw new Error(\'no\'); });\n';

/**
 * Runs the gate in a checkout holding these files, told the near tests and what changed, with npm a stand-in
 * that logs what it's asked and exits with `npmExit`.
 */
function gate(near: string | undefined, files: Record<string, string> = {}, npmExit = 0, changed = '') {
  const dir = makeRepo(files);
  const log = join(dir, 'npm.log');
  const env = fakeBin('npm', `echo "$*" >> '${log}'\nexit ${npmExit}\n`);
  // Not a test this runner started: the gate's own node --test reports for itself.
  delete env.NODE_TEST_CONTEXT;
  if (near === undefined) delete env.ACC_NEAR_TESTS;
  else env.ACC_NEAR_TESTS = near;
  // Nor what the acc running these tests says changed.
  env.ACC_CHANGED = changed;
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

test('a per-area file a test reads through a script brings that test, though acc found none near it (GH-117)', () => {
  const files = {
    'extension/package.json': '{}\n', 'extension/webview/tasks.css': '.task {}\n', 'extension/scripts/styles.ts': '',
    // node --test runs it, so it names the reader in a comment: // reads '../scripts/styles.ts'
    'extension/test/screenshot.test.ts': `${PASS}// reads '../scripts/styles.ts'\n`, 'extension/test/other.test.ts': FAIL,
  };
  const r = gate('', files, 0, 'extension/webview/tasks.css');
  assert.equal(r.code, 0, r.out);
  assert.equal(r.npm, 'run build\n', 'its test reads the build');
  assert.match(r.out, /Tests near the change: extension\/test\/screenshot\.test\.ts\n/);
  assert.match(r.out, /✔ a near test passes/);
  assert.doesNotMatch(r.out, /a near test fails/);
  assert.equal(gate(undefined, files, 0, 'extension/webview/tasks.css').code, 1, 'still fails when acc didn\'t say which');
});

test('the gate passes when no test is near the change, running nothing, and fails when acc didn\'t say which are', () => {
  const none = gate('');
  assert.deepEqual([none.code, none.npm], [0, '']);
  assert.match(none.out, /No tests near the change\./);
  const unset = gate(undefined);
  assert.equal(unset.code, 1);
  assert.match(unset.out, /ACC_NEAR_TESTS isn't set/);
});

/** This checkout's files, and a file's text, as acc gives nearTests them. */
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
const read = (f: string): string | null => {
  try {
    return readFileSync(join(ROOT, f), 'utf8');
  } catch {
    return null;
  }
};

test('after the split (D-099), every area module has tests near it: the CLI\'s are cli.test.ts, and an extension area\'s include its entry\'s', () => {
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

test('a module of core is near its own tests and the one that loads core\'s index by its path, not gates.test.ts, which only quotes indexes (GH-117)', () => {
  const index = `${CORE_INDEX.dir}/${CORE_INDEX.index}`;
  const lock = 'packages/core/test/lock.test.ts';
  const gates = 'packages/core/test/gates.test.ts';
  assert.ok(read(lock)?.includes('\'../src/index.ts\''), 'lock.test.ts loads core\'s index by its path');
  let checked = 0;
  for (const m of tracked.filter((f) => f.startsWith(`${CORE_INDEX.dir}/`) && /^[^/]+\.ts$/.test(f.slice(CORE_INDEX.dir.length + 1)) && f !== index)) {
    const stem = m.split('/').at(-1)!.replace(/\.ts$/, '');
    // Its own tests: named for it, or naming a path that ends in it.
    const own = (t: string): boolean => t.endsWith(`/${stem}.test.ts`) || new RegExp(`['"\`][^'"\`\\n]*/${stem}(\\.[cm]?[jt]sx?)?['"\`]`).test(read(t) ?? '');
    const near = nearTests([m], tracked, read);
    assert.ok(near.includes(lock), `${m}: core's index gathers it, and lock.test.ts loads that`);
    assert.deepEqual(near.filter((t) => t !== lock && !own(t)), [], `${m}: nothing else the index adds`);
    assert.equal(near.includes(gates), own(gates), `${m}: gates.test.ts only if it names it`);
    checked++;
  }
  assert.ok(checked >= 40, `${checked} modules of core`);
});

test('a module extension.ts gathers is near activate.test.ts, which loads its build, so an index named for itself is still found by name (GH-117)', () => {
  const entry = 'extension/src/extension.ts';
  const gathered = [...read(entry)!.matchAll(/from '\.\/([^'/]+\.ts)'/g)].map((m) => `extension/src/${m[1]}`).filter((f) => tracked.includes(f));
  for (const f of gathered) assert.ok(nearTests([f], tracked, read).includes('extension/test/activate.test.ts'), f);
  assert.ok(gathered.length >= 15, `${gathered.length} modules extension.ts gathers`);
});

const inFolder = (dir: string, ext: string): string[] => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(ext)).map((f) => `${dir}/${f}`);

test('each per-area file a test reads through a script is near it: every stylesheet screenshot.test.ts, every command list and package.json areas.test.ts (GH-117)', () => {
  const kinds = [
    // What styles.ts and generate.ts read: every .css beside the page's modules, every .json in commands/.
    { files: inFolder('extension/webview', '.css'), test: 'extension/test/screenshot.test.ts', least: 15 },
    { files: inFolder('extension/commands', '.json'), test: 'extension/test/areas.test.ts', least: 10 },
    { files: ['extension/package.json'], test: 'extension/test/areas.test.ts', least: 1 },
  ];
  for (const k of kinds) {
    for (const f of k.files) {
      assert.ok(tracked.includes(f), `${f} is in the checkout`);
      assert.ok(nearReaders([f], () => tracked, read).includes(k.test), `${f}: ${nearReaders([f], () => tracked, read).join(', ')}`);
    }
    assert.ok(k.files.length >= k.least, `${k.files.length} files near ${k.test}`);
  }
  for (const r of READS) assert.ok(tracked.includes(r.reader), `${r.reader} is in the checkout`);
  assert.deepEqual(nearReaders(['extension/src/runs.ts', 'README.md'], () => assert.fail('no reader, so no listing'), read), [], 'other files have no reader');
});
