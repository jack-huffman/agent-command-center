## D-101 Settings is a section, and acc's pages can be Light, Dark or Match VSCode (2026-10-07)

GH-109. The author asked for a Settings page in the Command Center, with a
light and dark toggle. Its analysis split it into six tasks; this is the first,
and GH-110 to GH-114 fill the rest. It amends D-089.

- **Settings is a section of the Command Center,** last in the rail and the
  sidebar launcher, with a gear, opened by `acc.open.settings` and refreshed by
  its header's Refresh. D-089 turned down "a separate settings page" because it
  would take you away from the sessions; a section is one click in the rail, and
  the Agents page keeps its Settings button. Once GH-110 moves How agents run
  into Settings, that button opens Settings' How agents run part. Until then it
  opens How agents run in place, as D-089 says.
- **A part for each task that fills it,** in their order: Appearance (GH-109),
  How agents run (GH-110), Limits and checks (GH-111), Trackers and sign-ins
  (GH-112), Notices in Slack, GitHub accounts and the Command Center's own
  preferences (GH-113), and About (GH-114). Each has a heading another page
  opens Settings at, with `show('settings', 'settings:<part>')`: it scrolls into
  view and takes focus. Until its task lands, a part says where its settings
  live today, with a button there; Limits and checks, set outside the Command
  Center today, says where and has no button. No control does nothing.
- **The theme is Match VSCode (the default), Light or Dark,** for acc's own
  pages only: the Command Center, task pages and agent pages. VSCode keeps its
  own theme, and so do the status bar and the sidebar launcher.
- **It's the setting `agentCommandCenter.theme`, of machine scope.** Settings
  Sync leaves machine settings alone, so it stays on this machine, and
  `onDidChangeConfiguration` tells every window, which globalState can't. A
  later per-machine choice, such as GH-113's refresh pace, is kept the same way.
- **`<html data-theme>` carries it,** always `vscode`, `light` or `dark`, so the
  choice is readable even when it's Match. It's on `<html>`, not `<body>`,
  because VSCode sets its theme's `--vscode-*` variables inline on `<html>`.
  `htmlFor` writes it into each tab's HTML. A tab on screen is told by a
  `theme` message and restyles in place, so nothing typed or scrolled is lost;
  a hidden tab's HTML is written again, at once or as it goes out of sight,
  since VSCode rebuilds a hidden tab from its HTML.
- **Light and Dark are complete palettes in `extension/webview/theme.css`,**
  which the build joins into the page's one stylesheet and the screenshots
  read. Each colour is `!important`, to beat VSCode's inline variables, and
  each palette sets `color-scheme`. They're the colours the screenshots drew
  with, plus the sixteen VSCode's own webview stylesheet reads (links on hover,
  code, quotes, keys, scrollbars, find highlights), copied from VSCode 1.139.0
  with where they came from (D-098). Fonts aren't in them: they stay VSCode's.
  The logo and the board menu's shadow follow the page's theme, not VSCode's.
- **Checked both ways.** A test checks the palettes set exactly the colours
  the pages and VSCode's stylesheet read, that only theme.css writes colours
  (but the masks and one fallback, pinned), and that nothing else keys on
  VSCode's body classes outside `[data-theme="vscode"]`. Each screenshot forces
  its theme under VSCode's other theme, so a leak would show, and
  `npm run screenshot -- --colours` compares every element's computed colours
  across themes in headless Chrome: 2574 elements on five pages, no
  difference. It runs by hand with the screenshots, since it needs Chrome.
- **How often the extension refreshes is one module,** `logic/polls.ts`, which
  extension.ts polls by and Settings says, so GH-113's pace has one source.
- Not done here: high-contrast palettes of acc's own, and the low contrast of
  orange text on white that the Light shots show, which was there before.
