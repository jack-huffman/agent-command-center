---
name: task
description: Look after acc's tasks by hand: add one, show it, list what's ready, record that it depends on another, or move it. Use when someone asks about a task's state or wants to change it.
---

# Tasks in acc

Every change goes through `acc`, so its rules hold wherever the change comes from.

| To | Run |
|---|---|
| Add a task | `acc add "<title>" --brief "<what done looks like>" [--dep <id>] [--env <branch>]` |
| See one | `acc show <id>`: its state, instructions, run and history |
| List them | `acc list [--state <state>]`, or `acc ready` for what an agent can start |
| Move one | `acc set <id> <state> --reason "<why>"` |

States: `todo`, `running`, `review`, `rework`, `blocked`, `done`. "Ready" and "needs you" are worked out, not set.

- **Moves follow rules.** For example, review needs the required checks settled on the task's latest commit, and blocking needs a reason. When acc refuses, it says why. A person can override with `--force --reason`, which is recorded.
- **A builder** only ever runs `acc done` when it's finished, or `acc block "<what you need>"` when it's stuck.
- **Checks:** `acc gate run` in a worktree runs the required checks on its commit. `acc gate list --task <id>` shows them. A person can set one aside with `acc gate waive <gate> --task <id> --reason "<why>"`.
