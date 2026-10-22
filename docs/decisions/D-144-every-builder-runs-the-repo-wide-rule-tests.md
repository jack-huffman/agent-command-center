## D-144 Every builder runs the repo-wide rule tests (2026-10-14)

T-24 passed every builder check (typecheck, near-tests, the tests count, screenshots), and its merge then broke
two tests on main: `scripts/test/edge-cases.test.ts` found a test file with no test named for an edge case,
and `scripts/test/near-tests.test.ts` found that a new page module changed which tests are near the page's
modules. Both are repo-wide rule tests, which ran only in `npm run check`, in the merge queue.

- **A `repo-rules` check.** `gates.commands["repo-rules"]` runs `node --no-warnings --test
  "scripts/test/*.test.ts"`, which takes about 15 seconds. It sits in `gates.builder` after `near-tests`, and
  in `gates.heavy` and `gates.tests` as `near-tests` does.
- **Pinned.** `scripts/test/repo-rules-gate.test.ts` adds 3 tests. They fail when `repo-rules` is not in
  `gates.builder` after `near-tests`, when its command does not run the files in `scripts/test/`, or when it
  is missing from `gates.heavy` or `gates.tests`.

Out of scope: `npm run check`, the merge queue, and which tests near-tests chooses.
