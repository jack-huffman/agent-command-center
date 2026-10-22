## D-186 A builder that never started needs you, and "can't tell" is a state, not "fine" (2026-10-21)

On 2026-10-21 a dispatched builder (T-90) never started: Claude Code's background service was down after
it updated itself, `claude agents` failed on a missing control socket, and no conversation was ever
written. acc showed the task as Running for 18 minutes, because `builderStopped` reads no answer as "not
stopped", and the dispatch recorded the session's id anyway.

- **A dispatch proves its builder started** (`awaitStart` in `started.ts`). After `findSession`, it waits
  up to `START_WAIT_MS` (60 s; `startWaitMs` for tests) for the session to be listed with a process, or
  for its conversation to be written under Claude Code's projects folder for the worktree
  (`transcriptWrittenAt`). Without either, the task isn't moved: it stays where it was with
  `notStarted` (reason, place, and a model and effort where they were picked), which `displayState` shows
  as Needs you in To do and Rework; the half-started background session is stopped; the dispatch's
  `start` step fails with the reason, and `acc dispatch` prints Needs you and exits 1. Any move ends
  `notStarted`. Autopilot leaves such a task for a person, and a held start counts it as failed.
- **Dispatch again** (`dispatchAgain` in `again.ts`, `acc dispatch <id> --again`, the Command Center's
  `acc.task.dispatchAgain`) is a person's. A task whose builder didn't start is dispatched with what
  `notStarted` kept. A running local task is set back to To do, its listed session stopped and any resume
  ended, then dispatched on this Mac; its run keeps a picked model and effort. Both moves carry
  "Dispatched again: <why>" in its History.
- **"Can't tell" is a state** (`builderUnseen`). When `claude agents` hasn't answered (exit, unreadable
  output, or `SERVICE_DOWN` in its error) for longer than `STOPPED_GRACE_MS`, a running local task whose
  run is older than the grace needs you: "unanswered", which names what to try in process words (D-132),
  or "quiet" when its conversation, or its start where none was written, is older than the quiet limit.
  There is no local quiet setting, so `quietMs` reuses `agents.cloud.quietMinutes` (default 120). The
  Command Center keeps since when in the hub (`agentsSilentSince`); `acc show` keeps it in the repo's
  state (`noteAnswer`, `agents-silent.json`), so its first look without an answer only starts the clock.
  Dispatch again leads for "quiet" and is behind ⋯ for "unanswered", where the builder may still be at
  work. `builderStopped` is unchanged: no answer still never reads as stopped.
- **Stale sessions don't count.** `sessionsOf` finds a builder by name only among sessions started no
  earlier than `RUN_SLACK_MS` (2 min) before its run was recorded, so an old `blocked` session of the same
  name is never taken for it; ids recorded on the run are matched as before.
- Out of scope: restarting Claude Code's service from acc, and cloud builders, whose branch says whether
  they're quiet (D-140).

**Note, 2026-10-21 (T-93): Dispatch again never stops a builder acc can see.**

- `dispatchAgain` takes `unseen` (from `builderUnseen`, by way of `unseenNow` in `unseen.ts`) and refuses
  a running task without it, with `againRefusal`, before it stops or moves anything. `acc dispatch --again`
  looks at `claude agents` just before; the Command Center passes the silence it has kept
  (`--silent-since`), so the two agree. Its `acc.task.dispatchAgain` shows the same reason as a warning
  where the row isn't `unseen` or `notStarted` (`dispatchAgainOff`), and runs nothing.
- A missing `claude` is its own state, `claudeMissing` in the hub: kept out of the silence clock, shown at
  once as `missing` with its own words ("Claude Code isn't found" and what to install), with no Dispatch
  again, which needs `claude` to start another builder. It no longer reads as "background sessions aren't
  answering".
- Only this run's conversation counts: the rows, `acc show` and Dispatch again read it through
  `unseenFrom`, which passes the run's start (`runWrittenAt`), not 0. An earlier run's conversation in a
  reused worktree is never taken for this run's writing.
- `sessionsOf` and `findSession` both drop a same-named session with no start time once the run has one,
  and `findSession` returns `FoundSession`.
