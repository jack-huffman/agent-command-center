## D-063 Autopilot never replaces a closed pull request (2026-10-05)

Follow-ups from GH-33's review (D-055). The review asked whether autopilot
should open a new pull request for a task whose pull request someone closed.
The author's answer: no, a person decides.

- **A closed pull request waits at the land step.** `acc sync` blocks a task
  whose pull request was closed without merging. When a person moves it back
  to review, autopilot no longer lands it as a new pull request: its review
  passed, its pull request is closed, and it waits. This amends D-055's land
  rule, which treated a closed pull request the same as none. Autopilot still
  reviews a new commit on the task, because a review only writes to the state
  folder and doesn't touch GitHub.
- **The task needs you, naming the pull request.** A task in review whose
  pull request is closed shows as needs you at every autonomy level, manual
  included, because the ledger alone decides it (`closedPr`, which
  `displayState`, autopilot and `acc show` share). `acc show` says "! Pull
  request #N was closed without merging. Reopen it on GitHub and land to
  update it, or land to open a new one." In the Command Center, its card,
  tracker card and task page say "Needs you: pull request #N was closed
  without merging", with the closed pull request icon, in orange. The
  Overview lists it as "Pull request closed" and offers Land (or Review), the
  pull request and Open. It no longer says the task's agent is waiting in its
  terminal.
- **A person lands it, or moves it.** `acc land`, or Land in the Command
  Center, updates a pull request someone reopened on GitHub, or opens a new
  one. Either way the task stops needing you. Moving the task anywhere else
  clears it too. acc never reopens a pull request itself.
- **A stale ledger can't open a second one either.** Autopilot doesn't sync
  (D-055), so the ledger can still say open after the pull request was closed
  or merged on GitHub. When autopilot lands a task whose ledger names a pull
  request, and GitHub lists none open for its branch, `acc land` refuses:
  "Pull request #N isn't open on GitHub. Autopilot won't open another: a
  person decides." It also refuses when gh can't list them. Autopilot records
  it like any failed step, so the task needs you. `acc land` now looks for
  the open pull request before it pushes. A refused land pushes nothing, so
  it can't recreate a merged pull request's deleted branch. A person's land
  still opens a new one.
- **Autopilot runs on a repo where no task was ever added.** It creates the
  state folder before it takes `autopilot.lock` there, as `mutate` does
  before taking the ledger's lock. Until now it crashed with ENOENT.
- Not chosen:
  - Teaching `acc sync` to follow closed pull requests, so one reopened on
    GitHub stops needing you by itself. Until a person lands it, the ledger
    keeps saying closed. The author left this for a follow-up.
  - Making `withLock` create its lock's parent folder for every caller. Its
    other callers already create it.
