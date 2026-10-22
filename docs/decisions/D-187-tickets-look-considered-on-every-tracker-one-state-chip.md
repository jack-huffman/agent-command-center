## D-187 Tickets look considered on every tracker: one state chip, tinted labels and avatars (2026-10-21)

The person asked for the ticket page and the board to look beautiful for Jira, GitHub, Azure DevOps,
monday.com and Slack alike, guided by Apple's design principles. A ticket page was a stack of same-weight
grey boxes, every state an outline, every label a grey pill, every avatar the same blue, and a card showed
no priority or person beside its title. T-91 draws the fields D-185 fills, with one visual system.

- **One scale, defined once.** `styles.css`'s `:root` holds it: spacing `--space-1` to `--space-6` (0.25,
  0.5, 0.75, 1, 1.5 and 2 rem, so larger text keeps its room); radii `--radius-s` 4 px, `--radius-m` 6 px,
  `--radius-l` 10 px and `--radius-full`; type `--text-meta` 0.85em, `--text-read` 1.04em and
  `--text-title` 1.85em; leading `--leading-title` 1.15 and `--leading-read` 1.6; tracking `--track-title`
  -0.015em and `--track-meta` 0.01em; a card's press `--press-scale` 0.98 over `--press-time` 100 ms. The
  new rules on the ticket page and the cards take their sizes from it.
- **The palette.** Five tints, `--tint-1` to `--tint-5`: VSCode's `charts.purple`, `terminal.ansiCyan`,
  `charts.yellow`, `terminal.ansiMagenta` and `terminal.ansiBlue`. None is red or green, nor orange, which
  keeps meaning a person is needed. Light and Dark set each in `theme.css` from the colour registry's
  defaults in VSCode 1.143.0 (D-098); Match VSCode takes the theme's own. `looks.test.ts` resolves each in
  both palettes and fails on a red, a green or a grey one.
- **One state chip.** `stateChip` in `dom.ts` is a soft fill in its tone, its icon and its label, with the
  words in the theme's text colour so they keep their contrast. It draws a ticket's state on its page, each
  related row's, every board's column headings (the agent board's too) and acc's state on a tracker's card.
  Doing's icon is `play-circle`, not `sync`, since nothing is syncing; done is `quiet` (a fainter fill and
  muted words); closed as not planned keeps `circle-slash`, neutral. `looks.test.ts` walks the chip in
  each place from the screenshot fixtures.
- **Labels and avatars are tinted.** A label chip takes the tracker's own colour where it gives six hex
  digits, else the tint its name picks, the same in any case (`labelTint` in `extension/webview/tints.ts`).
  An avatar's tint comes from the person's key: the tracker's id, else the name (`PersonChip.key`), so one
  person keeps one tint on every page. The text stays in the theme's colour on a soft fill. Initials drop an
  email's domain, and a person's name carries their email in its title.
- **The ticket page.** The head is the tracker's mark, where the ticket lives and its key, with Open and
  Refresh at the right; the title in the large style; then one row of the state chip, the type and the
  priority, each with its icon. The main column's sections now sit on the page, parted by space and a
  hairline, not in raised panels (this changes D-127 for the ticket page's main column); Details is an
  aligned list with an icon per row, on the page; the Agent panel stays the one raised surface beside them.
  Related items are grouped by relation, each row its type icon, key, title and state chip, and a tracker
  key opens in place. A comment is its author's avatar, name and time, then its body as reading text.
- **A missing field leaves its place out.** A field the tracker lacks, or one with nothing in it, draws no
  row and no line: no "None", no "Unassigned", no dash, and no T-28 line naming what the tracker lacks
  (`lacks` still reaches the model). A row with nothing in it stays only where it holds a Change or Add.
  `extension/test/ticket-look.test.ts` draws every tracker's page in page-dom.ts's small document and fails
  on such a placeholder.
- **The board's cards.** The top row is the type icon, the key, up to three avatars and the priority icon;
  the title shows up to three lines, whole in its title; then up to three label chips, "+2" naming the rest
  in its title, on a row of their own, so the "+2" never wraps away from them beside an avatar. Done cards are quieter. A card shrinks to 0.98 on press, lifts a pixel
  under the pointer and shows a 2 px focus ring; under reduced motion only its edge colour changes. Track
  is one width on every card, whether it says Track or Tracking….
- **Every tracker is drawn.** The screenshot run gains a GitHub issue's page, an Azure DevOps Product
  Backlog Item's page, a monday.com item's page and an Azure DevOps board
  (`extension/scripts/fixtures/tracker-tickets.ts`), and the GitHub board's labels carry GitHub's own
  colours.

- **Priority icons read as an order.** Highest is `arrow-circle-up`, High `arrow-up`, Medium `dash`, Low
  `arrow-down` and Lowest `arrow-circle-down`: no two levels share an up or down glyph, and each icon's title
  names its level's word.
- **The comment box's hint is two parts.** "Commenting as …" and how to post sit apart with a gap, not
  joined by a dot in a run of text.

The ticket header isn't sticky, so it needs no translucent material. Tested in
`extension/test/ticket-look.test.ts` (14 tests) and two more in `extension/test/looks.test.ts`.

**Note (2026-10-21, T-94): the polish T-91's builder named.** What T-91 drew now reads as it meant to:

- **A narrow card shows whole labels.** A card's labels row shows as many labels as fit whole, at least one,
  and folds the rest into +N, which names each in its title (`extension/webview/fit-labels.ts`). It fits just
  after it is drawn and again when its width changes. "Up to three label chips" above now holds only where
  nothing measures the card, as in a test's small document.
- **Eight tints, and none shared on one card.** The palette is `--tint-1` to `--tint-8`: the five above, then
  the git extension's `gitDecoration.modifiedResourceForeground` (tan), and the registry's
  `debugTokenExpression.boolean` and `.name`. None is red or green. Light's tint 6 (`gitDecoration.modifiedResourceForeground`) is a tan that reads orange-brown, close to the page's attention orange; a label always carries its name, so the tint is never the only signal. `labelTints` gives one card's or
  one ticket's labels different tints while a tint is free. `looks.test.ts` checks that the text on a chip
  and on an avatar keeps AA contrast on each surface in both palettes, and that every two tints are at least
  15 ΔE apart. That check found the git extension's submodule blue 4.8 ΔE from `ansiBlue` in Light, so it is
  not in the palette.
- **Details' names sit on the first line of their value.** `.fields` centred each row, and it outranked
  Details' own alignment. Details now names both classes, and a name takes its text's baseline, not its icon's.
- **The facts come first on a narrow page.** At 760 px and below, the order is: why it's stuck and the
  analysis, the description and what sits under it, then Details and the Agent panel, then Related and
  Activity. This replaces T-41's order, where the Agent panel came first and Details came last.
- **One state chip in two more places.** The Agent panel's State and Session, and an agent board card's
  agent and analysis states, are drawn as the state chip.

Read in the shots at 1000, 620 and 500 px, in both themes: the Azure board's AB-1213 shows "service",
"history" and "+3", all whole, at 500 and at 1000 px, where its lane is about 265 px wide. On the GitHub,
Azure DevOps and Jira ticket pages at 620 and 500 px, Details follows the description and comes before
Related and Activity. In Light, `premium` and `service` are now two blues that are easy to tell apart. The
Claude Code isn't found page (`ticket-missing`) wraps its long state chip inside the Agent panel at 500 px.
The screenshot run passed with no findings: 708 drawings, 56 behaviour cases and 100 mutants, all caught.

**Note (2026-10-21, T-95): a tracker's own label and type colours win; a state never takes one.** The
person decided that a ticket uses its tracker's branded colours wherever the tracker gives them, GitHub's
red `bug` label included, and the palette above fills in only where it gives none. A label and a type are
the tracker's data, and the person knows them by their colour in the tracker. A state carries meaning, and
the author is colourblind: a state keeps acc's own icon and label, orange against blue, never red against
green, whatever colour the tracker gives it.

- **Azure DevOps tags.** Azure keeps a tag's colour per board, in the board's card rules. The client reads
  the followed board's `cardrulesettings` with every board load, and keeps each enabled `tagStyle` rule's
  background colour by tag name, whatever its case (`tagColours` in `azure.ts`). A ticket's page reuses the
  last read, or reads them once when no board has loaded. A tag with no rule, a rule turned off, and a call
  that fails all leave the tag's colour null, and nothing is said.
- **Type colours.** `Ticket`, `BoardCard` and `Related` gain `typeColor`, six hex digits as `Label.color`.
  Azure fills it from the project's work item types, read with the card rules. GitHub asks for
  `issueType { name color }` and maps its eight named colours to hex (`GITHUB_TYPE_COLOUR`, hex values chosen
  by hand to match its light theme's, not copied from GitHub). Jira gives a type an icon image, not a colour; monday.com and Slack have no types:
  all three give null.
- **monday.com.** Its API gives a group's colour and each status label's colour. A status label is a state,
  so its colour is not used. A group is where an item sits on the board, not a label or a type, and acc
  doesn't draw groups, so its colour is not used either.
- **Drawing.** `typeMark` in `dom.ts` tints the type icon through `--type-colour` on the ticket page's head,
  on a card and on a related row. With no colour, or one that isn't six hex digits (`ownColour` in
  `tints.ts`), the icon keeps the theme's colour. The type's word keeps the page's text colour.
- **The colour rule's exceptions.** `colours.test.ts`'s one exception for a tracker's colour is now two,
  by name: a label's (`--tint-colour`, in `tinted`) and a type's (`--type-colour`, in `typeMark`). A test
  pins each to its one place in `dom.ts`, and fails on a tracker colour written anywhere else.

The screenshot fixtures carry Azure DevOps' Scrum type colours and four tag colours on its board and
ticket page, and GitHub's red Bug and blue Feature on its board and ticket page. Read in the shots at 1000,
620 and 500 px, in both themes: Azure's Test Case teal (`004B50`) is hard to see on Dark, almost the card's
own colour; Azure's Task yellow (`F2CB1D`) and the yellow `premium` tag's dot are faint on Light. Each keeps
its word, the type's name in the icon's title on a card and beside it on the page, so the colour is never
the only signal. GitHub's red Bug and Azure's blue Product Backlog Item read well on both. Tested in
`packages/core/test/tracker-colours.test.ts` (9 tests), `extension/test/type-colours.test.ts` (6 tests)
and two more in `extension/test/colours.test.ts`.
