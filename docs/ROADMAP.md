# Roadmap

Each phase ends with something that works and has been checked. Later phases can
change once earlier ones show what is actually needed.

## Phase 1: Design (in review)

[DESIGN.md](DESIGN.md) covers the ledger, config, profiles, dispatch, the
instructions given to agents, hooks, review, landing, the loop and the
extension. Its open questions are listed at the end.

## Phases 2 to 5: Build

The build follows the milestones in [DESIGN.md section 18](DESIGN.md#18-build-order):

1. **M1** Core and CLI
2. **M2** Dispatch
3. **M3** Gates
4. **M4** Review and landing
5. **M5** Plugin
6. **M6** Extension
7. **M7** Pilots

Each milestone is filed as GitHub Issues on this repo. From M2 on, the work is
dispatched to agents with what already exists.

## Later

- monday.com intake, Slack notifications
- a pull request monitor that turns failing CI or conflicts into rework tasks
- a merge queue
- cloud sessions
- packaging for other people to install
