## D-060 You write to an agent from its page (2026-10-05)

The author asked for an agent's chat to open "as a tab too", in the same
window. **Open in Claude Code** opens it in its worktree's own window (D-046).

- **Why not a Claude Code tab here:** the extension's open link takes only
  `session` and `prompt`, and every tab works in the window's first folder
  (Claude Code for VSCode 2.1.289). A builder's conversation is its
  worktree's. Resuming it under this window's folder would carry the builder
  on in the main checkout, outside its worktree. Adding the worktree to this
  window's folders restarts the extensions, and Claude Code still looks only
  in the first folder.
- **So the agent's own page takes messages.** That page is already a tab here
  (D-030). A box under its timeline sends to the session's own conversation:
  - `claude -p <message> --resume <session>`, in the folder the conversation
    is saved under (D-046)
  - with the rules it was dispatched with: the builder's settings, so its
    allow and deny lists and its hooks, `ACC_ROLE`, `ACC_TASK`, its permission
    mode, and its model and effort

  It shows in the output panel, and its answer streams into the timeline
  above. Questions it asks still come to the page (D-030).
- **One place at a time.** You can't write while it works, waits on a
  question, or is open in a terminal or a Claude Code tab: the box says why.
  An idle background agent is stopped first (`claude stop`), so the
  conversation never runs in two places.
- **Open in Claude Code** stays, for Claude Code's own view.
