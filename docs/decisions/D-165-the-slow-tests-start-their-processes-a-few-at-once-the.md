## D-165 The slow tests start their processes a few at once, the dispatch tests are three files, and the tests keep a compile cache (2026-10-15)

T-57. The test suite's time went to a few tests that start processes one after another, and to one file
that held 48 of them.

- **Pool:** `pool(items, size = 4, fn)` in `packages/core/test/support.ts` runs at most `size` calls at
  once and gives the results in the items' order. A call that throws makes it reject with a `PoolError`
  that names the item, and no later item starts. `packages/core/test/pool.test.ts` has 8 tests.
- **Pooled:** the CLI junk-argument test (8 at once), the extension junk-argument test (4 commands at
  once), the hook fixture test, and the cloud-guard Edit/Write test and push test (4 at once). Each keeps
  every assertion and its count line.
- **Split:** the CLI junk-argument run is three tests, each a third of the registry's entry points dealt
  in turn, and a fourth that keeps the totals line and checks every command and subcommand was reached.
  `dispatch.test.ts` is three files: the packet, settings, model and effort tests stay; a dispatch run end
  to end is in `dispatch-run.test.ts`; conflict-aware dispatch (D-093) is in `held.test.ts`. Their shared
  helpers moved, unchanged, to `dispatch-support.ts`. Node runs test files side by side, so one file no
  longer sets the suite's time.
- **Stays in sequence:** a test whose steps read what the step before wrote (the gate ratchet test,
  `acc agents auto-merge`, `acc updates`, a builder's note) keeps its order. The merge queue's stops and
  the relaxed-floor merge run their code in-process and synchronously, so they start no processes to
  pool. The near-tests tests and the colour-table test start no processes either. The compile cache's
  folder is kept across runs on purpose, the one exception to GH-174. Activation's
  processes are the extension's own.
- **Timing:** `npm test` on this machine, load average 3 to 5 at the start, Malwarebytes' endpoint agent
  using one to two of the 12 cores throughout. Before (main's tests): 179 s; the CLI junk test 94.5 s,
  the extension junk test 66.0 s, the hook fixtures 18.2 s, cloud-guard push 12.6 s and Edit/Write
  12.0 s, `dispatch.test.ts` 122.9 s in all. After: 131 s; CLI junk 15.1, 15.0 and 15.2 s a part,
  extension junk 16.7 s, hook fixtures 6.5 s, cloud-guard push 6.2 s and Edit/Write under 5 s, the
  dispatch files 38.1, 40.8 and 26.9 s. The longest test was 16.7 s.
- **The first run's limit:** with 16 files at once instead of 11 the suite took 129 s, so the files
  weren't waiting for a slot: starting processes was the limit (223 s of system time a run), and the
  endpoint agent was at 180 to 200% of a core in the minutes after a run. The review asked for the suite
  under 120 s.
- **Compile cache:** `scripts/compile-cache.ts` is loaded before `node --test`, by npm test and the
  near-tests gate. It names `NODE_COMPILE_CACHE` (a folder in the machine's temp folder, unless the
  environment names one), so every test file and every acc a test starts reuses what Node compiled before.
  Node keys the cache by each file's contents and its own version, so an edited file compiles fresh. One
  `acc --help` went from about 300 ms to about 150 ms. `scripts/test/compile-cache.test.ts` has 3 tests.
- **Timing with the cache:** the machine was never idle: Spotlight was indexing (`mds_stores` at about
  200%) and the endpoint agent was at 160 to 200% throughout, load average 8 to 17 at the start. With the
  cache, npm test took 102.1 s (load 17 at the start) and 120.1 s (load 8, rising to 20); with it turned
  off (`NODE_DISABLE_COMPILE_CACHE=1`) straight after, 147.8 s. The longest test was 15.9 s and 22.7 s
  (both the CLI junk totals test), so no test took over 30 s.
- **Timing on a quiet machine (2026-10-15, at the merge of T-62):** no builder running, load average
  3.6 at the start. npm test took 98.4 s, under the 120 s limit, inside the full `npm run check` of
  1612 tests. Criterion 4 is met.
