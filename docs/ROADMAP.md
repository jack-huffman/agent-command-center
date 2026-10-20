# Roadmap

Where each piece of the build stands, as of **2026-10-20**. Version 0.41.0 is
the latest release (2026-10-16), the first with a `.sha256` beside its `.vsix`.
Version 0.42.0 is prepared and waits on a person to release it.

Every bullet below is one status line, in this form:

> **Name**: *status*. Checked *date*. Evidence: *decisions, issues or release*.

- The status is one of **done**, **under way**, **waiting on a person** or
  **not started**.
- "Checked" is the day someone last read the evidence and the issue against it.
  It doesn't mean the milestone was run again that day.
- Evidence is a decision in [DECISIONS.md](DECISIONS.md) (D-nnn), a GitHub issue
  (GH-nnn) or a release in [the CHANGELOG](../CHANGELOG.md).
- `scripts/test/roadmap.test.ts` fails on a status line with no status, no
  date or no evidence, on a decision that isn't in DECISIONS.md, on a release
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
  Its first real offer comes with the next release after 0.41.0.
- **The first run on a fresh machine**: waiting on a person. Checked
  2026-10-16. Evidence: D-088, GH-88. [FIRST-RUN.md](FIRST-RUN.md) is the
  checklist. It needs a Mac that has never run acc and someone to fill it in. A
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

- **Slack as a ticket source**: under way. Checked 2026-10-16. Evidence:
  D-145, D-146, D-148. A channel connects with a Slack app's bot token, and a
  thread becomes a task when its link is pasted on the Tasks tab. A board of
  Slack messages with a reaction is still to come.
- **A pull request monitor that turns failing CI or a conflict into rework**:
  done. Checked 2026-10-10. Evidence: D-058, D-076. A conflict is merged from
  the base (D-058), and a pull request whose checks fail goes back to its
  builder once a commit (D-076).
- **A merge queue**: done. Checked 2026-10-10. Evidence: D-096.
- **Cloud reviewers and analysts**: not started. Checked 2026-10-12. Evidence:
  D-140. Cloud builders came first (GH-69); reviews and analyses still run on
  the Mac.

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
  2026-10-20. Evidence: D-176, D-177. Drafted acceptance criteria are being
  built. Verifying a developer's pull request waits on a person's answers.

What version 1 leaves out on purpose is listed in
[DESIGN.md section 19](DESIGN.md#19-left-out-of-v1).
