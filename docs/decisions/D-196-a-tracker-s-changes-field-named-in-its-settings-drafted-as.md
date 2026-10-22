## D-196 A tracker's changes field: named in its settings, drafted as an update when a ticket's changes change, saved by a person (2026-10-22)

Many teams keep a ticket field for what a ticket changed, such as "Deployment Notes", so whoever deploys to
production knows what to move, records included. The person asked to name that field for a tracker, so the
Command Center keeps it up to date from the ticket's changes (D-189's paths, D-190's record changes, T-101's
package.xml), and so changes a developer wrote there by hand aren't lost. T-105.

- **The setting.** A tracker's `changesField` is `{ id, name, format }`, checked by `changesFieldProblem`
  (`packages/core/src/changes-field.ts`): a format its tracker has (`FIELD_FORMATS_OF`): `adf` on Jira,
  `html` or `plain` on Azure DevOps, `plain` on monday.com. GitHub issues have no fields, so on GitHub it
  can only be the description's section under the heading "Changes (kept by the Command Center)"
  (`GITHUB_CHANGES`). Slack threads have none: the setting is an error there (`changesFieldRefusal`).
- **The field list holds only fields of more than one line,** since the text is a list. Each tracker's
  `textFields` reads its own fields API: Jira's long-text custom fields (`textarea`, ADF), never a one-line
  `textfield` or Jira's own fields; Azure DevOps' HTML and plain-text fields on the work item types its board's
  columns map, never a one-line string field, `System.*` or a read-only field; monday.com's long-text columns.
  Settings' Trackers has a row of its own for each tracker, Changes, beside Place, Board and Sign-in, with
  Choose… or Change… (`acc.trackers.changesField`), which lists them in a quick pick with None first, and has
  acc write the choice, as the Connect page's Save does (D-064). Slack's row and button are off, saying why.
  The Connect page shows the same row, "Where to keep a ticket's changes", once the place is chosen, after its
  lists, without changing its pickers; for a tracker not saved yet its button is off until it is.
- **An update draft, made when the ticket's changes change (D-066).** A new update event, `changes`, carries
  the field it's for. `draftChangesField` (`packages/core/src/field-drafts.ts`) drafts it at each moment a
  ticket's changes change: acc land opening or updating its pull request with new commits, a builder's
  acc done, acc change record, acc manifest build, autopilot's merge, acc sync seeing it merged, and a person
  moving it to done. Its text is `changesDraft`'s Markdown: each component once, grouped by type in bold (by
  folder outside Salesforce), then each change outside git under its kind's label, then the package.xml's
  members and deletions where T-101 built one, then "As of <date>.". As with D-066's other news, a newer draft
  replaces an open one; changes that say what the open draft, or else the last saved one, says draft nothing.
  A Slack task, a task acc alone keeps, and a tracker that names no field get none. Drafting never stops the
  step it follows. The draft is listed with the ticket's other drafts: under Needs you on the Overview, with
  Edit and Discard, and at the top of the ticket's Activity in a box to edit. Its button says Save to the
  ticket, and "Saving as …". `acc update post` refuses it: it isn't a comment.
- **A person's lines are never lost.** A line in the field that the Command Center didn't write, in any text
  it drafted for the field (`writtenFor`), is a person's (`keptLines`); a line it wrote once and no longer
  finds, such as a component taken out, isn't. On the ticket's page, once the field is read, the draft offered
  keeps each of them under "Kept from the ticket", before the date (`withKept`, `withFieldKept`), so saving
  it as offered removes none. The save does the same again with the field as read at that moment, so a
  draft saved from the Overview, or a line written on the ticket since the page was drawn, loses nothing. To
  take a person's line out, edit the field on the ticket. This replaces this task's first build, where the
  page drafted the text on each redraw and refused a save when the field had changed since it was shown.
- **The read-back.** The ticket's page reads the field each time it loads the ticket (`FieldReads`) and shows
  it under Changes as "From the ticket's <field>", with how it compares (`FIELD_LOOK`): the same as found,
  the person's lines counted as kept (blue, `sameChanges`, which ignores the date line, spacing and Markdown),
  differing or empty (orange), with a line saying the draft update in Activity is its new text, or, with no
  draft, that one comes when the ticket's changes next change.
- **Saved by a person only.** Save to the ticket sends `update-post`; for a `changes` draft the extension has
  acc claim it (`acc update posting`, D-066), then `saveField` reads the field and writes it once, through
  `writeField`, and acc records the text written (`acc update posted`); a failed save puts the draft back
  with why (`saveClaimed`). It refuses, writing nothing, where the tracker's settings keep edits off (D-066,
  D-177; the card's Save is off saying why), where no field is named, or where the settings now name another
  field. A read, a draft and a redraw never write.
- **Each tracker's format,** through the document model's converters (`packages/core/src/trackers/fields.ts`):
  Markdown on GitHub, HTML for an Azure DevOps HTML field, ADF for a Jira long-text field, plain text that
  keeps its list's dashes otherwise (`plainOf`). GitHub's `writeField` reads the description again and sets
  only its section (`withGithubSection`), in place or at the end; a heading in a code block isn't one.
- Out of scope: writing the field without a person's save.

Tested in `packages/core/test/changes-field.test.ts` (18 tests), `packages/core/test/field-drafts.test.ts` (6)
and `extension/test/changes-field.test.ts` (17). The screenshot run draws `ticket-changes-field` (the
read-back and its draft update with the kept lines), the row in `settings-trackers` with Slack's off, and the
row on `connect-existing`.

## D-194 Tick several Jira epics, and choose a GitHub Project from its card (2026-10-22)

The person asked to tick epics, and for a GitHub repository's Projects to be cards. D-193 kept one epic a
Jira tracker and gave GitHub only its labels' cards; this changes both, and the preview follows each choice.

- **Several epics.** A Jira tracker's place is `epics`, a list of epics' keys (`Tracker.epics`). A file
  before this one names one as `epic`: parseConfig reads it as a list of one, and with both keys it reads
  each epic once. `epicKeys` writes one epic as `epic`, as before, so an older acc still reads it, and several
  as `epics`; the other key is null, so changing a tracker takes it out. The board asks Jira for
  `parent in (…)` of every epic, and their sub-tasks as before. Intake's place check (D-072) takes a ticket
  under any of them, or a sub-task of one, as inside; outside, it says "it isn't in epic ACME-3 or ACME-7".
  The place reads "epics ACME-3 Premium Support or ACME-7 Renewals", and the README links each epic.
- **The epic step ticks.** The Connect page's Jira list is now Epics (`epics`, `multi`): ticked cards, The
  whole project for none, as GitHub's labels are. The preview reads the board of the ticked set; each card's
  count is still its own epic's board. Starting a project from Setup says "from epics".
- **GitHub Projects as cards.** GitHub's Connect steps gain a Project list (`board`, before Labels):
  Issues, open and closed, then each of the repo's Projects with a Status field
  (`githubProjectOptions`, from `GithubClient.projects()` through gh), with its title, `#number` and item
  count, and "closed" on a closed one. A Project with no Status field has no columns to give, so it isn't
  offered. The repo's first open Project is the default, as the board takes it with no `board` set, so
  keeping it leaves `board` out; another sets `board` to its number. Its card reads no count: it says its
  own items.
- **No Project.** Issues, open and closed writes `board: "issues"` (`GITHUB_NO_PROJECT`): the board's
  columns are Open and Closed even where the repo has a Project, with no notice, and a task's card isn't
  moved on a Project (GH-146), so GitHub isn't asked. Before this there was no way to say it.
- **No access.** Where gh can't read Projects, the list is one card, Issues, open and closed, whose detail
  is `projectsAccess`, the words the Tasks tab's notice already used, now shared. Like the notice, it goes
  through `inProcessWords`, so the card says what to do, not a gh command line (D-132): every card's detail
  on the Connect page now does. The board can still be
  used, and once access is given, the board takes the repo's first Project.
- **Checked by** `packages/core/test/epics.test.ts` (several epics and an old one in the settings, how
  they're written, the board's query, intake's inside check, the README and place words),
  `packages/core/test/github-projects.test.ts` (the Projects list and its refusal, the cards, the board
  written, the preview of each, and `"issues"` in the settings), a case in `packages/core/test/cards.test.ts`
  (no Project: no card moved), `extension/test/connect.test.ts` (the Project cards in the session: the
  default chosen, another and no Project saved, the preview following each, and the access card), and
  `extension/test/choose-board.test.ts` (ticking a second epic reads the ticked set's board, and the
  GitHub shots' models). The behaviour case "connect: choosing a board…" ticks a second epic and checks
  both are sent. The shots `connect-jira-epics` (two epics ticked, and their board), `connect-github-board`
  and `connect-github-access` draw them.
