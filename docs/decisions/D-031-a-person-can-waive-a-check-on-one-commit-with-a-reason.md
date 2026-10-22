## D-031 A person can waive a check on one commit, with a reason (2026-10-02)

T-1 stopped at Blocked: its formatting commit passed `format`, but `static` and
`validate` failed on problems that predate it. acc had no way to say "set this
aside" except forcing the move, which records the override but not which checks
were waived, or why.

- **A waiver is the gate's receipt.** `acc gate waive <gate>... --reason "<why>"`
  writes a `skip` receipt for the commit: the task's latest commit with
  `--task`, else this checkout's. The receipt keeps `waived: { by, reason, at,
  was }`.
  - A skip already satisfies a required gate (D-024), so `acc done` and the move
    rules need nothing new.
  - The ticket page shows the check as **waived**, with its reason.
- **It holds for that commit only.** `acc gate run` doesn't rerun a waived gate
  on the same commit. A new commit starts with no checks, waived or not.
- **Only a person can waive.** The CLI refuses when `ACC_ROLE=builder`, whatever
  `--as` says. Builder settings deny `acc gate waive`. A gate that passes has
  nothing to waive, and a waiver needs a reason.
- **Blocked → review, by a person, once every required check is satisfied.** A
  builder that blocks on failing checks has finished its work. Once a person
  has settled the checks, the task goes to review by the rules, with no
  override.
- **In the page:** a failing or errored check on a ticket page has
  **Waive…**, which asks for the reason. Move then offers In review.

Used first on T-1: `static` and `validate` waived, because it tests the process
and won't be promoted. It then moved from Blocked to In review.
