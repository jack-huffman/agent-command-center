## D-T-110 Make a plan reads the whole ticket: every comment, related tickets and the changes field, and says when new comments arrive (2026-10-22)

T-110. A plan (D-052, D-192) read only the description the Command Center kept when the ticket was added. On a
real client ticket the comments often hold the decisions ("Kelsey and Mike will send back the 77 contacts by
Wednesday"). Drafted acceptance criteria (T-81) already read the whole ticket. The person asked whether a plan
reads all the comments; now it does.

- **The Command Center reads the ticket.** It holds the tracker's sign-in, so Make a plan reads the ticket
  first, as drafting criteria does: its text, every comment with its author and date, related tickets with
  their state, the names of attachments in the description and comments, and the changes field (T-105) where
  the tracker names one. It hands them to `acc analyze <id> --ticket <file>` and removes the file when acc
  ends (`extension/src/logic/plan-ticket.ts`, `packages/core/src/plan-ticket.ts`). Criteria and Make a plan
  read the ticket through one reader (`extension/src/logic/project-ticket.ts`). A changes field that
  can't be read is left out, and the rest is still read. A file that can't be written is removed with its
  folder, the person is told in words, and acc plans from the description without `--ticket`
  (`planTicketFolder`).
- **A failed read, or no tracker, says why.** A read that fails hands over the ticket's key and why
  (`{ "key", "unread" }`), and the plan is made from the description. Its prompt says the comments weren't
  read and why, and asks the analyst to say so in the summary. A task with no tracker has no comments, and the
  plan says that. `acc analyze` without `--ticket` on a tracker task says the ticket wasn't read from its
  tracker for this plan.
- **The prompt reads it as a consultant would.** "## The ticket's comments, oldest first", "## Related
  tickets", "## Attachments" (names only) and the changes field under its own name. The analyst is told that
  a later decision in a comment overrides the description; to name the comment it relied on, by author and
  date, in the finding or choice that rests on it; and, where comments disagree or a comment changes what the
  description asks, to ask a question (of the person who runs the build, or of the ticket's
  author) rather than choose.
- **Long tickets fit.** Comments are kept whole while they fit in 60,000 characters together, counted from
  the newest, so the newest win (`fitComments`, `PLAN_COMMENTS_MAX`). The newest is always kept, cut when it
  alone is longer. The prompt and the plan say how many of the oldest were left out. The description is cut
  at the criteria drafter's limit (`CRITERIA_TEXT_MAX`).
- **A plan keeps what it read.** The plan has `ticket` (`PlanRead`): whether it read the whole ticket and why
  not, how many comments, the newest one's author and date, how many were left out, the related tickets,
  attachments and the changes field's name. Its own words say it ("This plan read the ticket, its 2 comments.
  The newest comment it read is Jordan Kim's, 2026-10-21.") on the ticket page, in `acc analysis`, and in the
  builder's instructions. Plans made before this have none, and show nothing.
- **A plan that falls behind says so.** The ticket page counts the ticket's comments newer than the newest the
  plan read (all of them where it read none) and shows "2 new comments since this plan" with Make a new plan,
  in the plan's short section (D-200), under its version and approval (`extension/src/model/plan-behind.ts`,
  `extension/webview/plan-behind.ts`). Where its read failed, it says "3 comments this plan didn't read". It
  shows only where a new plan can be made: before the build, and not while one is being made. The section's
  own Make a new plan moves onto that line, so the page has one.
- **Talk it through gets the same comments (D-195).** The ticket the plan read is kept beside it
  (`.git/acc/analyses/<id>.ticket.json`). A message to the planning agent resumes the plan's own session,
  which read them; Open in Claude Code's brief holds them, from the kept file.
- Out of scope: reading attachments' contents.
