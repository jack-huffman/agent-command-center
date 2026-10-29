## D-T-145 Set up cloud builders in one guided modal, on a Mac or on Windows (2026-10-29)

T-145. The person asked for setting up cloud builders (GH-69, D-140) to be "beautiful, minimalistic, and simple to
follow", a complete guided walkthrough for both a Mac and Windows. It worked, but wasn't guided: Settings had Turn
on…, Routine prompt, Add the routine… and Token…, each a plain input box or a notification; Setup's five B15 steps
had Check and I've done this but no Do it; the guides named buttons that no longer existed and called Anthropic's
routines page "Salesforce docs"; and Windows couldn't finish at all, as the token lived only in the macOS keychain
(D-209). claude.ai now calls routines "scheduled tasks" (code.claude.com/docs/en/routines, read 2026-10-29). It
builds on T-140's stepped modal (D-224) and the calm style of D-217, D-218 and D-226.

- **One modal, Set up cloud builders** (`extension/webview/cloud-setup.ts`, `extension/src/model/cloud-setup.ts`,
  `extension/src/cloud-setup.ts`). Made with `makeModal`, with the tracker modal's step bar and a foot that stays
  in view: Back, why Next is off, Cancel, and Next, or Done on Ready. It is as tall as its step. Every way in opens
  it: Settings' Cloud builders part (Set up…, in place of Turn on…; the other actions stay), each B15 step's Do it
  in Setup (`fix.vscode`), VS Code's command palette (`acc.cloud.setup`) and the Command Center's own. It opens on
  the first step not done (`firstNotDone`), so a person can stop and come back; before its checks are read, a step
  still loading isn't taken as undone, and the first read moves it there unless the person has moved.
- **Seven steps, one thing each** (`CLOUD_SETUP_STEPS`, named in core so the guides use the same words): Turn on,
  GitHub access, The scheduled task, The token, Sign in, The push guard, Ready. Each is one line of what to do, its
  live check as an icon and a label (blue for done, orange for needs you), its own buttons, and its detail folded
  away. Turn on says what a cloud builder is, and its fold what it costs: it counts toward the claude.ai plan's
  usage, with no separate charge, and the scheduled task belongs to the claude.ai account that makes it. The
  scheduled task has Copy the prompt, Open claude.ai, three numbered lines, and a Trigger id field checked as it's
  typed. The token has a hidden field. Sign in's Do it runs Claude Code's sign-in in a terminal, and checks again
  when it ends. The checks run again on each button and when VS Code gets focus back, as from claude.ai.
- **Next is off, with why, until a step that must pass has** (`MUST_PASS`, `nextWhy`): every step but GitHub
  access, which can be connected with /web-setup where the Command Center can't see it; there, I've done this
  ticks it, as Setup's does. A step can be gone to only once each must-pass step before it has passed; one that
  can't be on show any more, as after signing out, moves back to the first step not done.
- **Only a step's own button writes**, and each writes only what it says: Turn on (`acc cloud enable`), Keep the id
  (`acc cloud enable --routine`), Keep the token, and the guard's Do it. Cancel, Escape and the backdrop close it
  and keep only that; while a button's work runs, Cancel is off with why. A trigger id or token that doesn't fit
  is refused before anything is written, in the page as it's typed and again in the extension.
- **The push guard on the branch the cloud clones** (`packages/core/src/cloud-guard-place.ts`, `acc cloud guard
  [--commit|--push]`). The cloud clones origin's default branch (as `cloudGuard` reads it), so that's where the guard
  must be. Do it commits the guard's three files alone, never anything else staged, and only with that branch
  checked out; otherwise it's off and says to switch. Push… asks first, in a modal that names the branch and how
  many commits go with it, and a no pushes nothing. `acc cloud --json` now says where the guard stands
  (`guardPlace`).
- **Windows keeps the token in VS Code** (`CloudTokens`). On Windows the token goes to VS Code's secret storage, by
  repo, as tracker sign-ins do (D-027); it is read into memory as the projects load and handed to acc in
  `ACC_CLOUD_TOKEN` whenever the Command Center runs acc for that repo: through the output panel's runs (a dispatch,
  a review, autopilot), the sidebar's acc and Setup's checks (`AccEnv`). A Mac keeps its keychain, through acc, so
  a dispatch typed in a terminal still finds it. acc hands the token to no program it starts (`childEnv` in
  `start.ts`, the one place acc starts programs); only the Command Center, which starts acc with it, lets it
  through (`handsTokenToAcc`). A cloud dispatch typed in a Windows terminal with no token in its environment is
  refused in words: start it from the Command Center, Build it, then Cloud (`WINDOWS_TOKEN_FIX`). Token… is on
  everywhere, and D-209's `cloudTokenUnavailable` is gone. Each system's lines are its own: Terminal or PowerShell,
  the keychain or VS Code.
- **Minimal words.** "Scheduled task (formerly routine)", as claude.ai says, on screen, in the guides, in Setup's
  titles and in acc's own words; the config key stays `agents.cloud.routine`. The guides say what the modal's
  buttons say, and a docs link is named for the site it opens (`docsLabel`: Claude Code docs, Salesforce docs, GitHub
  docs), so the routines page is no longer "Salesforce docs". Processes, not commands, on screen (D-132): Sign in's
  fold says what Do it does, not its command line. No single choice here has more than three options (D-205).
- **Checked by** `extension/test/cloud-setup.test.ts` (each step's check and Next's reason, opening on the first
  step not done, the trigger id and token checks, the guard's commit and the push's question, Cancel, Mac and
  Windows, the guides' button names and links, the page's field), `extension/test/cloud-token-systems.test.ts`
  (secret storage in, the environment out, never a file or the config, nothing handed to a child, the terminal's
  refusal), `packages/core/test/cloud-guard-place.test.ts` (real git with a bare origin), and two browser cases,
  "cloud setup: Next stays off until the step passes" and "cloud setup: the token is typed hidden", with mutants
  for Next going on before the step passes, the token written to the tab's memory, and Keep the token on before
  the token fits. The shots `cloud-setup-<step>-<mac|win>-<todo|done>` draw every step on both systems, done and
  not done, and `cloud-setup-task-mac-open` and `cloud-setup-token-win-open` a step's detail opened.
- **Out of scope**: the real cloud run (GH-69's last criterion) stays the person's.
