## D-133 The screenshot run retries a drawing Chrome didn't finish, and measures a tab once it has settled (2026-10-10)

While builders ran their checks, the screenshot run failed for reasons that weren't layout (GH-167):
twice "Chrome didn't finish <page> within 30 s: spawnSync nice ETIMEDOUT", and once "the selected tab is
outside the rail's visible part" on Settings → About (dark, 620 px), which passed on two reruns with
nothing changed. Each cost a rerun of every drawing.

- **A drawing that times out is drawn once more, never silently.** `extension/scripts/steady.ts`'s
  `drawRetrying` runs a drawing again only when it timed out (`ETIMEDOUT`); any other error, and a second
  timeout, fail the run as before. Each retry prints a line naming the drawing, and the summary line ends
  with how many were retried and which ("Retried no drawings." when none were), in both the geometry run
  and the colour check.
- **The time allowed is set by an environment variable, with a longer default.** `ACC_SHOT_TIMEOUT`
  gives each drawing's limit in whole seconds; unset or invalid, it's 60, twice the old 30. It doesn't
  scale with the heavy-check slots in use: the run would have to read the machine's slot state, the load
  that slows Chrome isn't only heavy checks, and a fixed limit keeps a run's outcome independent of what
  else happens to be running. A person on a busy machine sets the variable.
- **The tab check measures after the page has settled.** After its fonts load and two frames draw, the
  page now waits until the rail's selected tab (its box and the rail's scroll) has held still for three
  frames in a row (`SETTLE_FRAMES`) before measuring, at most 60 frames (`SETTLE_LIMIT`, about 1 s on
  the run's 16 ms frame timer). A tab still moving then is measured where it is, so a real misplacement
  still fails; so does one that settles outside the rail.
- Evidence: `extension/test/steady.test.ts` adds 7 tests: a drawing that times out once is drawn again,
  passes and is counted and said; one that times out twice fails, drawn twice only; one that passes or
  fails for another reason is never retried; the timeout's default and variable; a tab scrolling into
  view is measured once settled and passes; a tab settled outside the rail fails, and one that never
  settles is measured at the limit; a page with no tab doesn't wait. `geometry.test.ts` pins that the
  page settles before measuring. Settings → About and the Overview, drawn in Chrome at every width and
  theme, measured with no finding and no retry.
- Not chosen: scaling the timeout with the heavy-check slots; retrying more than once, which would hide
  a page that really hangs; changing the rail's own `showSelected`, which is the page's behaviour, not
  the run's.
