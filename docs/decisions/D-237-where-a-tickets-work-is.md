## D-237 A ticket knows where its work is, read from git and from each org (2026-10-30)

T-155. The person sent a screenshot of a ticket's Changes tab whose path line said "Sandbox, next" and wrote:
"The ticket should also know if things have been deployed to the sandbox versus not." Until now `ticketPlace`
read only acc's own records (`task.deploys`, `task.promotions`), so it couldn't tell "not deployed" from "acc
doesn't know". This adds the model and the command; a later task draws the rows on the Changes tab.

- **Two free oracles, per environment on the path** (`packages/core/src/where.ts`). Git: origin's copy of the
  environment's branch, after a fetch, holds each file the ticket changes with the ticket's blob, so a
  cherry-picked ticket counts; a file it deletes counts when the branch lacks it. The org: only the ticket's
  components (its manifest, D-191) are retrieved into a scratch worktree under the system's temp folder, at the
  ticket's commit, with the ticket's own files taken out first, so what's there after is what the org sent;
  each file is compared with the ticket's content, line endings and trailing space aside. A component it
  deletes whole counts when `sf org list metadata` doesn't list it. The retrieve only reads, and each org read
  holds that org's turn (D-206). Environment-specific files (D-016) are left out and named.
- **One state each**: deployed, partly (naming each component that differs), not deployed, or can't tell, with
  why in words (no org in the settings, not logged in, no access to Production as in D-208, Salesforce didn't
  answer). The environment's state is the org's; git's reading is kept beside it. A component counts only when
  every file of it the ticket changes matches. Each reading keeps when it was read.
- **acc's records still count.** `ticketPlace` takes the readings and moves on to the furthest environment after
  the recorded place that an org was found to hold the ticket in; a reading never takes it back. Where the
  deploy record, the branch and the org disagree, the reading says so in words (`whereNotes`). A ticket's
  deploy routes from the same place (`withBuilt` reads the kept readings).
- **Kept beside the ledger** (`packages/core/src/where-kept.ts`, `where/<task>.json` in acc's state folder),
  written whole then renamed; one environment's reading replaces only its own. A reading is due when there's
  none, it's older than an hour (`WHERE_MAX_AGE_MS`), or a deploy or promotion of its environment was recorded
  since (`whereDue`).
- **The command** `acc where <id> [--env <name>] [--json]`, `WHERE_COMMAND`, id `acc.task.where`, on for a
  Salesforce task with work. The extension calls it (`extension/src/logic/where.ts`): a page draw takes the
  kept readings and never waits; a due reading is read behind the page, at most once an hour per ticket by a
  draw, or again after a deploy since; the person's Refresh and a deploy from the tab read it again.
- **The path line** (`ticketPath`) takes the readings: an environment found to hold the ticket counts as
  reached, and each stop carries `found` (its state, look, words, what differs, git's state, when read).
  `WHERE_LOOK` gives blue for all of it, orange for some or none, neutral for can't tell. Today's line is
  unchanged until a reading exists; the page doesn't draw `found` yet.

Checked by `packages/core/test/where.test.ts` (a real git repo with a cherry-picked ticket, and a fixed org
answer from a faked Salesforce CLI as the oracle; a mutant that says deployed when one file differs is caught)
and `extension/test/where.test.ts`.

Note (2026-10-31, D-T-167): a page draw and Refresh no longer read where the work is, and a reading no longer moves where the ticket is. A row's Check this org reads one environment, on a click, and its result is a note.
