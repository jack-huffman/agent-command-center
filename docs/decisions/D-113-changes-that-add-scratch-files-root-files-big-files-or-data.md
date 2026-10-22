## D-113 Changes that add scratch files, root files, big files or data exports fail a built-in check (2026-10-08)

Agents commit their scratch output. PhotoCraft's main branch got
`fb-test.log` and `fb-clippy.log` from one agent's pull request and a 1,929-line
`test.tmp` from another, and a Salesforce project's root often holds client
data exports. The doctor's B3 steps only look at the root, and only when a
person runs setup. So `stray-files` checks every change (GH-103).

- **What fails.** A change that adds a log, temp file or merge leftover
  (`*.log`, `*.tmp`, `*.orig`, `*.rej`, case-insensitive, or `.DS_Store`, by a
  file's name at any depth); a new file at the repo root (a path with no `/`; a
  new top-level folder isn't one); or a file whose committed blob is over 1 MB
  (1,048,576 bytes, from `git cat-file`, so an LFS pointer passes and a dirty
  tree doesn't matter). In Salesforce, also a data file outside the folders
  `strayFiles.data` lists. A data file is `.csv`, `.xls`, `.xlsx` or `.eml`
  (a person decided `.eml` counts): `DATA_EXT` in stray-files.ts, which the
  doctor's B3.gitignore and B3.data-files now share, so there's one definition
  of client data. Each file is named with the first rule it breaks, in that
  order, with the fix: `git rm --cached <file>` and add it to `.gitignore`,
  or list it under `strayFiles`.
- **Only what the change adds.** Status `A` in the diff from the merge base
  that every gate uses (D-024), minus environment-specific files: `Changes`
  now keeps `added` apart. A file already on the environment's branch never
  counts, however it's changed. A rename's new path is added, so moving a big
  file or moving one to the root fails until it's listed. A change that adds
  nothing records `skip`. A generic repo with no environment branch to compare
  with records `error`, not a pass on nothing: `GateInput.unknownBase` says
  why, where runGates used to swallow it.
- **Allowances** are `strayFiles.allow` (paths or folders, matched as
  `dispatch.shared` is, no globs) and `strayFiles.data`, beside `secretScan`.
  Both are repo paths, never absolute or climbing out; `data` warns outside
  Salesforce. They're project-only: a team template that sets `strayFiles` is
  refused. They're read from the checked commit's own `.acc/config.json` (a
  person decided), so a builder's run and the merge queue's give one answer.
  That means a change can allow its own file. The listing shows in the pull
  request's diff, where the reviewer (D-032) and the person merging see it;
  nothing else guards it.
- **Required by default, everywhere** (a person decided). In both profiles,
  in a builder's scope and the merge queue's, unless `strayFiles.required` is
  `false`, as analysis is on by default (D-052). `gates.required` needn't name
  it: `fullGates(config)` is `gates.required` with stray-files added, and
  `requiredGates` adds it to `gates.builder` too, since it's cheap and the
  builder can fix what it finds. Code reads the required list only through
  those two now. Before, about ten places read `gates.required` directly, and
  an implicit gate would have been enforced by some (`acc done`, the queue)
  and invisible to others (the task page, the packet, refresh). A test in
  config.test.ts pins it: `config.gates.required` is read only in config.ts
  and in template.ts, where B0.template compares the raw list with a
  template's. A per-commit waiver (D-031) covers a one-off.
- **A bare `acc gate run`** in a project that requires nothing but
  stray-files still runs every gate, as before: the fallback asks whether
  anything but stray-files is required.
- **Built in, replaceable.** It's first in `gatesFor` for both profiles, not
  heavy, and runs only git. A `gates.commands` entry named `stray-files`
  replaces it, as for the Salesforce built-ins.
- **On upgrade**, tasks already done or in review have no stray-files
  receipt, so `acc done`, `acc review` and `acc land` refuse them until
  `acc gate run`; the merge queue runs it itself. `writeConfig` writes the
  `strayFiles` defaults into `.acc/config.json` the next time acc saves it, as
  it does `secretScan`'s.
- Not done here: flagging files already tracked; editing `.gitignore` or
  untracking anything (it only reads); globs in allowances; a setting on the
  Settings page.
