## D-T-109 Review plan: a plan's choices and questions one at a time, in a sheet, as Claude Code asks its own (2026-10-22)

T-109. A plan (D-192, D-195) showed every choice, every question, every option's pros, cons, risks and files,
the versions and the requirements at once on the ticket page. The person found it far too much at once, and
asked to step through it one item at a time, as Claude Code's own prompts do.

- **A short plan section.** The ticket page's Plan section shows the summary, the plan's version and
  approval, and what's left in words ("1 choice and 2 questions to review", "Ready to approve", or "Approved
  v2"), with Review plan as its main button while something is left or the plan isn't approved, then Build it
  and Talk it through. Everything else (what changed, the option cards, the questions in full, the wording
  findings, the earlier versions and the analysis's lists) folds under "The whole plan", closed until opened,
  and the tab remembers it opened. Approve this plan moved into Review plan's summary; a plan with nothing to
  review keeps it in the section.
- **The steps** (`extension/src/model/review-plan.ts`). Questions for you first, then the choices, then the
  questions for the ticket's author, each in the plan's order. Answered questions and made choices stay as
  steps, marked done, so the count and the dots don't shift as acc records each one. A step is done once it's
  chosen or answered, or, for the ticket's author, drafted or posted on the ticket. There is no review when
  there's no plan, a plan says to split the task, or the build has started.
- **One step at a time** (`extension/webview/review-plan.ts`), in the page's modal (modal.ts), as the Build it
  sheet is. A choice: its title as the heading, why it matters, then its options as a radio group, the
  recommended one first and marked Recommended with a star, each with More about this option (effort, pros,
  cons, risks and files), and Something else… with a box for the person's own. A question: the suggestion
  first, then Answer in my own words with a box; for the ticket's author, Ask on the ticket too, where the task
  has a ticket to post on. An answered question shows its answer, with Next.
- **Keys as Claude Code's prompts.** Up and Down move between the options, a number picks one, Enter confirms
  and goes on to the next step, Escape closes and keeps what's picked. Back, Skip for now, "2 of 5", and a dot
  for each step, its name in its label: done in blue with a check, skipped in orange, not yet seen plain, and
  the current one ringed, each with its own icon. Orange asks for attention elsewhere in the app, so only a
  skipped step wears it. The plan's choice so far is marked Your current choice while its radio is the one
  picked, and the mark goes once the person picks another option in that step. A dot goes to its step. Discuss closes the sheet onto Talk it through with the choice or question
  quoted. Focus starts on each step's picked option: the first one, unless the plan already has a choice
  made, which is picked instead.
- **The summary.** Each step in a line, with what was chosen or answered, Skipped or not yet, a click back to
  its step; then Approve this plan, off while anything for the person is left, with the reason under it, and
  Close.
- **The same records.** A confirm sends what the whole plan already sends: `plan-choose` for a choice
  (`acc plan choose`), `analysis-answer` for an answer (`acc analysis answer`), and `update-ask` for Ask on the
  ticket, which drafts the comment (D-066). A choice already made, or an answered question, sends nothing.
  On an approved plan, a changed choice asks first in acc's words, with Keep the approval and Change it, as
  the whole plan does (D-192). Nothing is sent until a step is confirmed: what's picked, the More about this
  option that's open, the skipped steps and the step the sheet is at live in the tab's memory.
- **Motion and access.** Each step fades in over 160 ms, and from 40% over 120 ms under reduced motion: a fade doesn't
  move. The sheet is a dialog named for the plan ("Review plan v1"); the options are a radio group named by
  the step's heading; More about this option says which option, and whether it's open.
- **Checked by** `extension/test/review-plan.test.ts` (the model and the sheet), the browser case "review
  plan: …" in `extension/scripts/behaviour.ts` with its three mutants (Enter that stays on its step, Back
  that forgets the pick, Approve on with an item left), and the screenshot pages `ticket-plan-short`,
  `ticket-review-choice`, `ticket-review-question`, `ticket-review-answered` and `ticket-review-summary`.
