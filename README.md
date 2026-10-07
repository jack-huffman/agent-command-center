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
  ticket. Click one for a ticket page, with the description, comments, status,
  assignee and labels, plus acc's agent, checks and history. Status, assignee
  and labels change from there only when the tracker says `"edits": true`.
- **Ticket updates are yours to post:** acc never posts on a ticket. When a pull
  request is ready for review, merges, or deploys, or a builder needs the
  client's answer, acc drafts an update in plain words. It waits in Needs you
  and on the task's page, where you edit it and post it as yourself, or discard
  it. `acc updates` lists them.
- **Who you're working as:** the status bar shows the repo's GitHub account,
  and you can switch it for your clone alone. git push follows the switch, and
  boards and comments say who they act as.
- **No terminal hunting:** agents' permission prompts and questions arrive as
  cards on the Overview, to allow, deny or answer in place. **Watch** shows an
  agent's work as it happens: what it said, each command and its result. Setup's
  commands run in an output panel on the page, which answers their prompts.
- **M5, under way:** `acc review` has a read-only agent judge each commit's
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
  fallback, for this clone or the whole project, changed from the Agents
  section.
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
  storage on this machine. Set it up on the Environments section's **Notices
  in Slack** card. It's off until you turn it on, sends each moment once
  however many windows are open, and sends only the task's id and title, what
  happened and a link.
- **Next:** M8, the pilots.

Install the extension with `npm run package && npm run install-extension`, then
reload the VSCode window.

**Requirements:** macOS only, on Apple Silicon or Intel. acc needs no Node
install: with no node 20 or later on PATH, it runs on VSCode's own runtime, which
the extension records each time it starts. Salesforce projects still need Node,
for the Salesforce CLI.

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
  pages. acc never does it on its own.
- **Light on the machine.** A cap on concurrent agents, default 3.
- **Readable without colour.** Every state has an icon and a label. Where colour
  helps, it is orange against blue, never red against green.

## Planned layout

```text
packages/core   ledger, config and state rules, shared by everything below
packages/cli    the acc CLI: its launcher (bin/acc) and the bundle it runs, built into dist/,
                and into plugin/bin/ for a release
plugin/         Claude Code plugin: skills, hooks, reviewer agent, bin/acc and bin/acc.mjs
extension/      VSCode extension: Board, Sessions and Worktrees views
docs/           design, roadmap, decisions, research
```

## Trackers

Each repo lists its own trackers in `.acc/config.json`, and signs in to them on
its own. One machine can work across clients with different Jira sites, Azure
DevOps organizations, GitHub repos and pipelines, and no client's login serves
another's repo. GitHub Issues, Jira Cloud, Azure DevOps and monday.com. Set
one up on the Command Center's **Connect page**: Connect
Jira on the Tasks tab, Add a tracker on the Overview, or **Add a tracker…** from
the Command Palette. It signs in, tests the connection, and lists the projects,
places and boards to pick from. See [ONBOARDING.md, B14](docs/ONBOARDING.md#b14-connect-the-ticket-source).

Each tracker names its place: the project, repo or monday.com board, and when
set, a Jira epic, GitHub labels, an Azure DevOps area path or a monday.com
group. Boards, ticket pages and intake see only tickets in that place, so
another project's or client's never show up.

## Install the plugin

The plugin adds acc's skills, the reviewer agent and the hooks that keep
builders in their worktree. This repo is its marketplace, named
`agent-command-center`:

```bash
claude plugin marketplace add jack-huffman/agent-command-center  # or the path to a clone
claude plugin install acc@agent-command-center
```

To work on the plugin, load it in place for one session instead, from the repo
root: `claude --plugin-dir plugin`.

## Development

Development needs Node 23.6 or later, which runs the TypeScript directly. The
built acc doesn't: it runs on node 20 or later, or on VSCode's runtime.

```bash
npm install              # dev dependencies: typescript, esbuild, @types/node
npm run check            # type-check, build, run the tests
npm run acc -- doctor    # run the CLI from source
./dist/acc doctor        # run the bundle the last build made
npm run validate-plugin  # claude plugin validate --strict, on the plugin and the marketplace
npm run screenshot       # render the editor tabs with sample data, into dist/screenshots/
npm run package          # a release: check, refresh plugin/bin/, package the extension into dist/
```

`npm run build` bundles the CLI into `dist/acc.mjs`, which git ignores, puts the
launcher `dist/acc` beside it, and gives the extension its own copy of both.
The launcher is a small sh script that runs `acc.mjs` with `$ACC_NODE` if set,
else node 20 or later on PATH, else the VSCode runtime named in
`~/.acc/runtime`. With none, `acc hook …` exits 0 silently, so the plugin's
hooks never break a session, and anything else says what to do in one line.

`plugin/bin/` is committed, because a plugin installed from git has no build
step, but only a release refreshes it, copying the launcher and `acc.mjs`
together: `npm run package`, or `npm run build -- --release` on its own. A
branch's checks never change it, so pull requests don't conflict over a
generated file (D-042).

`npm run screenshot` renders each tab in headless Chrome, in dark and light
themes, at 1000, 620 and 500 pixels wide, with one row shown hovered. Chrome
lays out no narrower than 500, so a narrower `--width` is refused. Name tabs to
shoot only those (`npm run screenshot -- agents worktrees`), or pass `--width`,
`--theme`, `--height` and `--out`. It renders the built webview, so run
`npm run build` after a change. Set `CHROME` if Chrome isn't found.

Run builds and tests one at a time, under `nice -n 15`.
