## D-054 The Command Center shows each task's analysis, and you answer its questions there (2026-10-05)

D-052 put the analysis on the command line only. The Command Center now shows
it the way it shows reviews (D-032) and agents' questions (D-030).

- **The hub reads it, never writes it.** Each row gets its task's analysis
  (verdict, time, the questions nobody answered, a split's smaller tasks),
  whether one is running, and whether the project requires one. They're read
  from `analyses/` beside the ledger with core's `readAnalysis` and
  `analyzing`, and each file is read again only when it changes. The hub
  watches the folder too, since starting or ending an analysis doesn't
  touch the ledger.
- **Needs you:** a task to do whose analysis has open questions, or says it's
  too big for one task, shows as Needs you. The hub decides that, not core's
  `displayState`, so `acc status` doesn't show it. A task that's too big is
  Needs you whether or not the project requires an analysis, as the author
  chose. It says "Needs you: 2 questions from its analysis" or "Needs you: too
  big for one task", each with an icon, in orange.
- **Cards.** The next step comes first:
  - Watch the analysis, while one runs.
  - Answer, while it has open questions. This opens the task's page.
  - See the split, when it's too big for one task.
  - Analyze, for a task to do with no analysis. It's the main action where
    the project requires one.
  - Dispatch, once the analysis is ready, or where none is required. Where
    one is required and it isn't ready, Dispatch is hidden and dragging to
    Running is refused, as the author chose. The override stays on the command
    line (`--without-analysis`). Where none is required, Dispatch stays as a
    second button behind Answer, and the builder assumes the suggested
    answers. Nothing is dispatched while an analysis runs.

  The tracker boards' cards and the Overview's Ready list take the same next
  step, so a task held for its analysis stays in sight.
- **The ticket page** puts its Analysis section above the description, gist
  first. It shows the verdict with an icon and a label, the summary, and each
  open question, with its suggestion as one click and a box for your own
  answer. Then Analyze again, and the rest folded: what was decided, the
  criteria, assumptions, what's there now, the approach, refactors, risks,
  tests and files. Once a task is being built, nothing is left to answer, and
  the page shows what its builder assumed. At narrow widths, an analysis
  waiting on you comes before the side panel.
- **The Overview's Needs you** lists one item for each task waiting on its
  analysis, with its questions to answer in place. The rail, the launcher's
  badge and the status bar count each task once.
- **Answers go through acc (D-012).** The page sends `analysis-answer`, which
  is checked like every other message. The extension runs `acc analysis answer
  <id> <q> --json -- <text>`. The `--` keeps an answer that starts with `-` as
  words. What acc refuses, it says why, and the page lets you edit the answer
  and send it again.
- **Notices (D-044):** when a task's analysis comes back, the notice is "GH-29's
  analysis is ready", "has 2 questions for you", or "says it's too big for one
  task". An answer keeps the analysis's time, so it says nothing.
- **A run judges its exit code.** `acc analyze` exits 1 when the analysis has
  questions. The run checks whether a new analysis was written, so an analysis
  with questions doesn't also say "failed (exit 1)".
