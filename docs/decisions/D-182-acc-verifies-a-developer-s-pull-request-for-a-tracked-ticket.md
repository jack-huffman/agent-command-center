## D-182 acc verifies a developer's pull request for a tracked ticket, and drafts a QA comment a person posts (2026-10-21)

T-84. Builds on D-032, D-066, D-171 and D-179. A TA checks tickets that other
developers built. `acc review` judged only acc's own builders' branches: it
needs a task in review with acc's worktree.

- **It finds the pull request.** `verify` (`packages/core/src/verify.ts`)
  signs in to GitHub as the project's account, as `acc land` does, and lists
  the open pull requests on the project's repo whose title names the ticket's
  key (`gh pr list --search "<key> in:title"`) or whose branch does (`gh pr
  list` filtered by `headRefName`). A key counts only as a whole word
  (`namesKey`): ACME-1 is not ACME-12. One found is used. None, or several,
  is refused, and acc keeps what it found in
  `.git/acc/verifications/<task>.found.json` for the person to choose from.
  `--pr <number|url>` names one; a link to another repo is refused, with why
  (`namedPr`).
- **It checks out the head with no branch.** `checkoutHead` fetches
  `refs/pull/<n>/head` and the base branch from origin, and adds a detached
  worktree at the head's commit under the worktree root, as `verify-<task>`.
  A detached worktree there at the same commit is used again; at another
  commit it is replaced; one on a branch is refused. It runs the project's
  worktree setup (`setupWorktree`, now exported from `dispatch.ts`). acc never
  commits or pushes from it.
- **It runs the checks there.** `runGates` runs the project's required gates
  in that worktree against the pull request's base, and writes receipts by
  sha as it does for any commit. No floor is raised. A base that is no
  environment's branch is checked with no org (`baseEnvironment`). A gate that
  couldn't run (status error, such as validate with no org) is kept as
  skipped, with "It couldn't run here:" and its reason (`verifyCheck`), never
  as passed.
- **A read-only agent reviews it.** It runs as the reviewer does, with the
  reviewer's model and effort, Read, Grep and Glob only, in the verification's
  worktree. Its prompt (`verifyPrompt`) holds the diff against the base
  (`baseRef`, now exported from `review.ts`), the ticket's description, acc's
  drafted criteria where they exist (`readCriteria`), each check, and the
  project's rules. It says the work is a developer's, and the findings are for
  a QA comment. It answers to `VERDICT_SCHEMA`, read by `parseReview`. The
  verification is kept at `.git/acc/verifications/<task>-<sha>.json`. The
  task's state never moves.
- **It drafts the QA comment.** `qaComment` writes the verdict in one line,
  the pull request's link and commit, each check's result, each criterion met
  or not with its evidence, and the findings. A new `verify` update event
  (Slack takes it too) holds it as a draft (`draftUpdate`). The prompt says
  the comment must pass `acc ste check`; a comment with hard findings goes back
  to the verifier once, in the same session, as drafted criteria do. Nothing
  reaches the tracker or GitHub until a person posts the draft.
- **Commands.** `acc verify <id> [--pr <n|url>]` runs it, `acc verify show
  <id>` reads the latest back, or the pull requests to choose from, and `acc
  verify clear <id>` removes the worktree, the stored results and the choice;
  the QA comment's draft stays. Each takes `--json`. A builder, reviewer or
  analyst can't verify or clear. `acc verify` and `acc sync` clear the
  verification of a task that left the ledger (`pruneVerifications`). An id
  longer than 100 characters isn't a task id (`fileId`, `TASK_ID_MAX`), so
  a junk one is refused before a path is built from it.
- **The task page.** Each task's page has a "Verify the developer's work"
  section (`ticketVerify`, `extension/src/model/verify.ts`): the pull request
  found, or the choice with Verify this one for each, each check with its icon
  and label, each criterion met or not, the findings, and "Open the QA
  comment", which scrolls to the comment's update draft in the Activity and
  puts the cursor in it. It is off, with why, for a task acc's own builder made
  ("acc reviews its own builders' work"), a task with no tracker ticket, and a
  project with no GitHub repo; its buttons are off while a verification runs.
  Verify runs in the output panel, where its steps show (D-171). The process
  words are "Verify the developer's pull request", "See the verification" and
  "Clear the verification".
- Tests: `packages/core/test/verify.test.ts` has 17, with a real origin on
  disk and a runner that records every command: one pull request found, none,
  several, and one in another repo; the detached worktree at the head with no
  branch; a gate that couldn't run kept as skipped; the prompt's diff, ticket
  and drafted criteria; the stored verdict and the unmoved task; no `git
  push`, `git commit` or `gh` write; the wording fix; clearing and pruning.
  `packages/cli/test/verify.test.ts` has 6, with a fake gh and claude.
  `extension/test/verify.test.ts` has 15: the section and its off states, the
  choice, Open the QA comment, the logic's calls to acc, and the messages.
  That is 38 tests. The screenshot run adds three pages over ACME-21's tab: a
  passed verification, one that needs changes, and the pull-request choice.
- **Near tests.** The new `extension/src/verify.ts` left `extension.ts`
  gathering under half of its folder, so near-tests stopped guessing it as the
  folder's index. `gates.nearIndexes` now names `extension/src/extension.ts`
  and `extension/src/areas.ts`, so a change there still runs `activate.test.ts`
  and the area tests.
- Not chosen: Bitbucket and Azure DevOps pull requests; posting the comment
  or moving the ticket's status; and a manual test checklist.
