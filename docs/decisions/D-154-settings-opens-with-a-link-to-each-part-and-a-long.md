## D-154 Settings opens with a link to each part, and a long explanation folds away (2026-10-15)

A second audit against the person's `apple-design` skill (2026-10-14) found Settings one long page whose
only guide was a 30-word subtitle, and whose rows each carried a paragraph that pushed the next row down.

- **The guide:** a row of links under the title replaces the subtitle, one for each part, its title and
  icon (`settingsGuide`, in the Settings model as `guide`). A link scrolls to the part's heading and focuses
  it, through the same `jumpTo` a deep link from another page uses. On a narrow tab the row wraps.
- **What this means:** a row keeps its name, its value, where the value comes from and its Change…. Its
  explanation, when it is more than one sentence or longer than 90 characters (`foldsMeaning`), goes into a
  "What this means" disclosure, closed at first; the tab remembers each one opened, in `opened`, as the
  agent page's steps are. The model names the ones that fold (`folded`), and `whatThisMeans` in
  `webview/dom.ts` draws each. One short sentence stays in view. The explanations
  it weighs are the theme's, each project's autonomy, auto-merge and cloud builders, Billing, each
  preference, and each version in About. A Limits row's where it's set and why it can't change stay in
  view: the first is the value's source, the second a disabled control's reason.
- **No new page file:** the fold rule lives in the model and the disclosure in `dom.ts`, because
  `extension/webview` takes no new file while `areas.ts` gathers 17 of its 34 modules: one more and the
  near-tests rule no longer counts `areas.ts` as the folder's index, so `screenshot.test.ts` stops being
  near every page module.
- **Height:** the sample Settings page, measured in headless Chrome with every fold closed, is now 4,100 px
  tall at 1000 px, 4,833 px at 620 px and 5,376 px at 500 px. The audit's 7,600 to 10,000 px are the
  heights of the screenshot PNGs, drawn at twice the size; the page was not measured the same way before.
- **Checked:** the behaviour run adds a Settings case (a link for each part, in order; a link focuses its
  heading; a closed fold for each long explanation, from the model; one opened stays open through a
  redraw) and three mutants. `settings-guide.test.ts` adds nine tests on the guide and the fold rule.

Out of scope: what a setting does and where acc keeps it.
