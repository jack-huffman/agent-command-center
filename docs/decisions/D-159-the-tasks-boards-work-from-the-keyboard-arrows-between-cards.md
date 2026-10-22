## D-159 The Tasks boards work from the keyboard: arrows between cards, Enter opens, Space picks a card up and moves it (2026-10-15)

T-54. A card moved only by a drag, and the keyboard couldn't go from card to card.

- **Both boards:** the tracker's board, which the Tasks tab opens on, and the agent board. A tracker's card
  may land in any other column, as a drag drops it in any; an agent board's card in the lanes its model
  gives (`card.drops`). Each board passes its columns, its cards and its move to `boardKeys` in
  `extension/webview/board-nav.ts`, so a drop and Enter on a held card call the same function and send
  the same message: `move` on a tracker's board, `move-task` on the agent board.
- **One card in the tab order:** the last card focused on that board, kept by the page while the tab is
  open, else the first. The card itself takes focus on a tracker's board; on the agent board, its title,
  which already opened the card and is what the task modal gives focus back to. A card with its title
  focused shows the focus on the whole card.
- **Keys:** Down and Up go to the next and previous card in the column, Home and End to its first and
  last. Right and Left go to the card at the same place in the next and previous column that has cards,
  or its last card; an empty column is passed over. At an edge, focus stays. Enter opens the card, as a
  click does. A key with Alt, Ctrl or Cmd is left alone, so `/` and Cmd+K still open the palette.
- **Space picks a card up:** the card says **Moving** with an icon, the board dims the columns it can't
  go to (but its own), and marks the ones it can with `can-drop`, as a drag does. Left and Right choose
  among those, marked `drop-target`. Enter moves the card there at once, as a drop shows it, and sends
  the move; Enter with none chosen puts it down. Escape, Tab, or focus on another card puts it down and
  sends nothing. A card with no column to land in holds nothing, and the line says it can't move from
  its column because no other column takes it from there.
- **The live line:** above each board, a status line with an icon (orange only for a card that can't
  move) says each step: "Moving ACME-16. Left and Right choose a column. Enter drops it. Escape
  cancels.", the column chosen, "Moved ACME-16 to In Progress", or "Put ACME-16 down. It stays in To
  Do.". Empty, it takes no room but stays in the page, so a screen reader hears it fill. A redraw keeps
  what it last said.
- **A redraw keeps the place:** the card focused as the page redraws is found again by its id and
  focused, in whatever column the new model puts it. A held card stays held across a redraw while it is
  on the board and may still land in the chosen column.
- **Motion:** the held card lifts 2 px with a 120 ms ease; under reduced motion it doesn't move.
- **Where the pure part lives:** the task named `extension/src/logic/board-keys.ts`. The page imports no
  values from outside `extension/webview` (`webview-imports.test.ts`), so it is
  `extension/webview/board-keys.ts`, with no DOM, as `fuzzy.ts` is for the palette: `nextCard` and
  `nextLane`, the looks of each step (`MOVE_LOOK`) and the line's words (`MOVE_WORDS`).
- **The screenshot run's start state** may hold a card (`holding`), as it may open a card's menu, so
  the page `tasks-moving` shows ACME-16 held with In Progress chosen.
- **Checked:** `board-keys.test.ts` adds 13 tests: each key, the end of a column, an empty column
  between two, the edge columns, one card on the board, a card with no lanes, keys the functions don't
  take, the looks and the words, and that both boards call `boardKeys` under a `liveLine`, with the
  same move a drop sends, and that a mutant catches each behaviour case. The looks test walks `MOVE_LOOK`. The behaviour run adds 5 cases (one
  card in the tab order and the arrows; Space, Right and Enter against a drop's message; Escape; a card
  no column takes, on the agent board; focus after a redraw, in the new column) and 6 mutants. Its click
  now focuses an element with any `tabindex`, as a browser does. The screenshot run adds `tasks-moving`.

Out of scope: a change to the mouse drag, and keys on the Overview's cards or other tabs.
