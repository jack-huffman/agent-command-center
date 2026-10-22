## D-086 Opus 5.5 by default, and a model picked per task (2026-10-06)

The author: "We should support picking a model, but let's default to Opus
5.5" (GH-74). A repo or a clone could set the builder's and reviewer's model
(D-036), and without one Claude Code chose. This changes D-036's "anything
unset is Claude Code's own default" for the model.

- **acc's default model is `claude-opus-5-5`,** for builders, reviewers and
  analysts, wherever neither the clone nor the project names one. The clone
  still wins over the project, and both over the default. It's a pinned full
  name, not the alias `opus`, so moving to a newer Opus is an acc release.
  Effort and fallback stay Claude Code's own when unset.
- **Every launch names the model.** `agentArgs` builds `--model` for dispatch,
  resume, review, the analysis, a free-form agent and the reply to any
  session (D-060), so the default lives in that one place. A fallback that is
  the model itself is left out: Claude Code won't start with
  `--fallback-model` the same as `--model`.
- **`acc agents`** says `model claude-opus-5-5 (acc's default)`, and its JSON
  gives the model's source as `acc`, apart from `default`, which is Claude
  Code's, for effort and fallback. How agents run says "acc's default".
- **A model picked for a task.** `acc dispatch <id> --model <m>`, and
  **Dispatch with…** behind the card's ⋯ and on the task page, wherever
  Dispatch or Re-dispatch is offered. A name that isn't a model name is
  refused before any worktree is made. The run keeps it (`run.model`,
  `run.modelPicked`), so a re-dispatch of its rework, by a person or by
  autopilot, `acc resume` and the reply to its builder use it, until another
  is picked. A run nobody picked a model for records what it started with,
  and follows the clone's, the project's or acc's default each time.
- **Builder only** (a person decided). A task's reviewer, and its analyst on
  a re-analysis, keep the reviewer's profile (D-052).
- **One list of models** (a person decided): `claude-opus-5-5`,
  `claude-fable-5-1`, `claude-sonnet-5-5` and `claude-haiku-4-5-20251001`,
  then Another model…, in Dispatch with… and in How agents run's Change….
  Change…'s first entry, which clears the choice, reads acc's default
  (claude-opus-5-5). Dispatch with… puts the model the builder would run with
  anyway first, saying where it's set: picked for this task, this clone, the
  project, or acc's default. Choosing that model, for a task with none picked
  before, dispatches without `--model`, so the task goes on following the
  settings. Any other choice is kept for the task.
- **The analysis's size, beside the choice** (a person decided). Dispatch
  with… says "Its analysis sizes it L: a few days", or "Not analyzed: no size
  to go on". The size picks and reorders nothing, and the analysis has no
  suggested-model field. The size's meanings live in one place, which the
  analyst's schema is built from.
- **Each running agent's model is shown:** under Agent on its card, as Model
  on its task page, and in a Model column on Agents. It's the model the
  agent's transcript last answered with, read from its last 256 KB and kept
  until the file changes, as the last thing it said is (D-067); before its
  first answer, the model acc started it with; else a dash. Agents shows it
  short (`opus-5-5`, the full name on hover), takes Kind's room below 1100 px
  and drops it below 560 px, so the row menu never covers a column. A
  transcript that can't be found is looked for again after 30 seconds, not on
  every poll.
- **Accepted:** a pick outlasts Abandon and a fresh Dispatch, as the branch
  does; the card shows the model, so an old pick is seen. The reply to a
  session that isn't a task's now names acc's default too. This repo's own
  config already names `claude-opus-5-5` (D-080), so it changes nothing here.
- Not chosen: picking a model by the analysis's size; a per-task effort or
  fallback; the aliases (`opus`, `sonnet`) in the lists, which move under you.

Note (D-168, 2026-10-16): Dispatch with… is gone from the card and the task page. Dispatch itself opens a
sheet that asks for the model, from the same list in the same order, then the effort and where it runs;
the model the builder uses is chosen first, saying where it's set. The command `acc.task.dispatchWith`
stays for one release and opens the same sheet. Choosing the defaults still sends no `--model`.
