## D-T-127 A project's boards, one at a time, with a switch between them (2026-10-27)

T-127. The person asked for one project to manage several boards (projects, epics, queues), with a way to switch
between them to see each one's tickets. Then, the same day, for up to ten Jira boards from one project, across
several clients' Jira sites, each with its own sign-in: a TA in a managed-services practice. A project could already
hold several trackers, but the Tasks tab drew every board stacked down the page under one "Tracker boards" button.

- **One board at a time** (`extension/webview/board-switch.ts`). The Tasks tab shows the board on show, and a switch
  to the others. Up to three boards (`SEGMENTED_MOST`), it is a row of buttons: each board by its name and its kind's
  icon, and My work. Past three, it is one button that names the board on show and opens a list: My work, All boards,
  then each board, grouped by its site (a Jira site, an Azure DevOps organization, a monday.com account, a Slack
  workspace) or by its tracker's name where it has none (GitHub). Each board in the list shows its name, its kind's
  icon, how many tickets it holds and how many need you. With more than five boards (`FILTER_FROM`) the list has a box
  that finds a board by its name or site as a person types; Enter there shows the first one found. A board that
  couldn't be read (a sign-in that ran out, no access, a site down) shows an orange warning icon and the reason in
  words, and can still be switched to, so its Sign in is a click away. The switch never asks about a tracker's kind,
  so a new kind of board, such as T-128's Jira Service Management queue, appears in it with no change here.
- **D-205 and the switch.** It is navigation, not a question: it picks what the page shows, and nothing is decided
  or written by it. It keeps D-205's rule as `extension/test/choice-limit.test.ts` reads it: up to three boards it is
  a row of buttons beside My work, with no radio group, so its single choice never offers more than three boards;
  past three it is one menu of things to pick from, as the person filter is a menu of people, and the check names
  the module with that reason. `extension/test/board-switch.test.ts` pins both forms.
- **Remembered per project.** The choice is kept in the tab's memory, as the tracker or My work choice was
  (`memory().modes`), now `board:<id>`, `all` or `agents`. A board's id (`boardIds`) is a hash of its settings but its
  name, so a rename keeps the choice. Two boards in the very same place, differing only by name, still get two ids:
  the later one adds its place in the list, so the switch never matches both. Such a pair is a mistake, so
  `parseConfig` warns of it and the Connect page's Change refuses to make one, naming the other board; the reads go
  by each board's place in the list, so each of the pair is read. A board that's gone falls back to the first; an older tab's `tracker` is the
  first board; All boards kept, with three boards or fewer left, is the first board too.
- **The header and the person filter follow the board on show.** The header counts that board's tickets and those
  that need you ("Acme Service: 5 tickets on Renewals, 2 need you."), or says it can't be read now. Each board keeps
  its own person filter, as before. The board keys (`board-nav.ts`) work on the board drawn.
- **All boards** keeps the stacked view, from the list. With ten boards a stack runs on for pages, so each board
  starts folded to a button with its name and counts, and opens on a click; which are opened is kept in the tab's
  memory. The header counts a ticket two boards show once, and once if it needs you: it counts
  the distinct ticket keys across the boards on show.
- **A board's name** (`boardName`, `extension/src/model/boards.ts`). Each board is named as its tracker gives it:
  where its place is narrower than its project, that place ("epic ACME-3 Premium Support", "labels billing", "channel
  C0123ABCD"); else the board its tracker gives (the Jira board's name, the GitHub Project's title); and before it's
  read, its tracker and project. A person renames it on the Connect page, opened from its Change: a Board's name
  field, written as the tracker's `name` (up to 80 characters, `TRACKER_NAME_MAX`), read by `parseConfig` and listed
  in `CONFIG_KEYS`; emptied, the name is taken out and the tracker's own is used. Settings' Trackers and sign-ins
  shows the same name, as do the Overview's Not signed in rows and the Connect page's title.
- **Add a board.** The Tasks toolbar has Add a board, which opens the Connect page to add another tracker of any kind
  to the project (`acc.trackers.add` with the project and `add`). Save then runs `acc trackers set --new`
  (`addBoard` in `packages/core/src/config.ts`), which always adds: two boards of one Jira project with other epics
  sit side by side, where a plain connect would put the new one in place of the first (D-072). The very same board
  twice is refused, with why. After a board is saved, the Command Center's message offers Add another board.
- **Two of one kind on a site.** Allowed: another Jira project, or the same project with other epics. They share the
  site's sign-in (D-091): sign-ins are kept by site, not by board. Two boards that read one source (`sameSource`: one
  kind, site and project, repo, monday.com board or Slack channel) no longer warn that their keys clash.
- **A ticket on two boards is one task.** The ledger keeps a task by its ticket's key, so it already was one; both
  boards show its state, and the Overview names every board it's on. What changed is the place check (D-072): it used
  to ask only the first tracker whose key matched, and a ticket of a second board of one project would have looked
  outside the first board's epics and been taken off. Now the boards of one source are asked together
  (`sourceGroups`, `outsideEvery`): a ticket any of them shows stays, and one is outside only when every one of them
  says so. While one of them couldn't be read, none is asked about.
- **Remove a board**, from its Change on the Connect page (Remove this board…) or Settings (Remove…). The Command Center
  asks first, naming it ("Remove Renewals from Acme Service?"), then runs `acc trackers remove --index <n> --kind
  <kind>` (`removeTracker`), which refuses when another kind is at that place, as the list changed. Only the settings
  change: the tasks added from it stay on My work, nothing changes in the tracker, and the site's sign-in stays for
  its other boards. A builder can't run it (the builder's deny list holds it, as it holds `acc trackers set`).
- **Several sites, read in turn.** Each board uses its own site's sign-in (D-091), so boards on three clients' Jira
  sites sign in three ways, and one site's failure is its own board's error: the others read on. A project's boards
  are read three at a time (`READS_AT_ONCE` in `extension/src/logic/board-reads.ts`), the board on show first. The page
  tells the extension which board is on show (`board-shown`), and a board switched to while others are read goes
  next. A refresh reads the board on show at once and the others behind it. Each board is read once a refresh, as
  one board was before, so no site is asked more often than that. Three, because the board on show must not wait on
  nine others, and three at once keeps one Jira site to the three requests at a time the Connect page already uses
  for its previews (T-106): both read the one constant. Each board
  is drawn as soon as it's read, so the list's counts and Needs you fill in one by one.
- **The Overview.** Its Needs you rows for a task name the board or boards its ticket is on, after the project
  ("Acme Service · on Renewals · blocked"), when the project has more than one board. Its counts were already every
  board's, since they come from the ledger's tasks.
- **The screenshots.** `tasks-boards-two` and `tasks-boards-two-switched`, `tasks-boards-four` (the list open) and
  `tasks-boards-four-switched`, `tasks-boards-ten` (ten boards on three Jira sites, the list open and filtered by a
  site), `tasks-boards-ten-all` (All boards, one opened) and `tasks-boards-ten-signin` (a board whose site isn't
  signed in), each dark and light at every width. The geometry check takes an open `.more-menu` as a floating layer,
  as it took a `role="menu"` before, so the list's box doesn't count as overlapping the toolbar under it.
- **Checked by** `extension/test/board-switch.test.ts` (the choice and its fallbacks, the list's groups, finding and
  counts, both forms drawn, Add a board, a board that can't be read, All boards folded, a board's name, and the
  Overview's words), `extension/test/board-reads.test.ts` (ids, the read order and pace, sources, and a ticket outside
  only when every board says so), `extension/test/board-commands.test.ts` (acc's commands, Remove's question, Add
  another board, and the page's message), `packages/core/test/boards.test.ts` (a name in the settings, one source,
  `addBoard` and `removeTracker`), two cases in `packages/cli/test/trackers.test.ts` (`--new` and `remove`), two in
  `extension/test/connect.test.ts` (Add a board saves beside the first, with its name; a name changed and emptied, and
  Remove), the Settings cases, and the behaviour case "board switch: ten boards…" with two mutants it catches.
