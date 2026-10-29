// A tracker's changes field (T-105): the setting's row in Settings and on the Connect page, off for Slack; its
// picker; the ticket page's read-back beside what the Command Center found, with the difference said; its draft
// update, listed on the ticket's page and the Overview, offered with each hand-written line kept; and a fake
// tracker that records every write, which gets none until a person saves.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changesDraft, keptLines, withKept } from '../../packages/core/src/changes-field.ts';
import type { OutsideChange } from '../../packages/core/src/outside-changes.ts';
import type { RecordChange } from '../../packages/core/src/records.ts';
import { GITHUB_CHANGES } from '../../packages/core/src/trackers/fields.ts';
import type { TextField, TrackerClient } from '../../packages/core/src/trackers/types.ts';
import type { Update } from '../../packages/core/src/updates.ts';
import { FieldReads, saveClaimed, saveField, type SaveIn } from '../src/logic/changes-field.ts';
import {
  area, CHANGES_FIELD_COMMAND, CHANGES_FIELD_LABEL, changesFieldPicks, changesFieldRecord, changesFieldRow, connectChangesField, FIELD_LOOK,
  type FieldIn, fieldName, FORMAT_WORDS, noTextFields, ticketField, withFieldKept,
} from '../src/model/changes-field.ts';
import { ticketPaths } from '../src/model/changes.ts';
import { homeModel } from '../src/model/home.ts';
import { isFromWebview } from '../src/model/messages.ts';
import type { BoardInput } from '../src/model/boards.ts';
import { trackersAndSignIns } from '../src/model/settings.ts';
import { EDITS_OFF } from '../src/model/task-sheet.ts';
import { updateCards } from '../src/model/updates.ts';
import { pageDom, type PageElement } from './page-dom.ts';
import { hub } from './support.ts';

const NOTES: TextField = { id: 'customfield_10042', name: 'Deployment Notes', format: 'adf' };
const SF = 'force-app/main/default';
const PATHS = [`${SF}/classes/JobHistoryService.cls`, `${SF}/classes/JobHistoryService.cls-meta.xml`, `${SF}/flows/Contact_Job_History.flow-meta.xml`];
const RENAME: RecordChange = { object: 'Account', action: 'update', match: [{ field: 'Name', value: 'Acme Corp' }], fields: [{ field: 'Name', from: null, to: 'Acme Corporation' }] };
const RECORD: OutsideChange = { id: 'c1', kind: 'record', detail: RENAME, why: 'The brand changed', planned: true, actor: 'human', by: 'human:pat', at: '2026-10-21T09:00:00Z' };
const NOW = new Date('2026-10-22T12:00:00Z');
const arg = JSON.stringify({ root: '/r', index: 0 });

/** What a developer wrote in the field by hand, as the screenshot fixture has it. */
const HAND = 'Escalation Rules: Case\n\nAfter the deploy, turn on the Premium escalation rule in Setup.';
const input = (more: Partial<FieldIn> = {}): FieldIn => ({
  task: { id: 'ACME-7', outside: { changes: [RECORD], noted: [], none: [], steps: [] } }, kind: 'jira', field: NOTES, profile: 'salesforce',
  paths: PATHS, read: { state: 'read', text: HAND }, written: [], drafted: true, now: NOW, ...more,
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

const OURS = changesDraft({ profile: 'salesforce', paths: PATHS, outside: [RECORD], at: NOW })!;
/** The draft update acc made when ACME-7's changes changed (D-066). */
const DRAFT: Update = { v: 1, id: 'ACME-7.2', task: 'ACME-7', tracker: 'jira', key: 'ACME-7', url: null, event: 'changes', field: NOTES, text: OURS, state: 'draft', createdAt: '2026-10-22T11:00:00.000Z', by: 'acc change' };
const BOARD: BoardInput = { index: 0, kind: 'jira', title: 'Jira · ACME', board: null, error: null, connect: null, loading: false, signedInAs: 'Jordan Kim', signInScope: null };
const cards = (edits = true, updates: Update[] = [DRAFT]) => updateCards('/r', updates, null, [BOARD], () => 0, () => edits, NOW.getTime());

test('the read-back that differs from what the Command Center found: it says so, in orange, and that its draft update keeps what was written by hand', () => {
  const f = ticketField(input())!;
  assert.equal(f.heading, 'From the ticket\'s Deployment Notes');
  assert.deepEqual(f.look, FIELD_LOOK.differs);
  assert.equal(f.text, HAND);
  assert.ok(f.doc!.blocks.length);
  assert.equal(f.note, 'Its draft update, in Activity, is the field\'s new text: it keeps each line written here by hand, marked as kept from the ticket.');
  assert.match(ticketField(input({ drafted: false }))!.note!, /stays\. The Command Center drafts the field's new text when the ticket's changes next change/, 'edge: a draft discarded, or none yet');
  assert.ok(!('draft' in f), 'the page draws no draft of its own: it\'s an update draft');
});

test('the read-back that says what was found, with the lines written by hand kept: blue; an empty field: orange, its draft its first text', () => {
  const saved = withKept(OURS.replace('22 Oct', '1 Oct'), keptLines(HAND, [OURS]));
  const same = ticketField(input({ read: { state: 'read', text: saved } }))!;
  assert.deepEqual(same.look, FIELD_LOOK.same);
  assert.match(same.note!, /says this already: its draft update, in Activity, can be discarded/);
  assert.equal(ticketField(input({ read: { state: 'read', text: saved }, drafted: false }))!.note, null);
  const empty = ticketField(input({ read: { state: 'read', text: '  ' } }))!;
  assert.deepEqual(empty.look, FIELD_LOOK.empty);
  assert.equal(empty.text, null);
  assert.equal(empty.note, 'Its draft update, in Activity, is the field\'s new text.');
});

test('edge: before the read, a failed read, no changes found, a tracker that names no field, Slack, and GitHub\'s section', () => {
  assert.deepEqual(ticketField(input({ read: null }))!.look, FIELD_LOOK.reading);
  assert.deepEqual(ticketField(input({ read: { state: 'loading' } }))!.look, FIELD_LOOK.reading);
  const failed = ticketField(input({ read: { state: 'failed', error: 'Jira said no' } }))!;
  assert.deepEqual([failed.look, failed.error], [FIELD_LOOK.failed, 'Jira said no']);
  const nothing = ticketField(input({ paths: [], task: { id: 'ACME-7' } }))!;
  assert.match(nothing.note!, /nothing to add yet/);
  assert.equal(ticketField(input({ paths: [], task: { id: 'ACME-7' }, read: { state: 'read', text: '' } }))!.look, FIELD_LOOK.empty);
  assert.equal(ticketField(input({ field: null })), null);
  assert.equal(ticketField(input({ kind: 'slack' })), null);
  assert.equal(ticketField(input({ kind: 'github', field: GITHUB_CHANGES }))!.heading, 'From the ticket\'s Changes (kept by the Command Center)');
  assert.equal(fieldName('github', GITHUB_CHANGES), 'the description\'s Changes (kept by the Command Center) section');
  const manifest = ticketField(input({ read: { state: 'read', text: OURS }, manifest: { types: [{ name: 'ApexClass', members: ['JobHistoryService'] }], deletions: [] } }))!;
  assert.deepEqual(manifest.look, FIELD_LOOK.differs, 'its package.xml is part of what was found');
});

test('the draft is made from the paths the Changes section lists: the branch\'s while in flight, what was kept once done, none before there\'s work', () => {
  const kept = { at: '2026-10-21T09:00:00Z', paths: [PATHS[2]!] };
  assert.deepEqual(ticketPaths({ task: { id: 'ACME-7', state: 'running', changes: kept }, profile: 'salesforce', planned: null, live: PATHS }), PATHS);
  assert.deepEqual(ticketPaths({ task: { id: 'ACME-7', state: 'running', changes: kept }, profile: 'salesforce', planned: null, live: [] }), kept.paths, 'edge: in flight with nothing on its branch yet, what was kept at its land');
  assert.deepEqual(ticketPaths({ task: { id: 'ACME-7', state: 'done', changes: kept }, profile: 'salesforce', planned: null, live: PATHS }), kept.paths, 'done: what was kept, not a branch read');
  assert.deepEqual(ticketPaths({ task: { id: 'ACME-7', state: 'todo' }, profile: 'salesforce', planned: PATHS, live: null }), [], 'edge: before there\'s work, a plan is no change');
});

// ---------------------------------------------------------------- the draft update

test('the draft update: its card saves the field, says what it\'s about, and offers its text with the hand-written lines kept, marked so', () => {
  const [c] = cards();
  assert.deepEqual([c!.saves, c!.about, c!.postAs, c!.blocked], ['Deployment Notes', 'New text for Deployment Notes, from its changes', 'Jordan Kim', null]);
  assert.equal(c!.text, OURS, 'before the field is read, as acc drafted it');
  const [offered] = withFieldKept([c!], { state: 'read', text: HAND }, [OURS]);
  assert.equal(offered!.text, withKept(OURS, ['Escalation Rules: Case', 'After the deploy, turn on the Premium escalation rule in Setup.']));
  assert.match(offered!.text, /\*\*Kept from the ticket\*\*\n\nEscalation Rules: Case\n\nAfter the deploy, turn on the Premium escalation rule in Setup\.\n\nAs of 22 Oct 2026\.$/);
  assert.deepEqual(withFieldKept([c!], { state: 'loading' }, [OURS]), [c], 'edge: before the read, as it is');
  assert.deepEqual(withFieldKept([c!], { state: 'failed', error: 'no' }, [OURS]), [c], 'edge: a failed read, as it is: the save keeps the lines anyway');
  const comment = cards(true, [{ ...DRAFT, id: 'ACME-7.1', event: 'merged', env: 'Dev', field: undefined }])[0]!;
  assert.equal(comment.saves, null);
  assert.deepEqual(withFieldKept([comment], { state: 'read', text: HAND }, [OURS]), [comment], 'a comment\'s draft is left alone');
});

test('edge: where the tracker keeps edits off, its Save is off, saying why (D-177)', () => {
  assert.equal(cards(false)[0]!.blocked, `The ticket's Deployment Notes can't change from here. ${EDITS_OFF}`);
  assert.equal(cards(false, [{ ...DRAFT, event: 'merged', env: 'Dev', field: undefined }])[0]!.blocked, null, 'a comment posts with edits off');
});

test('the Overview lists the draft with the ticket\'s other drafts, under Needs you, to save, edit or discard', () => {
  const base = hub();
  const trackers = [{ kind: 'jira' as const, project: 'ACME', prefix: null, changesField: NOTES, edits: true }];
  const projects = [{ ...base.projects[0]!, config: { ...base.projects[0]!.config, trackers } }];
  const updates = [DRAFT, { ...DRAFT, id: 'ACME-7.1', event: 'pr-opened' as const, field: undefined, text: 'The change is ready for review.' }];
  const m = homeModel({ hub: { ...base, projects, agents: [], taskRows: () => [], updates: () => updates }, section: 'overview', boards: () => [BOARD], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const items = m.overview.attention.filter((a) => a.update);
  assert.deepEqual(items.map((a) => [a.title, a.detail, a.update!.saves]), [
    ['Update ready for ACME-7', 'Acme · New text for Deployment Notes, from its changes', 'Deployment Notes'],
    ['Update ready for ACME-7', 'Acme · Ready for review', null],
  ]);
  assert.deepEqual(items[0]!.actions.map((a) => a.label), ['Edit']);
  const off = homeModel({ hub: { ...base, projects: [{ ...projects[0]!, config: { ...projects[0]!.config, trackers: [{ ...trackers[0]!, edits: false }] } }], agents: [], taskRows: () => [], updates: () => [DRAFT] }, section: 'overview', boards: () => [BOARD], identity: () => null, setup: { items: [], confirmed: new Set() } });
  assert.match(off.overview.attention.find((a) => a.update)!.update!.blocked!, /can't change from here/);
});

// ---------------------------------------------------------------- nothing reaches the tracker until a person saves

/** A tracker that answers reads with `text` and records every write. */
function fakeTracker(text: string) {
  const writes: { key: string; field: TextField; markdown: string }[] = [];
  let now = text;
  const client: Pick<TrackerClient, 'readField' | 'writeField'> = {
    readField: async () => now,
    writeField: async (key, field, markdown) => { writes.push({ key, field, markdown }); now = markdown; },
  };
  return { client, writes, change: (t: string) => { now = t; } };
}
/** acc, as the extension runs it: records each call, and answers `code`. */
function fakeAcc(code = 0) {
  const calls: string[][] = [];
  const acc = async (args: string[]) => { calls.push(args); return { code, stdout: code ? JSON.stringify({ message: 'ACME-7.2 was posted by jordan.' }) : '{}', stderr: '' }; };
  return { acc, calls };
}
const save = (more: Partial<SaveIn> = {}): SaveIn => ({ field: NOTES, edits: true, key: 'ACME-7', name: 'Deployment Notes', text: OURS, written: [OURS], ...more });
const says = (r: { stdout: string }) => (JSON.parse(r.stdout) as { message: string }).message;

test('nothing reaches the tracker while the page reads the field and acc drafts its text; a person\'s save writes it once, the hand-written lines kept', async () => {
  const t = fakeTracker(HAND);
  const redrawn: string[] = [];
  const reads = new FieldReads((root) => redrawn.push(root));
  assert.equal(reads.read('/r', 'acme-7'), null, 'edge: before the first read');
  await reads.load('/r', 'ACME-7', NOTES, async () => t.client);
  assert.deepEqual(reads.read('/r', 'acme-7'), { state: 'read', text: HAND });
  assert.deepEqual(redrawn, ['/r']);
  const [offered] = withFieldKept(cards(), reads.read('/r', 'ACME-7'), [OURS]);
  ticketField(input({ read: reads.read('/r', 'ACME-7') }));
  await reads.load('/r', 'ACME-7', NOTES, async () => t.client);
  assert.equal(t.writes.length, 0, 'reads, drafts and draws wrote nothing');

  const a = fakeAcc();
  const r = await saveClaimed(t.client, a.acc, '/r', 'ACME-7.2', save({ text: offered!.text }), [], says);
  assert.deepEqual(r, { ok: true, text: offered!.text });
  assert.deepEqual(t.writes, [{ key: 'ACME-7', field: NOTES, markdown: offered!.text }], 'once, as offered');
  assert.deepEqual(a.calls, [['update', 'posting', 'ACME-7.2', '--json']], 'claimed first, so a second window\'s Save can\'t write it again');
  assert.ok(t.writes[0]!.markdown.includes('After the deploy, turn on the Premium escalation rule in Setup.'), 'the fixture\'s hand-written line is still there');
  reads.wrote('/r', 'ACME-7', r.ok ? r.text : '');
  assert.deepEqual(ticketField(input({ read: reads.read('/r', 'ACME-7') }))!.look, FIELD_LOOK.same, 'once saved, the field says what was found');
});

test('never lose hand-written text: saved from the Overview as acc wrote it, or with a line typed since on the ticket, each line a person wrote is kept', async () => {
  const t = fakeTracker(HAND);
  const r = await saveField(t.client, save());
  assert.ok(r.ok);
  for (const line of keptLines(HAND, [OURS])) assert.ok(t.writes[0]!.markdown.includes(line), line);
  t.change(`${t.writes[0]!.markdown}\n\nAlso: load the Holiday records by hand.`);
  await saveField(t.client, save({ text: OURS.replace('\n\nAs of', '\n- Flow: one more\n\nAs of') }));
  assert.match(t.writes[1]!.markdown, /Kept from the ticket\*\*\n\nEscalation Rules: Case\n\nAfter the deploy[^\n]*\n\nAlso: load the Holiday records by hand\.\n\nAs of 22 Oct 2026\.$/);
  assert.match(t.writes[1]!.markdown, /- Flow: one more/, 'the person\'s edit goes too');
});

test('edge: edits off, no field named, a tracker that can\'t write, a failed read or write, and a refused claim write nothing; a failed save puts the draft back with why', async () => {
  const t = fakeTracker(HAND);
  assert.match((await saveField(t.client, save({ edits: false })) as { error: string }).error, /can't change from here, so nothing was written/);
  assert.match((await saveField(t.client, save({ field: null })) as { error: string }).error, /name no field/);
  assert.match((await saveField({ readField: t.client.readField }, save()) as { error: string }).error, /no fields to write/);
  const broken: Pick<TrackerClient, 'readField' | 'writeField'> = { readField: async () => HAND, writeField: async () => { throw new Error('Jira said no: field not on screen'); } };
  const a = fakeAcc();
  const failed = await saveClaimed(broken, a.acc, '/r', 'ACME-7.2', save(), ['--again'], says);
  assert.match((failed as { error: string }).error, /Couldn't save it: Jira said no/);
  assert.deepEqual(a.calls.map((c) => c.slice(0, 3)), [['update', 'posting', 'ACME-7.2'], ['update', 'release', 'ACME-7.2']]);
  assert.equal(a.calls[0]![3], '--again');
  assert.match(a.calls[1]![3]!, /^--reason=Couldn't save it: Jira said no/);
  const unread: Pick<TrackerClient, 'readField' | 'writeField'> = { readField: async () => { throw new Error('Jira is down'); }, writeField: t.client.writeField };
  assert.match((await saveField(unread, save()) as { error: string }).error, /Jira is down/);
  const refused = fakeAcc(1);
  assert.deepEqual(await saveClaimed(t.client, refused.acc, '/r', 'ACME-7.2', save(), [], says), { ok: false, error: 'ACME-7.2 was posted by jordan.' });
  assert.equal(t.writes.length, 0);

  const reads = new FieldReads(() => undefined);
  await reads.load('/r', 'ACME-7', NOTES, async () => { throw new Error('Sign in to Jira (acme.atlassian.net) for this repo to see its board and tickets.'); });
  assert.equal(reads.read('/r', 'ACME-7')!.state, 'failed');
  await reads.load('/r', 'ACME-8', NOTES, async () => ({}));
  assert.deepEqual(reads.read('/r', 'ACME-8'), { state: 'failed', error: 'This tracker has no fields to read.' });
});

test('the page has no save of its own: the field\'s Save is the update\'s, which the extension takes as update-post', () => {
  assert.deepEqual(area.commands, [CHANGES_FIELD_COMMAND]);
  assert.equal(area.messages, undefined);
  assert.ok(!isFromWebview({ type: 'changes-field-save', project: '/r', task: 'ACME-7', text: '- a', before: '' }), 'edge: the old message is refused');
  assert.ok(isFromWebview({ type: 'update-post', project: '/r', id: 'ACME-7.2', text: OURS }));
});

// ---------------------------------------------------------------- drawn

test('drawn: the read-back, and the draft update\'s box with the kept lines, whose Save to the ticket sends its text; off where edits are off', async () => {
  const page = pageDom();
  let kept: unknown;
  (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { page.sent.push(m); }, getState: () => kept, setState: (s: unknown) => { kept = s; } });
  (globalThis as Record<string, unknown>).requestAnimationFrame ??= (f: () => void) => { f(); return 0; };
  const { renderField, changesFieldValue, changesFieldConnect } = await import('../webview/changes-field.ts');
  const { updateDraft } = await import('../webview/updates.ts');
  const { state } = await import('../webview/state.ts');
  state.last = {} as never;
  state.draw = () => undefined;
  const all = (e: PageElement): PageElement[] => [e, ...e.all()];
  const buttons = (e: PageElement) => all(e).filter((x) => x.tagName === 'BUTTON');
  const sec = renderField(ticketField(input())!) as unknown as PageElement;
  assert.match(sec.textContent, /From the ticket's Deployment Notes.*Differs from the changes the Command Center found.*Its draft update, in Activity.*Premium escalation rule/s);
  assert.ok(!all(sec).some((x) => x.tagName === 'TEXTAREA'), 'no box of its own');

  const [offered] = withFieldKept(cards(), { state: 'read', text: HAND }, [OURS]);
  const d = updateDraft(offered!) as unknown as PageElement;
  const box = all(d).find((x) => x.tagName === 'TEXTAREA') as PageElement & { value: string };
  assert.equal(box.value, offered!.text);
  assert.match(d.textContent, /New text for Deployment Notes, from its changes.*Saving as Jordan Kim/s);
  const saveButton = buttons(d).find((b) => b.textContent === 'Save to the ticket')!;
  assert.equal(saveButton.disabled, false);
  assert.match(saveButton.title, /Save it to ACME-7's Deployment Notes as Jordan Kim, with each line written there by hand kept/);
  assert.equal(page.sent.filter((m) => (m as { type: string }).type === 'update-post').length, 0, 'nothing sent before Save');
  saveButton.click();
  assert.deepEqual(page.sent.filter((m) => (m as { type: string }).type === 'update-post'), [{ type: 'update-post', project: '/r', id: 'ACME-7.2', text: offered!.text.trim() }]);

  const off = updateDraft({ ...cards(false)[0]!, id: 'ACME-7.3' }) as unknown as PageElement;
  const offSave = buttons(off).find((b) => b.textContent === 'Save to the ticket')!;
  assert.equal(offSave.disabled, true);
  assert.match(offSave.title, /can't change from here/);
  // The setting's value and the Connect page's row draw its look and its button.
  const value = changesFieldValue(changesFieldRow('slack', null, arg, 'Slack')) as unknown as PageElement;
  assert.match(value.textContent, /Slack thread has no fields/);
  assert.equal(buttons(value)[0]!.disabled, true);
  assert.match((changesFieldConnect(changesFieldRow('jira', NOTES, arg, 'Jira')) as unknown as PageElement).textContent, /Where to keep a ticket's changes.*Deployment Notes/);
});

test('edge case: the Connect shot of a saved tracker draws its changes row on the Save step, where the modal holds no board above it (T-107, T-140)', async () => {
  const { sampleConnect } = await import('../scripts/fixtures/connect.ts');
  const m = sampleConnect('existing');
  assert.equal(m.step, 'save');
  assert.ok(m.changesField, 'its changes row is drawn there');
});
