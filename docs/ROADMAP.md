# Roadmap

Each phase ends with something that works and has been checked. Later phases can
change once earlier ones show what is actually needed.

## Phase 1: Design (in review)

[DESIGN.md](DESIGN.md) covers the ledger, config, profiles, dispatch, the
instructions given to agents, hooks, review, landing, the loop and the
extension. Its open questions are listed at the end.

## Phases 2 to 5: Build

The build follows the milestones in [DESIGN.md section 18](DESIGN.md#18-build-order):

1. **M1** Core, CLI and onboarding checks
2. **M2** Walkthrough: the first GUI, a guided setup in VSCode. Then the sidebar,
   pulled forward from M7 (D-020): Tasks, Agents, Worktrees, Environments, Setup
3. **M3** Dispatch
4. **M4** Gates
5. **M5** Review and landing
6. **M6** Plugin
7. **M7** Extension views: the board webview, notifications, richer agent controls
8. **M8** Pilots

Each milestone is filed as GitHub Issues on this repo. From M3 on, the work is
dispatched to agents with what already exists. [ONBOARDING.md](ONBOARDING.md)
writes up every walkthrough step, and how to do it by hand.

## Under way: packaging for other people to install

Four tasks. acc runs with no Node (D-077); one version, a CHANGELOG and a
package scanned for personal data (D-079); and the walkthrough's plugin step,
with the README's Install and first run (D-081). GH-62 got the fourth ready:
Setup forgets steps that no longer apply, A4 fails on an older plugin, and
[FIRST-RUN.md](FIRST-RUN.md) is the checklist for the run (D-???). Left: 0.36.0
released, the run itself on another machine, and a follow-up that fixes what
it finds.

## Later

- monday.com intake (acc's notices go to Slack already: D-078 in DECISIONS.md)
- a pull request monitor that turns failing CI or conflicts into rework tasks
- a merge queue
- cloud sessions
