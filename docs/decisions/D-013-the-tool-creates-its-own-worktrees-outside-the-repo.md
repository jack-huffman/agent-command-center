## D-013 The tool creates its own worktrees, outside the repo (2026-10-01)

A task branches from its target (`sandbox`, `main` and so on), which
`claude --worktree` can't do. A sibling folder keeps duplicate source trees out
of VSCode search and Salesforce tooling. Claude Code's cleanup sweep doesn't
touch worktrees it didn't create, so cleanup belongs to `acc`, which refuses to
delete uncommitted or unmerged work.
