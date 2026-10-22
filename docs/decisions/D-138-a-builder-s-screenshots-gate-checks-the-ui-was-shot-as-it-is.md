## D-138 A builder's screenshots gate checks the UI was shot as it is (2026-10-10)

From repeated review findings (13 across 11 tasks, 2 of them must-fix): CLAUDE.md asks that UI changes
be looked at before they ship, and reviews kept finding shots on disk older than the change (GH-41,
GH-83), shots that stop above the new part at 900 px (GH-41, GH-46, GH-76), a new line or state no shot
draws (GH-32, GH-52), and one theme shot at one width only (GH-95). Nothing can tell whether a person read
a PNG, but a gate can tell whether the PNGs there are to read show the branch as it is.

- **The run notes each shot.** `npm run screenshot` writes `shots.json` beside the PNGs, written whole
  through a temp file, merged with what earlier runs noted, so a run split into groups of pages counts:
  for each shot, the PNG's sha256, the fingerprint of what it drew, its geometry findings, and every
  class on a visible element drawn inside the window, which the page's geometry collector now gathers.
  A shot at another `--height`, or started from `ACC_SHOT_STATE`, isn't noted.
- **The fingerprint is what the pages draw from** (`fingerprint()` in `screenshot.ts`): every file of
  the webview's source, the pages, widths and heights, and each page as it's handed to Chrome in each
  theme, with its sample model and starting state, at a still clock. A change to the page, its model,
  its fixtures or the run's checks changes it.
- **The gate** (`screenshots`, a builder's check, `extension/scripts/looked.ts`). When the branch changes a
  file under `extension/webview/`, `extension/src/` or `extension/scripts/`, every usual shot (each page,
  dark and light, at 1000, 620 and 500 px) must be noted with this commit's fingerprint and no geometry
  findings, and its PNG must still be the one noted. Every CSS class the branch adds to the webview's
  stylesheets must be drawn on screen in one of them, or be named in `UNDRAWN` with why; a name there
  that no stylesheet holds fails its test. It counts the shots and classes it checked, fails on a branch
  that changed nothing, and fails run by hand without `ACC_CHANGED`. A branch that changes none of those
  folders passes, saying how many files it checked. The merge queue's checkout has no screenshots, so
  the full check doesn't run it.
- **Checked.** `extension/test/looked.test.ts`: a branch shot as it is passes with its counts; no files
  changed, no shots, a stale shot, a missing one, one with findings, a PNG gone or changed since, a new
  class drawn nowhere (or only in a stale shot), and no usual shots each fail; `UNDRAWN` excuses by name;
  a branch that changes nothing the pages draw from passes; the class reader skips declarations, comments
  and strings; the fingerprint is the same twice and changes with one byte or a file taken away; notes
  merge and an unreadable record starts empty. This branch changes the screenshot scripts, so its own
  gate held it until a full run: one run took all 342 shots with no geometry findings, noting 572
  classes drawn, and the gate passed, checking 342 shots. With a class added to `styles.css` by hand,
  it failed on all 342 shots being of other code and on the class drawn in none.
- Not checked: that a person read the PNGs, or that they look right (spacing, alignment). A class drawn
  only by the extension's host (a notification, GH-28) can't be shot. A change in `packages/` that
  reaches the page through the model is drawn into the fingerprint but doesn't make the gate ask for
  shots, since the gate asks only for changes under the three folders.
- Not chosen: running the screenshots inside the gate, which takes Chrome tens of minutes; a hand-kept
  list of pages each change must show.
- Note (T-13, 2026-10-13): the stylesheets the gate counts as there before the branch are read through
  the same list as the page's (`styleNames`, which `styleFiles()` uses), at the commit the branch began
  from. Before, any `.css` in the webview's folder counted, so a class held only by a stray stylesheet no
  module is named for, and never part of the page, didn't count as new. `looked.test.ts` pins it.
