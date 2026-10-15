# Agent Command Center

A VSCode command center for running Claude Code agents in parallel. It pulls
tickets from your trackers, gives each one its own git worktree and agent, runs
the project's checks, opens the pull request, and shows all of it in one panel.

It is built for Salesforce work first, but the core assumes nothing about
Salesforce. Project types plug in as profiles.

**Status:**

- **M1 done:** the task ledger, the config, and onboarding checks (`acc doctor`).
- **M2 done:** setup walkthroughs, and one Command Center page, with an
  Overview, tasks, agents, worktrees, environments and setup. Click the icon in
  the activity bar to open it.
- **M3 done:** **Dispatch** hands a ready task to a background agent in its own
  worktree. The first real run went from Ready to In review on its own.
- **M4 done:** **Checks.** `acc gate run` runs a project's checks on the
  current commit and records the results. Salesforce projects get `format`,
  `lint`, `static`, `lwc-tests` and a check-only `validate`. `acc done` waits for
  the required ones. `acc drift <environment>` shows what changed in an org
  since its branch.
- **Boards and tickets:** the Tasks tab shows each tracker's own board: a
  Jira board's columns, an Azure DevOps team board's, or a GitHub Project's. Drag a card to move the real
  ticket. Click one and its ticket page opens over the board: the description,
  comments, status, assignee and labels, plus acc's agent, checks and history.
  **Open as tab** gives it a tab of its own. Status, assignee
  and labels change from there only when the tracker says `"edits": true`. On
  a GitHub tracker, `"edits"` also lets `acc sync` close a task's issue when its
  work merges, with a comment naming the pull request; `acc sync --close-done`
  closes the issues of tasks done before that.
- **A GitHub Project's columns follow the task:** under `"edits": true`, as acc
  moves a task, its issue's card moves on the Project to the column of that
  name: Todo for to do and ready, In Progress for running and rework, Testing
  (or In Review) for review, Blocked, and Done. `statusFor` in the tracker's
  record names other columns, such as `{ "review": "QA" }`. A Project without
  the column is left alone, a card you drag stays put until the task moves
  again, and a move that fails is named on the task without holding it up.
- **Ticket updates are yours to post:** apart from that close and those card
  moves, acc never posts
  on a ticket. When a pull request is ready for review, merges, or deploys, or
  a builder needs the client's answer, acc drafts an update in plain words. It
  waits in Needs you and on the task's page, where you edit it and post it as
  yourself, or discard it. `acc updates` lists them.
- **Who you're working as:** the status bar shows the repo's GitHub account,
  and you can switch it for your clone alone. git push follows the switch, and
  boards and comments say who they act as.
- **No terminal hunting:** agents' permission prompts and questions arrive as
  cards on the Overview, to allow, deny or answer in place. **Watch** shows an
  agent's work as it happens: what it said, each command and its result. Setup's
  commands run in an output panel on the page, which answers their prompts.
- **M5:** `acc review` has a read-only agent judge each commit's
  change against its ticket. `acc land` pushes and opens the pull request, and
  `acc sync` follows it to done. A person approves each step on the page.
- **Promotion and deploys:** **Promote…** on an environment opens a pull
  request to the next one. It's checked against that org first, leaves out
  environment-specific files, and names anything it skips. **Deploy…** sends
  what merged since the last deploy, and a protected org needs its name typed.
- **Guided setup, all of it:** the baseline manifest, the environment branches,
  the two lists and the README's environments table each have a **Do it** in
  the walkthrough. No terminal needed.
- **How agents run:** builders and reviewers each have a model, effort and
  fallback, for this clone or the whole project, changed in the Command
  Center's **Settings**, with each project's autonomy and auto-merge.
- **A task's model and effort:** each builder runs with the clone's or the
  project's model and effort unless a task picks its own:
  `acc dispatch <id> --model <m> --effort <low|medium|high|xhigh|max>`, or
  **Dispatch with…** (**Re-dispatch with…** on a rework), which offers the
  model, then the levels it takes, saying which is its default and where the
  current one is set. A re-dispatch and a resume keep the pick;
  `--effort default`, or the builder's own level in the picker, drops it, and
  a model picked that doesn't take it drops it and says so. On every dispatch
  and resume, a level the model doesn't take is refused before anything
  starts, citing acc's list of each model's levels, copied from Anthropic's
  effort guide with the date it was read. The task page and Agents show an effort beside the model when it
  isn't the model's default.
- **History:** what agents asked and what you answered stays on the page: in
  each agent's timeline, and in the Overview's History with the task moves and
  commands.
- **M5 done:** the first real ticket went all the way: issue #9, built by an
  agent, checked, reviewed by another agent, and opened as pull request #10.
- **M6 done: the plugin.** `claude --plugin-dir plugin` (or the marketplace in
  this repo) adds acc's skills, the reviewer agent and the hooks that keep
  builders in their worktree and away from pushes, merges and deploys.
- **M7: three agents at once.** Three builders ran together on issues #11 to
  #13, each in its own worktree, with their checks taking turns on the
  machine's heavy slot. A status bar item says what needs you, what's running
  and what's in review. A notice says when a builder finishes, a review passes
  or asks for changes, or a pull request's checks fail. **Intake** gathers the
  ways work comes in, and **Instructions** opens a builder's packet.
- **Builders survive the Mac sleeping:** on macOS acc keeps the machine awake
  (`caffeinate -i`) while an agent it started runs; the display still sleeps,
  and closing the lid still sleeps the Mac. Other platforms aren't kept awake.
  A builder that stops before `acc done` or `acc block`, as one did when the
  Mac slept anyway, shows as needs you with the last thing it said, and
  **Resume** (`acc resume <id>`) carries its session on in its worktree.
  Autopilot resumes one once by itself.
- **Notices in Slack:** away from VSCode, what needs you can come to a Slack
  channel or your own DM, by an incoming webhook kept in VSCode's secret
  storage on this machine. Set it up in the Settings section's **Notices in
  Slack**. It's off until you turn it on, sends each moment once
  however many windows are open, and sends only the task's id and title, what
  happened and a link.
- **Tasks that change the same files take turns, where they can:** before a
  task starts, acc compares the files its analysis plans to change with the
  work in flight. When it shares some, and another Ready task shares none, it
  waits, and its card says "Waits for GH-70's files: …". It starts on its own
  once those files are free, or once nothing else is ready. Files every task
  edits never count: `autopilot.appendOnly`, and `dispatch.shared` in
  `.acc/config.json`. `acc dispatch <id> --anyway` starts it now,
  `acc dispatch --held` starts whatever may go, and `--stop-waiting` ends a
  wait.
- **Next:** M8, the pilots. [ROADMAP.md](docs/ROADMAP.md) says what's done,
  what's under way and what waits on a person, each with its date and evidence.

## Install and first run

Agent Command Center is a VSCode extension, the `acc` command that comes with
it, and a Claude Code plugin. This takes a new machine from nothing to its first
project. [ONBOARDING.md](docs/ONBOARDING.md) has every step in detail.

### What you need

- **macOS**, on Apple Silicon or Intel. acc runs on no other platform.
- **VSCode.**
- **Claude Code**, the terminal CLI (`brew install --cask claude-code`), signed
  in to your Claude account.
- **A GitHub account**, and the GitHub CLI (`brew install gh`).
- **git 2.40 or later**, and **Homebrew**, which the walkthrough uses to
  install what's missing.
- **For Salesforce projects:** Node 20 or later, the Salesforce CLI and its
  Code Analyzer plugin.

acc itself needs no Node: with no node 20 or later on PATH, it runs on VSCode's
own runtime, which the extension records each time it starts. Salesforce
projects need Node for the Salesforce CLI.

### Getting access

This repo is private, and so are its releases and the plugin's marketplace,
which is this repo.

1. Ask for an invitation to the repo, and accept it with the GitHub account
   you'll use for it.
2. Sign gh in as that account: `gh auth login`.
3. Check that git can read the repo with your own credentials. Claude Code
   clones the plugin's marketplace this way:

   ```bash
   git ls-remote https://github.com/jack-huffman/agent-command-center
   ```

   If it asks for a password or says the repository isn't found, run
   `gh auth setup-git`. That changes your global git config: every repo on the
   machine then gets its github.com credentials from gh's active account,
   except a repo with its own credential helper (ONBOARDING.md, B2).

### Installing the extension

Each [release](https://github.com/jack-huffman/agent-command-center/releases)
has the extension as a `.vsix` file. Download the latest, as the account that
accepted the invitation, and install it:

```bash
gh release download -R github.com/jack-huffman/agent-command-center -p '*.vsix'
code --install-extension agent-command-center-*.vsix
```

A fresh VSCode doesn't put `code` on your PATH: run **Shell Command: Install
'code' command in PATH** from its Command Palette first, or, in VSCode:
Extensions view → **⋯** → **Install from VSIX…**, and pick the file. Then
reload the window (**Developer: Reload Window**). A newer release
installs the same way, over the old one.

### The first run

1. **This machine.** After the reload, nothing opens by itself. Click the
   Command Center's icon in the activity bar: the first time in a folder that
   isn't set up, it opens on **Setup**, at **This machine** while any of its
   steps are left. Its **Machine walkthrough** button, or **Agent Command
   Center: Set up this machine** in the Command Palette, opens the same steps
   as VSCode's walkthrough. Each step has
   **Check** and, for most, **Do it**, which runs the fix in a terminal or an
   output panel you can watch. A step ticks itself when its check passes. It
   covers the tools, GitHub, agents' billing, and the acc plugin in Claude
   Code (A4).
2. **The plugin.** A4's **Do it** installs it from this repo's marketplace, for
   every Claude Code session. Start a new Claude Code session afterwards:
   running ones don't load it. By hand:

   ```bash
   claude plugin marketplace add https://github.com/jack-huffman/agent-command-center
   claude plugin install acc@agent-command-center --scope user
   ```

   A private marketplace updates itself only when `GITHUB_TOKEN` is set, so
   after each release, update it by hand:
   `claude plugin marketplace update agent-command-center`, then
   `claude plugin update acc@agent-command-center --scope user`. Until you
   do, A4 fails on a plugin older than the extension, and its **Do it** runs
   both.
3. **A project.** Open the project's repo folder, and open the Command Center.
   The first time in a folder with no `.acc/config.json`, of any kind, it opens
   on **Setup** at **What kind of project is this?**. **Choose…** asks
   whether it's a Salesforce project, another kind, one from a team template
   or one from a Jira epic, and writes `.acc/config.json`: review it and
   commit it. After that first time, the Command Center opens where you left
   it. Setup's other steps set up the repo's GitHub account, branches, orgs
   and ticket source; its **Project walkthrough** button, or **Agent Command
   Center: Onboard this project**, opens them as VSCode's walkthrough.
4. **The Command Center.** Click its icon in the activity bar. **Setup** shows
   every step and what's left, and `acc doctor` in any VSCode terminal runs the
   same checks.

### What acc changes on your machine

- **VSCode:** every terminal gets `acc` on its PATH, from the extension's own
  copy. Tracker sign-ins and the Slack webhook, if you add them, are kept in
  VSCode's secret storage.
- **`~/.acc/`:** `runtime`, the path of VSCode's runtime for the launcher;
  `questions/`, agents' questions waiting for the Command Center; `heavy/`, the
  slot heavy checks take turns on; `machine.json`, this machine's heavy-check
  slots; `repos.json`, the repos acc knows on this machine; and `slack/sent/`,
  which notices went to Slack.
- **Claude Code:** the acc plugin, at user scope, with its marketplace's clone
  under `~/.claude/plugins/`. Its hooks run in every Claude Code session, and
  do nothing in a repo without `.acc/config.json`. Each project's main checkout
  is trusted once (B12).
- **gh:** a login for each account you sign in with through **Do it**. gh's
  active account is put back as it was.
- **The Mac:** while an agent acc started runs, `caffeinate -i` keeps the Mac
  from sleeping; the display still sleeps.
- **In each project's repo:** `.acc/config.json`, which you commit; acc's
  ledger in the git directory (`.git/acc/`), never in a commit; task worktrees
  in `.claude/worktrees/`; `node_modules` in the repo's `info/exclude`; the
  repo's own commit identity and credential helper in its git config (B2); and
  what each setup step's **Do it** writes when you run it, such as `.gitignore`
  lines, the environment branches and the README's environments table.

## Principles

- **Self-contained.** The project ships its own skills, hooks and agents as one
  Claude Code plugin, and works with no other skills installed. It borrows ideas
  from other tools, not dependencies.
- **Claude Code is the engine.** Agents run as Claude Code background sessions
  (`claude --bg`), and status comes from `claude agents --json` and hooks. This
  project does not write an agent runtime.
- **One ledger per repo, one writer.** Task state lives in a JSON file in the
  repo. Only the CLI changes it, with atomic writes. The extension and the skills
  read it.
- **Profiles, not special cases.** Checks such as lint, tests and deploy
  validation are declared per project type. `generic` and `salesforce` come
  first.
- **Humans keep the gates.** Nothing merges, deploys, closes a ticket or changes
  a ticket's status unless you ask. You can, from the board and the ticket
  pages. acc never does it on its own, with one opt-in: a repo can turn on
  auto-merge (`acc agents auto-merge on`), and autopilot then merges a reviewed
  pull request whose checks passed, with nothing waiting on you, into an
  environment that isn't protected. It's off by default, and a Salesforce
  project can't turn it on.
- **One merge at a time.** With auto-merge on, passing pull requests line up in
  a merge queue, shown on the Overview. At its turn, each has its base merged
  in, runs the full check once, and merges; one that conflicts or fails goes
  back to its builder. Builders can then run lighter checks (`gates.builder`),
  such as the tests near what they changed.
- **Light on the machine.** A cap on concurrent builders for each project,
  default 3, and, if you set one, a total for this machine across every repo,
  since usage limits are your Claude account's. Heavy checks take turns in this
  machine's slots. **Settings → Limits and checks** raises or lowers each, and
  says what a change means in this machine's own numbers.
- **Readable without colour.** Every state has an icon and a label. Where colour
  helps, it is orange against blue, never red against green. Tests check both,
  and that every colour comes from the theme.

## Layout

```text
packages/core   ledger, config and state rules, shared by everything below
packages/cli    the acc CLI: its launcher (bin/acc) and the bundle it runs, built into dist/,
                and into plugin/bin/ for a release
plugin/         Claude Code plugin: skills, hooks, reviewer agent, bin/acc and bin/acc.mjs
extension/      VSCode extension: the Command Center page
docs/           design, roadmap, decisions, research
```

## Trackers

Each repo lists its own trackers in `.acc/config.json`, and signs in to them on
its own. One machine can work across clients with different Jira sites, Azure
DevOps organizations, GitHub repos and pipelines, and no client's login serves
another's repo. GitHub Issues, Jira Cloud, Azure DevOps, monday.com and Slack. Set
one up on the Command Center's **Connect page**: Connect
Jira on the Tasks tab, Add a tracker on the Overview, or **Add a tracker…** from
the Command Palette. It signs in, tests the connection, and lists the projects,
places and boards to pick from, and acc writes the tracker to `.acc/config.json`
for you to commit. The Command Center's **Settings** lists every open project's
trackers under **Trackers and sign-ins**, with who each signs in as, and signs
each in again, signs it out, or changes its place. See [ONBOARDING.md, B14](docs/ONBOARDING.md#b14-connect-the-ticket-source).

Each tracker names its place: the project, repo, monday.com board or Slack
channel, and when
set, a Jira epic, GitHub labels, an Azure DevOps area path or a monday.com
group. Boards, ticket pages and intake see only tickets in that place, so
another project's or client's never show up.

## Settings

The extension has four settings, under **Agent Command Center** in VSCode's
Settings.

- `agentCommandCenter.openFromActivityBar` (on by default): clicking the Command Center's icon
  in the activity bar opens its page and tucks the sidebar away. Off, the
  sidebar keeps a short list of sections instead.
- `agentCommandCenter.notifications` (on by default): say when a task changes in a way that
  needs you or is news, such as a builder finishing, a review's verdict, or a
  pull request's checks failing or its merge. It's quiet while the Command
  Center shows that board. Notices to Slack have their own switch, in the
  Settings section's **Notices in Slack**.
- `agentCommandCenter.theme`: how the Command Center's pages look: `vscode`
  (Match VSCode, the default), `light` or `dark`. It changes only acc's own
  pages; VSCode keeps its theme. It's kept on this machine, and set from
  **Appearance** in the Command Center's Settings section.
- `agentCommandCenter.refreshPace`: how often the Command Center refreshes
  while it's on screen: `normal` (the default), `relaxed` (each interval twice
  as long) or `slow` (four times). While it's hidden it refreshes as it always
  does, and agents' questions and autopilot aren't slowed. It's kept on this
  machine, and set from **The Command Center** in the Settings section.

Two more choices there are this window's own, kept by VSCode for the window:
the section the Command Center opens on (where you left it, or one you name),
and whether Agents' Where column shows each session's folder or its full path.

Each project's own settings are in its `.acc/config.json`.
[DESIGN.md section 4](docs/DESIGN.md#4-config) says what each key does, and
acc warns about a key it doesn't know.

## Development

Development needs Node 23.6 or later, which runs the TypeScript directly. The
built acc doesn't: it runs on node 20 or later, or on VSCode's runtime.

```bash
npm install              # dev dependencies: typescript, esbuild, @types/node
npm run check            # type-check, build, run the tests
npm run acc -- doctor    # run the CLI from source
./dist/acc doctor        # run the bundle the last build made
npm run validate-plugin  # claude plugin validate --strict, on the plugin and the marketplace
npm run screenshot       # render the editor tabs with sample data, into dist/screenshots/, and check their geometry
npm run set-version -- 0.36.0  # the one way to change the version, everywhere it's written
npm run package          # check, package the extension into dist/, scan it for personal data, refresh plugin/bin/
npm run release          # on main, in a terminal: a GitHub Release with the .vsix and its CHANGELOG entry
```

To try a change in your own VSCode, `npm run package && npm run install-extension`,
then reload the window. Packaging also refreshes `plugin/bin/`; on a branch,
leave that out of your commits. To work on the plugin, load it in place for one
session from the repo root: `claude --plugin-dir plugin`. If the plugin is also
installed from the marketplace (A4), that session may run both copies' hooks;
`claude plugin disable acc@agent-command-center` turns the installed one off
until you `enable` it again.

`npm run build` bundles the CLI into `dist/acc.mjs`, which git ignores, puts the
launcher `dist/acc` beside it, and gives the extension its own copy of both.
The launcher is a small sh script that runs `acc.mjs` with `$ACC_NODE` if set,
else node 20 or later on PATH, else the VSCode runtime named in
`~/.acc/runtime`. With none, `acc hook …` exits 0 silently, so the plugin's
hooks never break a session, and anything else says what to do in one line.

`plugin/bin/` is committed, because a plugin installed from git has no build
step, but only `npm run package` refreshes it, copying the launcher and
`acc.mjs` together once the package has passed its checks. A branch's checks
never change it, so pull requests don't conflict over a generated file (D-042).

acc, the extension and the plugin share one version, the root package.json's,
and `CHANGELOG.md` says what changed in each. `npm run package` refuses a
version with no CHANGELOG entry, and a package holding the packager's personal
data: a home path, their email or GitHub account, or a tracker they've signed
in to. Each find is listed by file and line. A release goes: set the version
and write its entry on a branch; after the merge, `npm run package` on main,
commit plugin/bin and push; then `npm run release` (D-079).

`npm run screenshot` renders each tab in headless Chrome, in dark and light
themes, at 1000, 620 and 500 pixels wide, with one row shown hovered. Chrome
lays out no narrower than 500, so a narrower `--width` is refused. Name tabs to
shoot only those (`npm run screenshot -- agents worktrees`), or pass `--width`,
`--theme`, `--height` and `--out`. It renders the built webview, so run
`npm run build` after a change. Set `CHROME` if Chrome isn't found. It draws
three pages at once, each in its own Chrome under `nice`; `--jobs N` changes
how many, and `--jobs 1` draws one at a time. The log and the shots are the
same either way.

Each shot also measures itself, and the run exits 1, naming the page, theme,
width and element, when two controls overlap, a label is cut off, the selected
tab is out of the rail's view, a sticky cell covers another cell's text,
something scrolls sideways that shouldn't, or axe-core finds a WCAG 2.1 AA
violation that `A11Y_EXCEPTIONS` (`extension/scripts/a11y.ts`) doesn't excuse.
It prints how many elements each check examined, and axe's incomplete results by
rule; a page with none examined fails. The shots
are written either way, and still need reading.

Run builds and tests one at a time, under `nice -n 15`.
