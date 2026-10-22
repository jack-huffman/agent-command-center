## D-117 The UI rules in CLAUDE.md are tests: an icon and a label, theme colours only, no overlaps (2026-10-07)

GH-105. CLAUDE.md asked for an icon and a label on every state, orange against
blue, and screenshots read before shipping, because the author is colourblind
and "tests can't see a broken layout". Nothing checked any of it.

- **Every state has an icon and a label** (`extension/test/looks.test.ts`). It
  walks 23 tables and functions that map a state to how it shows, through every
  value each takes: 616 states. It fails, naming the table and the state, on an
  empty label, an icon the codicon font the page ships doesn't draw, or a tone
  that isn't orange, blue or neutral. A source scan finds every top-level
  `Record<…, Look>` and function returning a look or a tone in the extension
  and the page (28), and fails on one neither walked nor in `NOT_TABLES` with
  why. Every icon name written in a look, an action or the page's `icon()`
  (432) is checked against codicon.css too.
- **Task states read core's DISPLAY everywhere**, and the test fails on a table
  of task states that differs from it or from DESIGN.md. In progress showed
  rework as a neutral wrench and done as a pass; the task feed showed done in
  blue. Now `displayLook` serves both, and the feed's look comes with each move
  from the model. A check's result is a table (`CHECK_LOOK`) in the model, not
  a ternary in the page. Jira's panels moved to `webview/looks.ts`, which has
  no DOM, since every other page module reaches the VSCode API as it loads.
- **A tracker's columns and the ticket's status pill gained an icon**, by
  status category (`CATEGORY_LOOK`): they had only a name and a coloured edge.
- **No red against green.** Each tone resolves through the page's styles and
  Light's and Dark's palettes to a hue; a table with a red and a green state
  fails. So does any colour the page's styles read that is red or green (774
  read). That found the one red: a delete button's hover read VSCode's error
  colour. It reads `--orange` now, and the palettes no longer set
  errorForeground. Hues come from Light and Dark, so a user's own theme isn't
  proven.
- **Colours come from the theme** (`extension/test/colours.test.ts`). It scans
  every declaration value in the page's stylesheets, but theme.css, and every
  string in its modules, for hex, rgb(), hsl() and named colours, with file and
  line. Two exceptions, each with why: mask alpha, and a tracker label's own
  colour. One that matches nothing fails. --line's last fallback is mixed from
  the foreground instead of a grey of its own.
- **The screenshot run checks geometry** (`extension/scripts/geometry.ts`). One
  Chrome launch writes the PNG and dumps the DOM, where the page wrote what it
  measured once its fonts loaded and two frames drew, so the run takes no more
  launches. A pure judge decides, unit-tested on made-up drawings: no two
  controls overlap, unless one is inside the other or floats in a sticky
  layer; no text is cut off, and an ellipsis passes only with its whole text in
  a title or aria-label; the rail's selected tab is in the rail's view; nothing
  scrolls sideways but a board, a wide table, the rail, code and a doc's table.
  Each check says how many it examined, a drawing with no controls or no text
  fails, and a whole run fails below its floors (examined on 41 pages × 2
  themes × 3 widths: 8760 controls, 27086 texts, 192 selected tabs, 918
  scrollers). It exits 1 naming page, theme, width and element; the shots are
  written either way. A planted negative margin on toolbar buttons fails it.
- **What it found, fixed:** at 620 and 500 px the selected tab of a later
  section (Environments, Setup, Settings) was past the rail strip's edge in 50
  drawings; the rail now scrolls it into view after each draw and again once
  the icon font loads. 34 labels cut with an ellipsis had no title holding
  them: the dock's run and command, Setup's command and detail lines, the
  agent page's tool lines, the Overview's inbox and lists, In progress's
  titles. Each now has one. `GEOMETRY_EXCEPTIONS` is empty.
- **It stays in `npm run screenshot`**, not `npm run check`: Chrome is slow and
  not in every gate's slot. The check runs the looks and colours tests and the
  judge's tests. A webview-only gate is a follow-up. CLAUDE.md says what the
  checks catch, and that the PNGs still need reading: spacing, alignment and a
  page that reads badly are beyond them.
- Not chosen: golden images or pixel diffs; the DevTools protocol; checking the
  sidebar, tree items and status bar, which draw with VSCode's own icons and
  colours; contrast ratios.
