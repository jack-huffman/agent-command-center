## D-169 Every run in the output panel shows as rows, never as a block of raw lines (2026-10-16)

T-64. The output panel showed each run as its command and its lines in a
monospace block. D-167 gave a review its own view, but its Show output and
every other run were still plain text. The author asked for no plain text
in the panel at all: each run in the page's own type and the theme's
colours, as the review view reads.

- **Rows from one pure function.** `logic/run-rows.ts` turns a run's lines
  into rows, with no `vscode` import: a success (a tick, "Done", "passed",
  "Deployed") with a blue mark; a warning and an error with an orange icon
  and label; a count of progress ("3/10", "45%") as a thin bar; and a note
  in muted type. "0 failed" and "no errors" aren't failures. It drops colour
  codes, blank lines, a spinner's frame, and the "npm ERR!" or "Warning:" the
  row's label says. A line that repeats is one row with a count, and a count
  that moves on is one row at its latest. The last 200 rows show; one line
  counts the rest. A URL is a link. A file path is a chip: one in the folder
  the run ran in opens at its line (`Runs.openFile`, through the review's
  `fileInCheckout`), and one outside it is a quiet label that says why.
- **The card carries it.** `runCard` adds the rows, the count not shown, how
  long it took, its folder and its result (`model/run-view.ts`). The header
  line's state label is now Failed, not "Failed (exit 1)": the exit code is
  on the result card, in words ("It reported an error (exit code 1).").
  History shows a failed run as Failed too.
- **A header line, a menu and a result card.** The header line shows the
  state's icon and label, the run's name, and its clock (the review's own
  `clock`) or how long it took. The command moves into Details, in the
  header's menu (the board's `moreMenu`) with Copy log and the run in a
  terminal. Copy log copies every line the run kept, from the extension, not
  only the rows shown. An ended run ends with a result card: one sentence,
  a failure's last error row and exit code, and one next step: Open the step
  for a setup step's fix, Run again for any other run, and none for
  autopilot, whose switch starts it. Run again starts the command with the
  options it first had, in place of the ended run; one kept over a reload
  has only its folder, label and step.
- **Reviews too.** A review's Show output shows the same rows, with no
  result card, since its review says how it went.
- **Checked.** `run-rows.test.ts` has 15 tests: each kind, a URL, a path in
  the folder and outside it, repeats, escape codes, an empty output, more
  than 200 rows, the exit code in words, the result card and the run's card.
  `run-view.test.ts` has 4: Copy log, Run again, opening a path, and the
  panel drawing every run with `renderRunRows`. The screenshot run draws four
  more pages over the Tasks board: a deploy running, the deploy done with
  more rows than it shows, a lint that failed, and the deploy with Details
  open; Setup's output page is the run waiting for an answer. A new geometry
  check, raw, fails on a `pre`, or the `pre.dock-out` the panel used, in any
  panel drawn (`RAW_OUTPUT`), with a floor of 330 panels a run, and
  `geometry.test.ts` has a test for it. A behaviour
  case clicks through the failed lint, and five new mutants each fail it:
  the raw lines again, Details showing nothing, Copy log, a chip and Run
  again each sending nothing.
- Not chosen: how acc reports its own steps (a separate task gives its
  commands a step list); the terminal tab, which stays a terminal; a menu
  that opens on a keyboard shortcut.
