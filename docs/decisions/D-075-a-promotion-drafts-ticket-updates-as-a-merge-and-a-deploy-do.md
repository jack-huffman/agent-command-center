## D-075 A promotion drafts ticket updates, as a merge and a deploy do (2026-10-06)

D-066 left promotions out: "Promotions draft nothing yet". A promotion left one
line in `promotions.jsonl` that nothing read, and a deploy to UAT drafted
nothing for work promoted there, because it found only tasks merged straight
into the deployed branch (GH-56).

- **A promoted change gets three drafts,** each for a person to post (D-066):
  - `acc promote` opens the pull request: "The change is ready to go to UAT:
    <link>", by the person who ran it.
  - `acc sync` sees it merge: "The change is now in UAT."
  - `acc deploy uat` then says "The change is now deployed to UAT.", as it
    does after a merge.

  The client hears the environment's name, as for a merge. A test checks the
  wording, and that promote, sync and deploy post nothing. A task with no
  tracker key is recorded but gets no draft.
- **Where a change arrived is one rule** (`arrivedAt`), which promote and
  deploy both use. A promotion copies files rather than merging, so a task's
  merge commit on Dev is never in UAT's history: each branch has its own
  arrival commit. On the task's own branch it's its pull request's merge
  commit (`pr.mergeSha`, D-066). On another branch it's the merge commit of the
  first promotion that took the change there. Each task keeps its promotions in
  the ledger (`Task.promotions`: from, to, the pull request, open, merged or
  closed, and the merge commit). `promotions.jsonl` stays a log, and now lists
  the tasks too.
- **What a promotion carries:** a task whose change had reached the source
  branch by the commit promoted, hasn't reached the destination, and whose own
  merge touched a file the promotion brings or deletes. A task merged into
  another environment, merged after that commit, already promoted, or that
  changed only environment-specific files gets nothing. When a task's merge
  commit can't be read, only the file test is skipped.
  - Accepted: a task promoted by hand, or by acc before this, is carried again
    when a later change touches the same file.
  - Promotions opened before this recorded no tasks, so they draft nothing when
    they merge. Their tasks aren't back-filled.
- **A promotion that stops** (nothing to promote, a failed check, or gh failing
  before the pull request exists) records and drafts nothing. Once the pull
  request is open, a failure to record its tasks or draft their updates is
  said, and the pull request stands.
- **acc sync follows open promotion pull requests,** even when no task's own
  pull request is open, and reads each once however many tasks it carries.
  Merged, it records the merge commit on each carried task and drafts "now in".
  A task that had already reached that environment by an earlier promotion gets
  no second one. The Command Center's poll runs while any promotion is open
  (`followsPullRequests`).
- **Closed without merging,** as a person decided: acc sync records it closed
  on each task, so the next promotion carries them again. It discards that
  promotion's unposted drafts (kept and marked, by acc sync) and says so. A
  draft that's posted or being posted is left alone.
- **Overtaking (D-071) has two more stages:** a pull request; then its merge
  into its environment, or a promotion opened; then the promotion's merge; then
  a deploy. So "ready to go to UAT" stands in for an unposted pull request
  draft, "now in UAT" for "ready to go to UAT", and "deployed to UAT" for both.
  A merge into Dev is other news and waits beside them. Two promotions into UAT
  before anyone posts are one draft, with the latest link.
- Needs you and the task page call them "Promotion #9 to UAT is ready" and
  "Promoted to UAT", in the same orange row with its icon.
- This amends D-066's "Promotions draft nothing yet" and D-071's stages.
- Not chosen:
  - Rewriting the "ready to go" draft in place when the promotion merges. A
    new draft that overtakes it keeps an edit through `replaces` (D-070).
  - Following a promotion pull request's checks and conflicts in acc sync.
