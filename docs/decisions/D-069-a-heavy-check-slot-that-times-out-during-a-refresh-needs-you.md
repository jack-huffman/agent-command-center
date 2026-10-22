## D-069 A heavy-check slot that times out during a refresh needs you (2026-10-06)

GH-34's review (GH-40) found that a refresh whose checks couldn't get the
heavy-check slot in 3 hours waited for the next pass, as D-058 chose, under a
fixed "so the merge was undone". That hid refresh's own message, which says
whether putting the branch back worked and, when it didn't, where to look.

- **It's recorded like any failed step,** as the author chose. This amends
  D-058's "isn't recorded as a failure". The failure is `refresh` on the commit
  before the merge, with refresh's own reason: "Merged main in, but its checks
  couldn't run: Every heavy-check slot in `<dir>` stayed taken for N minutes. If
  no check is running, delete that folder.", then whether the branch is as it
  was. The task needs you. A check that holds a slot for 3 hours is stuck, and a
  person clears it.
- **It isn't tried again on that commit** (D-055), and there's no
  `acc refresh`. Once the slot is clear, a person merges the base by hand or
  lands, or a new commit on the branch lets autopilot try again.
- Autopilot now waits for the next pass only when the ledger is busy, the agent
  cap filled meanwhile, or a stopped builder's agent came back (D-067).
- **One description of `autonomy: review`.** Core keeps the phrase for what it
  does (`AUTOPILOT_REVIEW_DOES`), and acc's refusal, `acc agents autonomy`,
  `acc autopilot` under manual, the status bar's tooltip and the Agents tab use
  it, so it names the refresh everywhere. Each copy had gone stale. Where one
  says it never merges, it says "never merges a pull request", since it merges
  the base into a branch.
- **Prior tests are the profile's** (D-003). A refresh asks gates.ts for the
  tests its commit's checks named (`priorTests`), next to the validate gate
  whose receipt it reads. On Salesforce that's the Apex tests the last
  `validate` named; other profiles name none. refresh.ts names no Salesforce
  gate.
- Not chosen: recording it only when putting the branch back failed, and
  otherwise waiting, with the real reason. A slot that's still taken after 3
  hours is taken next pass too.
