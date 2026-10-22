## D-100 A folder's modules are near what loads them, and the files every task touched follow the areas (2026-10-07)

GH-95, which GH-94 (D-099) left. In the 21 merges before GH-94, six more
files conflicted almost as often as the hub files: the screenshots' fixtures in
16, logic.test.ts in 13, package.json's command list and styles.css in 11,
tabs.test.ts in 10, core's index.ts in 8.

- **A file a folder's index gathers is near the tests of that index and of
  what loads it.** An index is a file that imports the changed file and more
  than half the other code in its folder; what loads it is other code in the
  package that imports it by its path. So `packages/cli/src/commands/tasks.ts`
  is near cli.test.ts, which runs main.ts, an extension area near
  activate.test.ts, and a module of core near only its own tests, since
  nothing in core loads core's index. A package starts at its `src`, `lib` or
  `app` folder, else at the nearest folder with a package.json, so the page's
  modules in `extension/webview/` are near `extension/test/`. It's general, not
  this repo's layout: any repo with index files gets it.
- **acc reads each file once, and only for a gate that reads
  `ACC_NEAR_TESTS`**: one whose command names it, or names a file in the
  checkout that does. The typecheck and the full check no longer wait for it.
  A check never inherits `ACC_CHANGED` or `ACC_NEAR_TESTS` from the acc it runs
  under. This repo's `scripts/near-tests.mjs` fails when it isn't given the
  list, rather than pass having run nothing, and has a test of its own.
- **Split by area:** the fixtures into `extension/scripts/fixtures/`, the two
  test files into a file per area with a `support.ts`, styles.css into what
  every area shares and a `<module>.css` beside each module of the page.
  DESIGN.md §2 says where each lives.
- **Generated:** core's index.ts, by `scripts/areas.ts`, `export *` from each
  module by file name, with the four that give only some names in a named list
  (`CORE_INDEX`), which a test pins; package.json's commands, from
  `extension/commands/<module>.json`, named for the module that registers
  them, by `extension/scripts/generate.ts` beside the walkthroughs.
- **The styles' order is their names now**, so moving rules out of one file
  could change which rule wins. Every element's computed style, with its
  ::before and ::after, on all 33 sample pages, dark at 1000, 620 and 500 px
  and light at 1000, matched the original styles.css once two classes two
  areas share, `.history` and `.composer`, went to styles.css. Where a render
  changed with the clock (a fold toggle measured late, In progress's fading
  line, the icon font still loading), a second render matched. A rule two
  areas need belongs in styles.css; a `.css` named for no module of the page
  fails the build.
- **Nothing a person sees changed:** acc help is byte for byte the same; the
  .vsix contributes the same 83 commands, field for field, in a new order; every
  sample model the screenshots draw is the same with the clock held still; the
  tests moved whole.
- Not done here: the screenshot script still lists every page it draws
  (`PAGES`, `sampleModel`), and a test that reads the page's source by
  `pageSource()` is near no single module of the page.
