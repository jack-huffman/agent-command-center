## D-155 A project names its folders' indexes, so a count of modules doesn't decide its near tests (2026-10-15)

The tests near a change find a folder's index by a guess (GH-95): code in the folder that imports the
changed file and more than half the rest. `extension/webview/areas.ts` gathers 17 of the folder's 34
modules, so one more page module drops it below half, every page module loses `screenshot.test.ts` from
its near tests, and `scripts/test/near-tests.test.ts` fails. T-24 hit this, and T-35 and T-40 (D-154)
changed their design to avoid it.

- **The setting:** `gates.nearIndexes` in the project's settings is a list of paths from the repo's root.
  A named index gathers every code file in its folder, whatever it imports, and a folder with one isn't
  guessed at. A folder without one keeps the guess. A named path that isn't code in the checkout (a typo,
  or a file since deleted) names nothing, so its folder is guessed at. The parser refuses anything but a
  list of non-empty strings, naming the key. acc passes the list to `nearTests` once a run, as
  `ACC_NEAR_TESTS` is worked out. No path of this repo is in the code.
- **This repo** names `extension/webview/areas.ts`, the file the guess picks today, so the near tests of
  every page module stay as they were, and a new one is near `screenshot.test.ts` through `main.ts`,
  which loads `areas.ts`. `main.ts` itself, now gathered too, also gains `areas.ts`'s tests.
- **Not changed:** `scripts/near-reads.ts` asks `nearTests` for the tests near a reader in `scripts/` or
  `extension/scripts/`, whose folders name no index, so it doesn't read the setting.
- **Checked:** five tests. `gates.test.ts` adds three: a folder whose index imports two of five modules has
  no index without the setting and the named one with it; a named index reaches only its folder, and one
  that isn't code names nothing; and the setting reaches the list a gate is told. `config.test.ts` adds one
  on the parser. `near-tests.test.ts` adds one that puts more new modules in `extension/webview` than it
  had, and with this repo's setting finds `screenshot.test.ts` near every page module; without the setting,
  a new one loses it.

Out of scope: how a test is found near a file by its name or its import.
