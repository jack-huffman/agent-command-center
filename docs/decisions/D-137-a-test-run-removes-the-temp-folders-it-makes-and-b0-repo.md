## D-137 A test run removes the temp folders it makes, and B0.repo reads a crowded folder only in part (2026-10-10)

On 2026-10-10 `packages/core/test/onboarding.test.ts` timed out at 300 s on every run (GH-174). The
system temp directory held 347,799 entries, most of them folders the tests had made and never removed,
and B0.repo's `nearbyRepo()` listed every one of them whenever a test handed it a fresh temp folder.

- **Each test process makes one root and removes it on exit.** `packages/core/test/temp-root.ts` makes
  `acc-run-<pid>-XXXXXX` under the system temp directory when a test file first imports it (through
  `support.ts`), and removes it on `exit`, which a failed test still reaches, and on SIGINT, SIGTERM and
  SIGHUP. After a signal it sends the signal again to end the process, unless the code under test listens
  for it too; that listener then decides, and isn't reached twice. `tempDir()` makes its folders inside it. It also sets `TMPDIR` to the root, so the folders the
  code under test and the programs it starts make with `tmpdir()` land inside it too.
- **Tests make temp folders only through `tempDir()`.** The test files that called
  `mkdtempSync(join(tmpdir(), …))` themselves (`extension/test/activate`, `activity`, `progress`, `slack`;
  `scripts/test/areas`, `settings`) now call `tempDir()`. The scripts the tests run (screenshot,
  packaging) and the source code already remove their own temp folders in a `finally`; they ship, so
  they don't import test support, and under a test they now make them inside the root.
- **`nearbyRepo()` reads at most 200 entries of the parent (`NEARBY_LIMIT`), and none when the parent is
  the system temp directory** (compared through `realpath`, as macOS's `/var` is `/private/var`). It reads
  with `opendirSync`, so a crowded folder is never listed whole. A project's old folder sits among a
  person's folders, not among hundreds, so the limit doesn't hide a real neighbour; nothing in the temp
  directory is a project's repo.
- Evidence: `packages/core/test/temp-root.test.ts` adds 6 tests: the root's place and name; a child test
  file run with `TMPDIR` set to an empty folder leaves it empty when its tests pass, when one fails, and
  when the process is ended by SIGTERM, with or without its own SIGTERM listener; and a source check that fails on `mkdtempSync(join(tmpdir()` in
  any test file but `temp-root.ts`, counting the files it read and failing unless there are more than 50. Turning off the
  removal on exit fails two of them. `onboarding.test.ts` adds 2: a folder with 5,000 sibling folders
  gives 200 to look at and is answered within a second; a repo in the temp directory isn't offered, and a
  missing folder gives none.
- Not chosen: a global setup file passed to `node --test` (`--import`), which every way of running a
  single test file would have to repeat; removing old folders from the temp directory at start, which
  would reach into other runs' and other programs' folders.
