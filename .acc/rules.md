# Agent Command Center's own rules

- Words that describe the code say what it does on this branch, no more. Before you commit a doc row, label, comment or note, check each claim against the code: what calls what, how often something runs, what is built and what is "still to come". Where the code and the words disagree, change the words, and fix every copy (DESIGN, the UI, and this change's own DECISIONS entry) in the same change. Older DECISIONS entries are a dated record: add a note, never rewrite them.
- The note you finish with (`acc done`) says what is true at your last commit. Before you run it, check each number and claim against the branch: count the tests each file adds, count what a list holds (pages, checks, rows), and drop any open item a commit already did. A count in a decision entry gets the same check, and the note and the entry agree.
- Test the edge cases, not only the path that works: an empty or failed result, the state before the
  first result arrives, a choice cleared after it was made, a step that's slow to show, and state that
  reaches wider than the code assumes (the whole workspace, not the active folder). Every test file has
  at least one test whose name says which edge case it covers. Checked by
  `scripts/test/edge-cases.test.ts`, whose `OLDER` list names the test files that predate this rule. That
  list may only shrink.
- duplicate helper.
