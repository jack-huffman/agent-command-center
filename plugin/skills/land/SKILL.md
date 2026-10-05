---
name: land
description: Take a finished task from review to an open pull request, and follow it until it merges. Use when someone asks to review, land, ship or open a pull request for an acc task.
---

# Land a task

A task lands from review. acc never merges: a person does, on GitHub.

1. **Review it:** `acc review <id>`. A fresh, read-only agent judges the branch's latest commit. On **changes**, the task goes to rework, and the next builder is told what to fix: re-dispatch it with `acc dispatch <id>`. On **pass**, it stays in review, ready to land.
2. **Land it:** `acc land <id>`. It needs the checks settled and a passing review on the latest commit. It pushes the branch as the repo's own GitHub account and opens the pull request into the environment's branch. The description holds the review's summary, the acceptance criteria and the checks. Landing again after a rework updates the same pull request. If the pull request conflicts with its base, acc says so and names the files.
3. **Tell the ticket.** acc comments on a GitHub issue itself. For Jira or Azure DevOps, `acc land --json` returns the comment under `comment`. Post it with the tracker's connector if you have one; the Command Center posts it as you.
4. **Follow it:** `acc sync`. A merged pull request makes its task done, and a closed one blocks it with the reason. Failing checks, a person asking for changes, or a conflict with its base show it as needing you.

Salesforce work then moves on with `acc promote <env>`, a pull request to the next environment, and `acc deploy <env>` after it merges. A person runs both.
