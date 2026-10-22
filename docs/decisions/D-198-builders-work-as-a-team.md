## D-198 Builders work as a team: each knows the others in flight, is told when one lands, and takes it in early (2026-10-22)

Builders worked side by side but blind to each other. On 22 October a person
wrote coordination notes by hand ("T-97 is rewriting the plan's schema: keep
to your own section"), and conflicts showed only at the merge. Now each
builder has its team's state, kept current while it works:

- **The team** (`packages/core/src/team.ts`). For a task, every other task in
  flight (running, in review, sent back, blocked) whose work hasn't merged,
  each with its title, state, the files its plan names, and what its branch has
  changed so far (`branchFiles`, as D-093's dispatch reads it). The files it
  shares with this task are measured as D-093 measures them, without the
  shared and append-only files and the floors file. Those sharing come first.
  Then each first-parent commit on the environment's branch (origin's copy,
  else the local one) that the task's branch doesn't hold, oldest first, with
  what it changed (`mergeCommitPaths`) and what of that it shares. A commit is
  matched to its task by its pull request's merge commit, the pull request its
  subject names, or the task id its subject starts with; one that matches none
  is named by its subject. Git isn't fetched for this: origin is as the clone
  last fetched it.
- **The packet** gets "Your team right now" after the notes of the tasks it
  depends on, as dispatch saw it, with how to work with them: keep to your own
  module, keep a change to a shared one small and say so in the note, and run
  `acc team` before changing a file the team shares. A team that can't be read
  leaves the section out. The short instructions after a resume or compaction
  name `acc team` and `acc refresh`.
- **`acc team [<id>] [--json]`** says the same as of now. A builder may run it,
  and `acc refresh`, without asking.
- **Told when a teammate lands.** The plugin's new PostToolUse hook, on the
  same tools as PreToolUse, tells a running builder of each merge its branch
  doesn't hold that shares its files, once a merge: who merged, what it
  shares, and that `acc refresh` takes it in. What each merge changed is read
  from git once and kept in the clone's state (`team/<task>.json`), with the
  merges told. A merge that shares nothing now is weighed again on later tool
  uses, so one the builder's growing work comes to share is told then. The
  merges a packet lists are marked told at dispatch.
- **`acc refresh [<id>]`** (`take-in.ts`), for a task running, sent back or
  blocked, in its own worktree with nothing uncommitted: fetches the
  environment's branch, merges `origin/<env>` into the task branch as a commit
  there, resolving only what autopilot's refresh resolves (D-058), then runs
  the builder's test checks on it (its checks that `gates.tests` names, such
  as near-tests). A failed test keeps the merge, for the builder to fix. A
  conflict stops it with the files listed: for its builder, the merge is left
  in the worktree to resolve and commit; a person's run puts the worktree back
  as it was, since a builder may be working there. It never pushes. A builder
  can run it for its own task only.
- **The reviewer's prompt** gets "The team right now", read as the review
  starts, to judge a change that steps on another task's area.
- **The task's page** shows a Team section while the task is in flight: "Up
  to date with dev" in blue, or "2 merges behind dev" in orange with each
  merge, and "Shares files with T-97 and T-98" in orange with each task's
  state and the files, or a muted line that it shares none.

Builders don't message each other: out of scope.
