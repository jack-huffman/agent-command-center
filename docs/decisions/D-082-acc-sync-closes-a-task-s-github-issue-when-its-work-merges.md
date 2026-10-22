## D-082 acc sync closes a task's GitHub issue when its work merges, where the tracker says edits (2026-10-06)

When a task's pull request merged, acc sync moved it to done (D-033), but its
GitHub issue stayed open, because acc changed no ticket by itself (D-066).
About twenty finished issues stood open on this repo for that reason (GH-68). A
tracker that says `"edits": true` has opted in to acc changing its tickets, and
this repo's own GitHub tracker does.

- **GitHub Issues only, and only where the tracker says `"edits": true`.** When
  acc sync moves a task from review to done because its pull request merged,
  and the task came from a GitHub issue under the GitHub tracker that owns GH-
  keys (the first) and that tracker says `"edits": true`, acc closes the issue
  as completed. It closes it as the repo's account (D-007), or the clone's
  (D-028), the account sync reads pull requests with. One comment goes with
  it: "Done: pull request #42 merged into main.", naming `owner/repo#42` when
  the issue lives in another repo. A tracker without `"edits"` or with it
  false, a client's tracker, and a repo with no GitHub tracker are never
  touched: the task is done and gets its merged draft, as before.
- **Jira and Azure DevOps are never changed by this,** even with `"edits"`. A
  ticket's status there belongs to the client's workflow, with its own states
  and transitions. Their tasks keep the merged draft.
- **Once only.** The close is marked on the task's pull request (`pr.issue`):
  pending as the task moves to done, then closed, or left with why. acc looks
  at the issue first and leaves as it is one already closed, one that moved to
  another repo, and one GitHub can't find. Once settled, acc never touches it
  again, so an issue a person reopens stays open. A new pull request after
  rework starts with no mark.
- **A close that fails is named in sync's output** ("couldn't close issue #9
  (HTTP 502): the next sync tries again"), stays pending with why, and each acc
  sync tries again, even with no pull request left open. The Command Center's
  poll keeps running acc sync while a close is pending (`followsPullRequests`).
  A retry leaves an open issue GitHub marks as reopened (`stateReason`
  REOPENED), from any reopen, not only one since the merge: that's what acc
  can tell, and it errs toward leaving an issue open. A pending close is only
  settled while its task is done: one a person sent back to rework keeps its
  issue open. One a timed-out close
  may have closed (D-051) is recorded as already closed. A failure that repeats
  word for word leaves the ledger alone. A pending close whose tracker no longer
  says `"edits"` is left. Each gh call gets a minute, as sync's others do.
- **The close's comment stands in for the merged draft,** as a person decided.
  Where acc closes the issue, sync drafts no "merged" update. A close that took,
  or found the issue already closed, discards the task's unposted pull request
  and merged drafts, kept and marked, by acc sync, and says so. Promotion,
  deploy, blocked and question drafts are unchanged.
- **`acc sync --close-done` is a one-off tidy** for tasks done before this. It
  runs the normal sync, then takes each done task with a merged pull request
  and no close marked, under the same rule. It closes the open ones with the
  comment, and leaves those already closed, reopened (`stateReason` REOPENED) or
  moved, recording them as left. It lists every one with its outcome, and a
  second run does nothing. `--plan` only looks: it lists what the tidy would
  close or leave, without syncing, closing or writing, and says that a sync may
  also close the issues of tasks merged since it last ran.
- **Accepted:** two syncs at the same moment (two windows' polls, or a person's
  sync during one) can both close an issue and post the comment twice. gh's
  check that it's already closed narrows that to near-simultaneous runs, and
  it's this repo's own issues only. A done task with no pull request,
  such as one intake moved to done because its issue closed, isn't listed.
  `--json` carries each outcome, as it does for sync's changes.
- **Only a person runs the tidy.** Builders, reviewers, analysts and autopilot
  can't: the CLI refuses, `guardBash` refuses `acc sync --close-done`, and the
  builder's settings deny `acc sync --close-done*`. A plain `acc sync` stays
  anyone's.
- **This is the first time acc writes to a ticket unattended.** The Command
  Center runs acc sync every two minutes, so on a GitHub tracker with `"edits"`,
  issues close with no person at the keyboard. That's what `"edits"` opts in to
  now. On this repo the first sync after this closes #60, whose pull request
  merged while its task was in review. Run `acc sync --close-done --plan` and
  read the list before the tidy.
- Accepted:
  - On a GitHub tracker with several environments, the issue closes at the
    merge into the task's own environment, before any promotion, since D-033
    counts merged as done. Promotion and deploy drafts then comment on a closed
    issue.
  - `gh issue close --comment` comments, then closes. If the close fails after
    the comment went, the retry comments again. Looking first limits that to
    this one case.
- This amends D-066, for GitHub trackers with `"edits"`: "acc posts nothing on
  a ticket", an unattended sync posting nothing, and the merged draft. It
  amends D-033: sync's merge to done now closes the issue there too. The
  `"edits"` comment and error in the config, and the task page's read-only
  message, say what `"edits"` now covers.
- Not chosen:
  - "Closes #N" in the pull request's description. GitHub closes only on a
    merge into the default branch, ignores `"edits"`, and can't close once
    only; `acc land` writes only "refs #N" on purpose.
  - Moving Jira and Azure DevOps tickets to a done status, even with
    `"edits"`.
  - Closing issues for promotions, deploys, or pull requests closed without
    merging.
  - Showing a failed close in Needs you, Slack or the task page. It shows in
    sync's output.
