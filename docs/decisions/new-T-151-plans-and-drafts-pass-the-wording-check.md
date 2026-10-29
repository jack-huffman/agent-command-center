## D-T-151 A plan and an agent's words in a draft update pass the wording check (2026-10-29)

T-151. The person asked for the tool to write requirements and technical text in Simplified Technical English
(T-12, `packages/core/src/ste.ts`). Drafted acceptance criteria and the QA comment pass it (D-179), a task's
criteria (D-231) and an agent's notes (D-230) too. Two kinds of agent text still reached people without the
check: a plan's requirements, which showed their findings as advice and could be approved, and a draft update
that carries an agent's words. This uses the checks already there, `requirementWording` (T-12) for a plan's
requirements and `noteWording` (D-230) for a line a person reads. It adds no third copy.

- **A plan is checked before acc records it** (`packages/core/src/plan-wording.ts`). `planWording` gives the hard
  findings on the requirements (`requirementWording`, each line on its own, as before) and on each question
  (`noteWording`), with where each is: "Criterion 2", "Question q1". A question is checked because a person can
  send it to the client as a draft. Text in backticks is code, which the check leaves alone.
- **The planning agent fixes its own words.** When `analyze` reads a plan with a hard finding, it resumes the
  planning agent's session with `planFixPrompt`: each finding, where it is and its fix, as a review does (D-230).
  The fixed answer replaces the first, and both are paid for. After `NOTE_FIX_TRIES` (2) fixes that still fail,
  `analyze` stops with `planWordingWords`, each finding and its fix, and records no plan: the plan before, its
  time and its talk are as they were. The analyst's prompt (`STE_STRICT`) now names each question, and says
  that acc checks each line and sends each finding back.
- **A person can't approve a plan with a hard finding in its requirements.** `approveRefusal` refuses it once its
  questions and choices are done, with `approveWording`: the count, each finding and its fix, and "Make a new
  plan". The requirements are read again each time, so a plan recorded before this check is held too. Its
  questions don't hold the approval: they are for the person or the client, not the builder. Where a plan is
  required, an unapproved plan holds the build, so a hard finding holds it too.
- **The page shows each finding beside its line.** `ticketWording` gives each finding's part and place, read again
  from the requirements as the approval is. The Plan tab draws each fix under its criterion, assumption or
  out-of-scope item: an orange warning icon, the check's message and the words it caught (`an-fix`). A section
  with a finding opens. The goal isn't drawn as a line of its own, so a finding on it shows the goal with its
  fix, under "How the goal reads" in More. Approve this plan is off with "Its requirements fail the wording
  check (N findings, shown beside each line): make a new plan" (`approveOff`), and Review plan says "N wording
  findings to fix" in place of "Ready to approve".
- **A draft update is checked before acc writes it** (`packages/core/src/draft-wording.ts`). `draftUpdate` takes
  `agent`, the lines of the draft an agent wrote, and refuses the draft with `draftWordingWords` before it takes
  the lock, so nothing is written. Its callers give:
  - `acc land`: the reviewer's sentence for the client, in the pull request's draft. A land that can't draft
    still records its pull request, and gives the findings as its update's error, as any draft error is.
  - `acc update ask`: the planning agent's question. A person runs it, and gets the findings.
- **Not checked:** acc's own text around them ("The change is ready for review"), the ticket's title when a
  review has no sentence for the client, and a person's edit of a draft, which posts as they wrote it. A
  field-change draft (T-105) isn't checked either: acc makes its text from the change's paths, names and
  values, and no agent writes a sentence in it. An agent's question for the client (`acc block --client`) and
  drafted criteria and QA comments are checked where they are made already (D-230, D-179).
- **Checked by** `packages/core/test/plan-wording.test.ts` (7: the findings and their places, with none on a
  clean, advisory or coded line; a plan fixed in its session with each finding; one refused after two fixes
  that keeps the plan before; the approval refused with each finding; acc's own `analyze` recording no hard
  plan; and two mutants caught: one skips the check in `analyze`, one lets the approval through),
  `packages/core/test/draft-wording.test.ts` (7: a draft refused and not written, then written in plain words;
  a question refused and code left alone; acc's own text and a draft with no agent's words not checked; a
  person's edit posted as written; acc's own `draftUpdate` writing no hard draft; and two mutants caught: one
  skips the agent's words in `draftUpdate`, one finds and still lets the draft through), `packages/core/test/land.test.ts`
  (1: a land whose review's sentence fails drafts nothing and still records its pull request, and a title isn't
  checked), `packages/cli/test/plan-draft-wording.test.ts` (2: `acc plan approve` refused, then approved once
  clean; `acc update ask` refused with nothing drafted, and a person's edit posted), and
  `extension/test/plan-tab.test.ts` (1: each fix beside its own line, its section open, and a finding on the
  goal). The behaviour case on ACME-21's page reads each fix under its own line, drawn on screen, with three
  mutants of its own (no findings drawn, a finding under every line of its part, a section with a finding
  left closed).
