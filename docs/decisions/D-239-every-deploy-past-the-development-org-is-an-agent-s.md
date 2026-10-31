## D-239 Every deploy past the development org is an agent's, to the org the person picks (2026-10-30)

T-156. The person: "deploying to any environment (sandbox or prod) should be handled by the agent", and
"deploying (always handled by an agent) lets us choose one of the other orgs in the pipeline. We pick." Building
and the deploy to the development org stay automatic (D-206). Until this, a ticket went only to the next
environment on its path, both by D-219's direct deploy and by D-235's deploy guide, and the guide deployed only
on the environment's name the person typed, to a sandbox as to production.

It amends D-219 (where a ticket may go: any environment on its path after where it is, not only the next step)
and D-235 (the yes: the person's pick stands for the typed name where the org is neither protected nor
production; the guide deploys only where the person picked). Everything else both say stands: the check first,
the quick deploy of the checked job, the pull request, the records, every guard of D-235's four reviews.

- **The person picks the org** (`environmentsAhead`, `packages/core/src/ticket-path.ts`; `taskDeployRoute`).
  Where a ticket's change is now (`ticketPlace`), the path ahead is each environment along `promotesTo`, the
  usual way first, each once. Any of them is the person's to pick: from Dev, Production two steps on as well as
  UAT. Where it is, its own development environment and the project's default environment are never a choice,
  and a path that loops back ends where it came from. Anything else is refused with where the ticket is and
  where it can go ("Dev isn't on ACME-1's path after UAT, where its change is: from there it can go to
  Production. Pick one of those."). With no environment named, the usual next step, as before. This is the
  route both deploys take; the Changes tab still draws Deploy to the next step and its small menu (D-220) until
  a later task redraws it.
- **The pick is kept, and it is the yes for a sandbox** (`packages/core/src/deploy-pick.ts`). `acc deploy <env>
  --task <id> --guide`, a person's command (a builder, a reviewer and the guide are refused), keeps the pick
  whole beside the ledger: the task, the environment's branch, who, when (`keepPick`, written to a temp file and
  renamed). The guide's `acc deploy <env> --task <id> --yes <check>` reads it at the deploy's own yes step, after
  the check's id, the commits and what deploys were matched (`takeGuidedYes`, from `deployTask`): no pick, or a
  pick of another environment, is refused, whatever the person typed. For an org that is neither protected nor
  production, a pick at most 15 minutes old (`YES_TTL_MS`, as the typed yes) and not yet used is the yes: the
  deploy goes without a typed name, and the pick is marked used, so it is no yes again. An expired or used pick
  is refused as the yes, and the environment's name the person types in the chat (D-235) takes over, so a long
  runbook doesn't strand the person: the skill says to ask for it. The guide passes nothing acc reads as the
  yes: `confirm` is ignored in a guided deploy, `--confirm-production` and the inner flags stay refused.
- **Production and a protected org keep the typed yes** of D-235, by the settings (`type: production`,
  `protected: true`) or by what Salesforce says about the org (`shown.kind`). There the pick fixes only where and is
  marked used once that deploy goes, and the yes is the name typed in the chat, newer than the check, used once.
  So is an org Salesforce doesn't say is a sandbox (`shown.kind` other than `sandbox`, such as a legacy instance
  URL): it could be production whatever the settings call it, so the pick is never its yes (security review).
- **The guide can't write or change a pick.** Its settings deny every edit and `acc hook`; its guard refuses
  `--guide` on any `acc deploy` and any word naming `deploy-pick` (as `deploy-yes`); `acc deploy --guide` refuses
  the deployer (`personOnly`); and `ACC_DEPLOY_TO` stays fixed in its environment, with `export`, `unset`, `env`
  and the shells denied. The deploy's own check is the pick's environment, not `ACC_DEPLOY_TO`, so a changed
  variable moves nothing.
- **A step by hand before the deploy holds it** (`plugin/skills/deploy/SKILL.md`). The runbook's first part
  names each step by hand that must come first; the guide runs the deploy only once the person has said, in
  the chat, that each is done. Steps after the deploy are listed and don't hold it. This is the skill's rule,
  held by Claude Code asking the person before the deploy's command; acc keeps no record of the runbook's
  steps, so it doesn't check it.
- **The extension's command takes the environment** (`acc.task.deployGuide`, `TASK_DEPLOY_GUIDE_COMMAND`, with
  `taskDeployGuideEnabled`): off for the reasons Deploy is, and for a pick that isn't ahead on the path, with
  the route's own reason. The Changes tab's controls are as D-220 and D-235 drew them: Deploy with an agent
  still picks the next step. acc's help and the skill say all of this.
- **Not covered:** D-235's list stands. The pick's clock runs from when the guide opened, not from the person's
  last word, so a runbook longer than 15 minutes ends with the name typed. A chat opened before this change,
  with no pick kept, is refused and reopened from the Changes tab.
- **Security review** (in `packages/core/test/deploy-pick.test.ts` and `packages/core/test/task-deploy.test.ts`,
  each refused): a guide that deploys to an environment the person didn't pick, with its name typed; a guide
  that writes or names its own pick (the guard's words, `--guide`, the denies, and `acc deploy --guide` as the
  deployer at the CLI); and an expired or used pick. A pick alone for production, and for a protected sandbox,
  deploys nothing.
- **Checked by** `packages/core/test/deploy-pick.test.ts` (6: kept whole and used once, expired, another
  environment, production and a protected org, no pick or not acc's, the guard), `packages/core/test/ticket-path.test.ts`
  (2: every environment ahead, and the loop, the missing branch and the development environment),
  `packages/core/test/task-deploy.test.ts` (the route widened; the two guided deploys rewritten to the pick
  and the typed name; two more mutants, each caught: one that lets the guide deploy without a pick, and one
  that deploys to production on the pick alone), `packages/core/test/deploy-guide.test.ts` (2 more: the
  command on and off with why for each pick, and what the skill says of the hold and the pick; `--guide` and
  the pick's file in the refused list), `packages/cli/test/deploy-guide.test.ts` (1 more: the pick kept for any
  environment ahead, replaced by the next, refused for the development environment and for the guide; the yes
  read at the deploy's own step) and `extension/test/deploy-guide.test.ts` (the command with the environment).
