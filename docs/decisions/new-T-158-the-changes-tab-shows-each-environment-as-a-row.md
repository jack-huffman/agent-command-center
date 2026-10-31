## D-T-158 The Changes tab shows each environment as a row, and one Deploy… picks where an agent deploys (2026-10-30)

T-158. The person sent a screenshot of a Salesforce ticket's Changes tab and wrote: "this is bad UI for a
deployment to production." The tab said "Aleysian, deployed 3 days ago · Sandbox, next · Production, next" on
one line, two environments both "next", and the line didn't say whether the work was in each org. Under it were
Deploy to Sandbox (D-220's direct deploy), Deploy with an agent (D-235, which didn't say where to) and Other next
steps. T-155 (D-237) reads where the work is from git and each org; T-156 (D-239) makes every deploy past the
development org an agent's, to the org the person picks. This draws both.

It amends D-220 (the Changes tab's path line, Deploy to <next environment>, its sheet and Other next steps go)
and D-235 (Deploy with an agent is no longer a button of its own: Deploy… is the agent).

- **One row for each environment on the path, in order** (`envRows`, `extension/src/model/ticket-deploy.ts`).
  The path is `pathFrom`, the usual way along `promotesTo`; after it, each environment off the usual way that
  Deploy… offers has a row too, as Hotfix off QA, and none once it is no choice. Each row has the environment's
  name, its org, and its state as an icon and a label (`WHERE_LOOK`): Deployed, with when by acc's records;
  Partly deployed, with how many components differ and a fold that lists them; Not deployed, with how many are
  missing behind the same fold; or Can't tell, with why. The state is the environment's last reading (D-237);
  before the first, a row is Deployed where acc recorded the work there, and Can't tell elsewhere. Each row says
  when it was read ("Not read yet" before the first) and has a quiet Check again, which reads that environment
  alone (`acc where <id> --env <branch>`, through `WhereReads`) and waits while it is read; a read of every
  environment (Refresh, or a due reading) covers each row. Where acc's record, git and the org disagree, the
  row says so (`whereNotes`). acc's words reach the person through `reasonInWords`.
- **acc where reads off the usual way too** (`ticketEnvironments`, `packages/core/src/where-kept.ts`). It reads,
  and `--env` takes, the ticket's path and then each environment off it the ticket can still reach
  (`environmentsAhead` from its own environment), so a Hotfix row has a reading to show. This amends D-237,
  which read the path alone.
- **One next step at most.** Only the usual next step (`ticketPlace`'s first) says Next, though its environment
  goes two ways, as the person's did (Dev to Sandbox or to Production). The development environment's row also
  says whether the work is merged into its branch (`MERGE_LOOK`). Orange against blue, never red against green.
- **One primary action: Deploy…** (`deployPick`). It asks "Where should an agent deploy it?" and lists the
  environments ahead (`environmentsAhead`, D-239) in path order, the usual next step first, at most three (D-205,
  `OPTIONS_MAX`): an environment ahead past the third is reached once the ticket moves on, or by the command.
  Each choice says what happens next: "An agent deploys it" for a sandbox, and "An agent deploys it after you
  type <name>'s name" for Production or a protected org, by the settings (`choiceThen`). The pick sends
  `deploy-guide` with the environment, which opens the deploy guide's chat there (T-154), its opening in the
  output panel. The choices are buttons, not a radio group, since a pick acts at once; `choice-limit.test.ts`
  checks the three.
- **No direct deploy.** The direct Deploy, its sheet (`webview/deploy-sheet.ts`, `TicketDeploys`) and its
  Deploy, and Other next steps go. The page's messages are `deploy-guide` and `where-check` alone: `deploy-check`,
  `deploy-go` and `deploy-close` are refused. The command `acc.task.deploy` opens the ticket's Changes tab, and
  with an environment named starts the guide there; `acc deploy --task` at the CLI is unchanged.
- **Off with why.** Deploy… is off, its reason beside it and in its title, for what `pickOff` says: the
  command's own reasons, the ticket's own checks failing unaccepted (`deployBlockers`), a conflict with its
  environment, or a deploy under way. A choice that can't be picked (no org, a dependency not there) says why in
  it; when every choice is off, Deploy… is off with each reason once, and the same dependency missing from each
  in one line ("It depends on ACME-3, which isn't in UAT, Hotfix or Production yet.").
- **What the agent is on.** A deploy of the ticket under way (a `deploy` job, D-092) shows on its environment's
  row, and the tab says "An agent is deploying ACME-12 to UAT." The Agent panel doesn't change.
- **Not covered.** The words for a choice follow the settings: an org Salesforce doesn't say is a sandbox is
  asked for its typed name by the guide (D-239), though its choice says "An agent deploys it". A reading that
  finds the work in Hotfix moves the ticket's place there (`furthestRead`, D-237), as a deploy to it would.
- **Checked by** `extension/test/ticket-deploy.test.ts` (rows, Hotfix's row, next, merge, the pick and its
  words, off with why, a deploy under way, a row's read, the messages, and two mutants of the model, each
  caught: one that shows two environments as next, and one that lets a direct deploy message in),
  `extension/test/changes-tab.test.ts` (the rows, the fold, a row's Check again, Deploy… and its pick, off with
  why), `extension/test/where.test.ts` (the readings on the rows, and a row's read of its environment alone),
  `packages/core/test/where.test.ts` (`ticketEnvironments`), `extension/test/choice-limit.test.ts` (three of
  five) and the screenshot run's behaviour cases (seven, with nine mutants, each caught: the pick deploys
  without the agent, Deploy… off says no why, every environment shows as next, Check again asks for nothing,
  Check again reads another row's environment, a choice that can't be picked is on, a row's check under way
  still takes a click, a partly deployed row doesn't open, and a deploy under way doesn't show on its row).
  The screenshot run draws the rows in each state and the pick at each width and theme: `ticket-deploy-before`,
  `-work` (Deploy… off with why), `-deployed` (UAT partly deployed, open), `-not` (Hotfix not deployed, open),
  `-unknown` (each row can't tell, with its reason), `-steps`, `-pick` (open on a sandbox and Production),
  `-pick-off` (a choice off with why), `-off` (Deploy… off, a dependency in none of them), `-checking` (QA's Check again
  under way) and `-busy` (a deploy under way on its row).
