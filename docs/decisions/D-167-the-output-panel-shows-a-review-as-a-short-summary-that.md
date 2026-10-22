## D-167 The output panel shows a review as a short summary that opens up, not as plain text (2026-10-16)

T-63. A review started from a card ran in the output panel as plain text, in
a monospace font: the verdict, each criterion and each finding ran together.
The author asked for a review in the panel to read well, in the page's own
style, and to stay short, since the panel opens over the page.

- **The run knows it is a review.** `acc.task.review` starts its run with a
  `review` option: the project, the task and the branch's head as it started.
  When the run ends, and wasn't stopped, the extension reads the task's
  newest verdict file in the reviews folder, by when it was written
  (`logic/dock-review.ts`), and the lines around each finding with git, as
  the task page reads them (T-53). The run keeps what it read, so a reload
  shows it too. A verdict written before the run started is another
  review's: this run wrote none. A review kept over a reload while its
  verdict was still being read says so (`keptReview`).
- **One pure model.** `model/dock-review.ts` turns the run into one of three
  phases: running (one line, with a clock while it's live), unread (stopped,
  no verdict, or a file that isn't JSON or isn't a verdict: the run's lines
  and why), and done. A done review's card wears the verdict's look, since
  acc review exits 1 when it asks for changes, which isn't a failure; the
  run's `ok` is a verdict written, as an analysis's is (D-052).
- **Short.** A header line holds the verdict's icon and label, the task, a
  count ("3 of 4 criteria, 2 findings") and one primary button: Land for a
  pass, and Send back to the builder (`acc.task.dispatch`, the re-dispatch
  that gives the builder the findings) for changes. It stays in view when
  the rest scrolls. Who, when and how long are its hover. The summary shows
  two lines; More opens the rest and the client sentence. Then one row for
  each criterion not met, then each finding, must-fix first, its text on one
  line and its file name and line as a link; a click opens the row in place.
  The met criteria fold into one row. While the review shows, the panel's bar
  doesn't say the verdict too.
- **No second copy.** A finding's rows come from the task page's
  `ticketReview`, and draw with its `place` and `excerpt` (`review.ts`). Its
  file opens through `openReviewFile`, which the task page now calls too; the
  Command Center takes `review-file` from the panel (`dock-review.ts`).
- **The plain text stays.** Show output, in the panel's bar, shows the run's
  lines as before, and Show the review goes back.
- **Checked.** `dock-review.test.ts` has 17 tests: the model's phases and
  edge cases, the reader against a real folder, a review run ending with its
  verdict on the card, and a run that isn't a review drawing as it did. The
  screenshot run adds five pages over the Tasks board: a review that passed,
  one that asked for changes, one still running, the changes one with its
  summary, a criterion, a finding and the met criteria opened, and one whose
  verdict file isn't JSON. A behaviour
  case clicks through the panel. Four new mutants (the verdict dropped for
  the lines, a row that opens nothing, a next step that sends nothing, Show
  output that does nothing), and the task page's link mutant, each fail it.
- Not chosen: other kinds of run (an analysis can follow this one); turning
  the next step off when the task has moved on since (Land asks first, and
  acc refuses a step the task's state no longer allows, with why).
