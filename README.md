# Agent Command Center

A VSCode command center for running Claude Code agents in parallel. It pulls
tickets from your trackers, gives each one its own git worktree and agent, runs
the project's checks, opens the pull request, and shows all of it in one panel.

It is built for Salesforce work first, but the core assumes nothing about
Salesforce. Project types plug in as profiles.

**Status:**

- **M1 done:** the task ledger, the config, and onboarding checks (`acc doctor`).
- **M2 done:** setup walkthroughs, plus a sidebar and editor tabs for tasks,
  agents, worktrees, environments and setup.
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
  assignee and labels, plus acc's agent, checks and history.
- **Who you're working as:** the status bar shows the repo's GitHub account,
  and you can switch it for your clone alone. git push follows the switch, and
  boards and comments say who they act as.
- **Next:** M5, review and landing.

Install the extension with `npm run package && npm run install-extension`, then
reload the VSCode window.

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
packages/cli    the acc CLI, bundled into plugin/bin/acc
plugin/         Claude Code plugin: skills, hooks, reviewer agent, bin/acc
extension/      VSCode extension: Board, Sessions and Worktrees views
docs/           design, roadmap, decisions, research
```

## Trackers

Each repo lists its own trackers in `.acc/config.json`, and signs in to them on
its own. One machine can work across clients with different Jira sites, Azure
DevOps organizations, GitHub repos and pipelines, and no client's login serves
another's repo. GitHub Issues, Jira Cloud and Azure DevOps today; monday.com and
Slack come later. Set one up with **Add a tracker…** from the Command Palette.
See [ONBOARDING.md, A3](docs/ONBOARDING.md).

## Development

Development needs Node 23.6 or later, which runs the TypeScript directly. The
bundled CLI in `plugin/bin/acc` runs on Node 20 or later.

```bash
npm install            # dev dependencies: typescript, esbuild, @types/node
npm run check          # type-check, run the tests, rebuild plugin/bin/acc
npm run acc -- doctor  # run the CLI from source
./plugin/bin/acc doctor
npm run screenshot     # render the editor tabs with sample data, into dist/screenshots/
```

`npm run screenshot` renders each tab in headless Chrome, in dark and light
themes, at 1000, 620 and 480 pixels wide, with one row shown hovered. Name tabs
to shoot only those (`npm run screenshot -- agents worktrees`), or pass
`--width`, `--theme`, `--height` and `--out`. It renders the built webview, so
run `npm run build` after a change. Set `CHROME` if Chrome isn't found.

`plugin/bin/acc` is committed, because a plugin has no build step. Rebuild it
with `npm run build` whenever the CLI changes. Run builds and tests one at a
time, under `nice -n 15`.
