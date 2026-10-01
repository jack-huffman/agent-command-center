# Roadmap

Each phase ends with something that works and has been checked. Later phases can
change once earlier ones show what is actually needed.

## Phase 1: Design

Write `docs/DESIGN.md` and review it before building anything:

- the ledger schema (task fields, states, legal transitions, history)
- the per-repo config file (trackers, trunk branch, profile, checks, agent cap,
  GitHub account and commit identity)
- profiles: what `generic` and `salesforce` run at each gate
- the dispatch packet: what a new agent is told about its task
- the hooks: which events, what each one guards or records
- where the extension gets each piece of data

## Phase 2: Ledger and CLI (`acc`)

- `init`, `add`, `ready`, `set`, `status --json`, `render`
- dependency and transition checks, atomic writes, recorded history
- unit tests for every transition rule

## Phase 3: Plugin

- **intake:** pull tickets from GitHub Issues and Jira into the ledger
- **dispatch:** start an agent on a ready task in its own worktree
- **gates:** run the profile's checks and record a receipt
- **review:** a fresh reviewer agent that checks one task's diff
- **land:** open the pull request and comment the link on the ticket
- **hooks:** keep edits inside task worktrees, and report agent status to the ledger

## Phase 4: VSCode extension v1

- **Agents view:** every running Claude Code session, with its folder, branch and
  busy or idle state, plus a notification when one finishes or needs you
- **Worktrees view:** branch, uncommitted changes, linked pull request, CI status
  and receipt
- **Board:** tasks in columns by state, with ready tasks flagged
- **Actions:** Dispatch, Review, Open PR, Clean up (refuses unmerged or dirty worktrees)
- status bar summary and the concurrent-agent cap

## Phase 5: Salesforce pilot

Run real tickets end to end on a small Salesforce project, and fix what breaks.

## Later

- monday.com intake, Slack notifications
- a pull request monitor that turns failing CI or conflicts into rework tasks
- a merge queue
- cloud sessions
- packaging for other people to install
