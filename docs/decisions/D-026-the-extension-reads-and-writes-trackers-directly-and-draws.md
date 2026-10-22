## D-026 The extension reads and writes trackers directly, and draws each tracker's own board (2026-10-02)

The Tasks tab shows each tracker's real board, with the columns its source
defines. Every ticket opens as a page you can work from: read it, comment,
change status, assignee and labels.

**How each tracker is reached:**

- **Jira Cloud** uses its REST API with your email and an API token. The token
  is kept in VSCode's secret storage, for one repo (D-027). The extension can't
  use Claude's Atlassian connector, and a live board can't wait on a model.
- **GitHub** goes through `gh`, as the repo's own account (D-007).
- **The adapters live in core,** with no VSCode dependency, so the CLI can use
  them later.

**What a board is.** A Jira board's columns, mapped to their statuses, or a
GitHub Project's Status options; with no Project, Open and Closed. Dragging a
card runs the transition whose target the column holds. acc's own state shows
as a badge on the card, not as a column.

**Writes happen only on a person's click** on the board or a ticket page. acc
still never changes a ticket on its own. This refines "trackers get a comment
and nothing else" in the README.

**Rich text** from GitHub markdown or Jira ADF becomes one document model. The
webview draws it with DOM calls, so nothing in a ticket can become markup.
Remote images aren't loaded: people show as initials, and attachments as links.

**Per repo.** Trackers are listed in each repo's `.acc/config.json`, with a
site, project and board for Jira, or a repo and Project number for GitHub. One
machine can serve several clients' Jira sites and GitHub repos at once. Azure
DevOps followed in D-027. Not yet covered: Jira Server and Data Center, and
GitHub Enterprise hosts.
