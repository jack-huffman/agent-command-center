import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { keepChanges, mergeCommitPaths, mergedPaths, mergeOf, planAgainst, recordChanges } from '../src/changes.ts';
import { run } from '../src/exec.ts';
import { type LedgerEvent, mutate, readLedger, type Task } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { gitIn, makeRepo } from './support.ts';

const now = () => new Date('2026-10-22T12:00:00Z');
const BRANCH = 'task/T-1-x';

/** A repo with T-1's branch: it changes a.ts and adds lib/b.ts, and T-1 in review on it. */
function setup() {
  const dir = makeRepo({ 'a.ts': 'a\n', 'c.ts': 'c\n' });
  gitIn(dir, 'checkout', '-q', '-b', BRANCH);
  writeFileSync(join(dir, 'a.ts'), 'a2\n');
  mkdirSync(join(dir, 'lib'));
  writeFileSync(join(dir, 'lib', 'b.ts'), 'b\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'T-1: work');
  gitIn(dir, 'checkout', '-q', 'main');
  // main moves on with a change of its own, which is never the task's.
  writeFileSync(join(dir, 'c.ts'), 'c2\n');
  gitIn(dir, 'commit', '-q', '-am', 'main moves on');
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    l.tasks.push(task({ state: 'review', run: { branch: BRANCH } }));
    emit({ type: 'task.added', task: 'T-1', actor: 'human', by: 'test', data: {} });
  });
  return { dir, paths };
}

function task(extra: Partial<Task> = {}): Task {
  return { id: 'T-1', title: 'x', brief: '', source: { kind: 'manual', key: null, url: null }, environment: 'main', deps: [], labels: [], state: 'todo', blocker: null, run: null, pr: null, history: [], createdAt: '', updatedAt: '', ...extra };
}

const first = (paths: ReturnType<typeof repoPaths>) => readLedger(paths.ledger).tasks[0]!;

test('before it merges, a task\'s changes are what its branch committed since it left its environment\'s branch (T-99)', () => {
  const s = setup();
  assert.deepEqual(mergedPaths(run, s.dir, first(s.paths)), ['a.ts', 'lib/b.ts'], 'not main\'s own change to c.ts');
});

test('after a merge commit, the merge commit says what the branch brought, whether acc knows it or git finds it (T-99)', () => {
  const s = setup();
  gitIn(s.dir, 'merge', '-q', '--no-ff', '-m', 'Merge T-1', BRANCH);
  const merge = gitIn(s.dir, 'rev-parse', 'HEAD');
  assert.deepEqual(mergeCommitPaths(run, s.dir, merge), ['a.ts', 'lib/b.ts']);
  assert.equal(mergeOf(run, s.dir, `refs/heads/${BRANCH}`, 'main'), merge, 'the oldest merge that descends from the branch');
  assert.deepEqual(mergedPaths(run, s.dir, first(s.paths)), ['a.ts', 'lib/b.ts'], 'merged into main: the branch alone says nothing, so the merge commit does');
  // Its branch deleted after the merge, the pull request's merge commit still says it.
  gitIn(s.dir, 'branch', '-q', '-D', BRANCH);
  assert.deepEqual(mergedPaths(run, s.dir, { ...first(s.paths), pr: { number: 1, url: 'u', state: 'merged', mergeSha: merge } }), ['a.ts', 'lib/b.ts']);
});

test('a squash merge is one commit with one parent: what changed from its parent (T-99)', () => {
  const s = setup();
  gitIn(s.dir, 'merge', '-q', '--squash', BRANCH);
  gitIn(s.dir, 'commit', '-q', '-m', 'T-1 (squashed)');
  assert.deepEqual(mergeCommitPaths(run, s.dir, gitIn(s.dir, 'rev-parse', 'HEAD')), ['a.ts', 'lib/b.ts']);
});

test('edge case: a branch git doesn\'t have, a commit it doesn\'t know and no merge to find say nothing, and nothing is kept (T-99)', () => {
  const s = setup();
  assert.equal(mergeCommitPaths(run, s.dir, 'f'.repeat(40)), null);
  assert.equal(mergeOf(run, s.dir, `refs/heads/${BRANCH}`, 'main'), null, 'not merged yet');
  assert.equal(mergedPaths(run, s.dir, task({ run: { branch: 'task/nowhere' } })), null);
  assert.equal(mergedPaths(run, s.dir, task()), null, 'no branch and no pull request');
  assert.equal(recordChanges(s.paths, run, now, 'T-9', { actor: 'human', by: 'test' }), null, 'no such task');
  mutate(s.paths, now, (l, emit) => { l.tasks[0]!.run = { branch: 'task/nowhere' }; emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'test', data: {} }); });
  assert.equal(recordChanges(s.paths, run, now, 'T-1', { actor: 'human', by: 'test' }), null);
  assert.equal(first(s.paths).changes, undefined, 'nothing written');
});

test('a person\'s merge keeps the changes with the task, as an event, and a later record that finds none leaves them (T-99)', () => {
  const s = setup();
  gitIn(s.dir, 'merge', '-q', '--no-ff', '-m', 'Merge T-1', BRANCH);
  const kept = recordChanges(s.paths, run, now, 'T-1', { actor: 'human', by: 'human:jordan' });
  assert.deepEqual(kept, { at: now().toISOString(), paths: ['a.ts', 'lib/b.ts'] });
  assert.deepEqual(first(s.paths).changes, kept);
  const events: LedgerEvent[] = [];
  const t = first(s.paths);
  assert.equal(keepChanges(t, [], 'later', (e) => events.push({ ...e, seq: 0, at: '' }), { actor: 'sync', by: 'acc sync' }), false, 'none to keep');
  assert.equal(keepChanges(t, null, 'later', (e) => events.push({ ...e, seq: 0, at: '' }), { actor: 'sync', by: 'acc sync' }), false, 'git couldn\'t say');
  assert.deepEqual([t.changes, events], [kept, []], 'what it kept before stands, and nothing is said');
  assert.equal(keepChanges(t, ['x.ts'], 'later', (e) => events.push({ ...e, seq: 0, at: '' }), { actor: 'sync', by: 'acc sync' }), true);
  assert.deepEqual(events.map((e) => [e.type, e.by, e.data]), [['task.updated', 'acc sync', { changes: { at: 'later', paths: ['x.ts'] } }]]);
});

test('planned against actual: in the plan, outside it, and planned and not changed; a planned folder holds its files (T-99)', () => {
  assert.deepEqual(planAgainst(['a.ts', 'lib', 'gone.ts'], ['a.ts', 'lib/b.ts', 'extra.ts']), [
    { path: 'a.ts', mark: 'planned' },
    { path: 'lib/b.ts', mark: 'planned' },
    { path: 'extra.ts', mark: 'unplanned' },
    { path: 'gone.ts', mark: 'unmade' },
  ]);
});

test('edge case: with no plan nothing is outside it, and with no changes every planned path is not made yet (T-99)', () => {
  assert.deepEqual(planAgainst(null, ['a.ts']), [{ path: 'a.ts', mark: 'changed' }]);
  assert.deepEqual(planAgainst(['a.ts'], []), [{ path: 'a.ts', mark: 'unmade' }]);
  assert.deepEqual(planAgainst(null, []), []);
});
