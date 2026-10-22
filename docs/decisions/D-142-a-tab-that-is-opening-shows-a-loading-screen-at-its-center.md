## D-142 A tab that is opening shows a loading screen at its center (2026-10-13)

A Command Center tab showed "Loading…" in its top-left corner until its first model arrived. It now shows
a loading screen at the tab's center (T-16).

- **One function.** `loadingScreen` in `extension/src/logic/loading.ts`, with no vscode import, makes the
  screen's HTML: the acc mark (the dark and light marks, as the rail draws them) in a 76 px ring, and one
  line in the description colour, "Opening the Command Center", "Opening the task" or "Opening the agent".
  `htmlFor` puts it in `#app`, and the page script draws the first model over it. The screen has
  `role="status"` and `aria-live="polite"`, and the line names it.
- **Motion.** A short arc in the accent turns once in 1.1 s, eased. The screen fades in after 150 ms, so a
  fast load shows no flash. Under `prefers-reduced-motion: reduce`, nothing turns or fades. The classes are
  `opening-*`: `.loading` was already the Tasks board's "Loading" chip.
- **Still pages.** The screenshot run has a `loading` page, in `STILL`: it is drawn with no model sent, so
  the screen stays. A still page has no rail and no controls, so `judge` takes `controls` and the run
  passes false for it; the tab floor counts home pages that aren't still. Headless Chrome's virtual time
  doesn't move animations, so a still page ends its fade itself before it is measured. The colour check
  draws it too.
- **Scroll on the first model.** The page script counts a page that holds only the loading screen as
  fresh, so a rebuilt tab goes back to its saved scroll position on its first model. Before, the
  "Loading…" paragraph made it not fresh, and the saved position was ignored. Found at review; only a
  match on the source line pins it.
