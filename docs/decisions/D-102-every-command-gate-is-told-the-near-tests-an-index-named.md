## D-102 Every command gate is told the near tests, an index named index is found by its path, and per-area files reach the tests that read them (2026-10-07)

GH-117, from GH-95's review. It amends D-100. The merge queue's full check
still ran every test, but a builder could finish believing its change was
tested when it wasn't.

- **Every command gate is given `ACC_NEAR_TESTS` again**, as before GH-95.
  This replaces D-100's "only for a gate that reads `ACC_NEAR_TESTS`": acc
  couldn't tell that `npm run test:near` or `make near` reads it, and a script
  given an empty list ran nothing and passed. `readsNearTests` is gone. The
  list is worked out once a run, reading each file once, so the typecheck and
  the full check wait for it again, 25 to 60 ms on this repo. A check still
  never inherits either variable from the acc it runs under.
- **A file named index is found by its path, not its name.** It's named for
  its folder, and many folders have one: gates.test.ts quotes
  `packages/cli/src/commands/index.ts` as data, so every change to a module of
  core ran it. Its tests are now those named for it or that load it by its
  path or its folder's. This rewords D-100's "a module of core near only its
  own tests": a module of core is near its own tests and the tests that load
  core's index by its path (lock.test.ts, whose workers import it), and no
  longer near a test that only mentions an index. Across this repo's 248
  tracked .ts, .css and .json files, 30 near lists changed, all modules of
  core, each losing only gates.test.ts.
- **Any other index is still found by its name.** The ticket asked for every
  index by its path. But extension.ts imports more than half of
  `extension/src`, so it's the index of the 18 modules there it imports, and
  its tests load its build, `dist/extension.js`, not its source. By path alone
  those modules would lose activate.test.ts. A test pins that they keep it.
- **A per-area file that a test reads through a script, not an import, is
  near that test.** The rule is a table in this repo, not an acc config key:
  `READS` in `scripts/near-reads.ts` gives each kind of file and the script
  that reads it, and the near-tests gate adds the tests near that script for
  each such file in `ACC_CHANGED`. Each area's stylesheet, styles.css
  included, reaches screenshot.test.ts, which checks every theme defines the
  colours the styles use, through styles.ts. Each commands file and
  extension/package.json reach areas.test.ts through generate.ts. Naming the
  script rather than the test also brings page.test.ts, cards.test.ts and
  setup.test.ts, and a new test that reads the styles needs no edit to the
  table. It stays this repo's, since only its own scripts know what they
  read. DESIGN.md §2 says a new kind of per-area file adds a row.
- Not done here: the plugin's bundled acc (0.37.0, built before GH-95)
  already gives every gate the list, and takes the index rule at the next
  `npm run package`. The screenshot fixtures, and tests that read the page
  through `pageSource()`, still have no near rule (D-100).
