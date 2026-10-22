## D-095 A finished task's leftover session reads as Finished, and can be stopped (2026-10-07)

GH-93. The author's Agents tab listed four sessions under "Elsewhere on this
machine" in orange as Needs you, for tasks done long ago. A builder's background
session stays listed after its last turn, and Claude Code says it waits. Nobody
waits on it, but it counted toward Needs you everywhere.

- **Finished** is acc's word for a session whose work is over by the ledger: the
  builder of a task that's done; a builder of an earlier run of its task; a
  reviewer whose verdict is recorded; an analyst whose analysis is the task's
  current one. acc never carries an earlier run on: a re-dispatch starts a new
  background session, and Resume carries on only the current run (D-067). So an
  earlier run's builder is finished while its task runs again.
- **How it reads:** a check and a muted "Finished", on the Agents tab, the agent's
  page and the Overview, with no orange edge. It never needs you: not in the
  Agents tab's count or the rail's badge, the Overview's Needs you or its badge,
  the launcher's or the status bar's. The Agents header counts it apart, "5
  finished". One that's busy, or has a question waiting in the Command Center,
  keeps that look. It isn't Claude Code's own "Done", which says a background
  session ended its turn; Finished says acc knows its work is over, whatever
  Claude Code says about it.
- **Tied by ids only (D-087).** A task's current builder is found as `sessionsOf`
  finds it. Earlier runs are read from events.jsonl: each dispatch's run, and a
  session its builder's SessionStart linked to the run. That file is never
  trimmed, so the first look reads all of it, once a window, and each look after
  reads what was added. A run that recorded no ids, a task no longer in the
  ledger, and an analyst whose analysis was replaced leave a session untied.
- **Untied sessions read as Claude Code says,** as before. So do a task's current
  builder while the task isn't done, and a review or analysis under way. The
  current builder of a task in review or in rework has run acc done and may sit
  waiting at its prompt; the author chose to leave it as it reads for now.
- **Elsewhere on the machine:** a session is tied through its own repo's ledger,
  wherever the repo is. Its folder's repo is a builder's worktree's by its path,
  as its folder reads (D-090), else the nearest folder holding .git (GH-83). A
  linked worktree's .git file is followed to the shared git folder through
  `gitdir:` and `commondir`, with plain file reads, never git, for the ledger
  only: how its folder reads doesn't change (D-090). Each ledger, its events, its
  reviews and its analyses are read again only when one changes, since `claude
  agents` is asked every 5 seconds while the page is on screen.
- **Stop finished sessions (N)** sits on the Agents header while there are any. N
  counts finished background sessions that Claude Code still holds: one with a
  process, or one still listed without one. The author's four had lost their
  process and were still listed, blocked, so a count of processes alone would
  have offered nothing: checked on 2026-10-07, when `claude agents` listed
  GH-11, GH-13, GH-41 and GH-60 as background sessions, blocked, with no pid. One already done, stopped or failed with no process has
  ended, and isn't counted. It asks `claude agents` again, lists each by name and
  folder in one dialog, and asks once. Then it asks `claude agents` again and runs
  `claude stop` for each that is still finished, one at a time, and says which
  stopped and which couldn't. Transcripts and worktrees are kept. It never stops a
  task's current builder while the task isn't done, a review or analysis under
  way, an untied session, an interactive one, or one that's busy or asking.
  Reviewers and analysts run as `claude -p`, listed as interactive: they read
  Finished, and Stop leaves them. A row's own Stop is as it was.
- Not chosen: stopping a builder on acc done, land or merge; tying a session by
  its name; naming a session elsewhere for its task, or linking its page to it;
  a Stop for interactive sessions.
