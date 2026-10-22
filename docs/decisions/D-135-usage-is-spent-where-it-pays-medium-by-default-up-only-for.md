## D-135 Usage is spent where it pays: medium by default, up only for cause (2026-10-10)

Once acc could pick each task's model and effort (D-128), usage rose sharply. Large tasks ran on Opus 5.5 at
xhigh, cloud builders ran three times on Fable 5.1, every review ran at high effort (2026-10-09), extra
Fable guardrail reviews ran on top, and five builders ran at once. The author asked to conserve it.

- Reviews run at medium (`agents.reviewer.effort`), Opus 5.5's own default. A change to what agents may
  do gets a high-effort review, picked for that task.
- At most three builders run at once (`agents.max`), unless the author asks for more.
- Builders default to Sonnet 5.5 at medium for small, well-specified tasks, and Opus 5.5 at medium for
  the rest. xhigh is for a second rework, and Fable only for a change to what agents may do.
- Whoever merges fixes a review's small findings at the merge, rather than sending the task back for a
  builder run.
