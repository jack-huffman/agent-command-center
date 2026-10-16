// Dispatch's sheet (D-168), with the built extension against the vscode stand-in: Dispatch, and Dispatch
// with…, Dispatch to the cloud and Dispatch anyway, kept for one release, each open the sheet rather than
// dispatching. From the Command Center, the sheet shows over it; from a task's own tab, over that tab; from
// the modal over the board, over the Command Center; with the Command Center closed, it opens first, then
// the sheet. The sheet's Dispatch reaches acc dispatch. Run after npm run build.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import type { DispatchSheet } from '../src/model/dispatch-sheet.ts';
import { openSheet, SHEET_MESSAGE, sheetInput } from '../src/dispatch-sheet.ts';
import { makeRepo } from '../../packages/core/test/support.ts';
import { activate, fakeVscode, sandboxEnv, until } from './vscode.ts';
import { row } from './support.ts';

const dist = fileURLToPath(new URL('../dist/extension.js', import.meta.url));

type Tab = ReturnType<typeof fakeVscode>['panels'][number];
type Msg = { type?: string; sheet?: DispatchSheet; model?: { kind: string; key?: string; loading?: boolean }; [k: string]: unknown };

const s = {} as { fake: ReturnType<typeof fakeVscode>; started: ReturnType<typeof activate>; repo: string; root: string; tab: Tab; id: string; restore: () => void };

before(async () => {
  const { at, restore } = sandboxEnv('acc-dispatch-sheet-');
  s.restore = restore;
  s.repo = makeRepo({ '.acc/config.json': JSON.stringify({ schema: 1, project: 'Tool', environments: [{ name: 'main', default: true }], trackers: [] }), '.gitignore': '.claude/worktrees/\n' });
  s.fake = fakeVscode(s.repo);
  const version = (JSON.parse(readFileSync(join(dist, '..', '..', 'package.json'), 'utf8')) as { version: string }).version;
  s.started = activate(dist, s.fake, { 'acc.welcomed': true, 'acc.machineItems': { at: Date.now(), profile: 'generic', version, items: [{ id: 'A1.git', part: 'machine', title: 'git', status: 'pass', detail: '' }] } });
  const { calls, panels } = s.fake;
  await until(() => calls.contexts.get('acc.profile') === 'generic' && calls.contexts.has('acc.step.A1.git'), 60_000);
  await until(() => calls.contexts.get('acc.hasProject') === true && readdirSync(at('state', 'questions')).length > 0, 60_000);
  const r = spawnSync(process.execPath, [join(dist, '..', 'bin', 'acc.mjs'), 'add', 'Write the report'], { cwd: s.repo, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  await calls.commands.get('acc.tasks.refresh')!();
  await calls.commands.get('acc.open.tasks')!();
  s.tab = panels[0]!;
  s.tab.receive!({ type: 'ready' });
  const home = s.tab.posted.at(-1) as { model: { tasks: { projects: { root: string; columns: { cards: { id: string }[] }[] }[] } } };
  const p = home.model.tasks.projects[0]!;
  s.root = p.root;
  s.id = p.columns.flatMap((c) => c.cards.map((x) => x.id))[0]!;
});

after(() => {
  s.started?.stop();
  delete createRequire(import.meta.url).cache[dist];
  s.restore();
});

const since = (tab: Tab, from: number): Msg[] => tab.posted.slice(from) as Msg[];
const sheetIn = (msgs: Msg[]): DispatchSheet | undefined => msgs.find((m) => m.type === SHEET_MESSAGE)?.sheet;

/** What a page's run message for a command does: the command it executed, then that command run with what it was given. */
async function runFrom(tab: Tab, command: string): Promise<void> {
  const { calls } = s.fake;
  const from = calls.executed.length;
  tab.receive!({ type: 'run', command, ref: { project: s.root, task: s.id } });
  const ran = calls.executed.slice(from).find(([id]) => id === command);
  if (ran) await calls.commands.get(command)!(...ran[1]);
}

test('Dispatch, and the commands kept for one release, open the sheet over the Command Center and dispatch nothing (D-168)', async () => {
  for (const command of ['acc.task.dispatch', 'acc.task.dispatchWith', 'acc.task.dispatchCloud', 'acc.task.dispatchAnyway']) {
    const from = s.tab.posted.length;
    const warned = s.fake.calls.warn.length;
    await runFrom(s.tab, command);
    await until(() => !!sheetIn(since(s.tab, from)), 20_000, `${command}'s sheet`);
    const sheet = sheetIn(since(s.tab, from))!;
    assert.deepEqual([sheet.project, sheet.task, sheet.title], [s.root, s.id, `Dispatch ${s.id}`], command);
    assert.equal(sheet.anyway, command === 'acc.task.dispatchAnyway', `${command}: anyway`);
    // Not on GitHub: the cloud is off with its reason, so even Dispatch to the cloud starts on This Mac.
    assert.deepEqual([sheet.place, sheet.places[1]!.disabled], ['local', 'Cloud builders need the repo on GitHub'], command);
    assert.equal(s.fake.calls.warn.length, warned, `${command} ran no acc dispatch`);
  }
  const t = JSON.parse(readFileSync(join(s.repo, '.git', 'acc', 'ledger.json'), 'utf8')) as { tasks: { id: string; state: string }[] };
  assert.equal(t.tasks.find((x) => x.id === s.id)?.state, 'todo', 'still to do: nothing was dispatched');
});

test('from a task\'s own tab, Dispatch opens the sheet over that tab, and runs no command; from the modal, over the Command Center (D-168)', async () => {
  const { calls, panels } = s.fake;
  const n = panels.length;
  await runFrom(s.tab, 'acc.task.show');
  const page = panels.length > n ? panels.at(-1)! : panels.find((x) => x.html.includes('data-view="ticket"'))!;
  page.receive!({ type: 'ready' });
  await until(() => (page.posted as Msg[]).some((m) => m.type === 'state' && m.model?.key === s.id && !m.model.loading));
  const ran = calls.executed.length;
  const pageFrom = page.posted.length;
  const tabFrom = s.tab.posted.length;
  page.receive!({ type: 'run', command: 'acc.task.dispatch', ref: { project: s.root, task: s.id } });
  await until(() => !!sheetIn(since(page, pageFrom)), 20_000, 'the sheet over the tab');
  assert.equal(sheetIn(since(page, pageFrom))!.task, s.id);
  assert.ok(!calls.executed.slice(ran).some(([id]) => id === 'acc.task.dispatch'), 'the tab shows it itself, not through the command');
  assert.equal(sheetIn(since(s.tab, tabFrom)), undefined, 'not over the Command Center');
  page.close!();
  // The modal over the board: its run is the modal's, and the sheet comes to the Command Center's page, over it.
  const peekFrom = s.tab.posted.length;
  s.tab.receive!({ type: 'task-modal-open', project: s.root, key: s.id });
  await until(() => since(s.tab, peekFrom).some((m) => m.type === 'task-modal' && m.model?.key === s.id && !m.model.loading));
  const modalFrom = s.tab.posted.length;
  const ranModal = calls.executed.length;
  s.tab.receive!({ type: 'run', command: 'acc.task.dispatch', ref: { project: s.root, task: s.id } });
  await until(() => !!sheetIn(since(s.tab, modalFrom)), 20_000, 'the sheet over the modal');
  assert.ok(!calls.executed.slice(ranModal).some(([id]) => id === 'acc.task.dispatch'));
  s.tab.receive!({ type: 'task-modal-close', project: s.root, key: s.id });
});

test('with the Command Center closed, Dispatch opens it, then the sheet once it is ready (D-168)', async () => {
  const { calls, panels } = s.fake;
  const node = calls.executed.findLast(([id]) => id === 'acc.task.dispatch')?.[1];
  assert.ok(node, 'a node to dispatch, as a row or a notice gives one');
  s.tab.close!();
  const n = panels.length;
  await calls.commands.get('acc.task.dispatch')!(...node);
  await until(() => panels.length > n, 20_000, 'the Command Center opening');
  const tab = panels.at(-1)!;
  assert.equal(sheetIn(tab.posted as Msg[]), undefined, 'nothing posted before the page is ready');
  tab.receive!({ type: 'ready' });
  await until(() => !!sheetIn(tab.posted as Msg[]), 20_000, 'the sheet');
  const order = (tab.posted as Msg[]).map((m) => m.type);
  assert.ok(order.indexOf('state') < order.indexOf(SHEET_MESSAGE), 'the page first, then the sheet over it');
  s.tab = tab;
});

test('the sheet\'s Dispatch reaches acc dispatch, and one for a task that has gone says so (D-168)', async () => {
  const { calls } = s.fake;
  // A model chosen in the sheet reaches acc dispatch as --model: one that isn't a model name, acc refuses by name.
  const warned = calls.warn.length;
  s.tab.receive!({ type: 'dispatch-sheet-go', project: s.root, task: s.id, model: 'not a model', effort: 'high', where: 'local' });
  await until(() => calls.warn.length > warned, 60_000, 'acc dispatch to refuse');
  assert.match(calls.warn.at(-1)!, /"not a model" isn't a model name/);
  // The defaults send no model: acc goes on to start the builder, which this folder's trust stops, as acc says.
  const again = calls.warn.length;
  s.tab.receive!({ type: 'dispatch-sheet-go', project: s.root, task: s.id, model: 'claude-opus-5-5', effort: null, where: 'local' });
  await until(() => calls.warn.length > again, 60_000, 'acc dispatch to answer');
  assert.match(calls.warn.at(-1)!, /doesn't trust/);
  const gone = calls.info.length;
  s.tab.receive!({ type: 'dispatch-sheet-go', project: s.root, task: 'T-999', model: 'claude-sonnet-5-5', where: 'local' });
  await until(() => calls.info.length > gone);
  assert.equal(calls.info.at(-1), 'T-999 isn\'t there to dispatch any more.');
});

test('openSheet and sheetInput: a task that isn\'t there opens nothing, and say posts to the page that asked, else the Command Center (D-168)', () => {
  const builder = { model: 'claude-opus-5-5', effort: null, from: { model: 'acc', effort: 'default' } };
  const hub = { project: (r: string) => (r === '/r' ? { config: { github: null }, agents: { builder } } : undefined), taskRows: () => [{ ...row('T-1', 'todo', 'ready'), deps: [] }] } as never;
  const told: unknown[] = [];
  const said: unknown[] = [];
  const panels = { tell: async (m: unknown) => { told.push(m); } };
  assert.equal(sheetInput(hub, '/r', 'T-2'), null, 'no such task');
  assert.equal(sheetInput(hub, '/nowhere', 'T-1'), null, 'no such project');
  assert.equal(openSheet(hub, panels, '/r', 'T-2'), false);
  assert.deepEqual([told.length, said.length], [0, 0], 'nothing opened');
  assert.equal(openSheet(hub, panels, '/r', 'T-1', { where: 'cloud' }), true);
  assert.equal((told[0] as Msg).type, SHEET_MESSAGE, 'the Command Center, with no page that asked');
  assert.equal(openSheet(hub, panels, '/r', 'T-1', { anyway: true }, (m) => said.push(m)), true);
  assert.deepEqual([told.length, (said[0] as Msg).sheet!.anyway], [1, true], 'the page that asked');
  assert.deepEqual(sheetInput(hub, '/r', 'T-1', { where: 'cloud' })?.where, 'cloud');
});
