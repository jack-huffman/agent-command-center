## D-021 Every sidebar view also opens as an editor tab (2026-10-01)

The user wanted the sidebar's sections as full editor tabs. Each view's title
bar has an **Open as tab** button. Its tab is a webview:

- **Tasks** becomes the board planned for M7: one column per status.
- **Agents** and **Worktrees** become tables.
- **Environments** shows cards and the promotion paths drawn out.
- **Setup** shows a checklist with progress.

Tabs reuse the sidebar's data (the hub) and commands, so the two always agree.

Because tabs show ticket text, they follow strict rules that the author's SFDMU
extension doesn't:

- a nonce-only content security policy
- every value set as text, with no HTML string ever parsed (a test enforces it)
- only allow-listed `acc.*` commands accepted from the page
- VSCode's own icon font and theme colours
