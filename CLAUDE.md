# Working on Agent Command Center

- Read `docs/DECISIONS.md` (an index of `docs/decisions/`) before changing
  direction. Record a new decision as its own file: on a task branch, add
  `docs/decisions/new-<task>-<slug>.md`, headed `## D-<task> <title> (<date>)`,
  and refer to it as `D-<task>` (such as D-T-97). The merge gives it the next
  free number and writes that over `D-<task>` in the branch's own lines
  (`acc decisions number`, D-197). Never edit `docs/DECISIONS.md`: it is
  generated (`acc decisions index`).
- The plugin and extension must not depend on any skill outside this repo (D-002).
- Research and supporting notes stay local: `docs/research/` is gitignored, and
  nothing committed links to it. Anything taken from another repo is copied in,
  with where it came from, never linked or fetched at run time (D-098).
- The core stays project-agnostic. Salesforce behaviour belongs in the
  `salesforce` profile (D-003).
- Run builds and tests one at a time, under `nice -n 15`. Parallel compiles make
  the author's machine stutter.
- Look at UI changes before shipping them: `npm run build`, then
  `npm run screenshot`, then read the PNGs in `dist/screenshots/`. The project
  verifies a UI change with the pinned headless shell
  (`extension/scripts/browser.json`), never the person's own browser: run
  `npm run browser` once to get it. Don't set `CHROME` to the Chrome app; the
  gate fails a shot the pinned shell didn't draw. The run
  measures every page at 1000, 620 and 500 px, dark and light, and exits 1 when
  two controls overlap, a label is cut off (an ellipsis needs its full text in a
  title), the selected tab is out of view, a sticky cell covers another cell's
  text, the output panel shows a block of raw output, the page scrolls
  sideways (`extension/scripts/geometry.ts`), or axe-core finds a WCAG 2.1 AA
  violation that `A11Y_EXCEPTIONS` doesn't excuse
  (`extension/scripts/a11y.ts`). It can't see spacing, alignment or a page
  that reads badly, so the PNGs still need reading. Checked by the builder's
  `screenshots` gate (`extension/scripts/looked.ts`, D-138): a branch that
  changes `extension/webview/`, `extension/src/` or `extension/scripts/` fails
  unless every page, theme and width was shot of its last commit with no
  geometry findings, and every CSS class it adds is drawn on screen in some
  shot (or named in `UNDRAWN` with why), and every shot was drawn by the
  pinned headless shell (T-68). It counts the shots it checked.
- The Command Center speaks in processes, not commands or paths (D-132): "Run the
  checks", "the project's settings", never `acc gate run` or `.acc/config.json`.
  The names are in `extension/src/logic/processes.ts`, and what acc says goes
  through its `inProcessWords` on the way to a person; what acc recorded (a
  step's reason, a hold, a blocker) goes through `extension/src/logic/relayed.ts`
  where the extension reads it. The screenshot run's words
  check (`extension/scripts/words.ts`) fails on an acc command, `npm run`, a
  `.acc/` path or a `docs/` page on any page, outside elements marked as work
  data with `work()`; `extension/test/words.test.ts` pins where those are.
- UI states use an icon and a label. Use orange against blue, never red against
  green. The author is colourblind. `extension/test/looks.test.ts` walks every
  table that shows a state, and fails on a missing label, an icon the codicon
  font doesn't draw, a red and a green state in one table, or a new table it
  doesn't walk. `extension/test/colours.test.ts` fails on any colour the page
  writes outside the theme.
- Commit as `jack-huffman <jack.huffman17@gmail.com>`. This is set in the repo's
  local git config, so don't change it.
