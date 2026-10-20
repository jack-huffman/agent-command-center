// The task sheet (T-74), with the built extension against the vscode stand-in: Add task opens the sheet
// and its Add task reaches acc add; Edit opens it filled in, over a task's own tab when asked there, and
// its Save reaches acc edit; a task whose builder runs has Edit off with the reason, and the command says
// it. Run after npm run build.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import type { TaskSheet } from '../src/model/task-sheet.ts';
import { TASK_SHEET_MESSAGE } from '../src/model/task-sheet.ts';
import { makeRepo } from '../../packages/core/test/support.ts';
import { activate, fakeVscode, sandboxEnv, until } from './vscode.ts';

const dist = fileURLToPath(new URL('../dist/extension.js', import.meta.url));

type Tab = ReturnType<typeof fakeVscode>['panels'][number];
type Card = { id: string; actions: { command: string; disabled?: string }[] };
type Msg = { type?: string; sheet?: TaskSheet; model?: { kind: string; key?: string; loading?: boolean; tasks?: { projects: { root: string; columns: { cards: Card[] }[] }[] } }; [k: string]: unknown };

const s = {} as { fake: ReturnType<typeof fakeVscode>; started: ReturnType<typeof activate>; repo: string; root: string; tab: Tab; restore: () => void };

const acc = (...args: string[]) => spawnSync(process.execPath, [join(dist, '..', 'bin', 'acc.mjs'), ...args], { cwd: s.repo, encoding: 'utf8' });
const ledger = () => join(s.repo, '.git', 'acc', 'ledger.json');
// No ledger yet is no tasks: acc writes it with the first.
const tasks = () => ((existsSync(ledger()) ? JSON.parse(readFileSync(ledger(), 'utf8')) : { tasks: [] }) as { tasks: { id: string; title: string; brief: string; labels: string[]; notes?: string; state: string }[] }).tasks;
const since = (tab: Tab, from: number): Msg[] => tab.posted.slice(from) as Msg[];
const sheetIn = (msgs: Msg[]): TaskSheet | undefined => msgs.find((m) => m.type === TASK_SHEET_MESSAGE)?.sheet;

/** What a page's run message for a command does: the command it executed, then that command run with what it was given. */
async function runFrom(tab: Tab, command: string): Promise<void> {
  const { calls } = s.fake;
  const from = calls.executed.length;
  tab.receive!({ type: 'run', command, ref: { project: s.root, task: 'T-1' } });
  const ran = calls.executed.slice(from).find(([id]) => id === command);
  if (ran) await calls.commands.get(command)!(...ran[1]);
}

before(async () => {
  const { at, restore } = sandboxEnv('acc-task-sheet-');
  s.restore = restore;
  s.repo = makeRepo({ '.acc/config.json': JSON.stringify({ schema: 1, project: 'Tool', environments: [{ name: 'main', default: true }], trackers: [] }), '.gitignore': '.claude/worktrees/\n' });
  s.fake = fakeVscode(s.repo);
  const version = (JSON.parse(readFileSync(join(dist, '..', '..', 'package.json'), 'utf8')) as { version: string }).version;
  s.started = activate(dist, s.fake, { 'acc.welcomed': true, 'acc.machineItems': { at: Date.now(), profile: 'generic', version, items: [{ id: 'A1.git', part: 'machine', title: 'git', status: 'pass', detail: '' }] } });
  const { calls, panels } = s.fake;
  await until(() => calls.contexts.get('acc.profile') === 'generic' && calls.contexts.has('acc.step.A1.git'), 60_000);
  await until(() => calls.contexts.get('acc.hasProject') === true && readdirSync(at('state', 'questions')).length > 0, 60_000);
  await calls.commands.get('acc.open.tasks')!();
  s.tab = panels[0]!;
  s.tab.receive!({ type: 'ready' });
  s.root = (s.tab.posted.at(-1) as Msg).model!.tasks!.projects[0]!.root;
});

after(() => {
  s.started?.stop();
  delete createRequire(import.meta.url).cache[dist];
  s.restore();
});

test('Add task opens the sheet for a new task, and its Add task reaches acc add with every field (T-74)', async () => {
  const { calls } = s.fake;
  const from = s.tab.posted.length;
  await calls.commands.get('acc.task.add')!();
  await until(() => !!sheetIn(since(s.tab, from)), 20_000, 'the sheet');
  const sheet = sheetIn(since(s.tab, from))!;
  assert.deepEqual([sheet.task, sheet.heading, sheet.go, sheet.fields.environment], [null, 'New task in Tool', 'Add task', 'main']);
  assert.ok(!tasks().length, 'the sheet adds nothing by itself');
  s.tab.receive!({ type: 'task-sheet-go', project: s.root, title: '-Write the report', brief: '- one\n- two', deps: '', environment: 'main', labels: 'docs', notes: '' });
  await until(() => tasks().length === 1, 60_000, 'acc add');
  assert.deepEqual(tasks().map((t) => [t.id, t.title, t.brief, t.labels]), [['T-1', '-Write the report', '- one\n- two', ['docs']]]);
});

test('Edit opens the sheet filled in over a task\'s own tab, and its Save reaches acc edit (T-74)', async () => {
  const { calls, panels } = s.fake;
  await calls.commands.get('acc.tasks.refresh')!();
  const n = panels.length;
  await runFrom(s.tab, 'acc.task.show');
  const page = panels.length > n ? panels.at(-1)! : panels.find((x) => x.html.includes('data-view="ticket"'))!;
  page.receive!({ type: 'ready' });
  await until(() => (page.posted as Msg[]).some((m) => m.type === 'state' && m.model?.key === 'T-1' && !m.model.loading));
  const ran = calls.executed.length;
  const pageFrom = page.posted.length;
  const tabFrom = s.tab.posted.length;
  page.receive!({ type: 'run', command: 'acc.task.edit', ref: { project: s.root, task: 'T-1' } });
  await until(() => !!sheetIn(since(page, pageFrom)), 20_000, 'the sheet over the tab');
  const sheet = sheetIn(since(page, pageFrom))!;
  assert.deepEqual([sheet.task, sheet.heading, sheet.go, sheet.fields.title, sheet.fields.labels, sheet.notes], ['T-1', 'Edit T-1', 'Save', '-Write the report', 'docs', true]);
  assert.ok(!calls.executed.slice(ran).some(([id]) => id === 'acc.task.edit'), 'the tab shows it itself, not through the command');
  assert.equal(sheetIn(since(s.tab, tabFrom)), undefined, 'not over the Command Center');
  page.receive!({ type: 'task-sheet-go', project: s.root, task: 'T-1', ...sheet.fields, title: 'Write the report', notes: 'Use the 2025 numbers.' });
  // acc writes the ledger before it answers: the edit is done once the extension says so.
  await until(() => calls.info.at(-1) === 'Saved T-1.', 60_000, 'acc edit');
  assert.equal(tasks()[0]!.notes, 'Use the 2025 numbers.');
  assert.equal(tasks()[0]!.title, 'Write the report');
  const info = calls.info.length;
  page.receive!({ type: 'task-sheet-go', project: s.root, task: 'T-1', ...sheet.fields, title: 'Write the report', notes: 'Use the 2025 numbers.' });
  await until(() => calls.info.length > info);
  assert.equal(calls.info.at(-1), 'Nothing changed in T-1.', 'edge: a Save that changes nothing runs nothing');
  page.close!();
});

test('a task whose builder runs has Edit off with the reason, and Edit on it says why and opens nothing (T-74)', async () => {
  const { calls } = s.fake;
  assert.equal(acc('set', 'T-1', 'running').status, 0);
  const from = s.tab.posted.length;
  await calls.commands.get('acc.tasks.refresh')!();
  s.tab.receive!({ type: 'ready' });
  await until(() => since(s.tab, from).some((m) => m.model?.tasks?.projects[0]?.columns.some((c) => c.cards.some((x) => x.id === 'T-1' && x.actions.some((a) => a.command === 'acc.task.edit' && a.disabled)))), 20_000, 'Edit off on the card');
  const card = since(s.tab, from).flatMap((m) => m.model?.tasks?.projects[0]?.columns.flatMap((c) => c.cards) ?? []).findLast((x) => x.id === 'T-1')!;
  assert.equal(card.actions.find((a) => a.command === 'acc.task.edit')!.disabled, 'Its builder is working from the brief it was given. Edit it once the builder stops.');
  const info = calls.info.length;
  const sheetFrom = s.tab.posted.length;
  await runFrom(s.tab, 'acc.task.edit');
  await until(() => calls.info.length > info, 20_000, 'why');
  assert.equal(calls.info.at(-1), 'T-1 can\'t be edited now. Its builder is working from the brief it was given. Edit it once the builder stops.');
  assert.equal(sheetIn(since(s.tab, sheetFrom)), undefined, 'no sheet');
  assert.equal(tasks()[0]!.title, 'Write the report');
});
