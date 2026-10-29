## D-T-139 A settings page you can find your way around: sections, a jump list, and less text (2026-10-28)

T-139. The person, on Settings: "the settings page is also too text-heavy and cluttered. It needs to be easier to
work with and navigate." The page was eight boxed parts in one long column (GH-109 to GH-114), each with a
paragraph under its heading, every value tagged with where it's set, and notes under the rows. T-40's guide, a
row of links to each part, sat under the title. This replaces that guide, in the calm style of D-217, D-218 and
D-220: each fact once, no heading repeated, one level of borders, the theme's spacing, detail a fold away.

- **Six sections** (`SETTINGS_SECTIONS` in `extension/src/model/settings.ts`): Trackers and boards (trackers),
  Agents (how agents run), Checks and limits (limits), Accounts and notices (GitHub accounts and Slack), Look and
  behaviour (appearance and the Command Center's own preferences), and About. Each part is in exactly one, and
  `sectionOfPart` says which. Each section opens with its title and one line saying what it's for. The task named
  Environments and Team as examples; Settings holds neither (Environments and a task's team are pages of their
  own), so they are not sections here.
- **One section at a time, picked from a jump list.** At 1000 px the list is at the side; under 760 px a picker
  (a plain select, named "Section of Settings") takes its place above the section. A pick shows that section,
  hides the rest, marks its link `aria-current`, focuses its heading, and is remembered in the tab's memory
  (`settings`), so a redraw or a return keeps it. It needs no redraw. A remembered id the page no longer has
  shows the first section. The picker is navigation, not a question, so D-205's three options don't apply; it
  draws no radio group.
- **Deep links still work.** Every part keeps its `settings:<part>` key, now on a group named for the part
  rather than a heading. `jumpTo` in `extension/webview/state.ts` asks a hidden section that holds the part to
  show (a `reveal` event) before it scrolls and focuses, so the palette, the status bar, Agents' Settings button
  and the Connect page's Back still land on their part.
- **Less text.** A part's paragraph is gone: its section's line says it once. Where a value is set (this clone,
  the project, or a default) is its hint on hover, not a tag beside it; in Limits a cap's and a row's "where
  it's set" are too, and why a Change… can't be used is its own title and accessible name, not a paragraph.
  A part's notes on how its settings are kept fold under "How these are kept"; with no project yet they stay in
  view as its state, beside Open Setup. What a change means in Limits, what cloud builders need (with a count of
  what's missing, orange, or all ready, blue), branch protection, and how often each part refreshes fold with a
  count. A project's trackers say how many; past four, the first three show and the rest fold under "n more
  trackers". A section of one part draws no heading for it, so no heading repeats; Accounts and notices names
  its two. The sections have no box: the jump list and space divide them.
- **Change tracker…** is where changing a tracker starts. It is Change place… renamed, and still opens the
  Connect page at that tracker; T-140's stepped modal takes it over when it lands.
- **Nothing is lost.** Every control the page drew before is still drawn and still does something.
- **Checked by** `extension/test/settings-sections.test.ts`: every control's name drawn before the change, pinned
  from main at 556aee02 across the 12 Settings pages the screenshots shoot, is drawn after (with Change place
  renamed), off where it was off, and the picker is the only one added; every enabled button asks the extension
  or changes the page; the jump list and picker hold each section in order and a click shows one alone; the tab
  remembers it; a stale memory shows the first; a reveal shows a hidden part's section; each section's title and
  line; the long list's fold, its count and its memory. `extension/test/settings-guide.test.ts` holds the
  sections to the parts. The behaviour case "settings: the jump list shows one section…"
  (`extension/scripts/behaviour.ts`) clicks a jump, redraws, follows a deep link and opens a fold in a browser,
  with three new mutants: a section's jump goes nowhere, the section shown is forgotten on a redraw, and a deep
  link leaves its part's section hidden. The screenshot run opens each section at one of its parts (Limits now
  too), at every width and theme.
