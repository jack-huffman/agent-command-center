## D-067 Builders keep the Mac awake; a stopped builder needs you and can be resumed (2026-10-06)

On 2026-10-05 GH-41's builder stopped mid-task when the Mac went to sleep. Its
turn ended with "API Error: Your computer went to sleep mid-response", the
ledger said Running for 90 minutes, and nothing told anyone. It was resumed by
hand, in its worktree, under `caffeinate -i`.

- **What Claude Code shows** (2.1.291, checked with a throwaway session):
  - A `--bg` session is listed with its `pid` as soon as it's found.
  - A turn that finished keeps its process: `pid`, `status: idle`,
    `state: done`. `claude stop` takes it off the list, and so does Claude Code
    once the job is done.
  - A session waiting on a person is `blocked`. Once its process has gone it
    stays listed as `blocked`, with no `pid`. GH-41 after the sleep was exactly
    that (its job said "API unavailable — retry").
  - `claude -p --resume <session>` keeps the session id, and while it runs it's
    listed as an `interactive` session with its own `pid` and that session id.
    It's gone when it exits.
- **So a builder counts as stopped** (`builderStopped`, shared by the Command
  Center, autopilot and `acc show`) when its task is running, `claude agents`
  answered, no resume of it runs, its run started or was resumed two minutes
  ago or more, and no session of it is at work: none has a process that isn't
  idle at the end of its turn (done, failed or stopped). A `blocked` session
  with a process is waiting in its own prompt, as before. A `blocked` one
  without a process is stopped: the analysis had counted every `blocked` as
  waiting, which would have missed GH-41. A conversation open in a terminal or
  a Claude Code tab, or a message to it running, is someone carrying it on.
- **It needs you,** with the last thing the agent said: the newest text in its
  transcript, Claude Code's own API errors included, read from the file's last
  256 KB. The card, the tracker's card and the task page say "Needs you: its
  agent stopped: <what it said>" with `debug-disconnect`, in orange: clipped on
  a card, in full on the page. The Overview lists "Its agent stopped", a notice
  says so once, and the status bar and badge count it. Its card's one next step
  is **Resume**, as the author chose (D-062); Watch and Open in Claude Code wait
  behind ⋯. The old background session's own state ("Needs you") is no longer
  shown beside it.
- **Resume** (`acc resume <id> [--message <text>]`) carries the session on in
  the folder its conversation is saved under (D-046), with the builder's
  settings, role and task, permission mode, and this clone's model and effort
  (D-036). It refuses unless the task is running with a session and its
  worktree, and nothing is carrying it on; an idle background session is
  stopped first (D-060). The claude runs detached, logged to
  `logs/<id>.resume.log`, with a marker in `resumes/<id>.json`. The marker is
  claimed before anything is looked at, holding acc's own process until the
  resumed claude's replaces it, so a person's Resume and autopilot's can't both
  start the conversation; a claim whose process has gone is taken over. The run records
  each resume (`run.resumes`), the Stop hook's reminder is cleared so the
  resumed turn is reminded too, and the event carries what it last said. The
  ready message names the task, quotes what it said, and asks it to check
  `git status` and `git log --oneline -3` (naming its latest commit), then
  finish or block. It covers a builder that simply ended its turn asking
  something too. Builders, reviewers and analysts can't run it: the CLI,
  `guardBash` and the builder's settings refuse it.
- **Autopilot resumes a stopped builder once a run,** as the author chose: a
  person's resume in between doesn't give it another go, and a new dispatch
  (such as its rework) does. A second stop waits for a person. A resume that
  fails is kept on the task, which needs you, until a resume works, by hand or
  by autopilot (D-055); one whose agent came back
  meanwhile waits for the next pass. A pass asks `claude agents` once, only when
  a task is running.
- **Keeping awake:** on macOS acc holds `caffeinate -i -w <pid>`: the
  background session's process after a dispatch, acc's own around a
  `--foreground` dispatch, a review and an analysis, and the resumed claude.
  Only `-i`: the display still sleeps, and closing the lid still sleeps the
  Mac; detection and Resume cover that. A task's caffeinate is written down in
  `awake/<id>.pid` and ended when the task leaves running (done, block, set,
  Abandon, or acc sync blocking it for a closed pull request) or autopilot finds its builder stopped, since a finished turn's
  process lingers. A pid that isn't a caffeinate any more is never killed.
  Other platforms start nothing.
- **D-060's reply** runs Resume's own command, so a clone's builder model and
  effort are no longer dropped, under `caffeinate -i`. It writes no marker:
  while it runs, Claude Code lists it with the conversation's id.
- Not chosen:
  - `caffeinate -i claude …`: a timeout would kill caffeinate and leave claude
    running. `-w` watches the process instead.
  - Reading Claude Code's own job files for why a session stopped
    (`~/.claude/jobs/<id>/state.json`). They aren't a documented format.
  - Keeping Linux or Windows awake, stopping the display or the lid sleeping,
    resuming reviewers or analysts, and asking `claude agents` in `acc list`
    and `acc status`, which stay fast and ledger-only.
- Accepted: `acc show` on a running task asks `claude agents` (up to 20
  seconds). A stopped builder's idle process keeps the Mac awake until the task
  leaves running or autopilot sees it, since the Command Center only reads.
