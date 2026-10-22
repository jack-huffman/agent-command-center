## D-085 A monday.com board is a tracker, connected on the Connect page (2026-10-06)

D-005 left monday.com for later, and D-073 made a new tracker a client and a
description. The author asked for it now (GH-70). It's built the way Azure
DevOps was, with three choices a person made.

- **A board is the tracker, as a Jira project is; a group on it is the place
  (D-072).** The config names `account` (as in acme.monday.com) and `board`
  (its id, a number below 2^53), and may name `group`. The board is what an
  existing tracker shows fixed, by its name, and what a draft is checked
  against before it posts. Two boards on one account are two trackers:
  `withTracker` tells monday.com trackers apart by account and board, since
  they have no project. Board and group names are read from monday.com when
  the board loads, never stored; before that, the place names them by id.
- **Sign-in is a personal API token, kept for this repo only (D-027).** It sees
  everything its person sees in monday.com, so the sign-in check compares the
  token's account (`me.account.slug`) with the account typed, and refuses one
  from another account, naming it, beside the token. Create a token opens
  `https://<account>.monday.com/apps/manage/tokens`, the Developer Center's My
  access tokens; monday.com's docs give the menu path, not a URL. The Board
  list is the boards the token can see, by workspace then name, leaving out
  sub-item boards, documents, and archived or deleted boards.
- **The board's columns are one status column's labels** (a person decided).
  A Status column list follows the board, depending on it, with the column
  called Status chosen, or else the first status column. It's drawn only when
  the board has more than one, and `statusColumn` is written only when it
  isn't that usual one. Labels go in monday.com's own order; a done label's
  column is done, No status is to do, and the rest are in progress. No status
  comes first, and only when an item has none; a label monday.com has switched
  off gets a column only while an item is on it; an item on its blank label
  has no status. Dragging a card sets the label, whether or not the tracker
  says `"edits"` (D-066), as on the other boards.
- **An item has no description, so its long-text columns are** (a person
  decided), in board order, each under its column's title, as the ticket page's
  body and the builder's brief. With none filled in, the item's oldest update
  is. Updates and their replies are the comments either way. Sub-items are
  related tickets, never cards.
- **`"edits": true` lets the task page change two things** (a person decided):
  Status sets the chosen status column's label, and Assign sets the board's
  first People column, ticking any of the board's subscribers, or is refused in
  words when the board has none. Labels are always refused: monday.com items
  have no labels. Without `"edits"`, all three are refused before monday.com is
  asked anything, as for every tracker.
- **An item's key is `MON-<item id>`**, or the tracker's `prefix`, as Azure's AB
  is. Item ids are the whole account's, so `ticket()` holds every read to the
  board, and to the group when there is one: an item elsewhere is outside,
  naming where it is. `outside()` reads items by id, a hundred at a time; a
  batch it can't read, or an item it can't see, is never outside (D-048), and
  with `project` only the board counts.
- **A second board's keys are its own.** A key finds only the first tracker
  whose prefix it has, so a second board on the account keyed MON too would
  lose its items to the first: that board's place check found them on another
  board, and `acc intake` took the unstarted ones off the ledger, and their
  drafts could never post. So when the Connect page adds a monday.com tracker
  whose prefix another tracker already gives (a monday.com board or a Jira
  project called MON), it writes the first free one, `MON2`, `MON3` and so on,
  as `prefix`. A prefix the config already names is kept. A config written by
  hand with two trackers giving one prefix still gets a warning. So does the
  other order, accepted as unlikely: a Jira project keyed MON added after a
  monday.com board that uses MON. Only adding a monday.com board picks a free
  prefix, so the two share it, and only acc's config warning on the command
  line says so.
- **Updates post as item updates**, as HTML with every word escaped, through
  the Command Center only; `acc update post` refuses them as it does Jira's.
  `acc intake monday --file` follows items that left the place, and
  `acc import` refuses a monday.com key no monday.com tracker owns. Items come
  in through Track (D-074); the intake skill has no query for them.
- **GraphQL at `https://api.monday.com/v2`, pinned to `API-Version: 2026-10`**,
  monday.com's current version since 2026-10-01. Ids, names and text always go
  as variables, never into a query's text. A board asks only for its status
  and People columns, 500 items a page by `items_page` cursors, up to 2,000
  cards, and only its group's items when there is one. A rate or complexity
  limit is said with its wait and not retried: the board reloads in 120 s
  anyway. The status column's labels are read from `columns.settings` in the
  2026-10 shape (`labels` with `id`, `index`, `is_done`, `is_deactivated`);
  the older shape, a map of ids to names, is read too. The stand-in in the
  tests encodes that shape, so one board should be checked against a real
  account before a release.
- **The Connect page gained two things any description can use**, still with
  no tracker named in its drawing: a list drawn only when it has a choice to
  make (`hideSingle`), and an identifying list whose values are ids, loaded for
  an existing tracker to show the name (`idValues`). A "whole" choice can name
  what's chosen above it: "Every group on Client work".
- **The tracker kinds are listed once** (`TRACKER_KINDS`), and the config,
  ledger, updates and Command Center take theirs from it, with `trackerName`
  and `signInLabel` for the words.
- Not chosen: OAuth or a marketplace app; webhooks or live updates; several
  boards or groups per tracker; sub-item boards as boards; creating items;
  posting monday.com updates from the CLI; a brand mark for its icon (it's the
  `table` codicon).
- This takes up what D-005 deferred for monday.com. Slack stays a place for
  acc's notices (D-078), not a ticket source.
