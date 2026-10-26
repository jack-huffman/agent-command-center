// The floors file's git merge driver (T-102): the three versions git hands it merged to the better of each
// floor, a relaxed floor left as git's conflict, and Setup's step that says when the driver is missing.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/exec.ts';
import { FLOORS_ATTRIBUTE, FLOORS_DRIVER, FLOORS_DRIVER_COMMAND, floorsDriverFix, floorsDriverSet, floorsDriverState, mergeFloorsFiles, runsFloorsMerge } from '../src/floors-driver.ts';
import { makeContext } from '../src/onboarding/helpers.ts';
import { MERGE_STEPS } from '../src/onboarding/merge-steps.ts';
import { STEPS } from '../src/onboarding/steps.ts';
import { formatFloors } from '../src/ratchets.ts';
import { GENERIC_CONFIG, gitIn, makeRepo, tempDir } from './support.ts';

const files = (common: object, ours: object, theirs: object) => {
  const dir = tempDir('floors-driver-');
  const [c, o, t] = ['common', 'ours', 'theirs'].map((n) => join(dir, n)) as [string, string, string];
  writeFileSync(c, formatFloors(common as never));
  writeFileSync(o, formatFloors(ours as never));
  writeFileSync(t, formatFloors(theirs as never));
  return { c, o, t };
};

test('two raised floors merge to the higher, written over ours', () => {
  const { c, o, t } = files({ tests: { floor: 100 } }, { tests: { floor: 104 } }, { tests: { floor: 107 }, 'screenshots.a11y': { floor: 9 } });
  assert.equal(mergeFloorsFiles(run, c, o, t), true);
  assert.deepEqual(JSON.parse(readFileSync(o, 'utf8')), { tests: { floor: 107 }, 'screenshots.a11y': { floor: 9 } });
});

test('a floor one side relaxed is a person\'s: false, with git\'s conflict markers in ours, not either side picked', () => {
  const relaxed = { tests: { floor: 90, relaxed: { by: 'human:jordan', reason: 'flaky suite moved out', at: '2026-10-22T00:00:00.000Z', was: 100 } } };
  const { c, o, t } = files({ tests: { floor: 100 } }, { tests: { floor: 104 } }, relaxed);
  assert.equal(mergeFloorsFiles(run, c, o, t), false);
  const text = readFileSync(o, 'utf8');
  assert.match(text, /^<<<<<<< ours$[\s\S]*"floor": 104[\s\S]*^=======$[\s\S]*"floor": 90[\s\S]*^>>>>>>> theirs$/m);
});

test('an edge case: a file both sides added, with no common version, still merges', () => {
  const dir = tempDir('floors-driver-');
  const o = join(dir, 'ours');
  const t = join(dir, 'theirs');
  writeFileSync(o, formatFloors({ tests: { floor: 3 } }));
  writeFileSync(t, formatFloors({ tests: { floor: 5 } }));
  assert.equal(mergeFloorsFiles(run, join(dir, 'missing'), o, t), true);
  assert.deepEqual(JSON.parse(readFileSync(o, 'utf8')), { tests: { floor: 5 } });
  assert.equal(mergeFloorsFiles(run, dir, dir, dir), false, 'and one that can\'t be read, such as a folder, merges nothing: a person decides');
});

test('the driver\'s state reads the clone\'s git config and .gitattributes, and the fix sets up only what\'s missing', () => {
  const dir = makeRepo();
  assert.deepEqual(floorsDriverState(run, dir), { configured: false, attributed: false });
  const fix = floorsDriverFix({ configured: false, attributed: false });
  assert.equal(run('sh', ['-c', fix], { cwd: dir }).code, 0);
  assert.deepEqual(floorsDriverState(run, dir), { configured: true, attributed: true });
  assert.equal(gitIn(dir, 'config', '--get', `merge.${FLOORS_DRIVER}.driver`), FLOORS_DRIVER_COMMAND);
  assert.equal(readFileSync(join(dir, '.gitattributes'), 'utf8'), `${FLOORS_ATTRIBUTE}\n`);
  assert.equal(floorsDriverFix({ configured: true, attributed: false }), `printf '${FLOORS_ATTRIBUTE}\\n' >> .gitattributes`);
  assert.equal(floorsDriverFix({ configured: true, attributed: true }), '');
});

test('Setup\'s step is registered among the safe defaults, skips a project with no floors, and fails with the fix when the driver is missing', () => {
  const step = MERGE_STEPS[0]!;
  const ids = STEPS.map((s) => s.id);
  assert.equal(ids.indexOf(step.id), ids.indexOf('B10.ignore-worktrees') + 1);
  const none = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  assert.deepEqual(step.check(makeContext(none, run)).status, 'skip');
  const dir = makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, gates: { ratchets: { tests: { command: 'echo 1', limit: 'floor', label: 'tests' } } } }) });
  const missing = step.check(makeContext(dir, run));
  assert.deepEqual([missing.status, missing.detail, missing.fix], ['fail', 'The floors file\'s merge driver isn\'t in this clone\'s git config or .gitattributes, so two raised floors conflict.', floorsDriverFix({ configured: false, attributed: false })]);
  run('sh', ['-c', missing.fix!], { cwd: dir });
  assert.equal(step.check(makeContext(dir, run)).status, 'pass');
  gitIn(dir, 'config', '--unset', `merge.${FLOORS_DRIVER}.driver`);
  assert.match(step.check(makeContext(dir, run)).detail, /isn't in this clone's git config, so/, 'a clone without the driver says so, though .gitattributes names it');
});

test('a driver that runs acc by a path counts as set up, and one that is some other command says this step replaces it', () => {
  assert.equal(runsFloorsMerge(FLOORS_DRIVER_COMMAND), true);
  assert.equal(runsFloorsMerge('/Users/jo/acc/plugin/bin/acc floors merge %O %A %B'), true);
  assert.equal(runsFloorsMerge('"/Users/jo/My Tools/acc" floors merge %O %A %B'), true);
  assert.equal(runsFloorsMerge('acc merge-floors %O %A %B'), false);
  assert.equal(runsFloorsMerge(''), false, 'and no driver at all is not one');
  const step = MERGE_STEPS[0]!;
  const dir = makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, gates: { ratchets: { tests: { command: 'echo 1', limit: 'floor', label: 'tests' } } } }) });
  gitIn(dir, 'config', `merge.${FLOORS_DRIVER}.driver`, '/opt/acc/bin/acc floors merge %O %A %B');
  writeFileSync(join(dir, '.gitattributes'), `${FLOORS_ATTRIBUTE}\n`);
  assert.equal(floorsDriverSet(run, dir), '/opt/acc/bin/acc floors merge %O %A %B');
  assert.equal(step.check(makeContext(dir, run)).status, 'pass', 'a driver by path passes');
  gitIn(dir, 'config', `merge.${FLOORS_DRIVER}.driver`, 'acc merge-floors %O %A %B');
  const old = step.check(makeContext(dir, run));
  assert.equal(old.status, 'fail');
  assert.match(old.detail, /"acc merge-floors %O %A %B", which doesn't run acc's floors merge\. This step replaces it with acc's/);
});
