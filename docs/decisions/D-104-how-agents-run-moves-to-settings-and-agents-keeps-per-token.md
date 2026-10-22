## D-104 How agents run moves to Settings, and Agents keeps per-token billing (2026-10-07)

GH-110, the second of the six tasks GH-109 began. It amends D-089: How agents
run is no longer behind the Agents page's Settings button but a part of the
Settings section, second after Appearance.

- **What moved:** builders' and reviewers' model, effort and fallback (D-036,
  D-086), and each project's autonomy (D-064) and auto-merge (D-083). Each
  keeps its **Change…**, the same `acc.agents.configure`, `acc.agents.autonomy`
  and `acc.agents.autoMerge` as before, which ask acc. This clone's choice goes
  in its git config, a project's in its `.acc/config.json`, for the person to
  commit. The page writes neither. The commands keep their ids and stay in the
  Agents area's `src/agents.ts`, but the Settings area lists them as the
  page's to ask for, since it draws them.
- **Every project setting is under its project's name,** even with one
  project, and each value says where it's set, in words with an icon: this
  clone (a desktop), project default or project (a repo), acc's default or
  Claude Code's default (an empty circle). Autonomy and auto-merge say
  "project": no clone sets them.
- **Each state has an icon and a label:** autonomy review (a rocket) or manual
  (pause), and dispatch or full, which autopilot refuses, in orange with a
  warning; auto-merge on (a merge) or off (a slash). Billing is blue on the
  subscription and orange per token. Colour adds to the words, never stands
  for them.
- **Billing is said once,** as this machine's, for every project, not once per
  project as Agents did. Per token or not checked yet, it has **Open Setup**,
  whose check says why and how to fix it.
- **Agents keeps per-token billing** above its sessions, as it did while How
  agents run was closed (D-089): it costs money while nobody looks. The
  subscription line shows only in Settings. Agents' model has a `billing` of
  its own instead of each project's settings.
- **The Agents page's Settings button and the status bar's Auto-merge open
  Settings at How agents run,** by `settingsKey('agents')`: the button within
  the page (`go(section, part)`), the status bar through `Panels.show`. Agents
  opens nothing in place any more, so the page's memory of an opened
  `agents:settings`, and a Settings link's `open`, are gone.
- **A jump stops below the tab strip.** Under 820 px the rail is a strip stuck
  to the top, and GH-109's jump scrolled the heading under it. `jumpTo` now
  leaves the strip's height above the heading. In headless Chrome, at 500 px
  the heading lands 13 px below the strip, and at 1000 px only the section
  scrolls.
- **With no onboarded project,** the part says so, with **Open Setup**.
- **Checked:** the part's model and page by `settings.test.ts`; Agents' button
  and billing by `agents.test.ts`; each Change… and the status bar's
  Auto-merge in the activation test, through the real acc: a builder's model
  for this clone lands in git config and not the project's, a reviewer's
  effort for the project in `.acc/config.json`, auto-merge turns on, and the
  menu item opens Settings at How agents run showing all three. Screenshots
  `settings-agents` (two projects, every source and state, per-token billing)
  and `agents-billing`, at 1000, 620 and 500 px in Light and Dark; `--colours`
  finds no difference across themes on them and `settings` (1204 elements).
- **Shot tall:** `settings-agents` is shot 3300 px tall so the page doesn't
  scroll. Headless Chrome draws a document a jump scrolled with a blank band
  above the tab strip, which VSCode doesn't.
