## D-130 Every test file names an edge case it covers (2026-10-09)

From repeated review findings (an empty result counted as finished, state wider than the active folder, a
choice cleared after it was made), the repo's own rules gain an edge-case rule: every test file has at
least one test whose name says which edge case it covers. `scripts/test/edge-cases.test.ts` checks it
against every file `npm test` runs. Its `OLDER` list names the test files that predate the rule and may
only shrink. A skipped or to-do test doesn't count. The check reads names, which is a weak signal; tying
it to the finding kinds is a follow-up.
