## D-093 Two tasks that change the same files take turns, where another task can go first (2026-10-06)

The author wants more builders at once (D-080). Two tasks that change the same
files at once end in a merge conflict: four of seven merges on 2026-10-06 needed
a person. Each task's analysis already lists the files it plans to change
(GH-72).

- **What's compared.** Before a first dispatch, acc compares the files the
  task's analysis plans to change (`approach.files`) with every task in flight.
  A task in flight counts what its analysis plans and what its branch has
  changed since it left its environment's branch: commits, and in its worktree
  uncommitted and untracked files. A rename counts as both paths. Paths are
  made repo-relative (an absolute path under the repo, a leading `./`, a glob
  as the folder before its wildcard), and match when they're the same file or
  one is a folder holding the other.
- **In flight** (a person decided): running, in review, rework or blocked with
  a branch, until its change merges, since the conflict comes at the merge.
  Merged means done, its pull request merged, or a pull request was opened and
  its branch is now an ancestor of origin's copy after a fetch. A squash merge
  waits for `acc sync` to mark it done.
- **Prefer, don't block** (a person decided). Matched file by file, nearly
  every pair of this repo's tasks overlaps (the docs, `logic.ts`, `model.ts`,
  `main.ts`), so holding on every shared file would run about one builder at a
  time. A task that shares files waits only while another Ready task shares
  none, which a person can start first. When nothing else is ready, it starts
  anyway, and its run records which files it shares with which task. The merge
  queue (GH-73) takes the rest.
- **Files every task edits never count:** `autopilot.appendOnly` (D-058), and
  a new `dispatch.shared` list in `.acc/config.json`, empty by default so the
  core names no project's files (D-003). This repo lists `docs/DESIGN.md`,
  `README.md` and `CHANGELOG.md`, and `docs/DECISIONS.md` is append-only.
- **A task with no analysis**, or one that names no files, never waits, and
  never counts as one sharing none. Nothing in flight is looked at for it. Its
  Ready card says its files aren't known, in a neutral tone, and which of the
  two it is. Its branch's files still count when others are weighed against
  it. A rework's re-dispatch never waits: its branch already holds its change.
- **A wait is a hold, not a refusal.** `acc dispatch <id>` records `held` on
  the task (who asked, when, what it waits for and what goes first), creates
  nothing, exits 0, and says "GH-73 waits for GH-70's files: …". `--json` gives
  `{ held: true, waitsFor, first }`. It stays in the Ready lane; there's no new
  state. Any move ends a hold, as does `acc dispatch <id> --stop-waiting` or
  Stop waiting behind ⋯.
- **It starts on its own.** `acc dispatch --held` starts each held task that
  may go: one sharing nothing first, oldest hold first, then one whose
  alternatives have gone, weighing the rest again after each start, under
  `agents.max`. Each is claimed in the ledger before its builder launches, so
  two windows and autopilot never start one twice; a claim older than 10
  minutes is stale. The Command Center runs it when its board says a held task
  may go, at any autonomy: the person's Dispatch click was the consent. It asks
  at most every 30 seconds a project. While acc keeps saying the same tasks wait
  and the board sees nothing change, it asks half as often each time, up to
  every 10 minutes, since each ask fetches and the board can't see everything
  acc checks (a branch merged on origin, a protected environment). A start
  that fails is written on the hold, the task needs you (orange, the bell, the
  reason), and nothing tries again until a person acts.
- **Autopilot's `start` step.** This amends D-055's "it never starts a task
  that's to do": autopilot now starts a held task, as the Command Center does,
  and still never starts one nobody dispatched (autonomy dispatch stays
  unbuilt). History and notices say "Autopilot started GH-73: GH-70's files are
  free", or that nothing else was ready, so it shares files with GH-70. A
  failure says "Autopilot couldn't start GH-73: …", with Dispatch anyway.
- **Dispatch anyway** (a person's only, as all of `acc dispatch` is). In the
  Command Center, Dispatch on a task that would wait first asks, naming each
  task and its files in full: "Wait for GH-70" or "Dispatch anyway". A held
  card's one next step is Dispatch anyway, behind a confirmation naming the
  overlap. A dispatch that shares files records them on its move, and
  `acc dispatch <id> --anyway` adds `anyway` only when it overrode a wait.
- **In words, with an icon.** A held card says "Waits for GH-70's files: …,
  while GH-74 is ready to start" with a clock, in blue: three file names in
  all, short, at least one a task, and two of the tasks that go first; the
  task page names every file and task in full, and its State says "Waits for
  GH-70's files". A task sharing files, to do or started beside another, says
  "Shares files with GH-70: …", neutral. The Command Center works this out
  from git on the worktree poll, only while a task is Ready or held, one call
  at a time. acc's answer at dispatch is final.
- Not chosen:
  - Holding on every shared file, as the ticket first said: one builder at a
    time on this repo.
  - Holding only on files outside a list (`dispatch.shared` alone): code files
    such as `logic.ts` would still serialize most tasks.
  - A new display state or lane for held tasks, or counting them toward
    `agents.max`.
  - Predicting conflicts by hunk, or resolving them with an agent; holding
    dispatches for the agent cap; a merge queue (GH-73).
- **From its review:** a Ready task in a protected environment, or one not in
  the config, never goes first: acc wouldn't start it there (envNotProtected),
  so a task waiting on it would wait for nothing. A person's own dispatch of a
  held task claims it first, as a held start does, so the two never both
  launch, and lets the claim go if the launch fails. Dispatch anyway, offered
  after acc holds a dispatch, names the overlap acc reported, not the board's
  guess.
- **The author confirmed the wait as built** (2026-10-07): a person's Dispatch
  of a task that shares files waits while another Ready task shares none, even
  though nothing starts that one on its own yet, because the Dispatch modal
  asks first (Wait for GH-x, or Dispatch anyway) and the CLI takes --anyway.
