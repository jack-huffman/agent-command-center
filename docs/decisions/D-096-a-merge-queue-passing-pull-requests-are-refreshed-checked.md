## D-096 A merge queue: passing pull requests are refreshed, checked once and merged in turn (2026-10-06)

With auto-merge (D-083), passing pull requests merged on their own, but each
merge moved main, and the next pull request then conflicted or broke: it took a
refresh, a review and a land of its own before its merge, one merge a pass.
The author wants full swarming (D-080), and chose a merge queue (GH-73).

- **Where.** Only where auto-merge covers a task's environment: auto-merge on,
  autonomy review, an environment that isn't protected, never in a Salesforce
  project. Elsewhere nothing changes: no field is written, and gates, packets,
  refresh (D-058) and the merge behave as before.
- **Joining.** A task joins its repo's queue on the first autopilot pass that
  finds it ready: in review, its review passed on its latest commit, its open
  pull request landed there, GitHub's checks green (or none, after D-083's 2
  minutes), no person asked for changes, no agent in its worktree is waiting for
  a person's answer, and nothing under `.acc/` changed (one that did is
  recorded, as in D-083). Being up to date with its base isn't asked, and
  neither is a conflict: the queue sees to both. A pull request that conflicts
  gets no checks at all, since GitHub runs no `pull_request` workflows until it
  can make the merge, so one that conflicted from its land doesn't wait for
  checks that won't come: it joins at once, and its turn merges the base in and
  pushes a commit they run on. The ledger keeps `autopilot.queued` (when, at
  which commit, the head's phase, and, held, why). One queue a repo, across its
  environments, in the order tasks were ready, ties in ledger order.
- **Keeping its place, and leaving.** Waits that settle by themselves keep a
  task's place: GitHub's checks running, gh not answering, none reported yet.
  Anything that waits on a person makes it leave: a person asking for changes,
  an agent in its worktree asking something, a failed step, a review that didn't
  pass. So does a move, a merge, or a new commit that isn't the queue's own.
  Ready again, it joins at the back.
- **A pull request someone pushed to on GitHub**, such as with Update branch, is
  at a commit acc didn't land. Its checks there say nothing of the landed one,
  and waiting for GitHub to come back to it would hold the queue for good, so
  it doesn't wait: it takes its turn, which fetches its branch first, and a
  commit this clone lacks makes it need you, with nothing merged or pushed. The
  next task is the head on the next pass.
- **A place counts only while auto-merge covers the task.** Switched off, or
  under another autonomy, no autopilot may run to clear `autopilot.queued`, so
  everything that reads the queue asks the config too: such a task is in no
  queue, and a pull request of its that conflicts needs you again, in orange.
- **The head's turn.** Only the head takes one, after every other task in the
  pass, so a long check doesn't hold up that pass's reviews and lands. The rest
  wait behind the task ahead of each, and make no git, gh or check call for the
  queue. At its turn:
  - if origin's base has commits the branch lacks, the base is merged in, in its
    worktree, by D-058's rules (append-only files, rerere off, the repo's commit
    identity). refresh.ts is split into `mergeBaseIn` and `checkCommit`, so a
    conflict and a failed check are told apart; `refresh` is the two together,
    for conflicts only, as D-058 had it: the `behind` option D-083 gave it is
    gone, since the queue brings a pull request up to date.
  - `gates.required`, the full check, runs once on the result, in a heavy-check
    slot (D-080), unless it already passed on that commit. The slot names the
    task, and the check waits in D-092's line like any other; the turn is marked
    under way as autopilot's step, which In progress words as taking its turn in
    the merge queue.
  - a merge commit is pushed to the same pull request, as the orchestrator, and
    the next turn after GitHub's checks pass on it merges it. One that was
    already up to date merges at once, with `gh pr merge --match-head-commit`
    (D-083).
  - one merge a pass, the head's. The next head starts from the base it left.
- **A clean merge carries its review** (a person decided). A merge commit the
  queue made cleanly, or by keeping both sides' additions to an append-only
  file, carries the passing review of the commit it was made on, plus its own
  full check: `autopilot.carried` says so, and it's no new verdict. `reviewedAt`
  is the one place land and the merge accept it, so nothing is pushed or merged
  without a passing review (D-033). The Command Center reads it the same way
  (`reviewCurrent`), so the task's card and page don't show the review as out
  of date once the queue pushes its merge. Autopilot resolves no other conflict, so a
  merge that needed a real resolution never reaches a push: it goes back to the
  builder. The pull request's description says the review was of the commit
  before the merge.
- **Leaving for its builder.** A conflict autopilot can't resolve, or a full
  check that fails, puts the branch back as it was (worktree clean, nothing
  pushed), and the orchestrator moves the task review → rework with "The merge
  queue sent it back: …". What it found is kept at
  `<state>/queue/<task>-<sha>.json`: the conflicting files, or each failed gate
  with the end of its log. The packet's "What the merge queue found" says how to
  merge the base in and resolve them, or what to fix. Builders may run
  `git merge origin/<env>` in their own worktree: the Never line now forbids
  merging a pull request, not the base, and where the queue runs their settings
  allow exactly their own base, `git merge origin/<their environment>`, with or
  without flags such as `--no-edit`. Any other branch, and anywhere else, a
  Salesforce project above all, a builder asks first, as before.
- **One limit for autopilot's send-backs** (a person decided). The queue's and
  GitHub checks' (D-076) share it: once a commit, 3 a task, apart from D-055's
  one re-dispatch of a review's rework. `sentBack.kind` tells them apart; one
  without a kind is checks'. Past it, or where a check that failed was waived on
  the commit before (a waiver holds for its own commit, D-031), the task needs
  you. So does anything else that stops a turn: a dirty or missing worktree,
  origin's branch ahead of the clone's, a heavy-check slot that stayed taken
  (D-069), a push that failed. Each is recorded as `queue`; a failure in the
  merge itself (GitHub BLOCKED or DIRTY, gh refusing) as `merge`, as D-083 did.
  History and notices say which: "sent back to its builder from the merge
  queue: …", or "couldn't take it through the merge queue: …".
- **Builders run lighter checks** (a person decided). `gates.builder` names
  them, where the queue runs the full check: `acc gate run` with no names runs
  them, and `acc done`, `acc review` and `acc land` take them. The full check
  passing on a commit covers them. Left out, or where the queue doesn't run,
  builders run `gates.required`, so a repo keeps the full check for its builders
  by naming none. Command gates get `ACC_CHANGED` and `ACC_NEAR_TESTS`: what the
  branch changed, and the tests near it (the tests it changed, and those in the
  same package named for, or importing, each file it changed), one path a line.
  This repo's builders run `typecheck` and `near-tests`
  (`scripts/near-tests.mjs`, which builds first when a near test reads the
  build); all three gates take a heavy-check slot, so they don't stutter the
  machine together.
- **In words.** The Overview has a Merge queue panel for each project with one:
  each pull request's place, its task, its link, and what it waits on, in blue
  with an icon: the head's phase (Next to merge, Merging main in, Waiting for a
  heavy-check slot, Running the full check, Waiting for GitHub's checks,
  Merging), Behind <id> for the rest, and Autopilot is off when it doesn't
  move. Waiting for GitHub's checks is only for a wait on them: a head held on
  anything else, such as GitHub working out whether it can merge, or gh not
  answering, says that wait in its own words, as much as fits, and all of them
  on hover. Orange stays for needs you, which a task in the queue never is: a
  conflict in the queue no longer shows as needs you. `acc show` says "In the
  merge queue: 2nd of 3, behind GH-12", `acc gate list` marks builder gates, and
  the task page marks each check builder or merge queue.
- This amends D-058: with auto-merge on, a pull request isn't refreshed when it
  conflicts, but at its turn in the queue, and a clean merge isn't reviewed
  again. It amends D-076: its 3 send-backs are shared with the queue's. It
  amends D-024: a commit's checks have two scopes, a builder's and the merge's.
  It amends D-083: a pull request only behind its base isn't refreshed, reviewed
  and landed before its merge, and "one merge a pass" is the queue's head's.
  DESIGN.md §19 no longer leaves out a merge queue.
- A pull request a person merges by hand where builders run lighter checks has
  had only those, unless the queue ran the full one: its description's checks
  say which ran.
- Not chosen:
  - GitHub's native merge queue or `gh pr merge --auto` (D-083's reasons hold).
  - Checking several pull requests together, or speculatively.
  - Letting a person reorder the queue, or a separate queue per base branch.
  - Running the queue as a process of its own, outside autopilot's pass.
  - A new Slack notice kind: Needs you covers a task leaving the queue for a
    person.
