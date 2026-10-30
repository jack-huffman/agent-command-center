# First run on a fresh machine

**Status: not run yet.** This is the checklist for GH-62's first run: someone
new installs a released `.vsix` on a machine that has never had acc, follows
the walkthroughs to a dispatched task, and writes down what happened at each
step. The tester fills it in. Their notes come back as their own task, GH-88,
which fixes what's small and files the rest (D-088).

The run tests the release, not this repo's source. Everything below is in the
order the walkthroughs show it: getting access and installing, the machine
steps, a generic project's steps up to a dispatched task, then a Salesforce
project's steps as far as a Developer Edition org goes.

## Before the run (for the author)

- [ ] **A release of 0.46.0 or later.** This script was checked
  against 0.46.0, so an earlier release may differ. Check that the release has
  its `.vsix` and `.vsix.sha256` files: Install and reload needs both.
- [ ] **The invitation to the Agent Command Center repo is sent** (Settings →
  Collaborators, the repo README's Getting access names), **and the tester has
  accepted it** with the GitHub account they'll use. On a personal repo a collaborator can push, and
  private repos on this plan have no branch protection, so tell them in plain
  words: never push to `main`. They need only to read it.
- [ ] **Their own Mac, or their own macOS user on yours.** Not the author's
  account: its `~/.claude`, `~/.acc` and keychain are shared with the builders
  running there, so sign-ins would pass that shouldn't, and removing the plugin
  would break them.
- [ ] **A throwaway private repo first**, under the tester's own GitHub
  account, for the generic project. A README is enough:
  `gh repo create acc-first-run --private --add-readme --clone`, once gh is
  signed in. Do the generic project end to end before any real repo.
- [ ] **Time set aside.** No run has been timed yet; until one has, plan on
  half a day for the machine steps, a generic project and one dispatched task,
  with downloads and Claude sign-ins in it. Note the real time at the top of
  your notes.
- [ ] **A Salesforce Developer Edition org** for the Salesforce project, signed
  up for this run. Never a client's org. A Developer Edition org has no
  sandboxes, so the Salesforce run is expected to stop at B1.orgs or soon
  after: note where.

## Where a first run most likely stops

| Where | What happens | What to do |
| --- | --- | --- |
| A fresh VSCode, `code` not on PATH | `code --install-extension` says command not found | Command Palette → **Shell Command: Install 'code' command in PATH**, or Extensions view → **⋯** → **Install from VSIX…** and pick the file. Then **Developer: Reload Window** |
| `git ls-remote` asks for a password or can't find the repo, or A4 can't clone the plugin | git has no credentials for the private repo | Check the invitation was accepted with gh's account. Then `gh auth setup-git`: it changes the **global** git config, so every repo on that Mac then gets github.com credentials from gh's active account (except a repo with its own helper, B2). Tell the tester before running it |
| A4 passes, but Claude Code doesn't have the plugin | Sessions already running don't load a new plugin | Start a new Claude Code session (close the terminal's `claude` and open a new one) |
| A4 fails after a new release: the plugin is older than the extension | A private marketplace updates itself only when `GITHUB_TOKEN` is set. Install and reload updates the plugin, but not when the extension was installed by hand, or when its plugin step failed (the message after the reload says why) | Run A4's **Do it**, or by hand `claude plugin marketplace update agent-command-center` then `claude plugin update acc@agent-command-center --scope user`, then a new Claude Code session. Do this after every release, including the tester's first update |
| `acc` isn't found in a terminal | The extension adds `acc` to terminals opened after it starts | Open a new VSCode terminal after the reload |
| A1.claude fails: no `--bg` | The terminal's Claude Code is older than the one in VSCode | `claude update` (A1.claude's **Do it**) |
| A1.claude-billing fails | An API key, Bedrock or Vertex setting is found | Remove the setting it names, or tick **I've done this** if it's on purpose |

## How to fill it in

For each step, write:

- **Showed:** the status and the words the step showed, copied exactly, and the
  name of a screenshot if you took one.
- **Unclear:** anything you had to guess, look up or ask about.
- **Failed:** what went wrong, with the exact message: the step's detail, the
  terminal's output, or a notification.
- **Result:** keep one word: passed, failed, unclear or not reached.

Leave a line empty when there's nothing to say. Time spent on a step is worth
noting when it's more than a few minutes.

**Keep personal data out.** Write `~` for your home folder, `<you>` for your
macOS user, `<account>` for a GitHub account and `<email>` for an email
address, and crop them out of screenshots. A test scans this file for this
repo's own account and identity, but not for yours.

When a step fails, the follow-up task links each entry to the commit that fixed
it or the issue filed for it, after **Fixed in / filed as**.

## The machine and the release

| What | Fill in | How to tell |
| --- | --- | --- |
| macOS version | | Apple menu → About This Mac |
| Apple Silicon or Intel | | the same |
| VSCode version | | Code → About Visual Studio Code |
| Release installed | | the `.vsix` file's name |
| A new macOS user, or a machine that never had acc? | | |
| No Node on PATH | | `command -v node` prints nothing |
| No `~/.acc` | | `ls ~/.acc` says no such file |
| No Command Center plugin in Claude Code | | `claude plugin list` doesn't list acc, or claude isn't installed |
| winget before the run? (Windows only; on a Mac, Homebrew is a step Setup checks: A1.brew) | | `winget --version` |
| Git for Windows installed before the run? (Windows only) | | `git --version` shows `windows` in it |
| git before the run | | `git --version` |
| gh installed before the run? | | `command -v gh` |
| Claude Code installed before the run? | | `command -v claude` |

## Getting access and installing

Follow the README's **Install and first run**, from **What you need** to
**Installing the extension**, exactly as written.

### What you need

Look for: anything the README assumes you already have. On a Mac, Homebrew is
checked by A1.brew. winget isn't checked by any step, but the Windows fixes use
it. On Windows, Git for Windows is required, and VSCode needs a
restart after a tool is installed.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### Getting access

Look for: whether accepting the invitation, `gh auth login` and
`git ls-remote` worked as the README says, and whether you needed
`gh auth setup-git`.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### Installing the extension

Look for: whether `gh release download` found the `.vsix`, and whether `code`
was on your PATH. A fresh VSCode doesn't put it there: note whether you used
**Install from VSIX…** instead.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

## This machine

After the reload, nothing opens by itself. Click the Command Center's icon in
the activity bar: with no project set up, it opens on Setup at **This
machine**. Open the walkthrough **Agent Command Center: set up this machine**
with the **Machine walkthrough** button or from the Command Palette. Note
whether you found it easily. Do the steps with no project folder open.

With no project open, the machine walkthrough also lists the Salesforce tools:
A1.node, A1.sf and A1.code-analyzer (D-077). **Did those rows confuse you,
since a generic project doesn't need them?** Answer here:

- **Answer:**

### A1.brew: Homebrew (on a Mac)

Look for: on a Mac, whether Setup says Homebrew is missing before it tells you
to install git, and whether the later steps say to do this one first. On
Windows the step is skipped with a reason: note whether it says so.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### A1.winget: winget (on Windows)

Look for: on Windows, whether Setup found winget, and what it said if App
Installer wasn't there. On a Mac the step is skipped with a reason.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### A1.git: git 2.40 or later

Look for: the git that comes with Apple's command-line tools may be older than
2.40. Note `git --version` before and after **Do it**, and whether the new git
was the one on PATH in a new terminal.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### A1.sh: Git for Windows' sh (on Windows)

Look for: on Windows, whether it passed once Git for Windows was installed. On
a Mac the step is skipped with a reason.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### A1.node: Node 20 or later

Look for: whether you installed Node here, though the generic project doesn't
need it.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### A1.npm: npm

Look for: it comes with Node, so it passes once Node does.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### A1.gh: GitHub CLI

Look for: if gh was installed but Setup said "Not on PATH", what it offered,
and whether it asked before changing PATH.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### A1.claude: Claude Code CLI with background sessions

Look for: whether **Do it** installed Claude Code when it was missing, and how
you signed it in to your Claude account.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### A1.claude-billing: Agents bill your Claude subscription

Look for: whether the check said where the setting is, and whether **I've done
this** was clear when it couldn't tell.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### A1.sf: Salesforce CLI

Look for: its fix installs with npm, so it needs Node first. Note the order you
did them in.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### A1.code-analyzer: Salesforce Code Analyzer

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### A1.java: Java 11 or later, for Code Analyzer

Look for: Salesforce projects only. Whether a Java you already had was found.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### A1.python: Python 3.10 or later, for Code Analyzer

Look for: Salesforce projects only. On Windows, whether `python` opened the
Microsoft Store instead, and what Setup said then.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### A2.gh-login: Logged in to GitHub

Look for: whether **Do it** signed you in with the account that accepted the
invitation.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### A4.plugin: The Command Center's Claude Code plugin

Look for: **Do it** runs in a terminal and Claude Code clones this private repo
with your git credentials. Note any prompt it showed, and the version the step
named once it passed: it should be the release you installed.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

## A generic project, to a dispatched task

Open the throwaway repo's folder. The project walkthrough doesn't open by
itself in any folder: use Setup's **Project walkthrough** button or **Agent
Command Center: Onboard this project** from the Command Palette, and note
whether that was easy to find.

**At B0.config, check one thing on the Setup page** (the Command Center's
Setup section). Before **Do it**, note whether This machine lists **Node 20 or
later**, **Salesforce CLI** and **Salesforce Code Analyzer**. After **Do it**
and the choice that isn't Salesforce, all three should be gone from This
machine, without reloading the window. Answer here:

- **Before:**
- **After:**

### B0.repo: Inside the project's repo

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B0.config: Project config

Look for: what **Do it** asked, and whether it was clear that you review
`.acc/config.json` and commit it yourself.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B0.template: The team template is current

Look for: whether it said "Doesn't apply" for a project not started from a
template, without asking you anything.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B0.rules: Copied-in rules are current

Look for: whether **Import rules…** was there even with nothing copied in, and
whether its preview made clear that you review `.acc/rules/<name>.md` and
commit it yourself.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B2.identity: Commit identity

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B2.account: The repo's GitHub account is logged in

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B2.credentials: git pushes as the right account

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B3.secrets: No credentials in tracked files

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B6.branches: A branch for every environment

Look for: which branches a generic config names, and whether **Do it** made
them.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B10.default-branch: GitHub's default branch is the day-to-day one

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B10.ignore-worktrees: Task worktrees are git-ignored

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B10.merge-floors: Raised floors merge on their own

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B10.required-check: GitHub requires the checks autopilot waits for

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B10.readme: README names every environment

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B12.trust: Claude Code trusts the repo for background agents

Look for: **Do it** opens `claude` in a terminal. Note whether the trust prompt
showed, and whether the step ticked after `/exit`.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B13.gate-tools: The required checks can run

Look for: a generic project requires no checks, so this should say so and
count as done.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B13.tools: The tools the project's checks need

Look for: a generic project lists no tools, so this should say so and be
skipped. A project that lists one, such as this repo's pinned headless shell,
should name it, and offer its fix when its check fails.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B14.tickets: The repo's ticket source

Look for: whether you connected the repo's GitHub Issues or marked it done to
keep tasks in acc alone, and which was clearer.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B15.cloud-github-app: Claude can clone the repo from the cloud

Look for: these five steps only once the project opts in to cloud builders
(`acc cloud enable`, GH-69); before that Setup should skip them, and say so.
Then whether the check finds the Claude GitHub App on the repo, or says to
tick it yourself after `/web-setup`.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B15.cloud-routine: A scheduled task for the repo

Look for: whether Set up cloud builders' The scheduled task step got you
through making the scheduled task at claude.ai/code/routines: Copy the prompt,
Open claude.ai, and the trigger id checked as you typed it, then Keep the id.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B15.cloud-token: The scheduled task's token is kept

Look for: The token step taking the token hidden, and the check passing once
it's kept: in the keychain on a Mac (`acc cloud token` takes it on stdin too),
in VS Code on Windows, with nothing written to `.acc/config.json` or a file.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B15.cloud-login: Claude Code is signed in to claude.ai

Look for: whether the check says which account, and what it says with an API
key instead.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B15.cloud-guard: The push guard is committed

Look for: `acc cloud enable` writing `.claude/hooks/acc-push-guard.mjs` and
`.claude/settings.json`, the check still failing until both are committed (it
reads HEAD's tree), and passing once they are. `acc cloud` should also say, per
environment branch, whether GitHub enforces protection, as a warning where it
doesn't.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### Dispatch

Add a small task: **Agent Command Center: Add task** from the Command Palette,
such as "Add a line to the README saying what this repo is for". Then
**Dispatch** it from the Overview. Note whether the builder started, whether
its permission prompts or questions reached the Overview, and how far it got:
working, then In review with a pull request. Don't merge it unless you want to.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

## A Salesforce project, as far as it goes

Sign the Salesforce CLI in to the Developer Edition org (`sf org login web`).
Make a second throwaway repo like the first, put a Salesforce DX project at
its root (`sfdx-project.json` and `force-app/`; `sf project generate` makes one
in a folder of its own), and open it. Note how you made it. Open the project
walkthrough the same way. The steps the generic run
already covered show again: note only what differed. The Salesforce steps
are below. Stop where the org can't go further, and note which step and why.

### B1.orgs: Every org is listed

Look for: B0.config's **Do it** lists Production orgs you're logged in to. Note
whether a Developer Edition org counted as one.

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B3.gitignore: Client data blocked at the repo root

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B3.data-files: No client data files in git

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B4.skeleton: Salesforce project skeleton

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B5.baseline: Baseline manifest

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B6.org-match: Each branch points at the right org

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B8.tracking: Developer sandboxes are source tracked

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B8.cli-tracking: The CLI knows they're tracked

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B9.lists: Environment-specific and known-drift lists

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B10.default-org: The local default org is the day-to-day one

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

### B11.drift: The day-to-day org matches its branch

- **Showed:**
- **Unclear:**
- **Failed:**
- **Result:**
- **Fixed in / filed as:**

## What the run changed

The follow-up task lists here each change to the README's **Install and first
run**, and each issue filed, with a link.

- (none yet)
