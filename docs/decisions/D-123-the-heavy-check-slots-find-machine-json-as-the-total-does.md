## D-123 The heavy-check slots find machine.json as the total does, and the CLI's tests are a file per command group (2026-10-08)

GH-131, two points GH-111's review (D-110) left.

- **One way to find `~/.acc/machine.json`.** `machineDir` and `machineJson`
  move to core's `machine.ts`, and the heavy-check slots (`heavySlots`,
  `setHeavySlots`) are read and written through `machineJson`, as the
  machine's total is. `machineFile`, which fell back to `os.homedir()`, is
  gone. With no home, the slots read one and a change is refused, through the
  same `machineJsonToWrite` as the total's. `machine.ts` is its own module
  because `semaphore.ts` can't import `limits.ts`: limits imports gates, which
  imports the semaphore. `heavyDir`, the slots' folder, still falls back to
  `os.homedir()`; it isn't machine.json, and is left as it was.
- **The CLI's tests are a file per command group,** named for its module in
  `packages/cli/src/commands/` (D-099): setup (with main.ts's own help), rules,
  trackers, tidy, tasks, updates, pipeline, checks, agents and github, with
  what they share in `support.ts`. cli.test.ts took 160 s alone against
  node:test's 300 s per-file limit; the slowest file now takes 31 s. The 53
  tests moved whole, none dropped. Each file names `../src/main.ts` itself, so
  the near-tests gate finds them all for a change to a command module, as it
  found cli.test.ts, and a module's own file by name.
- Not done: a change to one command module still runs every group's file in
  the near-tests gate, since each runs main.ts, which loads them all. That is
  the same work as before, now in ten processes rather than one.
