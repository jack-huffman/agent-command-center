## D-074 Track a ticket from its card on the tracker's board (2026-10-06)

A ticket on a tracker's board became an acc task only from its own page, one
at a time, and that page's Track in acc gave no sign it was working: a double
click imported it twice (GH-52). This is the third of D-072's tasks, after
GH-50 held the board to the repo's place.

- **Every card acc doesn't keep has Track**, with the `add` icon and the short
  label "Track", so it fits a 500 px column. It's the secondary style, not the
  primary one, so a column of new tickets doesn't read as a wall of next steps.
  **A done column's cards have none** (a person decided): there's nothing left
  to build. A ticket's page still offers Track in acc for any ticket.
- **One way for both buttons.** The card and the page both call
  `Trackers.track`. It reads the ticket again, because a card carries no
  description, and that read checks the place at the moment of the click: a
  ticket that has left it is refused with the place named, and `acc import`
  never runs (D-072). Otherwise `acc import --json` gets its title, description
  and label names. Nothing changes the ticket (D-066). A refusal is acc's own
  words, read from its `--json` output, not the first line of its plain text.
- **The card is the reply.** A click says Tracking… at once, with a spinning
  icon, and the button stops taking clicks. On success acc's tasks reload
  before that clears, so the card goes straight to acc's state and its one next
  step: Dispatch, or Analyze where the project wants an analysis (D-062). On a
  refusal the card shows an orange warning icon and "Couldn't track it:" with
  the reason, and offers Track again. The board shows no notification; the
  page keeps its own messages.
- **The extension holds it, not the page.** One `Pending` per window (D-059),
  keyed by repo and ticket, so "Tracking…" and the reason outlast a tab rebuild
  (D-061), and a second click, or the page's button, starts nothing. The page's
  button says Tracking… whichever button started it. A second VSCode window
  could still import the same key; `acc import` then only refreshes the task's
  text, never its state.
- **A reason stays until the next try, or until the card leaves every board.**
  A refusal doesn't reload the board, or the reason would go with the card; the
  next scheduled load takes both away. A track still on its way is never
  forgotten.
