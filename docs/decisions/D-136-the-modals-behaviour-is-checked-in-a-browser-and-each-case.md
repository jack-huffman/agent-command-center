## D-136 The modals' behaviour is checked in a browser, and each case is shown to catch a stub (2026-10-10)

The task modal over the Tasks board (D-129) and the Overview's detail modal (D-131) were checked by hand:
Escape and the backdrop closing them, focus going back to what opened them, a redraw under them leaving
them as they were, a fold redrawing them, Show all, and the suggested rules' Previous and Next (GH-170,
a follow-up from GH-158's review). Now a script checks each, in headless Chrome, beside the screenshots.

- **Where it runs.** `extension/scripts/behaviour.ts`. A full run (every page, both themes and all
  three widths, as `npm run screenshot` with no options draws) runs it after the shots; `npm run screenshot -- --behaviour` runs it alone. Like the
  geometry collector (GH-105), each case is a page of the built webview from the screenshot fixtures
  (the Tasks board, and the busy Overview of GH-160), dumped with `--dump-dom`, and the page writes what
  it found into a JSON script element. The page's VSCode API keeps what the page sends and remembers, as
  VSCode does; the screenshot pages' doesn't keep the tab's memory, which a fold needs.
- **What it checks: 12 cases, 84 checks.** The task modal: Escape closes it, tells the extension once,
  and sends focus back to its card; a backdrop click closes it, a click inside or a press inside released
  on the backdrop doesn't; Close sends focus to its card on a board redrawn under it; a new board model
  leaves it open, at the same `scrollTop`, with the comment box's text, focus, and element; Show all on a
  fold in it draws it again unfolded. The detail modal: Escape closes it, the tab forgets it, and focus
  goes back to Review; the backdrop the same, opened by the line itself, and focus goes back to the line;
  a new model leaves it open on the same rule, scrolled, with the rule draft's text and focus, and focus
  then finds Review on the redrawn page; Show all on Needs you opens all 19 lines where the page shows 5;
  Previous and Next walk the ten rules to each end, off at each end; Accept and Confirm on the second rule
  send the message the inline Confirm sent (D-116), and its reviews' Show all draws it again with all
  five. What each case expects comes from the same fixtures (`behaviourData`): the rules' order and lines,
  the list's count, each Accept's message.
- **It proves it ran.** A case that wrote no report, checked nothing, or stopped on an element it couldn't
  find fails, never skips; a run of no cases fails. Every message a page sent must pass the extension's
  own check (`isFromWebview`).
- **It catches stubs.** Each of 16 mutants builds the page with one change to its source (esbuild, the
  file's text replaced where it's found exactly once), such as an Escape handler that does nothing, a
  backdrop click that does nothing, a drag out of the modal that closes it, focus left where it falls,
  the task modal drawn again with every board model or not with its own fold, the detail scrolled to
  its top, a draft that forgets what's typed, Show all opening only the first five, Next or Previous
  staying put, the first rule shown whatever the pager says, and Confirm leaving out the check. The run
  fails unless every case a mutant names fails on it, and on a mutant whose change no longer matches its
  source exactly once. All 16 are caught. `behaviour.test.ts` checks, with no browser, that each mutant
  fits its source and that every case is named by one, so a change to the page that moves a mutant's text
  fails near it (a row in `READS`, `scripts/near-reads.ts`).
- **Escape and the backdrop as the browser sends them.** A page's script can't press a key, so Escape is
  the cancel event Chrome fires on a modal dialog for it, followed by the browser's own close when nothing
  prevented it; a backdrop click is a mousedown and a click on the dialog outside its box. Hence the
  mutant is an Escape handler that does nothing rather than one taken out: with the cancel listener taken
  out, the task modal still closes through its close listener, as it would for a person, and its Escape
  case passes. The detail case fails on that one too: in the run, no close event reached the detail's
  dialog, so the tab kept it open in its memory.
- **What it found.** The detail modal sent focus to the first element marked as opening it, which is the
  line, when its Review button had opened it. It now remembers which kind of element opened it and goes
  back to that one, found again by its `data-opens` after a redraw (`detail.ts`). A task's description
  doesn't fold in Chrome: the clamp on a document of blocks leaves it its full height, so its Show all
  takes itself away. The fold case uses a step's reason in Activity, which folds; the description is
  left for a task of its own.
- Not chosen: driving Chrome through its DevTools protocol for trusted key presses, which would bring a
  client and a second way to run Chrome for one event; running the cases in the unit tests, which run
  without Chrome.
