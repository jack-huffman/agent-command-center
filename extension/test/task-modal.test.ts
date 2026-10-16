// A task opened from the Tasks board in a modal over the board (GH-158). Which of the page's messages are
// the modal's is tested here, then the built extension against the vscode stand-in: a card's click gives
// the Command Center's tab the task's model and opens no tab of its own, Open as tab opens the tab as a
// card's click did, and what the modal sends is handled as its tab's is. Run after npm run build.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import type { FromWebview } from '../src/model/messages.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { modalTakes } from '../src/model/task-modal.ts';
import { makeRepo, tempDir } from '../../packages/core/test/support.ts';
import { activate, fakeVscode, until } from './vscode.ts';

const dist = fileURLToPath(new URL('../dist/extension.js', import.meta.url));

test('the modal takes what only a task\'s page sends, and its own task\'s messages; the rest stay the page\'s (GH-158)', () => {
  const o = { project: '/r', key: 'T-1' };
  const commands = new Set(['acc.task.move', 'acc.task.block', 'acc.trackers.signIn']);
  const takes = (m: Record<string, unknown>) => {
    assert.ok(isFromWebview(m), `${JSON.stringify(m)} is a message the page may send`);
    return modalTakes(o, m as FromWebview, commands);
  };
  const cases: [Record<string, unknown>, boolean, string][] = [
    [{ type: 'ticket-action', action: 'refresh' }, true, 'only a task\'s page sends it'],
    [{ type: 'update-edit', project: '/r', id: 'T-1.1', text: 'x' }, true, 'only a task\'s page sends it'],
    [{ type: 'analysis-answer', project: '/r', task: 'T-1', question: 'q1', text: 'Yes.' }, true, 'its task\'s question'],
    [{ type: 'analysis-answer', project: '/r', task: 'T-2', question: 'q1', text: 'Yes.' }, false, 'another task\'s, as from Needs you'],
    [{ type: 'analysis-answer', project: '/other', task: 'T-1', question: 'q1', text: 'Yes.' }, false, 'another project\'s'],
    [{ type: 'update-post', project: '/r', id: 'T-1.2', text: 'Hello' }, true, 'its task\'s update'],
    [{ type: 'update-discard', project: '/r', id: 'T-1.2' }, true, 'its task\'s update'],
    [{ type: 'update-discard', project: '/r', id: 'T-10.2' }, false, 'not T-1\'s'],
    [{ type: 'update-ask', project: '/r', task: 'T-1', question: 'q2' }, true, 'its task\'s question, to the client'],
    [{ type: 'run', command: 'acc.task.move', ref: { project: '/r', task: 'T-1' } }, true, 'a command its tab may run, for its task'],
    [{ type: 'run', command: 'acc.task.show', ref: { project: '/r', task: 'T-1' } }, false, 'Open as tab: what the card sent before, the page\'s'],
    [{ type: 'run', command: 'acc.task.move', ref: { project: '/r', task: 'T-2' } }, false, 'another task\'s'],
    [{ type: 'toolbar', command: 'acc.trackers.signIn', arg: '{"root":"/r","index":0}' }, true, 'its sign-in'],
    [{ type: 'toolbar', command: 'acc.task.add', project: '/r' }, false, 'a command its tab can\'t run'],
    [{ type: 'ticket', project: '/r', tracker: null, key: 'T-1' }, false, 'Open as tab from a tracker\'s card, and a related ticket: a tab, as before'],
    [{ type: 'open', url: 'https://example.com' }, false, 'a link opens the same from either'],
    [{ type: 'ready' }, false, 'the page itself'],
    [{ type: 'nav', section: 'tasks' }, false, 'the page itself'],
  ];
  for (const [m, want, why] of cases) assert.equal(takes(m), want, `${m.type}: ${why}`);
  assert.ok(cases.filter(([, want]) => want).length >= 8 && cases.filter(([, want]) => !want).length >= 8);
  assert.ok(isFromWebview({ type: 'task-modal-open', project: '/r', key: 'T-1' }) && isFromWebview({ type: 'task-modal-open', project: '/r', tracker: 0, key: 'ACME-1' }) && isFromWebview({ type: 'task-modal-open', project: '/r', tracker: null, key: 'T-1' }));
  assert.ok(!isFromWebview({ type: 'task-modal-open', project: '/r', tracker: 'x', key: 'T-1' }) && !isFromWebview({ type: 'task-modal-open', project: '/r', key: 'not a key' }));
  assert.ok(isFromWebview({ type: 'task-modal-close', project: '/r', key: 'T-1' }) && !isFromWebview({ type: 'task-modal-close' }));
});

type Tab = ReturnType<typeof fakeVscode>['panels'][number];
type Msg = { type?: string; action?: string; ok?: boolean; error?: string; id?: string; model?: { kind: string; key: string; title: string; loading?: boolean; acc?: { look: { label: string } } | null; overview?: { attention: Row[] } }; tab?: Record<string, unknown>; [k: string]: unknown };
type Row = { look: { label: string }; update?: { id: string; edited: string | null } };

/** The built extension in a repo of its own, in a sandbox, as first-open.test.ts runs it, with two tasks and the Command Center open at Tasks. */
const s = {} as {
  fake: ReturnType<typeof fakeVscode>; started: ReturnType<typeof activate>; repo: string; root: string; tab: Tab; ids: [string, string];
  saved: NodeJS.ProcessEnv; acc: (...a: string[]) => void;
};

before(async () => {
  const sandbox = realpathSync(tempDir('acc-task-modal-'));
  const at = (...p: string[]) => join(sandbox, ...p);
  for (const d of ['home/.claude', 'state/questions', 'state/heavy', 'state/slack', 'bin']) mkdirSync(at(d), { recursive: true });
  writeFileSync(at('home', '.claude.json'), '{"projects":{}}\n');
  for (const name of ['gh', 'claude', 'sf', 'code', 'open', 'osascript', 'caffeinate']) {
    writeFileSync(at('bin', name), '#!/bin/sh\nexit 1\n');
    chmodSync(at('bin', name), 0o755);
  }
  s.saved = { ...process.env };
  Object.assign(process.env, {
    HOME: at('home'), CLAUDE_CONFIG_DIR: at('home', '.claude'), PATH: `${at('bin')}:${process.env.PATH}`, NO_COLOR: '1',
    ACC_QUESTIONS_DIR: at('state', 'questions'), ACC_HEAVY_DIR: at('state', 'heavy'), ACC_MACHINE_FILE: at('state', 'machine.json'), ACC_REPOS_FILE: at('state', 'repos.json'),
    ACC_RUNTIME_FILE: at('state', 'runtime'), ACC_SLACK_DIR: at('state', 'slack'),
  });
  delete process.env.ACC_ROLE;
  delete process.env.ACC_TASK;
  s.repo = makeRepo({ '.acc/config.json': JSON.stringify({ schema: 1, project: 'Tool', environments: [{ name: 'main', default: true }], trackers: [] }), '.gitignore': '.claude/worktrees/\n' });
  s.fake = fakeVscode(s.repo);
  const version = (JSON.parse(readFileSync(join(dist, '..', '..', 'package.json'), 'utf8')) as { version: string }).version;
  s.started = activate(dist, s.fake, { 'acc.welcomed': true, 'acc.machineItems': { at: Date.now(), profile: 'generic', version, items: [{ id: 'A1.git', part: 'machine', title: 'git', status: 'pass', detail: '' }] } });
  const { calls, panels } = s.fake;
  await until(() => calls.contexts.get('acc.profile') === 'generic' && calls.contexts.has('acc.step.A1.git'), 60_000);
  await until(() => calls.contexts.get('acc.hasProject') === true && readdirSync(at('state', 'questions')).length > 0, 60_000);
  const accBin = join(dist, '..', 'bin', 'acc.mjs');
  s.acc = (...a: string[]) => {
    const r = spawnSync(process.execPath, [accBin, ...a], { cwd: s.repo, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  };
  s.acc('add', 'Write the report');
  s.acc('add', 'Check the figures');
  await calls.commands.get('acc.tasks.refresh')!();
  await calls.commands.get('acc.open.tasks')!();
  s.tab = panels[0]!;
  s.tab.receive!({ type: 'ready' });
  const home = s.tab.posted.at(-1) as { model: { tasks: { projects: { root: string; columns: { cards: { id: string }[] }[] }[] } } };
  const p = home.model.tasks.projects[0]!;
  s.root = p.root;
  const ids = p.columns.flatMap((c) => c.cards.map((x) => x.id)).sort();
  assert.equal(ids.length, 2);
  s.ids = [ids[0]!, ids[1]!];
});

after(() => {
  s.started?.stop();
  delete createRequire(import.meta.url).cache[dist];
  for (const k of Object.keys(process.env)) if (!(k in s.saved)) delete process.env[k];
  Object.assign(process.env, s.saved);
});

/** Waits for what's named, and says which when it never comes. */
const wait = (what: string, fn: () => boolean): Promise<void> => until(fn).catch(() => { throw new Error(`Timed out waiting for ${what}.`); });
const since = (tab: Tab, from: number): Msg[] => tab.posted.slice(from) as Msg[];
const modalFor = (msgs: Msg[], key: string): Msg | undefined => msgs.filter((m) => m.type === 'task-modal' && m.model?.key === key && !m.model.loading).at(-1);
const stateFor = (msgs: Msg[], key: string): Msg | undefined => msgs.filter((m) => m.type === 'state' && m.model?.key === key && !m.model.loading).at(-1);
const doneIn = (msgs: Msg[], action: string): Msg | undefined => msgs.find((m) => m.type === 'done' && m.action === action);

/** A card's click on the Tasks board, as the page sends it, and the model the extension sends back. */
async function peek(key: string, tracker?: number | null): Promise<Msg> {
  const from = s.tab.posted.length;
  s.tab.receive!({ type: 'task-modal-open', project: s.root, key, ...(tracker === undefined ? {} : { tracker }) });
  await until(() => !!modalFor(since(s.tab, from), key));
  return modalFor(since(s.tab, from), key)!;
}

/** The modal closes, as the page says when Close, Escape, the backdrop or Open as tab closes it. */
const shut = (key: string) => s.tab.receive!({ type: 'task-modal-close', project: s.root, key });

/** A task's own tab, opened as a card's click opened it before (GH-158), and ready. */
async function tabFor(key: string): Promise<Tab> {
  const { calls, panels } = s.fake;
  const n = panels.length;
  const from = calls.executed.length;
  s.tab.receive!({ type: 'run', command: 'acc.task.show', ref: { project: s.root, task: key } });
  const [, args] = calls.executed.slice(from).find(([id]) => id === 'acc.task.show')!;
  await calls.commands.get('acc.task.show')!(...args);
  const page = panels.length > n ? panels.at(-1)! : panels.find((x) => x.html.includes(`<title>${key}</title>`))!;
  page.receive!({ type: 'ready' });
  await until(() => !!stateFor(page.posted as Msg[], key));
  return page;
}

test('a card\'s click from the Tasks board gives the Command Center\'s tab the task\'s model, and opens no ticket tab (GH-158)', async () => {
  const [one, two] = s.ids;
  const tabs = s.fake.panels.length;
  // From the agent board, with no tracker: the key decides, as acc.task.show's tab does.
  const m = await peek(one);
  assert.equal(s.fake.panels.length, tabs, 'no new tab');
  assert.deepEqual([m.model!.kind, m.model!.key, m.model!.title], ['ticket', one, 'Write the report']);
  assert.deepEqual(m.tab, { type: 'run', command: 'acc.task.show', ref: { project: s.root, task: one } }, 'Open as tab sends what the card sent before');
  // The tab's model, from the same function: what the task's own tab shows.
  const page = await tabFor(one);
  const own = stateFor(page.posted as Msg[], one)!.model!;
  assert.deepEqual(Object.keys(m.model!).sort(), Object.keys(own).sort());
  assert.deepEqual([m.model!.title, m.model!.acc?.look.label], [own.title, own.acc?.look.label]);
  page.close!();
  shut(one);
  // From a tracker's board, its card names the tracker, null here for acc's own: Open as tab sends that ticket.
  const later = s.fake.panels.length;
  const t = await peek(two, null);
  assert.equal(s.fake.panels.length, later, 'no new tab');
  assert.deepEqual(t.tab, { type: 'ticket', project: s.root, tracker: null, key: two });
  shut(two);
  // A project that isn't open here opens nothing.
  const from = s.tab.posted.length;
  s.tab.receive!({ type: 'task-modal-open', project: '/nowhere', key: one });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(since(s.tab, from).filter((x) => x.type === 'task-modal').length, 0);
});

test('Open as tab opens the ticket tab as a card\'s click did, and the closed modal is drawn no more (GH-158)', async () => {
  const [one, two] = s.ids;
  const { calls, panels } = s.fake;
  // The agent board's card: the page closes the modal, then sends acc.task.show, which opens the tab.
  const m = await peek(one);
  shut(one);
  const ran = calls.executed.length;
  s.tab.receive!(m.tab);
  const shown = calls.executed.slice(ran).filter(([id]) => id === 'acc.task.show');
  assert.equal(shown.length, 1, 'the page runs it, as it did for a card\'s click');
  assert.equal((shown[0]![1][0] as { task: { id: string } }).task.id, one);
  const n = panels.length;
  await calls.commands.get('acc.task.show')!(...shown[0]![1]);
  assert.equal(panels.length, n + 1, 'a tab of its own');
  const page = panels.at(-1)!;
  assert.match(page.html, /data-view="ticket"/);
  page.receive!({ type: 'ready' });
  await until(() => !!stateFor(page.posted as Msg[], one));
  // Closed, the modal isn't drawn again: a change redraws the tab alone.
  const from = s.tab.posted.length;
  const pageFrom = page.posted.length;
  s.acc('set', one, 'blocked', '--reason', 'Waiting on the numbers');
  await calls.commands.get('acc.tasks.refresh')!();
  await until(() => stateFor(since(page, pageFrom), one)?.model?.acc?.look.label === 'Blocked');
  assert.equal(since(s.tab, from).filter((x) => x.type === 'task-modal').length, 0);
  s.acc('set', one, 'todo');
  await calls.commands.get('acc.tasks.refresh')!();
  page.close!();
  // A tracker's card: the ticket message, which opens the tab at once.
  const t = await peek(two, null);
  shut(two);
  const before = panels.length;
  s.tab.receive!(t.tab);
  assert.equal(panels.length, before + 1);
  assert.match(panels.at(-1)!.html, /data-view="ticket"/);
  panels.at(-1)!.close!();
});

test('the modal\'s model is drawn again on the signal that redraws a tab, and a redraw of the board leaves it be (GH-158)', async () => {
  const [one] = s.ids;
  const { calls } = s.fake;
  await peek(one);
  const page = await tabFor(one);
  const from = s.tab.posted.length;
  const pageFrom = page.posted.length;
  // acc's ledger changes, as when its agent moves it: the hub's tasks change, and every task page redraws.
  s.acc('set', one, 'blocked', '--reason', 'Waiting on the numbers');
  await calls.commands.get('acc.tasks.refresh')!();
  await until(() => modalFor(since(s.tab, from), one)?.model?.acc?.look.label === 'Blocked' && stateFor(since(page, pageFrom), one)?.model?.acc?.look.label === 'Blocked');
  // The board was drawn again too, apart: the modal's model is its own message, so the board's leaves it be.
  assert.ok(since(s.tab, from).some((x) => x.type === 'state' && x.model?.kind === 'home'));
  // The Command Center comes back after being hidden, its page built afresh: the modal is drawn over it again.
  const back = s.tab.posted.length;
  s.tab.receive!({ type: 'ready' });
  await until(() => !!modalFor(since(s.tab, back), one));
  const order = since(s.tab, back).map((x) => x.type);
  assert.ok(order.indexOf('state') < order.indexOf('task-modal'), 'the board first, then the modal over it');
  s.acc('set', one, 'todo');
  await calls.commands.get('acc.tasks.refresh')!();
  page.close!();
  shut(one);
  // The tab under it closes: the modal goes with it, and isn't drawn again.
  await peek(one);
  s.tab.close!();
  await calls.commands.get('acc.open.tasks')!();
  s.tab = s.fake.panels.at(-1)!;
  const fresh = s.tab.posted.length;
  s.tab.receive!({ type: 'ready' });
  await until(() => since(s.tab, fresh).some((x) => x.type === 'state'));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(since(s.tab, fresh).filter((x) => x.type === 'task-modal').length, 0);
});

/** Sends m from the modal over the board and from the task's own tab, and returns what each got back. */
async function fromBoth(key: string, m: Record<string, unknown>, settled: (msgs: Msg[]) => boolean): Promise<{ modal: Msg[]; tab: Msg[] }> {
  await peek(key);
  const page = await tabFor(key);
  const from = s.tab.posted.length;
  s.tab.receive!(m);
  await until(() => settled(since(s.tab, from)));
  const pageFrom = page.posted.length;
  page.receive!(m);
  await until(() => settled(since(page, pageFrom)));
  const out = { modal: since(s.tab, from), tab: since(page, pageFrom) };
  page.close!();
  shut(key);
  return out;
}

test('ticket-action from the modal reaches the tab\'s handler: Make a task drafts one from its note, and Refresh redraws it (GH-158)', async () => {
  const [one] = s.ids;
  const { calls } = s.fake;
  // Its builder's note, with a line still open (D-106), as acc done leaves it: written whole, as acc writes the ledger.
  const file = join(s.repo, '.git', 'acc', 'ledger.json');
  const ledger = JSON.parse(readFileSync(file, 'utf8')) as { tasks: { id: string; run?: unknown }[] };
  ledger.tasks.find((t) => t.id === one)!.run = { n: 1, note: { landed: ['The report\'s outline'], moved: [], open: ['Tidy the docs'], at: new Date().toISOString(), by: 'builder:test', ended: 'review' } };
  writeFileSync(`${file}.tmp`, JSON.stringify(ledger, null, 2));
  renameSync(`${file}.tmp`, file);
  await calls.commands.get('acc.tasks.refresh')!();
  // Make a task asks for the new task's title: once from the modal, once from the tab. Esc makes nothing.
  await peek(one);
  const page = await tabFor(one);
  const asked = calls.prompts;
  const noted = stateFor(page.posted as Msg[], one)!.model as unknown as { acc: { note: { open: string[] } | null } };
  assert.deepEqual(noted.acc.note?.open, ['Tidy the docs'], 'its note, on its page');
  s.tab.receive!({ type: 'ticket-action', action: 'task', text: 'Tidy the docs' });
  await wait('the modal\'s Make a task to ask for a title', () => calls.prompts === asked + 1);
  page.receive!({ type: 'ticket-action', action: 'task', text: 'Tidy the docs' });
  await wait('the tab\'s Make a task to ask for a title', () => calls.prompts === asked + 2);
  page.close!();
  shut(one);
  // Refresh: the modal is drawn again, as the tab is.
  const again = await fromBoth(one, { type: 'ticket-action', action: 'refresh' }, (msgs) => msgs.some((x) => (x.type === 'task-modal' || x.type === 'state') && x.model?.key === one && !x.model.loading));
  assert.ok(modalFor(again.modal, one) && stateFor(again.tab, one));
});

test('analysis-answer from the modal reaches the tab\'s handler: acc\'s refusal comes back, and the modal redraws as the tab does (GH-158)', async () => {
  const [one] = s.ids;
  const m = { type: 'analysis-answer', project: s.root, task: one, question: 'q1', text: 'Yes.' };
  const got = await fromBoth(one, m, (msgs) => !!doneIn(msgs, 'analysis-answer') && msgs.some((x) => (x.type === 'task-modal' || x.type === 'state') && x.model?.key === one));
  const [a, b] = [doneIn(got.modal, 'analysis-answer')!, doneIn(got.tab, 'analysis-answer')!];
  assert.deepEqual([a.ok, a.error], [b.ok, b.error]);
  assert.match(a.error ?? '', /hasn't been analyzed/);
  // Another task's question, as Needs you sends it, is the page's own, not the modal's: the modal's handler
  // would refuse it as not its task's, where the page's asks acc.
  await peek(one);
  const from = s.tab.posted.length;
  s.tab.receive!({ ...m, task: s.ids[1] });
  await until(() => !!doneIn(since(s.tab, from), 'analysis-answer'));
  const other = doneIn(since(s.tab, from), 'analysis-answer')!;
  assert.match(other.error ?? '', /hasn't been analyzed/);
  assert.doesNotMatch(other.error ?? '', /isn't for this task/);
  shut(one);
});

test('update-edit, update-discard, update-ask and update-post from the modal reach the tab\'s handler, and change what it changes (GH-158)', async () => {
  const [one, two] = s.ids;
  const { calls } = s.fake;
  // Drafts acc wrote for each task, as acc sync leaves them.
  const store = join(s.repo, '.git', 'acc', 'updates');
  mkdirSync(store, { recursive: true });
  const draft = (id: string) => writeFileSync(join(store, `${id}.json`), JSON.stringify({
    v: 1, id, task: id.slice(0, id.lastIndexOf('.')), tracker: 'github', key: `#${id.split('-')[1]!.split('.')[0]}`, url: null, event: 'merged', env: 'main', text: 'Merged into main.', state: 'draft', createdAt: new Date().toISOString(), by: 'acc sync',
  }));
  const state = (id: string) => (JSON.parse(readFileSync(join(store, `${id}.json`), 'utf8')) as { state: string }).state;
  for (const id of [`${one}.1`, `${one}.2`, `${two}.1`]) draft(id);
  await calls.commands.get('acc.tasks.refresh')!();
  const rows = () => (s.tab.posted.filter((x) => (x as Msg).model?.overview).at(-1) as Msg).model!.overview!.attention.filter((a) => a.update);
  const look = (id: string) => rows().find((a) => a.update!.id === id)?.look.label;
  await wait('the Overview\'s three drafts',() => rows().length === 3);

  // An edit in the modal is an edit on the task's page: the Overview shows it, and closing the modal drops it, as closing its tab does.
  await peek(one);
  s.tab.receive!({ type: 'update-edit', project: s.root, id: `${one}.1`, text: 'Merged into main: try it there.' });
  await wait('the modal\'s edit on the Overview',() => look(`${one}.1`) === 'Edited on the task page');
  shut(one);
  await wait('the edit to go with the modal',() => look(`${one}.1`) === 'Draft update');

  // Discard: the same reply, and the draft is set aside, from either.
  await peek(one);
  let from = s.tab.posted.length;
  s.tab.receive!({ type: 'update-discard', project: s.root, id: `${one}.1` });
  await wait('the modal\'s Discard to be answered, and the modal drawn again',() => !!doneIn(since(s.tab, from), 'update-discard') && !!modalFor(since(s.tab, from), one));
  assert.equal(doneIn(since(s.tab, from), 'update-discard')!.ok, true);
  assert.equal(state(`${one}.1`), 'discarded', 'from the modal');
  shut(one);
  const page = await tabFor(two);
  from = page.posted.length;
  page.receive!({ type: 'update-discard', project: s.root, id: `${two}.1` });
  await wait('the tab\'s Discard to be answered',() => !!doneIn(since(page, from), 'update-discard'));
  assert.equal(doneIn(since(page, from), 'update-discard')!.ok, true);
  assert.equal(state(`${two}.1`), 'discarded', 'and from its tab');
  page.close!();

  // Send to the client and Post: acc's refusal, word for word, from either.
  const ask = await fromBoth(one, { type: 'update-ask', project: s.root, task: one, question: 'q1' }, (msgs) => !!doneIn(msgs, 'update-ask'));
  assert.deepEqual([doneIn(ask.modal, 'update-ask')!.ok, doneIn(ask.modal, 'update-ask')!.error], [doneIn(ask.tab, 'update-ask')!.ok, doneIn(ask.tab, 'update-ask')!.error]);
  assert.match(doneIn(ask.modal, 'update-ask')!.error ?? '', /hasn't been analyzed/);
  // Post from the modal is Post on the task's page: what it sends is never refused as edited there, as the
  // Overview's would be, but goes to acc, as the tab's does. With no tracker here, acc refuses, in the same words.
  await peek(one);
  s.tab.receive!({ type: 'update-edit', project: s.root, id: `${one}.2`, text: 'Merged into main: have a look.' });
  await wait('the modal\'s second edit on the Overview',() => look(`${one}.2`) === 'Edited on the task page');
  from = s.tab.posted.length;
  s.tab.receive!({ type: 'update-post', project: s.root, id: `${one}.2`, text: 'Merged into main: have a look at it.' });
  await wait('the modal\'s Post to be answered',() => !!doneIn(since(s.tab, from), 'update-post'));
  const modalPost = doneIn(since(s.tab, from), 'update-post')!;
  shut(one);
  const page2 = await tabFor(one);
  from = page2.posted.length;
  page2.receive!({ type: 'update-post', project: s.root, id: `${one}.2`, text: 'Merged into main: have a look at it.' });
  await wait('the tab\'s Post to be answered',() => !!doneIn(since(page2, from), 'update-post'));
  const tabPost = doneIn(since(page2, from), 'update-post')!;
  page2.close!();
  assert.doesNotMatch(modalPost.error ?? '', /edited on the task page/);
  assert.deepEqual([modalPost.ok, modalPost.error], [tabPost.ok, tabPost.error]);
  assert.equal(modalPost.ok, false);
});

test('run and move from the modal reach the tab\'s handler: the same command, for the same task (GH-158)', async () => {
  const [one] = s.ids;
  const { calls } = s.fake;
  // Dispatch opens its sheet over the page that asked instead (D-168): the modal's over the Command Center, the tab's over the tab.
  {
    await peek(one);
    const page = await tabFor(one);
    const ranBefore = calls.executed.length;
    const from = s.tab.posted.length;
    s.tab.receive!({ type: 'run', command: 'acc.task.dispatch', ref: { project: s.root, task: one } });
    await wait('the modal\'s sheet', () => since(s.tab, from).some((m) => m.type === 'dispatch-sheet'));
    const pageFrom = page.posted.length;
    page.receive!({ type: 'run', command: 'acc.task.dispatch', ref: { project: s.root, task: one } });
    await wait('the tab\'s sheet', () => since(page, pageFrom).some((m) => m.type === 'dispatch-sheet'));
    assert.ok(!calls.executed.slice(ranBefore).some(([id]) => id === 'acc.task.dispatch'), 'neither runs the command');
    page.close!();
    shut(one);
  }
  for (const command of ['acc.task.block', 'acc.task.move']) {
    const ran = (from: number) => calls.executed.slice(from).filter(([id]) => id === command).map(([, a]) => [(a[0] as { kind: string }).kind, (a[0] as { task: { id: string } }).task.id]);
    await peek(one);
    const page = await tabFor(one);
    let from = calls.executed.length;
    s.tab.receive!({ type: 'run', command, ref: { project: s.root, task: one } });
    await wait('the modal\'s command to run',() => ran(from).length > 0);
    const modal = ran(from);
    from = calls.executed.length;
    page.receive!({ type: 'run', command, ref: { project: s.root, task: one } });
    await wait('the tab\'s command to run',() => ran(from).length > 0);
    assert.deepEqual(modal, ran(from), command);
    assert.deepEqual(modal, [['task', one]], command);
    page.close!();
    shut(one);
  }
  // The move it makes is acc's, as from the tab: the first a person may make with no reason to give.
  const node = calls.executed.filter(([id]) => id === 'acc.task.move').at(-1)![1][0];
  type Move = { move?: { to: string; problems: string[]; needsReason: boolean } };
  let to = '';
  calls.pick = (items) => { const i = (items as Move[]).find((x) => x.move && !x.move.problems.length && !x.move.needsReason); to = i?.move?.to ?? ''; return i; };
  await calls.commands.get('acc.task.move')!(node);
  calls.pick = undefined;
  assert.ok(to, 'a move to make');
  const ledger = JSON.parse(readFileSync(join(s.repo, '.git', 'acc', 'ledger.json'), 'utf8')) as { tasks: { id: string; state: string }[] };
  assert.equal(ledger.tasks.find((t) => t.id === one)!.state, to);
});
