## D-248 The Changes tab shows where a ticket was deployed from acc's record, and reads an org only when you ask (2026-10-31)

T-167. The person, on 0.55.0's Changes tab for a pilot ticket whose three environments all said "Can't tell · Not
read yet · Checking…": "why is the changes tab checking all of the environments? I don't like that approach - the
ticket should just keep track of if it deployed to an environment or not rather than check three orgs at once...
that's really inefficient." Since D-244 and D-239 every deploy goes through acc: the builder's deploy gate to the
development org, and the deploy guide past it. So acc's own record is enough to draw the rows.

This amends D-237 (a page draw no longer reads a due reading behind the page, the person's Refresh no longer reads,
and a reading no longer moves where the ticket is) and D-242 (a row's state is acc's record, not the last reading;
"Check again", "Checking…" and "Not read yet" go). It closes T-166: a deploy off the usual path never moves where
the ticket is.

- **Rows from acc's record only** (`envRecord`, `packages/core/src/deploy-record.ts`; `envRows`,
  `extension/src/model/ticket-deploy.ts`). Each environment's row is one of four states, `RECORD_LOOK`: Deployed,
  with when and who (`DEPLOYER_WORDS`: "by the builder" for a deploy gate's deploy, "by the deploy guide" for one
  with the person's check); Deploy failed, with when and the reason on one line (`oneLine`); Merged, where a
  promotion to it merged, or for the development environment its pull request merged, with no deploy on record; or
  Not deployed. The latest deploy wins; a failure after it makes the row Deploy failed. Orange against blue: failed
  is orange, deployed and merged blue, not deployed neutral.
- **A failed deploy is kept** (`TaskDeployFailure`, `task.deployFailures`, `recordDeployFailure`). The deploy gate
  keeps one when Salesforce refuses the deploy; the deploy guide's deploy (`deployTask`) keeps one when its deploy
  fails, with the person and the check. Before this, a failure left no trace on the task.
- **Where the ticket is** (`ticketPlace`) reads `task.deploys` and `task.promotions` again, as before T-155, and
  counts only an environment on its usual path (each first `promotesTo` from its own environment, `pathFrom`). A
  deploy or merged promotion to Hotfix, off QA, leaves it in QA (T-166). `taskDeployRoute` and `taskDeployEnabled`
  take no readings. `furthestRead`, `isAfter`, `whereDue` and `WHERE_MAX_AGE_MS` go.
- **No automatic reads.** A draw takes the kept readings from their file and never starts `acc where`
  (`WhereReads.kept`, `extension/src/logic/where.ts`); Refresh draws again from the ledger; no time starts a read.
  The one read in the extension is a row's Check this org.
- **Check this org, on a click.** Each row keeps one quiet button, Check this org, for work deployed outside acc.
  It reads that one environment (`acc where <id> --env <branch>`), waits while it runs, and is off with why where
  there's no work yet or no org. What it found shows under the row with when: Matches, Differs (how many, with a
  fold that lists them), or Can't tell (why), and where acc's record and the org disagree, the note says so
  (`whereNotes`, D-237). A result never changes the row's state or where the ticket is. `acc where` without
  `--env` still reads every environment, at the command line.
- **Checked by** `packages/core/test/deploy-record.test.ts` (each state, a failure after a deploy and a deploy after
  a failure, a merge with no deploy, a failure kept, an off-path deploy that doesn't move the ticket, and a mutant
  that lets an environment off the path move it, caught), `packages/core/test/task-deploy.test.ts` (the deploy
  guide's failure kept; Hotfix leaves it in UAT), `packages/core/test/deploy-gate.test.ts` (the builder's failure
  kept), `packages/core/test/where.test.ts` (a reading never moves the ticket), `extension/test/where.test.ts` (rows
  from the record, a check's result as a note that changes no state, no read on a draw or a refresh, a mutant that
  starts a read when the page draws, caught, and Check this org's one read), `extension/test/ticket-deploy.test.ts`,
  `extension/test/changes-tab.test.ts` (each state drawn, who and when, the note and its fold, Check this org on,
  waiting and off), `extension/test/looks.test.ts` (`RECORD_LOOK` walked) and the screenshot run's behaviour cases
  (the rows in each state, the note, Check this org reads its own row, and waits while it runs; mutants: it asks for
  nothing, it reads another row, it takes a click while it runs, the note doesn't open, a failed deploy doesn't say
  why, and the note isn't drawn). The screenshot run draws the rows in each state and a row with a check result:
  `ticket-deploy-before` (each not deployed, Check this org off), `-deployed` (Dev deployed by the builder, QA by
  the deploy guide with a check that matches, UAT's deploy failed with a check that differs, open), `-not`
  (Hotfix's check open on what's missing), `-unknown` (each check can't tell, with why), `-steps` (Dev and UAT
  merged, Production's check open) and `-checking` (QA's Check this org under way).
