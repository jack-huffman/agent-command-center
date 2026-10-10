// The repo's checked-rules rule (.acc/rules.md, T-7): every rule gets a check before anyone relies on it.
// Reviews kept finding rules that nothing checked, or checked by a pattern that missed the real case (3
// findings across 3 tasks). This walks every rule in .acc/rules.md, counts them, fails on none, and fails a
// rule that doesn't name a check beside it ("Checked by `<test file>`") which npm test runs and which reads
// .acc/rules.md itself. UNCHECKED names the rules that predate this one; each must still lack a check, so
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

/** Why a rule's check doesn't hold, or null when it does: it names a test file npm test runs that reads the rules. */
export function checkProblem(rule: string, runs: string[], read: (path: string) => string | null): string | null {
  const check = namedCheck(rule);
  if (!check) return 'names no check ("Checked by `<test file>`")';
  if (!runs.includes(check)) return `names ${check}, which npm test doesn't run`;
  if (!read(check)?.includes('.acc/rules.md')) return `names ${check}, which never reads .acc/rules.md`;
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
  assert.deepEqual(broken, [], 'each of these rules needs a check beside it, a test npm test runs that reads .acc/rules.md');
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

test('a rule naming no check, a missing one, or one that never reads the rules fails, and a held one passes', () => {
  const md = '# Rules\n\n- First rule.\n- Second rule, on\n  two lines. Checked by\n  `scripts/test/x.test.ts`.\n';
  assert.deepEqual(rules(md), ['First rule.', 'Second rule, on two lines. Checked by `scripts/test/x.test.ts`.']);
  assert.deepEqual(rules(''), [], 'an empty file holds no rules');
  assert.deepEqual(rules('# Rules\n\nNo bullets here.\n'), [], 'prose without a bullet is no rule');
  assert.equal(namedCheck('First rule.'), null);
  assert.equal(namedCheck('Mentions `scripts/test/x.test.ts` but not as its check.'), null, 'a path alone is not a named check');
  const files: Record<string, string> = { 'scripts/test/x.test.ts': "readFileSync('.acc/rules.md')", 'scripts/test/y.test.ts': 'nothing about the rules' };
  const read = (p: string): string | null => files[p] ?? null;
  const runs = ['scripts/test/x.test.ts', 'scripts/test/y.test.ts'];
  assert.match(checkProblem('First rule.', runs, read) ?? '', /names no check/);
  assert.match(checkProblem('R. Checked by `scripts/test/gone.test.ts`.', runs, read) ?? '', /doesn't run/, 'a missing file fails');
  assert.match(checkProblem('R. Checked by `scripts/test/x.test.ts`.', [], read) ?? '', /doesn't run/, 'a file npm test skips fails');
  assert.match(checkProblem('R. Checked by `scripts/test/y.test.ts`.', runs, read) ?? '', /never reads/, 'a test that never reads the rules fails');
  assert.equal(checkProblem('R. Checked by `scripts/test/x.test.ts`.', runs, read), null);
});

test('.acc/rules.md holds this rule and names this check beside it', () => {
  const rule = rules(readFileSync(join(ROOT, '.acc', 'rules.md'), 'utf8')).find((r) => r.startsWith('Every rule gets a check before anyone relies on it.'));
  assert.ok(rule, '.acc/rules.md has no checked-rules rule');
  assert.equal(namedCheck(rule), 'scripts/test/rules.test.ts');
  assert.match(rule, /\bUNCHECKED\b/);
});
