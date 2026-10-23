## D-T-115 A Salesforce builder deploys its work to its build org, verifies it and runs the tests there before it's done (2026-10-23)

T-115. On a Salesforce client project a builder finished a task and the person found nothing in the build org
the next day: they built it by hand in a meeting. The builder had done as told. D-011 says Salesforce builders
validate, a check-only deploy that saves nothing, and never deploy; a real deploy comes after a person merges
(`acc deploy`). The person wants a builder to finish as a direct Claude Code session does: deploy its change
to the build org, verify it's there, run the tests in the org, and only then hand back. This supersedes D-011
for an environment that isn't protected. D-011 stands for a protected environment and production, for
environment-specific files (D-016) and for deletions, which stay a person's.

**The person's choice on overlap.** Two builders on one org are kept from overwriting each other in two
ways: deploys to an org take turns, and a builder whose changed files overlap another in-flight task's waits
until that task merges or is set aside. It never deploys over another task's work.

- **The gate.** `deploy`, built into the salesforce profile (`packages/core/src/deploy-gate.ts`), heavy and
  bound to the change. It runs `sf project deploy start` on the task's changed Salesforce source, from its
  worktree to its environment's org, at the test level the change needs: `RunSpecifiedTests` with the classes
  named for validate when Apex changed, `NoTestRun` otherwise. Then it asks the org for each deployed
  component by type (`sf org list metadata`, by folder for a report, dashboard, email template or document;
  a path the profile can't name is said to be unchecked, never failed), and runs the named tests in the org
  (`sf apex run test --class-names … --result-format json --code-coverage --wait 60 --json`). One the org
  doesn't list, or a test that fails there, fails the gate; a run of no tests is a hold (GH-100). The receipt
  holds the job id, the org's username, the components, which were verified, the tests and their result,
  with every command in its log. The task gains `deploys` in the ledger: the org and its username, the
  commit, the time, the paths, the components and the tests, and the ticket's Changes (D-189) say "Deployed
  to <org>", when, and what the tests found.
- **Where it goes is the project's to say.** The gate reads the environments (org, type, protected) and the
  environment-specific list from the project's settings as a deploy trusts them (`trustedSettings`): the main
  checkout's `.acc/config.json` when the run is in a worktree, else the environment branch's committed copy,
  this clone's first and origin's after it. Never the task's worktree's copy, which a builder could point at
  another org or unprotect; a builder's edit under `.acc/` is refused by its hook (`guardEdit`), since acc
  writes the files there itself. Settings that can't be read, or an environment missing from them, are an
  error, and nothing is deployed.
- **Which org that is, Salesforce says.** Before anything goes, `sf org display --target-org <org> --json`
  says the org's username, id and My Domain URL. A URL that reads as production (`parseOrgUrl`, D-015, as
  `acc init` reads it) is refused whatever the settings say; an org sf can't show is an error; a URL of a
  kind the parser doesn't know (a scratch org's) deploys and is recorded as unknown. The username goes in
  the receipt and the task's record.
- **Required beside validate.** Wherever a Salesforce project's `gates.required` names `validate`, `parseConfig`
  puts `deploy` right after it (`withDeploy`), so `acc gate run` validates, then deploys, and `acc done`
  refuses until deploy passed on the last commit, as for any required gate. `acc init` writes it. The gate
  fails until validate passed on the same commit.
- **Only the builder's own run deploys, and only it counts.** `acc gate run` in a task's own worktree, on its
  branch, passes `deploys` (as it passes `raise`, GH-99); a cloud task's collect on the Mac does too, since
  the cloud has no org. A refresh, a verify of a developer's pull request and the merge queue run the gate
  too, and it skips there, saying where it runs (`elsewhere` on the outcome and the receipt): the skip
  satisfies that run, so a refresh's merge commit passes its checks, but `acc done` doesn't count it
  (`countsForDone`), so a task that never deployed is refused however many refreshes skipped the gate. Only
  the task's own passing deploy on its last commit, or a person's waiver (D-031), counts.
- **Never where it mustn't.** The gate errors on an environment with no org, a protected environment and
  production (D-018) in the trusted settings, and on a production org by its URL; it fails on an
  environment-specific file (D-016, by the branch's list or the trusted one), a deletion or rename, Apex
  without its tests, an uncommitted tree, and validate not passed. None of these deploys.
- **Taking turns.** A deploy holds a one-slot lock per org, `~/.acc/heavy/orgs/<username>/`, beside the
  heavy-check slots (`withSlot`, D-092), keyed by the org's username (never its alias, which any settings
  file can give any org) and in acc's own slot folder, which `ACC_HEAVY_DIR` doesn't move, with "Deploy to
  <org>" and the task as its owner. Before it, the gate reads the tasks in flight on the environment strictly
  (`inFlightFilesStrict`, D-093, beside `inFlightFiles` that T-103's team uses): a task whose branch isn't in
  this clone is read from origin's copy after a fetch, and one that still can't be read stops the deploy as
  an error, naming it, never counting as sharing nothing. One that shares a changed file with this task makes
  the gate fail, naming the task and file, with the words to block on. The packet says to block and wait. A
  task that shares no files deploys at once.
- **Through acc only.** Every form of a hand deploy is named once (`packages/core/src/deploy-commands.ts`):
  `sf project deploy start|quick|resume`, the same with colons (`sf project:deploy:start`), sf's older
  `deploy metadata`, and sfdx's `force:source:deploy`, `force:mdapi:deploy` and `force:source:push`, by name
  or path; a check-only one (`--dry-run`, `--checkonly`) isn't a deploy. The builder's hook refuses each,
  pointing at `acc gate run deploy`; the builder's settings deny each (`HAND_DEPLOY_DENIES`); a command gate
  (`gates.commands`), which runs through the shell where the gate runner can't see, is refused by
  `parseConfig` and again by `gatesFor` when its command deploys in any form, and a command gate may not take
  the deploy gate's name on a Salesforce project. The gate runner's guard (`assertCheckOnly`) allows a real
  `deploy start` to the deploy gate alone, never a quick deploy or a resume; `acc deploy` stays a person's.
  The command parser the hook reads lines with moved to `packages/core/src/command-words.ts`, so the config
  can read a command the same way without a cycle. The packet's Salesforce lines say validate, then deploy,
  verify and test in the build org, say in the note what's in the org and what the tests found, and never
  edit under `.acc/`; "Never deploy" becomes never except through `acc gate run deploy`, and never to a
  protected org.
- **After the merge.** `acc deploy <env>` leaves out a file only when its latest deploy to that environment,
  by any task and by its time (`deployedByTasks`), put the content the branch now has in the org, by git's
  blob id: a file another task deployed later at other content, as one set aside did, goes again, as does one
  changed since. It says who deployed what, and when nothing's left it says so and moves the environment's
  deploy record on.
- **The runner.** A gate may now plan several commands (`StepsPlan`): the runner gives it an `exec` that
  nices, logs and guards each, and the receipt's command is the first. `GateInput.run` carries what such a
  gate needs: the repo's state, the commit, the task, the slots, and whether the run may deploy.

Out of scope: scratch orgs per task, and deploying deletions.

Tested in `packages/core/test/deploy-gate.test.ts` (22 tests: the org asked and the deploy's arguments, the
verify calls, the receipt and the task's record, each refusal, the trusted settings from a branch and from a
main checkout, production by URL, the elsewhere skip and acc done, the command-gate refusal, the per-org lock,
the overlap stop, the fail-closed reading, the hand-deploy forms and the settings, the `.acc/` edit, the config,
the readers, and acc deploy after a merge with the latest deploy winning), five hook fixtures (`acc gate run
deploy` allowed; `acc deploy`, `sfdx force:source:deploy`, `sf project:deploy:start` and an edit of
`.acc/config.json` denied), `packages/core/test/refresh.test.ts` (a Salesforce refresh's deploy skip satisfies
the refresh and not acc done), `packages/core/test/gates.test.ts` (a run that isn't the builder's own skips),
and `extension/test/changes.test.ts` (2 tests: the model's deploys and the page drawing "Deployed to Acme Dev").
The screenshot run's `ticket-changes` page draws it.
