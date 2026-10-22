## D-129 A board click opens a task in a modal; the tab is one click away (2026-10-09)

A click on a card opened the task in a new editor tab, so looking at one task meant leaving the board and
closing a tab to come back (GH-158). Now a card's click opens the task over the board. This supersedes
D-029's bullet "Ticket pages stay separate tabs" for a click on the Tasks board only: several tasks still
open side by side as tabs.

- **What opens over the board.** A click on a card, acc's own or a tracker board's (GitHub, Jira, Azure
  DevOps, monday.com), opens the task's page in a modal over the Tasks board, a native `<dialog>` opened
  with `showModal()`. The board stays where it was underneath. Everywhere else still opens a tab: the
  Overview, the sidebar, the Agents page, notifications and the command palette.
- **It's the tab's page.** The modal is drawn by the task page's own renderer from the model its tab gets,
  and the ticket controller (`TicketPanels`) handles what it sends as it does for a tab: one record per
  page, drawn on its own tab or on the Command Center's. The Command Center's page hands the controller
  the messages that are the modal's first (`Panels.over`, `modalTakes`): those only a task's page sends
  (`ticket-action`, `update-edit`), and those for the modal's own task (an answer, an update, a command
  its tab may run). The rest, such as Open in GitHub or a related ticket, stay the page's. The modal
  redraws on the same signal as a tab, and its unsent edits count as a task page's (GH-46) until it
  closes.
- **Open as tab and Close** sit in its top-right corner. Open as tab closes the modal, then sends what a
  card's click sent before: `acc.task.show` from the agent board, the ticket from a tracker's. Close,
  Escape and a click on the backdrop close it. Focus moves into it when it opens and back to its card
  when it closes, found again if the board redrew meanwhile. The page closes it at once, without
  waiting for the browser's close event, which can come after the next open.
- **The board redraws under it without touching it.** A model the extension sends is the board's, and
  leaves the modal, its scroll and what's typed in it as they were; a redraw of the same model is the
  page's own, such as a fold opened in the modal, and draws the modal again with it, where it was
  scrolled. The modal's model is a message of its own (`task-modal`), and the extension draws it again
  when the page is rebuilt after its tab was hidden.
- **It's a raised surface,** with the depth tokens (D-127): `--raised`, `--edge` and `--lift`, over a
  backdrop mixed from the theme (`--backdrop`). Its panels stand a level higher again in dark. At narrow
  widths it fills the panel, less 12 px, and it scrolls inside itself.
- **Checked:** `task-modal.test.ts` (which messages are the modal's; a card's click gives the Command
  Center's tab the task's model and opens no tab; Open as tab opens the tab as a click did, and a
  closed modal isn't drawn again; it redraws on the tab's signal and when the page is rebuilt, and goes
  with the Command Center's tab; Make a task, an answer, each update message, and run and move reach the
  tab's handler and change what it changes); the screenshot run's `tasks-modal` drawing, light and
  dark, at 1000, 620 and 500 px, and in the colour check.
- Not chosen: a second panel beside the board, which would still leave the board; navigating between
  tasks inside the modal, or several modals at once.

Note (D-127, 2026-10-09): the accent lifts what was grey. A button is a raised surface with an edge and a
blue icon, tinted blue under the pointer; a primary one stays solid blue. Counts, code chips, question and
step numbers, mentions and avatars take a soft blue tint (`--accent-soft`, `--accent-edge`, mixed from
VSCode's link colour), not the theme's grey badge. Orange stays for what needs a person.
