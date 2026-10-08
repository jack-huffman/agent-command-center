// This repo's tests ratchet (GH-99): scripts/count-tests.mjs counts the tests npm test runs without running
// them. A full node --test run over the same files is its oracle; it fails rather than count none, or count
// around a file that didn't load.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tempDir } from '../../packages/core/test/support.ts';

const ROOT = join(import.meta.dirname, '..', '..');

function folder(files: Record<string, string>): string {
  const dir = tempDir('count-tests-');
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

/** Runs node in `cwd` as a process of its own, not as part of this test run. */
function node(cwd: string, args: string[]) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--no-warnings', ...args], { cwd, env, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const count = (cwd: string, ...globs: string[]) => node(cwd, [join(ROOT, 'scripts', 'count-tests.mjs'), ...globs]);

test('the counter prints the number of tests a full node --test run counts, without running a body', () => {
  const ran = 'ran.txt';
  const dir = folder({
    'a/one.test.ts': `import { test } from 'node:test';\nimport { writeFileSync } from 'node:fs';\ntest('writes', () => { writeFileSync('${ran}', 'a body ran'); });\ntest('fails', () => { throw new Error('no'); });\n`,
    'a/two.test.ts': `import test from 'node:test';\nfor (const n of [1, 2, 3]) test(\`case \${n}\`, () => {});\ntest.skip('skipped', () => {});\ntest.todo('later');\ntest('with options', { timeout: 5 }, async () => { await new Promise((r) => setTimeout(r, 50)); });\n`,
    'b/three.test.ts': `import { it, describe, before } from 'node:test';\nbefore(() => { throw new Error('a hook ran'); });\ndescribe('a suite', () => { it('one', () => {}); it('two', () => {}); });\n`,
  });
  const counted = count(dir, 'a/*.test.ts', 'b/*.test.ts');
  assert.equal(counted.code, 0, counted.stderr);
  assert.ok(!existsSync(join(dir, ran)), 'no body ran');

  // The oracle: node:test's own count of a full run, which runs every body.
  const full = node(dir, ['--test', '--test-reporter=tap', 'a/*.test.ts', 'b/*.test.ts']);
  const oracle = /^# tests (\d+)$/m.exec(full.stdout)?.[1];
  assert.ok(oracle && Number(oracle) > 0, full.stdout);
  assert.ok(existsSync(join(dir, ran)), 'the full run ran the bodies');
  assert.equal(counted.stdout.trim().split('\n').at(-1), oracle);
  assert.equal(oracle, '10');
});

test('the counter fails rather than count none, or count around a file that didn\'t load', () => {
  const empty = count(folder({ 'readme.md': 'no tests here\n' }), 'test/*.test.ts');
  assert.notEqual(empty.code, 0);
  assert.equal(empty.stdout.trim(), '', 'no number to read');

  const broken = count(folder({ 'ok.test.ts': `import { test } from 'node:test';\ntest('fine', () => {});\n`, 'bad.test.ts': `import { test } from 'node:test';\nthrow new Error('broken at load');\n` }), '*.test.ts');
  assert.notEqual(broken.code, 0);
  assert.equal(broken.stdout.trim(), '');
  assert.match(broken.stderr, /couldn't be counted/);
});

test('with no globs, the counter counts the files npm test runs, by package.json\'s test script', () => {
  const dir = folder({
    'package.json': JSON.stringify({ scripts: { test: 'node --test "unit/*.test.ts" "more/*.test.ts"' } }),
    'unit/a.test.ts': `import { test } from 'node:test';\ntest('a', () => {});\ntest('b', () => {});\n`,
    'more/c.test.ts': `import { test } from 'node:test';\ntest('c', () => {});\n`,
    'other/d.test.ts': `import { test } from 'node:test';\ntest('d', () => {});\n`,
  });
  const r = count(dir);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), '3');
});
