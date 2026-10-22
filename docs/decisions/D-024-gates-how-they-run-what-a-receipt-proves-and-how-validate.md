## D-024 Gates: how they run, what a receipt proves, and how validate stays check-only (2026-10-01)

M4 builds the gates from DESIGN section 9. Some details weren't settled there.

**Validate uses `sf project deploy start --dry-run`.** `sf project deploy
validate` doesn't accept `NoTestRun`, which the design calls for when no Apex
changed. A dry run is the same check-only deploy, and nothing is saved. To stop a
real deploy slipping in, the gate runner refuses any `deploy start` that lacks
`--dry-run`. Builders' own permissions still deny `sf project deploy start`;
only acc runs it.

**What a receipt proves.** It's the result of one gate on one commit, stored at
`<git-common-dir>/acc/receipts/<sha>/<gate>.json` with its log beside it.

- A gate that doesn't apply, such as `lint` when no LWC changed, records `skip`.
  A skip satisfies `acc done`.
- A run with uncommitted changes still runs, but records nothing, because the
  receipt would claim a commit it didn't check.
- `error` means the gate couldn't run (a missing tool, an org that's not logged
  in). It's kept apart from `fail`, which means the change is wrong.

**Heavy gates take a machine-wide slot.** The slots are mkdir locks in
`~/.acc/heavy/` (`ACC_HEAVY_DIR`). There's one by default (`ACC_HEAVY_SLOTS`). A
slot whose owner process has gone is taken over. Every gate runs under
`nice -n 15`. Heavy by default: `static`, `lwc-tests` and `validate` in the
Salesforce profile, and `build`, `test` and `check` in the generic one. Set
`gates.heavy` to change it.

**Changed files** are `git diff --name-status --no-renames` from the merge base
with `origin/<branch>`, or the local branch if there's no remote. With no
renames, a rename counts as a deletion, and deletions go to a person (v1).
Environment-specific files are left out of every gate. If a branch touched one,
`validate` fails (D-016).

**Drift** retrieves the baseline manifest into a detached, throwaway worktree in
the git common dir. It prints nothing when the org matches its branch, ignoring
`knownDrift` and `environmentSpecific`. Otherwise it lists three things, and
exits 1:

- what changed in the org
- what exists only in the org
- what the branch has and the org lacks

A retrieve doesn't delete local files, so the third list comes from the
retrieve's "cannot be found" entries. Each one is matched back to its files in
the branch by Salesforce's naming, so all three lists are file paths and
`knownDrift` covers them alike. The first drift run, on a Developer sandbox,
found the third list: about 120 components for features the sandbox lacks, and
about 15 Production changes made after the sandbox was created. Components the
retrieve couldn't fetch for other reasons are shown as notes on the manifest,
not as drift.
