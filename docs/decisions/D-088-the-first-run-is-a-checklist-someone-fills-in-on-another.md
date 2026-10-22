## D-088 The first run is a checklist someone fills in on another machine; a full check replaces Setup's rows; an older plugin fails A4 (2026-10-06)

GH-62, the last of four packaging tasks, after D-077, D-079 and D-081. It
asked for a first run on a fresh machine, written up and fixed, and for Setup
to forget a machine step that no longer applies (GH-59's review).

- **The run is split from this branch** (a person decided). A builder can't
  drive VSCode on a clean machine, and the author's own account shares
  `~/.claude`, `~/.acc` and the keychain with the builders running there, so
  sign-ins would pass that shouldn't. The author installs the release on
  another machine, or a coworker does after a read invitation to the repo.
  This branch gets the run ready: `docs/FIRST-RUN.md`, Setup's fix, A4's
  version check, and 0.36.0 to test. The tester's notes come back as their own
  task, which fills in FIRST-RUN.md, fixes what takes under about an hour
  (about a day in all), files the rest with what was seen, and corrects the
  README's Install and first run.
- **The samples** (a person decided): a new private throwaway repo under the
  tester's own GitHub account, as a generic project, all the way to a
  dispatched task; then a Salesforce Developer Edition org, as far as it goes,
  noting where it stops. Never a client's org.
- **FIRST-RUN.md is a checklist.** One heading per step, `### <id>: <title>`:
  the machine's, a generic project's, then Salesforce's own, in the
  walkthroughs' order, and a test holds them to the step list. Each has
  Showed, Unclear, Failed, Result, and Fixed in / filed as. Before them: the
  machine and release, getting access, and installing; after them, the
  dispatch. The docs scan (D-079) reads it, since a write-up is where a home
  path or an account name slips in most easily.
- **A full check replaces Setup's rows.** Setup merged every result into its
  rows and cleared them only when the folder changed, so a step a check
  stopped listing kept its old row: A1.node, A1.sf and A1.code-analyzer, after
  `acc init --profile generic` in a window that first checked with no
  project. Now each part a full check lists replaces that part's rows. A part
  whose check came back empty, which means acc failed, keeps its rows rather
  than blanking Setup, and a folder that isn't a project has no project rows.
  A Check of one step, a re-check or a fix still changes only its own row.
  The walkthrough's context key for a dropped step stays as it was:
  `acc.profile` already hides the step. Both rules are pure functions in
  `logic.ts` (`afterFullCheck`, `afterStepCheck`), tested without VSCode.
- **An empty machine result isn't saved.** It was, and startup reused it for
  12 hours, showing no machine rows.
- **A1.node stays listed with no project open** (a person decided, for now).
  D-077 left it to GH-62. The checklist asks the tester whether A1.node, A1.sf
  and A1.code-analyzer confused them there; the follow-up can revisit it with
  that answer.
- **A4 fails on a plugin older than acc** (a person decided; D-081 left it to
  GH-62). `acc doctor` passes its own version into the checks
  (`CheckContext.version`), and A4 compares the installed plugin's with it as
  numbers. Older fails, and its fix is `claude plugin marketplace update
  agent-command-center && claude plugin update acc@agent-command-center
  --scope user`, run in a terminal like any `claude` subcommand. Equal or
  newer passes. When there's nothing to compare, because a version isn't
  `x.y.z` or the caller doesn't know acc's, it passes as before. A disabled
  plugin's fix is still to enable it, and the next check asks for the update.
  Not chosen: failing on any difference. A newer plugin does no harm, and
  someone who updated the plugin first shouldn't be told to go back.
- **0.36.0 is set on this branch**, with its CHANGELOG entry. After it merges,
  a person packages it, commits `plugin/bin` and releases it (D-079), and the
  run uses that release.
- **The README changes only where it's certainly wrong.** A fresh VSCode
  doesn't put `code` on PATH, so it says how to add it, or to use Install from
  VSIX. The rest waits for the run, whose checklist asks about what the
  analysis suspected: no step checks for Homebrew, and the git that comes with
  Apple's command-line tools may be older than A1.git's 2.40.
