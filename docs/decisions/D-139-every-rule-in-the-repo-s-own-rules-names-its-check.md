## D-139 Every rule in the repo's own rules names its check (2026-10-10)

From repeated review findings (a test meant to stop a split from dropping a command read source text with
a regex, a per-area check hard-coded its kinds instead of reading the list it claimed to check, a pinning
test matched one variable name only), the repo's own rules gain: every rule gets a check before anyone
relies on it. `scripts/test/rules.test.ts` reads each rule in `.acc/rules.md`, counts them, fails on none,
and fails a rule that doesn't name its check beside it ("Checked by" a test file) where that file is one
`npm test` runs and declares a test (`test(` or `it(`) named for `.acc/rules.md` whose body names that file's own path (a
mention in a comment, or in another test's body, doesn't count). Its `UNCHECKED` list names the rules that predate
this one and may only shrink: each must still be in the file and still name no check. At merge it held five:
the words rule, the finishing-note rule, and the constant, comment and helper rules (T-8, T-9, T-6) that
merged just before it. The check reads the named test's source: it sees that the test pins itself beside
the rule, not that the test is a strong one; the
findings behind it were weak checks, which stays a reviewer's call.
