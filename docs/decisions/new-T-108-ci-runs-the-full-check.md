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
the run's summary. They are flat names beside the Mac's, not an object under a
`ci` key, so every acc already installed still reads the file (a nested entry
makes `readFloors` refuse it), the floors driver merges them, and the
screenshots check's guard on lowered floors covers them. None exists yet: no
Linux run had happened when this was written.

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
