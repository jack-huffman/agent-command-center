## D-048 Closed issues leave the board, and milestones aren't tasks (2026-10-03)

`acc intake github` read only open issues, so a task whose issue was closed
stayed Ready forever: GH-3 to GH-6 here. Milestone issues came in as tasks too,
so the Ready lane offered to dispatch a whole milestone to one builder.

- **A closed issue's task moves to done, if it never started.** Never started
  means `todo` with no `run`. A new rule allows `todo → done` for the `sync`
  actor only, and intake makes the move as `sync`, with the reason "Issue #N
  was closed on GitHub." A person still has `--force --reason`.
- **A task that started is left as it is, and named.** Someone closed the
  issue while work was under way, or after it. Whether that work lands or is
  dropped is a person's call, so the output says "#N was closed on GitHub;
  GH-N is still <state>" and changes nothing.
- **`skipLabels` on a GitHub tracker** lists labels whose issues aren't tasks.
  It's empty by default, and this repo sets `["milestone"]`. Labels match
  without regard to case, as GitHub's do. An issue with one isn't imported. A
  task already made from one leaves the ledger if it never started, with a new
  `task.removed` event, so `events.jsonl` keeps its whole history. One that
  started is named, like a closed one. A closed milestone is still a
  milestone: it's removed rather than counted as done.
- **Intake asks about each unfinished task whose issue wasn't listed**, one
  `gh issue view` each. That covers issues closed long ago, which a list of
  recently closed issues would miss, and issues `--label` left out. Done tasks
  are never asked about, so the usual run makes few calls. An issue GitHub
  can't show, because it was deleted or moved, leaves its task alone.
- **Finished tasks are never named.** A done task from a milestone issue would
  otherwise be named on every run.
- **Left for later:** a reopened issue doesn't bring its done task back, and a
  task that depends on a removed one still waits on it. Both need a person.
- `--json` adds `closed`, `removed` and `leftAlone`. The command's logic moved
  from the CLI into core (`intakeGithub`), beside `sync`, so it's tested with a
  fake `gh`.
