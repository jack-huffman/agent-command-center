## D-011 In Salesforce projects, agents validate and never deploy (2026-10-01)

Parallel branches deploying to one shared sandbox would overwrite each other.
Builders run `sf project deploy validate`, which leaves the org unchanged.
Deploys happen after merge, from the target branch, one at a time. A protected
(production) target also needs a person to confirm.

_Note, 2026-10-23 (D-206):_ superseded for an environment that isn't
protected. A Salesforce builder now validates, then deploys its change to its
build org, verifies it there and runs its tests there, through `acc gate run
deploy` alone, before it's done. Deploys to one org take turns, and a builder
whose changed files another task in flight also changes waits. This decision
stands for a protected environment and production, for environment-specific
files and for deletions, and `acc deploy` after a merge stays a person's.
