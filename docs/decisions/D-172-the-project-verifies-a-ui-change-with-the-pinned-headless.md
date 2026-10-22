## D-172 The project verifies a UI change with the pinned headless shell, never the person's own browser (2026-10-16)

The screenshot and behaviour runs started the person's own Chrome app in
headless mode, three at a time, hundreds of times a run. To macOS each one was
the Chrome app: its icon flickered in the Dock, and a click on Chrome brought
a headless one forward, so the person couldn't open their browser. On
2026-10-16 this stopped the author using Chrome.

- **The rule.** The project verifies a UI change with Google's
  `chrome-headless-shell` from Chrome for Testing, at the version the repo
  pins, never the person's own browser. It is a binary with no app bundle, so
  macOS never takes it for the Chrome app. CLAUDE.md says so, and the
  screenshots gate checks it (below).
- **The pin.** `extension/scripts/browser.json` names version 155.0.8059.84
  and each platform's zip SHA-256: mac-arm64, mac-x64 and linux64. Each hash
  was taken with `shasum -a 256` of the zip downloaded from
  `chrome-for-testing-public` on 2026-10-16; mac-arm64's equals the zip the
  merger checked that day. The zips stay out of the repo.
- **Getting it.** `npm run browser` (`extension/scripts/browser.ts`) downloads
  the pinned zip into `~/Library/Caches/acc/chrome-headless-shell/<version>/`
  (on Linux `$XDG_CACHE_HOME` or `~/.cache`), checks its SHA-256, and unpacks
  it into a folder of its own before moving it into place. A zip whose hash
  differs is deleted and nothing is unpacked. With the version already there,
  it does nothing. `--check` exits 1 when it isn't there.
- **Which browser draws.** `findChrome` takes `CHROME` first, then the pinned
  shell in the cache, and the Chrome app, Chromium or Edge only when neither
  is there. It says in one line what it draws with; the Chrome app's line says
  the run may take it over, and names `npm run browser`.
- **Nothing left running.** Each browser starts in a process group of its own
  (`extension/scripts/stops.ts`), tracked until it closes. On exit, an
  uncaught error, SIGINT or SIGTERM the run stops every group, so a browser's
  helper processes go with it. The colour check now draws without blocking,
  as the others do, so a signal reaches it mid-drawing.
- **The gate.** Each shot's note in `shots.json` records the browser that drew
  it: its binary's name and the version it says it is. The screenshots gate
  (D-138) fails a shot drawn by anything but the pinned shell at the pinned
  version, and a note that names no browser, naming `npm run browser` as the
  fix. Shots taken before this change name none, so they are taken again.
- **Setup.** A new config list, `tools`, names the tools a project's own checks
  need, each with a `check` command that exits 0 when it's there and a `fix`
  command. Setup's step `B13.tools` runs each check in the main checkout and
  offers the first missing tool's fix; a project that lists none skips it. The
  core names no project's tool (D-003): this repo lists the shell, with
  `npm run browser` as its fix.
- **Checked.** `browser.test.ts` has 10 tests (the pin, the platforms and
  cache, a match, a mismatch, the version already there, a fetch that fails,
  from a local zip); `stops.test.ts` 6 (a run that exits, throws, leaves a
  promise rejected, or is sent SIGINT or SIGTERM stops 3 fake browsers and
  each one's helper, and one with nothing running stops nothing);
  `screenshot.test.ts` 3 more for `findChrome`, with the line each case
  prints, and a wrong `CHROME` gets its own message; `looked.test.ts` 2 for
  the gate; `tool-steps.test.ts` 5. With the group kill turned back into a
  plain kill, the SIGTERM test fails, naming the helpers left running; with
  `stopOnExit` taken out, all five endings fail. The full run with the shell
  drew 540 drawings, as before, with no findings, 43 behaviour cases and 77
  mutants caught, in 195 s. The merger waived a timing with the Chrome app:
  the person was using it, and the app is what this moves away from. That the
  Chrome app opens a window when clicked while the full run draws is left for
  the person to check at the merge.
- Not chosen: reusing one browser for many drawings, which can follow this.
