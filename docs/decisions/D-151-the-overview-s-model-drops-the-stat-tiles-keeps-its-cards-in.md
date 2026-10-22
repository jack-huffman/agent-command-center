## D-151 The Overview's model drops the stat tiles, keeps its cards in the host, and its card words agree with the header (2026-10-14)

T-36 (D-150) left four points. This entry adds to D-150, which stays as a dated record.

- **No stat tiles.** `OverviewModel.stats`, `StatTile`, the `stats` hook of `HomeArea` and each area's `stats`
  function (tasks, agents, worktrees, setup) are gone. D-150 says the tiles stay in the model; they do not now.
  The three assertions that only read a tile's value are removed: in `overview.test.ts` the Setup tile's `1/2`
  and the Waiting for review tile's `1`, and in `activity.test.ts` the Agents working tile's `4`.
- **The host builds its cards.** `overviewCards`, `cardLine` and `CARD_ORDER` moved from `webview/pending.ts` to
  `src/model/landing.ts`, so `home.ts` imports nothing from the page. The page cannot import values from the
  host (D-121), so `hideSettled` builds no card from scratch: it changes only the When you have a moment card,
  to the list's count and first line, or drops it with its last line. `settled.test.ts` already holds the result
  equal to the host's `overviewCards` over the same lists, in each case.
- **In progress names its states.** The card said "N waiting on you" for the lines that stopped or ask
  something, while the header can say all is clear. It now counts those lines by their own state, such as "2
  stopped" or "1 asking, 1 failed"; a line whose state is "Waiting on you" is counted as "asking". With none
  of them, it says what is first, as before. A test takes a sample where the header says all is clear, and
  finds no card that says something waits on the person.
- **A pinned count.** The behaviour test pins the line count of the When you have a moment card (4), as it does
  the other cards, and no longer reads it from the cards.
