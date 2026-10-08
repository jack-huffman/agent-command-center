# Test runner output (GH-100)

What `test-counts.test.ts` reads, pinned by sha256 in that test so a changed
file is noticed. node:test's output isn't here: the test runs the installed
node on a file of its own and reads what it prints.

| File | What it is | Where it came from |
|---|---|---|
| `jest-two-files.txt` | Jest's stderr for two test files, one failing, with ANSI colour as printed. One test logs a fake `Tests:` line, which Jest indents under Console | Jest 29.7.0 (installed with @salesforce/sfdx-lwc-jest 7.9.0), `jest --ci --no-cache`, captured 2026-10-07. Paths shortened to `lwc/sample/__tests__/` |
| `jest-one-file.txt` | Jest's stderr for one test file, which lists each test, so the skipped ones are named (`○ skipped …`) | The same Jest, `jest --ci --no-cache sample.test.js`, 2026-10-07. Paths shortened the same way |
| `jest-no-tests.txt` | Jest's stdout when `--findRelatedTests … --passWithNoTests` finds no tests | The same Jest, 2026-10-07 |
| `apex-deploy.json` | `sf project deploy start --dry-run --json` with RunSpecifiedTests: 21 run, 4 failed | Written to the result types of @salesforce/source-deploy-retrieve 13.3.0 (in @salesforce/cli 2.151.7), which give `numTestsRun` and `numFailures` as strings, 2026-10-07. Not captured from an org |

The tests the Jest files ran:

```js
describe('group', () => {
  it('adds', () => expect(1 + 1).toBe(2));
  it('subtracts', () => expect(2 - 1).toBe(1));
  it('multiplies', () => expect(2 * 2).toBe(4));
  it('divides wrongly', () => expect(4 / 2).toBe(3));
  it.skip('skipped one', () => {});
  xit('skipped two', () => {});
  it.todo('to do later');
});
// other.test.js
test('passes too', () => {
  console.log('Tests:       9 failed, 99 total');
  expect(true).toBe(true);
});
```
