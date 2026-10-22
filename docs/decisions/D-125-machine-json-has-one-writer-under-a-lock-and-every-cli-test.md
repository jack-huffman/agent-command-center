## D-125 machine.json has one writer, under a lock, and every CLI test runs acc through cli() (2026-10-09)

GH-148, two points GH-131's review (D-123) left.

- **One writer for `~/.acc/machine.json`.** `setMachineKey` in core's
  `machine.ts` sets one key, or takes it out, keeping the rest of the file;
  `setHeavySlots` and `setMachineAgents` both call it, and with no home it
  refuses through `machineJsonToWrite`, as each did. Each wrote
  `machine.json.tmp` before, so two changes at once shared a temp file. Now the
  temp is named for its process (`machine.json.<pid>.tmp`), and the read, merge
  and write happen holding `machine.json.lock` (core's `withLock`, as the
  ledger's lock is). A temp of its own isn't enough alone: two processes that
  both read before either writes still each write back the other's old value.
  The test runs a slots setter and a total setter in two processes from the
  same moment, 300 changes each, reading its own key back after each; without
  the lock each lost 10 or more, with it none.
- **`cli()` takes spawn options.** `cli()` in `packages/cli/test/support.ts`
  takes them as its fifth argument, such as a timeout, beside the environment
  it adds over the tests' own. The autopilot `--every` test and
  `refusals.test.ts`, which built acc's environment by hand (refusals without
  the tests' own machine.json or repos list), use it. `support.test.ts` checks
  every CLI test file runs main.ts through `cli()` and none spawns node itself,
  but for a named list: `junk.test.ts` runs the built acc in a sandbox whose
  whole environment it makes up, and `launcher.test.ts` runs the launcher
  script. Each is pinned to what it runs.
