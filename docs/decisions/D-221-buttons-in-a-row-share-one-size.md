## D-221 Buttons in one row share one size, and the screenshot run fails a row that mixes sizes (2026-10-28)

T-144. The person, with a screenshot of the Plan tab's conversation line, where Open conversation was a small
button beside the full-size Make a new plan: "we need consistency in our buttons in the UI. The two
differently sized buttons inline with each other is a poor experience."

- **The rule.** Text buttons side by side in one row are one size: the same height (within 1 px) and the same
  font size. A primary beside a secondary differs in colour, never in size.
- **One size per context.** Pick by context, not by taste:
  - A section's action row, a header, a dialog's foot, a task's actions: the full size (`.btn`, 13 px type,
    29 px high). Nothing in these rows is `small`.
  - A line in a table or a card (an agent's line, a card's row): the compact size the stylesheet gives
    `td .btn` and `.card .btn`. Every button in one cell is as high as the others, an icon-only one included
    (`.line-btn` has a `min-height`).
  - Inline in text (Show all, Why, More, a fold toggle, Ask on the ticket, the conversation line on its own):
    `small`. Nothing full-size sits beside it in that row.
- **The check.** `judgeSizes` in `extension/scripts/geometry.ts`, the `sizes` check. The page lists each text
  button with its container and the one around it. Two in one container, or one's container the other's
  wrapper (the conversation line inside the plan's actions), whose boxes overlap vertically and sit within
  16 px across, are a row. A row fails when the heights differ by more than 1 px or the font sizes by more than
  0.5 px, and the finding names both buttons, with the page, theme and width. Icon-only buttons, menu carets
  and the status button are not text buttons and are left out. A dialog laid over the page is another container,
  so a button behind it is not a neighbour.
- **It counts what it compared.** The check counts the pairs it compared. A run that compared none fails
  ("No row of side-by-side buttons was compared"), and the count has a floor in the floors file. The floor
  starts at one (`SEED_FLOORS`) until the file holds the check's own entry, which a clean whole run writes and
  which only goes up. The run's first count was 5,312 pairs.
- **No exceptions.** The first run found 4 rows: the plan actions' Open conversation (small) beside Make a plan, the deploy
  row's Other next steps (small) beside Deploy, and an agent's Answer (text) beside its Watch (icon only,
  two pixels lower). All are fixed: in the plan and analysis actions Open conversation takes the row's size, the
  deploy row's fold is full size (`foldButton(..., inRow)`), and the agent line's buttons share a minimum
  height. `GEOMETRY_EXCEPTIONS` is still empty.
