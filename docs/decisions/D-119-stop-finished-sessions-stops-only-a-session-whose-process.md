## D-119 Stop finished sessions stops only a session whose process still runs (2026-10-08)

D-095 counted a finished background session with no process, still listed as blocked, as one to stop,
on the belief that `claude stop` clears it. It doesn't. Claude Code answers "couldn't confirm <id> was
stopped — the background service may be restarting" in under a second, and the session stays listed.
The author pressed Stop finished on nine such sessions and got all nine back as a wall of reasons.

- **A session counts only while its process runs** (`pid`). One without has nothing to stop: it costs
  nothing, and stays in its repo's Finished fold. When no session in a fold can be stopped, the fold
  has no Stop all, and the header has no Stop finished.
- **A failure is one line.** The notice says how many of how many couldn't be stopped, and the
  Command Center's log has each one's reason.
- Not chosen: `claude rm`, which also lists a session as gone. It deletes the session's worktree, and
  Stop finished promises to keep worktrees.
