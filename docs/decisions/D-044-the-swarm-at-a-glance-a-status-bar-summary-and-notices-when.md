## D-044 The swarm at a glance: a status bar summary, and notices when a task changes (2026-10-02)

M7 asks for three agents watched from VSCode. The page shows everything, but
only while it's open, so:

- **One status bar item** says what needs you, what's running and what's in
  review, for example "1 needs you, 2 running, 1 in review", each count with
  its icon (bell, sync, eye) as well as its words. It turns the warning colour
  when something needs you, and it hides when nothing is in play. Clicking it
  opens the Overview.
- **A notice when a task changes** in a way a person would want to hear about:
  - a builder finished (Review)
  - a review passed (Land) or asked for changes (Re-dispatch)
  - a task was blocked
  - an agent waits on its own prompt (Open in Claude Code)
  - a pull request's checks failed or a reviewer asked for changes (Open pull
    request)
  - a pull request merged

  Each offers its next step and Show. They compare the board before and after
  each reload, so each change is said once. A task seen for the first time
  says nothing, and nothing is said until tasks, agents and worktrees have
  loaded once, so opening VSCode doesn't replay the board. They stay quiet
  while the Overview or Tasks board is on screen. A question an agent asks
  already has its own notice (D-030). `agentCommandCenter.notifications`
  turns them off.
- **Polls slow down, rather than stop, while the page is hidden.** The ledger
  is read every 15 seconds, which costs one stat. `claude agents` runs every 30
  seconds, only while a task is running or being reviewed. Open pull requests
  sync every 5 minutes. Worktrees and tracker boards still wait for the page.
- **Two commands M7 listed:** **Intake: new work for agents…** puts writing a
  task, importing GitHub issues and tracking a Jira ticket in one list.
  **Instructions** on a dispatched task's card and page opens the packet acc
  wrote for its builder.
- **A check runs without a builder's identity.** The first three-at-once run
  found it: GH-13's builder saw two CLI tests fail only inside a builder,
  because the `acc` they start inherited its `ACC_TASK`. Check commands now
  run without `ACC_ROLE` and `ACC_TASK`, and the CLI tests clear both. The
  same run deadlocked GH-12's check: a test ran `acc gate run` with no slot
  folder of its own, and waited for the machine's heavy slot, which its own
  check held. Heavy work a heavy check starts is part of that check, so it now
  gets a slot folder of its own, under the check's scratch folder. Both fixes
  are in the `acc` that builders run, so branches made before them pass too.
  GH-12's builder fixed the tests themselves on its own branch, so that fix
  arrives with its pull request.
- **Parallel builders can pick the same decision number.** GH-11's branch
  records a D-043 of its own, made at the same time as this one, so this one
  is D-044. Whoever merges second keeps both entries.

Note (D-162, 2026-10-15): a burst of more than three notices in one reload,
across every project, now shows as one notification that counts them. Each
change is still worked out once, and Slack still gets each one.
