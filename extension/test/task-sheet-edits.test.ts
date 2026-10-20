// The task sheet where the project allows edits (T-80): a tracker task's title and description are boxes
// only where its tracker says "edits": true and acc can write its ticket, filled in from the ticket; where
// edits are off they stay read-only and say the project's settings turn edits on. Its status, assignee and
// labels show with a Change. The description on the task page has Edit by the same rule. A description
// that holds what can't be written back is shown read-only, with a warning naming what.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Task } from '../../packages/core/src/ledger.ts';
import { textRefusal, type Ticket } from '../../packages/core/src/trackers/types.ts';
import { editTextAction, ticketModel } from '../src/model/task-page.ts';
import { textChanges } from '../src/model/ticket-text.ts';
import {
  area, EDITS_OFF, openTaskSheet, type SheetTicket, sheetLock, TASK_SHEET_DONE, TASK_SHEET_MESSAGE, TASK_SHEET_ROWS, taskSheet, taskSheetArgs, type TaskSheetInput, unkeptWarning,
} from '../src/model/task-sheet.ts';

const ENVS = [{ name: 'Dev', branch: 'dev', default: true }];
type Sheeted = NonNullable<TaskSheetInput['task']>;
const jira = (more: Partial<Sheeted> = {}): Sheeted => ({
  id: 'ACME-7', title: 'As intake brought it', brief: 'Old text', deps: ['ACME-2'], environment: 'dev', labels: ['j'], notes: '',
  source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.example/browse/ACME-7' }, state: 'todo', ...more,
});
const ticket: SheetTicket['ticket'] = {
  title: 'As the ticket says now', markdown: 'New text', status: { id: '3', name: 'In Progress', category: 'doing' }, assignees: [{ id: 'a', name: 'Pat Lee' }], labels: [{ name: 'email', color: null }],
};
const side = (more: Partial<SheetTicket> = {}): SheetTicket => ({ edits: true, kind: 'jira', ticket, error: null, ...more });
const input = (task: Sheeted | null, st?: SheetTicket | null): TaskSheetInput => ({ project: '/r', name: 'Tool', environments: ENVS, task, ...(st !== undefined ? { ticket: st } : {}) });

test('edits on: the title and description come from the ticket and are the person\'s to change, with its status, assignee and labels', () => {
  const s = taskSheet(input(jira(), side()))!;
  assert.deepEqual(s.ticketEdits?.base, { title: 'As the ticket says now', markdown: 'New text' }, 'what Save checks the ticket against');
  assert.deepEqual([s.fields.title, s.fields.brief], ['As the ticket says now', 'New text'], 'the ticket as it is now, not as intake last brought it in');
  assert.deepEqual(s.ticketEdits!.rows.map((r) => [r.field, r.value]), [['status', 'In Progress'], ['assign', 'Pat Lee'], ['labels', 'email']]);
  assert.match(s.locked!, /Save writes its title and description to its Jira ticket\. Its dependencies come from the ticket/);
  assert.equal(s.fields.deps, 'ACME-2', 'its dependencies stay as intake gave them');
  assert.deepEqual(taskSheet(input(jira(), side({ fields: ['status'] })))!.ticketEdits!.rows.map((r) => r.field), ['status'], 'only the fields its tracker has');
});

test('edge: a description that holds mentions and attachments warns before Save, naming them, and only the title is Save\'s to write', () => {
  const s = taskSheet(input(jira(), side({ ticket: { ...ticket!, unkept: ['mentions', 'attachments'] } })))!;
  assert.equal(s.ticketEdits!.unkept, unkeptWarning(['mentions', 'attachments']));
  assert.match(s.ticketEdits!.unkept!, /holds mentions and attachments, which acc can't write back without losing.*Save still writes its title\./);
  assert.match(s.locked!, /^Save writes its title to its Jira ticket\./);
  assert.deepEqual(s.ticketEdits!.base, { title: 'As the ticket says now', markdown: 'New text' }, 'Save still checks against the ticket');
  // The description is shown kept, so the sheet sends it as it opened, and Save writes only the title.
  assert.deepEqual(textChanges(s.ticketEdits!.base!, { title: 'A new title', markdown: s.fields.brief }), { title: 'A new title' });
  const plain = taskSheet(input(jira(), side({ ticket: { ...ticket!, unkept: [] } })))!;
  assert.deepEqual([plain.ticketEdits!.unkept, unkeptWarning(undefined)], [null, null], 'a plain description: no warning');
  assert.match(plain.locked!, /title and description/);
  const azure = taskSheet(input(jira({ id: 'AB-7', source: { kind: 'azure', key: 'AB-7', url: null } }), side({ kind: 'azure', ticket: { ...ticket!, unkept: ['mentions'] } })))!;
  assert.equal(azure.ticketEdits!.unkept, null, 'no warning where the description is read-only anyway');
});

test('edits off: the fields stay read-only, as the ticket owned them, and the sheet says the project\'s settings turn edits on', () => {
  for (const st of [undefined, null, side({ edits: false, ticket: null })]) {
    const s = taskSheet(input(jira(), st))!;
    assert.equal(s.ticketEdits, null, String(st));
    assert.deepEqual([s.fields.title, s.fields.brief], ['As intake brought it', 'Old text']);
    assert.ok(s.locked!.endsWith(EDITS_OFF), s.locked!);
    assert.match(s.locked!, /Jira ticket owns its title, description, dependencies and labels/);
  }
  assert.match(EDITS_OFF, /project's settings/);
  assert.ok(!/\.acc|config\.json/.test(EDITS_OFF), 'in process words, with no path (D-132)');
});

test('edge cases: a tracker that can\'t take text, a ticket that couldn\'t be read, and a manual task given a ticket', () => {
  const azure = taskSheet(input(jira({ id: 'AB-7', source: { kind: 'azure', key: 'AB-7', url: null } }), side({ kind: 'azure' })))!;
  assert.equal(azure.ticketEdits!.base, null, 'Azure DevOps refuses text: the title and description stay read-only');
  assert.equal(azure.locked, textRefusal('azure'));
  assert.equal(azure.ticketEdits!.rows.length, 3, 'its status, assignee and labels still change, as on its page');
  assert.equal(azure.fields.title, 'As intake brought it');
  const unread = taskSheet(input(jira(), side({ ticket: null, error: 'Jira refused the sign-in.' })))!;
  assert.deepEqual([unread.ticketEdits, unread.fields.title], [{ base: null, rows: [], unkept: null }, 'As intake brought it']);
  assert.equal(unread.locked, 'Its Jira ticket couldn\'t be read, so its title and description can\'t change here now. Jira refused the sign-in.');
  const manual = taskSheet(input(jira({ id: 'T-3', source: { kind: 'manual', key: null, url: null } }), side()))!;
  assert.deepEqual([manual.ticketEdits, manual.locked], [null, null], 'a manual task is acc\'s own: no ticket');
  assert.equal(sheetLock({ source: { kind: 'manual', key: null, url: null } }, side()), null);
});

test('edits on, Save\'s acc edit still sends none of the fields the ticket owns: the text goes to the ticket instead', () => {
  const i = input(jira(), side());
  const s = taskSheet(i)!;
  assert.deepEqual(taskSheetArgs(i, { ...s.fields, title: 'Mine', brief: 'Mine' }), [], 'the ticket\'s text isn\'t acc\'s to keep');
  assert.deepEqual(taskSheetArgs(i, { ...s.fields, title: 'Mine', notes: 'Ask first.' }), ['edit', 'ACME-7', '--notes=Ask first.']);
});

test('openTaskSheet with a read: a tracker task opens once its ticket is read, a failed read still opens it read-only, and a manual task reads nothing', async () => {
  const tasks = [{ ...jira() }, { ...jira({ id: 'T-3', source: { kind: 'manual', key: null, url: null } }) }] as unknown as Task[];
  const hub = { project: () => ({ name: 'Tool', config: { environments: ENVS } }), ledger: () => ({ tasks }) } as never;
  const posted: { type: string; sheet: ReturnType<typeof taskSheet> }[] = [];
  const tell = (m: unknown) => { posted.push(m as (typeof posted)[number]); };
  const asked: string[] = [];
  const read = async (_root: string, key: string) => { asked.push(key); return side(); };
  assert.equal(openTaskSheet(hub, tell, '/r', 'ACME-7', undefined, read), true);
  assert.equal(posted.length, 0, 'edge: nothing shows before the ticket is read');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([posted[0]!.type, posted[0]!.sheet!.ticketEdits?.base?.title, asked], [TASK_SHEET_MESSAGE, 'As the ticket says now', ['ACME-7']]);
  assert.equal(openTaskSheet(hub, tell, '/r', 'ACME-7', undefined, async () => { throw new Error('offline'); }), true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([posted[1]!.sheet!.ticketEdits, posted[1]!.sheet!.fields.title], [null, 'As intake brought it'], 'a failed read opens it as edits off would');
  assert.equal(openTaskSheet(hub, tell, '/r', 'T-3', undefined, read), true);
  assert.deepEqual([posted.length, asked.length], [3, 1], 'a manual task opens at once, with no read');
  assert.equal(openTaskSheet(hub, tell, '/r', 'T-9', undefined, read), false);
  assert.equal(asked.length, 1, 'edge: a task that isn\'t there reads nothing');
});

test('the page\'s messages: Save\'s base and a Change are checked before the extension acts on them, and the replies have their names', () => {
  const go = area.messages!['task-sheet-go']!;
  const m = { project: '/r', task: 'ACME-7', title: 'T', brief: '', deps: '', environment: 'dev', labels: '', notes: '' };
  assert.equal(go({ ...m, base: { title: 'T', markdown: '' } }), true);
  assert.equal(go({ ...m, base: { title: 'T' } }), false, 'edge: a base without its description');
  assert.equal(go({ ...m, base: null }), false);
  assert.equal(go({ ...m, base: { title: 'T', markdown: 'x'.repeat(70_000) } }), false);
  const field = area.messages!['task-sheet-field']!;
  for (const f of ['status', 'assign', 'labels']) assert.equal(field({ project: '/r', task: 'ACME-7', field: f }), true, f);
  assert.equal(field({ project: '/r', task: 'ACME-7', field: 'title' }), false, 'edge: only the ticket page\'s three');
  assert.equal(field({ project: '/r', task: 'nope nope', field: 'status' }), false);
  assert.deepEqual([TASK_SHEET_DONE, TASK_SHEET_ROWS], ['task-sheet-done', 'task-sheet-rows']);
});

test('the task page\'s description has Edit only where the tracker allows edits and acc keeps a task, off with why while its builder runs', () => {
  const t: Ticket = {
    key: 'ACME-7', kind: 'jira', url: 'u', title: 'T', type: null, status: { id: '1', name: 'To Do', category: 'todo' }, assignees: [], reporter: null, labels: [], priority: null,
    created: '2026-10-01T00:00:00Z', updated: '2026-10-01T00:00:00Z', body: { blocks: [] }, markdown: '', comments: [], related: [],
  };
  const task = { ...jira(), history: [], createdAt: '', updatedAt: '', blocker: null, run: null, pr: null } as unknown as Task;
  const base = { project: '/r', tracker: 0, trackerTitle: 'Jira · ACME', trackerKind: 'jira' as const, key: 'ACME-7', ticket: t, loading: false, error: null, connect: null, row: null, checks: [], signedInAs: null, updates: [], boards: [], github: null, now: Date.now() };
  assert.deepEqual(ticketModel({ ...base, task, trackerEdits: true }).editText, { command: 'acc.task.edit', label: 'Edit', icon: 'edit', ref: { project: '/r', task: 'ACME-7' } });
  assert.equal(ticketModel({ ...base, task, trackerEdits: false }).editText, null, 'edits off: no Edit');
  assert.equal(ticketModel({ ...base, task: null, trackerEdits: true }).editText, null, 'edge: a ticket acc keeps no task for');
  assert.equal(ticketModel({ ...base, task, ticket: null, trackerEdits: true }).editText, null, 'edge: before its ticket has loaded');
  assert.match(editTextAction('/r', { id: 'ACME-7', state: 'running' }).disabled!, /Its builder is working/);
});
