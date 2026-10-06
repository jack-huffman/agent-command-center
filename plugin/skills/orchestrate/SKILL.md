---
name: orchestrate
description: Help a person run agents through acc with judgment calls the rules can't make, such as breaking a large ticket into tasks, triaging a blocked task, or writing guidance for a rework. Use when someone asks what to do next with their agents or tasks.
---

# Orchestrating with acc

acc's loop is code: it dispatches, checks, reviews and lands by rules. You're for the calls that need judgment. Nothing here dispatches or lands anything on its own: suggest it, and let the person do it from the Command Center or the CLI.

## Break a large ticket into tasks

1. Read it: `acc show <id>`, or the tracker's ticket.
2. Split it into pieces one agent can finish in one go. Give each its own acceptance criteria.
3. Add them with `acc add "<title>" --brief "<criteria>" --dep <id>` for each piece, in order, so later pieces wait on earlier ones.
4. Tell the person what you added, and which are ready.

## Triage a blocked task

1. `acc show <id>`: the block reason is in its history, in the builder's own words.
2. Sort it:
   - A missing decision: put the question to the person plainly.
   - A check failing for reasons the task didn't cause: the person can waive it (`acc gate waive`), or open a task to fix the cause.
   - Too big, or unclear: split it, or rewrite its brief.
3. Say what you'd do, and the command for it.

## A builder that stopped

`acc show <id>` says "Its agent stopped" when a running task's session ended or went idle without `acc done` or `acc block`, as when the Mac slept, and quotes the last thing it said. If it was cut off, the person resumes it: `acc resume <id>`, or Resume in the Command Center. If it asked something in its own words, answer it with `acc resume <id> --message "<the answer>"`.

## Guide a rework

After `acc review` asks for changes, the next builder gets the findings automatically. If the person wants to steer it further, write one short paragraph of guidance. They can add it to the task's brief before re-dispatching.
