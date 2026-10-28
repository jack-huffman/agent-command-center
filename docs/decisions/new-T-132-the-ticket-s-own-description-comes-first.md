## D-T-132 The ticket's own description comes first, and each Command Center section collapses (2026-10-27)

T-132. The person asked for a task page's description above its plan: the description is part of the ticket
itself, while the plan, the acceptance criteria and Verify the developer's work are the Command Center's own. Each
section the Command Center makes should collapse. Until now `renderTicket` put the plan (or the conversation's line
before there is one) in the top band with the notices, above the description. This amends D-052's summary-first
order, and D-054's plan above the description, on the task page. D-039's one line for why a task is blocked stays.

- **The order.** First, the notices that need the person now: why it's blocked, its conflicts, its failed checks,
  the card that didn't move, and the files it shares. They stay in the top band, above everything. Then the
  ticket's own description under its heading, with its Edit. Then the Command Center's sections, in this order: the
  plan (or the conversation's line before there is a plan), the acceptance criteria draft, Verify the developer's
  work, Planned changes and Changes, Team, the changes field, Record changes, the manifest, Notes for the builder,
  and the builder's note. Then the ticket's related tickets and its activity. The side column (Details and the
  Agent panel) is unchanged. A ticket with none of the Command Center's sections draws them, and their label, not
  at all.
- **A quiet label between the two.** "From the Command Center" sits on a dashed hairline between the description
  and the first of the Command Center's sections, in the muted meta size, not in a heading's capitals. It isn't a
  section and doesn't collapse; the description's own hairline gives way to it.
- **Each section collapses** (`extension/webview/collapse.ts`). Its heading becomes a button with its name and a
  chevron that turns, with `aria-expanded`. A click, Enter or Space collapses or expands it in place, without a
  redraw, so the page keeps its scroll and focus stays on the button. Enter and Space are taken on the key, and
  the key's default is prevented, so the button's own click doesn't follow and flip it back. Collapsed, a section
  keeps its header line: its name, its state chip, and a one-line summary where it has one: the plan's note or the
  first line of its summary, how many criteria the draft holds (from the draft's own list, not its test steps),
  Verify's verdict, or the conversation's line. The summary ends in an ellipsis on a narrow line, with its full
  words in its title. A section with nothing to sum up keeps its name and its state.
- **Remembered per ticket and per section.** The tab keeps the sections a person collapsed in its memory
  (`memory().folded`), by `section:<id>:<project>#<key>`, as `foldable` keeps the folds it opened; the newest 200
  are kept. Every section starts open. The description, the related tickets and the activity keep their own Show
  all folds and don't collapse.
- **The side column folds too.** The person added, the same day: the ticket's metadata must collapse as well.
  The side column's Details panel and the Agent panel take the same header button, chevron, `aria-expanded`,
  click, Enter and Space, and are remembered per ticket the same way (`details` and `agent`), starting open. The
  Agent heading keeps its icon inside the button. Collapsed, the Agent panel's summary is its state's label, or
  "Not in your work yet" for a ticket not in the person's work; Details has none and keeps its name.
- **On a narrow page** (760 px and under, one column), T-41's rule that what needs the person comes first holds,
  in D-187's order: the notices first, then the description, then the label and the Command Center's sections in
  the order above, then Details and the Agent panel, then the related tickets and the activity. The plan's
  questions that need an answer are in the plan section, so they now follow the description there too; the
  notices, which need the person now, stay first.
- **Checked by** `extension/test/collapse.test.ts`: the order on a ticket with all of the plan, criteria and Verify,
  on eight fixtures with different sections, with a notice, with the conversation's line and with no section at
  all; the button, its name and `aria-expanded`; a click and a second click, remembered for that ticket and section
  only; Enter, Space and another key; the collapsed header line and its summaries; and the narrow page's order
  rules; Details and the Agent panel, their summaries, and an Agent panel for a ticket not in the work. The
  behaviour run's case collapses and expands the plan by click, Enter and Space in the pinned browser, draws the
  page again, and collapses Details by Enter; its mutants "a collapsed section doesn't stay collapsed" and "Enter and Space on a
  section's button do nothing" must fail it. The screenshot run draws `ticket-sections` (the plan, criteria and
  Verify open) and `ticket-sections-collapsed` (the same, with Details and the Agent panel, collapsed), at every theme and width.
