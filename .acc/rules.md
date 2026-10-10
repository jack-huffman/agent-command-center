# Agent Command Center's own rules

- Test the edge cases, not only the path that works: an empty or failed result, the state before the
  first result arrives, a choice cleared after it was made, a step that's slow to show, and state that
  reaches wider than the code assumes (the whole workspace, not the active folder). Every test file has
  at least one test whose name says which edge case it covers. Checked by
  `scripts/test/edge-cases.test.ts`, whose `OLDER` list names the test files that predate this rule. That
  list may only shrink.
