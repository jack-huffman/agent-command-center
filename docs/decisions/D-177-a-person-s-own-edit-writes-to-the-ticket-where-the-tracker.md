## D-177 A person's own edit writes to the ticket where the tracker allows edits (2026-10-20)

T-80. The task sheet showed a tracker task's title and description, but a
person couldn't change them (D-175). A person who adds detail to tickets, such
as a TA, had to leave acc to do it. This changes D-066 and D-175: where the
tracker says `"edits": true`, a person's own edit writes to the ticket. Text
that acc drafts is still a draft a person posts (D-066).

- **The tracker writes the ticket's text.** `setText(key, { title?, markdown? })`
  on every tracker writes only what it's given. Jira puts the summary and the
  description, as ADF, as a comment goes; GitHub runs `gh issue edit` with the
  title as one argument and the body on stdin. An empty title is refused.
  Azure DevOps, monday.com and Slack refuse with `textRefusal`'s reason and
  send nothing (`TEXT_TRACKERS` names the two that write).
- **The sheet, where edits are on.** Edit on a tracker task reads its ticket
  first (`TicketEdits.sheetTicket`), so the sheet opens with the ticket's own
  title and description, not as intake last brought them in, as boxes. Its
  status, assignee and labels show under the environment, each with a Change
  that opens the ticket page's own quick pick (`pickField`, which the page
  now uses too) under the same rule (`ticketActionRefusal`), then shows the
  ticket as it is now. Its dependencies stay read-only: they come from the
  ticket. Where the tracker can't take text, the title and description stay
  text with its reason; where the ticket couldn't be read, they stay text and
  say why.
- **Where edits are off,** the fields stay read-only, as D-175 drew them, and
  the sheet says the project's settings can turn on edits (`EDITS_OFF`).
- **Safe writes.** Save sends the text the sheet opened with. The extension
  checks the project still allows edits, then `saveTicketText` reads the
  ticket again: someone changed it since, so Save writes nothing and sends the
  ticket's text back. The sheet shows both versions; Use theirs puts the
  ticket's text in the boxes, and Keep mine saves the person's over it,
  checked against the ticket's text as just read. A ticket that already says
  what the person wrote needs no write. A failed read or write says why and
  writes nothing more. In each case the sheet stays open with the person's
  text, and Save waits for the answer before it closes. Once written, the task
  is read again from the ticket through `acc import`, as Track does, keeping
  its dependencies, and acc edit then saves the environment and notes. When
  the ticket was written but acc edit then failed, Save again writes nothing
  more to the ticket, since it already says what the person wrote.
- **A Jira description that Markdown can't hold isn't written.** The sheet
  edits Markdown, and Jira keeps ADF, so writing a description back drops
  what Markdown can't hold: mentions, attachments, panels, status lozenges,
  merged or coloured table cells, coloured or underlined text and the like.
  `adfUnkept` names each kind it finds in the ticket's description. Where
  there's any, the sheet warns before Save, naming them, and shows the
  description read-only, so Save writes only the title; its status, assignee
  and labels still change. Jira's `setText` reads the description again
  first and refuses with `unkeptRefusal`'s reason, writing nothing, whatever
  it was sent. Chosen over keeping those nodes through the round trip:
  splicing ADF back into edited Markdown can't tell which node a person meant
  to keep or delete, and a refusal can't harm a client's ticket.
- **The ticket page's description** has Edit (`editText`), which opens the
  sheet over the page, only where the tracker says `"edits": true` and acc
  keeps a task for the ticket, and off with `editRefusal`'s reason while its
  builder runs or once it's done.
- **Checked.** `packages/core/test/set-text.test.ts` has 8 tests: Jira's and
  GitHub's recorded requests and their edge cases, a Jira description with a
  mention and an attachment refused while a plain one saves, what
  `adfUnkept` names, and the other trackers' refusal.
  `extension/test/ticket-text.test.ts` has 6: what Save writes, the stop
  when the ticket changed meanwhile with the person's text kept, its
  failures, and the rows. `extension/test/task-sheet-edits.test.ts` has 8:
  the fields editable only where edits are on, read-only with `EDITS_OFF`
  where they're off, the warning on a description that can't be written
  back, the trackers that can't take text, opening once the ticket is read,
  the messages, and the description's Edit.
  `extension/test/task-sheet-ticket.test.ts` has 6, against the built
  extension and a stand-in gh: Save reaches `gh issue edit` and refreshes the
  task, Save stops on an issue changed meanwhile, Change on the status closes
  the issue, Save and Change refuse for a task no tracker holds and once the
  settings turn edits off, with nothing written, and a second Save after acc
  edit failed writes the issue no more. That is 28 tests. The tests floor
  went from 1796 to 1834: the base already held 1806 tests, 10 above its
  floor, so these 28 make 1834. One behaviour case drives the sheet in a
  browser (a Change, a failed write, both versions, Keep mine), and three new
  mutants each fail it. The screenshot run adds three pages over ACME-19's
  tab with edits on: the sheet with its ticket's text to write, the choice
  when the ticket changed after it opened, and the warning on a description
  that holds a mention and an attachment.
- Not chosen: writing a ticket's text from acc for Azure DevOps, monday.com
  or Slack; a merge of the two versions; and text acc drafts, which is the next
  task, and always a draft a person posts.
