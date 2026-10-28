## D-T-133 A project starts with this machine checked: every tool it needs, installed and on PATH, on a Mac or Windows (2026-10-27)

T-133. Builds on D-017 (one step list for Setup, the walkthrough and acc doctor), D-209 (acc runs natively on
a Mac and on Windows) and T-124 (install lines per system). The person asked that setting up a project makes
sure the machine has every tool it needs, installed and on PATH, as the Mac's Homebrew step does, for the
GitHub CLI, the Salesforce CLI and the rest. Setup's machine steps checked much of this, but they didn't run
when a project was set up, they couldn't tell "not installed" from "installed but not on VSCode's PATH", and a
few needs weren't checked.

- **One list of what a machine needs** (`packages/core/src/onboarding/machine-needs.ts`), beside
  `install-lines.ts`: each need's step, its program on each system, its least version and why, its install
  line, the folders its installer puts it in on each system, and the maker's page it was checked against with
  the date read (2026-10-27). 12 needs:
  - Every machine: git (Git for Windows on Windows), the GitHub CLI and Claude Code. On Windows, also Git for
    Windows' sh, which acc runs command lines with (D-209).
  - A Mac: Homebrew. Windows: winget, from Microsoft's App Installer; its Do it registers App Installer, as
    Microsoft's winget page says, and names the Store page for a machine without it.
  - The salesforce profile: Node 20, npm, the Salesforce CLI, Code Analyzer 5, and what Code Analyzer's engines
    run on: a Java Development Kit 11 or later for PMD and CPD, and Python 3.10 or later for the Flow engine.
    Salesforce's Code Analyzer setup page
    (developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/setup.html) says both. That page is
    drawn by JavaScript and couldn't be fetched as text, so it was read through a web search of it on
    2026-10-27. Java installs as Eclipse Temurin (adoptium.net/installation), and Python on Windows as the
    Python install manager (docs.python.org/3/using/windows.html, section 4.1.10).
  - A step that existed keeps its id. The new needs are new A1 steps: A1.winget, A1.sh, A1.npm, A1.java and
    A1.python, so Setup, the walkthrough, ONBOARDING.md and acc doctor all show them.
- **Installed, but not on PATH.** When a need's program doesn't run (or a stand-in answers, such as a Mac's
  /usr/bin/java with no Java), its step looks in the need's install folders
  (`packages/core/src/onboarding/path-fix.ts`): Homebrew's /opt/homebrew/bin and /usr/local/bin, Program Files
  and the user's AppData folders, npm's global folder, a JDK's version folder. Found there, the step says the
  tool is installed but VSCode can't see it, and shows "Not on PATH" (orange, an eye-closed icon), not "To do".
  - Windows: when the folder is on the user's or the machine's saved PATH, VSCode started before it was added,
    so the fix is to quit VSCode and open it again, and there's no Do it. When it isn't, Do it adds it to the
    user's PATH, never the machine's, with one PowerShell line.
  - A Mac: Do it adds Homebrew's own shellenv line to ~/.zprofile, as Homebrew's installer says, or a PATH line
    there for another folder such as ~/.local/bin. When ~/.zprofile has it already, the fix is to quit VSCode
    and open it again. VSCode reads PATH from the login shell when it starts. ~/.zprofile is zsh's, the Mac's
    own shell; a person who uses another shell adds the line to that shell's file by hand.
  - Linux: the folder, and where to add it, in words.
  - Never without a yes: each line that changes PATH carries its question (`CheckResult.ask`), which names the
    folder, and Do it asks it in a dialog first (`fixPlan` in `extension/src/logic/setup.ts`).
- **Checked when a project starts.** B0.config's Do it, and From a Jira epic… before the Connect page, run
  Check this machine for the profile chosen (a team template's own profile, where it sets one). With nothing
  to do, the project starts. Otherwise Setup opens at a list at its top, before anything is written: each step
  still to do, with its Do it, then Go on anyway and Not now. Once nothing is left, it says the machine is
  ready, and Start the project is the button to press. Not now writes nothing. In a terminal, `acc init` runs
  the same check first, lists what's left with each fix, writes nothing and exits 1; `acc init --anyway` goes on,
  and so does the extension once the person has seen the list. A dry run checks nothing.
- **Check this machine is a process** (D-132): in VSCode's Command Palette (`acc.checkMachine`), in the page's
  palette, and on Setup's header. Its CLI is `acc doctor --part machine`, which now takes `--profile`, and the
  page's words name it "Check this machine".
- **The Windows CI smoke** (`scripts/windows-smoke.ts`) runs `acc doctor --part machine` as before, and now
  fails unless it checked every machine step, and on Windows unless Git for Windows' sh passed. winget isn't
  required: a runner image may lack App Installer.
- **Checked by** `packages/core/test/machine-needs.test.ts` (each system's list for each profile; on PATH,
  only in an install folder and missing; the PATH lines quoted for PowerShell and for the Mac's shell, and
  asking first; a stand-in; a JDK's version folder; npm's folder; winget, Git's sh and Code Analyzer's
  version), `packages/cli/test/setup.test.ts` (acc init listing what's left and writing nothing, then
  --anyway; doctor --profile), `extension/test/machine-first.test.ts` (the list with one tool missing and one
  not on PATH, the ready state, no Do it for a fix by hand, the question first, the process words, and the
  built extension's B0.config Do it checking first, Not now and Go on anyway), `scripts/test/windows-smoke.test.ts`,
  and the screenshot run's setup and setup-machine-first pages.
