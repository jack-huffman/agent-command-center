## D-022 Task worktrees live in .claude/worktrees/, and agents enter them from the trusted main checkout (2026-10-01)

This supersedes D-013's location; the rest of D-013 stands. Tasks still branch
from their environment's branch, and `acc` alone cleans worktrees up.

**Why.** The first real dispatch failed: Claude Code won't start `claude --bg`
in a folder you haven't trusted. Reading the installed CLI's trust check showed
it climbs parent folders only up to the git root. Each worktree has its own
`.git`, so it's its own root, and trusting a parent doesn't cover it. Writing
trust into Claude Code's state file would race with running sessions, which
rewrite it, so we don't do that.

**What changes:**

- Worktrees go in the repo's `.claude/worktrees/<id>`. That folder is already
  git-ignored there, and VSCode search skips it.
- The background agent starts in the main checkout, which you trust once
  (step B12).
- The agent's first instruction is to call EnterWorktree on its worktree. That
  needs no approval inside `.claude/worktrees/`.
- Once it's in, Claude Code itself blocks edits and git commands aimed at the
  main checkout. That's stronger isolation than instructions alone.

Dispatch checks trust before touching anything. A linked `node_modules` is
added to the repo's shared exclude, so worktrees start clean.
