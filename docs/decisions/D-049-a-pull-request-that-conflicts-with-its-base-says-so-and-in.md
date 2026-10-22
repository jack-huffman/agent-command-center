## D-049 A pull request that conflicts with its base says so, and in which files (2026-10-03)

Parallel builders branch from the same base, so their pull requests collide. In
the M7 run, 2 of 4 open pull requests conflicted with main: #16 in
`docs/DECISIONS.md`, #10 in `plugin/bin/acc`. Nothing in acc said so: you found
out on GitHub.

- **acc works it out itself.** `acc sync` fetches each open pull request's base
  and branch into origin's remote-tracking refs, then asks
  `git merge-tree --write-tree --name-only` which files it can't merge. It keeps
  them as `pr.conflicts`, empty when the pull request merges cleanly.
  - Nothing local changes: no branch, no checkout, no working tree.
  - GitHub's `mergeable` says only that it conflicts, not where, and it's often
    still unknown just after a push.
  - When the fetch fails or git can't tell, what it last said stands. The fetch
    never stops to ask for a password.
  - The base and branch are the pull request's own, from GitHub, falling back to
    the task's environment and branch.
- **A task in review whose pull request conflicts needs you,** as failing checks
  do (D-033).
- **`acc land` checks too,** once it has opened or updated the pull request, and
  names the files.
- **In the extension:**
  - Cards on both boards say "Conflicts with dev: …", with a warning icon and
    the words, in orange. A card names the first three files by folder and name
    (`bin/acc`). The ticket page names every file in full.
  - The Overview says why the task needs you.
  - A new notice: "Pull request #N (GH-x) conflicts with dev in …", with Open
    pull request (D-044). It's said when a pull request starts to conflict, not
    again as its files change.
- Not chosen: resolving the conflict for you. That changes the branch after its
  review. It's rework, for a builder or a person.
