## D-152 A tidy-up counts a task merged in git, not only one merged by a pull request (2026-10-15)

`acc tidy` and the Overview's "Tidy-up due" counted a task as merged only when its pull request merged
(GH-104). A person who merges a task's branch in git and then sets the task done got no count, so no tidy-up
was offered: on 2026-10-14 about twenty such merges went uncounted (T-38).

- **What counts:** a done task whose pull request merged, or whose branch is in its environment's branch
  (`branchInEnvironment` in `packages/core/src/tidy.ts`). Its work is its branch, the local one or origin's copy,
  or, once both are gone, a commit its reviews read: acc cleanup deletes a branch that never left the machine,
  and a reviewed commit is in the environment only once it merged. A task with none of these, an unmerged one,
  or one not done doesn't count. `MergedTask.pr` is null for a task merged in git.
- **What a tidy-up reads:** for such a task, `tidyScope` takes the files of the merge commit that first brought
  in its reviewed commit. On 2026-10-15 that found 20 tasks and 97 files that the old count left out.
- **Where git is asked:** `tidyStatus` (the CLI) and the hub's `tidy` (the Overview), through
  `rememberInEnvironment`, which asks once for each branch and environment until the ledger is read again. An
  answer can be stale until then, such as for a branch merged after its task was set done.
- Evidence: `packages/core/test/tidy.test.ts` counts a task merged in git once, as one merged by a pull request,
  leaves out unmerged, branchless and not-done tasks, counts one whose local branch was deleted through
  origin's copy and one with neither branch through its reviewed commit, and scopes that one by its merge.
