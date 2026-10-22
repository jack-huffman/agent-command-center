## D-171 acc's long commands report their steps, and the output panel lists them (2026-10-16)

T-65. T-64 (D-169) showed every run in the output panel as rows, but for a
run of acc's own the panel could only guess from its lines. acc knows its
steps, so it now says them, and the panel shows a deploy, a promotion, a
dispatch, a land or an analysis as a list of steps.

- **A step channel, a file.** When `ACC_STEPS` names a file, acc writes one
  JSON line for each step event: its id, its label in process words, its
  state (started, done, skipped or failed) and a short note. The last line
  is the result, ok or not, in one sentence. A file, not acc's output: the
  output stays exactly as it was, with the variable or without, and the
  panel reads steps without parsing lines. The file is written whole for
  each line (a temp file, then a rename), so a reader never sees half a
  line, and a write that fails is dropped: the work goes on unreported.
- **One helper in core.** `packages/core/src/steps.ts` gives `start`, `done`,
  `skip`, `fail`, `result` and `step(id, label, fn)`, which fails the step
  with what fn threw. Each command takes an optional `steps` in its deps; one
  not given reports nowhere (`NO_STEPS`), so autopilot's in-process calls are
  unchanged. The CLI opens this run's steps in `main` from `ACC_STEPS`, then
  takes the variable out of the environment, so a builder or analyst acc
  starts never writes to the same file. A command writes its own result; one
  that throws, or reported steps and wrote none, gets one from `main`. A
  command that reported no step writes no file.
- **The steps.** Deploy: check the branch, work out what changed, check it can
  go, check out the commit, deploy, record it, draft the tickets' updates (7).
  Promote: check the branches, work out what changed, check it can open a pull
  request, build the branch, check in the destination's org (or skipped, with
  why), push, open the pull request, record what it carries (8). Dispatch:
  check the task, check the files in flight (or skipped), make and set up the
  worktree, write the instructions, start the builder, record the run (7; 9
  in the cloud, with the push guard and the push). Land: check its review and
  checks, sign in to GitHub, look for its pull request, push, open or update
  it, check it merges, record it, draft the ticket's update (8). Analyze:
  check the task, gather what the analyst reads, analyze, read the analysis,
  save it (5). Setup's baseline and lists take a step a branch, branches a
  step a branch it makes, and readme one step.
- **The extension listens.** `Runs` gives a run of acc (`runsAcc`: acc, a
  path to it, or the extension's own `acc.mjs`) a steps file in a temp folder
  of its own, reads it every 250 ms and before each chunk of output, so each
  step keeps the lines printed while it ran, and removes the folder when the
  run ends. acc's notes and result go through `reasonInWords` (D-132). acc's
  result says whether the run worked, over its exit code: an analysis with
  questions exits 1, and its steps worked.
- **The panel.** A run with steps lists them under the header line: a quiet
  spinner while one runs, then Done, Skipped or Failed, each an icon with its
  label (a failed one's label shown, in orange); Didn't finish for one still
  running when its run ended. A failed step shows its note and opens to its
  own rows. The output rows fold into one row, "Show 42 lines". The result
  card says acc's sentence and how long it took.
- **Dispatch and land move into the panel.** They ran under a notification
  with acc's `--json` answer read at the end. They now run in the panel, so
  their steps show; `StartOptions.answer` hands the `--json` stdout to the
  extension apart from the rows, and what follows (the toast with Watch, the
  pull request's link) is as before. A sidebar given no way to run them in
  the panel (`runAccShown`), as in tests, runs them under the notification.
- **Checked.** `packages/core/test/steps.test.ts` (7 tests) covers each event,
  the result closing open steps, `step()`, notes, a write that fails, no
  `ACC_STEPS`, and reading junk. `packages/cli/test/steps.test.ts` (12 tests)
  pins each command's plain output as it was before this change, and the
  same with `ACC_STEPS`; checks each command's steps in order for a run that
  works and one that fails part way (Setup's readme has one step, so it
  fails at it); and checks `openSteps`. `extension/test/run-steps.test.ts`
  (8) and `run-view.test.ts` (3 more) drive a fake acc whose steps reach the
  card as its file grows, its folder gone at the end. A browser case clicks
  the failed step and the fold, and two new mutants each fail it. The
  screenshot run draws three more pages: a deploy in progress, a promotion
  that failed at its check (opened), and a dispatch that finished.
- Not chosen: steps for other tools' commands, such as `sf` or `brew`, which
  T-64's rows show; listing a command's steps before they start, since a
  step's label can depend on what the run finds (the environment, the
  pull request); steps written to stderr, which would change acc's output.
