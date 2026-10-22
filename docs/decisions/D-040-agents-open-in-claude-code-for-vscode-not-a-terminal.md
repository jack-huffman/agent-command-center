## D-040 Agents open in Claude Code for VSCode, not a terminal (2026-10-02)

Attaching to an agent opened `claude attach` in a terminal. Claude Code for
VSCode shows the same conversation far better, and with everything Claude Code
can do. Its documented link, `vscode://anthropic.claude-code/open?session=<id>`,
resumes a session's conversation, history and all, in a tab. It finds sessions
in the project's worktrees too.

- **Open in Claude Code** is the main way into an agent: on question cards, an
  agent's page, its row menu, task cards and the Overview. It replaces Attach
  where both would be. Attach in a terminal stays on agent pages and row menus,
  and is the fallback when Claude Code for VSCode isn't installed (acc offers
  to install it).
- **One conversation, one place.** Claude Code warns that using a session in
  two places at once mixes up its messages. So:
  - A background session that's still working or waiting is **taken over**:
    after you confirm, acc stops it in the background, waits until Claude
    Code no longer lists it as running, then opens the tab, where you drive.
  - An interactive one, open in a terminal or another tab, asks before
    opening a second view.
  - An ended session simply opens.
- **What doesn't carry over:** a builder taken over loses its builder settings
  (allow list, task identity and question hook), because the tab runs with
  your own. Its task stays Running until it's finished with
  `acc done <id>` or moved from the page.
- The link takes the full session id. The short background id is never sent.
