// A Jira board's sprint change, after it loads (T-78): what acc keeps, and the Overview's line (logic/sprint-change.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LeftAlone } from '../../packages/core/src/intake.ts';
import type { SprintSeen } from '../../packages/core/src/sprints.ts';
import type { BoardCard, Sprint } from '../../packages/core/src/trackers/types.ts';
import { lookAtSprint, sprintLine } from '../src/logic/sprint-change.ts';

const NOW = new Date('2026-10-20T09:00:00Z');
const sprint = (id: number, name: string): Sprint => ({ id, name, state: 'active', start: null, end: null });
const card = (key: string, category: 'todo' | 'doing' | 'done' = 'todo'): BoardCard => ({ key, title: key, url: '', status: { id: '1', name: category, category }, type: null, typeKind: null, typeColor: null, assignees: [], labels: [], priority: null, priorityLevel: null });
const prev: SprintSeen = { sprints: [{ id: 12, name: 'Sprint 12' }], open: ['ACME-1', 'ACME-2', 'ACME-3', 'ACME-4'], at: '2026-10-19T17:00:00.000Z' };
const left = (task: string, issue = task): LeftAlone => ({ task, issue, state: 'running', note: `${issue} left this repo's place: it isn't in the active sprint; ${task} is still running` });

test('a new sprint is told once with its counts, and a started task that went back to the backlog is named and stays (T-78)', async () => {
  const asked: string[][] = [];
  const client = { stillOpen: async (keys: string[]) => { asked.push(keys); return keys.filter((k) => k !== 'ACME-4'); } };
  const look = await lookAtSprint(prev, { sprints: [sprint(13, 'Sprint 13')], cards: [card('ACME-1'), card('ACME-2', 'doing'), card('ACME-9', 'done')] }, client, NOW);
  assert.deepEqual(asked, [['ACME-3', 'ACME-4']], 'only the old sprint\'s open tickets the board no longer shows');
  assert.deepEqual(look!.seen, { sprints: [{ id: 13, name: 'Sprint 13' }], open: ['ACME-1', 'ACME-2'], at: NOW.toISOString() }, 'a done card isn\'t open');
  assert.equal(look!.moved, true);
  assert.deepEqual([look!.change!.carried, look!.change!.backlog], [['ACME-1', 'ACME-2'], ['ACME-3']], 'ACME-4 was done in time: neither');
  assert.equal(sprintLine(look!, [left('ACME-3'), left('ACME-18')]),
    'Sprint 13 started after Sprint 12: 2 tickets carried into it, 1 went back to the backlog. ACME-3 left the sprint after work started, so it stays on My work.',
    'a task that left for another reason isn\'t named here');
  assert.equal(sprintLine(look!, []), 'Sprint 13 started after Sprint 12: 2 tickets carried into it, 1 went back to the backlog.', 'no started task: no names');
});

test('a first look, the same sprint, or a board not in a sprint tells nothing; a failed read counts none gone back (T-78)', async () => {
  const never = { stillOpen: async (): Promise<string[]> => { throw new Error('asked'); } };
  const first = await lookAtSprint(undefined, { sprints: [sprint(12, 'Sprint 12')], cards: [card('ACME-1')] }, never, NOW);
  assert.deepEqual([first!.moved, first!.change, sprintLine(first!, [])], [true, null, null], 'a first look is kept, and says nothing');
  const same = await lookAtSprint(prev, { sprints: [sprint(12, 'Sprint 12')], cards: prev.open.map((k) => card(k)) }, never, NOW);
  assert.deepEqual([same!.moved, same!.change], [false, null], 'the same sprint and tickets: nothing to keep, nothing to tell');
  assert.equal(await lookAtSprint(prev, { cards: [card('ACME-1')] }, never, NOW), null, 'a board not held to a sprint');

  const failed = await lookAtSprint(prev, { sprints: [], cards: [] }, never, NOW);
  assert.deepEqual([failed!.change!.carried, failed!.change!.backlog], [[], []], 'the tracker couldn\'t say: none counted');
  assert.match(sprintLine(failed!, [])!, /^Sprint 12 ended, and no sprint is active now: 0 tickets carried into a new sprint, 0 went back/);
  const cannot = await lookAtSprint(prev, { sprints: [sprint(13, 'Sprint 13')], cards: [] }, {}, NOW);
  assert.deepEqual(cannot!.change!.backlog, [], 'a tracker without stillOpen counts none');
});
