// A tracker's changes field (T-105): the setting's row in Settings and on the Connect page, off for Slack; its
// picker; the ticket page's read-back beside what the Command Center found, with the difference said; the draft
// a person edits; and a fake tracker that records every write, which gets none until a person saves.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OutsideChange } from '../../packages/core/src/outside-changes.ts';
import type { RecordChange } from '../../packages/core/src/records.ts';
import { GITHUB_CHANGES } from '../../packages/core/src/trackers/fields.ts';
import type { TextField, TrackerClient } from '../../packages/core/src/trackers/types.ts';
import { FieldReads, saveField, type SaveIn } from '../src/logic/changes-field.ts';
import {
  area, CHANGES_FIELD_COMMAND, CHANGES_FIELD_LABEL, changesFieldPicks, changesFieldRecord, changesFieldRow, connectChangesField, FIELD_LOOK, FIELD_SAVED, FIELD_TEXT_MAX,
  type FieldIn, fieldName, FORMAT_WORDS, noTextFields, ticketField,
} from '../src/model/changes-field.ts';
import { changedPaths } from '../src/model/changes.ts';
import { isFromWebview } from '../src/model/messages.ts';
import type { BoardInput } from '../src/model/boards.ts';
import { trackersAndSignIns } from '../src/model/settings.ts';
import { modalTakes } from '../src/model/task-modal.ts';
import { EDITS_OFF } from '../src/model/task-sheet.ts';
import { pageDom, type PageElement } from './page-dom.ts';

const NOTES: TextField = { id: 'customfield_10042', name: 'Deployment Notes', format: 'adf' };
const SF = 'force-app/main/default';
const PATHS = [`${SF}/classes/JobHistoryService.cls`, `${SF}/classes/JobHistoryService.cls-meta.xml`, `${SF}/flows/Contact_Job_History.flow-meta.xml`];
const RENAME: RecordChange = { object: 'Account', action: 'update', match: [{ field: 'Name', value: 'Acme Corp' }], fields: [{ field: 'Name', from: null, to: 'Acme Corporation' }] };
const RECORD: OutsideChange = { id: 'c1', kind: 'record', detail: RENAME, why: 'The brand changed', planned: true, actor: 'human', by: 'human:pat', at: '2026-10-21T09:00:00Z' };
const NOW = new Date('2026-10-22T12:00:00Z');
const arg = JSON.stringify({ root: '/r', index: 0 });

const input = (more: Partial<FieldIn> = {}): FieldIn => ({
  task: { id: 'ACME-7', outside: { changes: [RECORD], noted: [], none: [], steps: [] } }, kind: 'jira', field: NOTES, edits: true, profile: 'salesforce',
  paths: PATHS, read: { state: 'read', text: 'Flow: Contact_Job_History\n\nAlso: load the Holiday records by hand.' }, now: NOW, ...more,
});

// ---------------------------------------------------------------- the setting

test('the setting\'s row: the field chosen, in blue, with Change…; none chosen says so, with Choose…; GitHub names its section', () => {
  const set = changesFieldRow('jira', NOTES, arg, 'Jira · ACME, in Acme');
  assert.equal(set.label, CHANGES_FIELD_LABEL);
  assert.equal(set.short, 'Changes', 'Settings names the row in one word, as its neighbours');
  assert.deepEqual(set.look, { label: 'Deployment Notes, a Jira field, as rich text', icon: 'note', tone: 'blue' });
  assert.deepEqual({ ...set.action }, { command: CHANGES_FIELD_COMMAND, label: 'Change…', icon: 'note', arg, name: 'Change… where to keep a ticket\'s changes, for Jira · ACME, in Acme', primary: false, disabled: null });
  const none = changesFieldRow('azure', null, arg, 'Azure DevOps · CRM, in Acme');
  assert.equal(none.look.label, 'Only on the ticket\'s page: no field chosen');
  assert.equal(none.action.label, 'Choose…');
  assert.equal(none.action.disabled, null);
  assert.equal(changesFieldRow('github', GITHUB_CHANGES, arg, 'x').look.label, 'In the description\'s Changes (kept by the Command Center) section');
  assert.equal(FORMAT_WORDS.plain, 'plain text');
});

test('edge: Slack\'s row is off, saying why, and so is its button', () => {
  const slack = changesFieldRow('slack', null, arg, 'Slack · acme, in Acme');
  assert.equal(slack.look.tone, 'neutral');
  assert.match(slack.look.label, /Slack thread has no fields/);
  assert.equal(slack.action.disabled, slack.look.label);
});

test('Settings\' Trackers draws the row for each tracker from the project\'s settings, Slack\'s off', () => {
  const board = (index: number, kind: BoardInput['kind'], title: string): BoardInput => ({ index, kind, title, board: null, error: null, connect: null, loading: false, signedInAs: 'me', signInScope: null });
  const project = {
    name: 'Acme', root: '/r', branch: null, worktrees: [],
    config: { github: null, environments: [], profile: 'salesforce', trackers: [{ kind: 'jira' as const, project: 'ACME', prefix: null, changesField: NOTES }, { kind: 'slack' as const, project: null, prefix: null }] },
  };
  const t = trackersAndSignIns([project], () => [board(0, 'jira', 'Jira · ACME'), board(1, 'slack', 'Slack · acme')]);
  const [jira, slack] = t.projects[0]!.trackers;
  assert.equal(jira!.changes.look.label, 'Deployment Notes, a Jira field, as rich text');
  assert.equal(jira!.changes.action.arg, arg);
  assert.ok(slack!.changes.action.disabled);
});

test('the Connect page\'s row: an existing tracker\'s field; a new one\'s once its place is chosen, off until it\'s saved; none before', () => {
  const s = { root: '/r', kind: 'jira', projectName: 'Acme', start: false, existing: { index: 0, title: 'Jira · ACME' } };
  assert.equal(connectChangesField(s, [{ kind: 'jira', changesField: NOTES }], true)!.look.label, 'Deployment Notes, a Jira field, as rich text');
  const fresh = connectChangesField({ ...s, existing: null }, [], true)!;
  assert.equal(fresh.action.disabled, 'Save the tracker first: then its fields can be read.');
  assert.equal(connectChangesField({ ...s, existing: null }, [], false), null, 'edge: before the place is chosen');
  assert.equal(connectChangesField({ ...s, start: true }, [], true), null, 'edge: while a project is being started');
  assert.equal(connectChangesField({ ...s, kind: 'nope' }, [], true), null);
});

test('the picker: None first, then each field with its format, the one chosen marked; and what Settings keeps for each', () => {
  const picks = changesFieldPicks('jira', [NOTES, { id: 'customfield_1', name: 'Release', format: 'plain' }], NOTES);
  assert.deepEqual(picks.map((p) => [p.label, p.description, p.picked]), [['None', 'Show a ticket\'s changes on its page only', false], ['Deployment Notes', 'rich text', true], ['Release', 'plain text', false]]);
  assert.equal(changesFieldPicks('jira', [], null)[0]!.picked, true, 'edge: nothing chosen yet');
  assert.deepEqual(changesFieldPicks('github', [GITHUB_CHANGES], null).map((p) => p.label), ['None', 'The description']);
  assert.deepEqual(changesFieldRecord('jira', NOTES), { kind: 'jira', changesField: { ...NOTES } });
  assert.deepEqual(changesFieldRecord('jira', null), { kind: 'jira', changesField: null }, 'edge: a choice cleared takes the key out');
  assert.match(noTextFields('monday'), /monday.com has no field that holds text/);
});

// ---------------------------------------------------------------- the ticket's page

test('the read-back that differs from what the Command Center found: it says so, in orange, and drafts the field\'s new text', () => {
  const f = ticketField(input())!;
  assert.equal(f.heading, 'From the ticket\'s Deployment Notes');
  assert.deepEqual(f.look, FIELD_LOOK.differs);
  assert.equal(f.text, 'Flow: Contact_Job_History\n\nAlso: load the Holiday records by hand.');
  assert.ok(f.doc!.blocks.length);
  assert.match(f.note!, /by hand stays on the ticket until you save/);
  assert.equal(f.draft!.title, 'Update Deployment Notes');
  assert.equal(f.draft!.replaces, f.text);
  assert.deepEqual(f.draft!.look, FIELD_LOOK.draft);
  assert.equal(f.draft!.text, ['**Apex Class**', '', '- JobHistoryService', '', '**Flow**', '', '- Contact_Job_History', '', '**Record changes**', '', '- Account \'Acme Corp\': Name → \'Acme Corporation\'', '', 'As of 22 Oct 2026.'].join('\n'));
  assert.deepEqual(f.draft!.save, { label: 'Save to the ticket', disabled: null });
});

test('the read-back that says what was found: blue, and no draft; an empty field: a draft that is its first text', () => {
  const draft = ticketField(input())!.draft!.text;
  const same = ticketField(input({ read: { state: 'read', text: draft.replace('22 Oct', '1 Oct') } }))!;
  assert.deepEqual(same.look, FIELD_LOOK.same);
  assert.equal(same.draft, null);
  const empty = ticketField(input({ read: { state: 'read', text: '  ' } }))!;
  assert.deepEqual(empty.look, FIELD_LOOK.empty);
  assert.equal(empty.text, null);
  assert.equal(empty.draft!.replaces, '');
});

test('edge: before the read, a failed read, no changes found, edits off, and a tracker that names no field', () => {
  assert.deepEqual(ticketField(input({ read: null }))!.look, FIELD_LOOK.reading);
  assert.equal(ticketField(input({ read: { state: 'loading' } }))!.draft, null);
  const failed = ticketField(input({ read: { state: 'failed', error: 'Jira said no' } }))!;
  assert.deepEqual([failed.look, failed.error, failed.draft], [FIELD_LOOK.failed, 'Jira said no', null]);
  const nothing = ticketField(input({ paths: [], task: { id: 'ACME-7' } }))!;
  assert.equal(nothing.draft, null);
  assert.match(nothing.note!, /nothing to add yet/);
  assert.equal(ticketField(input({ paths: [], task: { id: 'ACME-7' }, read: { state: 'read', text: '' } }))!.look, FIELD_LOOK.empty);
  assert.equal(ticketField(input({ edits: false }))!.draft!.save.disabled, `The ticket's Deployment Notes can't change from here. ${EDITS_OFF}`);
  assert.equal(ticketField(input({ field: null })), null);
  assert.equal(ticketField(input({ kind: 'slack' })), null);
  assert.equal(ticketField(input({ kind: 'github', field: GITHUB_CHANGES }))!.heading, 'From the ticket\'s Changes (kept by the Command Center)');
  assert.equal(fieldName('github', GITHUB_CHANGES), 'the description\'s Changes (kept by the Command Center) section');
});

test('the draft is made from the paths the Changes section lists: the branch\'s while in flight, what was kept once done, none before there\'s work', () => {
  const kept = { at: '2026-10-21T09:00:00Z', paths: [PATHS[2]!] };
  assert.deepEqual(changedPaths({ task: { id: 'ACME-7', state: 'running', changes: kept }, profile: 'salesforce', planned: null, live: PATHS }), PATHS);
  assert.deepEqual(changedPaths({ task: { id: 'ACME-7', state: 'running', changes: kept }, profile: 'salesforce', planned: null, live: [] }), kept.paths, 'edge: in flight with nothing on its branch yet, what was kept at its land');
  assert.deepEqual(changedPaths({ task: { id: 'ACME-7', state: 'done', changes: kept }, profile: 'salesforce', planned: null, live: PATHS }), kept.paths, 'done: what was kept, not a branch read');
  assert.deepEqual(changedPaths({ task: { id: 'ACME-7', state: 'todo' }, profile: 'salesforce', planned: PATHS, live: null }), [], 'edge: before there\'s work, a plan is no change');
});

// ---------------------------------------------------------------- nothing reaches the tracker until a person saves

/** A tracker that answers reads with `text` and records every write. */
function fakeTracker(text: string) {
  const writes: { key: string; field: TextField; markdown: string }[] = [];
  let reads = 0;
  let now = text;
  const client: Pick<TrackerClient, 'readField' | 'writeField'> = {
    readField: async () => { reads++; return now; },
    writeField: async (key, field, markdown) => { writes.push({ key, field, markdown }); now = markdown; },
  };
  return { client, writes, reads: () => reads, change: (t: string) => { now = t; } };
}
const save = (more: Partial<SaveIn> = {}): SaveIn => ({ field: NOTES, edits: true, key: 'ACME-7', name: 'Deployment Notes', text: '- edited', before: 'by hand', ...more });

test('nothing reaches the tracker while the page reads the field and drafts its text; a person\'s save writes it once', async () => {
  const t = fakeTracker('by hand');
  const redrawn: string[] = [];
  const reads = new FieldReads((root) => redrawn.push(root));
  assert.equal(reads.read('/r', 'acme-7'), null, 'edge: before the first read');
  await reads.load('/r', 'ACME-7', NOTES, async () => t.client);
  assert.deepEqual(reads.read('/r', 'acme-7'), { state: 'read', text: 'by hand' });
  assert.deepEqual(redrawn, ['/r']);
  const drafted = ticketField(input({ read: reads.read('/r', 'ACME-7') }))!;
  assert.ok(drafted.draft, 'a draft is ready');
  await reads.load('/r', 'ACME-7', NOTES, async () => t.client);
  assert.equal(t.writes.length, 0, 'reads and drafts wrote nothing');

  assert.deepEqual(await saveField(t.client, save({ text: drafted.draft!.text, before: drafted.draft!.replaces })), { ok: true });
  assert.deepEqual(t.writes, [{ key: 'ACME-7', field: NOTES, markdown: drafted.draft!.text }]);
  reads.wrote('/r', 'ACME-7', drafted.draft!.text);
  assert.equal(ticketField(input({ read: reads.read('/r', 'ACME-7') }))!.draft, null, 'once saved, the field says what was found');
});

test('edge: a field changed since the page showed it, edits off, no field named, a tracker that can\'t write, and a failed read or write write nothing', async () => {
  const t = fakeTracker('by hand');
  t.change('someone else wrote this');
  const changed = await saveField(t.client, save());
  assert.equal(changed.ok, false);
  assert.match((changed as { error: string }).error, /changed since this page showed it, so nothing was written/);
  assert.equal((changed as { now: string }).now, 'someone else wrote this', 'the page gets what it says now');
  assert.match((await saveField(t.client, save({ edits: false }))  as { error: string }).error, /can't change from here, so nothing was written/);
  assert.match((await saveField(t.client, save({ field: null })) as { error: string }).error, /name no field/);
  assert.match((await saveField({ readField: t.client.readField }, save()) as { error: string }).error, /no fields to write/);
  const broken: Pick<TrackerClient, 'readField' | 'writeField'> = { readField: async () => 'by hand', writeField: async () => { throw new Error('Jira said no: field not on screen'); } };
  assert.match((await saveField(broken, save()) as { error: string }).error, /Couldn't save it: Jira said no/);
  assert.equal(t.writes.length, 0);

  const reads = new FieldReads(() => undefined);
  await reads.load('/r', 'ACME-7', NOTES, async () => { throw new Error('Sign in to Jira (acme.atlassian.net) for this repo to see its board and tickets.'); });
  assert.equal(reads.read('/r', 'ACME-7')!.state, 'failed');
  await reads.load('/r', 'ACME-8', NOTES, async () => ({}));
  assert.deepEqual(reads.read('/r', 'ACME-8'), { state: 'failed', error: 'This tracker has no fields to read.' });
});

test('the page\'s save is a message the extension takes only whole, and the modal takes only its own task\'s', () => {
  const msg = { type: 'changes-field-save', project: '/r', task: 'ACME-7', text: '- a', before: '' };
  assert.ok(isFromWebview(msg));
  assert.ok(!isFromWebview({ ...msg, text: '  ' }), 'edge: nothing to save');
  assert.ok(!isFromWebview({ ...msg, text: 'x'.repeat(FIELD_TEXT_MAX + 1) }));
  assert.ok(!isFromWebview({ ...msg, task: 'not a key' }));
  assert.ok(!isFromWebview({ ...msg, before: 3 }));
  assert.ok(area.messages!['changes-field-save']!(msg as never));
  assert.deepEqual(area.commands, [CHANGES_FIELD_COMMAND]);
  const o = { project: '/r', key: 'ACME-7' };
  assert.ok(modalTakes(o, msg as never, new Set()));
  assert.ok(!modalTakes(o, { ...msg, task: 'ACME-8' } as never, new Set()));
  assert.equal(FIELD_SAVED, 'changes-field-saved');
});

// ---------------------------------------------------------------- drawn

test('drawn: the read-back, the draft in a box whose edit is kept, Save that sends the edit with what it replaces, and how the save went', async () => {
  const page = pageDom();
  let kept: unknown;
  (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { page.sent.push(m); }, getState: () => kept, setState: (s: unknown) => { kept = s; } });
  const { renderField, changesFieldValue, changesFieldConnect, FIELD_EDIT_KEY, area: pageArea } = await import('../webview/changes-field.ts');
  const { state, memory } = await import('../webview/state.ts');
  state.last = {} as never;
  let drawn = 0;
  state.draw = () => { drawn++; };
  const m = { project: '/r', key: 'ACME-7' } as never;
  const f = ticketField(input())!;
  const all = (e: PageElement): PageElement[] => [e, ...e.all()];
  const buttons = (e: PageElement) => all(e).filter((x) => x.tagName === 'BUTTON');
  let sec = renderField(m, f) as unknown as PageElement;
  assert.match(sec.textContent, /From the ticket's Deployment Notes.*Differs from the changes the Command Center found.*Holiday records.*Draft, not saved.*Update Deployment Notes.*Nothing is written to the ticket until you save/s);
  const box = all(sec).find((x) => x.tagName === 'TEXTAREA') as PageElement & { value: string };
  assert.equal(box.value, f.draft!.text);
  assert.deepEqual(buttons(sec).map((b) => [b.textContent, b.disabled]), [['Use the drafted text', true], ['Save to the ticket', false]]);
  // Typed: kept in the tab's memory, so a redraw keeps it.
  box.value = `${f.draft!.text}\n- Load the Holiday records`;
  for (const l of box.listeners.get('input') ?? []) l({});
  assert.equal(memory().drafts[`${FIELD_EDIT_KEY}/r#ACME-7`], box.value);
  sec = renderField(m, f) as unknown as PageElement;
  const again = all(sec).find((x) => x.tagName === 'TEXTAREA') as PageElement & { value: string };
  assert.match(again.value, /Load the Holiday records/);
  assert.equal(page.sent.length, 0, 'nothing sent before Save');
  buttons(sec).find((b) => b.textContent === 'Save to the ticket')!.click();
  assert.deepEqual(page.sent, [{ type: 'changes-field-save', project: '/r', task: 'ACME-7', text: again.value, before: f.draft!.replaces }]);
  sec = renderField(m, f) as unknown as PageElement;
  assert.ok(buttons(sec).some((b) => b.textContent === 'Saving…' && b.disabled), 'on its way');
  // Refused: why, with the edit kept; then saved: the edit goes.
  pageArea.receive!['changes-field-saved']!({ project: '/r', task: 'ACME-7', ok: false, error: 'The ticket\'s Deployment Notes changed since this page showed it' });
  sec = renderField(m, f) as unknown as PageElement;
  assert.match(sec.textContent, /changed since this page showed it/);
  assert.ok(memory().drafts[`${FIELD_EDIT_KEY}/r#ACME-7`]);
  buttons(sec).find((b) => b.textContent === 'Save to the ticket')!.click();
  pageArea.receive!['changes-field-saved']!({ project: '/r', task: 'ACME-7', ok: true });
  assert.equal(memory().drafts[`${FIELD_EDIT_KEY}/r#ACME-7`], undefined);
  assert.ok(drawn >= 3);
  // Edits off: Save is off, saying why.
  const off = renderField(m, ticketField(input({ edits: false }))!) as unknown as PageElement;
  const offSave = buttons(off).find((b) => b.textContent === 'Save to the ticket')!;
  assert.equal(offSave.disabled, true);
  assert.match(offSave.title, /can't change from here/);
  // The setting's value and the Connect page's row draw its look and its button.
  const value = changesFieldValue(changesFieldRow('slack', null, arg, 'Slack')) as unknown as PageElement;
  assert.match(value.textContent, /Slack thread has no fields/);
  assert.equal(buttons(value)[0]!.disabled, true);
  assert.match((changesFieldConnect(changesFieldRow('jira', NOTES, arg, 'Jira')) as unknown as PageElement).textContent, /Where to keep a ticket's changes.*Deployment Notes/);
});
