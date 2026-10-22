## D-190 Record changes are part of a ticket: planned, recorded when made, kept, and stepped at promotion (2026-10-22)

On Salesforce some of a ticket's changes are records, not metadata: a renamed Account, the records a flow
needs, a custom setting. Git never sees them, so they lived only in the sandbox and someone's memory, and
were missed on the way to production. A record change now counts as a change of its ticket (T-100).

- **The core keeps a generic "change outside git"** (`outside-changes.ts`), each with a kind; a profile adds
  a kind and registers it in `outside-kinds.ts` with one line (D-003). The salesforce profile adds `record`
  (`records.ts`). A task keeps them on `task.outside` in the ledger: each change (`c1`, `c2`, …) with who
  made it, when, why, and whether the plan listed it; the commands acc noted; a builder's word that none was
  made; and the promotion steps.
- **Planned.** The analysis gains one property, `recordChanges` (`RECORD_CHANGES_SCHEMA`): the object,
  create, update or delete, how to find the record (`match`), the fields with old and new values, and why.
  On Salesforce the analyst is told to list every one and how to find it without a record ID
  (`RECORD_PLAN_PROMPT`); the builder's instructions list them under Record changes
  (`recordPacketSection`).
- **Never by ID.** A record is named by what is the same in every org: an external ID, a unique name, or
  field values that match one record. A change matched on `Id`, or on a value shaped like a record ID
  (`RECORD_ID`), is refused with why; so is one that sets a field to a record ID. A planned one stays in the
  plan, marked refused, and matches nothing.
- **Recorded when made.** `acc change record [<id>] --object <o> --match '<f>=<v>'… [--set '<f>=<v>']…
  [--create|--delete] --why "<text>"`, by the task's own builder while it runs, or by a person at any
  state (a change stays with a done ticket). The ticket page's "Add a change made by hand" runs the same as
  the person. `acc change list` shows them.
- **A builder can't forget one.** acc's PreToolUse hook (`noteRecordWrites` in `record-hooks.ts`) notes
  each command it lets a builder run on a Salesforce project that can write records: `sf data
  create|update|delete|upsert|import`, `sf apex run` (not `sf apex run test`), and an SFDMU run. It notes
  from the hook the plugin already runs, not a new PostToolUse one, so a plugin whose shipped acc is older
  (D-079) notes nothing and shows no hook error; a noted command that then failed is one the builder says
  made none. `acc done`
  refuses while a noted command has no change recorded after it, unless the builder runs `acc change none
  "<why>"`, which is kept with its reason. The reviewer's prompt lists what was recorded, what acc noted and
  what was said to make none, and asks it to check them against the plan's (`recordReviewSection`).
- **Shown with the ticket.** A Record changes section of its own on the ticket page, under Verify, lists
  each change in words ("Account 'Acme Corp': Name → 'Acme Corporation'"), with who and when and whether it
  was planned, then the plan's not made yet. T-99's Changes section takes it as a group at merge.
- **Stepped at promotion.** `acc promote` adds a step to the destination for each change of each task it
  carries (`change-steps.ts`), once per environment, and lists them on the pull request with the `sf data`
  commands that make each one, matched on its stable key, after a query that should find one record (none,
  for a create). Nothing runs them. A person marks each done, or skips it with a reason (`acc change step
  <id> <change> --env <branch> --done | --skip "<why>"`, or the page's Mark done and Skip); a builder can't,
  and its settings deny it. The page shows each environment's steps not done, in orange.
- Out of scope: running record changes in another org by itself, and finding record changes nobody
  recorded by comparing orgs.

Tested in `packages/core/test/records.test.ts` (12 tests), `packages/core/test/outside-changes.test.ts`
(15), `packages/core/test/promote-steps.test.ts` (2) and `extension/test/record-changes.test.ts` (7). The
screenshot run draws `ticket-records`, `ticket-records-promoted` and `ticket-records-form`.
