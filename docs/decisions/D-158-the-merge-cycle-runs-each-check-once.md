## D-158 The merge cycle runs each check once (2026-10-15)

On 2026-10-15 each install ran `npm run check` again through `npm run package` (D-079), and each run took
about 8 minutes, though the same check had passed on the same commit a minute before. The three `tsc` runs
of `npm run typecheck` also started from nothing each time.

- **D-079's step stays.** Package still needs a passed check of the tree it packages. This change does not
  repeat that step. It only lets a check that already passed count.
- **The receipt:** when `npm run check` passes, its last step writes `dist/check-receipt.json`. It holds
  `HEAD^{tree}`, `clean` (whether the working tree had no change and no untracked file) and the time. `dist/`
  is ignored by git. The code is `scripts/check-receipt.ts`.
- **Package** skips the check when the receipt names HEAD's tree, the working tree is clean now, and the
  receipt is under 24 hours old. It then prints the commit and the time of the receipt. Any other case runs
  the check as before: no receipt (or one that isn't JSON), another commit, a dirty tree, an old receipt.
  `npm run package -- --check` runs the check always.
- **Typecheck:** each of the three `tsconfig.json` files sets `incremental: true`, with its build info file
  in `dist/tsbuildinfo/`. The stray-files check counts only added files, and `dist/` is ignored, so it is
  not changed. Times on this machine, from an empty `dist/tsbuildinfo/`: the first `npm run typecheck`
  took 1.8 s, and the second, right after it, 1.0 s.
- **Checked:** seven tests in `scripts/test/packaging.test.ts`: a matching receipt (the check does not
  run, the note names the commit and time, git ignores the file), a dirty tree (an edit, and an untracked
  file), another commit, no receipt or one that isn't JSON, a receipt 24 hours old and one a minute
  younger, `--check`, and a receipt written from a dirty tree. Each says whether the check ran.

Out of scope: the merge queue, and acc's own gate receipts.
