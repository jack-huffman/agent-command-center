## D-T-159 A builder isn't done until each Apex class it changes reaches the coverage floor in the development org (2026-10-30)

T-159. The person: "when an agent is building a ticket in the dev environment according to the plan, the agent
doesn't stop until that metadata is in that development environment, tested, and looks good. If there is apex,
it has code coverage of at least 75%, ideally 100%."

It adds to D-206. The deploy gate already deployed, asked the org for each component, and ran the named tests
there, but it only recorded the whole run's coverage, and no number failed it.

- **Each changed class's coverage, from the org.** Once the named tests pass in the org, the gate asks the
  Tooling API's `ApexCodeCoverageAggregate` for each Apex class and trigger the change adds or changes
  (`packages/core/src/apex-coverage.ts`). Salesforce clears a class's coverage when it's deployed again, so what
  the org holds then is what tests found since the deploy. A test class doesn't count: one the builder named
  with `--test`, or one whose source says `@isTest`. Nor does an interface or an enum, which has no line to cover.
  A class the org has no row for is one no test ran: 0%.
- **A floor of 75%, which a project may raise.** A changed class or trigger under the floor fails the gate,
  named with its figure and up to 20 of the lines not covered. The share decides, and the figure is rounded
  down, so 74.9% fails and reads 74%. `gates.apexCoverage` in the project's settings raises the floor, a whole
  number from 75 to 100; acc refuses one under 75, Salesforce's own floor for Production. The gate reads it from
  the project's trusted settings (D-206), never the worktree's copy, so a builder can't lower it.
- **100% is the goal.** A class at or over the floor passes, and the receipt, the task's deploy and the ticket's
  Changes say its figure: "OrderService 88%, 4 lines not covered".
- **The packet says it.** A Salesforce builder's packet says its work is in the org, verified there and tested
  there; each changed class reaches the floor, aiming for 100%, with each figure in the note; and before
  `acc done`, a test or a query proves the result does what the plan says, for a flow or a page too.
- **The oracle** is a fixed answer from sf, `ApexCodeCoverageAggregate`'s records as `sf data query --json`
  gives them (`packages/core/test/apex-coverage.test.ts`, `packages/core/test/deploy-gate.test.ts`). Among the
  tests: a changed class at 74% fails the gate.
