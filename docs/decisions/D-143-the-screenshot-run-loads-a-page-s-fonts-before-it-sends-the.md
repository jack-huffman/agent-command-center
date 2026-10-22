## D-143 The screenshot run loads a page's fonts before it sends the model (2026-10-14)

On a busy machine the screenshots gate failed on "the selected tab is out of view", on different pages
each run (three Settings shots at 620 px, then Setup at 500 px light), and passed on an idle machine with
the same commit (T-21). D-133's settle didn't help, because the tab had stopped moving in the wrong place.

- **Cause.** The icon font loads only once a glyph needs it, so it starts loading when the first model
  draws the rail. The rail scrolls its selected tab into view on its next frame and when
  `document.fonts.ready` resolves, and that resolves at once, before the font has started to load. When the
  font comes after the rail's next frame, the rail has scrolled for the fallback font's narrower tabs; the
  font then widens every tab, nothing scrolls again, and the tab ends past the strip's edge. On an idle
  machine the font comes first. Held back 200 or 330 ms in the page, the font gave the finding on
  Settings → About at 620 px every time; at once, or after 600 ms, it didn't.
- **The page loads its fonts first.** `FONTS_FIRST` in `extension/scripts/steady.ts` loads every font
  the page's stylesheets name, then calls the page's ready handler, which sends the model. The rail so
  draws with the icon font in place, and the order no longer hangs on how long the font takes. The
  geometry carries how many fonts loaded first (`accFontsFirst`), and the run fails a drawing that loaded
  none (`fontsUnwaited`). A font that fails to load leaves the model unsent, so the page measures nothing
  and the run fails on that.
- **Not a longer wait.** Waiting longer before measuring can't help: once the rail has scrolled for the
  narrow tabs, it stays there.
- Evidence: `extension/test/fonts-first.test.ts` adds 6 tests. A stand-in rail and a font 0 to 30 frames
  late measure one box, in view; the old order fails for some delays and passes for others; a tab really
  outside the strip still fails. In Chrome, with the font's load held back 200, 330 and 1000 ms, Settings →
  About at 620 px measured the tab in view.

Out of scope: the rail itself, which in VSCode can still scroll before its font arrives.
