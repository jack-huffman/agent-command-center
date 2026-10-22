## D-170 History groups its entries under a line for each day, and loads them a page at a time (2026-10-16)

History in full drew up to 300 entries at once, in one long list: too much to
read, and costly on each refresh.

- **A line for each day.** Each day's entries sit under a thin rule with the
  day's name in its middle, an `h3`, so a screen reader moves from day to day:
  Today, Yesterday, a weekday within the last 7 days, then "Tuesday, 7
  October", with its year when it isn't this year's. The names come from the
  person's time zone, in the page (`webview/days.ts`, which holds no DOM). The
  rule is the page's `--edge`, mixed from the theme's foreground: in a dark
  theme the panel border is near the modal's own colour, and didn't show.
- **Rows that read well.** Each entry is one row: its state's icon and label,
  its task's key, one line of text cut with an ellipsis (all of it on hover),
  and its time on the 24-hour clock at the right. A click opens its detail in
  place, as before. A move now carries its look from the model.
- **Pages.** The home model sends History's newest 40 and each filter's count
  (`model/history-pages.ts`, no vscode import). Each entry has an id that
  stays the same from refresh to refresh, and History's order breaks a tie in
  time by id, so a page asked for after an entry starts at the same place,
  though that entry is gone. The page asks with `history-more` when the list's
  end comes near (an IntersectionObserver), and the extension answers with
  `history-page` from every entry History holds now (`src/history.ts`).
  "Loading…" shows while it waits, and "That's everything" at the end.
- **Filters and opening at an entry.** A filter asks for its own first page;
  the counts are the model's. A line that opens History at an entry not loaded
  asks for the pages up to it, then scrolls to it. An entry that's gone gives
  the next page, with nothing marked.
- **Refresh keeps the place.** What the page loaded is kept
  (`webview/history-store.ts`): a new model's newer entries go on top, and the
  row in view stays where it was (`keepPlace`, which measures again after each
  move, as a scroll can land a few px short of where it was set). It measures
  in the layout's px (`scaleOf`): while the modal still grows in as it opens,
  a box measures up to a tenth smaller than it lays out. When All's
  whole first page is new and more are still to come, there may be a gap, so
  All starts again from it.
- **Checked.** `history-pages.test.ts` has 29 tests: day names (each of the
  last 7 days, an older date, midnight in Chicago), the pages (first, next,
  last, a filter's, up to an entry; no entries, exactly 40, an entry that's
  gone), the page's store and its kept place, also while the modal grows in, the home model's 40 with its
  counts, and a mutant
  of the model that sends every entry, which the page-size check catches. The
  screenshot run adds History with 100 entries over six or seven days. A
  behaviour case scrolls to the end and sees the next page arrive, takes a
  refresh with a new entry while scrolled, picks Commands, and opens History
  at an entry on its third page; five mutants each fail it. Headless Chrome with a virtual time budget draws no frames, so no
  IntersectionObserver reports there and a scroll fires no event: the
  behaviour page stands in for it, measuring boxes on each scroll event, and
  the probe's scroll fires one.
- Not chosen: changing what History records, or its cap of 300 entries; the
  task page's own day lines (`dayLabel`), which stay as they are.
