## D-124 Nothing opens on its own: the Command Center's first open in a folder that isn't set up lands on Setup (2026-10-08)

GH-138. The author: rather than have the Command Center pop up in every new
repo, the setup page should start the first time the person goes to it in a
repo. It amends the M2 walkthrough (D-017), which opened VSCode's Get Started
tab on its own: the machine walkthrough on a machine's first window
(`acc.welcomed`), and the project walkthrough in every Salesforce folder with
no `.acc/config.json` (`acc.projectWalkthroughShown`).

- **Opening a folder opens nothing:** no walkthrough tab, no notification.
  `maybeOpenWalkthroughs` is gone. The extension still starts with VSCode
  (`onStartupFinished`) and runs its checks, so the status bar and the rail's
  badges are as before.
- **The first open lands on Setup.** The first time a person opens the
  Command Center in a folder with no `.acc/config.json`, from the activity bar,
  the status bar menu's **Open the Command Center** or `acc.open.home` with no
  section, it opens on Setup: at **This machine** while the machine's steps
  haven't all passed (a machine not checked yet: see GH-149 below), in place of the machine
  walkthrough; otherwise at **What kind of project is this?**. Every profile
  gets it: a folder that isn't a Salesforce project has no project checks yet,
  so This project shows the question alone. Its **Choose…** is B0.config's
  **Do it**, and the quick pick it opens has the same title, from one
  constant. It's kept in the workspace's workspaceState (`acc.home.firstOpened`),
  so it happens once per workspace: in a multi-root workspace, only the first
  folder that isn't set up gets it. After it, the Command Center opens where it was left or
  on the section D-121's preference names. `logic/first-open.ts` decides,
  `Panels.open` asks it.
- **Sent somewhere, it goes there.** `Panels.show`, which Connect a tracker, a
  run's output, Settings' links and the rest call, never redirects, and
  `acc.open.home` with a section, as the sidebar's list sends, goes to that
  section. Neither counts as the first open. A folder that's set up is never
  sent to Setup.
- **The status bar menu's Open the Command Center** now opens as a person's
  open does (`Panels.open`), so the first open and D-121's opens-on choice
  apply to it too; it used to name the Overview.
- **The walkthroughs open when asked for:** Setup's header has **Machine
  walkthrough** and **Project walkthrough** (it had one, **Walkthrough**); the
  Command Palette and VSCode's Get Started page list them as before.
- **Checked:** `first-open.test.ts` decides each case (asked for, already
  open, a second open, set up, no folder), the machine's readiness and the
  Setup model's question; then, through the built extension in a sandbox with
  no `acc.welcomed`: a Salesforce folder that isn't set up opens no walkthrough,
  no page and no notification; a section asked for goes there and doesn't
  count; the first open lands at the question, once, and the next opens where
  it was left; Setup's two buttons send their commands, and each opens its own
  walkthrough; on a machine with a step to do, a folder of no profile lands at
  This machine; a set-up folder opens on the Overview and keeps no first open.
  Screenshots `setup-first` and `setup-first-machine`, Setup as first shown
  in a folder that isn't set up, at 1000, 620 and 500 px in Light and Dark;
  the geometry run's floors rose with the pages (overlap 9360, tab 258).
- Not chosen: a notification offering Setup, since nothing should appear
  unasked; counting a section asked for as the first open, since the person
  hasn't seen Setup; project checks in every git folder, which would put steps
  to do in the status bar of every repo opened.
