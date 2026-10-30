## D-T-154 Deploy with an agent: a guide gathers every step into a runbook, and deploys on the yes the person types (2026-10-30)

T-154. The person: "I need the deploying to production process to be agent guided. It looks like we currently
use a command to deploy to production, but sometimes there are other steps needed, manual processes required,
etc etc. I want that to be handled by the agent itself, not by a command on its own." Asked where the agent runs
and who gives the final yes, they chose a Claude Code chat, and the yes typed by them in that chat. Built in the
main session, at the person's word that it was urgent.

It amends D-011 and D-219 where they say only a person deploys a ticket: the deploy guide does, for its own
ticket, on the yes the person typed. Everything else D-219 says of a ticket's deploy stands: the check first,
the quick deploy of the checked job, the pull request, the records.

- **Deploy with an agent** (`acc deploy [<env>] --task <id> --guide`, `TASK_DEPLOY_GUIDE_COMMAND`, id
  `acc.task.deployGuide`, on exactly when Deploy is). Beside Deploy on the Changes tab, off for the same reason.
  It opens a terminal in the project's main checkout running Claude Code, with the first message "Guide the
  deploy of <id> from <here> to <there>, as the acc:deploy skill says" and `ACC_ROLE=deployer`, `ACC_TASK`,
  `ACC_DEPLOY_TO` (`packages/core/src/deploy-guide.ts`, `extension/src/logic/deploy-guide.ts`). The chat runs in
  the person's own permission mode, so Claude Code asks them before each command it hasn't been allowed.
- **The skill** (`plugin/skills/deploy/SKILL.md`): read the ticket, its outside-git changes and the check; look
  for what a deploy never carries (permission sets to assign, flows to activate, scheduled jobs, settings and
  custom metadata records, data, Setup changes); show one runbook in four parts (before, the deploy, after, check
  it worked), each step marked "you" or "by hand"; change it until the person approves it; then go one step at a
  time. A command that changes the org runs only after the person said yes to that exact command.
- **The yes is what the person types.** The plugin's UserPromptSubmit hook (`acc hook user-prompt-submit`) keeps,
  in a deploy guide's session only, the person's latest message when it is one line of at most 200 characters,
  and clears it on any longer one (`keepTypedYes`). Claude Code runs that hook on the person's messages alone,
  never on the agent's words. `acc deploy --task <id> --yes <check>` run by the guide takes it (`takeTypedYes`):
  used up as it's read, refused when there's none, when it is more than 15 minutes old, or when it is older than
  the latest check, which the person may not have seen. It must be the destination's name or alias for a
  protected or production org (`confirmsOrg`, as at the terminal), and the word yes for any other (`guided`).
  The guide is refused `--confirm-production`, so it never types the name itself.
- **What the guide may do** (`guardDeployer`, PreToolUse): no edit to any file; no git command that moves a
  branch or the checkout; no deploy by hand (`deploysByHand`); no word of `.git/acc` or the kept yes; no
  `ACC_ROLE`, `ACC_TASK` or `ACC_DEPLOY_TO` set on a command; of acc's commands only show, list, deploy (its own
  ticket), change (list, and step for its own ticket), ticket, board, ste and doctor. The CLI agrees: anything a
  person does is refused it with "The deploy guide can't …" (`personOnly`), and `personOrGuide` lets it deploy,
  and mark the steps of, its own ticket alone. A deploy it makes is recorded by `deployer:<id>`.
- **Not covered:** the guard reads the command as written. A command that builds the kept yes's path from
  pieces would get past it; the yes's freshness and one use, and Claude Code's own prompt for each command, are
  what stand behind it. The guide's own words in the chat are not held to the note shape or the wording check.
- **Checked by** `packages/core/test/deploy-guide.test.ts` (8: the yes kept and used once, the latest message
  only, its age and the check's, its own task, the hook in and out of a guide, the guard, the hook's guard),
  `packages/core/test/task-deploy.test.ts` (3 more: a guided yes to a sandbox is the word, to production the
  name, and the launch), `packages/cli/test/deploy-guide.test.ts` (5: the typed yes needed and used up, its own
  ticket only, no name typed, no second guide, its steps, `personOrGuide`), `extension/test/deploy-guide.test.ts`
  (3) and a behaviour case with two mutants (the button sends nothing; it stays on when Deploy is off). Two
  mutants were run by hand and caught: the CLI deploying without reading the typed yes, and the guided yes check
  removed.
