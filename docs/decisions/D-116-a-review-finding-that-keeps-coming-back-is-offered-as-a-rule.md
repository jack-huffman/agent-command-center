## D-116 A review finding that keeps coming back is offered as a rule, then as a check (2026-10-08)

GH-102. A rule written only in prose decays; a rule a tool checks holds.
acc keeps every reviewer verdict, so it can see the same finding turn up in
task after task and offer the path from finding to rule to check. Before the
change, nothing read the verdicts across tasks.

- **What it reads.** Every verdict in the clone's reviews folder, for any
  environment and any task state, through one `readVerdicts` that skips a
  review under way and any file it can't read. `latestVerdict` uses it too.
  Only reviewer findings count, not the analyst's, GitHub's checks or the merge
  queue's send-backs.
- **How it groups.** By the rule a finding cites, or by close wording where it
  cites none. A cite loses its source tags (`CLAUDE.md:`, `(CLAUDE.md)`,
  `Task:`), its parentheticals, and anything after the first `:` or `;`, so a
  cite joining two rules keeps the first. A cite that starts with a decision id
  groups by the id. What's left is compared by its words: a finding joins the
  group whose first finding shares 0.6 of its words (0.5 for wording), oldest
  first. Wording uses the finding's new optional `kind`, else its first sentence
  without paths, identifiers, code or numbers. No embeddings and no agent call:
  the result is the same every time, and a test pins it.
- **When it offers.** At 3 or more findings across at least 2 tasks, counting a
  finding once per task and file (decided by a person): a later review of the
  same task saying it again on the same file isn't a new finding. Both blocking
  and non-blocking findings count, since only 10 of 282 are must; the card
  says how many were.
- **Rule or check** (decided by a person). A rule already written in
  `.acc/rules.md`, `.acc/rules/`, `CLAUDE.md`, `AGENTS.md`, a decision, or the
  file the cite names, is offered as a check, with no new line: "Already a rule
  (CLAUDE.md). It keeps coming back: add a check". One accepted as a rule that
  comes back 3 more times is offered again as a check.
- **A person decides, and acc only drafts.** Accept opens a draft of the task
  (line, title, Ask for a check too, notes); Confirm runs `acc rules accept`,
  which adds one manual task in To do and records the suggestion as accepted.
  Dismiss records the findings the group had; it's hidden until 3 more join.
  Records match a group by its findings, not its id. Both refuse builders,
  reviewers, analysts and autopilot, and guardBash and the builder's deny list
  block them (`acc rules suggested` only reads, so a builder may list).
  Working out the offers writes nothing, and acc never writes `.acc/rules.md`:
  the task's pull request does, and it changes `.acc/`, which a person merges.
- **Never in the badge** (decided by a person). An offer is neutral, with an
  icon and a label (Rule suggested, Check suggested), after the orange items.
  Nothing waits on it.
- **The kind of a finding** (decided by a person). The verdict schema gains an
  optional `kind`, and the reviewer is shown the kinds earlier reviews named,
  most used first, to reuse. Older verdicts keep working from their first
  sentence; none is rewritten.
- **Per clone.** Reviews, offers and records are in the git common directory
  (D-008), beside reviews and ticket updates: a teammate's clone sees its own.
- **Proved on this repo's own reviews** (2026-10-08): 82 verdicts, 282
  findings, 36 citing a rule, 10 must, in 258 groups. It offers one: "Look at
  UI changes before shipping them", 13 findings in 8 wordings, counted as 12
  across 10 tasks (2 must), as a check, since it's in CLAUDE.md. It doesn't
  offer `D-072` (3 findings, all GH-70), "Keep changes to what the task asks"
  (4 findings, counted as 2: GH-9's and GH-12's reviews repeated it on the
  same file), or the closest wording group (2 findings, GH-52 and GH-58).
- Not chosen: acc writing `.acc/rules.md` or building the check; tracker
  tickets; sharing offers across clones; similarity by embeddings or an agent;
  counting only must findings; listing suggestions under `acc rules list`,
  which GH-108 gave to the copies.
