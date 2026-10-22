## D-115 Every command survives junk arguments (2026-10-08)

GH-106. PhotoCraft's `panic_hunt` runs every command in its registry with junk,
so a new command is covered without anyone remembering it; but it's marked
ignored, and nothing runs it. acc keeps the first half and not the second: two
junk tests read the registries and run in `npm run check`, never skipped.

- **The lists are the registries.** acc's is `entryPointsOf(AREAS)`: each
  command, and each subcommand its group declares in `subcommands` (a person
  decided subcommands count: before, they lived only in `if (sub === …)`). A
  command that compares a word it doesn't declare fails the test. The
  extension's is `contributes.commands`. Each test asserts it called as many as
  the registry holds.
- **The junk.** No arguments, empty strings, wrong types, an unknown id, paths
  outside the repo and `../` ids, every option set to junk, and objects of the
  wrong shape for the extension. A 1 MB string can't be an argument: macOS caps
  arguments and environment at 1 MiB together, and Linux one argument at
  128 KiB. So a person decided acc gets 1 MB on stdin and in files, and 100 KB
  in arguments; the extension's in-process calls get the full 1 MB.
- **What passes.** For acc, exit 0, 1 or 2 within 20 seconds; exit 3 fails (a
  person decided), as it means an error acc didn't expect, such as a raw
  ENOENT. A failure prints one line, with no stack. A person decided main.ts
  cuts a message to 300 characters, in both human and `--json` output. Built,
  that cut `acc done`'s own refusal, about 400 characters, before the exact
  command a builder must run (D-106's test caught it). So main.ts cuts each
  word over 200 characters, which is where echoed junk lands, with an
  ellipsis, and the whole message only past 1,000. For the extension, each
  call settles within 10 seconds without throwing, with no unhandled
  rejection.
- **The sandbox.** Every acc call gets a fresh copy of the repo, so one that
  succeeds can't change another's start. HOME, TMPDIR, CLAUDE_CONFIG_DIR and
  acc's machine files point inside it; fake `gh`, `claude` and `sf` fail at
  once. Home, the template and an OUTSIDE folder, with bait a `../` id would
  reach, are hashed before and after each command. It runs the built acc,
  two calls at once, as spawning the source took a second a call; the
  near-tests gate builds first.
- **Its cost.** At three calls at once, cli.test.ts ran past its 300-second
  limit in `npm run check`. So two run at once, cases that overlapped were
  merged, and the regression tests run in their own file, refusals.test.ts.
- **What it found.** acc: a file it can't read exited 3 with a raw ENOENT or
  EISDIR; a folder named as a template or rules file did too; `acc analysis
  answer ../…` rewrote a JSON file outside the repo; long `--json` output was
  cut at 8 KB on a pipe, as acc exited before it drained; `acc drift` printed a
  progress line before refusing; messages echoed a 100 KB id. The extension:
  30 task and agent commands threw on an object that wasn't a row, and others
  on nothing; the step commands rejected an unknown step; In progress's Stop
  threw on `null`; Jira's import threw on a string. Each is fixed, with one
  test a cause (a person decided), naming every command it covers.
- **No catch-all in `reg()`.** Wrapping every handler in a try/catch would
  hide exactly what this test exists to find, so each handler checks what it
  gets: `nodeArg` drops an object that isn't a row and keeps a string, as some
  commands take a root.
- Not done here: the Command Center page's webview messages as an input
  surface; a real id with junk after it, which needs each command's argument
  shapes; running outside a git repo; kernel-level write sandboxing.
