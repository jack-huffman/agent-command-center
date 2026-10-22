// acc floors merge and acc decisions (merging.ts, T-102): git's merge driver for the floors file run by a
// real git merge, and a branch's decisions numbered and indexed from the command line.
// acc runs from its source, in throwaway repos (support.ts).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FLOORS_ATTRIBUTE, FLOORS_DRIVER, FLOORS_DRIVER_COMMAND, formatFloors, run } from '../../core/src/index.ts';
import { fakeBin, gitIn } from '../../core/test/support.ts';
import { cli, repoWithConfig } from './support.ts';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const acc = cli(MAIN);
/** `acc` on PATH as git finds it when it runs the driver: this source, as a person's install would run it. */
const ACC_ON_PATH = fakeBin('acc', `exec "${process.execPath}" --no-warnings "${MAIN}" "$@"\n`);

const write = (dir: string, files: Record<string, string>, message = 'change') => {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', message);
};
const floors = (n: number) => formatFloors({ tests: { floor: n } });

/** Two branches from one base, each raising the tests floor, merged with real git. */
function raisedTwice(driver: boolean, theirs = floors(107)) {
  const dir = repoWithConfig();
  write(dir, { '.acc/floors.json': floors(100), '.gitattributes': `${FLOORS_ATTRIBUTE}\n` });
  if (driver) gitIn(dir, 'config', `merge.${FLOORS_DRIVER}.driver`, FLOORS_DRIVER_COMMAND);
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-2');
  write(dir, { '.acc/floors.json': theirs });
  gitIn(dir, 'checkout', '-q', 'main');
  write(dir, { '.acc/floors.json': floors(104) });
  const merged = run('git', ['merge', '--no-edit', 'task/T-2'], { cwd: dir, env: ACC_ON_PATH });
  return { dir, merged };
}

test('with the driver, two branches that raised the floor merge with no conflict, to the higher', () => {
  const { dir, merged } = raisedTwice(true);
  assert.equal(merged.code, 0, merged.stderr + merged.stdout);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.acc/floors.json'), 'utf8')), { tests: { floor: 107 } });
});

test('without the driver in git config, the same merge conflicts, as before: git never picks a side', () => {
  const { merged } = raisedTwice(false);
  assert.notEqual(merged.code, 0);
  assert.match(merged.stdout, /CONFLICT \(content\): Merge conflict in \.acc\/floors\.json/);
});

test('with the driver, a floor one side relaxed still conflicts, for a person', () => {
  const relaxed = formatFloors({ tests: { floor: 90, relaxed: { by: 'human:jordan', reason: 'a suite moved out', at: '2026-10-22T00:00:00.000Z', was: 100 } } });
  const { dir, merged } = raisedTwice(true, relaxed);
  assert.notEqual(merged.code, 0);
  assert.match(readFileSync(join(dir, '.acc/floors.json'), 'utf8'), /^<<<<<<< ours$/m);
});

test('acc floors merge refuses anything but the three files git hands it', () => {
  const r = acc(repoWithConfig(), ['floors', 'merge', 'a', 'b']);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /acc floors merge <common> <ours> <theirs>: git runs it, with %O %A %B\./);
});

test('acc decisions number numbers a branch\'s new decision against main; a builder can\'t run it', () => {
  const dir = repoWithConfig();
  write(dir, { 'docs/decisions/D-001-sums.md': '## D-001 Sums (2026-10-01)\n' });
  assert.equal(acc(dir, ['decisions', 'index']).code, 0);
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'index');
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-3');
  write(dir, { 'docs/decisions/new-T-3-merges.md': '## D-T-3 Merges (2026-10-22)\n', 'README.md': 'See D-T-3.\n' });
  const refused = acc(dir, ['decisions', 'number'], undefined, { ACC_ROLE: 'builder' });
  assert.match(refused.err, /A builder can't number decisions; the merge does that\. A person does that\./);
  assert.equal(acc(dir, ['decisions', 'check']).code, 0, 'a new decision has no row yet, so the index is current');
  const r = acc(dir, ['decisions', 'number', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json().base, r.json().numbered.map((n: { id: string }) => n.id)], ['main', ['D-002']]);
  assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), 'See D-002.\n');
  assert.equal(acc(dir, ['decisions', 'check']).code, 0, 'the numbering wrote the index again');
  assert.match(acc(dir, ['decisions', 'number']).out, /This branch adds no decision for its merge into main to number\./, 'an edge case: numbered once, nothing is left');
});

test('on main at a merge a person made, acc decisions number counts against main before it: a number taken since is numbered again (T-102)', () => {
  const dir = repoWithConfig();
  write(dir, { 'docs/decisions/D-001-sums.md': '## D-001 Sums (2026-10-01)\n', '.gitattributes': 'docs/DECISIONS.md merge=union\n' });
  assert.equal(acc(dir, ['decisions', 'index']).code, 0);
  write(dir, {}, 'index');
  for (const [task, slug] of [['T-3', 'apples'], ['T-4', 'pears']] as const) {
    gitIn(dir, 'checkout', '-q', '-b', `task/${task}`, 'main');
    write(dir, { [`docs/decisions/new-${task}-${slug}.md`]: `## D-${task} ${slug} (2026-10-22)\n` });
    assert.deepEqual(acc(dir, ['decisions', 'number', '--json']).json().numbered.map((n: { id: string }) => n.id), ['D-002'], 'each numbered before either merged');
  }
  gitIn(dir, 'checkout', '-q', 'main');
  gitIn(dir, 'merge', '-q', '--no-ff', '-m', 'Merge T-3', 'task/T-3');
  gitIn(dir, 'merge', '-q', '--no-ff', '-m', 'Merge T-4', 'task/T-4');
  const first = gitIn(dir, 'rev-parse', 'HEAD^1');
  assert.notEqual(acc(dir, ['decisions', 'check']).code, 0, 'merged as it was, the check fails on one number twice');
  const r = acc(dir, ['decisions', 'number', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json().base, r.json().numbered.map((n: { was: string; id: string }) => `${n.was} is ${n.id}`)], [first, ['D-002 is D-003']]);
  assert.equal(acc(dir, ['decisions', 'check']).code, 0);
});

test('acc decisions check fails on a stale index, and index writes it; a repo with no folder is refused', () => {
  const dir = repoWithConfig();
  write(dir, { 'docs/decisions/D-001-sums.md': '## D-001 Sums (2026-10-01)\n' });
  const stale = acc(dir, ['decisions', 'check']);
  assert.equal(stale.code, 1);
  assert.match(stale.out, /docs\/DECISIONS\.md is stale: acc decisions index writes it again\./);
  assert.match(acc(dir, ['decisions', 'index']).out, /Wrote docs\/DECISIONS\.md from docs\/decisions\//);
  assert.equal(acc(dir, ['decisions', 'check']).code, 0);
  assert.match(acc(repoWithConfig(), ['decisions', 'index']).err, /keeps no docs\/decisions\/ folder/);
});
