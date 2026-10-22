## D-027 Tracker sign-ins belong to one repo, and Azure DevOps joins the trackers (2026-10-02)

A consultant works for several clients from one machine. One client's Jira or
Azure DevOps login must never serve another client's repo, even when they share
a site.

**Sign-ins are kept per repo** in VSCode's secret storage, under
`acc.cred:<repo>:<kind>:<site or organization>`.

- The repo is its GitHub repo name when the config has one, so every clone and
  worktree of it shares the sign-in. Otherwise it's the repo's git directory.
- Two repos on the same Jira site each sign in once.
- GitHub was already per repo, through the account the config names (D-007).
- This replaces D-026's one Jira token per site.

**Azure DevOps** reads Azure Boards over its REST API (7.1).

- **Columns** are the team's Kanban columns. Each one maps every work item type
  to a state. Two columns can share a state, so a card is placed by its board
  column field, and a move sets that field and the column's state together.
- **Work items** are the board's types in the team's area paths, leaving out
  Removed, and showing finished ones only from the last 30 days.
- **Rich text.** Descriptions, acceptance criteria and repro steps are HTML, or
  markdown where the org has switched. A tolerant HTML reader turns them into the
  same document model as GitHub and Jira, keeping structure and dropping all
  markup. Comments go out as escaped HTML.
- **Keys** are `AB-123`, after Azure Boards' own `AB#123`, and `prefix` can
  change it.

**Signing in to Azure DevOps**, offered in this order:

1. **Microsoft account.** The extension asks VSCode's built-in Microsoft sign-in
   for Azure DevOps' own scope, in the tenant that owns the organization. The
   tenant is read from the org's `x-vss-resourcetenant` header. The repo
   remembers which account it uses, so another repo can use another account.
   MFA works, and there's no token to renew.
2. **Personal access token**, with Work Items: Read & write, for orgs whose
   tenant blocks VSCode's sign-in.

**"Add a tracker…"** sets a repo up from VSCode: pick the kind, sign in, then
pick the project, team and board from what the tracker lists. It writes to that
repo's `.acc/config.json` only.
