// The repo's checked-rules rule (.acc/rules.md, T-7): every rule gets a check before anyone relies on it.
// Reviews kept finding rules that nothing checked, or checked by a pattern that missed the real case (3
// findings across 3 tasks). This walks every rule in .acc/rules.md, counts them, fails on none, and fails a
// rule that doesn't name a check beside it ("Checked by `<test file>`") which npm test runs and which
// declares a test named for .acc/rules.md whose body names that file's own path, so the check pins itself
// beside the rule. It reads the check's source: it sees that the check pins itself, not that it is strong.
// UNCHECKED names the rules that predate this one; each must still lack a check, so
// the list only shrinks.
import assert from 'node:assert/strict';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');

/** The opening words of the rules that predate this one and name no check. Only ever remove one. */
export const UNCHECKED = [
  'The note you finish with',
  'Words that describe the code',
];

/** The rules in a rules file: each top-level bullet, with the lines that continue it, joined into one line. */
export function rules(markdown: string): string[] {
  return markdown.split(/\n(?=- )/).filter((r) => r.startsWith('- ')).map((r) => r.slice(2).replace(/\s*\n\s*/g, ' ').trim());
}

/** The test file a rule names as its check, from "Checked by `<path>`", or null when it names none. */
export function namedCheck(rule: string): string | null {
  return /\bChecked by `([^`\s]+\.test\.ts)`/.exec(rule)?.[1] ?? null;
}

/** The test files npm test runs: the quoted globs in package.json's test script, expanded. */
function testFiles(): string[] {
  const script = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.test as string;
  const globs = [...script.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '');
  return [...new Set(globs.flatMap((g) => globSync(g, { cwd: ROOT })))].sort();
}

/** The tests a test file declares: each `test('<name>', …)` call that starts a line, with its body up to the next. */
export function declaredTests(source: string): { name: string; body: string }[] {
  const calls = [...source.matchAll(/^[ \t]*test\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gm)];
  return calls.map((m, i) => ({ name: m[2] ?? '', body: source.slice((m.index ?? 0) + m[0].length, calls[i + 1]?.index ?? source.length) }));
}

/** Whether a test file declares a test named for .acc/rules.md whose body names the file's own path (regex escapes dropped). */
export function pinsItself(path: string, source: string): boolean {
  return declaredTests(source).some((t) => t.name.includes('.acc/rules.md') && t.body.replaceAll('\\', '').includes(path));
}

/** Why a rule's check doesn't hold, or null when it does: it names a test file npm test runs that pins itself beside the rule. */
export function checkProblem(rule: string, runs: string[], read: (path: string) => string | null): string | null {
  const check = namedCheck(rule);
  if (!check) return 'names no check ("Checked by `<test file>`")';
  if (!runs.includes(check)) return `names ${check}, which npm test doesn't run`;
  if (!pinsItself(check, read(check) ?? '')) return `names ${check}, which has no test named for .acc/rules.md that names ${check}`;
  return null;
}

const readRoot = (path: string): string | null => (existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), 'utf8') : null);
const isUnchecked = (rule: string): boolean => UNCHECKED.some((u) => rule.startsWith(u));

test('every rule in .acc/rules.md names a check npm test runs, but the older ones UNCHECKED names', () => {
  const all = rules(readFileSync(join(ROOT, '.acc', 'rules.md'), 'utf8'));
  const runs = testFiles();
  // It ran: no rules, or no test files, is no check.
  assert.ok(all.length > 0, '.acc/rules.md holds no rules');
  assert.ok(runs.length > 0, 'npm test runs no test files');
  const checked = all.filter((r) => !isUnchecked(r));
  assert.ok(checked.length > 0, 'no rule was checked: every one is in UNCHECKED');
  const broken = checked.map((r) => [r.slice(0, 60), checkProblem(r, runs, readRoot)]).filter(([, p]) => p);
  assert.deepEqual(broken, [], 'each of these rules needs a check beside it: a test file npm test runs, with a test named for .acc/rules.md that names the file');
});

test('UNCHECKED only shrinks: each rule it names is still in .acc/rules.md and still has no check', () => {
  const all = rules(readFileSync(join(ROOT, '.acc', 'rules.md'), 'utf8'));
  assert.ok(UNCHECKED.length > 0, 'UNCHECKED is empty: delete it and this test');
  assert.deepEqual([...UNCHECKED].sort(), UNCHECKED, 'UNCHECKED should stay sorted');
  for (const u of UNCHECKED) {
    const matches = all.filter((r) => r.startsWith(u));
    assert.equal(matches.length, 1, `UNCHECKED names "${u}", which starts ${matches.length} rules in .acc/rules.md, not one: take it out or make it exact`);
    assert.equal(namedCheck(matches[0] ?? ''), null, `"${u}" now names a check: take it out of UNCHECKED`);
  }
});

test('a rule naming no check, a missing one, or one only mentioning the rules in a comment fails, and a held one passes', () => {
  const md = '# Rules\n\n- First rule.\n- Second rule, on\n  two lines. Checked by\n  `scripts/test/x.test.ts`.\n';
  assert.deepEqual(rules(md), ['First rule.', 'Second rule, on two lines. Checked by `scripts/test/x.test.ts`.']);
  assert.deepEqual(rules(''), [], 'an empty file holds no rules');
  assert.deepEqual(rules('# Rules\n\nNo bullets here.\n'), [], 'prose without a bullet is no rule');
  assert.equal(namedCheck('First rule.'), null);
  assert.equal(namedCheck('Mentions `scripts/test/x.test.ts` but not as its check.'), null, 'a path alone is not a named check');
  const files: Record<string, string> = {
    'scripts/test/x.test.ts': "test('adds', () => {});\ntest('.acc/rules.md names this check', () => {\n  assert.match(rule, /scripts\\/test\\/x\\.test\\.ts/);\n});\n",
    'scripts/test/y.test.ts': "// reads .acc/rules.md and names scripts/test/y.test.ts\ntest('adds', () => {});\n",
    'scripts/test/z.test.ts': "test('.acc/rules.md holds a rule', () => {});\ntest('adds', () => { 'scripts/test/z.test.ts'; });\n",
  };
  const read = (p: string): string | null => files[p] ?? null;
  const runs = Object.keys(files);
  assert.match(checkProblem('First rule.', runs, read) ?? '', /names no check/);
  assert.match(checkProblem('R. Checked by `scripts/test/gone.test.ts`.', runs, read) ?? '', /doesn't run/, 'a missing file fails');
  assert.match(checkProblem('R. Checked by `scripts/test/x.test.ts`.', [], read) ?? '', /doesn't run/, 'a file npm test skips fails');
  assert.match(checkProblem('R. Checked by `scripts/test/y.test.ts`.', runs, read) ?? '', /no test named/, 'a comment naming the rules and the path is no test');
  assert.match(checkProblem('R. Checked by `scripts/test/z.test.ts`.', runs, read) ?? '', /no test named/, 'the path in another test\'s body does not count');
  assert.deepEqual(declaredTests(''), [], 'an empty file declares no tests');
  assert.deepEqual(declaredTests(files['scripts/test/x.test.ts'] ?? '').map((t) => t.name), ['adds', '.acc/rules.md names this check']);
  assert.equal(checkProblem('R. Checked by `scripts/test/x.test.ts`.', runs, read), null);
});

test('.acc/rules.md holds this rule and names this check beside it', () => {
  const rule = rules(readFileSync(join(ROOT, '.acc', 'rules.md'), 'utf8')).find((r) => r.startsWith('Every rule gets a check before anyone relies on it.'));
  assert.ok(rule, '.acc/rules.md has no checked-rules rule');
  assert.equal(namedCheck(rule), 'scripts/test/rules.test.ts');
  assert.match(rule, /\bUNCHECKED\b/);
});
