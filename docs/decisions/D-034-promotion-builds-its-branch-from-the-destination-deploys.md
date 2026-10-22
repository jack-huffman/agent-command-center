## D-034 Promotion builds its branch from the destination; deploys follow what was last deployed (2026-10-02)

- **A promotion's pull request starts from the destination branch and copies in
  what the source changed** since the branches last shared history, rather than
  merging the source branch. A straight merge would carry environment-specific
  files (which differ in every org by design), and could undo a fix made
  straight in the destination.
  - Files the destination already has as the source does are skipped, so a
    second promotion brings only what's new.
  - Deletions are named, and need a person's go-ahead.
  - Skipped environments on the usual path are named in the title, the
    description and the confirmation (D-018).
- **Its check is its own check-only deploy to the destination's org.** The task
  gate `validate` refuses protected orgs, because tasks never target them. A
  promotion into production is exactly what should be checked against
  production. It runs the org's local tests when Apex changes, and saves
  nothing. A failing check opens no pull request.
- **`acc deploy` is the one command that changes an org.**
  - It deploys what changed on the branch since the last deploy it recorded
    (a first deploy names its starting commit), from a throwaway checkout of
    the branch on GitHub.
  - It never deploys environment-specific files or deletions, and runs one at
    a time under the heavy slot.
  - It records where it got to only when the deploy succeeds.
- **Only a person promotes or deploys.** The CLI refuses builders and reviewers,
  and builder settings deny both. On the page, Promote… shows the plan before
  anything happens. Deploy… asks for confirmation, and a protected org needs
  its name typed.

Also: the Kanban lanes are a fixed width, however many a board has. The board
scrolls sideways, each lane scrolls under a pinned heading, and a fade marks
the edge that has more lanes past it.
