## D-T-135 Review is a tab on a task page, between Changes and Verify (2026-10-28)

T-135. The person asked for the Review side section on a task page to be a tab. This amends D-216's list of
tabs, which becomes Ticket, Plan, Changes, Review and Verify.

- **The tab** (`extension/webview/tab-rules.ts`): Review shows only when the task has a review, so it is never
  drawn empty. It holds what the side panel held (`renderReview`, `extension/webview/review.ts`): the verdict
  and its count, the summary, who and when, the stale and gone lines, each finding with its file, line and
  excerpt, and Open the review. The
  tab names the review, so the block draws no REVIEW heading: the verdict line comes first.
- **Its count** is the findings, where there are any ("3"); a review with none shows no count.
- **It needs the person** when the review's state is orange, such as a review that sent work back: the tab
  shows the orange bell and "needs you", as the other tabs do.
- **NEEDS_FIRST** is now Plan, Review, Verify, Changes, Ticket. Review comes after Plan and before Verify: a review
  that sent work back holds up the rework, and a verification of the developer's pull request comes later in a
  task's life than its review.
- **The side panel is gone.** The side column holds Details and Agent only, and the narrow-page rule that put
  the Review panel after the Agent panel goes. A link, a Needs you row or a notification that names the
  review (part `review`) opens the Review tab: `partTab('review')`, and `TASK_PART` takes `review`. A notice
  of a review, ready (`review`) or sent back (`rework`), names part `review` (`noticePart`), so its Needs you row
  and notification open the Review tab.
- **Page content, not a narrow panel.** In the tab a finding takes the page's width, with its message and the
  summary kept to a readable line and its excerpt taking the rest. The block's class is `review-block`
  (was `side-review`).
- **Checked by** `extension/test/task-tabs.test.ts` (the tab shows only with a review, between Changes and
  Verify; its count; "needs you" with the bell, and nothing on a passed review; the opening order;
  `partTab('review')`; the side column holds no Review panel; `noticePart` names `review` for a review's
  notices), `extension/test/task-review.test.ts`, and the
  behaviour run's review case, whose mutant "a review that needs you doesn't say so on its tab" must fail it.
  The screenshot run draws `ticket-tab-review` (a review that needs you), `ticket-tab-review-findings`
  (findings that block nothing) and `ticket-tab-review-passed` at every theme and width; the other review shots
  open on Review. The class `review-block` and `.rv-*` are drawn in those shots.
