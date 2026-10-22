## D-150 A calm Overview: Needs you first, every other list a quiet card that opens in full (2026-10-14)

The person found the Overview still much too dense: a header with four buttons, six stat tiles, and six lists
of up to five lines each (GH-160, D-131). They chose Needs you first, then a few quiet summary cards. T-36
follows the apple-design guidance: the common path first, the rest one level deeper, the most important thing
the most obvious.

This replaces, for the Overview only, these parts of D-131 (GH-160): "Five to a list" (Needs you shows three;
no other list shows lines on the page), "The header's summary and buttons, the tiles and In progress's
machine line stay" (the header has one button and a menu, the tiles are gone, the machine line is in In
progress's detail), Ready's Show all going to Tasks and History's last five on the page (both are cards that
open over the page), and In progress's fold (D-092), which has nothing left to fold.

- **The header** has the title, one line ("20 things need you", or "All clear: nothing needs you right
  now"), Add task, and a ⋯ menu with Start an agent, Add a tracker and Refresh, each with its icon. Each sends
  what its button did (`HEADER_MENU` in `webview/overview.ts`, through `moreMenu`). The line no longer names
  the project and its trackers; the rail names the project.
- **Needs you** shows its first three lines (`CAP` is 3), then Show all N. Its buttons stay primary (D-147).
  On the Overview a line keeps its state, its task, its title and its button; its facts go into its title.
  With nothing in it, one calm line says so, with no heading.
- **A card for each other list** that holds a line, in this order: In progress, Ready for an agent, When you
  have a moment, History, and the merge queue. A card has the list's name, its count and one muted line:
  "3 waiting on you", "ACME-16 next", "GH-41 next to merge", or the first line's title. It is a button,
  named "In progress, 6: 3 waiting on you"; a click or Enter opens the list in full in the detail Show all
  uses, History with its filters. A detail opened from that list, such as the suggested rules, sends focus
  back to the card when it closes. The model carries the cards (`overview.cards`), built by `overviewCards`
  in `webview/pending.ts`, where `hideSettled` builds them again when a suggested rule leaves (D-149).
- **The model:** each list has `shows` (3 or 0), `all` (every line, always) and `opens`. History holds
  every item, not its last five. The stat tiles are still in the model, as tests read their counts, but the
  page doesn't draw them.
- **Spacing:** 32 px between Needs you and the cards, 5 px between lines, lines 32 px high.
- **Checked:** the screenshot run's Overview check now fails on more than three lines in Needs you, and on
  cards out of their grid: another width, another height in one row, out of the first row's columns, or out
  of line with their row (`judgeCards`). It also measures the lines and buttons of a list a detail shows over
  the page. It counts cards with lines and fails on none. The run adds five pages: `overview-needs`,
  `overview-progress`, `overview-ready` and `overview-moment`, each list open in full, and `overview-clear`,
  the busy Overview with nothing that needs you. The behaviour run adds
  two cases (each card opens its list in full, In progress with its machine line, focus back; the header's
  one button and its menu's three messages) and four mutants. `landing.test.ts` adds four tests, among them
  one that walks the busy Overview and finds each list's lines on the page or in what its card opens.
- **Floors lowered:** the page draws fewer lines and buttons, so the run's floors for overview (1200 to 800),
  buttons (1000 to 450) and overlap (13700 to 13600) were lowered to under what it now examines (834, 462,
  13678). The tab floor rose to 348 for the five new pages. The person approved the lowered floors on 2026-10-14, when merging: the drop is the redesign's point.
- **Looked at, at merge:** overview-landing at 1000 px light and 500 px dark. Needs you comes first with three
  lines and Show all 19; four cards follow (In progress 6, Ready 6, When you have a moment 13, History 12),
  two to a row at 1000 px and stacked at 500 px, where each Answer button shows its icon alone.

Out of scope: what each list holds, the detail itself, and the other tabs.
