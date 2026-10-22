## D-080 A machine sets how many heavy checks run at once; this repo runs five builders on Opus 5.5 (2026-10-06)

The author asked why builders were capped at three, and wanted full swarming.
The cap was `agents.max`'s default from `acc init`. The real limits were the one
heavy-check slot on the machine (D-024), merge conflicts, the serial merge, the
person's attention, and Claude usage. The author chose, as a first step, five
builders and two heavy-check slots, with conflict-aware dispatch, a merge queue
and model choice as tasks of their own.

- **Heavy-check slots are this machine's setting,** shared by every repo and
  worktree on it: `ACC_HEAVY_SLOTS` if set, else `heavySlots` in
  `~/.acc/machine.json`, else one, and never more than eight.
  `acc machine heavy-slots [<n>]` shows or sets it. Builders, reviewers and
  analysts can't change it: the CLI, `guardBash` and the builder's settings
  refuse `acc machine`. This machine is set to two. If two checks at once make
  it stutter, set it back to one.
- **This repo runs five builders at once** (`agents.max`), and builds and
  reviews with Opus 5.5 (`agents.builder.model`, `agents.reviewer.model`).
- **`acc agents set … --project` is a switch,** as its help says and the
  Command Center sends it. It had been read as needing a value, since
  `acc init --project <name>` names the project, so saving for the project from
  the Command Center failed.
- Not chosen: raising the cap with one slot, where builders would mostly wait
  for checks.
