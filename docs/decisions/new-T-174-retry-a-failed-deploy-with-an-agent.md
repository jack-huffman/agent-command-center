## D-T-174 Retry with an agent: a failed or missing deploy to the development org goes back to its builder (2026-11-01)

T-174. Asked whether a waiver of the deploy gate should let autopilot merge a Salesforce ticket, the person said:
"If that fails, we should have a way to retry with an agent". So a waiver stays a person's merge (D-244), and a
builder's deploy to the development org that failed, or never ran, gets one action that hands it back to an agent.
It adds to D-067 (resume) and D-248 (the Changes tab's rows).

- **When it shows** (`deployRetryCase`, `deployRetryShown`, `packages/core/src/deploy-retry.ts`). A Salesforce task
  with work on its branch, running, blocked or in review, whose pull request hasn't merged, and whose own
  environment's row by acc's record (D-248) says Deploy failed or Not deployed. A deploy that never ran shows it only
  once its builder isn't at work: a builder still building hasn't got to its deploy yet. A failed deploy shows it
  while the builder runs too, off.
- **Off with why** (`deployRetryEnabled`): a project that isn't Salesforce, nothing to retry (with which reason),
  the builder still at work (a session of its at work, or a resume under way, `builderRuns`), a cloud builder, its
  worktree not on disk, or no conversation to carry on.
- **One command, every door** (`DEPLOY_RETRY_COMMAND`, `acc.task.retryDeploy`). The CLI is `acc resume <id>
  --deploy`, so it sits behind resume's own guards: refused by role for a builder, reviewer or analyst, and in the
  hook's person-only list. The Changes tab's development row and a banner above the tabs (`deploy`, after a
  blocked one, closed by default as D-250's are) draw it, and run that command. A click waits while acc starts the
  builder, and one that didn't start says why under the button.
- **What the builder is told** (`deployRetryMessage`): the failed deploy, where and when, with its reason on one
  line, or that it stopped before it deployed. Deploy again with `acc gate run deploy` and read the result. A
  failure in its own work: fix it, commit, and deploy until the deploy and the coverage floor (D-238) pass. A
  failure outside its work (an expired login, a lock, an org that is down, a test another person broke): change no
  code to get round it; say so in a blocked note with options, and stop. Then the finish line as before.
- **Back to running.** No rule moves blocked or review to running, and none is added: `acc set` and the move menus
  stay as they were. `resume` takes `move` (a retry's reason), and moves the task to running in the same write that
  records the resume, after checking it as a rework's restart (`retryMoveProblems`: the project's cap, and an
  environment no agent works on), before anything starts and again in that write. A plain resume still refuses a
  blocked task.
- **Then autopilot goes on**, with nothing new in the merge: the builder's acc done needs its own deploy on its last
  commit (D-206), and D-244's merge needs a passing deploy on the very commit its review read. A retry that changed
  no code deploys on the reviewed commit, so its review still holds and autopilot merges it. One that changed code
  moves the head, so no review holds there; autopilot reviews it first, and the merge refuses until it does.
- Not chosen:
  - A new rule from blocked or review to running: every move menu would offer it, with no builder behind it.
  - Letting the retry run when the builder's session is busy, or in the cloud: one conversation at a time (D-060),
    and a cloud builder's session isn't on this machine.
  - Opening the banner by default: D-250 keeps banners closed; the development row shows the action without a click.
- Checked by `packages/core/test/deploy-retry.test.ts` (11 tests: when it shows, each edge case with nothing to
  retry, each reason it's off, a never-deployed builder hidden while it works, whether the builder runs, the
  message's words, the resume from blocked with its move and its History, from review and from running, every
  refusal with nothing started and the state kept, a plain resume still refused, and the move's checks),
  `packages/core/test/merge.test.ts` (2 tests: a retry with no code change merges on its review; one that changed
  code is reviewed again first, with the mutant that merges on the old review caught),
  `extension/test/deploy-retry.test.ts` (8 tests: the action on, never deployed, off with each reason, waiting and
  failed, nothing shown for a generic project, a passed deploy or a builder at work; the development row alone draws
  it and its click sends the message; off, it sends nothing; the banner after a blocked one; the message's check)
  and `extension/test/looks.test.ts` (`RETRY_LOOK` walked). The screenshot run draws `ticket-deploy-retry` (on),
  `ticket-deploy-retry-off` (off while the builder runs) and `ticket-deploy-retry-never` (never deployed, off with its
  worktree gone), each with the banner open, at every width and theme.
