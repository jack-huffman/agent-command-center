## D-121 Slack, each repo's GitHub account and the Command Center's own preferences are in Settings; switching an account is a person's (2026-10-08)

GH-113, the fifth of GH-109's six tasks. It amends D-078, which put Slack's
card on Environments, and D-090, whose Where view only Agents switched.

- **Notices in Slack moved to Settings, whole:** the card, its commands and
  the webhook's handling are D-078's, unchanged. Its badge came with it:
  Settings turns orange in the rail while Slack is paused, and Environments no
  longer does for Slack (a wrong GitHub account still turns it orange). So did
  its toast: **Open Settings** opens the part, and **Send notices to Slack…**,
  or a test with no webhook, opens it too. Environments keeps a line under
  **This machine**, "Notices in Slack moved to Settings.", with **Open Notices
  in Slack**.
- **GitHub accounts lists every open project under its name:** the account its
  repo pushes as, from this clone (git config) or the project
  (`.acc/config.json`), gh's sign-in, and the commit identity, each with an
  icon and words, blue or orange; a problem is said once. It's drawn from the
  identity Environments' card already reads (D-028), so Settings runs nothing
  of its own. **Switch…** is `acc.github.switch` for that project, which asks
  `acc github use`; **Sign in** or **Add Projects access** shows when gh needs
  it. A project with no `"github"` section says so, with Switch… disabled and
  why. Environments keeps its identity card: it's where promotions and pushes
  happen, and the buttons are the same commands.
- **`acc github use` is a person's at all three layers** (the author chose
  this): the CLI refuses builders, reviewers and analysts by name and autopilot
  as not a person (`noAgent`); the hook's `PERSON_ONLY_ACC` names `github use`;
  the builder's deny list has `Bash(acc github use*)`. The ticket said
  `github`: naming the subcommand, as `gate waive` and `rules import` are named,
  keeps `acc github status`, which only reads, a builder's.
- **The Command Center's own preferences, each a command:**
  - **Opens on:** Where I left it (the default) or a named section, per window,
    in its workspaceState (`acc.home.opensOn`). It applies when the Command
    Center opens afresh with no section asked for, as from its activity bar
    icon; a link to a section, or a page already open, is left alone.
    `acc.settings.opensOn`.
  - **Agents' Where:** Folder or Full path (D-090), per window, as before
    (`acc.agents.where`). Agents' toggle and Settings both set it through
    `Panels.setWhere`. `acc.settings.where`.
  - **Refresh pace:** Normal, Relaxed (each on-screen interval ×2) or Slow
    (×4), kept on this machine in `agentCommandCenter.refreshPace`, a setting
    of machine scope like the theme (D-101), so every window takes it at once.
    `pollEvery` in `logic/polls.ts` is the only place it applies: hidden-page
    intervals, agents' questions and autopilot's timers don't poll through it,
    so a slow page never makes acc slower to notice what needs you. The part
    lists each interval at the pace chosen. `acc.settings.pace`.

  Each command takes a choice or asks with a quick pick, and refuses one it
  doesn't know in words, changing nothing. The page asks for each with the
  choice; it writes nothing itself (D-064).
- **Every state has an icon and a label,** in Light, Dark and Match VSCode. The
  colour check found the Slack card's ticks took their text colour from the
  browser's colour scheme, not the palette, which it had never looked at on
  Environments; they inherit the page's now.
- **Checked:** `settings.test.ts` for each part's model, the pace at every
  interval, each command's wiring, the badge, toast and moved line;
  `slack.test.ts` for the badge in Settings and not Environments;
  `activate.test.ts` through the built extension: each preference's command
  with a choice, without one (it asks) and with one it doesn't know, the pace
  in VSCode's settings, the Where view in the window's state from either
  place, the Command Center reopening on the section chosen, and Slack's
  command opening Settings at its part; `cli.test.ts` runs `acc github use`
  as each role through the CLI, the hook and the deny list. Screenshots
  `settings-github`, `settings-page` and `slack-none`, `slack-off` and
  `slack-paused` (now Settings opened at the part), and `environments`, at
  1000, 620 and 500 px in Light and Dark; `--colours` finds no difference
  across themes on 8,300 elements on 12 pages, About's among them.
- Not chosen: moving Environments' identity card to Settings, since promotion
  and push problems are seen there; refusing `acc github status` to builders;
  a refresh pace per window, since the load it eases is the machine's; slowing
  hidden polls, questions or autopilot.
- **Each label in one place (GH-150).** GitHub accounts' "this clone" is
  `settingFrom('clone')`, FROM_WORDS' words, as How agents run says it.
  Environments' moved line opens `settingsKey('slack')`, as Slack's commands
  and toast do. Agents' Folder / Full path toggle draws each view from a copy
  of `WHERE_WORDS` in `webview/agents.ts`, in its order: the page imports no
  values from `src`, which would bundle the extension's code into it, so a
  `settings.test.ts` test pins the copy to `model/settings.ts`'s and fails if
  they name a view differently, as `HOW_AGENTS_RUN` is pinned to
  `settingsKey('agents')`. `activate.test.ts` runs
  `acc.github.signIn('jordan-kim')` with VSCode's sign-in coming back as
  another account, and checks it says it wanted jordan-kim. Nothing on screen
  changes.
