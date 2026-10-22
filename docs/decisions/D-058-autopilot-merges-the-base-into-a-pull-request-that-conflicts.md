## D-058 Autopilot merges the base into a pull request that conflicts with it (2026-10-05)

When main moves on, open pull requests start conflicting with it, and acc says
so (D-049). The author then resolved them by hand, most often in
`docs/DECISIONS.md`, where both sides had added an entry at the end. Under
`autonomy: review`, autopilot now does that part, and stops at anything more.

- **When.** A task in review whose open pull request is at its latest commit,
  whose review passed, and which conflicts with its base (`pr.conflicts`, kept
  by `acc sync` and `acc land`). Its step is `refresh`. A pull request that's
  only behind its base is left alone. Autopilot still doesn't sync (D-055), so
  before merging it fetches and asks git again. A conflict that's gone is
  marked gone, and nothing is merged.
- **Where.** In the task's worktree, never the main checkout. It merges
  origin's copy of the task environment's branch, which is what `acc land`
  opens the pull request into, as the repo's `commitIdentity`. The repo's hooks
  run. rerere is off, so an answer git remembered from another merge never
  stands in.
- **What it resolves.** Only files listed in `autopilot.appendOnly` in
  `.acc/config.json`, and only when both sides just added to the end: the
  merge base's copy is the start of both. It keeps both, the base's additions
  first, then the branch's. The list is empty by default, and this repo lists
  `docs/DECISIONS.md`. An entry is a path or a folder inside the repo.
  - It reads the three copies from git's index, not from conflict markers, so
    a user's `merge.conflictStyle` changes nothing.
  - A listed file edited anywhere but its end, added on both sides, deleted,
    renamed, a link or binary is a real conflict.
- **Anything else stops it.** Any other conflict aborts the merge: the branch
  is at the same commit, the worktree is clean, and nothing is pushed. The task
  needs you, with "autopilot couldn't update from its base" and every file it
  couldn't resolve. It refuses without merging when the worktree has
  uncommitted changes or is gone, or when origin's copy of the branch has
  commits the local one lacks, as after GitHub's "Update branch".
- **Checks, then a review, then the land.** After a clean or resolved merge,
  it runs the required checks on the merge commit, in the worktree, and records
  them. The next pass reviews the merge afresh, and the pass after lands it,
  which pushes it and updates the same pull request. `acc land` already
  refuses a commit without settled checks and a passing review, so nothing
  that hasn't passed is pushed. A refresh takes three passes, one step a task
  each.
- **A check that fails rolls the branch back,** as the author chose. It goes
  back to the commit before the merge (`git reset --hard`), which is safe
  because a refresh never starts in a worktree with changes. The failure is
  recorded as `refresh` on that commit, naming the checks that failed and
  their logs. As with every step (D-055), it isn't tried again on that commit.
  A new commit on the branch lets it, and the base moving again doesn't, as
  the author chose: a person handles a real conflict anyway.
- **Autopilot now takes the heavy-check slot** for a refresh's checks, as a
  builder's checks do. This amends D-055, where it never took it. A slot still
  taken after its 3 hours undoes the merge and waits for the next pass, and
  isn't recorded as a failure.
- **A waiver doesn't carry over.** It holds for its own commit (D-031), so a
  task that needed one fails its refresh until a person looks.
- **On Salesforce,** the merge is validated with the Apex tests the branch's
  last `validate` named. Without them, validate fails whenever Apex changed.
- **In words.** `acc autopilot` says "Couldn't update `<commit>` from its base"
  and `acc show` says the same. The Command Center says "Needs you: autopilot
  couldn't update from its base", with the bell, in orange, and its Overview
  offers the pull request.
- This reverses D-049's "Not chosen: resolving the conflict for you. That
  changes the branch after its review." The merge gets its own checks and its
  own review before it's pushed. D-014 still holds: nothing merges a pull
  request on its own.
- Not chosen:
  - Keeping the merge commit when its checks fail, for a builder to fix. The
    branch would end on a commit nobody asked for, whose checks fail, and the
    next pass would try to review it.
  - Rebasing or force-pushing a task branch. A pull request's history stays as
    people saw it.
  - Resolving any other conflict, with an agent or with rules of thumb. That's
    rework, for a builder or a person.
  - An `acc refresh <id>` command or a Command Center button. Left for later.
