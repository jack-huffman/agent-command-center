## D-T-137 Deploy one ticket to its next environment: a check first, then the person's yes, and its branch kept in step (2026-10-28)

T-137. The person found the deploy too many steps: merge, promote the whole branch, merge that pull request,
deploy with a starting commit, then deletions and record steps by hand. They want to deploy a ticket's changes
from the ticket, with a check so it never happens by accident, and acc should know which components are the
ticket's. They chose: this ticket only, not the whole branch, and only to a next step on its path. This change
is the engine and its command (`packages/core/src/task-deploy.ts`, `acc deploy [<env>] --task <id>`); T-138
draws it on the task page.

It amends D-034 (a promotion moves a whole branch; this moves one ticket) and D-191 (the manifest never
deploys: here acc's own built package does, behind a person's confirmation). D-011, D-016, D-056 and D-206
stand where they speak.

- **Person only, Salesforce only (D-003).** The CLI refuses a builder, a reviewer and any actor that isn't a
  person. `TASK_DEPLOY_COMMAND` (id `acc.task.deploy`, its params, `enabled` with why) is off for a project
  that isn't Salesforce, one not on GitHub, a task with no work, one whose builder is at work, and one at the
  end of its path.
- **Where to.** Where a ticket is now is the last place it reached, by time: its own environment, each
  environment a person deployed it to, or a promotion took it to and merged (`ticketPlace`). It may go only to
  that environment's `promotesTo` (D-018); with none named, the first. A builder's own deploy to its org
  (D-206) doesn't move it on. Anything else is refused with where it is and where it can go.
- **What.** The ticket's own commits: its merge commit once merged (a merge commit read against its first
  parent), else its branch's commits without the merges that took newer work in. They are cherry-picked in
  order onto the destination's branch in a scratch worktree, and what deploys is what they change there, mapped
  to components by Salesforce's CLI as the manifest is. Environment-specific files are named and left out of
  the deploy and the branch: the destination keeps its own (D-016). A file outside the source folders travels in
  git only. Deletions are never deployed: each is listed as a step to make by hand in the org, though the branch carries it as the ticket made it. A file deleted from a
  component the branch still holds, such as one file of a bundle, deploys the component. Record changes become
  steps for the destination, as at a promotion (T-100).
- **A plan first, and it changes nothing.** `--plan`, or no `--yes`, runs a check-only deploy of the manifest to
  the destination's org: with the org's local tests when Apex is in it, else none; `--no-tests` only on a
  sandbox (D-056), and Salesforce is asked which org it is first. It says the destination and its org, the
  components by type, what's left out and why, the deletions and record steps, the tests, and the check's
  result with its id, or the org's errors per component. The check is kept beside the ledger with the ticket's
  commits and each file's content.
- **The yes.** On a terminal the CLI asks: "yes", or for a protected or production org (by the settings or by
  what Salesforce says), its name typed. `--yes <check-id>` says it for the extension, with
  `--confirm-production <name>`, the environment's name or its org's alias. The yes is refused when the id isn't
  the ticket's latest check for that environment, the check failed, or the ticket's commits or what would
  deploy changed since. A check that ran tests is quick-deployed (`sf project deploy quick`), so what deploys
  is the checked job; a sandbox check without tests deploys the same manifest at the same commit.
- **Git stays in step.** The branch (`deploy/<task>-to-<env>-<time>`) is pushed and its pull request opened before
  anything deploys. Once the deploy passes, acc merges it: the person's yes covers it, though a Salesforce
  project otherwise never auto-merges. A failed deploy closes the pull request and deletes its branch. A merge
  GitHub refuses leaves the deploy recorded, with the pull request open for acc sync to follow, and says so. A
  cherry-pick that conflicts stops before anything is checked, pushed or deployed, names each file and the
  other tickets that changed it, and leaves no worktree or branch. A ticket that depends on another not yet in
  the destination is refused with that ticket's name.
- **Records.** The task keeps the deploy in `deploys` (destination, org, its username, commit, paths,
  components, job, check id, pull request, by whom, when), so a later `acc deploy <env>` of the whole branch
  doesn't send its files again (D-206), and in `promotions`, so where it arrived counts as a promotion's does
  (D-075). A ticket update is drafted, never posted (D-066).
- **One at a time.** The check and the deploy each hold the org's turn, a one-slot lock by the org's username
  beside the builders' (D-206), and a heavy-check slot. The deploy, not the plan, shows as a deploy job while it runs (D-092).
  Everything runs through acc's runner, so it works on Mac and Windows.
- **Checked by** `packages/core/test/task-deploy.test.ts` (the path rule, components from the ticket only,
  left out and by hand, a plan that changes nothing, a failed check, no yes, the typed name, commits changed, a
  conflict, a dependency, the record a branch deploy reads, and two mutants: one that deploys without the yes
  and one that deploys another ticket's component, each caught) and `packages/cli/test/deploy-task.test.ts`.
