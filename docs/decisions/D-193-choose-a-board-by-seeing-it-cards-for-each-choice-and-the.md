## D-193 Choose a board by seeing it: cards for each choice, and the board before it is kept (2026-10-22)

The person found the Connect page's row of dropdowns unhelpful: they want to choose a board and confirm it by
seeing what it would look like. Each list is now cards, and the board the choices make is drawn beside them.

- **Cards.** Every list on the Connect page is drawn by `pickerCards` (`extension/webview/choose-board.ts`):
  one card a choice, a tick icon on the one chosen (several for labels), its name and the description's
  detail (a Jira board's kind, Scrum or Kanban, from `boardKind`; an Azure DevOps board's Backlog level; a
  sprint's dates and state; a Slack channel's private or public). A list with more than `SEARCH_FROM` (8)
  choices gets a search box. Jira keeps one epic a tracker, so its epics are one choice, not ticks.
- **Counts are boards.** A list whose description sets `counts` (Jira's epic and board; Azure DevOps' team,
  board and area path; GitHub's labels; monday.com's board and group) shows how many tickets each card would
  hold. A count is the board of the place with that one choice made and the lists under it cleared
  (`countValues`), read only when the page draws the card and asks (`connect-count`, at most `COUNT_MOST`,
  24), `READS_AT_ONCE` (3) at a time. Until then the card shows a skeleton and Counting; a failed count says
  so on its card in orange, and the card can still be chosen. A card of the place itself (an epic, a label,
  an area path, a group) lists its first `CARD_TITLES` (2) tickets' titles.
- **The preview.** Each description has `preview(ctx)`: a client for the place the choices make, a few words
  for a place with no board (a Slack channel with no reaction), or null before there is a place.
  `readPlace` calls only its `board()`: choosing never writes to a tracker. Every board read is kept by its
  choices (`placeKey`) while the page is open, so a count read already is the preview when its card is
  chosen, and going back to a choice is instant. The preview draws the board's columns stacked, each with its
  first `PREVIEW_CARDS` (3) cards drawn by the Tasks tab's `trackerCard` (still: nothing opens or moves),
  and a line such as "11 tickets would be on your board, in 4 columns." An empty place says what to change.
  It sits beside the steps, and below them at 620 px and under.
- **Use this board.** Save is now Use this board, in the preview's foot, and is on only once the preview of
  the current choices has been drawn (`save.can`); while it reads, or when it failed, it is off and says why,
  and a failed read offers Read it again. Starting a project keeps Start the project. Settings' Change… opens
  the same page at the tracker's place, so it shows that board's preview. Step 3 is now Choose a board
  (`LISTS_TITLE`); Slack keeps Its channel.
- **Checked by** `packages/core/test/preview.test.ts` (each description's preview, that a preview reads only
  the board, that a Jira preview only makes GET requests, and the place a count reads),
  `extension/test/choose-board.test.ts` (each tracker's cards and counts, a failed count, the search, ticks,
  the preview's model, an empty place, and the session: Use this board refused until the preview arrives),
  and the behaviour case "connect: choosing a board…", with mutants that save without a preview, draw no
  board, send no choice from a card, and search without hiding. The shots `connect-jira-board` and
  `connect-azure-board` draw the board cards, the epic or area path ticked, and the preview.
