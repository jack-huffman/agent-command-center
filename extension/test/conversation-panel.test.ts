// A plan's conversation in its own panel (T-111), in the built extension against the vscode stand-in: Make a plan
// opens it for a task with no plan, beside the task's page, or as a tab when that page is narrow; Discuss's quote
// reaches it once it's ready; and a change redraws the panel and the page alike. Run after npm run build.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeRepo } from '../../packages/core/test/support.ts';
import { activate, fakeVscode, sandboxEnv, until } from './vscode.ts';

const dist = fileURLToPath(new URL('../dist/extension.js', import.meta.url));

type Tab = ReturnType<typeof fakeVscode>['panels'][number];
type Msg = { type?: string; model?: { kind: string; key: string; title: string; loading?: boolean; talk?: { stage: string; ask: string | null; send: unknown } | null }; [k: string]: unknown };

const s = {} as { fake: ReturnType<typeof fakeVscode>; started: ReturnType<typeof activate>; repo: string; root: string; tab: Tab; id: string; restore: () => void; acc: (...a: string[]) => void };

before(async () => {
  const { at, restore } = sandboxEnv('acc-conversation-');
  s.restore = restore;
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

const stateFor = (msgs: Msg[], key: string, kind: string): Msg | undefined => msgs.filter((m) => m.type === 'state' && m.model?.kind === kind && m.model.key === key && !m.model.loading).at(-1);

/** The task's own page, as acc.task.show opens it, ready, and how wide it says it is. */
async function pageFor(key: string, width: number): Promise<Tab> {
  const { calls, panels } = s.fake;
  const from = calls.executed.length;
  s.tab.receive!({ type: 'run', command: 'acc.task.show', ref: { project: s.root, task: key } });
  const [, args] = calls.executed.slice(from).find(([id]) => id === 'acc.task.show')!;
  const n = panels.length;
  await calls.commands.get('acc.task.show')!(...args);
  const page = panels.length > n ? panels.at(-1)! : panels.find((x) => x.viewType === 'acc.ticket' && x.html.includes(`<title>${key}</title>`))!;
  page.receive!({ type: 'ready' });
  await until(() => !!stateFor(page.posted as Msg[], key, 'ticket'));
  page.receive!({ type: 'page-width', project: s.root, task: key, width });
  return page;
}

/** The conversation's panel the last open made, ready, with its first model. */
async function panelOpened(n: number): Promise<Tab> {
  await until(() => s.fake.panels.length > n);
  const panel = s.fake.panels.at(-1)!;
  panel.receive!({ type: 'ready' });
  await until(() => !!stateFor(panel.posted as Msg[], s.id, 'conversation'));
  return panel;
}

test('Make a plan for a task with no plan opens its conversation beside the page, at its question; again, the same panel comes forward with the quote', async () => {
  const page = await pageFor(s.id, 1400);
  const n = s.fake.panels.length;
  const from = s.fake.calls.executed.length;
  page.receive!({ type: 'run', command: 'acc.task.analyze', ref: { project: s.root, task: s.id } });
  // The page asks for Make a plan; the stand-in records the command, and runs it as VS Code would.
  await until(() => s.fake.calls.executed.slice(from).some(([id]) => id === 'acc.task.analyze'));
  const [, args] = s.fake.calls.executed.slice(from).find(([id]) => id === 'acc.task.analyze')!;
  await s.fake.calls.commands.get('acc.task.analyze')!(...args);
  const panel = await panelOpened(n);
  assert.deepEqual([panel.viewType, panel.title, panel.column], ['acc.conversation', `${s.id} · Plan conversation`, s.fake.api.ViewColumn.Beside]);
  assert.match(panel.html, /data-view="conversation"/);
  const m = stateFor(panel.posted as Msg[], s.id, 'conversation')!.model!;
  assert.deepEqual([m.title, m.talk?.stage, m.talk?.ask], [`${s.id} · Plan conversation`, 'opening', 'What do you want to do here, and what are you thinking?']);
  // Again: the same panel comes forward, and no second one opens.
  page.receive!({ type: 'conversation-open', project: s.root, task: s.id, about: { ref: 'd1', text: 'Where the report lives' } });
  await until(() => panel.revealed > 0);
  assert.equal(s.fake.panels.length, n + 1);
  await until(() => (panel.posted as Msg[]).some((x) => x.type === 'conversation-quote'));
  assert.deepEqual((panel.posted as Msg[]).filter((x) => x.type === 'conversation-quote').at(-1), { type: 'conversation-quote', project: s.root, task: s.id, ref: 'd1', text: 'Where the report lives' });
  panel.close!();
  page.close!();
});

test('edge case: on a page narrower than the two would share, the conversation opens as a tab of its own', async () => {
  const page = await pageFor(s.id, 620);
  const n = s.fake.panels.length;
  page.receive!({ type: 'conversation-open', project: s.root, task: s.id });
  const panel = await panelOpened(n);
  assert.equal(panel.column, s.fake.api.ViewColumn.Active);
  panel.close!();
  page.close!();
});

test('a change shows in the panel and on the page at once: the task blocked, the conversation can\'t be added to in either', async () => {
  const page = await pageFor(s.id, 1400);
  const n = s.fake.panels.length;
  page.receive!({ type: 'conversation-open', project: s.root, task: s.id });
  const panel = await panelOpened(n);
  const pageFrom = page.posted.length;
  const panelFrom = panel.posted.length;
  s.acc('set', s.id, 'blocked', '--reason', 'Waiting on the numbers');
  await s.fake.calls.commands.get('acc.tasks.refresh')!();
  await until(() => stateFor(panel.posted.slice(panelFrom) as Msg[], s.id, 'conversation')?.model?.talk === null);
  await until(() => !!stateFor(page.posted.slice(pageFrom) as Msg[], s.id, 'ticket'));
  assert.equal(stateFor(page.posted.slice(pageFrom) as Msg[], s.id, 'ticket')!.model!.talk ?? null, null, 'the page agrees');
  s.acc('set', s.id, 'todo');
  await s.fake.calls.commands.get('acc.tasks.refresh')!();
  await until(() => stateFor(panel.posted as Msg[], s.id, 'conversation')?.model?.talk?.stage === 'opening');
  panel.close!();
  page.close!();
});
