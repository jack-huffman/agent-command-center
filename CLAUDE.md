# Working on Agent Command Center

- Read `docs/DECISIONS.md` before changing direction. Record new decisions there.
- The plugin and extension must not depend on any skill outside this repo (D-002).
- The core stays project-agnostic. Salesforce behaviour belongs in the
  `salesforce` profile (D-003).
- Run builds and tests one at a time, under `nice -n 15`. Parallel compiles make
  the author's machine stutter.
- UI states use an icon and a label. Use orange against blue, never red against
  green. The author is colourblind.
- Commit as `jack-huffman <jack.huffman17@gmail.com>`. This is set in the repo's
  local git config, so don't change it.
