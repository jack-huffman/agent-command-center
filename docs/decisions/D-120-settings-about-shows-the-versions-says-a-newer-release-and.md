## D-120 Settings' About shows the versions, says a newer release and an older plugin, and Setup's machine results are kept per version (2026-10-08)

GH-114, the last of GH-109's six tasks. The author asked for a Settings page;
its About part was to show the versions of acc, the extension and the plugin,
and say when a newer release is out.

- **Three versions, read fresh, each with where it's read from.** acc's from
  `acc --version`, run from the bundle the extension runs (the acc on its
  terminals' PATH is the same bundle); the extension's from its own
  `package.json`; the plugin's from `claude plugin list --json`, the user-scope
  install A4 reads. They're read each time Settings is arrived at (the rail,
  `acc.open.settings`, the tab coming back on screen, the page loading on
  Settings) and at Settings' Refresh, never on the polls' redraws, so sitting on
  Settings runs nothing.
- **One comparison for A4 and About** (D-088). `pluginBehind` in core's
  onboarding helpers is the only test of "older": `x.y.z` against `x.y.z`, an
  older plugin only, and nothing for a version it can't read. A4 fails on it
  against acc's version; About says it in orange against the extension's,
  which ships the same acc. `userPlugin` reads the list for both. A test runs
  A4 itself over the same pairs and checks About is orange exactly when A4
  fails. About's **Update the plugin** (or Install, or Turn on) is Setup's own
  fix, `acc.step.fix A4.plugin`, which checks again and runs what the check
  names, in a terminal like any `claude` subcommand.
- **A newer release, as gh's active account.** The repo is private, so
  `gh release view --repo jack-huffman/agent-command-center` runs as whoever
  is signed in to gh, not a project's account; `GH_TOKEN`, `GITHUB_TOKEN` and
  the enterprise tokens are left out of its environment, since they'd win.
  It's looked for once when Settings first shows in a session (a window's
  run of the extension), then when Settings opens, at most every six hours,
  and whenever **Check now** is clicked. A newer release is orange with a link
  to its notes on GitHub (only a github.com page is linked); up to date is
  blue; a look that fails, no release yet, and not looked for yet are
  neutral. A failed look counts as a look, so a machine offline isn't asked
  again on every visit; Check now asks at once.
- **`acc.machineItems` carries the version that checked it.** Startup reused
  the machine's results for 12 hours whatever had changed, so after an
  upgrade A4 could pass a plugin the new acc would fail. Saved results now
  hold the extension's version and are reused only by that version; results
  saved before this, or with no version read, are checked again.
- **Nothing here writes** (D-064). The versions and the release are reads,
  the plugin's update is Setup's fix, and a release installs by hand, as the
  README says. None of About's values is a project's, so none names one.
- **Every state has an icon and words,** orange for what needs you, blue for
  current or under way, neutral for unknown. Light, Dark and Match VSCode drew
  the same colours on every page the colour check reads, About behind among
  them (5,350 elements on nine pages).
- Not chosen: keeping the last release look across sessions, which would skip
  the first-open look the task asked for; installing a newer release from the
  page, since the VSIX comes from a private release and the README's steps
  stand; comparing acc with the extension in orange, since the extension
  always runs its own bundle and a mismatch only means the window needs a
  reload, which About says in words.

Note (GH-147, 2026-10-09): A4 and About read the plugin list one way. Core's
`parsePluginList` (over `parseClaudeList`, which A4's marketplace check uses
too) takes the run's result and runs nothing; it replaced A4's private
`claudeJson` and About's copy of it. A list About can't read now says A4's
words in its neutral row, such as "Couldn't read Claude Code's plugins: claude
plugin list didn't run: …", where it said claude's first line alone; no
screenshot shows that state, and A4 reads as before. About's states are walked
in `looks.test.ts`'s TABLES, and since its rows aren't looks by type, a test
there matches every `LOOK` in `model/about.ts` to a state the walk reaches, so a
new one it doesn't walk fails. Each state is written as its own `LOOK` for that.
