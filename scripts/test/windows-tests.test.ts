// What CI's Windows job skips (D-T-123): one named list of files and single tests, each with why, every one in
// a file npm test runs, and a list that only shrinks: no longer than it is where this branch left main.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tempDir } from '../../packages/core/test/support.ts';
import { testGlobs } from '../test-globs.ts';
import { skipOnWindows, WINDOWS_SKIPS, windowsSelection } from '../windows-tests.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const LIST = 'scripts/windows-tests.ts';

const git = (...args: string[]) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });

/** How many entries, files and single tests, a version of the list holds. */
const listed = (text: string): number => [...text.matchAll(/^\s*\{ file: '/gm)].length;

test('every skipped file is one npm test runs, with why, and the rest of them run on Windows', () => {
  const s = windowsSelection();
  assert.deepEqual(s.missing, []);
  assert.equal(s.skipped.length, WINDOWS_SKIPS.length, 'each listed file is one npm test runs');
  assert.ok(s.run.length > 150, `${s.run.length} files run on Windows: too few`);
  for (const k of WINDOWS_SKIPS) assert.ok(k.why.length > 20, `${k.file} needs a reason`);
  assert.equal(new Set(WINDOWS_SKIPS.map((k) => `${k.file}#${k.test ?? ''}`)).size, WINDOWS_SKIPS.length, 'each file or test once');
  for (const k of WINDOWS_SKIPS.filter((e) => e.test)) {
    assert.ok(s.run.includes(k.file), `${k.file} runs on Windows, so its one skipped test is skipped there, not the file`);
    assert.ok(readFileSync(join(ROOT, k.file), 'utf8').includes('skipOnWindows('), `${k.file} skips "${k.test}" through skipOnWindows`);
  }
  assert.ok(s.run.includes('packages/core/test/start.test.ts') && s.run.includes('packages/core/test/shell.test.ts'), 'the start and shell helpers\' tests run there');
  assert.equal(listed(readFileSync(join(ROOT, LIST), 'utf8')), WINDOWS_SKIPS.length, 'the count the shrink check reads is the list\'s');
  console.log(`windows-tests: ${s.skipped.length} skipped on Windows (${WINDOWS_SKIPS.filter((k) => !k.test).length} files, ${WINDOWS_SKIPS.filter((k) => k.test).length} single tests), ${s.run.length} files run`);
});

test('the list is no longer than where this branch left main: it only shrinks', () => {
  const main = ['origin/main', 'main'].find((b) => git('rev-parse', '--verify', '--quiet', b).status === 0);
  assert.ok(main, 'neither origin/main nor main is here to compare with');
  const base = git('merge-base', 'HEAD', main).stdout.trim();
  assert.ok(base, `no merge base with ${main}`);
  const then = git('show', `${base}:${LIST}`);
  if (then.status !== 0) {
    console.log(`windows-tests: ${LIST} isn't on ${main} yet; its ${WINDOWS_SKIPS.length} entries are the first count`);
    return;
  }
  assert.ok(WINDOWS_SKIPS.length <= listed(then.stdout), `${WINDOWS_SKIPS.length} skipped on Windows, up from ${listed(then.stdout)} on ${main}: make the file run there instead`);
});

test('edge case: a listed file that\'s gone is missing, and one npm test doesn\'t run isn\'t counted as skipped', () => {
  const dir = tempDir('acc-windows-');
  mkdirSync(join(dir, 'test'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test "test/*.test.ts"' } }));
  writeFileSync(join(dir, 'test', 'a.test.ts'), '');
  writeFileSync(join(dir, 'test', 'b.test.ts'), '');
  writeFileSync(join(dir, 'other.test.ts'), '');
  assert.deepEqual(testGlobs(dir), ['test/*.test.ts']);
  const s = windowsSelection(dir, [{ file: 'test/a.test.ts', why: 'x' }, { file: 'test/gone.test.ts', why: 'y' }, { file: 'other.test.ts', why: 'z' }]);
  assert.deepEqual(s.run, ['test/b.test.ts']);
  assert.deepEqual(s.skipped.map((k) => k.file), ['test/a.test.ts']);
  assert.deepEqual(s.missing, ['test/gone.test.ts']);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: {} }));
  assert.deepEqual(windowsSelection(dir, []).run, [], 'no test script: nothing to run, which the run fails on');
});

test('edge case: a single test skips on Windows with its entry\'s reason, runs elsewhere, and a skip the list doesn\'t hold fails', () => {
  const list = [{ file: 'a.test.ts', test: 'sends a signal', why: 'Windows has no signals.' }, { file: 'b.test.ts', why: 'whole file' }];
  assert.equal(skipOnWindows('a.test.ts', 'sends a signal', 'win32', list), 'Windows has no signals.');
  assert.equal(skipOnWindows('a.test.ts', 'sends a signal', 'darwin', list), false, 'a Mac runs it');
  assert.equal(skipOnWindows('a.test.ts', 'sends a signal', 'linux', list), false, 'Linux runs it');
  assert.throws(() => skipOnWindows('a.test.ts', 'another test', 'win32', list), /doesn't name it with why/);
  assert.throws(() => skipOnWindows('b.test.ts', 'any', 'darwin', list), /doesn't name it with why/, 'a whole-file entry is no test\'s skip');
  const s = windowsSelection(ROOT, [{ file: 'extension/test/stops.test.ts', test: 'x', why: 'y' }]);
  assert.ok(s.run.includes('extension/test/stops.test.ts'), 'a file with one skipped test still runs');
});
