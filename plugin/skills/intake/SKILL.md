---
name: intake
description: Bring tickets into acc's task ledger, from GitHub issues, Jira or Azure DevOps, so agents can be dispatched to them. Use when someone asks to import, pull in or track tickets.
---

# Bring tickets into acc

acc keeps its own ledger of tasks beside the tracker. Bringing a ticket in never changes the ticket.

## GitHub issues

Run `acc intake github` in the repo. It reads the open issues on the repo in `.acc/config.json`, as the repo's own GitHub account, and adds or refreshes a task for each (`GH-<number>`). Add `--label <label>` to take only some.

## Jira or Azure DevOps

The VSCode Command Center shows each tracker's board and has **Track in acc** on every ticket. That's the easy way.

From a session, read the tickets with whatever connector is available (for example a Jira MCP server's search), then hand acc a JSON list on stdin:

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
