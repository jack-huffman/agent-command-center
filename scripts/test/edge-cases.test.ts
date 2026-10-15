// The repo's edge-case rule (.acc/rules.md, T-2): every test file has a test whose name says which edge
// case it covers. Reviews kept finding the empty, failed, not-yet-arrived and cleared cases untested (14
// findings across 8 tasks). This walks every file npm test runs, counts them against git's own list of
// test files, and fails on none. OLDER names the files that predate the rule; each must still lack such a
// test, so the list only shrinks.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { npmTestFiles } from '../../packages/core/test/support.ts';

const ROOT = join(import.meta.dirname, '..', '..');

/** A word in a test's name that says it covers an edge case. */
export const EDGE = /\b(empty|none|nothing|no|zero|missing|without|fail(s|ed|ing|ure)?|errors?|can't|cannot|couldn't|isn't|aren't|doesn't|don't|won't|hasn't|never|refus(e|es|ed|ing)|unset|clear(s|ed)?|invalid|gone|stale|unknown|absent|unreadable|broken|yet)\b/i;

/** The test files that predate the rule, with no test named for an edge case. Only ever remove one. */
export const OLDER = [
  'extension/test/activate.test.ts',
  'extension/test/environments.test.ts',
  'extension/test/inline.test.ts',
  'extension/test/overview.test.ts',
  'packages/cli/test/github.test.ts',
  'packages/core/test/packet.test.ts',
  'packages/core/test/runtime.test.ts',
];

/** The names of the tests a file declares with test(...) or it(...), each as written in its first argument. */
export function testNames(source: string): string[] {
  return [...source.matchAll(/\b(?:test|it)(?:\.only)?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => (m[2] ?? '').replace(/\\(.)/g, '$1'));
}

/** Whether a file has a test whose name says it covers an edge case. */
export const coversEdge = (source: string): boolean => testNames(source).some((n) => EDGE.test(n));

const testFiles = (): string[] => npmTestFiles(ROOT);

test('every test file npm test runs has a test named for an edge case, but the older ones OLDER names', () => {
  const files = testFiles();
  // It ran: git's own list of tracked test files is the oracle for what was walked, and none is no check.
  const tracked = execFileSync('git', ['ls-files', '--', 'packages/*/test/*.test.ts', 'extension/test/*.test.ts', 'scripts/test/*.test.ts'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean).sort();
  assert.ok(files.length > 0, 'walked no test files');
  assert.deepEqual(files, tracked, 'the files walked should be the test files git tracks');
  const missing = files.filter((f) => !OLDER.includes(f) && !coversEdge(readFileSync(join(ROOT, f), 'utf8')));
  assert.deepEqual(missing, [], 'each of these needs a test whose name says which edge case it covers (an empty or failed result, nothing yet, a choice cleared, …)');
});

test('OLDER only shrinks: each file it names is still walked and still has no test named for an edge case', () => {
  const files = testFiles();
  assert.ok(OLDER.length > 0, 'OLDER is empty: delete it and this test');
  assert.deepEqual([...OLDER].sort(), OLDER, 'OLDER should stay sorted');
  for (const f of OLDER) {
    assert.ok(files.includes(f), `${f} is in OLDER but npm test doesn't run it: take it out of OLDER`);
    assert.equal(coversEdge(readFileSync(join(ROOT, f), 'utf8')), false, `${f} now has a test named for an edge case: take it out of OLDER`);
  }
});

test('a file of tests named only for the path that works fails the rule, and one naming an empty or failed case passes', () => {
  assert.deepEqual(testNames("test('adds a task', () => {});\nit(\"opens the board\", () => {});\ntest(`shows ${'x'}`, () => {});"), ['adds a task', 'opens the board', "shows ${'x'}"]);
  assert.deepEqual(testNames("test('the task\\'s board', () => {});"), ["the task's board"]);
  assert.equal(coversEdge("test('adds a task', () => {});\ntest('opens the board', () => {});"), false);
  assert.equal(coversEdge(''), false, 'a file with no tests covers no edge case');
  assert.equal(coversEdge("// an empty list\ntest('adds a task', () => {});"), false, 'only a test\'s name counts, not a comment');
  assert.equal(coversEdge("test('adds a task', () => {});\nit.todo('when the list is empty');\ntest.skip('when acc doctor fails', () => {});"), false, 'a skipped or to-do test checks nothing, so its name doesn\'t count');
  for (const name of ['with an empty list it adds nothing', 'when acc doctor fails', 'while the checks have no results yet', 'a cleared effort', 'it refuses a builder', 'the board can\'t be read']) {
    assert.equal(coversEdge(`test('adds a task', () => {});\ntest(${JSON.stringify(name)}, () => {});`), true, name);
  }
});

test('.acc/rules.md holds the edge-case rule and names this check beside it', () => {
  const rules = readFileSync(join(ROOT, '.acc', 'rules.md'), 'utf8');
  const rule = rules.split(/\n(?=- )/).find((r) => /edge case/i.test(r));
  assert.ok(rule, '.acc/rules.md has no edge-case rule');
  assert.match(rule, /scripts\/test\/edge-cases\.test\.ts/);
  assert.match(rule, /\bOLDER\b/);
});
