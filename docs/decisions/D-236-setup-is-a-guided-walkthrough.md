## D-236 Setup is a guided walkthrough: one thing on each screen, in chapters (2026-10-30)

T-153. The person, on the Setup page: "I need it to feel more like a proper, guided experience rather than a
wall of things to do. It needs to be a walkthrough", "super minimalistic, with nearly one type of interaction
asked per page". Setup showed every group of steps on one page; each step not done opened as a card with its
detail, a raw command line and all its buttons, under a head of four buttons. It builds on the stepped modals of
D-224 and D-228, the shared stepper (`extension/webview/stepper.ts`) and the calm style of D-217, D-218 and D-226.

- **Three kinds of screen** (`extension/webview/setup.ts`). The start screen says where Setup stands in one
  sentence ("9 things left to do.") with one primary button: Start, Continue once a walk is under way, or Check
  again with nothing left. Under it, the chapters in order, This machine's then This project's, each closed with
  its state as an icon and a label ("1 to do", "Done", `chapterLook`), opening to its steps: each with its state,
  its name, Skipped for now when it was, and Go to it while it's still to do. A step's screen has its chapter,
  "3 of 8" with a dot for each step of the walk, its instruction as the title, why in a sentence or two, the live
  check with Check again, one action, a closed Show how, and a foot of Back, Skip for now and Next. The end screen
  says "Setup is done" or "9 skipped", and lists each step left with Go to it.
- **The chapters are Setup's sections** (`setupChapters` in `extension/src/model/setup-walk.ts`): Tools, Accounts,
  The Claude Code plugin; The repo, Orgs, GitHub account, Client data and secrets and the rest, as `GROUP_TITLES`
  names them and D-047 orders them. In a folder that isn't set up, The repo starts with "What kind of project is
  this?", whose one action is Choose…, unless a project is being started already (T-133). This machine and This
  project keep their names.
- **One thing on each screen.** Each step has an instruction for its title (`WALK_TITLES`: "Install the GitHub
  CLI", not "GitHub CLI"); a test fails on a step without one. Why is its first two sentences, without the
  decision it cites or backticks (`plainWhy`). The one action (`mainAction`) is Do it, else I've done this, else
  the step's own one choice, such as Open in Salesforce; with none, Check again. Guide, Report a problem and any
  other button fold under Show how with the detail and the command line, which the page shows nowhere else
  (D-132).
- **Next is off with why until the check passes** (`nextWhy`), as in D-228, on the button's title and on a line
  beside it. Skip for now moves on and keeps the step for the end screen. Next and Back go to the next and last
  step still to do; a step that's done is never shown, and its dot is off. A step that passes while it's on show
  stays 1.2 s with its Done and Next on, then the walk moves on by itself (`PASS_PAUSE_MS`).
- **A step with its own modal** says so beside its Do it ("Opens Connect a tracker, then comes back here.",
  `WALK_MODALS`): Connect a tracker for the ticket source, Set up cloud builders for the B15 steps. The modal opens
  over Setup, and the walk is still at that step when it closes. The output panel's Open the step opens that
  step's screen (`showSetupStep`).
- **Where the person stopped** is kept in the tab's memory and in the folder's workspaceState
  (`acc.setup.walk`, sent as `setup-walk` and checked by `isWalkPlace`), so a tab opened later comes back to it.
  `extension/webview/walk.ts` works out the screen and where each button goes, with no DOM.
- **The head keeps Refresh alone.** Check this machine and the VS Code walkthroughs stay in the Command Palette.
  The progress bar is gone, and with it the themes' `progressBar-background`.
- **Keyboard and screen reader.** Every control is a button or a fold; a move puts focus on the new screen's
  heading; the screen is labelled by its title; the live check is a polite live region; each Go to it is named
  for its step.
- **Checked by** `extension/test/setup-walk.test.ts` (16 tests: the titles, why, Next's reason, the one action,
  the modal steps, the fold, the chapters, the walk's screens and buttons, the place kept, the shots), the first
  open's test (a kept place comes back in a new tab, and one that doesn't fit is refused), the looks table for a
  chapter, and three behaviour cases with four mutants: Next on before the check passes, a step that's done shown,
  Do it that asks for nothing, and a walk that forgets where it was. The screenshot run draws the start screen
  (`setup`), a step (`setup-walk-step`), the plugin's step with Show how open (`setup-walk-how`), the tracker's
  step (`setup-walk-modal`) and the end (`setup-walk-end`).
