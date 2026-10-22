## D-055 acc autopilot reviews, lands and reworks once, up to an open pull request (2026-10-05)

Until now a person, or the session driving acc, chained every step: review when
a builder finished, land when the review passed, re-dispatch a rework. The
author chose for autopilot to go up to an open pull request and stop there.
`autonomy` (D-014) was in the config, but nothing read it.

- **What the levels mean now.** This replaces DESIGN.md's old order, where
  dispatch came first and full opened pull requests. D-014 still holds: manual
  first, and nothing merges on its own.
  - `manual` (the default): nothing happens on its own. `acc autopilot` says
    so and changes nothing.
  - `review`: autopilot reviews, lands, and re-dispatches a rework once.
  - `dispatch`: as review, and it also starts Ready tasks up to `agents.max`.
    Only the meaning is recorded. The author chose review, so dispatch refuses
    with "not built yet".
  - `full`: read as dispatch, with a warning.
- **`acc autopilot [--once | --every <seconds>]`** does one pass, or one every
  so many seconds, at least 30. The gap is counted from the end of a pass,
  since a pass can hold a 45-minute review. Each pass reads the ledger again
  before each task, and takes one step for it:
  - in review, with no verdict on its latest commit and no review running:
    review
  - in review, passed on its latest commit, with no open pull request or one
    behind that commit: land
  - in rework, never re-dispatched by autopilot: dispatch. This is counted from
    the task's history for its whole life. Every later rework is a person's,
    even after a person re-dispatched it in between.

  A task reviewed in one pass lands in the next. The config is read again
  before each pass, so setting `autonomy` back to `manual` stops it.
- **It acts as the orchestrator.** Lands and dispatches are `orchestrator`, by
  `orchestrator:autopilot`. A review stays the reviewer's move, by
  `reviewer:<id> for orchestrator:autopilot`, since only a reviewer or a person
  may send work to rework. It never merges, waives, deploys, promotes, or starts
  a task that's to do. Builders, reviewers and analysts can't run it: the CLI
  refuses them, `guardBash` refuses it, and the builder's settings deny it.
- **A pull request records the commit it landed** (`pr.sha`), so autopilot can
  tell when one is behind its branch. One landed before this is compared with
  the branch's `origin` ref instead. Otherwise the first pass would land, and
  comment on, every open pull request again.
- **One autopilot a repo.** It holds `autopilot.lock` beside the ledger for as
  long as it runs. A second is refused at once, naming the first one's pid. The
  lock never goes stale with age, because one pass can hold a 45-minute review.
  Only a dead owner frees it, as after Ctrl-C. Autopilot never takes the
  heavy-check slot, so builders' heavy checks run as before.
- **A failed step is kept on the task** (`autopilot.failed`: the step, the
  commit, the state, the reason and when), written as the orchestrator. The
  task shows as needs you in `acc list`, `acc status`, `acc show` and the
  Command Center, with the reason.
  - Autopilot doesn't try that step again on that commit. A new commit lets it.
  - A review, a land or any move clears it, so doing the step by hand does too.
  - A full agent cap, or a ledger busy for the moment, waits for the next pass
    and isn't recorded.
- **Jira and Azure DevOps comments** can't be posted unattended: land hands
  them to the extension, which posts as you. As the author chose, autopilot
  lands anyway. It prints `! Post this on <KEY>` in orange with the text, lists
  it under `pendingComments` in `--json`, and leaves the task as it is.
- **The Command Center**, kept small as the author chose. A task's row carries
  the failure. Its card says "Needs you: autopilot couldn't land: <reason>" with
  the bell, in orange, and so does its tracker card. The Overview lists it as
  "Needs you: autopilot couldn't land", with the reason beside it and the step
  to take by hand. The reason goes beside the label there because the label's
  column is narrow. This replaces the catch-all, which said the task's agent
  was waiting in its terminal. Hosting autopilot in the extension, with a
  switch for it, came later (D-064).
- Not chosen:
  - A lock that goes stale with age. A second autopilot would break a live
    one's lock during a long review, and both would act on the same tasks.
  - Keeping failures in a file beside the ledger. The hub already watches the
    ledger, and `displayState` stays free of file reads.
  - Running `acc sync` in each pass. The Command Center already syncs every 2
    minutes.
