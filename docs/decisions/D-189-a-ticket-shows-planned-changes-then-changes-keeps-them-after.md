## D-189 A ticket shows Planned changes, then Changes, keeps them after merge, and names Salesforce metadata by type (2026-10-22)

A ticket's page listed "Files" inside its analysis: the files its plan meant to change. The person asked
that the page say what it means, show what the work really changed, and keep that after the merge. What a
branch changed was read live only for overlap and conflicts (`branchFiles`, D-093), never shown, and gone
with the branch. A Salesforce person reads metadata by type and name, not by path. T-99 does three things.

- **The words.** The ticket page has a section of its own, apart from the analysis, under Verify the
  developer's work: **Planned changes** while the task has a plan and its branch has changed nothing;
  **Changes** once it has, with "Planned: n · Changed: n" beside the heading. Each count is a button that
  shows its list, and the choice stays as the page redraws. A change outside the plan carries "Not in the
  plan" (`diff-added`, orange), and a planned one not made carries "Planned, not changed" (`circle-slash`,
  orange): `CHANGE_LOOK` in `extension/src/model/changes.ts`, walked by `looks.test.ts`. With no plan,
  nothing is marked outside it. The analysis's own Files fold is gone: this section says it. The plan's
  paths are read through `plannedFiles`, and the plan's schema is unchanged.
- **Kept with the ticket.** A task gains `changes: { at, paths }` in the ledger (`KeptChanges`,
  `packages/core/src/changes.ts`). acc records it when `acc land` opens or updates its pull request, when
  autopilot's merge (the merge queue's last step) merges it, when acc sync sees its pull request merged
  (a person's merge on GitHub), and when a person moves it to done (`acc set <id> done`, as after a merge
  by hand). `mergedPaths` reads what the branch committed while its environment's branch doesn't hold it
  yet; once it does, what the merge commit brought: the pull request's `mergeSha`, or the oldest merge git
  finds that descends from the branch. A squash commit is read from its one parent. A record that finds
  nothing leaves the last one. While the task is in flight the page reads its branch live, as before;
  once it is done it shows what was kept, and when. A task that merged before this keeps none, and the
  page says: "It merged before changes were kept with a task, so there's no record of what it changed."
  The paths stay in the ledger for a ticket's package.xml (T-101), which this task doesn't build.
- **Named by type, for Salesforce.** `packages/core/src/sf-metadata.ts`, the salesforce profile's part
  (D-003), maps a source path to its component: the Metadata API's type, the type as a person reads it,
  and the member's name ("Custom Field: Contact.Job_Title__c", "Flow: Contact_Job_History", "Apex Class:
  JobHistoryService"). It knows objects and their fields, list views, record types, validation rules,
  buttons, compact layouts, field sets and business processes; Apex classes and triggers; LWC and Aura
  bundles; flows, layouts, permission sets and groups, profiles, custom metadata records, reports,
  dashboards, email templates and documents with their folders; and a few more single-file types. A class
  and its `-meta.xml` are one component. In a Salesforce project the section groups by type, under
  "Metadata", with each component's paths in its title; elsewhere it groups by folder, under "Files". A
  path the profile doesn't know shows as itself under "Other files", never dropped.

The section is a list of groups, so T-100's record changes join it as a group of their own. Tested in
`packages/core/test/changes.test.ts` (7 tests), `packages/core/test/sf-metadata.test.ts` (2 tests),
`extension/test/changes.test.ts` (10 tests), one CLI test in `packages/cli/test/tasks.test.ts`, and one
assertion each in the land, merge and sync tests. The screenshot run draws three new pages:
`ticket-planned`, `ticket-changes` and `ticket-kept`.
