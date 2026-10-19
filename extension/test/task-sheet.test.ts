// The task sheet (T-74): what it shows for a new task, a manual task and a tracker's task, acc's arguments
// for what a person wrote, Edit off with its reason, and opening it over the page that asked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editRefusal } from '../../packages/core/src/edit.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import type { TaskRow } from '../src/logic/shared.ts';
import { cardActions } from '../src/model/cards.ts';
import { area, TASK_SHEET_MESSAGE, taskSheet, taskSheetArgs, type TaskSheetChoice, type TaskSheetInput, taskSheetOff } from '../src/model/task-sheet.ts';
import { openTaskSheet, taskSheetInput } from '../src/task-sheet.ts';
import { row } from './support.ts';

const ENVS = [{ name: 'Production', branch: 'main', protected: true }, { name: 'Dev', branch: 'dev', default: true }, { name: 'UAT', branch: 'uat' }];
const manual = (more: Partial<Task> = {}): TaskSheetInput['task'] => ({
  id: 'T-3', title: 'Add a report', brief: '## Goal\n\nA report.', deps: ['T-1'], environment: 'dev', labels: ['ui'], notes: '', source: { kind: 'manual', key: null, url: null }, state: 'todo', ...more,
});
const jira = (more: Partial<Task> = {}): TaskSheetInput['task'] => ({
  ...manual(), id: 'ACME-7', title: 'From Jira', brief: 'Jira text', deps: [], labels: ['j'], source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.example/browse/ACME-7' }, ...more,
});
const input = (task: TaskSheetInput['task'] = null): TaskSheetInput => ({ project: '/r', name: 'Tool', environments: ENVS, task });
const filled = (i: TaskSheetInput): TaskSheetChoice => taskSheet(i)!.fields;

test('the sheet for a new task: its heading, Add task, empty fields on the default environment, no protected ones, and no notes', () => {
  const s = taskSheet(input())!;
  assert.deepEqual([s.project, s.task, s.heading, s.go, s.notes, s.locked, s.ticket], ['/r', null, 'New task in Tool', 'Add task', false, null, null]);
  assert.deepEqual(s.fields, { title: '', brief: '', deps: '', environment: 'dev', labels: '', notes: '' });
  assert.deepEqual(s.environments, [{ value: 'dev', label: 'Dev' }, { value: 'uat', label: 'UAT' }], 'Production is protected: no task builds on it');
  assert.equal(taskSheet({ ...input(), environments: [] })!.fields.environment, '', 'edge: a project with no environment to offer');
  assert.equal(TASK_SHEET_MESSAGE, 'task-sheet');
});

test('the sheet for a manual task: Edit, Save, every field filled in, notes, and nothing read-only', () => {
  const s = taskSheet(input(manual({ notes: 'Mind the cache.' })))!;
  assert.deepEqual([s.task, s.heading, s.go, s.notes, s.locked, s.ticket], ['T-3', 'Edit T-3', 'Save', true, null, null]);
  assert.deepEqual(s.fields, { title: 'Add a report', brief: '## Goal\n\nA report.', deps: 'T-1', environment: 'dev', labels: 'ui', notes: 'Mind the cache.' });
});

test('the sheet for a tracker\'s task: its own fields read-only with why, a way to open the ticket, and its environment and notes a person\'s', () => {
  const s = taskSheet(input(jira()))!;
  assert.match(s.locked!, /Jira ticket owns its title, description, dependencies and labels/);
  assert.deepEqual(s.ticket, { url: 'https://acme.example/browse/ACME-7', label: 'Open in Jira' });
  assert.equal(s.notes, true);
  assert.equal(taskSheet(input(jira({ source: { kind: 'jira', key: 'ACME-7', url: null } })))!.ticket, null, 'edge: a ticket with no link has nothing to open');
});

test('a task whose builder runs, or that is done, has no sheet, and its Edit is off with the reason (edge: refused states)', () => {
  let checked = 0;
  for (const state of ['running', 'done'] as const) {
    assert.equal(taskSheet(input(manual({ state }))), null, state);
    const edit = cardActions({ ...row('T-3', state, state), deps: [] } as TaskRow, { project: '/r', task: 'T-3' }).find((a) => a.command === 'acc.task.edit')!;
    assert.equal(edit.disabled, editRefusal({ state }), state);
    assert.ok(edit.disabled && !/\bacc\b/.test(edit.disabled), 'in words, with no command');
    checked++;
  }
  assert.equal(checked, 2);
  const todo = cardActions({ ...row('T-3', 'todo', 'ready'), deps: [] } as TaskRow, { project: '/r', task: 'T-3' }).find((a) => a.command === 'acc.task.edit')!;
  assert.deepEqual([todo.label, todo.icon, todo.disabled], ['Edit', 'edit', undefined]);
});

test('a new task\'s arguments: acc add with its title, description, dependencies, environment and labels, each as --flag=value', () => {
  const c: TaskSheetChoice = { title: ' -Rename the field ', brief: '- one\n- two', deps: 'T-1, acme-2,', environment: 'uat', labels: 'ui, ui, docs', notes: '' };
  assert.deepEqual(taskSheetArgs(input(), c), ['add', '--title=-Rename the field', '--brief=- one\n- two', '--dep=T-1', '--dep=acme-2', '--env=uat', '--label=ui', '--label=docs']);
  assert.deepEqual(taskSheetArgs(input(), { ...c, brief: ' ', deps: '', labels: '', environment: '' }), ['add', '--title=-Rename the field'], 'edge: empty fields send nothing');
});

test('an edit\'s arguments: only the fields that changed, a list cleared as an empty flag, and nothing when nothing changed', () => {
  const i = input(manual());
  assert.deepEqual(taskSheetArgs(i, filled(i)), [], 'edge: nothing changed');
  assert.deepEqual(taskSheetArgs(i, { ...filled(i), title: 'Add a better report', notes: 'n' }), ['edit', 'T-3', '--title=Add a better report', '--notes=n']);
  assert.deepEqual(taskSheetArgs(i, { ...filled(i), deps: '', labels: '' }), ['edit', 'T-3', '--dep=', '--label='], 'edge: a list emptied clears it');
  assert.deepEqual(taskSheetArgs(i, { ...filled(i), deps: 't-1' }), [], 'a dependency\'s case is no change');
  assert.deepEqual(taskSheetArgs(i, { ...filled(i), environment: 'uat', brief: 'New' }), ['edit', 'T-3', '--brief=New', '--env=uat']);
});

test('a tracker task\'s edit sends none of the fields its ticket owns', () => {
  const i = input(jira());
  assert.deepEqual(taskSheetArgs(i, { ...filled(i), title: 'Mine', brief: 'Mine', deps: 'X-1', labels: 'mine', environment: 'uat', notes: 'Ask first.' }), ['edit', 'ACME-7', '--env=uat', '--notes=Ask first.']);
});

test('Save is off without a title, and the page\'s message is checked before the extension acts on it', () => {
  assert.equal(taskSheetOff({ title: '  ' }), 'A task needs a title');
  assert.equal(taskSheetOff({ title: 'x' }), null);
  const ok = area.messages!['task-sheet-go']!;
  const m = { project: '/r', title: 'T', brief: '', deps: '', environment: 'dev', labels: '', notes: '' };
  assert.equal(ok(m), true);
  assert.equal(ok({ ...m, task: 'T-3' }), true);
  assert.equal(ok({ ...m, task: 'not a key' }), false);
  assert.equal(ok({ ...m, title: '' }), false, 'edge: no title');
  assert.equal(ok({ ...m, notes: 1 }), false);
  assert.deepEqual(area.commands, ['acc.task.edit']);
});

test('taskSheetInput and openTaskSheet: a project or task that isn\'t there opens nothing, and say posts to the page that asked, else the Command Center', () => {
  const task = { ...manual(), history: [], createdAt: '', updatedAt: '', blocker: null, run: null, pr: null } as unknown as Task;
  const hub = { project: (r: string) => (r === '/r' ? { name: 'Tool', config: { environments: ENVS } } : undefined), ledger: () => ({ schema: 1, seq: 0, tasks: [task] }) } as never;
  const told: { type: string; sheet: { task: string | null } }[] = [];
  const said: typeof told = [];
  const panels = { tell: async (m: unknown) => { told.push(m as (typeof told)[number]); } };
  assert.equal(taskSheetInput(hub, '/nowhere', null), null, 'no such project');
  assert.equal(taskSheetInput(hub, '/r', 'T-9'), null, 'no such task');
  assert.equal(taskSheetInput(hub, '/r', 't-3')?.task?.id, 'T-3', 'ids are case-insensitive');
  assert.equal(openTaskSheet(hub, panels, '/r', 'T-9'), false);
  assert.equal(told.length, 0);
  assert.equal(openTaskSheet(hub, panels, '/r', null), true);
  assert.deepEqual([told[0]!.type, told[0]!.sheet.task], [TASK_SHEET_MESSAGE, null], 'a new task, over the Command Center');
  assert.equal(openTaskSheet(hub, panels, '/r', 'T-3', (m) => said.push(m as (typeof said)[number])), true);
  assert.deepEqual([told.length, said[0]!.sheet.task], [1, 'T-3'], 'the page that asked');
  (task as { state: string }).state = 'running';
  assert.equal(openTaskSheet(hub, panels, '/r', 'T-3'), false, 'edge: a task whose builder runs opens nothing');
});
