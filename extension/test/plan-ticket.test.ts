// Make a plan reads the whole ticket (T-110): the Command Center reads it and hands the file to acc, and the
// ticket's page says "2 new comments since this plan", with Make a new plan, when the ticket has moved on.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { Analysis } from '../../packages/core/src/analyze.ts';
import { parsePlanTicket, planRead, planTicket } from '../../packages/core/src/plan-ticket.ts';
import { fromMarkdown } from '../../packages/core/src/trackers/doc.ts';
import { type PlanTicketHost, planTicketFolder, unreadWhy, unwrittenWhy, writePlanTicketFile } from '../src/logic/plan-ticket.ts';
import type { TaskRow } from '../src/logic/shared.ts';
import { planBehind, planTicketRead, withTicketRead } from '../src/model/plan-behind.ts';
import { tempDir } from '../../packages/core/test/support.ts';
import { sampleAnalyses } from '../scripts/fixtures/analysis.ts';
import { sampleTalkTicket } from '../scripts/fixtures/talk.ts';
import { sampleTicket } from '../scripts/fixtures/task-page.ts';
import { type PageElement, pageDom } from './page-dom.ts';

/** tasks.ts imports vscode, which only VS Code has: a stand-in that answers anything, and does nothing. */
const anything: unknown = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : anything), apply: () => anything, construct: () => anything as object });
(globalThis as { accPlanVscode?: unknown }).accPlanVscode = anything;
const STUB = `data:text/javascript,${encodeURIComponent('const v = globalThis.accPlanVscode; export const window = v, workspace = v, commands = v, env = v, Uri = v, ThemeIcon = v, EventEmitter = v, StatusBarAlignment = v, MarkdownString = v, ThemeColor = v, TreeItem = v, TreeItemCollapsibleState = v, Disposable = v, ProgressLocation = v, ViewColumn = v, ConfigurationTarget = v, RelativePattern = v; export default v;')}`;
registerHooks({ resolve: (spec, ctx, next) => (spec === 'vscode' ? { url: STUB, format: 'module', shortCircuit: true } : next(spec, ctx)) });
const { TaskCommands } = await import('../src/tasks.ts');
pageDom();
const { planTicketLine } = await import('../webview/plan-behind.ts');
const { renderAnalysis } = await import('../webview/analysis.ts');

const NOW = Date.parse('2026-10-22T12:00:00Z');
const ROOT = '/r';
const person = (name: string) => ({ id: name, name });
const comment = (author: string, created: string, text: string) => ({ id: created, author: person(author), created, body: fromMarkdown(text), url: null });
const JIRA = { id: 'ACME-7', source: { kind: 'jira' as const, key: 'ACME-7', url: null } };
const TICKET = {
  key: 'ACME-7', title: 'Send back the contacts', url: 'https://acme.atlassian.net/browse/ACME-7', markdown: 'Return the 70 contacts by Friday.', body: fromMarkdown('Return the 70 contacts by Friday.'),
  comments: [comment('Kelsey', '2026-10-20T15:30:00.000Z', 'Kelsey and Mike will send back the 77 contacts by Wednesday.')], related: [],
};

/** A host that reads TICKET and its changes field, or fails as told. */
const host = (fail: { ticket?: string; changes?: string } = {}): PlanTicketHost & { asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    ticket: async (_root, key) => { asked.push(key); if (fail.ticket) throw new Error(fail.ticket); return TICKET; },
    changes: async () => { if (fail.changes) throw new Error(fail.changes); return { name: 'Deployment Notes', markdown: '- Contact: Region' }; },
  };
};

test('the Command Center writes the whole ticket for Make a plan: its comments and changes field, as acc reads it', async () => {
  const dir = tempDir('plan-ticket-');
  try {
    const h = host();
    const file = await writePlanTicketFile(h, ROOT, JIRA, dir);
    assert.deepEqual(h.asked, ['ACME-7']);
    const t = parsePlanTicket(readFileSync(file!, 'utf8'), { ...JIRA, title: 't', brief: '' } as never);
    assert.deepEqual(t.comments, [{ author: 'Kelsey', created: '2026-10-20T15:30:00.000Z', markdown: 'Kelsey and Mike will send back the 77 contacts by Wednesday.' }]);
    assert.deepEqual(t.changes, { name: 'Deployment Notes', markdown: '- Contact: Region' });
    assert.equal(t.full, true);
    // A changes field that can't be read is left out; the rest is still read.
    const partial = parsePlanTicket(readFileSync((await writePlanTicketFile(host({ changes: 'no field' }), ROOT, JIRA, dir))!, 'utf8'), { ...JIRA, title: 't', brief: '' } as never);
    assert.equal(partial.changes, null);
    assert.equal(partial.comments.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('edge: a ticket that can\'t be read hands over why, and a task with no tracker hands over nothing', async () => {
  const dir = tempDir('plan-ticket-');
  try {
    const file = await writePlanTicketFile(host({ ticket: 'Jira said 401: sign in again' }), ROOT, JIRA, dir);
    assert.deepEqual(JSON.parse(readFileSync(file!, 'utf8')), { key: 'ACME-7', unread: 'The ticket couldn\'t be read from its tracker: Jira said 401: sign in again.' });
    const h = host();
    assert.equal(await writePlanTicketFile(h, ROOT, { id: 'T-1', source: { kind: 'manual', key: null, url: null } } as never, dir), null);
    assert.deepEqual(h.asked, [], 'no tracker is asked');
    assert.equal(unreadWhy(new Error('')), 'The ticket couldn\'t be read from its tracker.');
    assert.equal(unreadWhy(new Error('offline.  ')), 'The ticket couldn\'t be read from its tracker: offline.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('edge: a ticket file that can\'t be written is removed with its folder, and the person is told in words', async () => {
  const base = tempDir('plan-folder-');
  try {
    // A folder where ticket.json is already a folder: the write fails.
    const blocked = join(base, 'blocked');
    const r = await planTicketFolder(host(), ROOT, JIRA, () => { mkdirSync(join(blocked, 'ticket.json'), { recursive: true }); return blocked; });
    assert.equal(r.file, null);
    assert.equal(r.failed, 'The ticket couldn\'t be handed to the plan (EISDIR), so this plan reads its description only and says the ticket wasn\'t read.');
    assert.ok(!existsSync(blocked), 'its folder is removed at once');
    // A folder that can't be made at all.
    const none = await planTicketFolder(host(), ROOT, JIRA, () => { throw new Error('no space left.'); });
    assert.deepEqual([none.file, none.failed], [null, 'The ticket couldn\'t be handed to the plan (no space left), so this plan reads its description only and says the ticket wasn\'t read.']);
    none.remove();
    // A task with no tracker: no file, its folder removed at once, nothing to tell.
    const manual = join(base, 'manual');
    const m = await planTicketFolder(host(), ROOT, { id: 'T-1', source: { kind: 'manual', key: null, url: null } } as never, () => { mkdirSync(manual); return manual; });
    assert.deepEqual([m.file, m.failed, existsSync(manual)], [null, null, false]);
    // A file written: kept until acc ends, then removed with its folder.
    const kept = join(base, 'kept');
    const ok = await planTicketFolder(host(), ROOT, JIRA, () => { mkdirSync(kept); return kept; });
    assert.equal(ok.failed, null);
    assert.ok(existsSync(ok.file!));
    ok.remove();
    assert.ok(!existsSync(kept));
    assert.equal(unwrittenWhy(''), 'The ticket couldn\'t be handed to the plan, so this plan reads its description only and says the ticket wasn\'t read.');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('Make a plan reads the ticket first and hands its file to acc, which is removed once acc ends', async () => {
  const ran: { command: string; onExit?: (code: number | null) => void }[] = [];
  const hub = {
    projects: [{ root: ROOT, name: 'r' }],
    ledger: () => ({ tasks: [{ ...JIRA, title: 't', brief: '' }, { id: 'T-1', title: 'm', brief: '', source: { kind: 'manual', key: null, url: null } }] }),
    analysis: () => null,
    loadTasks: async () => {},
  };
  const sidebar = { hub, acc: null, log: anything, openTicket: null, helpers: { accCommand: 'acc', run: (command: string, _cwd: string, _label: string, onExit?: (code: number | null) => void) => { ran.push({ command, onExit }); } }, terminals: new Map() };
  const h = host();
  const tasks = new TaskCommands(sidebar as never, () => false, () => false, null, h);
  const cmds = new Map<string, (...a: unknown[]) => unknown>();
  tasks.register((id, fn) => cmds.set(id, fn));
  await cmds.get('acc.task.analyze')!({ kind: 'task', project: { root: ROOT }, task: { id: 'ACME-7', source: { kind: 'jira', url: null } } });
  assert.equal(ran.length, 1);
  const m = /^acc analyze ACME-7 --ticket (\S+)$/.exec(ran[0]!.command);
  assert.ok(m, ran[0]!.command);
  // The line goes to a shell, so a path it must quote (a Windows one, with its backslashes) comes back quoted.
  const ticket = m![1]!.replace(/^'(.*)'$/, '$1');
  assert.match(readFileSync(ticket, 'utf8'), /Kelsey and Mike will send back the 77 contacts by Wednesday/);
  ran[0]!.onExit?.(0);
  assert.ok(!existsSync(ticket), 'the file is gone once acc ends');
  // A task with no tracker plans from its description: no file, and no tracker asked.
  await cmds.get('acc.task.analyze')!({ kind: 'task', project: { root: ROOT }, task: { id: 'T-1', source: { kind: 'manual', url: null } } });
  assert.equal(ran[1]!.command, 'acc analyze T-1');
  assert.deepEqual(h.asked, ['ACME-7']);
  ran[1]!.onExit?.(0);
});

const row = (more: Partial<TaskRow> = {}): TaskRow => ({ id: 'ACME-7', title: 't', state: 'todo', display: 'ready', environment: 'dev', deps: [], source: { kind: 'jira', url: null }, ...more });
const REF = { project: ROOT, task: 'ACME-7' };
const planned = (): Analysis => ({ ...sampleAnalyses(NOW)['ACME-16']!, task: 'ACME-7', ticket: planRead(planTicket(TICKET)) });
const later = [...TICKET.comments, { created: '2026-10-21T09:00:00.000Z' }, { created: '2026-10-21T10:00:00.000Z' }];

test('"2 new comments since this plan" with Make a new plan when the ticket has more, and not otherwise', () => {
  const b = planBehind(row(), planned(), later, REF)!;
  assert.deepEqual(b.look, { label: '2 new comments since this plan', icon: 'comment-discussion', tone: 'orange' });
  assert.deepEqual(b.action, { command: 'acc.task.analyze', label: 'Make a new plan', icon: 'refresh', ref: REF, primary: true });
  assert.equal(planBehind(row(), planned(), [{ created: '2026-10-22T09:00:00.000Z' }, ...TICKET.comments], REF)!.look.label, '1 new comment since this plan');
  assert.equal(planBehind(row(), planned(), TICKET.comments, REF), null, 'none new');
  assert.equal(planBehind(row(), planned(), null, REF), null, 'edge: before the ticket is read');
  assert.equal(planBehind(row({ state: 'running' }), planned(), later, REF), null, 'edge: being built, no new plan can be made');
  assert.equal(planBehind(row({ state: 'done' }), planned(), later, REF), null, 'edge: done');
  assert.equal(planBehind(row({ analyzing: { sessionId: 's' } }), planned(), later, REF), null, 'edge: a new plan is being made');
  assert.equal(planBehind(row(), { ...planned(), ticket: undefined }, later, REF), null, 'edge: a plan from before plans kept what they read');
  assert.equal(planBehind(row(), null, later, REF), null, 'edge: no plan');
  const failed = { ...planned(), ticket: { full: false, why: 'offline', comments: 0, omitted: 0, newest: null, related: 0, attachments: 0, changes: null } };
  assert.equal(planBehind(row(), failed, later, REF)!.look.label, '3 comments this plan didn\'t read', 'edge: its read failed');
});

test('the plan section carries what it read, and its Make a new plan moves onto the line when it\'s behind', () => {
  const r = planTicketRead(row(), planned(), later, REF);
  assert.equal(r.read, 'This plan read the ticket, its 1 comment. The newest comment it read is Kelsey\'s, 2026-10-20.');
  const an = { actions: [{ command: 'acc.task.analyze', label: 'Make a new plan', icon: 'refresh', ref: REF }, { command: 'acc.task.watchAnalysis', label: 'w', icon: 'pulse', ref: REF }] };
  assert.deepEqual(withTicketRead(an, r)!.actions.map((a) => a.command), ['acc.task.watchAnalysis'], 'one Make a new plan, on the line');
  assert.equal(withTicketRead(an, planTicketRead(row(), planned(), TICKET.comments, REF))!.actions.length, 2, 'not behind: it stays where it was');
  assert.equal(withTicketRead(null, r), null, 'edge: no plan section');
});

test('a ticket with a conversation has Make a new plan in its panel alone, and the plan section still says it is behind (T-116)', () => {
  const behind = { ...sampleTicket(NOW, 'ACME-21', false, null, null, 'behind'), talk: sampleTalkTicket(NOW).talk };
  assert.ok(behind.talk!.newPlan, 'the conversation offers it');
  const drawn = renderAnalysis(behind, behind.analysis!) as unknown as PageElement;
  const buttons = (p: PageElement) => p.all().filter((x) => x.tagName === 'BUTTON' && x.textContent === 'Make a new plan');
  assert.equal(buttons(drawn).length, 0, 'none in the plan section');
  assert.match(drawn.all('plan-behind')[0]!.textContent, /2 new comments since this plan/);
  assert.ok(drawn.all('an-actions').every((a) => !/Make a new plan/.test(a.textContent)), 'nor among its other actions');
  // Edge: said nothing yet, so there is no panel offer, and the plan section keeps it.
  const quiet = { ...behind, talk: { ...behind.talk!, newPlan: null } };
  assert.equal(buttons(renderAnalysis(quiet, quiet.analysis!) as unknown as PageElement).length, 1, 'edge: without a conversation it stays here');
});

test('the page draws the line and Make a new plan where ACME-21 is behind, and names the comments it read either way', () => {
  const behind = sampleTicket(NOW, 'ACME-21', false, null, null, 'behind');
  assert.equal(behind.analysis!.ticketRead!.behind!.look.label, '2 new comments since this plan');
  const drawn = renderAnalysis(behind, behind.analysis!) as unknown as PageElement;
  // Right under the plan's top line (T-136), before its row of actions and its sections.
  const order = drawn.children.filter((c): c is PageElement => typeof c !== 'string').map((c) => c.className.split(' ')[0]);
  assert.ok(order.indexOf('an-head') === 0 && order.indexOf('plan-ticket') === 1, order.join(','));
  assert.ok(order.indexOf('plan-ticket') < order.indexOf('actions') && order.indexOf('plan-ticket') < order.indexOf('an-sec'), order.join(','));
  assert.ok(drawn.all('an-sec').every((s) => !s.all('plan-ticket').length), 'not folded in a section');
  const line = drawn.all('plan-behind');
  assert.equal(line.length, 1, 'in the plan section');
  assert.match(line[0]!.textContent, /2 new comments since this plan/);
  assert.equal(line[0]!.all().filter((x) => x.tagName === 'BUTTON' && x.textContent === 'Make a new plan').length, 1);
  assert.equal(drawn.all().filter((x) => x.tagName === 'BUTTON' && x.textContent === 'Make a new plan').length, 1, 'once on the page');
  assert.match(drawn.all('plan-read')[0]!.textContent, /This plan read the ticket, its 2 comments\. The newest comment it read is Jordan Kim's/);
  const now = sampleTicket(NOW, 'ACME-21');
  const current = planTicketLine(now.analysis!) as unknown as PageElement;
  assert.equal(current.all('plan-behind').length, 0, 'not behind: no line');
  assert.equal(current.all('plan-read').length, 1);
  assert.equal(planTicketLine({ ...now.analysis!, ticketRead: { read: null, behind: null } }), null, 'edge: an older plan kept nothing of what it read');
  assert.ok(sampleAnalyses(NOW)['ACME-21']!.findings.some((f) => /\(Jordan Kim, \d{4}-\d{2}-\d{2}\)/.test(f.detail)), 'a finding names the comment it rests on');
});
