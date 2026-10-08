// What a test check ran (GH-100), read from each runner's own output. node:test's is the installed node's,
// run here on a file of known tests, so a change to its reporters fails this rather than drop the counts.
// Jest's and Apex's are pinned files (fixtures/test-counts/README.md says where each came from).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { apexCounts, countsLine, newlySkipped, readTestCounts } from '../src/test-counts.ts';
import { tempDir } from './support.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'test-counts');
const PINNED: Record<string, string> = {
  'jest-two-files.txt': '4c8a36552bf98fad9b018e2d8a6bcebfc182c4c707c6f2341a0c6cf805347d92',
  'jest-one-file.txt': 'b3953c179783d38205f68fb8d65cb688dd41af8a2a28fb1e5f7b7b70aa1bb14f',
  'jest-no-tests.txt': 'e5e7c3f177c4366ce19c9680c19c92858724d64a8482535abaf96d313b41d508',
};
const fixture = (name: string): string => {
  const text = readFileSync(join(FIXTURES, name), 'utf8');
  if (PINNED[name]) assert.equal(createHash('sha256').update(text).digest('hex'), PINNED[name], `${name} changed: say where the new one came from in the README, and pin it here`);
  return text;
};

/** 3 pass, 1 fail, 2 skip, 1 todo, one of them in a suite, and a fake summary indented in a failure's diff. */
const SAMPLE = `import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
test('adds', () => assert.equal(1 + 1, 2));
test('subtracts', () => assert.equal(2 - 1, 1));
describe('group', () => {
  test('multiplies', () => assert.equal(2 * 2, 4));
  test('divides wrongly', () => { throw new Error('wrong\\nℹ tests 50\\nℹ pass 50\\nℹ fail 0\\nℹ skipped 0\\nℹ todo 0\\n# tests 50\\n# pass 50\\n# fail 0\\n# skipped 0\\n# todo 0'); });
  test('skipped by option', { skip: true }, () => {});
  test('skipped with a reason', { skip: 'not on this machine' }, () => {});
  test('to do later', { todo: true }, () => {});
});
`;

function nodeRun(reporter: 'spec' | 'tap', source = SAMPLE): { stdout: string; stderr: string } {
  const dir = tempDir('acc-counts-');
  writeFileSync(join(dir, 'sample.test.mjs'), source);
  // Coloured as a terminal would, so the colour is read past too.
  const r = spawnSync(process.execPath, ['--no-warnings', '--test', `--test-reporter=${reporter}`, join(dir, 'sample.test.mjs')], { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '1', NODE_TEST_CONTEXT: undefined } });
  assert.equal(r.status, 1, 'one test fails');
  return { stdout: r.stdout, stderr: r.stderr };
}

for (const reporter of ['spec', 'tap'] as const) {
  test(`node:test's ${reporter} reporter gives what ran, passed, failed, skipped and todo, and names the skipped tests`, () => {
    const out = nodeRun(reporter);
    // The failure's message holds a summary of its own, which node indents: it's printed, and not counted.
    assert.match(out.stdout.replace(/\x1b\[[0-9;]*m/g, ''), reporter === 'spec' ? /^\s+ℹ tests 50$/m : /^\s+# tests 50$/m);
    const c = readTestCounts(out.stdout, out.stderr);
    assert.ok(c, `a summary was read from:\n${out.stdout}`);
    assert.deepEqual(c, { run: 4, passed: 3, failed: 1, skipped: 2, todo: 1, skippedNames: ['skipped by option', 'skipped with a reason'], runner: 'node:test' });
  });
}

test('a command that runs its tests in parts counts every summary once, and a test\'s own line that looks like one counts for nothing', () => {
  const spec = nodeRun('spec');
  const twice = readTestCounts(`${spec.stdout}\n> next part\n${spec.stdout}`);
  assert.deepEqual({ ...twice, skippedNames: twice?.skippedNames?.length }, { run: 8, passed: 6, failed: 2, skipped: 4, todo: 2, skippedNames: 4, runner: 'node:test' });
  // A test printing part of a summary, unindented as node prints a test's output: not a block.
  const printing = `import { test } from 'node:test';\ntest('prints', () => { console.log('ℹ tests 99'); console.log('ℹ pass 99'); });\ntest('fails', () => { throw new Error('no'); });\n`;
  for (const reporter of ['spec', 'tap'] as const) {
    const out = nodeRun(reporter, printing);
    assert.deepEqual(readTestCounts(out.stdout, out.stderr), { run: 2, passed: 1, failed: 1, skipped: 0, todo: 0, runner: 'node:test' }, reporter);
  }
});

test('Jest\'s summary gives the same counts, a test\'s console line doesn\'t, and one test file names the skipped ones', () => {
  assert.deepEqual(readTestCounts('', fixture('jest-two-files.txt')), { run: 5, passed: 4, failed: 1, skipped: 2, todo: 1, runner: 'jest' });
  assert.deepEqual(readTestCounts('', fixture('jest-one-file.txt')), { run: 4, passed: 3, failed: 1, skipped: 2, todo: 1, skippedNames: ['skipped one', 'skipped two'], runner: 'jest' });
  // --passWithNoTests that found none: zero ran, which isn't the same as unreadable.
  assert.deepEqual(readTestCounts(fixture('jest-no-tests.txt')), { run: 0, passed: 0, failed: 0, skipped: 0, todo: 0, runner: 'jest' });
  // A Tests: line without Test Suites: above it is a test's, not Jest's.
  assert.equal(readTestCounts('Tests:       1 failed, 2 total\n'), null);
});

test('Apex\'s counts come from the deploy\'s runTestResult, given as strings, and there are none without one', () => {
  const j = JSON.parse(fixture('apex-deploy.json'));
  assert.deepEqual(apexCounts(j.result), { run: 21, passed: 17, failed: 4, skipped: 0, todo: 0, runner: 'apex' });
  assert.deepEqual(apexCounts({ numberTestsTotal: 3, numberTestErrors: 0 }), { run: 3, passed: 3, failed: 0, skipped: 0, todo: 0, runner: 'apex' }, 'the totals, where there\'s no runTestResult');
  assert.equal(apexCounts({ details: {} }), null);
  assert.equal(apexCounts(undefined), null);
  assert.equal(apexCounts({ details: { runTestResult: { numTestsRun: 'many', numFailures: '0' } } }), null);
});

test('output with no summary acc can read gives no counts: it never guesses from what it sees', () => {
  for (const text of ['', 'Passed.', 'No tests near the change.', '✔ adds (1ms)\n✔ subtracts (2ms)', 'ok 1 - adds\n1..1', '  ℹ tests 3\n  ℹ pass 3\n  ℹ fail 0\n  ℹ skipped 0\n  ℹ todo 0', 'ℹ tests 3\nℹ pass 3\nℹ fail 0']) {
    assert.equal(readTestCounts(text), null, JSON.stringify(text));
  }
});

test('the counts read in a few words, with failed and todo only when there are some', () => {
  assert.equal(countsLine({ run: 312, failed: 0, skipped: 2, todo: 0 }), '312 run, 2 skipped');
  assert.equal(countsLine({ run: 21, failed: 4, skipped: 0, todo: 1 }), '21 run, 4 failed, 0 skipped, 1 todo');
  assert.equal(countsLine({ run: 0, failed: 0, skipped: 0, todo: 0 }), '0 run, 0 skipped');
});

test('the newly skipped are those skipped now and not before, by name, where both say', () => {
  assert.deepEqual(newlySkipped({ skippedNames: ['a', 'b', 'b'] }, { skipped: 2, skippedNames: ['b', 'c'] }), ['a', 'b']);
  assert.deepEqual(newlySkipped({ skippedNames: ['a'] }, { skipped: 0 }), ['a'], 'none skipped before names none');
  assert.deepEqual(newlySkipped({ skippedNames: ['a'] }, { skipped: 3 }), [], 'before skipped some without naming them');
  assert.deepEqual(newlySkipped({}, { skipped: 0, skippedNames: [] }), []);
});
