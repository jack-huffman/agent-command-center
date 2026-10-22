## D-118 A number that may only get better: acc raises its floor, and only a person relaxes it (2026-10-07)

GH-99. Agents trade quality for speed when nothing stops them. PhotoCraft holds
its numbers with floors in its test source that may only go up, so a change can
land partial progress but never a regression, and an agent can't pass a check
by deleting cases. A person raises those floors by hand, so they lag (620 while
626 run) and stop guarding the gap. acc can raise them itself.

- **A ratchet is a kind of check.** `gates.ratchets` names its command, whose
  last line is one number, its limit (`floor`, which may only go up, or
  `ceiling`, which may only go down) and a label. Its name is a gate's, and
  can't be another gate's, so it's required, a builder's or heavy like any
  other. No number, or a command that fails, is `error`, never `pass`.
- **The floors are committed,** in `.acc/floors.json`, one entry a ratchet, so
  they travel with branches, a person can read them, and two raises of
  different ratchets merge as text. The receipt keeps the number, the floor,
  the environment's floor where the branch began, and the difference; the pull
  request and the ticket page show `tests 669 → 674 (+5)`.
- **acc raises a floor in the task's worktree, and nowhere else.** Only `acc
  gate run`, on the task's own branch in its own worktree, with nothing
  uncommitted: never an environment's branch, the main checkout, or a refresh's
  or the merge queue's check, whose worktree must stay clean for the next
  merge. The raise satisfies nothing until it's committed, so it can't be left
  behind. The commit that only records it carries its parent's receipts,
  marked `carried`, when every number in it is one the parent measured and acc
  raised: a person decided a second full `acc gate run` wasn't worth it.
- **Only a person relaxes a floor, with a reason, as only a person waives a
  check (D-031).** A floor worse on the branch than where it began fails unless
  acc has a person's record of relaxing it, from the floor the branch began
  at, to that number or a worse one: a floor acc raised again after a person
  relaxed it is still theirs to back, or the commit recording the raise would
  fail its own check. A record only counts from the floor it relaxed: records
  are kept for the clone and never pruned, so one from another task or time,
  matched on its number alone, would let a builder lower today's floor by
  hand down to any number a person once relaxed to. `acc gate relax`
  writes that record, refuses builders and agents, and is denied in builders'
  settings. The file's own `relaxed` note is for people to read; the record in
  acc's state is what counts, since a builder can edit the file.
- **This narrows D-031: a ratchet can't be waived.** A waived ratchet that
  merged would leave its environment's number below its floor and fail every
  task after it. `acc gate waive` refuses one and names `acc gate relax`, and
  the ticket page offers no Waive… beside one.
- **A floors conflict keeps the better of each, unless a side relaxed one.**
  Autopilot resolves it in a refresh and in the merge queue alike (D-058,
  GH-73), and the floors file never makes two tasks wait at dispatch (D-093).
  Where one side relaxed a floor, keeping the better value would quietly undo
  what a person chose, so that conflict is left for a person: narrower than
  "both raised", by design.
- **This repo's one ratchet is the number of tests `npm test` runs,** required
  and a builder's, not heavy. Running the whole suite again in every builder's
  check would undo GH-73's lighter checks, so a person chose a fast counter:
  `scripts/count-tests.mjs` loads every test file with node:test, each test
  marked skipped, so no body runs and node:test still counts it. Its test pins
  it to a full run's own count over a fixture, and it fails rather than count
  none or count around a file that didn't load. Against `npm test`'s own
  summary on this branch it counted the same.
- **The records of who relaxed a floor live in this clone's git directory,** as
  receipts do. On another clone, a relaxed floor reads as no one's until it's
  relaxed there too. acc runs on one machine a repo.
- **A repo turns a ratchet on with an acc that knows them.** An older acc
  ignores `gates.ratchets` and reads `tests` in `gates.required` as a gate with
  no command, so it refuses to run the checks. This repo's own config lists
  one, so the acc that checks and merges this change has to be built from it.
- Not done here: a Relax floor… button on the ticket page (the CLI only, a
  person decided), ratchets in team templates, and the Salesforce profile's
  coverage and Code Analyzer ratchets, which are config a project writes.
