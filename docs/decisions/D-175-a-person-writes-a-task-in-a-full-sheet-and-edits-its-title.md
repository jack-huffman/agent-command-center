## D-175 A person writes a task in a full sheet, and edits its title, description and other fields later (2026-10-19)

T-74. A person wrote a task in two one-line boxes, and after that nothing
could change it: not the title, a full description, or the details a builder
needs.

- **One command, `acc edit <id>`.** It changes a task's title, brief,
  dependencies, environment, labels and notes for the builder, with `acc
  add`'s checks (`environmentProblem` and `taskDeps`, which `upsertTasks` now
  uses too). A field left out stays as it is; `--dep ""` or `--label ""`
  clears a list. Each edit that changes something adds an entry to the task's
  `edits`, with who made it and which fields, and emits `task.updated` with
  the new values; one that changes nothing records nothing. `edits` is apart
  from `history`, which holds moves: autopilot, the packet and History read
  `history` as moves, and an edit with `from` equal to `to` would read as one.
  `acc show` lists both in time order, the Command Center's History lists
  each edit as its own entry under Tasks (`EDIT_LOOK`, with the fields in
  words from `editedWords`), and a task's page shows its edits in its
  activity beside its moves. `acc add` takes `--title` and `--label`
  too, so a title that starts with a dash reaches it.
- **When an edit is allowed.** In `todo`, `blocked`, `rework` or `review`.
  While a builder runs, it's refused: the builder works from the brief it was
  given. A done task can't be edited. `editRefusal` gives each reason in
  words with no command (D-132). A builder or reviewer can't edit, and a
  builder's session denies `acc edit`. The next builder reads the edited brief
  in the packet acc writes at dispatch; a reviewer of a task a person edited
  since its builder started gets its title and brief as they are now, under
  their own heading (`editedSection`).
- **Tracker tasks.** For a Jira, GitHub, Azure DevOps, monday.com or Slack
  task, the ticket owns the title, description, dependencies and labels,
  since intake refreshes all four (`TRACKER_OWNED`); `acc edit` refuses a
  change to them, with why. A value given as it is now is no change, so a
  sheet that sends every field still saves the rest. Its environment and a
  new field, notes for the builder (`notes`), are acc's: intake never changes
  either. The packet (`notesSection` in `renderPacket`) shows the notes under
  "Notes for the builder", and leaves the heading out when there are none.
  The reviewer reads the packet, so its prompt adds the notes only when a
  person changed them after the builder started (`notesEditedSection`), and
  says so when they were cleared. Manual tasks have notes too.
- **The task sheet.** Add task opens a sheet over the page, in the page's
  modal, as Dispatch's does (D-168): "New task in" the project, with a title,
  a description of several lines (Markdown, as briefs are), dependencies and
  labels as lists with commas, and the environment from the project's
  unprotected ones, the default chosen. Edit opens it filled in, with notes
  for the builder too. A tracker's task shows what its ticket owns as text,
  under a line that says why, with Open in Jira (or its tracker). Add task
  or Save, the primary, is off without a title, with why; Enter in a one-line
  box saves, Enter in a description is a new line, and Cmd+Enter or
  Ctrl+Enter saves from anywhere; Escape cancels. The page sends what was
  written (`task-sheet-go`); the extension reads the task again and
  `taskSheetArgs` (`model/task-sheet.ts`) turns it into `acc add`, or `acc
  edit` with only the fields that changed and none its ticket owns, each as
  `--flag=value` so a value that starts with a dash stays a value. A Save that
  changes nothing runs nothing and says so.
- **Edit on a task.** `cardActions` lists Edit (`acc.task.edit`) on every
  task, so the task page, its modal and a card's ⋯ menu have it, off with
  `editRefusal`'s reason while its builder runs or once it's done. From a
  task's own tab or the modal, the sheet opens over that page, as Dispatch's
  does; from anywhere else, over the Command Center. The palette lists Edit
  for each task that can be edited now. A task's page shows its notes under
  its description.
- **Checked.** `packages/core/test/edit.test.ts` has 12 tests: each field, the
  record and an edit that changes nothing, each state allowed or refused,
  `acc add`'s checks, a builder or reviewer refused, a tracker's read-only
  fields, intake keeping the notes and environment, the packet's notes and
  their heading left out, the reviewer's, notes set before dispatch shown
  once, notes cleared since, and an edit's fields in words.
  `packages/core/test/dispatch.test.ts`'s builder settings test checks the
  session denies `acc edit`. `extension/test/edit-history.test.ts` has 3:
  History's entry for an edit and its Overview row, none without edits, and
  a task page's edits. The screenshot run's History has an edit of ACME-19,
  and ACME-12's page an edit in its activity. `packages/cli/test/tasks.test.ts`
  has 3 more: `acc edit` with `--json`, its refusals, and a tracker task.
  `extension/test/task-sheet.test.ts` has 9: the sheet for a new, a manual
  and a tracker task, Edit off with its reason, `acc add`'s and `acc edit`'s
  arguments, a tracker's, the page's message, and opening it.
  `task-sheet-open.test.ts` has 3, against the built extension: Add task's
  sheet reaches `acc add`, Edit's sheet over a task's tab reaches `acc edit`,
  and a running task's Edit is off and says why. The screenshot run adds three
  pages: the sheet for a new task and for a manual task over the Tasks board,
  and for ACME-19, a Jira task in rework, over its tab. Three behaviour cases
  drive the sheet's keys and clicks in a browser, and four new mutants (Escape
  saves, Enter in the description saves, Save drops the notes typed, Save with
  no title) each fail one. Two more Command Center pages raise the geometry
  run's floor for the selected tab from 474 to 486 drawings.
- Not chosen: writing changes back to a tracker, which stays the place to
  change its own text; editing while a builder runs; a separate field for
  acceptance criteria, which a brief holds.
