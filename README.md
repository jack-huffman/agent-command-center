# Agent Command Center

A VSCode command center for running Claude Code agents in parallel. It pulls
tickets from your trackers, gives each one its own git worktree and agent, runs
the project's checks, opens the pull request, and shows all of it in one panel.

It is built for Salesforce work first, but the core assumes nothing about
Salesforce. Project types plug in as profiles.

**Status:** design draft in review. See [docs/DESIGN.md](docs/DESIGN.md) for how
it works, [docs/ROADMAP.md](docs/ROADMAP.md) for the build order, and
[docs/DECISIONS.md](docs/DECISIONS.md) for what has been decided and why.
[docs/ONBOARDING.md](docs/ONBOARDING.md) lists every setup step, for the machine
and for each project.

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
  a ticket's status unless you ask. Trackers get a comment with the pull request
  link and nothing else.
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

GitHub Issues and Jira first. monday.com and Slack come later.
