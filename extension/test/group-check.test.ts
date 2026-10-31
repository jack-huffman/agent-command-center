// In review's Check together (T-165): its count and its enabled rule, the group's step while it runs, and each
// task's latest step on its card and its page.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { GroupMark } from '../../packages/core/src/ledger.ts';
import type { TaskRow } from '../src/logic/shared.ts';
import { area, GROUP_LOOK, groupLook, lastGroupLook, readyForGroup, togetherFor } from '../src/model/group-check.ts';
import { tasksModel } from '../src/model/tasks.ts';
import { envs, hub, row } from './support.ts';

const mark = (outcome: GroupMark['outcome'], words: string): GroupMark => ({ group: 'devbox@1', env: 'devbox', with: [], outcome, words, at: '2026-10-30T12:00:00Z' });
const reviewed = (id: string, current = true, more: Partial<TaskRow> = {}): TaskRow => ({ ...row(id, 'review', 'review'), review: { verdict: 'pass', summary: 'Fine.', current }, ...more });
const config = { environments: envs };

test('Check together counts the tasks whose review passed on their latest commit, and runs the command for that environment', () => {
  const [t] = togetherFor('/r', config, [reviewed('AV-1'), reviewed('AV-2'), reviewed('AV-3', false), row('AV-4', 'running', 'running')]);
  assert.equal(t!.action.label, 'Check together (2)');
  assert.equal(t!.action.command, 'acc.task.checkTogether');
  assert.deepEqual(t!.action.ref, { project: '/r', env: 'devbox' });
  assert.equal(t!.action.disabled, undefined);
  assert.equal(t!.progress, null, 'before any group check runs, no step shows');
  assert.deepEqual(area.commands, ['acc.task.checkTogether'], 'the page may ask for it');
});

test('one task ready: Check together is off and says why, never a button that does nothing', () => {
  const [t] = togetherFor('/r', config, [reviewed('AV-1'), reviewed('AV-2', false)]);
  assert.equal(t!.action.label, 'Check together (1)');
  assert.match(t!.action.disabled!, /takes 2 or more tasks/);
});

test('a protected environment\'s tasks: off, since a person merges there', () => {
  const [t] = togetherFor('/r', config, [reviewed('AV-1', true, { environment: 'production' }), reviewed('AV-2', true, { environment: 'production' })]);
  assert.match(t!.action.disabled!, /Production is protected/);
});

test('a group under way: its step shows, in blue with a spinner, and the button is off until it ends', () => {
  const live = { groupChecks: [mark('checking', 'Checking with AV-2: running the full check')] };
  const [t] = togetherFor('/r', config, [reviewed('AV-1', true, live), reviewed('AV-2', true, live), reviewed('AV-3')]);
  assert.deepEqual(t!.progress, { label: 'Checking AV-1 and AV-2 together for Devbox: running the full check', icon: 'sync~spin', tone: 'blue' });
  assert.match(t!.action.disabled!, /under way/);
});

test('no task in review: no Check together at all', () => {
  assert.deepEqual(togetherFor('/r', config, [row('AV-1', 'running', 'running')]), []);
});

test('each task shows its latest step in its own words; one never in a group shows nothing', () => {
  assert.equal(lastGroupLook({ groupChecks: [] }), null);
  assert.equal(lastGroupLook({}), null);
  const look = lastGroupLook({ groupChecks: [mark('checking', 'x'), mark('sent-back', 'Sent back: its change fails extension/test/where.test.ts')] })!;
  assert.deepEqual(look, { label: 'Sent back: its change fails extension/test/where.test.ts', icon: GROUP_LOOK['sent-back'].icon, tone: 'orange' });
  assert.equal(groupLook(mark('merged', 'Checked with AV-2: passed, and merged into devbox as abc1234')).tone, 'blue');
  assert.equal(readyForGroup({ state: 'review', review: null }), false, 'a task with no review yet isn\'t ready');
});

test('the Board\'s In review lane carries Check together, and each card its latest group step', () => {
  const h = hub();
  const rows = [reviewed('AV-1', true, { groupChecks: [mark('passed', 'Checked with AV-2: passed')] }), reviewed('AV-2')];
  const m = tasksModel({ ...h, taskRows: () => rows });
  const lane = m.projects[0]!.columns.find((c) => c.group === 'review')!;
  assert.equal(lane.together?.[0]?.action.label, 'Check together (2)');
  assert.equal(lane.cards.find((c) => c.id === 'AV-1')!.group?.label, 'Checked with AV-2: passed');
  assert.equal(lane.cards.find((c) => c.id === 'AV-2')!.group, null);
  assert.equal(m.projects[0]!.columns.find((c) => c.group === 'running')!.together, undefined, 'only In review has it');
});
