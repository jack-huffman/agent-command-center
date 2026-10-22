## D-064 The Command Center runs autopilot and shows what it did (2026-10-05)

`acc autopilot --every` (D-055) ran only in a terminal someone kept open. Now
the extension runs it, and shows what it did, wherever it ran.

- **A switch in the status bar.** Each repo whose autonomy isn't manual has an
  item (projects that share a ledger are one repo). It says "Autopilot: on"
  with a rocket, or "Autopilot: off" with a pause icon, and names its project
  when there's more than one. A click turns it on or off for this window until
  VSCode closes.
  - As the author chose, it's off when VSCode opens. The autonomy setting is
    the project's consent; the click is this person's, on this machine, today
    (D-014). Nothing about the switch is saved.
  - With autonomy dispatch or full, or no `github` section, it says off with a
    no-entry icon, and its tooltip and a click give acc's own words for why.
- **On, it's one of the window's runs** (D-030): `acc autopilot --every 60`,
  run from the main checkout and labelled "Autopilot · <project>". It's a
  background run. It stays out of the status bar's running item, and the output
  panel shows another command first, with autopilot in its picker. Turning it
  off, or closing the window, ends its process group, as Stop does.
- **It stops when its window goes.** The extension passes its own pid as
  `ACC_AUTOPILOT_PARENT`. Once that process is gone, autopilot stops before its
  next step, or within a second while it waits between passes. A step under way
  finishes first. So an extension host that crashes leaves no autopilot landing
  work with no window open.
- **Still one autopilot a repo.** When another window or a terminal holds
  `autopilot.lock`, the switch says "Autopilot: on elsewhere" with that pid in
  its tooltip, and a click says where it runs. A run that loses the race for the
  lock is dismissed, not shown as failed.
- **What it did comes from the ledger's events,** not from its output, so every
  window shows it, whichever window or terminal ran it. The hub reads the last
  256 KB of `events.jsonl` once, then only what was added since. It keeps
  autopilot's newest 300 steps: reviews, lands, re-dispatches, refreshes
  (D-058) and failures.
  - **History** lists each step once, with its icon and words, such as
    "Autopilot landed it: pull request #40", under the Tasks filter. Autopilot's
    own moves (review → rework, rework → running) are told by their step and
    aren't listed twice.
  - **A notice** (D-044) for each step after the first full load, such as
    "Autopilot landed GH-31: pull request #40" with Open pull request. What it
    couldn't do is a warning, "Autopilot couldn't land GH-31: <reason>", with
    the step to take by hand. They follow `agentCommandCenter.notifications`
    and stay quiet while the Overview or Tasks is on screen.
  - D-044's "The review passed X" and "The review asked for changes on X" stay
    quiet for a task whose latest autopilot step is that review. Autopilot
    lands or re-dispatches it next, and their Land or Re-dispatch button would
    race it.
- **Jira and Azure DevOps comments** still wait for a person, as the author
  chose. A land's notice for such a task says "Its comment on <KEY> waits for
  you in Autopilot's output", with Show output. Posting it from the extension
  is a follow-up.
- **Autonomy is set from the Agents section.** "How agents run" has an Autonomy
  row with its value and where it's set (the project). Change… offers manual
  and review, and runs `acc agents autonomy <value>`. That new command changes
  only that value in `.acc/config.json`, for the person to commit. It refuses
  dispatch and full, which aren't built, and refuses builders, reviewers and
  analysts. `guardBash` and the builder's settings deny it too.
- **Accepted:** turning autopilot off, or closing VSCode, during a step ends
  that step. A review's work is lost, and the next pass reviews again. A land
  stopped between its push and its ledger write is redone by the next land,
  which finds the pull request, though the issue's comment may be posted twice,
  as D-053 accepted.
- Not chosen:
  - Reading autopilot's `--json` output for History and notices. It's there
    only when this window runs autopilot, and it's gone after a reload.
  - Saving the switch in settings or workspace state. Every window would then
    start autopilot on its own when it opens, which the author ruled out.
  - Letting the step under way finish before Off takes effect. Off ends the
    process, as Stop ends any run.
