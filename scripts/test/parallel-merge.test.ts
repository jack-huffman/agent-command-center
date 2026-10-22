// Parallel work merges on its own (T-102), proved on a merge: two branches from one base each add a screenshot
// page, raise the tests floor and add a decision, in this repo's own files, and real git merges them into
// main one after the other, each numbered as it merges. No conflict, both pages, the higher floor, and two
// numbered decisions, with the index as the folder makes it.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { decisionsIndexFor, DECISIONS_INDEX, numberDecisions, readDecisions } from '../../packages/core/src/decisions.ts';
import { run } from '../../packages/core/src/exec.ts';
import { FLOORS_DRIVER, FLOORS_DRIVER_COMMAND } from '../../packages/core/src/floors-driver.ts';
import { formatFloors, readFloors } from '../../packages/core/src/ratchets.ts';
import { fakeBin, gitIn, makeRepo } from '../../packages/core/test/support.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const MAIN = join(ROOT, 'packages', 'cli', 'src', 'main.ts');
const ACC_ON_PATH = fakeBin('acc', `exec "${process.execPath}" --no-warnings "${MAIN}" "$@"\n`);
const PAGES_FILE = 'extension/scripts/pages.ts';
const SHARED = ['.gitattributes', PAGES_FILE, '.acc/floors.json', 'docs/decisions', DECISIONS_INDEX];

const pagesIn = (text: string): string[] => [...text.slice(text.indexOf('export const PAGES = [')).matchAll(/^ {2}'([a-z0-9-]+)',$/gm)].map((m) => m[1]!);

/** A branch's change, as a builder makes it: a page after the last of the Tasks tab's, a raised floor, and a decision. */
function build(dir: string, branch: string, task: string, page: string, floor: number) {
  gitIn(dir, 'checkout', '-q', '-b', branch, 'main');
  const file = join(dir, PAGES_FILE);
  const lines = readFileSync(file, 'utf8').split('\n');
  const last = lines.findLastIndex((l) => /^ {2}'tasks-/.test(l));
  lines.splice(last + 1, 0, `  '${page}',`);
  writeFileSync(file, lines.join('\n'));
  const floors = readFloors(join(dir, '.acc/floors.json'));
  writeFileSync(join(dir, '.acc/floors.json'), formatFloors({ ...floors, tests: { floor } }));
  writeFileSync(join(dir, `docs/decisions/new-${task}-${page}.md`), `## D-${task} The ${page} page (2026-10-22)\n\nDecided in D-${task}.\n`);
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', `${task}: the ${page} page`);
}

/** Its merge into main: its decisions numbered against main, then merged with real git, the driver on PATH. */
function land(dir: string, branch: string) {
  gitIn(dir, 'checkout', '-q', branch);
  assert.ok(numberDecisions(run, dir, 'main', (...args) => run('git', args, { cwd: dir })), `${branch} had a decision to number`);
  gitIn(dir, 'checkout', '-q', 'main');
  return run('git', ['merge', '--no-ff', '--no-edit', branch], { cwd: dir, env: ACC_ON_PATH });
}

test('two branches that each add a page, raise the tests floor and add a decision merge with no conflict, keeping both of each (T-102)', () => {
  const dir = makeRepo();
  for (const rel of SHARED) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    cpSync(join(ROOT, rel), join(dir, rel), { recursive: true });
  }
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'this repo\'s shared files');
  gitIn(dir, 'config', `merge.${FLOORS_DRIVER}.driver`, FLOORS_DRIVER_COMMAND);
  const before = { pages: pagesIn(readFileSync(join(dir, PAGES_FILE), 'utf8')), floor: readFloors(join(dir, '.acc/floors.json')).tests!.floor!, decisions: readDecisions(dir) };
  assert.ok(before.pages.length > 100 && before.decisions.length >= 195, 'the real files, copied');
  const top = before.decisions.at(-1)!.number;

  build(dir, 'task/T-901', 'T-901', 'tasks-alpha', before.floor + 3);
  build(dir, 'task/T-902', 'T-902', 'tasks-beta', before.floor + 5);
  const first = land(dir, 'task/T-901');
  assert.equal(first.code, 0, first.stdout + first.stderr);
  const second = land(dir, 'task/T-902');
  assert.equal(second.code, 0, `the second merge conflicted: ${second.stdout}${second.stderr}`);
  assert.equal(gitIn(dir, 'status', '--porcelain'), '', 'nothing left to resolve');

  const pages = pagesIn(readFileSync(join(dir, PAGES_FILE), 'utf8'));
  assert.deepEqual(pages.filter((p) => !before.pages.includes(p)), ['tasks-alpha', 'tasks-beta'], 'both pages, once each');
  assert.equal(pages.length, before.pages.length + 2);
  assert.equal(readFloors(join(dir, '.acc/floors.json')).tests!.floor, before.floor + 5, 'the higher floor');
  const after = readDecisions(dir);
  assert.deepEqual(after.slice(-2).map((e) => [e.number, e.file, e.title]), [[top + 1, `D-${top + 1}-tasks-alpha.md`, 'The tasks-alpha page'], [top + 2, `D-${top + 2}-tasks-beta.md`, 'The tasks-beta page']]);
  assert.equal(readFileSync(join(dir, 'docs/decisions', `D-${top + 2}-tasks-beta.md`), 'utf8'), `## D-${top + 2} The tasks-beta page (2026-10-22)\n\nDecided in D-${top + 2}.\n`);
  assert.equal(readFileSync(join(dir, DECISIONS_INDEX), 'utf8'), decisionsIndexFor(dir), 'the index, both rows in order, as the folder makes it');
});
