## D-160 The screenshot run checks every drawing with axe-core, and fails on a finding no exception excuses (2026-10-15)

The screenshot run measured geometry, words and colours, but nothing checked a page's accessibility:
a control's name, a role, a contrast. Now every drawing of every page, at every width and theme, is
checked by axe-core.

- **axe-core 4.14, MPL-2.0,** is a dev dependency, as esbuild and typescript are: the run reads
  `node_modules/axe-core/axe.min.js` and puts it inline in each measured page, before the harness's own
  scripts. It is not copied into the repo, and the extension doesn't ship it, so `docs/THIRD-PARTY.md`
  has no row for it. A page drawn for the colour check doesn't load it.
- **The rules:** axe's tags `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa`, the rules for WCAG 2.1 AA, on
  the whole document, once the page has been measured. Best-practice rules, such as `region` (content
  outside a landmark), don't run.
- **The dump** (`extension/scripts/a11y.ts`) carries each violation's rule, impact and short description,
  and each node's selector and text (at most 80 characters). A contrast node also carries its colours and
  each `--vscode-*` variable whose colour its text is drawn in, or "no theme colour": a selector can't say
  which theme colour a node uses, and a selector with a time in it changes from run to run. The dump also
  carries how many nodes axe examined (in its passes, violations and incomplete results) and each
  incomplete result's rule.
- **The check, `a11y`,** is one of `CHECKS`. Each violation's node is a finding that names the rule, the
  impact, the selector and the text, unless an exception excuses it. An incomplete result is no finding;
  the run prints them by rule. A drawing where axe examined no node fails, and so does one that wrote no
  `a11y` part. `RUN_FLOOR.a11y` is 190000; the full run examined 190872.
- **`A11Y_EXCEPTIONS`** names each exception's rule, a pattern for the node's selector, text or colours,
  and why. An exception excuses only its rule on what it names, and a full run fails on one that excused
  nothing. `extension/test/a11y.test.ts` pins how far each reaches, with nodes the run found and nodes
  just past each edge. There are twelve:
  - Contrast on a theme colour the page can't change, since Light and Dark keep VSCode's Dark and Light
    Modern colours (GH-109): `--vscode-charts-blue` (blue states, 3.2 to 4.5:1), `--vscode-charts-orange`
    (orange states and the rail's attention counts, 2.4 to 4.1:1), `--vscode-descriptionForeground`
    (muted text on a raised or hovered surface, 4.1 to 4.5:1) and `--vscode-textLink-foreground`
    (avatars, mentions, counts and a chosen segment, on a tint of itself, 3.6 to 4.5:1).
  - Follow-ups in files T-52 to T-54 change now: the rail's tab names leave out the count they show
    (`rail.ts`); a tracker card's name leaves out what it shows (`boards.ts`, `tasks.ts`); a done or
    closed card is faded by opacity below 4.5:1 (`boards.css`).
  - Follow-ups outside the page's shared parts: Setup's done steps faded by opacity (`setup.css`); the
    Overview's rows and cards named by less than they show, and an `ol` whose rows have the role link
    (`landing.ts`); Settings' and About's action buttons named by more than they show (`settings.ts`,
    `about.ts`); and Setup's progress bar with no name (`setup.ts`).
- **Fixed in the shared parts:** a checklist icon in a task's description (`dom.ts`) carried an
  aria-label with no role, and now is `role="img"`; a code block that scrolls sideways (`dom.ts`) now
  takes keyboard focus. The run found no duplicate id and no landmark finding among these rules, so
  `main.ts` is unchanged. The harness's page gained the `<title>` the tab has (`htmlFor` in `panels.ts`).
- **Incomplete in the full run, by rule:** color-contrast 1048, label-content-name-mismatch 276,
  aria-prohibited-attr 252, th-has-data-cells 6.
- **Checked:** `a11y.test.ts` adds twelve tests: two violations make two findings; a dump where axe
  examined nothing, wrote no part, or failed; an exception's reach and its count; an exception that
  excused nothing; an incomplete result; axe's script before the harness's in the page; the dump the
  page writes holding the `a11y` part, and a contrast node's theme variable; the two `dom.ts` fixes; and
  each exception's reach. The full screenshot run passes: 426 drawings, no findings.

Out of scope: the accessibility of VSCode's own chrome around the page, and the follow-ups above.
