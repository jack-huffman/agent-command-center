## D-032 A read-only reviewer agent judges each commit before it lands (2026-10-02)

`acc review <id>` runs a fresh `claude -p` in the task's worktree. It gets:
- the builder's instructions
- the diff against the environment's branch
- the checks on the commit, waivers included
- the project's rules

It returns a verdict to a JSON schema: pass or changes, a summary, each
acceptance criterion met or not with evidence, and findings marked must or
not.

- **Read-only by construction.** Only Read, Grep and Glob are allowed, and the
  `dontAsk` mode refuses everything else. That's simpler and stricter than
  `plan` mode, which expects to end by proposing a plan.
- **The verdict belongs to one commit,** like a receipt. `acc land` needs a pass
  on the branch's latest commit. A rework run's instructions list what must be
  fixed and the criteria not met, and nothing else.
- **It's watchable.** acc gives the session its id and records it while the
  review runs, so **Watch the review** opens its activity page.
- **It runs on your own Claude Code sign-in.** On a subscription it's usage,
  not a bill. Claude Code reports a `total_cost_usd` in every result anyway: an
  estimate at API prices, kept with the verdict and never shown as a charge.
- **First real run, on T-1.** It read every formatted file against its
  original, and found that a line break prettier added in an LWC template
  changes the rendered text: the compiler drops the trailing space. T-1 went to
  rework with the fix described. That took four minutes.
