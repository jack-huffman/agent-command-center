## D-180 A rework a person sent back carries the passed review's findings (2026-10-19)

Builds on D-094, the fix for GH-80. On T-74 a review passed and listed
findings, a person sent the task back, and the builder saw only the person's
reason. The findings, with their files and lines, went to it in a separate
message.

- **The packet lists the findings** of the review of the task branch's latest
  commit, under "Why a person sent it back", after the person's reason, when
  that review passed and has findings. Each shows its file and line as the
  review's section does, and a must-fix one starts with "Must fix". `dispatch`
  now reads the branch's latest commit on every rework, and `renderPacket`
  takes it as `head`.
- **Nothing is said** when the review is of an older commit than the branch's
  last, when there is no review, or when the commit isn't known. A review of an
  older commit may name code that has changed.
- **No finding is listed twice.** A review that asked for changes shows its
  must-fix findings in "What the review asked for", and the send-back section
  lists none, whoever sent the task back.
- **"What the review asked for" lists only the must-fix findings,** as before.
  A review that asks for changes has said which findings it needs fixed; the
  others are optional, and listing them there would widen the rework beyond
  what the review asked. A passed review lists all its findings, because a
  person who sends it back chose to act on them, and may mean any of them.
- **Checked** by two tests. One in `packages/core/test/dispatch.test.ts`: a passed
  review's findings with their files and lines and the reason first; none for
  an older commit, no review or an unknown commit; and a review that asked for
  changes listing a finding once. One in `packages/core/test/dispatch-run.test.ts`,
  on a real git repo: the written packet lists the findings while the review is
  of the branch head, and leaves them out after a newer commit. It fails if
  dispatch reads the head only for checks or queue reworks.
- Not chosen: listing the non-must findings in "What the review asked for".
