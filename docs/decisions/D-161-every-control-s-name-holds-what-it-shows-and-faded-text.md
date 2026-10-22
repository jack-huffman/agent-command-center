## D-161 Every control's name holds what it shows, and faded text still reads: the eight a11y follow-ups are fixed (2026-10-15)

D-160 left eight accessibility exceptions as follow-ups. Each is now fixed where the page draws it, and
its exception is gone: `A11Y_EXCEPTIONS` holds only the four theme colours.

axe's label-content-name-mismatch joins the text of elements that sit side by side with no space between
them, so "Tasks" beside "14" reads as one word, "Tasks14". A name that holds the right words still fails
until the page puts a space between them. The spaces are text nodes in flex rows, which draw nothing.

1. **The rail's tabs** (`rail.ts`): a space between the label and the count, and `tabName` names a tab by
   what it shows, then its hint without the count twice: "Tasks 14, need you".
2. **Task cards** (`tasks.ts`, `board-nav.ts`): a tracker card has no aria-label, so what it shows names
   it, with its labels, people and the Moving badge of a held card. Its status is its aria-description,
   and the board's keys add their words (`KEYS_DESCRIPTION`) after it.
3. **Faded task cards** (`boards.css`): a done card, and a card in a done lane, sits flat with no fill or
   lift, in place of opacity 0.75 and 0.92. Its text keeps its contrast; its lane's heading says Done.
4. **The Overview's rows and cards** (`landing.ts`, `landing.css`): a line's link is its title, named
   by the title, then its state and key (`lineName`). Enter on the link opens the line, a click anywhere on it still does, and the
   line still shows the focus. A card puts spaces between its title, count and line.
5. **The Overview's lists** (`landing.ts`): a line is a list item again, with no role of its own, so its
   `ol` holds list items.
6. **Settings' action buttons** (`settings.ts`, `about.ts` in `src/model`): each name now holds its
   label, such as "Change place: where Jira · ACME, in Acme gets its tickets, and its board" and "Update
   the plugin to 0.37.0: the acc plugin, as Setup's A4 does". Cloud builders' Turn on…, Turn off,
   Token…, Default…, Change routine… and Add the routine…, and GitHub's Add Projects access, changed too.
7. **Setup's progress** (`setup.ts`): the bar is named "Setup steps done" and reads "32 of 40".
8. **Setup's done steps** (`setup.css`): no opacity; a done step's title is the theme's muted colour,
   and the foreground on hover or focus.

- **The full screenshot run passes:** 450 drawings, no findings; a11y examined 204164, above its floor
  of 190000. Excused: charts-blue 1618, charts-orange 901, descriptionForeground 315, textLink-foreground
  249. Incomplete by rule: color-contrast 1071, label-content-name-mismatch 276, aria-prohibited-attr
  264, th-has-data-cells 6. Behaviour: 36 cases, 286 checks; mutants 55, 55 caught.
- **Checked:** `names.test.ts` adds six tests, which split a name into words as axe does: the rail's
  names, the Overview's lines and cards, tracker cards, every action's name on every sample page and in
  each cloud, GitHub and plugin state, Setup's bar, and no done card, lane or step faded below opacity 1.
  `a11y.test.ts` adds one: the list holds only the theme colours, and none of the 17 nodes the
  follow-ups excused is excused now. The detail modal's behaviour case opens a question from its line and
  checks the line is a list item and focus comes back to its link. A new behaviour case focuses the
  line's link, presses Enter, and checks the question opens and Escape sends focus back to the link; its
  mutant drops the link's Enter handler, and the case catches it.

Out of scope: the four theme-colour exceptions, and axe's best-practice rules.
