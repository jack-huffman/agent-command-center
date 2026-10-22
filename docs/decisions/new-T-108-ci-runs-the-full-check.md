## D-T-108 GitHub Actions runs the full check and the screenshot run on every pull request, and autopilot waits for it (2026-10-22)

Autopilot could already review, land and merge through the merge queue
(D-064, GH-73), and this project has `"autonomy": "review"` with auto-merge on.
But the repo had no CI, so a pull request had no checks on GitHub, and a pull
request with none counted as passed 2 minutes after its land (GH-67). The
person chose CI so autopilot can run hands-off.

**The workflow.** `.github/workflows/check.yml` runs on each pull request into
`main` and each push to `main`. Its one job, `check`, runs on `ubuntu-latest`
(the repo is private, and Linux minutes cost a tenth of macOS's): the Node
version `package.json`'s `engines` names, `npm ci`, the pinned headless shell
(`npm run browser`, its `linux64` checksum already pinned), `npm run check`,
then the screenshot run. A last step, `scripts/ci-run.ts`, writes the run's
summary on GitHub: the tests run and skipped, each skip with why, and the
screenshot run's geometry, floors and behaviour lines. On a failure the shots
in `dist/screenshots/` and both logs are kept as an artifact for 7 days. npm's
cache is keyed by the lockfile, the shell's by its pin. It reads the repo only
(`contents: read`), uses no secret, and never pushes. Each action is pinned to
a commit. `scripts/test/ci-run.test.ts` pins this shape.

**Autopilot waits for it.** A new setting, `github.checks`, names the checks a
pull request must pass before autopilot merges it; this project names
`["check"]`. Each named check that is still running holds the merge, one that
failed needs a person, and one GitHub reports nothing for, such as a workflow
that hasn't started, holds it however long since the land. So no checks
reported never counts as passed for a named check. A named check counts even
where the base requires other checks: it is read from every check on the
commit. The merge queue keeps a task's place while it waits; one that conflicts
still joins, since GitHub starts no workflow until the base is merged in, and
its turn's merge waits for the check after that. A project that names no checks
keeps GH-67's rule, which a person decided. Tested in `merge.test.ts`,
`checks.test.ts` and `autopilot.test.ts`.

**Setup.** Step `B10.required-check` reads, as the repo's account, whether
GitHub requires the named checks before anything merges into the default
environment's branch, through branch protection or a ruleset. Where it doesn't,
it gives the `gh api` command that adds them, or turns on protection requiring
only them; where protection is on without required checks, it says what to
tick on GitHub instead, since replacing it would drop its other rules. The
Command Center never changes branch protection. This repo is private on
GitHub's free plan, which offers no protection (GitHub answered 403 on
22 October), so the step skips here, and `github.checks` is what holds
autopilot.

**Screenshots on Linux.** The pages ask for `-apple-system` and Menlo. The
runner has neither: SF has no Linux build, so `.github/fontconfig.conf` maps it
to Inter, the nearest free face; Menlo is built on DejaVu Sans Mono with its
metrics, so DejaVu stands in exactly. Text in Inter wraps a little differently
from SF, so a geometry finding or a count can differ. The Mac's floors don't
change, and the Mac's run never reads or raises a CI floor. A CI run
(`ACC_CI_FLOORS=1`) is held to `screenshots.ci.<check>` in `.acc/floors.json`
where that exists, else to the Mac's floor, and says which in its log. A clean
CI run raises only the CI floors that exist, and prints them, since CI commits
nothing. Where a count can't match the Mac's, a person adds its CI floor from
the run's summary. The task asked for them under a `ci` key; they are flat
`screenshots.ci.<check>` names beside the Mac's instead, and the person accepted
that at review. `parseFloors` (`packages/core/src/ratchets.ts`) refuses any
entry that isn't a floor or a ceiling, so a nested `ci` object would make every
acc already installed refuse the whole file. As flat names, the floors driver
merges them and the screenshots check's guard on lowered floors covers them.
None exists yet. The next Linux run is read on this change's pull request;
any `screenshots.ci.*` floor or `CI_SKIPS` entry it calls for comes back as a
follow-up task.

**Chrome's sandbox on the runner.** The first run on pull request 179
(22 October) passed every step through the full check, so the whole check
passes on Linux. The screenshot run then failed all 840 drawings: Chrome
exited SIGTRAP on each and wrote nothing. Ubuntu 24.04's AppArmor refuses the
unprivileged user namespaces that Chrome's sandbox needs. The workflow's step
"Let Chrome's sandbox start" sets
`kernel.apparmor_restrict_unprivileged_userns=0` on the runner before the
screenshot run, and fails with the library names when `ldd` finds one the
shell lacks. The sandbox stays on: no run uses `--no-sandbox`. A crash like
this now says why in one line: when Chrome writes no drawing at all, the
screenshot run stops at each job's first drawing and prints Chrome's FATAL or
ERROR line from its stderr (`chromeSaid` in `extension/scripts/screenshot.ts`,
tested in `jobs.test.ts`).

**The Worktrees table on Linux.** The second run on pull request 179 started
Chrome with its sandbox, drew every page and passed the full check. It found
two geometry findings, in dark and light at 500 px: the Worktrees table's
"Missing on disk" ran under the sticky row menu. Inter is a little wider than
SF, and the state cell was kept to one line, so the table grew wider than its
frame. The layout is fixed, not excused: below 560 px the branch name takes at
most 12em (its full name is on hover), and the state may wrap, with a least
width of 9em so its words stay on one line where there's room. At 500 px on
the Mac each state is on one line, and the Location column, not the state,
takes the room the branch gave up.

**Stored floors keep a margin.** Two runs of one commit counted a few apart
(clipped 101904 and 101898; a11y 445830 and 445794), and T-102 stored each floor
at one run's exact count, so main's own run fell below it. The person relaxed
`screenshots.clipped` to 100900 and `screenshots.a11y` to 441400 on
22 October and chose a margin: a clean run that raises a stored screenshot
floor, the Mac's or the CI's, now stores it about 1% below its count, rounded
down (`storedFloor` in `extension/scripts/geometry.ts`), and raises it only when
that beats the floor. T-104 merged first and stored clipped 105394 and a11y
454668 at its run's exact counts; this change takes those higher floors, and
T-109's after them (clipped 107800, a11y 460902), since only a person lowers
one, and the margin applies from the next raise on. A later run a few under the clean count still passes; a
page that loses real content, 2% or more, still fails. The run's own check is
unchanged: it fails below the stored floor. The page checks' floors follow the
pages, as before.

**Tests that need the Mac.** `CI_SKIPS` in `scripts/ci-run.ts` names each test
that skips itself on the runner, with why. A skip it doesn't name fails the
run, and so does a named one that ran, a failed test, no tests, or a skip with
no name. It names one: the real-sf case in
`packages/core/test/manifest-sf.test.ts`, since the runner has no `sf`. The
tests that touch the keychain or `claude` that were read for this use fakes. A
test that needs the Mac in a way not found yet fails the first CI run, or skips
unlisted and fails it, and is added here then.

**How to turn autopilot on.** In the Command Center, click autopilot's switch
in the status bar (or run "Turn autopilot on or off"). It stays on until VSCode
closes, and only for this window (D-064). With this project's settings, it
then on its own: reviews each task a builder finished, lands its pull request,
sends a rework back to its builder once, sends a pull request whose GitHub
checks failed back with the failing log, and, with auto-merge on, puts each
reviewed pull request whose `check` passed in the merge queue, merges the base
in at its turn, runs the full check once, and merges. It never merges into a
protected environment, nor a pull request that changes `.acc/` (this one does,
so a person merges it). Watch it act in "Show autopilot's output", on each
task's page, and on the pull request on GitHub, where the `check` run and its
summary show.
