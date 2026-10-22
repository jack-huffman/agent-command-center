## D-001 Build a thin layer over Claude Code, don't adopt an orchestrator (2026-10-01)

Claude Code already runs agents in isolated worktrees, keeps a registry of live
sessions, and exposes hooks. What is missing is one view in VSCode and intake
from issue trackers. Standalone tools either live outside VSCode, don't write
back to trackers, or bring a heavy stack.

A review on 1 October 2026 (kept locally, D-098) looked at Gas City, Emdash,
Conductor, Superset, Vibe Kanban, the terminal session monitors and the small
VSCode extensions:
- Gas City was worth borrowing ideas from, not adopting. It needs tmux, a Dolt
  SQL server and a supervisor, runs Claude with permission checks skipped by
  default, and has no Jira or VSCode support.
- None of the others had all three of: a capable view inside VSCode, progress
  written back to the ticket, and Salesforce awareness.
