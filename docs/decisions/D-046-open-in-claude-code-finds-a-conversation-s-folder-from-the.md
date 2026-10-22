## D-046 Open in Claude Code finds a conversation's folder from the file it's saved in (2026-10-03)

The author reported that **Open in Claude Code** kept bringing up this
window's own chat, not the builder that needed them.

- **Cause:** a background builder starts in the main checkout and moves into
  its worktree, and saves its conversation under the worktree. Once stopped or
  blocked, `claude agents` reports the main checkout again. So the button took
  the conversation to belong to this window, and asked Claude Code to open it
  here. Claude Code didn't find it under this folder, and showed the window's
  current chat instead. GH-11 and GH-13 were both like this.
- **Fix:** the folder is found from the conversation file. The candidates are
  the session's reported folder, its task's worktree, every worktree, and the
  window's folders. The first one whose Claude Code project holds
  `<session>.jsonl` wins. A worktree opens in a new window and the conversation
  opens there, as D-041 intended. A session that has only just started may
  have saved nothing yet, so it uses its reported folder. Otherwise the button
  says it couldn't find the conversation and offers Watch, rather than open
  the wrong chat.
- **The same day, 0.19.1 said it couldn't find GH-13's conversation.** The
  author was clicking from the Agents list in another repo's window: the list
  shows every session on the machine. The candidates were that window's own
  folders and worktrees, so they never included this repo's worktrees. VSCode
  keeps each extension's log under its own logs folder, which is where the
  window and the clicks showed up.
- **So the file is found, not guessed.** First it's looked for under the likely
  folders, then anywhere in Claude Code's projects. Its folder is the `cwd` the
  conversation recorded whose name matches the folder it's saved in. That
  works from any window. A stand-in for VSCode, loading the built extension
  against the real repo from the other repo's folder, showed 0.19.1's message
  and then the fix opening GH-13's worktree in a new window.
