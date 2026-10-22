## D-020 The sidebar comes before dispatch (2026-10-01)

After M2, a fully set-up project showed almost nothing in VSCode: the
walkthrough had no steps left, and the panels were planned for M7. The user
needs to work with repos, agents, tickets and worktrees from a GUI now. So an
Activity Bar container with five views (Tasks, Agents, Worktrees, Environments,
Setup) shipped right after M2, built on everything that already works:

- `acc` for tasks, plus a new `acc intake github`
- `claude agents --json` for agents
- git for worktrees and branches

Each later milestone adds to these views, instead of introducing the GUI at M7.
M7 keeps the board webview, notifications and the richer agent controls.
