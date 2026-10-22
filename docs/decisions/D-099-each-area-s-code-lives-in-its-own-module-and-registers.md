## D-099 Each area's code lives in its own module, and registers itself (2026-10-07)

GH-94. Nearly every merge on 2026-10-06 and 10-07 conflicted in the same few
files, each holding every area of the Command Center: of 21 merges, the
extension's model.ts was in 18, logic.ts in 18, the webview's main.ts and the
CLI's main.ts in 14. One merge conflicted in 24 files. Parallel builders
rarely touch the same area, but every area lived in the same file.

- **One module per area.** The CLI's commands are a module per help section
  (`packages/cli/src/commands/`), the extension's view models
  (`extension/src/model/`) and decisions (`extension/src/logic/`) a module per
  area, and the page (`extension/webview/`) a module per section, tab or part.
  Each folder has a small shared module for what several areas use. DESIGN.md
  §2 says where each area's code lives.
- **No list every feature has to edit.** Where something must name every
  area, each area says so in its own file, as `export const area`: the CLI's
  command table, options and help lines; the page's message checks and the
  acc.* commands it may ask for; what an area adds to the Overview, its tiles
  and the rail; the webview's sections, tabs and hooks; the VS Code commands
  each area registers and the page's messages it takes. `scripts/areas.ts`
  writes each folder's index of its area modules, headed "Generated … Don't
  edit it". npm run build runs it first, the indexes are committed because
  typecheck runs before the build, and `scripts/test/areas.test.ts` fails when
  one is stale.
- **What still names every section** is the page's table of contents: the
  sections and their titles (`model/shared.ts`), the section models a
  `HomeModel` holds, each section's Refresh in `panels.ts`, and the union of
  the page's models. A new section edits those, besides its own modules; a new
  feature in a section doesn't.
- **Order is explicit.** acc help's sections go in the order of their first
  group's `order`, and a section's groups by theirs. The Overview's Needs you
  goes area by area in each area's turn, a project at a time, then the items
  that aren't a project's, then by tone, as before; tiles carry their own
  order. File order never decides anything.
- **Moving code changes nothing it does.** `acc help`, its usage errors and
  exit codes are byte for byte the same, from source and from the built acc;
  the page takes the same 34 message types and allows the same 58 commands;
  core's index exports the same names; the D- and GH- references in the code
  are the same 1,331. Tests changed only where they import from, or the file
  they read the source of.
- **Areas import shared modules and each other, never an index**, so an index
  loading its areas never meets itself. There are no import cycles at run
  time. Tests import area modules directly, not a barrel, so GH-73's
  near-tests gate finds them by the file they test.
- **Modules node:test loads stay free of vscode.** The extension's areas that
  are also pure (`slack.ts`, `progress.ts`, `connect.ts`) take VS Code's API
  from the parts activate() hands every area, rather than importing it. The
  page's allowed commands sit with the model's areas, which node:test can load,
  so a test checks each is registered.
- **Core splits by concern, with its exports unchanged.** dispatch: the packet
  and the builder's settings (`packet.ts`), starting held tasks (`held.ts`),
  holding and claiming one (`holding.ts`), and the start and cleanup, which
  share the git helper and the checkout lookup (`dispatch.ts`). autopilot: its
  rules (`autopilot-rules.ts`), its log (`autopilot-log.ts`), and its mode and
  pass (`autopilot.ts`). `isTrusted` stays in dispatch.ts: dispatch checks it
  too, not only onboarding.
- Not done here: GH-73's near-tests gate doesn't find cli.test.ts for a change
  in `packages/cli/src/commands/`, since the tests run main.ts; a follow-up
  counts a folder module as near its entry's tests. Splitting the fixtures,
  styles.css and the big test files by area, and generating core's index.ts
  and package.json's command list, are a second follow-up.
