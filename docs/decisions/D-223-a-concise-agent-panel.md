## D-223 A concise Agent panel: the state, its checks in one line, the main actions, and the rest in Details (2026-10-28)

T-142. The person, on a task page's Agent side panel: "can we make it more concise? We don't need that depth of
info normally, but it should be available in an expandable section if we want to review it." The panel listed
State, Environment, Session, Model, Builder, Runs on, Branch and Worktree, then every check on two lines, then
seven buttons. This amends D-214's collapsible Agent panel (T-132), in the calm style of D-217, D-218 and D-220.
The panel still folds to its header line; what is inside it changed.

- **At a glance** (`extension/webview/agent-panel.ts`, its words in `extension/webview/agent-glance.ts`): the
  state as its chip, one line for the checks, and "Waiting on" the tasks it waits for where nothing blocks it. A
  blocker's reason is not drawn here: the page's "Why it's blocked" notice above the tabs says it, each fact once.
  The session's chip shows beside the state only where it adds something: not where it says the same, and not
  where the two disagree.
- **The checks in one line**, with an icon and words, orange where a person must look: "3 failed: validate,
  violations, stray-files · 1 needs you: flow-tests · 4 more", "2 checks passed", "5 checks, not run on this
  commit". Only a check that failed or needs a person is named; the rest are counted ("4 more"), and their rows
  are in Details. Where none failed or waits, each kind is counted: "4 passed, 1 not run".
- **A state and its session that disagree** are said once, plainly, instead of two chips. This case is real in the
  model: a blocked or in-review task keeps the session it was tied to (`rowSession` in
  `extension/src/logic/agents.ts`), and that session can still read Working. The line is "Blocked: its builder is
  still working" (or "In review: …", or "Sent back: …" were a sent-back task given one), with a warning icon. A running task and its Working session are one
  chip; a session that needs a person beside a blocked task is not a disagreement and keeps its chip.
  `TicketAcc` carries the task's own `state` for this.
- **Actions**: the one next step (or Move where it has none) and at most two that fit the state: Move and Watch
  by default, Unblock and Watch for a blocked task. Every other action is under "More actions", a fold closed at
  first, in the same grid. An action that can't run now is still there, off, with its reason in its title and its
  `aria-description`, as before. `splitActions` returns two lists that hold the same commands as the one it was
  given, and a test compares them by command.
- **Details**: a fold under the actions, closed at first, remembered per ticket in the tab's `opened` list
  (`agent-details:<project>#<key>`, as the page's other folds are). It holds Environment, the Session in its own
  words, Waiting on (whenever the task waits on others, a blocked one too), Model and effort, Builder session,
  Runs on, Branch and Worktree, and every check on its own lines with Accept anyway… where it applies. Nothing
  the panel showed is gone: each is one fold or one menu away.
- **Checks**: `extension/test/agent-panel.test.ts` draws the panel for a task being built, blocked, blocked with
  its builder working, in review, sent back and not in the work; it pins the check words, the fold's default and
  memory, every action by command and the off action's reason. The behaviour run has a case for the panel in a
  browser and a mutant, "a failed check isn't named in the summary", which it must catch. The screenshot run draws
  the panel blocked, blocked while its builder works, with a failed check (ticket-agent-failed), with Details open
  and with More actions open (each page opens only its own fold), at every width and theme. Every other task page's
  shot opens both folds by default, so what they hold is measured on each page. The Open in Claude Code action's tile in More actions
  says Claude Code, so no label is cut off; Details' Session row shows only where its words differ from the state's.
