// A test run removes the temp folders it makes (GH-174). Each child here runs with TMPDIR set to an empty
// folder, and that folder must be empty again once the child has exited, whether its tests passed or not.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { globSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { RUN_ROOT, tempDir } from './support.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SUPPORT = pathToFileURL(join(import.meta.dirname, 'support.ts')).href;
// What a test once wrote to make a folder straight in the system temp directory. Built from parts, so this
// file doesn't hold the pattern it looks for.
const RAW = 'mkdtempSync(join(' + 'tmpdir()';

/** Runs a test file in a child node, with TMPDIR set to a fresh empty folder; returns the folder too. */
function runIn(body: string, args: string[] = ['--test', '--test-reporter=tap']) {
  const empty = tempDir('empty-tmp-');
  const file = join(tempDir('child-'), 'child.test.ts');
  writeFileSync(file, [
    "import { mkdtempSync, writeFileSync } from 'node:fs';",
    "import { tmpdir } from 'node:os';",
    "import { join } from 'node:path';",
    "import { test } from 'node:test';",
    `import { tempDir } from '${SUPPORT}';`,
    body,
  ].join('\n'));
  // Without NODE_TEST_CONTEXT, which would make the child report to this run instead of running on its own.
  const { NODE_TEST_CONTEXT: _, ...env } = process.env;
  const r = spawnSync(process.execPath, ['--no-warnings', ...args, file], { encoding: 'utf8', env: { ...env, TMPDIR: empty } });
  return { ...r, empty, left: readdirSync(empty) };
}

const MAKES = `
  const a = tempDir();
  writeFileSync(join(a, 'x.txt'), 'x');
  tempDir('origin-');
  // What the code under test makes in the system temp directory lands in the run's root too.
  const system = tmpdir();
  mkdtempSync(join(system, 'acc-land-'));`;

test('the root is under the system temp directory, holds every tempDir, and is what tmpdir() now gives', () => {
  assert.match(relative(join(RUN_ROOT, '..'), RUN_ROOT), new RegExp(`^acc-run-${process.pid}-`));
  assert.equal(relative(RUN_ROOT, join(tempDir('origin-'), '..')), '');
  assert.equal(tmpdir(), RUN_ROOT);
});

test('a test file whose tests pass leaves nothing in the temp directory', () => {
  const r = runIn(`test('makes folders', () => {${MAKES}\n});\ntest('makes more', () => { tempDir('slots-'); });`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /# pass 2\b/, 'both tests ran');
  assert.deepEqual(r.left, []);
});

test('a test file whose test fails still leaves nothing in the temp directory', () => {
  const r = runIn(`test('makes folders, then fails', () => {${MAKES}\n  throw new Error('on purpose');\n});`);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /# fail 1\b/, 'the test ran and failed');
  assert.deepEqual(r.left, []);
});

test('a process ended by SIGTERM still leaves nothing in the temp directory', () => {
  const r = runIn(`${MAKES}\nprocess.kill(process.pid, 'SIGTERM');\nsetTimeout(() => {}, 5000);`, []);
  assert.equal(r.signal, 'SIGTERM', r.stdout + r.stderr);
  assert.deepEqual(r.left, []);
});

test('no test file makes a folder straight in the system temp directory, only through tempDir()', () => {
  const files = globSync(['packages/*/test/**/*.ts', 'extension/test/**/*.ts', 'scripts/test/**/*.ts'], { cwd: ROOT });
  assert.ok(files.length > 50, `checked ${files.length} test files`);
  const own = 'packages/core/test/temp-root.ts';
  assert.ok(files.includes(own) && readFileSync(join(ROOT, own), 'utf8').includes(RAW), 'the check finds the one place allowed to');
  const stray = files.filter((f) => f !== own && readFileSync(join(ROOT, f), 'utf8').includes(RAW));
  assert.deepEqual(stray, []);
});
