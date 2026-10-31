# Agent Command Center

**Run Claude Code agents in parallel, from one page in VSCode.**

Agent Command Center turns tickets into reviewed pull requests. It reads your
trackers, gives each ticket its own git worktree and agent, runs the project's
checks, has a second agent review the change, and opens the pull request. You
see every step on one page. Nothing merges, deploys or posts on a ticket until
you say so.

It's built for Salesforce work first, but the core assumes nothing about
Salesforce. Project types plug in as profiles.

## How a ticket goes

| Step | Who | What happens |
| --- | --- | --- |
| **Add to my work** | you | A ticket from Jira, Azure DevOps, GitHub, monday.com or Slack becomes a task |
| **Make a plan** | an agent, then you | An agent reads the ticket and proposes a plan; you question it and approve it |
| **Build it** | an agent | A background Claude Code session builds it in its own worktree |
| **Checks** | the Command Center | The project's checks run on each commit: lint, tests, and for Salesforce a check-only deploy |
| **Review** | an agent, then you | A read-only agent judges the change against its ticket |
| **Land and deploy** | you | A pull request, then each environment in turn, each checked first and approved by you |

## Highlights

- **One page.** Overview, Tasks, Agents, Worktrees, Environments, Setup and
  Settings, from the icon in the activity bar.
- **Your trackers' own boards.** Columns as the tracker has them. Drag a card
  to move the real ticket. Each repo signs in to its own trackers, so one
  client's login never serves another's repo.
- **No terminal hunting.** An agent's permission prompts and questions arrive
  as cards to allow, deny or answer in place. **Watch** shows its work as it
  happens.
- **Several agents, gently.** Three builders per project by default, heavy
  checks taking turns, and tasks that change the same files waiting for each
  other.
- **Ticket updates are yours to post.** When a pull request is ready, merges
  or deploys, the Command Center drafts an update. You edit it and post it as
  yourself.
- **Mac and Windows**, natively, with no WSL.

**Status:**

- **Done:** M1 to M7: the ledger and CLI, setup walkthroughs, dispatch,
  checks, review and land, the Claude Code plugin, and the extension's views.
- **Next:** M8, the pilots. [ROADMAP.md](docs/ROADMAP.md) says what's done,
  what's under way and what waits on a person, each with its date and evidence.

## Install and first run

The Command Center is a VSCode extension, the `acc` command that comes with
it, and a Claude Code plugin. `acc` is the engine behind every action, and a
person never needs to type it. [ONBOARDING.md](docs/ONBOARDING.md) has every
step in detail.

### What you need

| | macOS | Windows |
| --- | --- | --- |
| Installs what's missing | Homebrew | winget |
| Claude Code CLI, signed in | `brew install --cask claude-code` | `irm https://claude.ai/install.ps1 \| iex` |
| GitHub CLI | `brew install gh` | `winget install --id GitHub.cli -e` |
| git 2.40 or later | `brew install git` | `winget install --id Git.Git -e` |
| Node 20 or later (Salesforce only) | `brew install node` | `winget install --id OpenJS.NodeJS.LTS -e` |

You also need VSCode and a GitHub account. A Salesforce project also needs the
Salesforce CLI and its Code Analyzer plugin. The Command Center itself needs no
Node: it runs on VSCode's own runtime.

On Windows, Git for Windows is required, since its `sh` runs the Command
Center's shell commands. Restart VSCode after installing a tool, or VSCode
won't find it. Linux isn't supported.

### Getting access

The repo, its releases and the plugin's marketplace (this repo) are private.

1. Accept the invitation to the repo with the GitHub account you'll use.
2. Sign gh in as that account: `gh auth login`.
3. Check that git can read the repo. Claude Code clones the plugin's
   marketplace this way:

   ```bash
   git ls-remote https://github.com/jack-huffman/agent-command-center
   ```

   If it asks for a password or can't find the repository, run
   `gh auth setup-git`. This changes your global git config: every repo then
   takes its github.com credentials from gh's active account, except one with
   its own credential helper
   ([ONBOARDING.md, B2](docs/ONBOARDING.md#b2-clone-the-repo-and-pin-its-github-account)).

### Installing the extension

```bash
gh release download -R github.com/jack-huffman/agent-command-center -p '*.vsix'
code --install-extension agent-command-center-*.vsix
```

If `code` isn't on your PATH, run **Shell Command: Install 'code' command in
PATH** from the Command Palette. Or use Extensions → **⋯** → **Install from
VSIX…**. Then run **Developer: Reload Window**.

After that, the extension finds new releases by itself. **Install and reload**
downloads the new `.vsix`, checks it against the release's `.sha256`, updates
an older Claude Code plugin, and installs the `.vsix`.

### The first run

1. **This machine.** Click the Command Center's icon in the activity bar. In
   a folder that isn't set up, it opens on **Setup**, at **This machine**.
   Each step has **Check**, and most have **Do it**. A step ticks itself when
   its check passes.
2. **The plugin.** Step A4's **Do it** installs it from this repo's
   marketplace. Start a new Claude Code session afterwards. To install it by
   hand:

   ```bash
   claude plugin marketplace add https://github.com/jack-huffman/agent-command-center
   claude plugin install acc@agent-command-center --scope user
   ```

   A private marketplace doesn't update itself. The extension's **Install and
   reload** updates an older plugin with it. Otherwise, after each release run
   `claude plugin marketplace update agent-command-center`, then
   `claude plugin update acc@agent-command-center --scope user`. A4's
   **Do it** runs both.
3. **A project.** Open its repo folder, then the Command Center. **Setup** asks
   what kind of project it is and writes `.acc/config.json`, for you to review
   and commit. Its other steps set up the repo's GitHub account, branches,
   orgs and tracker.
4. **Any time.** **Setup** shows what's left. `acc doctor` in a VSCode
   terminal runs the same checks.

<details>
<summary><b>What the Command Center changes on your machine</b></summary>

- **VSCode:** `acc` on every terminal's PATH. Tracker sign-ins and the Slack
  webhook go in VSCode's secret storage.
- **`~/.acc/`:** the runtime path for the launcher (`runtime`), agents' waiting
  questions (`questions/`), the slots heavy checks take turns on (`heavy/`,
  `machine.json`), the repos it knows (`repos.json`), and notices sent to
  Slack (`slack/sent/`).
- **Claude Code:** the plugin at user scope, its marketplace cloned under
  `~/.claude/plugins/`. Its hooks run in every session, and do nothing in a
  repo without `.acc/config.json`. Each project's main checkout is trusted
  once (B12).
- **gh:** a login for each account you sign in with through **Do it**. gh's
  active account is put back as it was.
- **The Mac:** `caffeinate -i` keeps it awake while an agent runs. The display
  still sleeps.
- **Each project's repo:** `.acc/config.json`, which you commit. The ledger
  lives in the git directory (`.git/acc/`), never in a commit. Worktrees go in
  `.claude/worktrees/`, and `node_modules` goes in `info/exclude`. The repo's
  git config gets its own commit identity and credential helper (B2). Each
  setup step's **Do it** writes what that step needs.

</details>

## Settings

Five VSCode settings, under **Agent Command Center**:

| Setting | Default | What it does |
| --- | --- | --- |
| `agentCommandCenter.openFromActivityBar` | on | The activity bar icon opens the page and tucks the sidebar away. Off, the sidebar lists the sections instead |
| `agentCommandCenter.notifications` | on | Says when a task needs you or has news. Several changes come as one counted notice, and news that arrives while you're away waits for one summary |
| `agentCommandCenter.updates.check` | on | Looks for a newer release a minute after VSCode starts, then every six hours. **Check now** in Settings → About works either way |
| `agentCommandCenter.theme` | `vscode` | How the Command Center's own pages look: `vscode`, `light` or `dark` |
| `agentCommandCenter.refreshPace` | `normal` | How often it refreshes while on screen: `normal`, `relaxed` (half as often) or `slow` (a quarter as often) |

Each project's own settings are in its `.acc/config.json`.
[DESIGN.md section 4](docs/DESIGN.md#4-config) says what each key does.

## Principles

- **Self-contained.** It ships its own skills, hooks and agents as one Claude
  Code plugin, and needs no other skills.
- **Claude Code is the engine.** Agents are Claude Code background sessions.
  This project doesn't write an agent runtime.
- **One ledger per repo, one writer.** Task state is a JSON file, and only
  `acc` changes it.
- **Profiles, not special cases.** Each project type declares its own checks.
  `generic` and `salesforce` come first.
- **Humans keep the gates.** Nothing deploys past the development org or
  changes a ticket unless you ask. Merging on its own, through a merge queue,
  of a reviewed pull request whose checks passed, into an environment that
  isn't protected, is an opt-in elsewhere and on by default in a Salesforce
  project, where it covers the development environment alone and needs the
  builder's own deploy there, on the reviewed commit (D-T-157). Settings' Pipeline section shows and
  changes it.
- **Readable without colour.** Every state has an icon and a label. Where
  colour helps, it's orange against blue, never red against green.

## Docs

| | |
| --- | --- |
| [ONBOARDING.md](docs/ONBOARDING.md) | Every setup step, for a machine and for a project |
| [DESIGN.md](docs/DESIGN.md) | How it's built, and every config key |
| [ROADMAP.md](docs/ROADMAP.md) | Where each piece stands, with its date and evidence |
| [DECISIONS.md](docs/DECISIONS.md) | Why things are the way they are |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release |
| [RULES.md](docs/RULES.md) · [TEMPLATES.md](docs/TEMPLATES.md) | Shared rules and team templates |
| [FIRST-RUN.md](docs/FIRST-RUN.md) | The checklist for a first install on a fresh machine |

## Development

Development needs Node 23.6 or later, which runs the TypeScript directly. The
built `acc` runs on Node 20 or later, or on VSCode's runtime.

```text
packages/core   ledger, config and state rules, shared by everything below
packages/cli    the acc CLI: its launcher (bin/acc) and the bundle it runs
plugin/         Claude Code plugin: skills, hooks, reviewer agent, bin/acc and bin/acc.mjs
extension/      VSCode extension: the Command Center page
docs/           design, roadmap, decisions
```

```bash
npm install              # dev dependencies
npm run check            # type-check, build, run the tests
npm run acc -- doctor    # run the CLI from source
./dist/acc doctor        # run the bundle the last build made
npm run validate-plugin  # claude plugin validate --strict, on the plugin and the marketplace
npm run browser          # get the pinned headless shell the screenshots use
npm run screenshot       # draw every tab into dist/screenshots/ and check its layout
npm run set-version -- 0.36.0  # the one way to change the version
npm run package          # check, package into dist/, scan for personal data, refresh plugin/bin/
npm run release          # on main, in a terminal: a GitHub Release with the .vsix
```

- **Try a change** with `npm run package && npm run install-extension`, then
  reload the window. Load the plugin in place with `claude --plugin-dir plugin`.
  If the plugin is also installed, that session may run both copies' hooks:
  `claude plugin disable acc@agent-command-center` turns the installed one off
  until you `enable` it again.
- **`plugin/bin/` is committed**, because a plugin installed from git has no
  build step. Only `npm run package` refreshes it, so on a branch, leave it
  out of your commits (D-042).
- **One version** for `acc`, the extension and the plugin. A release goes: set
  the version and write its `CHANGELOG.md` entry on a branch. After the merge,
  run `npm run package` on main, commit `plugin/bin` and push. Then run
  `npm run release` (D-079).
- **Screenshots** are drawn by the pinned `chrome-headless-shell`, in dark and
  light, at 1000, 620 and 500 px. The run fails on overlapping controls,
  cut-off labels, sideways scrolling or a WCAG 2.1 AA violation. Run
  `npm run build` first, and read the shots: the run can't judge how a page
  reads.

Run builds and tests one at a time, under `nice -n 15`.
