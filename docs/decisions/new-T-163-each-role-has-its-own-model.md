## D-T-163 Each role has its own model and effort, with acc's default for it, and the planning agent is a role (2026-10-30)

T-163. The person, asked whether the planning agent could cost fewer tokens: "We should be able to define the
planning model as well as the reviewer model, but offer a default." Before, the analysis, the plan conversation
and drafted criteria ran with the reviewer's model and effort (`agents.reviewer`), so a project could not give
planning a model of its own. A project whose settings named no model ran each of them at Claude Code's own
default, which can change under it.

- **A planner profile** (`agents.planner`: `model`, `effort`, `fallbackModel`), read and checked as
  `agents.reviewer` is. The analysis (`analyze.ts`), the plan conversation (`plan-opening.ts` and `plan-talk.ts`)
  and drafted criteria (`criteria.ts`) run with it. Review and verify keep the reviewer's. `plan-talk.ts` is the
  plan conversation's later turns: it was the reviewer's too, so it moves with the opening.
- **One table of defaults** (`ROLE_DEFAULTS`, `packages/core/src/config.ts`): builder Opus 5.5 with Claude Code's
  own effort, planner Opus 5.5 at medium, reviewer Opus 5.5 at medium (D-135). A role whose settings name no model
  takes its row. A setting that names a model takes no default effort with it, because a model acc doesn't know may
  not take that level. A setting that names only an effort keeps the default model. `acc init` still writes no
  models, so a project gets later changes to the table.
- **The order** stays: this clone (`acc agents set`, git config), then the project (`.acc/config.json`), then
  acc's default. `acc agents` and Settings say "the Command Center's default" for a part that comes from the table.
  A reviewer with no effort set now runs at medium, where it ran at Claude Code's own default (also medium for
  Opus 5.5, so the work is the same, and the flag is now explicit).
- **`acc agents model <builder|planner|reviewer> [<model>|default] [--effort <e>|default]`** shows a role, or sets
  its model and effort in the project's `.acc/config.json` for the person to commit. `default` takes a setting out,
  so the table applies again. `acc agents set` takes `planner` too. Both are a person's: a builder, a reviewer and
  an analyst are refused, as for D-083's switch, and reading is open.
- **Settings' Agents section** (D-226) has a row for each of the builder, the planning agent and the reviewer.
  Change… asks first what to change: the model and effort, the fallback model, or back to the default. A model
  is a choice of three and the person's own words (D-205): the default (or no fallback), Opus 5.5, Sonnet 5.5,
  and another model typed. An effort is the default, low, high, and another level typed. Then it asks for whom,
  as before T-163: this clone only, or the project's settings. The project's model and effort go through
  `acc agents model`; the rest through `acc agents set`, with `--project` for the project's settings
  (`agentsChangeArgs`, `extension/src/logic/agents-change.ts`).
- **One check for who may change these:** `AGENTS_MODEL_COMMAND` (`acc.agents.model`) has an id, its params and
  an `enabled` that refuses a builder, a reviewer and an analyst with the reason. `acc agents model` and Change…
  both ask it.
