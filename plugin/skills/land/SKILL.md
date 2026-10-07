---
name: land
description: Take a finished task from review to an open pull request, and follow it until it merges. Use when someone asks to review, land, ship or open a pull request for an acc task.
---

# Land a task

A task lands from review. A person merges it, on GitHub. The one exception is a repo that turns auto-merge on (`acc agents auto-merge` says whether it is): there a reviewed pull request whose checks pass, with nothing waiting on a person, joins the repo's merge queue, and autopilot merges them one at a time. At its turn, its base is merged in, the full check runs once, and it merges, or goes back to its builder if it conflicts or fails. Never into a protected environment. `acc show <id>` says its place in the queue. Never merge one yourself.

1. **Review it:** `acc review <id>`. A fresh, read-only agent judges the branch's latest commit. On **changes**, the task goes to rework, and the next builder is told what to fix: re-dispatch it with `acc dispatch <id>`. On **pass**, it stays in review, ready to land.
2. **Land it:** `acc land <id>`. It needs the checks settled and a passing review on the latest commit. It pushes the branch as the repo's own GitHub account and opens the pull request into the environment's branch. The description holds the review's summary, the acceptance criteria and the checks. Landing again after a rework updates the same pull request. If the pull request conflicts with its base, acc says so and names the files.
3. **The ticket hears from a person.** acc drafts an update for the ticket (the pull request's link and a plain sentence for the client) and posts nothing. `acc land --json` names it under `update`, and `acc updates` lists every draft. Don't post it yourself, with a connector or otherwise: a person reads, edits and posts it from the Command Center, or with `acc update post <id>` for a GitHub issue.
4. **Follow it:** `acc sync`. A merged pull request makes its task done, with a draft update saying so, and a closed one blocks it with the reason. Failing checks, a person asking for changes, or a conflict with its base show it as needing you.

Salesforce work then moves on with `acc promote <env>`, a pull request to the next environment, and `acc deploy <env>` after it merges. A person runs both.
