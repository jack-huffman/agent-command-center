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
  holds the job id, the components, which were verified, the tests and their result, with every command in
  its log. The task gains `deploys` in the ledger: the org, the commit, the time, the paths, the components and
  the tests, and the ticket's Changes (D-189) say "Deployed to <org>", when, and what the tests found.
- **Required beside validate.** Wherever a Salesforce project's `gates.required` names `validate`, `parseConfig`
  puts `deploy` right after it (`withDeploy`), so `acc gate run` validates, then deploys, and `acc done`
  refuses until deploy passed on the last commit, as for any required gate. `acc init` writes it. The gate
  fails until validate passed on the same commit.
- **Only the builder's own run deploys.** `acc gate run` in a task's own worktree, on its branch, passes
  `deploys` (as it passes `raise`, GH-99). A refresh, a verify of a developer's pull request, a cloud collect
  and the merge queue run the gate too, and it skips there, saying so; the skip satisfies the requirement,
  since the org already has what the builder deployed. A cloud builder's change isn't deployed by its collect:
  `acc deploy` takes it after the merge.
- **Never where it mustn't.** The gate errors on an environment with no org, a protected environment and
  production (D-018); it fails on an environment-specific file (D-016), a deletion or rename, Apex without
  its tests, an uncommitted tree, and validate not passed. None of these reaches sf.
- **Taking turns.** A deploy holds a one-slot lock per org, `~/.acc/heavy/orgs/<org>/`, beside the heavy-check
  slots (`withSlot`, D-092), with "Deploy to <org>" and the task as its owner. Before it, the gate reads the
  tasks in flight on the environment (`inFlightFiles`, D-093, as T-103's team does): one that shares a changed
  file with this task makes the gate fail, naming the task and file, with the words to block on. The packet
  says to block and wait. A task that shares no files deploys at once.
- **Through acc only.** The builder's hook keeps refusing a raw `sf project deploy start|quick|resume`, now
  pointing at `acc gate run deploy`; the deny list keeps `sf project deploy start*` and `quick*`; the gate
  runner's guard (`assertCheckOnly`) allows a real `deploy start` to the deploy gate alone, never a quick
  deploy or a resume; `acc deploy` stays a person's. The packet's Salesforce lines say validate, then deploy,
  verify and test in the build org, and say in the note what's in the org and what the tests found; "Never
  deploy" becomes never except through `acc gate run deploy`, and never to a protected org.
- **After the merge.** `acc deploy <env>` leaves out each file a task's own deploy put in the org at the
  content the branch now has (`deployedByTasks`, by git's blob id), says who deployed what, and when nothing's
  left it says so and moves the environment's deploy record on. A file changed since goes again.
- **The runner.** A gate may now plan several commands (`StepsPlan`): the runner gives it an `exec` that
  nices, logs and guards each, and the receipt's command is the first. `GateInput.run` carries what such a
  gate needs: the repo's state, the commit, the task, the slots, and whether the run may deploy.

Out of scope: scratch orgs per task, and deploying deletions.

Tested in `packages/core/test/deploy-gate.test.ts` (16 tests: the deploy's arguments, the verify calls, the
receipt and the task's record, each refusal, the per-org lock, the overlap wait, acc done's refusal, the guards
and the settings, the config, the readers, and acc deploy after a merge), two hook fixtures (`acc gate run
deploy` allowed, `acc deploy` denied), and `extension/test/changes.test.ts` (2 tests: the model's deploys and
the page drawing "Deployed to Acme Dev"). The screenshot run's `ticket-changes` page draws it.
