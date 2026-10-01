import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { depsFromBody, githubIssuesToTasks } from '../src/intake.ts';
import { allowedMoves, emptyLedger, noGateHooks, upsertTasks } from '../src/ledger.ts';
import { GENERIC_CONFIG } from './support.ts';

test('dependencies come from "Depends on" and "Blocked by" lines', () => {
  assert.deepEqual(depsFromBody('Depends on #3'), ['#3']);
  assert.deepEqual(depsFromBody('Blocked by #4 and #5.\nalso depends on #6, #7'), ['#4', '#5', '#6', '#7']);
  assert.deepEqual(depsFromBody('Mentions #9 but depends on nothing'), []);
  assert.deepEqual(depsFromBody(null), []);
});

test('GitHub issues become tasks with ids, links, labels and dependencies', () => {
  const tasks = githubIssuesToTasks([
    { number: 3, title: 'M3 Dispatch', body: 'Depends on #2', url: 'https://github.com/o/r/issues/3', labels: [{ name: 'milestone' }] },
    { number: 2, title: 'M2 Walkthrough', body: null, url: 'https://github.com/o/r/issues/2' },
  ]);
  const config = parseConfig(JSON.parse(JSON.stringify(GENERIC_CONFIG))).config!;
  const l = emptyLedger();
  const r = upsertTasks(l, config, tasks, 'human', 'h', () => {}, () => new Date());
  assert.deepEqual(r.added, ['GH-3', 'GH-2']);
  assert.deepEqual(l.tasks[0]!.deps, ['GH-2']);
  assert.deepEqual(l.tasks[0]!.labels, ['milestone']);
  assert.equal(l.tasks[0]!.source.url, 'https://github.com/o/r/issues/3');
});

test('allowedMoves lists only moves the actor may make, with what would stop them', () => {
  const config = parseConfig(JSON.parse(JSON.stringify(GENERIC_CONFIG))).config!;
  const l = emptyLedger();
  upsertTasks(l, config, [{ source: { kind: 'manual' }, title: 'a' }, { source: { kind: 'manual' }, title: 'b', deps: ['T-1'] }], 'human', 'h', () => {}, () => new Date());
  const moves = allowedMoves(l, config, l.tasks[1]!, 'human', noGateHooks);
  assert.deepEqual(moves.map((m) => m.to), ['running', 'blocked']);
  assert.match(moves[0]!.problems.join(), /waiting on T-1/);
  assert.equal(moves[1]!.needsReason, true);
  assert.deepEqual(allowedMoves(l, config, l.tasks[0]!, 'builder', noGateHooks).map((m) => m.to), ['blocked']);
});
