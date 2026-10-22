// The CI run's own check (T-108): scripts/ci-run.ts reads what node:test ran and skipped from the full
// check's log. node:test's own spec output, from a real run, is its oracle.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readTestCounts } from '../../packages/core/src/test-counts.ts';
import { tempDir } from '../../packages/core/test/support.ts';
import { CI_SKIPS, type CiSkip, ciSummary, screenshotLines, skipProblems } from '../ci-run.ts';

const ROOT = join(import.meta.dirname, '..', '..');

/** node:test's spec output for a file of tests, each skipped where its name says so, as npm test prints it. */
function specOf(names: { name: string; skip?: string }[], failing = false): string {
  const dir = tempDir('ci-run-');
  const file = join(dir, 'a.test.ts');
  writeFileSync(file, `import { test } from 'node:test';\n${names.map((n) => `test(${JSON.stringify(n.name)}, { skip: ${JSON.stringify(n.skip ?? false)} }, () => {});`).join('\n')}\n${failing ? 'test(\'breaks\', () => { throw new Error(\'no\'); });\n' : ''}`);
  const env = { ...process.env };
  // Run on its own, not as part of the test run this one is inside.
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--no-warnings', '--test', '--test-reporter=spec', file], { encoding: 'utf8', env });
  return r.stdout;
}

const LISTED: CiSkip[] = [{ name: 'needs sf', why: 'no sf here' }];

test('a run whose only skip is listed passes, and its summary counts what ran and names each skip with why', () => {
  const counts = readTestCounts(specOf([{ name: 'adds' }, { name: 'needs sf', skip: 'sf isn\'t on this machine' }]));
  assert.deepEqual([counts?.run, counts?.skipped, counts?.skippedNames], [1, 1, ['needs sf']]);
  assert.deepEqual(skipProblems(counts, LISTED), []);
  const summary = ciSummary(counts, [], ['Geometry of 6 drawings: overlap examined 180.'], LISTED);
  assert.match(summary, /^Tests: 1 run, 1 skipped\.$/m);
  assert.match(summary, /^- needs sf: no sf here$/m);
  assert.match(summary, /^- Geometry of 6 drawings: overlap examined 180\.$/m);
  assert.match(summary, /\*\*Passed\.\*\*/);
});

test('edge cases: a new skip, a listed test that ran, a failed test, no tests and no summary each fail the run', () => {
  assert.deepEqual(skipProblems(readTestCounts(specOf([{ name: 'adds' }, { name: 'needs sf', skip: 'x' }, { name: 'needs a keychain', skip: 'no keychain' }])), LISTED), ['"needs a keychain" skipped on CI, and CI_SKIPS (scripts/ci-run.ts) doesn\'t name it: run it, or list it with why.']);
  assert.deepEqual(skipProblems(readTestCounts(specOf([{ name: 'needs sf' }])), LISTED), ['"needs sf" ran on CI: take it off CI_SKIPS.']);
  assert.deepEqual(skipProblems(readTestCounts(specOf([{ name: 'needs sf', skip: 'x' }], true)), LISTED), ['1 test failed.']);
  assert.deepEqual(skipProblems({ run: 0, passed: 0, failed: 0, skipped: 0, todo: 0, runner: 'node:test' }, []), ['The check ran no tests.']);
  assert.deepEqual(skipProblems({ run: 3, passed: 3, failed: 0, skipped: 1, todo: 0, runner: 'jest' }, []), ['1 skipped, but 0 named: a skip with no name can\'t be checked against the list.']);
  assert.deepEqual(skipProblems(null), ['The check\'s log holds no test summary, so what ran is unknown.']);
  assert.match(ciSummary(null, ['x'], null), /^Tests: no summary in the log\.$/m);
  assert.doesNotMatch(ciSummary(null, ['x'], null), /screenshot run/, 'no screenshot log, no section');
});

test('each listed CI skip is a test in the repo that skips itself with a reason where its tool is missing', () => {
  assert.ok(CI_SKIPS.length > 0, 'counts what it checked');
  const tests = readFileSync(join(ROOT, 'packages', 'core', 'test', 'manifest-sf.test.ts'), 'utf8');
  for (const s of CI_SKIPS) {
    assert.ok(tests.includes(`test('${s.name.replace(/'/g, '\\\'')}', { skip: REAL.why ?? false`), s.name);
    assert.ok(s.why.length > 20, `${s.name} says why`);
  }
});

test('the workflow is the check autopilot waits for: its job is the one the project names, it runs every check on Linux, keeps failures 7 days, and needs no secret and never pushes; edge case: an action not pinned to a commit', () => {
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'check.yml'), 'utf8');
  const config = JSON.parse(readFileSync(join(ROOT, '.acc', 'config.json'), 'utf8')) as { github: { checks?: string[] } };
  assert.deepEqual(config.github.checks, ['check']);
  assert.match(yml, /^jobs:\n {2}check:\n/m, 'one job, named as the project names the check');
  assert.match(yml, /^on:\n {2}pull_request:\n {4}branches: \[main\]\n {2}push:\n {4}branches: \[main\]$/m);
  assert.match(yml, /runs-on: ubuntu-latest/);
  const steps = ['node-version-file: package.json', 'npm ci', 'npm run browser', 'npm run check', 'ACC_CI_FLOORS: \'1\'', 'npm run screenshot', 'scripts/ci-run.ts'];
  const at = steps.map((s) => yml.indexOf(s));
  assert.ok(at.every((i) => i > 0), `each step is there: ${steps.filter((_, i) => at[i]! < 0).join(', ')}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in this order');
  assert.match(yml, /key: chrome-headless-shell-\$\{\{ runner\.os \}\}-\$\{\{ hashFiles\('extension\/scripts\/browser\.json'\) \}\}/, 'the shell cached by its pin');
  assert.match(yml, /cache: npm/);
  assert.match(yml, /if: failure\(\)\n\s+uses: actions\/upload-artifact@[0-9a-f]{40} [^\n]*\n\s+with:\n[\s\S]*dist\/screenshots\/[\s\S]*retention-days: 7/);
  assert.match(yml, /^permissions:\n {2}contents: read$/m);
  assert.doesNotMatch(yml, /secrets\.|git push|contents: write/);
  const uses = [...yml.matchAll(/uses: ([^\s]+)/g)].map((m) => m[1]!);
  assert.ok(uses.length >= 4, 'counts what it checked');
  for (const u of uses) assert.match(u, /^actions\/[\w-]+@[0-9a-f]{40}$/, `${u} is pinned to a commit`);
});

test('the screenshot run\'s summary lines are kept, the rest of its log isn\'t; edge case: a log with no geometry line fails the run', () => {
  const log = ['drawing tasks dark 500', 'Geometry of 156 drawings: overlap examined 9999.', 'A CI run: held to its own floors for no check, and to the Mac\'s for the rest.', 'pass  a case  (3 checks)', 'Behaviour: 40 cases, 900 checks, 0 failures.', 'Mutants: 5, 5 caught.'].join('\n');
  assert.deepEqual(screenshotLines(log), ['Geometry of 156 drawings: overlap examined 9999.', 'A CI run: held to its own floors for no check, and to the Mac\'s for the rest.', 'Behaviour: 40 cases, 900 checks, 0 failures.', 'Mutants: 5, 5 caught.']);
  const dir = tempDir('ci-run-');
  const [check, shots, summary] = ['check.log', 'shots.log', 'summary.md'].map((f) => join(dir, f));
  writeFileSync(check!, specOf([...CI_SKIPS.map((s) => ({ name: s.name, skip: 'missing' })), { name: 'adds' }]));
  writeFileSync(shots!, 'drew nothing\n');
  const r = spawnSync(process.execPath, ['--no-warnings', join(ROOT, 'scripts', 'ci-run.ts'), check!, shots!], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summary } });
  assert.equal(r.status, 1, r.stdout);
  assert.match(readFileSync(summary!, 'utf8'), /holds no geometry summary/);
  writeFileSync(shots!, `${log}\n`);
  assert.equal(spawnSync(process.execPath, ['--no-warnings', join(ROOT, 'scripts', 'ci-run.ts'), check!, shots!], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } }).status, 0);
});
