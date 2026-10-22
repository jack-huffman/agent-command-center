## D-077 acc runs without a Node install, behind a small launcher (2026-10-06)

`acc` started through `#!/usr/bin/env node`, so with no node on PATH it failed
everywhere but the extension's own calls: terminals, Setup's **Do it**,
builders' `acc done` and the plugin's hooks (GH-59). The author chose to fix it
everywhere. This is the first of four packaging tasks, before GH-60, GH-61 and
GH-62.

- **Two files, side by side, wherever acc ships:** `acc`, a POSIX sh launcher
  (`packages/cli/bin/acc`, 0755), and `acc.mjs`, the bundle (0644, no
  shebang). The build puts both in `dist/` and `extension/dist/bin/`, and a
  release in `plugin/bin/`. `acc.mjs` sits beside the launcher, so acc's own
  folder (`accBinDir`) still holds `acc` for builders' PATH and the packet.
- **The launcher's order:** `$ACC_NODE` when set; else node on PATH when
  `node --version` is 20 or later; else the program named in `~/.acc/runtime`
  (`$ACC_RUNTIME_FILE` overrides it, for tests). `ELECTRON_RUN_AS_NODE=1` is set
  for the first and last, never for node. An `ACC_NODE` acc can't run is an
  error that names it, not a quiet fall back: it's an explicit choice.
- **Hooks never break a session.** With no runtime, `acc hook …` reads its
  input and exits 0 without a word, as acc's own hooks do on anything
  unexpected (D-042). Anything else prints one line naming the fix: open
  VSCode with Agent Command Center once, `brew install node`, or set
  `ACC_NODE`. So does a launcher whose `acc.mjs` is missing.
- **The extension records its runtime.** First thing on activation it writes
  `process.execPath` and a newline to `~/.acc/runtime`, whole or not at all,
  and only when the path changed. A failed write is logged, and activation
  carries on. This is the runtime builders' permission hook already used
  (D-030).
- **Amends D-012:** the extension runs `dist/bin/acc.mjs` with its own runtime;
  everything else, its terminals and Runs included, runs the launcher beside it.
- **Amends D-042:** a release copies the launcher and `acc.mjs` together, and a
  test fails if `plugin/bin/acc` is the launcher without `acc.mjs`. This branch
  leaves `plugin/bin/` alone, so the plugin's hooks still need node until the
  next `npm run package`.
- **A1.node is the Salesforce profile's**, since `sf` and its plugins need
  Node anyway. A generic project doesn't ask for it. With no project open the
  machine part still lists it, like A1.sf (a person decided; GH-62 can revisit
  it after a real fresh run). A1.claude's fix for a missing Claude Code is now
  `brew install --cask claude-code`, like the other tools', not npm.
- **Setup's machine results are kept with their folder's profile** and reused
  only in a folder with the same one. Otherwise a generic folder showed A1.node
  from a check made in a Salesforce folder within the last 12 hours.
- **macOS only**, on Apple Silicon or Intel. The bundle is plain JavaScript with
  no native modules, so it runs on both.
- Not chosen: bundling a Node binary into the extension or the plugin (tens of
  megabytes per architecture, for a runtime VSCode already has); a compiled
  single binary (the same size, and a build per architecture); and checking the
  recorded runtime's version (VSCode 1.95 or later has Node 20.18, and
  `ACC_NODE` is an explicit override, so neither is version-checked).
- Costs: each run starts a shell, and `node --version` when node is on PATH:
  about 50 ms more than running the bundle directly, on the author's Mac, on
  every hook. A stale `~/.acc/runtime`, say after VSCode moved, ends in the error
  until VSCode next starts. Processes acc starts on VSCode's runtime inherit
  `ELECTRON_RUN_AS_NODE`, as they already did from the extension.
