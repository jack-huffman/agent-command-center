## D-168 Dispatch asks for the model, the effort and where it runs in one sheet, and a task's buttons share one size and place (2026-10-16)

T-67. A task showed Dispatch, Dispatch with…, Dispatch to the cloud, Move and
Block as buttons of different widths, in rows that wrapped where they fell.
Dispatch started a builder at once; Dispatch with… asked for the model and
the effort in two of VS Code's pickers, one after the other (D-086, D-128).
The author wanted one Dispatch that asks first, and the buttons on a task in
one size and one place.

- **One Dispatch, one sheet.** Dispatch opens a sheet over the page, in the
  page's modal (`makeModal`): "Dispatch ACME-16", or "Re-dispatch ACME-19" for
  a task in rework. Model is a list of `dispatchModelItems`, the one the
  builder uses chosen, its source in muted type ("project default", "picked
  for this task"); Another model… shows a box for a name, and Dispatch is off,
  with why, until it holds one. Effort is a segmented control of the levels
  the chosen model takes, lowest first, the one it runs with chosen; the line
  under it says where that's set or what the level means. A model that takes
  no level hides it and says so, with the pick it drops. Where is This Mac or
  the cloud, the project's default chosen; the cloud is off with
  `cloudDisabled`'s reason in its title and in a line, and chosen, a line says
  the routine's own model and effort apply there. The analysis's size shows
  in muted type. Cancel and Dispatch, the primary, close it; Enter
  dispatches, Escape cancels, and focus goes back to what opened it.
- **The page that asked shows it.** From a task's own tab, the sheet opens
  over that tab; from the modal over the board, over the Command Center
  under it; from anywhere else, such as the sidebar, a notice, the palette or
  a key binding, over the Command Center, which opens first when it's closed
  (`Panels.tell`). A card dropped in Running opens it too, in place of the
  old confirmation, and goes back to its lane meanwhile.
- **The choice is acc's arguments.** The page sends what was chosen
  (`dispatch-sheet-go`); the extension reads the task again and
  `dispatchChoiceArgs` turns the choice into arguments with
  `dispatchModelArgs`, `dispatchEffortArgs` and `noEffortArgs`. A choice the
  same as the sheet's defaults sends none, as acc keeps a pick made before; a
  place other than the project's default sends `--cloud` or `--local`.
  `dispatchTask` runs it, and a cloud builder's run says so and offers its
  session on claude.ai, as Dispatch to the cloud did.
- **Dispatch with… and Dispatch to the cloud go.** `cardActions` lists
  neither. Their commands stay for one release, so a key binding still works,
  and each opens the sheet; Dispatch to the cloud chooses the cloud when it's
  on. Dispatch anyway (D-093) opens the sheet too, its button "Dispatch
  anyway" and the tasks and files it shares above the choices. After the
  sheet, a first dispatch that would wait for others' files still asks whether
  to wait, and one acc holds still asks before Dispatch anyway, as before.
- **One size, one place.** A task's actions keep one order, `actionOrder`:
  the next step, then Move, then Block or Unblock, then the rest as they
  came. On the task page, the next step is a full-width button on a row of
  its own, and the rest sit under it in two equal columns, each 30 px high,
  with its icon and its label, cut with an ellipsis and whole in its title
  (`task-actions.ts`). A disabled one stays in its place, with its reason in
  its title. A card's next step is the same full-width button under its
  footer's line; the rest stay behind ⋯ (D-062), in the same order, one to
  a row.
- **Checked.** `dispatch-sheet.test.ts` has 9 tests: the sheet for a task
  to do and in rework, a model that takes no effort, the cloud off with its
  reason, Dispatch anyway, the effort segments, and the arguments, the
  defaults sending none and another model, effort and place each sending
  theirs. `dispatch-sheet-open.test.ts` has 5, against the built extension:
  each of the four commands opens the sheet and dispatches nothing; a task's
  tab and the modal show it over themselves; a closed Command Center opens
  first; the sheet's Dispatch reaches acc dispatch. `cards.test.ts` checks
  that no card lists Dispatch with… or Dispatch to the cloud, `actionOrder`
  and the task page's `taskActions`. The screenshot run adds four pages:
  the sheet over the Tasks board for ACME-16, analysed; over ACME-19's tab
  in rework with the cloud off; the agent board with a card's ⋯ open; and
  Dispatch anyway's sheet for ACME-35, with the files it shares. The name box
  for Another model… shows only after a pick, so the screenshots gate's
  `UNDRAWN` names it, and a behaviour case draws it. A new geometry check,
  `actions`, finds a task page's buttons equal in height, the grid's equal in
  width and the next step as wide as the grid, and a run with no task page
  buttons to measure fails; an open menu floats over the page, as a sticky
  layer does. Three behaviour cases open the sheet from a card and from the
  task page, pick a model and see the efforts change, press Enter and see
  the message, press Escape and see none, and type a model's name for
  Another model…; six new mutants, Dispatch without the sheet among them,
  each fail one.
- Not chosen: a grid of every action on a card, which D-062 put behind ⋯;
  folding acc's own wait for others' files into the sheet; Autopilot's
  dispatches, which ask nobody.
