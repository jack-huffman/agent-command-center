## D-122 A relaxed floor counts only for the task a person relaxed it for (2026-10-08)

GH-130, narrowing D-118. A person's relax record backed a floor lowered on any
branch that began at the floor it relaxed from, and the records were never
pruned. So when a person relaxed `tests` from 669 to 640 for T-1, T-9, which
also began at 669, could lower its own floor to 650 by hand and pass its check
and the merge queue's; and once main was back at 669, an old record matched
again.

- **A relax is for one task.** `acc gate relax` takes the task named with
  `--task`, or the one whose worktree it runs in, and refuses a checkout that
  isn't a task's and a task that's done. Its record names the task, and its
  output says the relax is for that task alone.
- **A record backs a floor only on its task's branch.** The gate counts a
  record when the run is for that task (as `acc gate run` and the merge queue
  name it) and the checkout is on that task's branch, so its builder's checks
  and the merge queue's merge of it pass, and no other branch does. Naming the
  task with `--task` from another branch backs nothing, since the branch is
  checked too.
- **A record stops counting once its task is done or leaves the board.** The
  gate reads the ledger for that. A record from before this change names no
  task and backs nothing.
- **acc prunes, on its own commands.** `acc gate run` and `acc gate relax` drop
  the records that can't count, holding the ledger's lock, so a relax written
  at the same moment isn't lost, and write the file whole. The Command Center
  only reads (D-012).
- Not chosen: tying a record to the floor's merge into the environment, which
  needs GitHub; a done task is the same moment as acc sees it, and it's local.
