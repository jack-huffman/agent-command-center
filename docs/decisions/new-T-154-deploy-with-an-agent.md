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
  `ACC_DEPLOY_TO` (`packages/core/src/deploy-guide.ts`, `extension/src/logic/deploy-guide.ts`).
- **Claude Code holds the line, not acc's parser** (`deployerSettings`, after review). The launch sets
  `--permission-mode default`, whatever the person's own default, and `--settings` with `ask: ["Bash"]`, so Claude
  Code asks the person before every command the guide runs (ask beats allow, so an allow in their settings doesn't
  skip it), and `DEPLOYER_DENIES`: every hand deploy, `acc hook`, `unset`, `export`, `env`, the shells, `eval`,
  `exec`, `xargs`, `source`, commit, push, merge, reset, checkout, and every edit. It runs acc's PreToolUse and
  UserPromptSubmit hooks itself, so the guard and the yes don't depend on the plugin being on. The first review
  found the guide could drop its role (`unset ACC_ROLE`, `env -u`), type the name through acc's inner flag
  (`--confirm-name`), or plant a yes by running the hook through `sh -c`; each is now refused twice, by the
  settings and by the guard, and tested; the second review's forms by the allowlist below.
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
  the latest check, which the person may not have seen. It must be the destination's name or its org's alias,
  for every destination (`guided`): a "yes" said to approve the runbook or a step never counts. The guide is
  refused `--confirm-production`, and the CLI refuses the inner `--confirm-name` and `--deploy-check` when typed,
  so the guide never types the name itself.
- **What the guide may run: an allowlist** (`guideCommands`, `guardDeployer`, PreToolUse; after the second
  review). The first guard refused bad forms, and each review found more (a shell named by its path, a wrapper
  it didn't know, the role dropped by `printf -v` or `read`, a flag built from a variable or braces), so it now
  refuses anything it can't read in full. A line is plain words, 'single quotes', and "double quotes" with no
  `$`, backtick or backslash, its commands joined only by `&&` or `;`: no pipe, redirect, glob, brace,
  background, sub-shell, assignment or variable, but `$ACC_TASK` and `$ACC_DEPLOY_TO`, each a whole word (a third
  review found `$ACC_TASKZ--output=…` read as one word and run as another). Each command is
  `acc`, `sf` or `git`, named as itself. acc: show, list, deploy of its own ticket (by id, `--task=` or
  `$ACC_TASK`) with no name typed, change list and change step of its own ticket, ticket, board, ste and doctor.
  sf: an allowlist too (`DEPLOYER_SF`, after the third review found `sf api request` could quick-deploy the
  checked job): the analyst's reads but a retrieve, and the runbook's own steps, `sf org assign permset` and
  `permsetlicense` and `sf data create|update|delete record`, never through the Tooling API, never writing a file
  or reading flags from one. Anonymous Apex and anything else of sf is a step by hand.
  git: log, show, diff, status, rev-parse, ls-files, blame, describe, shortlog. No word names acc's state, its
  hook or `ACC_ROLE`. A builder may no longer run `acc hook` by hand either (`PERSON_ONLY_ACC`).
- **Not covered:** the allowlist trusts `sf` itself: a step it runs (`sf apex run`, `sf data update`) changes
  the org, which is why Claude Code asks the person before each command. A PreToolUse hook of the person's own
  that answers "allow" would skip that prompt, and the person can change the chat's mode with Shift+Tab. MCP tools aren't guarded: a Salesforce MCP server's deploy tool in that chat would be
  asked about by Claude Code alone. The kept yes doesn't name its chat, so two guide chats for one ticket share
  it. The terminal stays after the chat ends, with the guide's variables set. The deploy's event is recorded as
  a person's (`actor: 'human'`), with `by: deployer:<id>`. The launch's own first message passes through the
  hook too, and is never a name. The guide's words in the chat aren't held to the note shape or wording check.
- **Checked by** `packages/core/test/deploy-guide.test.ts` (8: the yes kept and used once, the latest message
  only, its age and the check's, its own task, the hook in and out of a guide, the guard, the hook's guard),
  `packages/core/test/task-deploy.test.ts` (3 more: a guided yes is the destination's name, to a sandbox as to
  production, and the launch), `packages/core/test/deploy-guide.test.ts`'s four more after review (each way round the
  review found, each acc command the skill names, the settings, a builder's `acc hook`),
  `packages/cli/test/deploy-guide.test.ts` (6: the typed yes needed and used up, its own ticket only, no name
  typed, the inner flags refused, no second guide, its steps, `personOrGuide`), `extension/test/deploy-guide.test.ts`
  (3) and a behaviour case with two mutants (the button sends nothing; it stays on when Deploy is off). Two
  mutants were run by hand and caught: the CLI deploying without reading the typed yes, and the guided yes check
  removed.
