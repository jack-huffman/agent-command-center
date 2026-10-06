---
name: intake
description: Bring tickets into acc's task ledger, from GitHub issues, Jira or Azure DevOps, so agents can be dispatched to them. Use when someone asks to import, pull in or track tickets.
---

# Bring tickets into acc

acc keeps its own ledger of tasks beside the tracker. Bringing a ticket in never changes the ticket.

## GitHub issues

Run `acc intake github` in the repo. It reads the open issues in the repo's place, as the repo's own GitHub account, and adds or refreshes a task for each (`GH-<number>`). The place is the GitHub tracker's `repo` in `.acc/config.json` (the project's own repo by default) and, when it names `labels`, only issues with one of them. Add `--label <label>` to take only some.

It also follows issues that left the open list. A task whose issue was closed moves to done, and issues with a label in the GitHub tracker's `skipLabels` (such as `milestone`) aren't tasks: one already imported leaves the ledger. So does one whose issue left the place: it lost its labels, or moved to another repo. A task that already started stays as it is, and the output names it for a person to decide.

## Jira or Azure DevOps

The VSCode Command Center shows each tracker's board, with **Track** on every card acc doesn't keep yet (except in a done column), and **Track in acc** on every ticket's page. That's the easy way, and it shows only tickets in the repo's place.

From a session, first read the tracker's place from `.acc/config.json`, and ask the connector for tickets in it only. Another project's or another client's tickets must never come in:

- **Jira:** the tracker's `project`, and its `epic` when it names one. Search with `project = "ACME"`, plus `AND parent = ACME-3` for the epic's tickets. Their sub-tasks count too (`parent in (<those keys>)`); the epic itself doesn't.
- **Azure DevOps:** the tracker's `project`, and its `areaPath` when it names one: `[System.TeamProject] = 'CRM' AND [System.AreaPath] UNDER 'CRM\Billing'`.

`acc import` refuses a Jira or Azure DevOps key that no tracker in the config owns, such as OPS-1 when the only Jira tracker is ACME. It can't check an epic or area path without a sign-in, so keep the query to the place: the Command Center's board removes any that slip through, if work on them never started.

Then hand acc a JSON list on stdin:

```bash
acc import <<'JSON'
[{ "source": { "kind": "jira", "key": "ACME-12", "url": "https://acme.atlassian.net/browse/ACME-12" },
   "title": "Escalate premium cases", "brief": "The ticket's description, with its acceptance criteria",
   "labels": ["sla"], "deps": [] }]
JSON
```

- `source.kind` is `jira`, `azure`, `github` or `manual`. The key becomes the task id.
- Put the acceptance criteria in `brief`: the builder works from it, and the reviewer checks each one.
- Running it again refreshes the tasks it already has.

Then `acc ready` lists what an agent can start.
