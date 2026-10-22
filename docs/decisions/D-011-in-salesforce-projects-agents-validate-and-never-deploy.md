## D-011 In Salesforce projects, agents validate and never deploy (2026-10-01)

Parallel branches deploying to one shared sandbox would overwrite each other.
Builders run `sf project deploy validate`, which leaves the org unchanged.
Deploys happen after merge, from the target branch, one at a time. A protected
(production) target also needs a person to confirm.
