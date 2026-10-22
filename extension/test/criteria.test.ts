// Drafted acceptance criteria in the Command Center (T-81): a tracker task's page has Draft acceptance
// criteria, then the draft with Add to the description, which opens the sheet with the draft below the
// description's text under its own heading, and Open as an update, which asks acc for an update draft.
// The sheet drafts too. The drafts reach acc with the ticket, its comments and related tickets in a file,
// and nothing writes to the tracker.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CRITERIA_HEADING, type CriteriaDraft, criteriaPath, criteriaSection } from '../../packages/core/src/criteria.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import { tempDir } from '../../packages/core/test/temp-root.ts';
import { fromMarkdown, unkeptRefusal } from '../../packages/core/src/trackers/doc.ts';
import { textRefusal, type Ticket } from '../../packages/core/src/trackers/types.ts';
import { CriteriaDrafts, type CriteriaHost } from '../src/logic/criteria.ts';
import { area, CRITERIA_ACTIONS, CRITERIA_DONE, readWords, sheetRefusal, TASK_SHEET_DRAFT, ticketCriteria, withSheetCriteria } from '../src/model/criteria.ts';
import { modalTakes } from '../src/model/task-modal.ts';
import { ticketModel } from '../src/model/task-page.ts';
import { EDITS_OFF, type SheetTicket, taskSheet, type TaskSheetInput } from '../src/model/task-sheet.ts';
import type { FromWebview } from '../src/model/messages.ts';
import { accTimeoutMs } from '../src/run.ts';

const MD = '### Acceptance criteria\n\n1. A premium case escalates after 2 business hours.';
const draft = (more: Partial<CriteriaDraft> = {}): CriteriaDraft => ({
  v: 1, task: 'ACME-7', key: 'ACME-7', criteria: ['A premium case escalates after 2 business hours.'], steps: [], edgeCases: [], questions: [], markdown: MD, wording: [],
  read: { comments: 2, related: 1, full: true }, sessionId: 's', name: 'n', at: '2026-10-20T12:00:00Z', durationMs: 1, costUsd: null, ...more,
});
const jiraTask = (more: Partial<Task> = {}) => ({ id: 'ACME-7', source: { kind: 'jira' as const, key: 'ACME-7', url: 'https://acme.example/browse/ACME-7' }, state: 'todo' as const, ...more }) as Task;

// ---------------------------------------------------------------- the task page's section

test('the page\'s section: before a draft it offers Draft acceptance criteria, and a task with no ticket has none (edge case)', () => {
  const c = ticketCriteria({ task: jiraTask(), draft: null, drafting: false, edits: true, kind: 'jira' })!;
  assert.deepEqual([c.look.label, c.draft, c.sheet, c.update, c.body], ['Not drafted yet', { label: 'Draft acceptance criteria', disabled: null }, null, null, null]);
  assert.match(c.note!, /An agent can draft acceptance criteria, test steps and edge cases/);
  assert.equal(ticketCriteria({ task: jiraTask({ source: { kind: 'manual', key: null, url: null } }), draft: null, drafting: false, edits: true, kind: null }), null);
});

test('the page\'s section with a draft: the draft, what it read, and both ways out, Add to the description and Open as an update', () => {
  const c = ticketCriteria({ task: jiraTask(), draft: draft(), drafting: false, edits: true, kind: 'jira' })!;
  assert.deepEqual([c.look, c.at], [{ label: 'Drafted', icon: 'pass', tone: 'blue' }, '2026-10-20T12:00:00Z']);
  assert.deepEqual(c.body, fromMarkdown(MD));
  assert.equal(c.read, 'Drafted from the ticket, 2 comments and 1 related ticket.');
  assert.deepEqual(c.sheet, { label: 'Add to the description', disabled: null });
  assert.deepEqual(c.update, { label: 'Open as an update', disabled: null });
  assert.equal(c.draft.label, 'Draft again');
  assert.equal(c.wording, null);
  const worded = ticketCriteria({ task: jiraTask(), draft: draft({ wording: [{ file: '<stdin>', line: 1, col: 1, rule: 'semicolon', level: 'hard', match: ';', message: 'm' }] }), drafting: false, edits: true, kind: 'jira' })!;
  assert.deepEqual(worded.wording, { label: 'Wording: 1 finding', icon: 'whole-word', tone: 'orange' });
  assert.equal(readWords({ comments: 0, related: 0, full: false }), 'Drafted from the task\'s description only: its comments weren\'t read.');
});

test('edge: while a draft is drafting every button is off with why, and the section says an agent reads and changes nothing', () => {
  const c = ticketCriteria({ task: jiraTask(), draft: draft(), drafting: true, edits: true, kind: 'jira' })!;
  assert.deepEqual(c.look, { label: 'Drafting', icon: 'sync~spin', tone: 'blue' });
  assert.match(c.note!, /It changes nothing/);
  for (const b of [c.draft, c.sheet!, c.update!]) assert.equal(b.disabled, 'It\'s drafting now');
});

test('Add to the description is off with why where the sheet can\'t write the description; Open as an update stays on (edge cases)', () => {
  const off = (i: Partial<Parameters<typeof sheetRefusal>[0]>) => ticketCriteria({ task: jiraTask(), draft: draft(), drafting: false, edits: true, kind: 'jira', ...i })!;
  assert.equal(off({ edits: false }).sheet!.disabled, `Its description can't change from here. ${EDITS_OFF}`);
  assert.equal(off({ kind: 'azure' }).sheet!.disabled, textRefusal('azure'));
  assert.equal(off({ unkept: ['mentions'] }).sheet!.disabled, unkeptRefusal(['mentions']));
  assert.match(off({ task: jiraTask({ state: 'running' }) }).sheet!.disabled!, /Its builder is working/);
  for (const c of [off({ edits: false }), off({ kind: 'azure' }), off({ unkept: ['mentions'] })]) assert.equal(c.update!.disabled, null);
});

test('the task page\'s model holds the section for a task, with the ticket\'s unkept parts, and none for a ticket acc keeps no task for', () => {
  const t = { key: 'ACME-7', kind: 'jira', url: 'u', title: 't', type: null, typeKind: null, typeColor: null, status: { id: '1', name: 'To Do', category: 'todo' }, assignees: [], reporter: null, labels: [], priority: null, priorityLevel: null, created: '', updated: '', body: { blocks: [] }, markdown: '', unkept: ['attachments'], comments: [], related: [] } as Ticket;
  const base = { project: '/r', tracker: 0, trackerTitle: 'Jira · ACME', trackerKind: 'jira' as const, key: 'ACME-7', ticket: t, loading: false, error: null, connect: null, row: null, checks: [], trackerEdits: true };
  const m = ticketModel({ ...base, task: jiraTask() as never, draft: draft(), drafting: false });
  assert.equal(m.criteria!.sheet!.disabled, unkeptRefusal(['attachments']));
  assert.equal(ticketModel({ ...base, task: null }).criteria, null);
  assert.equal(ticketModel({ ...base, task: jiraTask() as never }).criteria!.look.label, 'Not drafted yet', 'edge: before the draft is read');
});

// ---------------------------------------------------------------- the sheet: the first way out

const ENVS = [{ name: 'Dev', branch: 'dev', default: true }];
const sheetTicket: SheetTicket = { edits: true, kind: 'jira', error: null, ticket: { title: 'Escalate', markdown: 'Premium cases escalate.', status: { id: '1', name: 'To Do', category: 'todo' }, assignees: [], labels: [] } };
const sheetFor = (st: SheetTicket | null) => taskSheet({ project: '/r', name: 'Tool', environments: ENVS, task: { ...jiraTask(), title: 'Escalate', brief: 'old', deps: [], environment: 'dev', labels: [], notes: '' } as NonNullable<TaskSheetInput['task']>, ticket: st })!;

test('Add to the description opens the sheet with the draft below the description\'s text, under its own heading, and the stored draft to add', () => {
  const s = withSheetCriteria(sheetFor(sheetTicket), draft(), false, true);
  assert.equal(s.fields.brief, `Premium cases escalate.\n\n## ${CRITERIA_HEADING}\n\n${MD}`);
  assert.deepEqual(s.criteria, { section: criteriaSection(MD), at: '2026-10-20T12:00:00Z', drafting: false });
  assert.equal(s.drafted, true);
  assert.deepEqual(s.ticketEdits!.base, { title: 'Escalate', markdown: 'Premium cases escalate.' }, 'Save still checks the ticket against the text it opened with');
  const plain = withSheetCriteria(sheetFor(sheetTicket), draft(), true);
  assert.equal(plain.fields.brief, 'Premium cases escalate.', 'Edit opens it with the description as it is');
  assert.deepEqual([plain.criteria!.drafting, plain.drafted], [true, undefined]);
});

test('edge: a sheet whose description is read-only, or a task with no draft yet, takes no draft in its description', () => {
  const off = sheetFor({ ...sheetTicket, edits: false });
  assert.deepEqual(withSheetCriteria(off, draft(), false, true), off, 'edits off');
  const unkept = sheetFor({ ...sheetTicket, ticket: { ...sheetTicket.ticket!, unkept: ['mentions'] } });
  assert.deepEqual(withSheetCriteria(unkept, draft(), false, true), unkept, 'a description that can\'t be written back');
  const none = withSheetCriteria(sheetFor(sheetTicket), null, false, true);
  assert.deepEqual([none.fields.brief, none.criteria, none.drafted], ['Premium cases escalate.', { section: null, at: null, drafting: false }, undefined], 'with no draft, it still offers to draft');
});

// ---------------------------------------------------------------- drafting, and the second way out

/** A project in a temp folder, a Jira task and a manual one, a tracker that records any write, and an acc that records its calls. */
function host(opts: { stored?: CriteriaDraft; ticket?: () => Promise<Ticket>; acc?: (args: string[]) => { code: number; stdout: string; stderr: string } } = {}) {
  const state = tempDir('acc-criteria-ext-');
  mkdirSync(join(state, 'criteria'), { recursive: true });
  if (opts.stored) writeFileSync(criteriaPath({ stateDir: state }, 'ACME-7'), JSON.stringify(opts.stored));
  const writes: string[] = [];
  const calls: { args: string[]; label?: string; ticket: string | null }[] = [];
  const tasks = [jiraTask(), jiraTask({ id: 'T-3', source: { kind: 'manual', key: null, url: null } })];
  const ticket: Ticket = {
    key: 'ACME-7', kind: 'jira', url: 'u', title: 'Escalate', type: null, typeKind: null, typeColor: null, status: { id: '1', name: 'To Do', category: 'todo' }, assignees: [], reporter: null, labels: [], priority: null, priorityLevel: null, created: '', updated: '',
    body: { blocks: [] }, markdown: 'Premium cases escalate.', comments: [{ id: 'c', author: { id: 'a', name: 'Dana Reyes' }, created: 'd', body: fromMarkdown('Only business hours.'), url: null }], related: [{ key: 'ACME-3', title: 'P', relation: 'parent', url: null, status: null, typeKind: null, typeColor: null }],
  };
  // The tracker: reads only. A write would be recorded, and the tests assert there is none.
  const tracker = { ticket: opts.ticket ?? (async () => ticket), comment: async () => { writes.push('comment'); }, setText: async () => { writes.push('setText'); } };
  const h: CriteriaHost = {
    project: (root) => (root === '/r' ? { root, ledgerPath: join(state, 'ledger.json') } : undefined),
    task: (_root, id) => tasks.find((t) => t.id === id),
    ticket: () => tracker.ticket(),
    acc: async (args, _cwd, label) => {
      const at = args.indexOf('--ticket');
      calls.push({ args, label, ticket: at >= 0 ? readFileSync(args[at + 1]!, 'utf8') : null });
      if (args[1] === 'criteria' && args.includes('--ticket') && !opts.acc) writeFileSync(criteriaPath({ stateDir: state }, 'ACME-7'), JSON.stringify(draft()));
      return opts.acc?.(args) ?? { code: 0, stdout: '{}', stderr: '' };
    },
  };
  return { h, calls, writes, state };
}

test('Draft acceptance criteria hands acc the ticket with its comments and related tickets in a file, removed after, and shows as drafting while acc runs', async () => {
  const x = host();
  let during = false;
  const changed: string[] = [];
  const d = new CriteriaDrafts({ ...x.h, acc: async (a, c, l) => { during = d.drafting('/r', 'ACME-7'); return x.h.acc(a, c, l); } }, (_r, id) => changed.push(id));
  const r = await d.draft('/r', 'acme-7');
  assert.deepEqual(r, { ok: true, section: criteriaSection(MD) });
  const call = x.calls[0]!;
  assert.deepEqual(call.args.slice(0, 4), ['draft', 'criteria', 'ACME-7', '--ticket']);
  assert.equal(call.args.at(-1), '--json');
  assert.equal(call.label, 'Draft ACME-7\'s acceptance criteria', 'in the output panel, where its steps show');
  const sent = JSON.parse(call.ticket!);
  assert.deepEqual(sent.comments, [{ author: 'Dana Reyes', created: 'd', markdown: 'Only business hours.' }]);
  assert.deepEqual(sent.related, [{ key: 'ACME-3', title: 'P', relation: 'parent' }]);
  assert.ok(!existsSync(call.args[4]!), 'the file is removed after');
  assert.equal(during, true);
  assert.equal(d.drafting('/r', 'ACME-7'), false);
  assert.deepEqual(changed, ['ACME-7', 'ACME-7'], 'the page redraws as it starts and as it ends');
  assert.deepEqual(x.writes, [], 'nothing reaches the tracker');
});

test('edge: a ticket that can\'t be read is drafted from the description, a task with no ticket is refused before acc runs, and acc\'s refusal comes back', async () => {
  const offline = host({ ticket: async () => { throw new Error('offline'); } });
  await new CriteriaDrafts(offline.h).draft('/r', 'ACME-7');
  assert.deepEqual(offline.calls[0]!.args, ['draft', 'criteria', 'ACME-7', '--json']);
  const x = host();
  const d = new CriteriaDrafts(x.h);
  assert.deepEqual(await d.draft('/r', 'T-3'), { ok: false, error: 'T-3 has no ticket. Its sheet holds its brief, so there is nothing to draft from.' });
  assert.deepEqual(await d.draft('/other', 'ACME-7'), { ok: false, error: 'That project isn\'t open any more.' });
  assert.equal(x.calls.length, 0);
  const refused = host({ acc: () => ({ code: 1, stdout: JSON.stringify({ message: 'The draft held no acceptance criteria.' }), stderr: '' }) });
  assert.deepEqual(await new CriteriaDrafts(refused.h).draft('/r', 'ACME-7'), { ok: false, error: 'The draft held no acceptance criteria.' });
});

test('edge: a second Draft while one runs is refused, and the first still finishes', async () => {
  const x = host();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const d = new CriteriaDrafts({ ...x.h, acc: async (a, c, l) => { await gate; return x.h.acc(a, c, l); } });
  const first = d.draft('/r', 'ACME-7');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await d.draft('/r', 'ACME-7'), { ok: false, error: 'ACME-7\'s acceptance criteria are being drafted now.' });
  release();
  assert.equal((await first).ok, true);
});

test('Open as an update asks acc for an update draft of the stored draft and nothing else; before a draft it is refused (edge case)', async () => {
  const none = host();
  assert.deepEqual(await new CriteriaDrafts(none.h).toUpdate('/r', 'ACME-7'), { ok: false, error: 'ACME-7 has no drafted acceptance criteria yet. Draft them first.' });
  assert.equal(none.calls.length, 0);
  const x = host({ stored: draft() });
  assert.deepEqual(await new CriteriaDrafts(x.h).toUpdate('/r', 'acme-7'), { ok: true });
  assert.deepEqual(x.calls.map((c) => c.args), [['draft', 'update', 'ACME-7', '--json']]);
  assert.equal(x.calls[0]!.label, undefined, 'quick, so not in the output panel');
  assert.deepEqual(x.writes, [], 'nothing reaches the tracker: the person posts it');
  const refused = host({ stored: draft(), acc: () => ({ code: 1, stdout: JSON.stringify({ message: 'ACME-7\'s ticket can\'t take an update.' }), stderr: '' }) });
  assert.deepEqual(await new CriteriaDrafts(refused.h).toUpdate('/r', 'ACME-7'), { ok: false, error: 'ACME-7\'s ticket can\'t take an update.' });
});

test('the sheet\'s dress reads the stored draft from the project\'s state, and adds it to the description only when asked', () => {
  const x = host({ stored: draft() });
  const d = new CriteriaDrafts(x.h);
  assert.deepEqual(d.stored('/r', 'acme-7'), draft());
  assert.equal(d.stored('/other', 'ACME-7'), null, 'edge: a project that closed');
  assert.match(d.dress('/r', 'ACME-7', true)(sheetFor(sheetTicket)).fields.brief, new RegExp(`## ${CRITERIA_HEADING}`));
  assert.equal(d.dress('/r', 'ACME-7')(sheetFor(sheetTicket)).fields.brief, 'Premium cases escalate.');
});

// ---------------------------------------------------------------- the page's messages

test('the page\'s messages are checked before the extension acts, and the modal takes only its own task\'s', () => {
  for (const type of [...CRITERIA_ACTIONS, 'task-sheet-criteria']) {
    const check = area.messages![type]!;
    assert.equal(check({ project: '/r', task: 'ACME-7' }), true, type);
    assert.equal(check({ project: '/r', task: '../x' }), false, `${type}: edge: not a task id`);
    assert.equal(check({ project: '', task: 'ACME-7' }), false, `${type}: edge: no project`);
  }
  const o = { project: '/r', key: 'ACME-7' } as never;
  for (const type of CRITERIA_ACTIONS) {
    assert.equal(modalTakes(o, { type, project: '/r', task: 'acme-7' } as FromWebview, new Set()), true, type);
    assert.equal(modalTakes(o, { type, project: '/r', task: 'ACME-8' } as FromWebview, new Set()), false, `${type}: another task's`);
  }
});

// ---------------------------------------------------------------- the page and the extension agree

const source = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the page takes the replies by the names the extension sends, and draws the section under the description', () => {
  assert.deepEqual([CRITERIA_DONE, TASK_SHEET_DRAFT], ['criteria-done', 'task-sheet-draft']);
  assert.match(source('../webview/criteria.ts'), new RegExp(`'${CRITERIA_DONE}': done`), 'the section takes how its buttons went');
  assert.match(source('../webview/task-sheet.ts'), new RegExp(`'${TASK_SHEET_DRAFT}': drafted`), 'the sheet takes its draft');
  const page = source('../webview/task-page.ts');
  const at = page.indexOf('if (m.criteria) main.append(renderCriteria(m, m.criteria));');
  assert.ok(at > 0 && at > page.indexOf('renderDoc(m.body, \'No description.\')'), 'renderCriteria comes after the description');
});

test('edge: every way the Command Center opens the task sheet for a task passes sheetDress, so its drafting shows', () => {
  const tasks = source('../src/tasks.ts');
  const opens = tasks.match(/openTaskSheet\(/g) ?? [];
  const dressed = tasks.match(/sheetDress\((?:root, id|ref\.project, ref\.task)\)\)/g) ?? [];
  assert.ok(opens.length >= 2, 'found the sheet\'s opens');
  assert.equal(dressed.length, opens.length, 'each open passes sheetDress');
});

test('the extension waits for a draft as long as the drafter may take twice, and other commands as before', () => {
  assert.ok(accTimeoutMs(['draft', 'criteria', 'ACME-7']) > 40 * 60_000);
  assert.equal(accTimeoutMs(['draft', 'update', 'ACME-7']), accTimeoutMs(['set', 'ACME-7', 'todo']));
});
