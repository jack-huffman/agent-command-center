## D-076 Autopilot sends a pull request whose GitHub checks fail back to its builder, once a commit (2026-10-06)

A pull request whose checks failed on GitHub showed its task as needs you
(D-033), and a person read the failure and sent it back. Autopilot already
sends a review's changes back once (D-055). Failing checks now go the same way
(GH-57). DESIGN.md §19 had left "automatic rework when CI fails" out of v1.

- **When.** Under autonomy review, a task in review whose review passed on its
  latest commit, whose open pull request autopilot landed at that commit
  (`pr.sha`), with no conflict with its base (a refresh comes first, D-058).
  GitHub's head of the pull request must be that commit too. If it isn't, a
  land or a person comes first, and autopilot waits.
- **What counts** (a person decided). The base branch's required checks when it
  has any; otherwise every check on the commit, as acc sync's `ci` counts them.
  A failure is gh's `fail` bucket. A check still queued or running isn't one
  yet: autopilot waits ("Checks are still running on GitHub") and records
  nothing, then sends back every failure together once all have finished. A
  cancelled or skipped check isn't a failure.
- **What has no log** (a person decided). A failed check that isn't a GitHub
  Actions job, such as a commit status or another app's check, has no log on
  GitHub, so it doesn't send the task back. If it's the only failure, the task
  needs you as today, naming it. An Actions job whose log autopilot can't fetch
  (a gh error, an expired log) is still sent back, and the builder reads
  "Couldn't fetch its log: <gh's first line>" beside its link. No log text is
  made up.
- **What it reads.** gh as the repo's account (D-007, D-028), each call with a
  timeout (D-051): `gh pr view --json headRefOid`, `gh pr checks --json`, and
  `gh run view --job <id> --log-failed` (then `--log`) for each failed job, at
  most 5. It changes nothing on GitHub: no re-run, comment or edit. It asks
  only for a task that could be sent back, and not when acc sync last saw its
  checks passing, so a quiet board makes no calls. Just before the move it
  asks GitHub for the head again, so a push in between stops it.
- **The send-back.** Autopilot writes what it read to
  `<state>/checks/<task>-<sha>.json`: each failed check's name, workflow, link
  and the last 100 lines (10 KB at most) of its log, with colour codes and
  timestamps stripped. It moves the task review → rework as the orchestrator,
  by `orchestrator:autopilot`, with "Checks failed on GitHub on <sha>:
  <names>", and keeps `autopilot.sentBack` (the commit, the names, when). The
  next pass re-dispatches it. The builder's packet has "What GitHub's checks
  said": each check with its link and the end of its log, and says to reproduce
  and fix it, run acc gate run, then acc done, or acc block when the failure
  isn't caused by this change. Builders still get no gh: the logs travel in the
  packet.
- **This amends D-055: the orchestrator may move review → rework**, with a
  reason (a person decided). D-055 and DESIGN.md §5 had only a reviewer or a
  person send work back. A move to rework by exactly `orchestrator:autopilot`
  is a checks send-back; a reviewer's move made for autopilot is still the
  review's.
- **Once a commit, at most 3 a task, apart from D-055's one** (a person
  decided). A send-back is re-dispatched whatever else happened. D-055's one
  re-dispatch of a review's rework now counts only re-dispatches that followed
  a review or a person, so a checks send-back doesn't use it up, nor the other
  way round. Checks failing again on a commit autopilot already sent back are
  recorded as a failed `checks` step ("Checks failed on GitHub again: <names>.
  Autopilot already sent <sha> back once: a person decides."), and the task
  needs you. So does a fourth send-back. A new commit, a person's or a
  builder's, gives it another go.
- **Needs you, read again.** While a fix is reviewed, the pull request is still
  at the commit autopilot sent back, and acc sync still says its checks fail.
  That no longer shows the task as needs you; the second failure does, through
  the recorded failure. At autonomy manual nothing is ever sent back, so a
  failing pull request needs you exactly as before.
- **This amends D-033: acc sync keeps the failing checks' names** (`pr.failing`)
  beside `ci`, so every autonomy level can name them. The task's card, its
  tracker card and its page say "Checks failed on GitHub: <names>" in orange
  with an icon, in review while they fail, and in rework after autopilot's
  send-back, where the names are the ones it sent back for. `acc show` prints
  the same line. Autopilot's notice says "Autopilot sent <ID> back to its
  builder: checks failed on GitHub: <names>.", History says the same, and the
  re-dispatch after it says it was for the failing checks. The move's event
  carries the names, and the re-dispatch's carries its cause, so neither is
  read back from words.
- Not chosen:
  - Running acc sync inside autopilot (D-055's Not chosen holds). Autopilot
    reads only what it needs, for the tasks it could act on.
  - Giving builders gh or a way to read GitHub.
  - Re-running checks, or anything else that writes to GitHub. A flaky check
    costs a builder run and a review per round; the cap of 3 bounds it.
  - Sharing D-055's one re-dispatch. A checks failure after a review's rework
    would then always need a person.
