## D-216 A task page's content is in tabs: the Ticket with its comments, Plan, Changes and Verify (2026-10-27)

T-134. The person found the task page too cluttered, even with T-132's order (D-214): its content should be in
tabs, and the ticket and its comments stay together, as a ticketing system shows them. This amends D-214's order
and its "From the Command Center" label, and D-052's summary first on the task page: what needs the person now
still comes first, above the tabs.

- **The tabs, in order, each with its icon** (`extension/webview/tab-rules.ts`, drawn by `extension/webview/task-tabs.ts`):
  - **Ticket**: everything the ticket holds. Its description with Edit, its related tickets, then its activity:
    the comments and history, the update drafts to post, and the comment box.
  - **Plan**: the plan, or the conversation's line before there is one; the acceptance criteria draft; notes for
    the builder; the builder's note.
  - **Changes**: Planned changes and Changes, the ticket's changes field, record changes, the manifest, and the team.
  - **Verify**: Verify the developer's work, only when the ticket has one.
- **A tab with nothing in it is hidden**, not drawn empty. Ticket always shows, as it holds the description.
- **Counts where they help**: Ticket its comments ("2 comments"), Changes its files (its changed count once there
  is work, else its planned files). Plan and Verify have none.
- **A tab that needs the person says so**: an orange bell and the words "needs you" after its name, never colour
  alone. Its accessible name is its visible words, "Plan needs you", as WCAG's label in name asks: a separate
  label of "Plan: needs you" failed the accessibility check. Its title says "Plan: needs you." and adds the state
  that needs the person. A tab
  needs the person when a section in it shows an orange state: Plan its analysis's or its plan's (questions,
  choices, a split, approval), or the conversation's; Verify its own (a pull request to choose, changes asked);
  Changes its changes field's, record changes' or manifest's. Ticket needs the person while an update acc
  drafted waits to be posted (D-066).
- **What stays outside the tabs.** The notices that need the person now (blocked, conflicts, failed checks, the card
  that didn't move, shared files) stay above them. The side column's Details and Agent panels stay beside them,
  collapsible as D-214 made them. D-214's collapsible sections work inside a tab. The "From the Command Center"
  label goes: the tabs say which is which.
- **Which tab opens.** A link that names a part opens its tab: Needs you's Answer on a plan, a card's Answer, See
  the split and See the plan, and a plan's notification open on Plan. Without one, a page opens on a tab that
  needs the person; where several do, Plan, then Verify, then Changes, then Ticket (a plan holds up the build; an
  update to post waits on no one else). Otherwise it opens on the tab last on show for that ticket, and then on
  Ticket. A redraw of the same ticket keeps the tab on show, though something comes to need the person; a page
  loaded afresh, or another ticket, is an opening.
- **Links name a part**: `plan`, `verify`, `changes`, `ticket`, or `comment:<id>`. A link carries it on its task's
  reference (`part`), and the modal's open message carries it too (checked by `TASK_PART`, `extension/src/model/task-tabs.ts`). The page's model has
  it as `open`, stamped with when it was asked, and the page follows a stamp once, so a redraw doesn't pull the
  person back. A comment opens Ticket, shows the whole activity, and scrolls to that comment and focuses it. In
  this change no link names a comment, Verify or Changes yet; the page takes them.
- **Remembered per ticket.** The tab last on show is in the tab's memory (`tabs`, by `<project>#<key>`), with the
  stamp of the last link followed (`jumps`).
- **Tabs done properly.** An ARIA tablist; each tab a button with `role="tab"`, `aria-selected`, `aria-controls`
  and a roving tab index; each panel a `tabpanel` named by its tab. The arrow keys move between tabs and wrap,
  Home and End go to the ends, and the panel switches in place, so focus stays on the tab. The tab row wraps
  where it's too narrow for one line, so every tab, the chosen one too, stays in view and nothing scrolls
  sideways: a row that scrolled within itself was a sideways scroll the geometry check fails, at 500 px.
- **On a narrow page** (760 px and under): the notices, then the tab row and its panel, then Details and the
  Agent panel. Related tickets and activity stay in Ticket's panel, so T-41's rule for them goes.
- **Checked by** `extension/test/task-tabs.test.ts`: which tabs show with and without each part, the counts, a tab
  that needs the person in words and drawn with its orange bell, the opening tab's rules, the tab remembered per
  ticket, a redraw keeping it, the ARIA roles, the arrow keys, Home and End, links to a tab and to a comment, and
  the links that name the plan. `extension/test/collapse.test.ts` checks each section's tab and order. The
  behaviour run's case opens a plan that needs approval on Plan and drives the keys, a click, a redraw and a link
  in the pinned browser; its mutants "a tab that needs you doesn't say so", "the opening tab ignores what needs
  you" and "the arrow keys move between no tabs" must fail it. The screenshot run draws `ticket-tab-ticket`,
  `ticket-tab-plan`, `ticket-tab-changes`, `ticket-tab-verify` and `ticket-plan-needs-you` at every theme and
  width; the other task page shots open on the tab they were made to show. Each drawing of a task page is
  measured once per tab it shows: after the page as drawn, each other tab's panel is shown in turn and measured,
  and the tab and scroll on show come back before the shot (`MEASURE_TABS`, `mergedVerdict` in
  `extension/scripts/geometry.ts`). So what a hidden tab draws is still judged. Each later measure holds only
  what is inside the shown tab's panel (`collectGeometry`'s `within`, and axe runs on that panel), and does not
  count the page again for sideways. So what is outside the tabs (the notices, the Details and Agent panels, the
  header, the rail) is counted once per drawing, and the run's counts are not inflated by measuring it once per
  tab. The screenshots gate's drawn classes come from the first measure only (`drawnIn`), as that is the page the
  PNG shows; the `ticket-tab-*` shots draw each tab in a real shot. `extension/test/geometry.test.ts` checks
  each of these.
