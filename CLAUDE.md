# Working on Agent Command Center

- Read `docs/DECISIONS.md` before changing direction. Record new decisions there.
  On a task branch, head a new entry `## D-??? <title> (<date>)` and refer to it
  as D-???. Whoever merges gives it the next free number (D-045).
- The plugin and extension must not depend on any skill outside this repo (D-002).
- The core stays project-agnostic. Salesforce behaviour belongs in the
  `salesforce` profile (D-003).
- Run builds and tests one at a time, under `nice -n 15`. Parallel compiles make
  the author's machine stutter.
- Look at UI changes before shipping them: `npm run build`, then
  `npm run screenshot`, then read the PNGs in `dist/screenshots/`. Tests can't
  see a broken layout.
- UI states use an icon and a label. Use orange against blue, never red against
  green. The author is colourblind.
- Commit as `jack-huffman <jack.huffman17@gmail.com>`. This is set in the repo's
  local git config, so don't change it.
