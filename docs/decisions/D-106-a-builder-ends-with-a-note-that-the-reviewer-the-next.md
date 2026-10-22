## D-106 A builder ends with a note that the reviewer, the next builder and the pull request read (2026-10-07)

GH-101. Sessions end abruptly: a crash, a full context, a stopped Mac.
PhotoCraft's answer is a dev log each session appends to, but it's gitignored
and local, so no other machine, contributor or fresh clone can read it. acc
keeps the note where every later reader gets it: on the run, in the ledger.
Before, `acc done` only moved the task to review.

- **Three flags, a line each.** `acc done --landed "…" --moved "…" --open
  "…"`: what landed, which numbers moved (tests, checks, ratchets), what's
  still open. A flag again adds a line, up to 10 a part and 300 characters a
  line. Not a free-text `--note`, nor a note file: a file in the worktree could
  be committed, and lines are what Make a task needs.
- **All three are required of a builder's `acc done`** (a person decided):
  `--moved none` and `--open none` are accepted, so nothing is a statement, not
  an omission; something must have landed. It's a `note` requirement on the
  running → review rule, so the rule stays data, and it applies to a builder
  only: a person's move needs none. Refused, acc gives the exact command.
  `acc block` takes the same flags, optional, since its reason is required.
- **One finish command.** `DONE_COMMAND` in ledger.ts is the text the packet,
  the SessionStart short packet, the Stop hook, a resume's message and the
  refusal all give; before, five places wrote `acc done` by hand. Tests pin
  each to it.
- **The shell.** The packet says one line, double quotes, no backticks or `$`.
  guardBash refuses an `acc done` or `acc block` with a backtick or `$` outside
  single quotes, since the shell would run or expand it before acc saw it.
- **Kept with the run, one step back.** `run.note`, with when, who and whether
  it ended in review or blocked; the move's event carries it, written in the
  same locked mutate as the move. A dispatch replaces the run, so the new run
  keeps the last one's note as `run.before`, or `null` when it left none. Older
  notes stay in events.jsonl. A note is refused on a move that isn't done or a
  block, or on a task with no run, rather than dropped.
- **Readers.** The reviewer gets it with the instruction to check it against
  the diff, not trust it. The PR body has a Builder's note section, as the
  builder's own words, unredacted, as review findings already are; the packet
  says it's posted there. A re-dispatch's packet has the last run's note, or,
  when it left none, says so and to start with `git status`, `git log
  --oneline origin/<branch>..HEAD` and `acc gate list`. A dependent task's
  packet has each direct dependency's note; one with none isn't listed, so
  tasks finished before this add no noise. `acc show` prints it.
- **Make a task** (a person decided): each still-open line on the task page
  drafts an acc task (T-n) through `acc add`, in the source task's environment,
  titled with the line, its brief citing the source task, its builder's run and
  the note's date, and depending on the source task while it isn't done. The
  title and brief are prefilled in input boxes to edit; Esc makes nothing. It
  never writes to a tracker (D-006, D-066).
- Not done here: acc working out the numbers from receipts itself; posting the
  note on the ticket; recording which open lines became tasks, so one can be
  made twice; a CLI command for Make a task; Slack and the status bar; notes
  for runs that finished before this.
