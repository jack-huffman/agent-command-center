# Roadmap

Where each piece of the build stands, as of **2026-10-10**. Version 0.39.0 is
the latest release (2026-10-09).

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
- **M8 Pilots**: waiting on a person. Checked 2026-10-10. Evidence: D-025,
  GH-8. The done-when is one sprint of real tickets landing through acc. This
  repo is the first pilot and its tickets land through acc now (GH-167). The
  second, a Salesforce client repo, waits on that pilot's tickets, which a
  person has to bring.

## Packaging for other people to install

- **Install without Node, one version, a CHANGELOG, a scanned package, the
  plugin as a walkthrough step**: done. Checked 2026-10-10. Evidence: D-077,
  D-079, D-081, 0.39.0.
- **The first run on a fresh machine**: waiting on a person. Checked
  2026-10-10. Evidence: D-088, GH-88. [FIRST-RUN.md](FIRST-RUN.md) is the
  checklist. It needs a Mac that has never run acc and someone to fill it in. A
  follow-up that fixes what the run finds can't start until then.

## Cloud builders

- **Cloud builders as an option for a project on GitHub, never the default**:
  under way. Checked 2026-10-10. Evidence: GH-69. The issue is open and its
  work is on its own branch, in its second rework. It isn't on main, and there's
  no decision for it in DECISIONS.md yet.
- **A real cloud run, on this repo's next small task**: waiting on a person.
  Checked 2026-10-10. Evidence: GH-69. Claude Code starts a cloud session from a
  routine, and a person makes the routine and its token at claude.ai. acc can't
  make either.

## Later

- **Slack as a ticket source**: not started. Checked 2026-10-10. Evidence:
  D-005, D-078. Slack is only a place acc's notices go to today (D-078).
- **A pull request monitor that turns failing CI or a conflict into rework**:
  done. Checked 2026-10-10. Evidence: D-058, D-076. A conflict is merged from
  the base (D-058), and a pull request whose checks fail goes back to its
  builder once a commit (D-076).
- **A merge queue**: done. Checked 2026-10-10. Evidence: D-096.

What version 1 leaves out on purpose is listed in
[DESIGN.md section 19](DESIGN.md#19-left-out-of-v1).
