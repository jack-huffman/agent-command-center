## D-224 Pick or change a tracker in a stepped modal, with its board live below the dropdowns (2026-10-28)

T-140. The person asked for adding and changing a tracker's settings to be a modal stepped through, with a proper
preview of the board: dropdowns across the top, the board below them, redrawn as each changes, so the tickets show.
It builds on D-193 (choose a board by seeing it), D-194 (several epics, a GitHub Project), D-210 (service desk
queues) and D-211 (up to ten boards, switched on the Tasks tab).

- **One modal** (`extension/webview/connect.ts`). The Connect page was a page drawn over the section that opened
  it. It is now a `<dialog>` over that section, made with `makeModal` as the task modal is: its title and Close in
  the bar, the step on show under a step bar, and a foot that stays in view with Back, why Next or Save is off,
  Cancel, and Next or Save. Every way in opens it: Settings' Connect a tracker… and Change place…, the Tasks tab's
  Add a board and a board's Change, and two new items at the end of the board switch's list, which it draws past
  `SEGMENTED_MOST` boards: Change with the board's name (such as "Change Renewals…") and Add a board…
  (`boardEdits` in `board-switch.ts`).
- **Four steps** (`CONNECT_STEPS`): Tracker (the project, when there are several, and the tracker), Sign in (its
  site or account, and signing in), the board (Choose a board, or Slack's Its channel), and Save. A new board
  opens on Tracker; an existing one on its board, its tracker and site shown fixed a step back; Sign in again opens
  on Sign in. The step is held by the extension (`ConnectState.step`), as every choice is, so Back and Next keep
  every pick. `connect-step` goes to a step only when `connectSteps` says it can be gone to: Sign in needs a
  project, the board needs a sign-in, Save needs the board drawn. A step that can't be on show is moved back to
  the last one that can (a failed sign-in to Sign in; Save while the board is read to the board). The step bar
  shows each step's number and title with an icon for where it stands, blue for done and here.
- **Dropdowns across the top** (`extension/webview/dropdown.ts`). Each list the tracker really has (Jira: project,
  queues, epics, board, sprint; Azure DevOps: project, team, board, area path; GitHub: Project and labels; monday.com:
  board, group, status column; Slack: channel and reactions) is a button that names its choice and opens a
  listbox of its choices, each with its details, its count of tickets (D-193's counts, asked for as the list
  opens) and any other repo that uses it. A list with more than `SEARCH_FROM` choices has a box to find one. One
  choice picks it and closes the list; a list that ticks several (epics, labels, queues) stays open while ticked,
  and its whole project unticks them. Arrow keys move through the list, Enter in the box picks the first found,
  Escape closes it. Under each dropdown: loading, why its list couldn't be read, or why the board couldn't be
  read with the choice made there. No tracker's board has a person in its settings, so there is no person
  dropdown: Mine or Everyone stays the Tasks tab's filter (D-222), on purpose.
- **The board below** (`previewPanel` in `choose-board.ts`). Its columns side by side as the Tasks tab draws them,
  with the Tasks tab's cards (read-only: nothing moves or opens), each column's first `PREVIEW_CARDS` (now 6)
  and how many more, a line with the count of tickets, a quiet skeleton and `aria-busy` while it reads, and Read
  it again when it failed. A choice that finds nothing names the list to widen: "No tickets would be on your
  board. Widen the labels: choose every issue in acme/service, or tick more."
- **Debounced, the last choice winning** (`ConnectSession.readPreview`). The board is read `PREVIEW_WAIT`
  (350 ms) after the last choice; a choice within it starts the wait again, so quick changes read one board. A
  read under way when the choices change is cancelled: taken out of the line if it hasn't started, its answer
  dropped if it has, so a slow answer for an earlier choice never replaces the board of the last. Read it again
  reads at once. A cancelled read gives back its place among `READS_AT_ONCE` at once, though its request may still
  be answered late, so a slow site's stale reads never hold up the latest board. A board that can't be read says why beside the dropdown changed last (`ConnectPicker.error`).
- **Nothing written before Save.** Picking, moving between steps and naming the board only change what the
  extension holds while the modal is open; Cancel, Escape and the backdrop forget it. While Save writes, Cancel is
  off with why, and a cancel sent then is ignored: the save under way finishes, then the modal closes. Save, on its own step,
  shows what it keeps: the site and each list's choice, each change marked with an icon and the word "changes";
  for an existing board, its tickets before (the board it opened with, `ConnectState.was`) and after.
- **D-205's three options.** The dropdowns are lists of things to pick from (projects, boards, teams, epics), not
  questions with suggested answers, as D-205 already said of the Connect page's lists. `choice-limit.test.ts`
  now counts a listbox as a single choice, so `dropdown.ts` is named there as exempt, with why, and so is the
  command palette's listbox; `choose-board.ts` draws no radio group any more and leaves the list.
- **Checked by** `extension/test/connect-modal.test.ts` (the steps and where each opens, a step moved back,
  Next refused until it can go on, Back and Next keeping picks, Cancel keeping nothing, Save writing once, the
  board redrawn with the tracker's answer, the debounce, the last choice winning over a late answer, a cancelled read giving back its place, Cancel off
  while Save writes, an error
  beside its dropdown, before and after), `extension/test/dropdown.test.ts` (the button's words, the search, a
  choice and ticks sent), `board-switch.test.ts` (Change and Add a board in the list), and four behaviour cases,
  "connect: Next that is off", "connect: while it signs in", "connect: the board under the dropdowns follows each
  choice, and nothing is saved until Save" and "connect: Back and Next move between steps", with mutants for a
  preview that doesn't follow the dropdown (a choice or a tick never sent), picking that saves before Save, Next on
  before the board is read, a search that hides nothing, Cancel that saves, Back that goes nowhere and Escape that
  says nothing. The shots `connect-start`, `connect-shared`, `connect-jira-board`, `connect-jira-save` (Jira) and
  `connect-azure-tracker`, `connect-azure`, `connect-azure-board`, `connect-azure-save` (Azure DevOps) draw each
  step; `connect-loading`, `connect-github` (empty), `connect-sprint` (failed) and `connect-dropdown` (a list open,
  searched) the board's states; `connect-existing` Save's before and after.
