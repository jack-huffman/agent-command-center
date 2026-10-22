## D-084 A builder's conversation still opens in its worktree's window: Claude Code can't open it here (2026-10-06)

The author asked whether Open in Claude Code could open a builder in a new tab
in this window, not a new window (D-041). The author chose to keep the new
window, after this look at Claude Code for VSCode 2.1.291:

- **Its link finds only the window's own conversations.** `/open?session=<id>`
  takes a session and a prompt, no folder. The tab opens a session only from
  its session list, which reads the window folder's conversations alone
  (`includeWorktrees` is off). A builder's is saved under its worktree, so the
  tab would show a blank conversation, as D-041 found.
- **Linking the file into the window's folder isn't safe.** Claude Code refuses
  a symbolic link (`O_NOFOLLOW`, `lstat`) and, in places that write to it, a
  hard link (`nlink > 1`), so it could stop saving a running builder's
  conversation. And its list takes a conversation's folder from the last
  `relocated` record in the file's last 64 KB, else from the first entry. A
  builder's first entries name the main checkout, so a long run could resume
  there instead of in its worktree.
- Not chosen: a terminal tab in this window (`claude attach`, or `--resume` in
  the worktree), which works today but shows Claude Code's terminal view, not
  its panel.
- Look again when Claude Code's link can open a conversation saved under
  another worktree of the window's repo.
