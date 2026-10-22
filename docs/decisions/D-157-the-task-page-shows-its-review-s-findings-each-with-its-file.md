## D-157 The task page shows its review's findings, each with its file, line and the lines around it (2026-10-15)

A person read a reviewer's findings in a terminal. T-53 puts them on the task page.

- **Where it shows:** a Review block under the Agent panel, for a task in review or rework, or one whose
  latest verdict is on its latest commit (`ticketReview` in `extension/src/model/task-page.ts`). On a
  narrow page it follows the Agent panel. The verdict shows as a state with an icon and a word: Passed in
  blue, Changes asked in orange (`REVIEW_LOOK`). Then the summary, who reviewed it and when, and a count,
  "3 findings, 1 must fix", or "No findings". A verdict on an older commit says so in a muted line.
- **Each finding,** must-fix ones first, each part in the reviewer's order: Must fix in orange or Worth a
  look in blue, its message, its kind in a muted word, and its file and line as a link.
- **The lines around it:** the extension reads them, not the page (`reviewExcerpts` in
  `extension/src/logic/review-excerpts.ts`), with `git diff <base>...<sha> -- <file>` in the task's
  checkout, once a file. `<base>` is the merge base of the reviewed commit and the environment's branch,
  or origin's copy of it. A line in a hunk shows at most 7 lines of the change: a plus in blue and a minus
  in orange, from the theme, each named "added" or "removed" for a screen reader. A line no hunk holds
  shows at most 5 lines of the file at the sha, under a muted line that says the code is unchanged. A
  removed file shows its removed lines. A page keeps what it read for a verdict, so a redraw doesn't ask
  git again.
- **A click on the file and line** sends `review-file`. The extension opens the file at that line in the
  task's checkout (`showTextDocument` with a selection). It refuses a path outside the checkout: up with
  "..", an absolute path elsewhere, or a link that leads out (`fileInCheckout`), and never reads one. When
  the checkout is gone, the block says so once, shows no lines, and each link is off, with why in its
  title; so is the link of a file the change removed. In the modal, the Tasks board's page passes the
  message to the task page's controller.
- **Open the review** opens the reviewer's session page through `openReview` in `extension/src/rules.ts`,
  which a suggested rule's finding used alone before.
- **No full diff viewer** and no syntax colours: a line longer than 240 characters is cut with "…".
- **Checked:** `task-review.test.ts` (10 tests: the block, must-fix first, a pass with no findings, a
  finding with no file or line, an older commit, a task not in review, a gone checkout, an outside or
  removed file, the message's check). `review-excerpts.test.ts` (11 tests, in a real repository: a line in
  a hunk, one outside any, a removed file, a file not in the change, a path outside the checkout, a missing
  checkout, no merge base; it counts the findings it read and fails under 15). `rules.test.ts` adds one on
  `openReview`, `behaviour.test.ts` one on the case's oracle. The behaviour run adds a case on
  `ticket-review` and two mutants: one that lists the findings in reverse, one whose link sends nothing.
  The screenshot run adds `ticket-review`: ACME-19 in rework, with three findings and two excerpts.

Out of scope: how acc reviews a task.
