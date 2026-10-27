# Agent Command Center's own rules

- Words that describe the code say what it does on this branch, no more. Before you commit a doc row, label, comment or note, check each claim against the code: what calls what, how often something runs, what is built and what is "still to come". Where the code and the words disagree, change the words, and fix every copy (DESIGN, the UI, and this change's own DECISIONS entry) in the same change. Older DECISIONS entries are a dated record: add a note, never rewrite them.
- The note you finish with (`acc done`) says what is true at your last commit. Before you run it, check each number and claim against the branch: count the tests each file adds, count what a list holds (pages, checks, rows), and drop any open item a commit already did. A count in a decision entry gets the same check, and the note and the entry agree.
- Test the edge cases, not only the path that works: an empty or failed result, the state before the
  first result arrives, a choice cleared after it was made, a step that's slow to show, and state that
  reaches wider than the code assumes (the whole workspace, not the active folder). Every test file has
  at least one test whose name says which edge case it covers. Checked by
  `scripts/test/edge-cases.test.ts`, whose `OLDER` list names the test files that predate this rule. That
  list may only shrink.
- Test coverage: test what the change adds, not only that it runs. Each acceptance criterion, and each case
  a guard or branch handles (every form a guard catches, a step that finishes during a wait, a message
  reaching the handler meant for it, a dialog's keys and clicks driven in a browser), gets a test that fails
  without it. Every function, constant or class a source module exports is named by a test. That export half is
  Checked by `scripts/test/coverage.test.ts`, whose `OLDER` list names the exports that predate this rule. That list
  may only shrink. Reviewers judge the first half: each criterion and each guarded case has its test.
- Before adding a constant, search for one that holds the same value or meaning; use it, or export one shared one.
- A comment names the branch or failure path it explains. When a change moves or removes the code a comment sits above, move or delete the comment with it.
- Before writing a helper, search for one that already does the job, and use the exported one. If you near-copy a local, unexported one instead, say so in the note you finish with.
- Every rule gets a check before anyone relies on it. A rule here names the test that checks it, and that
  test counts what it checked and fails on none. The check sees that the named test runs under npm test
  and has a test, named for `.acc/rules.md`, that names its own path; whether the test is strong is a
  reviewer's call. Checked by
  `scripts/test/rules.test.ts`, whose `UNCHECKED` list names the rules that predate this one. That list
  may only shrink.
- No client's name is committed: not in a file, a test, a decision or a note, because the repo may be shared
  beyond the author. Say "the client's name", "the pilot client" or a fictional name (acme, jordan-kim). The
  check keeps a list of SHA-256 hashes of banned names, never the names. To add one, run
  `node scripts/name-hash.mjs <name>` and paste the hash into `BANNED` in the test. Checked by
  `scripts/test/no-client-names.test.ts`, which reads every tracked text file and fails on none read.
- Write each requirement that an agent reads in STE Strict mode (ASD-STE100 Simplified Technical
  English): the goal, each criterion, each assumption and each out-of-scope item. The analyst's prompt
  holds the rules. acc checks the wording of each requirement line it reads, and the task page shows each
  finding. Checked by `packages/core/test/ste.test.ts`.
