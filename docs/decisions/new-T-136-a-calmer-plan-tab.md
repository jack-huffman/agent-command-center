## D-T-136 A calmer Plan tab: a made choice is one line, each fact once, sections that fold (2026-10-28)

T-136. The person, on a task's Plan tab: "the plan UI is still way too cluttered. How do we let it breathe more
and feel more organized and clean?" The tab was one long stream at one weight, and it said things twice: "Plan v1
approved" in the short section and again at the head of The whole plan; a made choice said Chosen three times
(its heading's chip, its card's tag, and "Chosen by"); and a made choice still drew every option card with every
pro and con. This amends D-200's short plan section and its "The whole plan" fold (T-109), and works inside
D-216's tabs; D-214's collapsible section (T-132) and T-131's progress block stay as they were.

- **A made choice is one line** (`extension/webview/plan.ts`): its id and title, an arrow and the option chosen
  (its letter and name, or "Something else:" and the person's words), then "Chosen by jordan" and when, after a
  blue filled tick, and a quiet "Compare the 3 options". Compare draws the cards side by side, and "Hide the
  options" folds them back; the tab remembers it per choice (`plan:<project>#<task>:<choice>:compare`), as it
  remembers folds. A choice still to make draws its cards as before. A made choice draws in full too while the
  person types their own option for it, and while a change to it on an approved plan waits for their yes
  (Keep the approval or Change it), so that question is never hidden.
- **Chosen is said once a choice.** On the line, "Chosen by" with who and when; compared, on the chosen card's
  tag, "Chosen by" with who and when; in the person's own words, beside them. The heading's Chosen chip and the
  separate "Chosen by" line are gone. A choice still to make keeps its orange "Choose one" or grey "Not chosen".
- **An option card is tighter.** Less padding, its pros and cons first, and its risks and the files it touches
  folded under "Risks and files" with their count. One key per choice opens them on every card of it, so the
  cards stay level.
- **Each fact once; one quiet top line.** The "Plan" heading goes: the tab says Plan. The plan's state ("Plan v2
  approved", "Plan v1: not approved yet") is the section's heading and the button that folds it (T-132). Beside
  it on one line: who approved it and when; what's left to review in words, or, once nothing is left, the
  analysis's own state ("Ready to build") instead of "Approved v2" again; its size; and when it was made. With
  no plan yet, the analysis's state heads it, and before a plan the conversation's state does. What changed in
  this version and the person's notes on it show under the summary, without the version and approval again.
- **One row of actions.** Review plan or Build it first, as before, then Talk it through, the conversation's line
  with Open conversation, and Make a new plan, in one row, where they were three places. Make a new plan stays
  the conversation panel's alone when there's a conversation (T-116), and on the "comments since this plan"
  line when the plan is behind (T-110). Why Build it or Approve is off stays under the row.
- **Named sections instead of The whole plan** (`extension/webview/analysis.ts`), each folding on its own with a
  count: Choices, Questions, The approach (what other tasks build on and the split it suggests, then the steps),
  Acceptance criteria, Risks and tests, and More (assumptions, out of scope, what's there now, how the
  requirements read with the wording's state beside More's count, earlier versions, refactors first, and
  decided). A section with nothing in it isn't drawn. Choices opens by itself while a choice waits on the
  person (one to make, or a change waiting for a yes); Questions while a question does (one for them, or one
  for the ticket's author not yet sent to the client). The rest start closed. The tab remembers a section opened
  (`an:<project>#<task>:sec:<id>`), and one the person closed while it waited (`…:shut`), so it stays closed;
  a section open by itself is remembered open, so making the last choice doesn't fold it away under the person.
- **Room to breathe.** The plan has no box round it in its tab. Its parts sit the same space apart (the theme's
  `--space-*` tokens), its sections are divided by a line and nothing else, and the boxes inside it are gone:
  what changed, what other tasks build on and the split, and the person's own option. The open choice's cards
  are the one level of boxes left, beside the dialog a change asks. Questions and choices sit apart by space,
  not lines.
- **Nothing is lost.** Every part the plan showed is in a section, and every control still works: Choose this,
  Something else…, Discuss, Ask on the ticket, and answering a question.
- **Checked by** `extension/test/plan-tab.test.ts` (a made choice is one line and draws its cards only once
  compared; Chosen once a choice and the approval once, counted; the sections, their counts and which open by
  themselves), and the behaviour case "plan tab: a made choice is one line…" (`extension/scripts/behaviour.ts`),
  with four mutants: a made choice still draws every card, a choice waiting on the person is folded away, a
  section the person closed opens again, and Compare isn't remembered. The screenshot run adds
  `ticket-plan-choices`: a made choice compared beside one still to make.
