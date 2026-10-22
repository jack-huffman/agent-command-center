## D-192 A plan offers each design choice as options, keeps its versions, and nothing is built until a person approves it (2026-10-22)

The person doesn't trust an agent to decide alone yet. Their workflow: Claude investigates the ticket, they
talk the solution through, they make the decisions, and then an agent does the work. Before this, an
analysis (D-052) gave one approach and some questions, and answering the last question made a task ready:
the person never chose between approaches and never said "build this". T-97 changes that.

- **Design choices.** `ANALYSIS_SCHEMA` gains `decisions`: each a choice the work can't avoid, with two or
  three options. An option has a name, what it means in this project, pros, cons, an effort (S, M, L), risks
  and the files or metadata it touches. The analyst names one `recommended` option by name and says why.
  `parseDecisions` refuses the whole analysis when a recommendation names none of its options, or a choice
  has fewer than two options or more than three: a person can't choose from it as it is. The prompt says to
  name every choice a reviewer would want a person to make, never hide one in the approach, give honest
  cons for every option, and that a small task may have none.
- **Who answers.** Each question has `askOf`: `you` or `author` (the ticket's author, such as a client). Only
  an author's question has "Ask on the ticket", which drafts it as a comment through the update drafts
  (D-066). A question for the author holds nothing: its suggestion stands until someone answers it.
- **Choosing.** `acc plan choose <id> <choice> <option|--text "…">` and the page's "Choose this" and
  "Something else…" record the choice, who and when, in the plan (`plan-choices.ts`). Only a person: a
  builder, reviewer, analyst or autopilot is refused. Picking the option already chosen, or the same own
  words, changes nothing (`sameChoice`).
- **Versions.** Each analysis is a version, kept in the plan's `earlier` list, never overwritten
  (`nextVersion`, `plan.ts`). A new version carries over an answer to the same question, a choice whose
  title stays the same (and, for an option, whose option's name stays), and says what changed
  (`planChanges`). The page shows the latest, with the earlier ones in a fold.
- **Approval.** `acc plan approve <id>` and "Approve this plan" pin the latest version: who, when, which
  version. It is refused while a question for you or a choice is open. A new version, a changed choice
  the person said yes to (below), or an answer made after the approval undoes it (`lapse`), and the plan
  says why it needs approving again ("v3 is new since v2 was approved").
- **The gate.** Where a plan is required (`analysis.required`, Salesforce by default), `analysisProblems`
  holds a dispatch until every question for you is answered, every choice is made and the latest version is
  approved, a reason each (`planProblems`). Build it on the page is off with the reason in words
  (`buildOff`), and the card's Dispatch is gone until then. Where no plan is required, a build goes as
  before, and a task with a plan still gets it.
- **The builder and the reviewer.** The packet's section is "The approved plan" (or "The plan", saying a
  person hasn't approved it): the version, each choice, the answers and the approach, and that the choices
  are the person's: a builder that needs another choice, or meets a design decision the plan doesn't cover,
  stops with acc block and asks. The reviewer's prompt names the approved version's choices and makes a
  departure a must-fix finding (`planChoicesSection`).

The person made two more decisions on 2026-10-22:

- **Asking from the Overview.** A question for the ticket's author keeps Ask on the ticket on the
  Overview's question card, as Send to the client was before; a question for you keeps its answer box.
  The card holds the task's open questions, yours and the author's, and `canAsk` is whether the task has a
  ticket to ask on. Only your questions count in "Needs you: 2 questions from its plan". Tested in
  `extension/test/landing.test.ts` (nothing the Overview offered is lost, Ask on the ticket among it) and
  `extension/test/overview.test.ts`, with the edge case of a task with no ticket.
- **Changing an approved choice asks first.** On an approved plan, Choose this, or Choose for the
  person's own words, shows a dialog in the choice: "This plan is approved. Changing this choice undoes the
  approval, and the plan must be approved again before it's built." (`CHANGE_APPROVED`, which the page's
  model carries as `changeAsk`), with Keep the approval, which has focus, and Change it. Keep the approval,
  or Escape, sends nothing and gives focus back to the button that asked; Change it sends the choice with a
  yes. `acc plan choose` refuses such a change with the same words unless it's given `--yes`, and the page's
  Change it passes `--yes`. Picking the option already chosen asks nothing and keeps the approval. Tested in
  `packages/core/test/plan-choices.test.ts` (2 tests), `packages/cli/test/plan.test.ts` (1 test),
  `extension/test/plan.test.ts` (5 tests), and a behaviour case that drives the dialog's clicks and Escape
  in a browser, with 6 mutants. The screenshot run draws the dialog open on the approved plan.

Talking the plan through with the agent is T-98. T-96, merged before this, renamed the words across the
app; what this change adds uses them: "Make a plan", "Build it", "Approve this plan" and "Ask on the ticket".
