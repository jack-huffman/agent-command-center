## D-114 Every project's rules keep parallel work mergeable, and a burst of merges offers a tidy-up (2026-10-08)

GH-104. GH-94 split this repo's hub files so parallel builders rarely touch the
same file; the same lesson belongs in what acc tells every project's builders.
PhotoCraft's agents kept many builders going at once with three rules, and
showed the cost of nobody tidying: 44 local copies of one helper, and comments
that contradict other files ("Check Spelling is not implemented"; it is,
elsewhere).

- **Every project's rules, in every profile** (a person decided). rules.ts's
  `BASE_RULES` come first in the Rules section, under their own heading, then
  the profile's: new behaviour in its own file, registered with one line where
  a list must name every area; if another task's change breaks your build,
  block with the reason and don't edit its files; write a manifest or config
  file whole, temp file then rename. Salesforce keeps them too, since
  package.xml is a manifest; its own rules follow unchanged. Builders,
  reviewers and analysts all get them, as rulesText always did, and the
  SessionStart short packet names them in one line. rulesText never returns
  null now.
- **The reviewer looks for a duplicated helper**, in every profile, and names
  both as file:line in the finding's message, since a finding holds one place.
  It must be fixed when the existing helper is exported (a person decided); a
  near-copy of a local one is must: false. The plugin's reviewer.md says the
  same. It's prompt-only: tests pin the words, not the model.
- **A tidy-up after `tidy.every` merges** (8 by default, 0 for never, whole
  numbers to 100), per repo ledger. "Since the last tidy-up" means since a
  person added or skipped one, kept in `<git-common-dir>/acc/tidy.json` and
  written whole. With none on record, only the newest `every` merged tasks
  count (a person decided), so a busy repo gets an offer at once and older work
  isn't swept in. Tasks labelled `tidy-up` don't count, and an open one holds
  the offer back.
- **Its scope is the files those merges touched** that still exist on the
  default environment's branch, fetched first: each task's merge commit against
  its first parent, else the merge that took its branch in, else its branch
  against where it left. Append-only, environment-specific and `.acc/` files
  are left out. 16 of this repo's 44 merged tasks have no recorded merge
  commit, so a task whose files can't be found is named in the draft with why,
  never dropped.
- **Drafted for a person, never created on its own.** Sync and autopilot add
  nothing; a test runs both over 8 merges. The Overview's blue item (an offer,
  so not counted in the badge) drafts it through `acc tidy --json` and adds it
  only on a person's Add task (`acc tidy add`: a manual T-n, labelled
  `tidy-up`, in To do; no GitHub issue, D-066). Not now (`acc tidy skip`)
  records a skip with who and when, which resets the count (a person decided)
  rather than snoozing. Both refuse builders, reviewers and analysts; builders'
  settings and the PreToolUse hook deny them too.
- The ledger's `writeAtomic` is exported for tidy.json rather than copied.
- Not done here: acc finding duplicates itself (a same-name scan or lint); a
  check that enforces the three rules, such as no non-atomic config writes
  (writeConfig still writes in place); autopilot dispatching the tidy-up;
  team templates setting `tidy`.
