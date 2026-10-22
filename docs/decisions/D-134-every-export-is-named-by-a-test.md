## D-134 Every export is named by a test (2026-10-10)

From repeated review findings (a criterion with no test, a guard tested for one of the forms it catches, a
step that finishes during a wait, a dialog nothing drives in a browser: 7 findings across 6 tasks), the
repo's own rules gain a test-coverage rule: each acceptance criterion, and each case a guard or branch
handles, gets a test that fails without it, and every function, constant or class a source module exports
is named by a test. `scripts/test/coverage.test.ts` checks the second half against every module in
`packages/*/src`, `extension/src` and `extension/webview`, comparing git's list with the modules on disk.
It walks 1303 exports in 195 modules, an overloaded function once and a local `export { … }` list by the
names it exports. Its `OLDER` list names the 384 exports, in 121 modules, that no test named when the rule
came in, and may only shrink. A comment that starts a line doesn't count as naming one.
- Not chosen: line coverage from `node --test --experimental-test-coverage` as a floor, which would run the
  whole suite under instrumentation in the lighter checks; it stays a possible follow-up. The criteria and
  the cases a guard handles are left to the reviewer: no check reads a task's criteria yet.
