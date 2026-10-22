## D-030 Agents ask, and commands answer, in the Command Center (2026-10-02)

Working with agents meant finding the right terminal: attaching to see what a
builder was doing, attaching again to answer its permission prompt, and reading
setup's fixes scroll past in a terminal tab. Now the page does all three, and a
terminal opens only for a command that needs a keyboard of its own.

- **Questions come to the page.** Sessions acc starts get a PermissionRequest
  hook in their `--settings`: builders through `acc dispatch`, and free-form
  agents started from the page. The hook is `acc hook permission`.
  - Each permission prompt, and each AskUserQuestion, goes into
    `~/.acc/questions/` as a file only you can read. The hook waits there for an
    answer.
  - The page shows it as a card. A prompt gets Allow, "don't ask again this
    session" (when Claude Code offers a rule) and Deny with an optional reason.
    A question gets its options, or a typed answer, or Let it decide.
  - A notification carries the same choices when the page isn't on screen. It
    offers Allow only when the whole command fits in it.
  - Tested against a real background session: two commands and a question were
    answered from the queue, and the agent carried on with the answer.
- **The hook never strands an agent.** Each open window writes a listener file
  for its folders every 15 s.
  - With no window listening for an agent's folder, the hook prints nothing at
    once, and Claude Code asks in its own prompt as before. The same happens
    when the last window closes, when the hour-long hook timeout is near, or
    when you choose "In the terminal".
  - It never exits 2, which would block the tool.
  - Claude Code shows its own prompt while the hook waits. If you answer there
    instead, the session is seen working again, and the window ends the hook,
    which withdraws the card.
- **Each agent has an activity page.** Watch (now the main action on a running
  task) opens a tab with the session's timeline:
  - the task instructions, folded
  - what the agent said, as formatted text
  - each tool as one sentence, with its command and an expandable result
  - Claude Code's own recap, and the waiting question to answer in place
  - It reads the transcript as it grows, once a second while the tab is on
    screen. An ended session's page still reads.
  - The transcript format is Claude Code's own and unstable, so it's read
    loosely: unknown records are skipped, and the page says so when nothing
    could be read. Attach stays for a real conversation.
- **Commands run in an output panel.** Setup's Do it, sf org login, acc init and
  doctor, Open org and Compare run as child processes, and their output streams
  into a panel at the bottom of the page.
  - The step shows that it's running, and checks itself afterwards. The status
    bar shows a running command.
  - When a command goes quiet on a question (`[y/N]`, `Password:`, `Name:`), the
    panel asks it for you: Yes and No, or a box. A password goes only to the
    command, and is never shown or saved.
  - Stop, Run in a terminal (it starts again there) and Dismiss are on the
    panel's toolbar.
  - Fill-in-the-blanks commands, `claude`, `sudo`, `ssh`, editors and
    `gh auth login` still open a terminal.
- **Why files and a hook, not an API.** Claude Code has no documented way for
  another program to answer a running background session. The hook is
  documented, works in background sessions given through `--settings`, and can
  answer AskUserQuestion through `updatedInput.answers`, which we confirmed
  first. Files in one machine-wide folder work across repos, worktrees and
  windows, like the heavy-check slots (D-024). The first answer wins: a
  hard-linked answer file can't be written twice.

Also fixed: the row menus still named the old per-section webviews, so they
were empty on the D-029 page. They now name `acc.home`, and a test ties them to
the page's view type. The screenshot script's narrowest width is now 500 px,
because Chrome lays out no narrower and cropped 480 px shots.
