# Roadmap

Where each piece of the build stands, as of **2026-10-29**. Version 0.52.0 is
the latest release (2026-10-29). 0.41.0 (2026-10-16) was the first with a
`.sha256` beside its `.vsix`. Version 0.53.0 is prepared and waits on a person
to release it.

Every bullet below is one status line, in this form:

> **Name**: *status*. Checked *date*. Evidence: *decisions, issues or release*.

- The status is one of **done**, **under way**, **waiting on a person** or
  **not started**.
- "Checked" is the day someone last read the evidence and the issue against it.
  It doesn't mean the milestone was run again that day.
- Evidence is a decision in [DECISIONS.md](DECISIONS.md) (D-nnn), a GitHub issue
  (GH-nnn) or a release in [the CHANGELOG](../CHANGELOG.md).
- `scripts/test/roadmap.test.ts` fails on a status line with no status, no
  date or no evidence, on a decision that isn't in `docs/decisions/`, on a release
  that isn't in the CHANGELOG, and on a date that hasn't come yet. So when a
  status changes, change its date and its evidence in the same edit.

The milestones are the ones in [DESIGN.md section 18](DESIGN.md#18-build-order),
where each one's done-when is written out.

## Design and milestones

- **Design**: done. Checked 2026-10-10. Evidence: D-001, D-014, D-018. Its open
  questions were all answered on 2026-10-01 (DESIGN.md section 20).
- **M1 Core, CLI and onboarding checks**: done. Checked 2026-10-10. Evidence:
  D-012, D-017, 0.34.0.
- **M2 Walkthrough**: done. Checked 2026-10-10. Evidence: D-020, D-035, D-047,
  GH-2. The sidebar came before dispatch (D-020), and the Command Center page
  replaced it (D-029). Its milestone issue, GH-2, is still open on GitHub.
- **M3 Dispatch**: done. Checked 2026-10-10. Evidence: D-009, D-013, D-022,
  GH-167. This repo's own tasks run end to end through it: GH-167 is the latest
  one merged.
- **M4 Gates**: done. Checked 2026-10-10. Evidence: D-024, D-025, D-056. Its
  done-when, a validate that passes against a sandbox from a worktree, was
  read from those decisions and not run again.
- **M5 Review and land**: done. Checked 2026-10-10. Evidence: D-032, D-033,
  D-034, D-055.
- **M6 Plugin**: done. Checked 2026-10-10. Evidence: D-042, D-081, 0.39.0.
- **M7 Extension views**: done. Checked 2026-10-10. Evidence: D-044, D-064,
  D-129, D-131, GH-7. Its milestone issue, GH-7, is still open on GitHub.
- **M8 Pilots**: waiting on a person. Checked 2026-10-16. Evidence: D-025,
  GH-8. The done-when is one sprint of real tickets landing through acc. This
  repo is the first pilot and its tickets land through acc now (GH-167). The
  second, a Salesforce client repo, waits on that pilot's tickets, which a
  person has to bring.

## Packaging for other people to install

- **Install without Node, one version, a CHANGELOG, a scanned package, the
  plugin as a walkthrough step**: done. Checked 2026-10-10. Evidence: D-077,
  D-079, D-081, 0.39.0.
- **The extension updates itself**: done. Checked 2026-10-16. Evidence: D-166.
  It looks for a newer release, offers it, and installs it after checking its
  `.sha256`, and refuses a release with none (D-173). 0.41.0's checksum was checked against its `.vsix` on 2026-10-16.
  0.42.0 (2026-10-20) is the first release it can offer.
- **The first run on a fresh machine**: waiting on a person. Checked
  2026-10-27. Evidence: D-088, GH-88. [FIRST-RUN.md](FIRST-RUN.md) is the
  checklist, brought up to 0.46.0 with the author's preparation and the likely
  stops, and how to install on Windows (0.48.0). It needs a Mac or a Windows
  machine that has never run acc and someone to fill it in. A
  follow-up that fixes what the run finds can't start until then.

## Cloud builders

- **Cloud builders as an option for a project on GitHub, never the default**:
  done. Checked 2026-10-12. Evidence: GH-69, D-140. Merged to main with its
  push guard; the real run, below, still waits on a person.
- **A real cloud run, on this repo's next small task**: waiting on a person.
  Checked 2026-10-16. Evidence: GH-69. Claude Code starts a cloud session from a
  routine, and a person makes the routine and its token at claude.ai. acc can't
  make either.

## Later

- **Slack as a ticket source**: done. Checked 2026-10-21. Evidence: D-145,
  D-146, D-148, D-181. A channel connects with a Slack app's bot token. A
  thread becomes a task when its link is pasted on the Tasks tab, or with Track
  on its card on the board of the channel's messages marked with a reaction.
- **A pull request monitor that turns failing CI or a conflict into rework**:
  done. Checked 2026-10-10. Evidence: D-058, D-076. A conflict is merged from
  the base (D-058), and a pull request whose checks fail goes back to its
  builder once a commit (D-076).
- **A merge queue**: done. Checked 2026-10-10. Evidence: D-096.
- **Cloud reviewers**: done. Checked 2026-10-21. Evidence: D-140, D-184 (T-86). Where a
  project opts in (`agents.cloud.review`), a task's review runs in a cloud
  session and its verdict comes back by a push; local stays the default.
- **Cloud analysts**: not started. Checked 2026-10-21. Evidence: D-140, D-184 (T-86). An
  analysis reads the orgs through the person's own login, which never goes to
  a cloud session, so an analyst there could read only the repo; worth doing
  for a generic project first.

- **A command palette**: done. Checked 2026-10-16. Evidence: D-156.
- **The output panel as a designed view, with acc's steps and reviews**: done.
  Checked 2026-10-16. Evidence: D-167, D-169, D-171.
- **Fewer notifications, and what changed while you were away**: done. Checked
  2026-10-16. Evidence: D-162, D-164.
- **Dispatch asks for the model, the effort and where it runs**: done. Checked
  2026-10-16. Evidence: D-168.
- **An accessibility check on every drawing, WCAG 2.1 AA**: done. Checked
  2026-10-16. Evidence: D-160, D-161. Four contrast exceptions on the theme's
  own colours stay, by choice.
- **UI changes verified with a pinned headless shell**: done. Checked
  2026-10-16. Evidence: D-172. One check is still a person's: that the Chrome
  app opens a window when clicked while a run draws.
- **Write and edit a task in a full sheet**: done. Checked 2026-10-20.
  Evidence: D-175.
- **Follow a Jira sprint, and filter a board by person**: done. Checked
  2026-10-20. Evidence: D-176, D-178.
- **Change a ticket's text and fields from acc, where edits are allowed**:
  done. Checked 2026-10-20. Evidence: D-177. Jira and GitHub only; Azure
  DevOps, monday.com and Slack refuse, with why.
- **Help for a person who reviews other people's tickets**: under way. Checked
  2026-10-21. Evidence: D-176, D-177, D-179, D-182. Drafted acceptance
  criteria are done. Verifying a developer's pull request is done, for pull
  requests on GitHub. A view of developers' notes is not started.
- **Tickets that look considered on every tracker**: done. Checked 2026-10-21.
  Evidence: D-185, D-187. Every tracker fills the same fields, and Jira,
  GitHub, Azure DevOps, monday.com and Slack tickets share one state chip,
  tinted labels and avatars, one ticket page and richer cards.
- **A builder that never started needs a person, never shows as running**:
  done. Checked 2026-10-21. Evidence: D-186.
- **Plain words for someone new**: done. Checked 2026-10-22. Evidence: D-188.
- **Plans a person decides: options, discussion and approval**: done. Checked
  2026-10-22. Evidence: D-192, D-195. Open in Claude Code hasn't been tried by
  hand yet in plan mode.
- **What a ticket changed, records included, and its package.xml**: done.
  Checked 2026-10-22. Evidence: D-189, D-190, D-191, D-196. A tracker's own
  changes field is kept up to date, saved by a person.
- **Choose a board by seeing it**: done. Checked 2026-10-22. Evidence: D-193,
  D-194.
- **Plans you talk through and review one step at a time**: done. Checked
  2026-10-23. Evidence: D-200, D-201, D-202, D-204, D-205. The conversation's
  questions come one at a time too, with at most three options and your own
  words.
- **Parallel builders that work as a team, and merge on their own**: done.
  Checked 2026-10-22. Evidence: D-197, D-198, D-199.
- **A GitHub check on every pull request, so autopilot can merge**: done.
  Checked 2026-10-22. Evidence: D-203. GitHub doesn't offer required checks on
  this private repo's plan; autopilot waits for the check itself.
- **A Salesforce builder deploys to its sandbox, verifies and tests there**:
  done. Checked 2026-10-23. Evidence: D-206. Supersedes D-011 for unprotected
  environments; production and protected orgs stay validate-only.
- **Report a problem from the Command Center**: done. Checked 2026-10-27.
  Evidence: D-207. Posting needs a GitHub account that can reach this repo;
  without one, the page offers the issue text to send another way.
- **The Command Center on Windows, natively**: done. Checked 2026-10-27.
  Evidence: D-209, release 0.48.0. CI's Windows job runs the unit tests and
  finds and runs git, node, npm, gh and the Salesforce CLI through acc's
  runner. It hasn't been run by a person on a Windows machine yet; 15 tests
  skip there, each named with why.
- **Set up a Salesforce project without access to Production**: done. Checked
  2026-10-27. Evidence: D-208, release 0.48.0.
- **Up to ten boards in one project, switched on the Tasks tab**: done. Checked
  2026-10-27. Evidence: D-211, release 0.49.0. Shot with ten boards on three
  Jira sites; not yet used on real clients' sites.
- **Jira Service Management queues as boards**: done. Checked 2026-10-27.
  Evidence: D-210, release 0.49.0. Read against stand-in answers built from
  Atlassian's docs; not yet against a real service desk.
- **Answering the planning agent's questions, with nothing lost or sent by
  mistake**: done. Checked 2026-10-27. Evidence: D-212, release 0.50.0.
- **Seeing the plan being made**: done. Checked 2026-10-27. Evidence: D-213,
  release 0.50.0.
- **A task page in tabs, the ticket with its comments first, and sections
  that collapse**: done. Checked 2026-10-28. Evidence: D-214, D-216, release
  0.50.0.
- **A project starts with this machine checked, on a Mac or Windows**: done.
  Checked 2026-10-28. Evidence: D-215, release 0.50.0. CI's Windows job runs
  the machine check; not yet run by a person on a Windows machine.
- **A task's review in a tab, and a calmer Plan tab**: done. Checked
  2026-10-28. Evidence: D-217, D-218, release 0.51.0.
- **Deploy one ticket from its page, checked first, its branch kept in step**:
  done. Checked 2026-10-28. Evidence: D-219, D-220, release 0.51.0. Tried
  against stand-in Salesforce and GitHub answers; not yet on a real org.
- **A concise Agent panel, a board that opens on my tasks, and buttons in a
  row that share one size**: done. Checked 2026-10-28. Evidence: D-221,
  D-222, D-223, release 0.52.0.
- **Settings in sections, a stepped modal for a tracker, and saved tickets a
  session reads**: done. Checked 2026-10-28. Evidence: D-224, D-225, D-226,
  release 0.52.0.
- **Cloud builders set up in one guided walkthrough, on a Mac or on Windows**:
  done. Checked 2026-10-29. Evidence: D-228, release 0.53.0. Tried against
  stand-in claude.ai and GitHub answers; the real cloud run (GH-69) still
  waits on a person.
- **Short notes in plain technical English, a card that shows it's working,
  and This PC on Windows**: done. Checked 2026-10-29. Evidence: D-227, D-229,
  D-230, D-231, D-232, release 0.53.0.

What version 1 leaves out on purpose is listed in
[DESIGN.md section 19](DESIGN.md#19-left-out-of-v1).
