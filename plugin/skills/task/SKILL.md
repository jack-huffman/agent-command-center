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
- **A builder** only ever runs `acc done` when it's finished, with its note on one line: `acc done --landed "<what landed>" --moved "<tests, checks, ratchets that moved>" --open "<what's still open, or none>"` (a flag again adds a line; `none` says there was nothing). The reviewer, the next builder and the pull request read it, and acc refuses `acc done` without it. When it's stuck, it runs `acc block "<what you need>"`, with the same flags if part of the work landed. When only the client can answer (a business rule, missing access, or a choice that's theirs), it runs `acc block --client "<the question, in plain words>"`: that also drafts an update for the ticket, which a person reads, edits and posts. A plain block stays internal.
- **A note to a person is a headline and a bullet per thing**, never a paragraph: `acc block "<headline: one short sentence>" --item "<first thing>" --item "<next thing>"`. A question's options go in its item as a) b) c), at most three, with (recommended) on the one it would pick. acc refuses an agent's block that is one long paragraph, and says how to split it. Name each API name exactly (a custom field or object, a developer name, a path, a branch, a command): acc puts it in backticks as it records the note, so inside double quotes leave the backticks out, which the shell would run.
- **Ticket updates** are drafts, never posted by acc: `acc updates` lists them, and a person posts each from the Command Center (or `acc update post <id>` for a GitHub issue) or discards it with `acc update discard <id>`.
- **Checks:** `acc gate run` in a worktree runs the required checks on its commit. `acc gate list --task <id>` shows them. A person can set one aside with `acc gate waive <gate> --task <id> --reason "<why>"`.
