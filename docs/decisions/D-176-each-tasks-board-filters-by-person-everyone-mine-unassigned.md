## D-176 Each Tasks board filters by person: everyone, mine, unassigned, or one person (2026-10-20)

T-79. The Tasks board showed every ticket in the place, whoever had it, with no
way to narrow it. A person who reviews other people's work, or wants only their
own, had to scan the whole board.

- **One filter on each board.** A button in the board's header says the choice
  and a count, "Mine · 7 of 42" (Everyone says the total, "Everyone · 42"). It
  opens a menu of Everyone, Mine, Unassigned and each person with a card on the
  board, by name, each with an icon (`organization`, `account`,
  `circle-large-outline`, `person`), its label and how many cards it shows. The
  logic is `webview/person-filter.ts` (pure, tested in `person-filter.test.ts`);
  `webview/person-menu.ts` draws it. Colour carries nothing here: the icon and
  the words do.
- **The page draws only the cards that show.** The filter leaves the other
  cards out of the page, not hidden, so the board's keys (D-159), which go
  between the cards on the page, skip them with no change to `board-keys.ts` or
  `board-nav.ts`. A column's count and its label count the cards that show.
  A choice that shows no card leaves the board empty, with a line, "No card
  here is yours.", and Show everyone to get back.
- **Who Mine is.** On a tracker's board it is `me()` on that tracker, read after
  the board loads (`s.me` in `trackers.ts`) and matched to a card's assignees by
  the tracker's id, else by name (`whoKey`). A tracker that can't say leaves Mine
  off, with its reason on the menu item (`NO_ME`), and a board kept on Mine then
  shows everyone (`effective`), so the filter never hides every card for a reason
  the person can't act on.
- **Each board keeps its choice** in the window's state, in `filters`, by the
  board's key (`tracker:<project>#<index>`, `agents:<project>`). It survives a
  redraw, and a tab rebuilt as the window was. A person chosen who has no card
  after a refresh stays in the menu with none, so the choice can be changed.
- **The agent board filters by who dispatched each task.** A task row carries
  `dispatchedBy`: the `by` of its latest move from `todo` to `running`, as the
  ledger wrote it (`human:<account>`, or autopilot's `orchestrator:autopilot`,
  shown as Autopilot). A task nobody has dispatched is Unassigned. Mine is
  `human:` and this account's name (`dispatcherKey`, from `hub.user`, else the
  environment's USER), which is what `acc` writes for a person's moves
  (`actorFrom`). A rework's restart is not a dispatch.
- **Checks.** Extension tests for each choice, the count, a board where no card
  matches, Mine with nobody to mean, a chosen person who left, the sample
  boards' people and `deriveRows`' `dispatchedBy`; three behaviour cases in a
  browser (the menu with its icons and counts, the choice surviving a redraw,
  Down and Right skipping the cards it hides, and a board with no match), each
  named by a mutant; and four screenshot pages: the menu open, the Jira board
  filtered to one person, the agent board on Mine, and a board where the
  choice shows no card. The geometry run's floors rise with the pages: the
  selected tab from 486 to 510 drawings, and the controls examined for overlap
  from 17900 to 18000 (the run measured 21990), which a full run needs at 30 a
  drawing.
- Not chosen: filters by label, status or type, which the task leaves out; a
  filter shared between windows or kept on disk; hiding cards with CSS, which
  would leave the keys to step onto cards that can't be seen.
