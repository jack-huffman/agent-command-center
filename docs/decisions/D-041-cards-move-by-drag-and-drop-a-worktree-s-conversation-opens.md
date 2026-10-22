## D-041 Cards move by drag and drop; a worktree's conversation opens in its own window; agent pages fit the window (2026-10-02)

- **Drag a task's card to another lane** of the agent board to move it.
  - A card carries the lanes acc's move rules let a person take it to. While
    you drag, those lanes stay bright and the rest dim.
  - Dropping asks for a reason when the rule wants one. Dropping in Running
    dispatches the task, after a confirmation.
  - acc still decides: a refused move snaps back, with the reason.
  - Going back to to-do shows one lane, the one it will land in: Ready when
    nothing it waits on is unfinished, otherwise To do.
  - Cards no longer carry a Move button. Move stays on the ticket page and in
    menus.
- **Open in Claude Code opened a blank conversation for builders.** Claude Code
  opens a conversation only if it belongs to the window's own folder, and a
  builder's belongs to its worktree. So when the session's folder isn't the
  window's, acc opens that folder in a new window, remembers the session for
  two minutes, and the new window opens the conversation as it starts. That's
  also where a builder is best driven: in its own checkout.
- **An agent's page fits the window.** The heading stays, and the timeline
  scrolls in its own box, following the newest step.
  - Runs of tool steps between the agent's messages fold to one line ("8 steps:
    ran 5 commands, read 2 files, edited 1"). The latest run, and any step that
    failed or is running, stays open.
  - Only the last 25 blocks show, with Show earlier for the rest.
  - The recap shows two lines, without Claude Code's "(disable recaps in
    /config)".
