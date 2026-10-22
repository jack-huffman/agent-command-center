## D-183 A failed verification leaves no worktree, and a dirty one says it wrote no receipt (2026-10-21)

Notes on D-182, which stays as written.

- **A failed verification removes the worktree it added.** When a step after
  the checkout throws (setup, the verifier timing out, Claude Code not
  starting), `verify` removes the `verify-<task>` worktree it added. A worktree
  it found already at that commit is left. `pruneVerifications` also lists the
  `verify-*` folders under the worktree root, so a leftover with no stored
  file goes with a task that left the board.
- **Receipts: D-182 holds for a clean worktree only.** `runGates` writes no
  receipt when the worktree is dirty, and the setup can leave files (an org's
  `.sf` config, a setup command's output). The gates don't ignore them, so
  the verification adds a `receipts` check line, skipped, with that reason
  (`DIRTY_GATE`), and writes no receipt for that commit. A clean worktree
  writes one receipt for each check, by sha.
