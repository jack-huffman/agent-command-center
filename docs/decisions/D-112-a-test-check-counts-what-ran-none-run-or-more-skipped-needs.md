## D-112 A test check counts what ran; none run, or more skipped, needs a person (2026-10-07)

GH-100. A check that ran nothing looked the same as one that passed:
PhotoCraft's two worst false greens were a fuzz test nothing ran and GPU tests
that print "skipping" and pass, and a builder that marks a failing test skip
to get green is the same failure. acc kept only an exit code and a summary
line. It extends D-024 (what a receipt proves) and D-031 (waiving).

- **A receipt counts what its tests ran,** where its output holds a summary
  acc can read: run, passed, failed, skipped and todo, from node:test's spec
  or TAP reporter, Jest's `Tests:` line (`No tests found` is none), or Apex's
  `numTestsRun` and `numFailures` in validate's deploy result. `run` is passed
  plus failed (node's cancelled counts as failed); Apex has no skip or todo.
  The skipped tests' names are kept where the runner prints them. Counts live
  in their own `counts` field: `details.tests` already holds the Apex tests a
  builder named, which `priorTests` reads back.
- **Every complete summary counts once.** The analysis proposed the last
  block per runner. A command that runs its tests in parts, such as
  `npm test --workspaces` or `node --test a && node --test b`, prints one
  summary per part, and taking the last would undercount, which is the false
  green this ticket is about. A test's own output can't fake one: node's TAP
  reporter prints it behind `# `, Jest indents it, and a summary in a
  failure's message is indented; a block must be unindented and complete
  (tests, pass, fail, skipped and todo; Jest's `Test Suites:` line just
  before `Tests:`). What's left is a test that prints a complete, unindented
  spec summary of a run of its own, which would be added in: an overcount, not
  a false green.
- **Output acc can't read is never guessed at.** A test check, one
  `gates.tests` names, a gate called `test`, Salesforce's `lwc-tests`, or
  validate when it runs Apex tests, records no counts and a note saying so
  ("not read"). Counts are read from any gate's output, as the person decided;
  only a test check gets the note.
- **A new status, `hold`: "needs a person".** A would-be pass that ran no tests,
  or skipped more than the count it's compared with, is a hold. Like `fail`
  it satisfies nothing, so done, review, land and the merge queue all stop,
  with no change to `satisfies()`'s callers. Unlike `fail` the builder can't
  fix it by fixing the change, so `acc gate run` tells it to add or un-skip
  tests, or `acc block` if the task asks for the skip, and the merge queue
  stops for a person instead of sending the task back. A fail or an error
  keeps its status. `skip` keeps its meaning: the check didn't apply. Orange,
  a person icon and the words "needs a person", never colour alone.
- **What a count is compared with.** The nearest earlier receipt with counts
  for the same gate and the same command, at or before the branch's merge base
  with its environment's branch, walking back up to 500 commits from it. Not
  the tip, which can hold changes the branch doesn't, and never the commit's
  own receipt, so running a held check again doesn't compare it with itself.
  With nothing earlier the check isn't held, and its receipt says there was
  nothing to compare with. Receipts from before this have no counts, so the
  first counted run of each gate is its baseline. A repo that squashes or
  rebases loses the ancestry, and always has nothing to compare with.
- **A person's waiver is a count they accepted.** The waived receipt keeps
  its counts and the command they came from, and a waiver with counts on the
  branch's own commits is the first thing compared with.
- **A person's waiver on the head clears a hold on the queue's merge of that
  head, counts or not.** When a branch is behind, the merge queue checks a
  merge commit it makes again on each pass, and asks a person to waive a hold
  on the head. A builder never runs the full check there, so that waiver
  usually has no counts, and comparing alone found nothing: the queue merged,
  held and stopped again on every pass, for good. Now `checkCommit` tells
  `runGates` the head it merged the base into, and a hold on that merge where a
  person waived the gate on the head is written as their waiver: a skip, by
  them, with their reason, naming the head, keeping the merge's counts and the
  hold it was. It covers a zero-run hold as well as more skipped. Only a hold:
  a fail or an error on the merge still needs a person, since a waiver holds for
  its own commit (D-031) and a fail there is a new finding, not the one they
  accepted. Refresh's merge (D-058) goes through the same `checkCommit`.
- **Which checks are compared.** The person decided: only those whose test set
  doesn't depend on the change, "not one acc gives ACC_NEAR_TESTS, not
  lwc-tests, not validate", so that in this repo `check` is compared in the
  merge queue. Since D-102 every command gate is given ACC_NEAR_TESTS, so that
  test no longer tells them apart. The rule is the one the config already
  holds: a builder's lighter check, one `gates.builder` names that
  `gates.required` doesn't, isn't compared, nor are the built-in `lwc-tests`
  and `validate` (`changeBound` on the gate). It gives the decided outcome:
  `check` is compared, `near-tests` isn't. Those still record counts, and the
  reviewer catches a new skip in the diff.
- **The reviewer is told** that a newly added skip, only or todo in a test is
  a finding that must be fixed unless the task asks for it, and reads each
  check's counts. acc doesn't scan the diff for them itself.
- **Shown everywhere a check is:** the pull request's check table gains a
  Tests column where any check counted ("312 run, 2 skipped"; failed and todo
  only when there are some; "not read"), the ticket page shows it under each
  check, and `acc gate run` and `acc gate list` print it. The ticket page's
  check look moved from the webview's ternaries, where an unknown status fell
  through to another's icon, into the model, where a test covers every status.
- Not done here: an empty ACC_NEAR_TESTS
  list is still a pass with no counts, not a skip; a gate whose output reports
  failed tests but exits 0 still passes; GitHub's own checks (D-076); and the
  release-only plugin bundle (D-042), which takes this at the next
  `npm run package`.
