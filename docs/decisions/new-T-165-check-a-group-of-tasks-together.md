## D-T-165 Check a group of finished tasks together: one full check, and a failure goes back to the task whose files caused it (2026-10-30)

Each reviewed task merged on its own, and the full check ran once for each (D-096, D-158). A burst of five
tasks cost five full checks. The person asked to check a group of finished tasks at once, and, when a test
fails, to find which task touched the files behind it.

- **The command.** `GROUP_CHECK_COMMAND` (`packages/core/src/group-check.ts`): id `acc.task.checkTogether`,
  its params (the tasks by id in merge order, or every task ready; the environment by branch), and an
  `enabled` rule with a reason: the environment is in the settings and not protected, no group check for it
  is under way, and 2 or more tasks are ready. The CLI is `acc check-together [<id>…] [--env <branch>]`, a
  person's only (`noAgent`). The Command Center calls the same rule.
- **Ready** means in review, on its branch's latest commit, whose review passed there (`reviewedAt`), and
  going to the group's environment. A task named that isn't ready is refused, with why.
- **The group's branch.** acc fetches the environment's branch and makes `acc/group/<env>` from origin's copy,
  in a worktree of its own (`group-<env>` under the worktree root), never the main checkout, with the main
  checkout's `node_modules` linked as a builder's is. It merges each task's branch in, in order, by
  `mergeBaseIn`'s rules (D-058): the floors file keeps the better floors, and append-only files keep both
  sides. A task that conflicts with those before it is left out, with the files and the task before it that
  changed one of them, and the rest go on. Decisions the tasks add are numbered against the environment's
  branch, as the merge queue does (T-102). The worktree and the branch are removed at the end, however it ends.
- **One check.** `gates.required`, the merge's scope (the screenshot gate too, where a project names it),
  runs once on the group's branch, through `runGates`, each heavy gate in its heavy-check slot (D-080, D-092).
  It may raise floors there. A check that ran no tests, or skipped more than before, needs a person (GH-100).
- **All pass.** The group's branch, with the floors the check raised committed once on it, is pushed to
  origin's environment branch: each task's merge commit lands in the same order, with no second check,
  since that branch is the one that was checked. Before the push, acc fetches again: if the environment's
  branch moved after the check, the group is made and checked again on the new one, up to 3 more times. A
  push refused because the branch moved meanwhile does the same. Each task then moves to done as acc sync
  moves one whose pull request merged: its pull request is marked merged at its own merge commit, what it
  changed is kept (T-99), its issue is set to close where its tracker lets acc (D-082), else its update is
  drafted (D-066). GitHub marks a pull request merged when its commits reach its base by a push.
- **A check fails.** The failed gates' logs are read for the failing test files, the tracked files named in
  an error or a stack, and a geometry finding's page (`group-blame.ts`). Each task's reach is the files it
  changed, the files those import, and the tests that import them. Then:
  - one task matches: it goes back to its builder, and the rest are checked again without it.
  - more than one, or none: the group is split in halves, and each half is checked in turn, until a half
    of one task fails, or one task matches. A task is never sent back on a guess.
  - each half passes: the tasks fail only together. Nothing merges, and they need a person.
  Nothing merges after a failed check: only a group whose own check passed, on the commit that was checked.
- **Sent back** is autopilot's send-back from the merge queue: review → rework by `orchestrator:autopilot`,
  with `sentBack.kind` `queue`, so D-076's limits (once a commit, 3 a task) and autopilot's re-dispatch where
  the project's autonomy allows it hold, whoever started the group check. Past a limit, the task stays in
  review and needs a person. The report beside the ledger (`<state>/queue/<task>-<sha>.json`) carries a
  `group` part: the tasks it was checked with, whether it failed alone, the failing tests, the files the
  failure names that its change reaches, and the log's lines. Its packet's section is "What the group check
  found". A report's pull request may be null, for a project with none. The re-dispatch's own words still say
  "with what the merge queue found".
- **Kept on each task.** Every step is in `groupChecks` on each task it checked (at most 30 a task): checking,
  passed, failed, merged, sent back, left out, fails together, needs you, each in words such as "Checked with
  T-155, T-159 and T-160: passed" or "Sent back: its change fails extension/test/where.test.ts". A `checking`
  step is replaced by its result. A run that throws after it, such as a held gate or a gate that can't run,
  replaces each live `checking` step with needs you and the error, so no task stays checking.
- **One at a time.** A lock beside the ledger (`groups/<env>.lock`) holds one group check for an environment
  on this machine. A lock whose process has gone is broken, and so is one held past a day
  (`GROUP_LOCK_STALE_MS`), longer than any full check runs. The lock alone says a group is under way: acc and
  the Board's button both read it (`groupRunning`), never a task's `checking` step.
- **In the Command Center.** The Board's In review lane has Check together (n) for each environment its tasks
  go to, with n the tasks ready, off with the command's own reason. It asks the person first, then runs acc
  in the output panel, where its steps show, and says what came of it. While a group holds its lock, the lane shows
  "Checking … together for <environment>: running the full check", or "Checking a group together for
  <environment>" before a task is marked. Each card shows its latest step, and the
  task page's Agent panel lists every step under Details ("Checked together").
- **Mac and Windows.** It runs through acc's runner and git alone: no shell of its own.
- This amends D-096: the queue's "Not chosen: checking several pull requests together" is now a person's
  choice, outside the queue. It amends D-158: one check can now cover several tasks' merges.
- Not built here: autopilot starting a group check on its own where the project lets it merge, and a group
  check through GitHub's own merge of each pull request.
- Checked by `packages/core/test/group-check.test.ts` (28 tests, 9 with real git) and
  `extension/test/group-check.test.ts` (10 tests) and `extension/test/group-check-page.test.ts` (3 tests).
