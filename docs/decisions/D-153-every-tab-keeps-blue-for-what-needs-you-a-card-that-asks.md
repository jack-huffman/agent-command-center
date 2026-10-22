## D-153 Every tab keeps blue for what needs you; a card that asks offers Answer; Agents names its stops alike (2026-10-15)

A second audit against Apple's design guidance (2026-10-14) found that D-147's rule, primary only for what
needs you, held on the Overview alone. T-39 applies it to every tab.

- **Outlined:** Open org on each environment card, Switch account on the GitHub card, Add task on Tasks,
  Start a background agent on Agents, Settings' Slack Turn on and a ticket's Track in acc. None of them
  waits on the person. A board card's next step (Dispatch, Land, Review, Resume) keeps the model's primary,
  as before.
- **Checked:** `PRIMARY` in `extension/test/feel.test.ts` names each place the page may draw a primary
  button, with why: an Answer or a Needs you step, a fix for a sign-in that failed, the button that sends what
  the person typed beside it, an empty tab's Onboard, and the Overview's header (D-150, out of scope). The
  test reads every line of the page's source that draws one (a `primary` class, or a primary passed or read
  from the model), and fails on a line no entry names or two do, and on an entry that names no line. At this
  change it finds 31 lines, named by 30 entries.
- **A card that asks offers Answer.** A task whose agent waits on a question in the Command Center carries
  that question's id (`TaskRow.question`). Its card's one next step is Answer, which opens the question in
  Needs you, on the Overview, as the Agents tab's Answer does (`nextStep` in `webview/boards.ts`); Watch goes
  behind ⋯. Without the id, Watch stays the next step. On a tracker's card the next step keeps to the right
  of its line, even when its state wraps it to a line of its own.
- **Agents:** the fold's Stop all is now Stop finished, the header's name for the same command. The header
  holds Stop finished, Start a background agent, Refresh, then Settings last (`refreshButton` in `dom.ts`).
- **The Running column showed only at 500 px.** The row's actions stick to the table's right edge
  (`styles.css`). At 620 and 1000 px the State and Model cells never wrapped, so the table was wider than its
  frame, and the sticky actions covered Running. At 500 px the Model column goes, and the table fit. The
  State cell now wraps at every width (at least 8em to 660 px, 10em above), and the Model cell breaks between
  the model and its effort. The screenshot run's overlap check doesn't see a cell covered by a sticky one.
  - 2026-10-15: the run now has a check for that, `covered` (T-46): a sticky cell covering another cell's text
    fails, with the covered text named.

Out of scope: the Overview, which D-150 made.
