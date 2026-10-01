# Landscape review, 1 October 2026

What already exists for running many coding agents in parallel, and what to
borrow. Release dates and activity were checked on this date.

## Claude Code (the engine)

Checked against version 2.1.287:

- **Worktrees.** `claude -w/--worktree [name]` starts a session in a new git
  worktree under `.claude/worktrees/`. `--tmux` puts each session in its own pane
  and needs tmux or iTerm2. Subagents can run with `isolation: "worktree"`.
  <https://code.claude.com/docs/en/worktrees.md>
- **Background agents.** `claude agents` manages background agents.
  <https://code.claude.com/docs/en/agent-view>
- **Live session registry.** `~/.claude/sessions/<pid>.json` holds each running
  session's `sessionId`, `cwd`, `name`, `status` (for example `idle`),
  `entrypoint` (`claude-vscode` or the CLI), `messagingSocketPath` and
  `updatedAt`. This is how the extension can list agents without any extra
  plumbing. The format is **undocumented**, so the reader must tolerate change.
- **Transcripts.** `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`.
- **Cross-session messaging.** `ListAgents` and `SendMessage` work between local
  sessions. <https://code.claude.com/docs/en/cross-session-messaging.md>
- **Hooks.** These include SessionStart, PreToolUse and PostToolUse,
  SubagentStart and SubagentStop, Stop, and WorktreeCreate.
  <https://code.claude.com/docs/en/hooks.md>
- **Plugins.** Skills, hooks, agents and MCP servers ship as one installable
  plugin through a marketplace in a GitHub repo.
  <https://code.claude.com/docs/en/plugins.md>
- **Workflows.** Scripted fan-out across many subagents, for batch work.
  <https://code.claude.com/docs/en/workflows.md>
- **Agent SDK (TypeScript).** `query()` with `cwd` runs a headless agent and
  streams its messages. Use it if the extension ever needs to run agents itself.
  <https://code.claude.com/docs/en/agent-sdk/typescript.md>

## Gas City

Gas City is Gas Town rebuilt as an SDK. It is from Gas City, Inc., with Steve
Yegge as advisor. It is MIT-licensed. v1.4.2 shipped on 18 Sep 2026, and 576
PRs were merged in September.

- <https://github.com/gastownhall/gascity>
- <https://docs.gascity.com/getting-started/how-gas-city-works>

**Verdict:** borrow ideas, don't adopt.

- It needs tmux, a Dolt SQL server, beads and a launchd supervisor.
- Its Claude default is `--dangerously-skip-permissions`.
- It has no Jira, monday.com or VSCode support.

**Worth borrowing:**

- work items with `needs` edges and a "ready" query
- step graphs with script-checked gates and bounded retries
- one worktree per task, with cleanup that refuses dirty or unmerged trees
- a pull request monitor that turns failing CI or conflicts into repair tasks
- a merge queue
- a pool cap on concurrent agents
- a typed local API that a UI can sit on

## Standalone tools

| Tool | Form | Trackers | Verdict |
|---|---|---|---|
| [Emdash](https://github.com/generalaction/emdash) | Desktop app, Apache-2.0 | GitHub, Jira, monday.com and more. Pulls tickets in, never writes back | Closest off-the-shelf match. Useful as a UX benchmark |
| [Conductor](https://www.conductor.build) | Mac app | GitHub Issues, Linear | Most polished. No Jira or monday.com |
| [Superset](https://github.com/superset-sh/superset) | Mac app | GitHub, Linear | Active. No Jira or monday.com |
| [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) | Local web UI | GitHub | Good board design. Company shut down April 2026 |
| [Nimbalyst](https://github.com/nimbalyst/nimbalyst) | Desktop app | Internal board only | No tracker intake |
| Claude Squad, Agent Deck, Agent of Empires, ccmanager | TUIs | None or webhooks | Session monitors, no task board |
| VSCode Agent Sessions view | Built into VSCode | GitHub via Copilot | Runs VSCode's own Claude harness, not Claude Code sessions |
| Small VSCode extensions (Claudine, Agntree, Claude Tower, Grove) | Extensions | None | All under 300 installs |

**Gaps no tool fills:**

- a capable view inside VSCode
- writing progress back to the ticket
- Salesforce awareness: deploy validation, Apex tests, and org-per-worktree

## Internal prior art

A colleague's skill set showed some patterns worth keeping, which this project
reimplements rather than calls:

- a dependency-graph ledger that only its CLI may write to
- a fresh, read-only reviewer that checks one commit against pinned rules
- hooks that allow edits only inside a worktree
- a validation receipt that must exist before a pull request can be opened
- ticket references required in commit messages, with closing keywords blocked
- everything inert in a repo that hasn't opted in
