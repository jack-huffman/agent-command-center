// A person's edits of a task (T-74) in History and on the task page's activity, apart from its moves.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskRow } from '../src/logic/shared.ts';
import { homeModel } from '../src/model/home.ts';
import { EDIT_LOOK } from '../src/model/history.ts';
import { historyKind } from '../src/model/history-pages.ts';
import { ticketModel } from '../src/model/task-page.ts';
import { historyKind as pageKind } from '../webview/history-store.ts';
import { sampleEdits } from '../scripts/fixtures/history.ts';
import { hub } from './support.ts';

const at = (min: number) => new Date(Date.UTC(2026, 9, 19, 12, min)).toISOString();

const overview = (h: ReturnType<typeof hub>) => homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } }).overview;

test('History lists a person\'s edit apart from its task\'s moves, with the fields in words and who made it, under Tasks', () => {
  const h = hub();
  h.history = () => [{ at: at(0), task: 'AV-1', title: 'Task AV-1', from: null, to: 'todo', by: 'human:pat' }];
  h.edits = () => [{ at: at(5), task: 'AV-1', title: 'Task AV-1', fields: ['brief', 'notes'], by: 'human:pat' }];
  const o = overview(h);
  const [edit, move] = o.history.items;
  assert.deepEqual(edit, { kind: 'edit', id: 'edit:Acme|AV-1|' + at(5), at: at(5), project: 'Acme', task: 'AV-1', title: 'Task AV-1', fields: 'description, notes for the builder', by: 'human:pat', look: EDIT_LOOK }, 'newest first');
  assert.equal(move!.kind, 'move', 'the move is its own entry');
  assert.deepEqual([historyKind(edit!), pageKind(edit!)], ['move', 'move'], 'Tasks counts it, in the model and in the page\'s copy');
  assert.deepEqual([EDIT_LOOK.icon, EDIT_LOOK.label, EDIT_LOOK.tone], ['edit', 'Edited', 'neutral']);
  // The Overview's History card has a row for it, which opens its task.
  const row = o.landing.find((g) => g.key === 'history')!.all.find((r) => r.key === `h:${edit!.id}`)!;
  assert.equal(row.tip, 'Edited its description, notes for the builder, by pat');
  assert.deepEqual(row.open, { kind: 'task', project: '/r', key: 'AV-1' });
});

test('edge: a hub with no edits, or a project whose ledger isn\'t read yet, lists none', () => {
  const h = hub();
  h.history = () => [];
  assert.deepEqual(overview(h).history.items.filter((i) => i.kind === 'edit'), [], 'no edits method');
  h.edits = () => [];
  assert.deepEqual(overview(h).history.items.filter((i) => i.kind === 'edit'), [], 'an empty list');
  // The screenshot run's sample has one, so History's row is drawn.
  assert.deepEqual(sampleEdits(0).map((e) => [e.task, e.fields]), [['ACME-19', ['environment', 'notes']]]);
});

test('a task\'s page lists its edits, newest first, apart from its moves; edge: a task never edited has none', () => {
  const row = { id: 'T-1', title: 'Task T-1', state: 'todo', display: 'ready', environment: 'dev', deps: [], source: { kind: 'manual', url: null } } as unknown as TaskRow;
  const task = (edits?: object[]) => ({ id: 'T-1', title: 'Task T-1', brief: '', source: { kind: 'manual', key: 'T-1', url: null }, environment: 'dev', deps: [], labels: [], state: 'todo', blocker: null, run: null, pr: null,
    history: [{ at: at(0), from: null, to: 'todo', by: 'human:pat' }], ...(edits ? { edits } : {}), createdAt: at(0), updatedAt: at(0) }) as never;
  const page = (edits?: object[]) => ticketModel({ project: '/r', tracker: null, trackerTitle: null, trackerKind: 'manual', key: 'T-1', loading: false, error: null, connect: null, checks: [], ticket: null, row, task: task(edits) } as never).acc!;
  const p = page([{ at: at(1), actor: 'human', by: 'human:pat', fields: ['title'] }, { at: at(2), actor: 'human', by: 'human:sam', fields: ['labels', 'deps'] }]);
  assert.deepEqual(p.edits, [{ at: at(2), by: 'human:sam', fields: 'labels, dependencies' }, { at: at(1), by: 'human:pat', fields: 'title' }]);
  assert.equal(p.history.length, 1, 'its moves stay its moves');
  assert.deepEqual(page().edits, []);
});
