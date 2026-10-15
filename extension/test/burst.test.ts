// A burst of notices after a person was away (D-???): Notices.update() gathers every project's notices of
// one reload, shows what noticeBurst makes of them, and still offers Slack each event.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { SlackEvent } from '../src/slack.ts';

/** notices.ts imports vscode, which only VSCode has: this stand-in holds the calls Notices makes, and records what it shows. */
const said = { info: [] as string[], warn: [] as string[], ran: [] as [string, unknown[]][], pick: undefined as string | undefined };
(globalThis as { accBurstVscode?: unknown }).accBurstVscode = {
  StatusBarAlignment: { Left: 1 },
  MarkdownString: class { value: string; constructor(v = '') { this.value = v; } },
  ThemeColor: class { id: string; constructor(id: string) { this.id = id; } },
  window: {
    createStatusBarItem: () => ({ text: '', tooltip: '', command: undefined, name: '', backgroundColor: undefined, show() {}, hide() {}, dispose() {} }),
    showInformationMessage: async (m: string) => { said.info.push(m); return said.pick; },
    showWarningMessage: async (m: string) => { said.warn.push(m); return said.pick; },
  },
  workspace: { getConfiguration: () => ({ get: <T>(_k: string, d: T) => d }) },
  commands: { executeCommand: async (c: string, ...a: unknown[]) => { said.ran.push([c, a]); } },
};
const STUB = `data:text/javascript,${encodeURIComponent('const v = globalThis.accBurstVscode; export const { StatusBarAlignment, MarkdownString, ThemeColor, window, workspace, commands } = v; export default v;')}`;
registerHooks({ resolve: (spec, ctx, next) => (spec === 'vscode' ? { url: STUB, format: 'module', shortCircuit: true } : next(spec, ctx)) });
const { Notices } = await import('../src/notices.ts');
type Row = import('../src/logic/shared.ts').TaskRow;

const row = (id: string, state: string): Row => ({ id, title: `Task ${id}`, state, display: state as Row['display'], environment: 'main', deps: [], source: { kind: 'github', url: null } });

/** Two projects whose tasks are as `rows` says, a recorder for each resolve and each Slack event, and the Notices over them. */
function swarm(ids: Record<string, string[]>) {
  const state = new Map(Object.entries(ids).map(([root, list]) => [root, list.map((id) => row(id, 'running'))]));
  const hub = {
    projects: [...state.keys()].map((root) => ({ root, name: root.slice(1), ledgerPath: `${root}/.git/acc/ledger.json` })),
    taskRows: (root: string) => state.get(root)!,
    autopilotLog: () => [],
    ledger: (root: string) => ({ tasks: state.get(root)!.map((r) => ({ id: r.id, title: r.title, history: [], run: null, source: { kind: 'github' } })) }),
    updates: () => [],
  };
  const resolved: [string, unknown][] = [];
  const offered: SlackEvent[] = [];
  const slack = { offer: (ev: SlackEvent | null) => { if (ev) offered.push(ev); }, told: () => false };
  const parts = () => ({ asking: null, running: [], checking: false, setup: { done: 0, total: 0, todo: 0 }, autopilot: [], account: null });
  const notices = new Notices(hub as never, (c, ref) => { resolved.push([c, ref]); }, () => false, parts as never, slack);
  notices.arm();
  /** Every task of every project is blocked, as a new array, so the next look sees each move. */
  const block = () => { for (const [root, list] of state) state.set(root, list.map((r) => row(r.id, 'blocked'))); };
  return { notices, block, resolved, offered };
}

const settle = () => new Promise((r) => setImmediate(r));

test('a burst across two projects shows one notification, and Slack still gets each event', async () => {
  said.info.length = 0; said.warn.length = 0; said.ran.length = 0; said.pick = 'Show';
  const s = swarm({ '/a': ['T-1', 'T-2'], '/b': ['T-1', 'T-2'] });
  s.block();
  s.notices.update(4);
  await settle();
  assert.deepEqual([said.warn, said.info], [['Since you last looked: 4 need you.'], []], 'one urgent notification for four notices');
  assert.equal(new Set(s.offered.map((e) => e.key)).size, 4, 'Slack is offered each of the four');
  assert.deepEqual(said.ran, [['acc.open.home', ['overview']]], 'its Show opens the Overview');
  assert.deepEqual(s.resolved, [], 'no task\'s command runs');
  s.notices.dispose();
});

test('three notices across two projects stay three, each Show on its own task, and no new change says nothing more (edge case: at the limit)',async () => {
  said.info.length = 0; said.warn.length = 0; said.ran.length = 0; said.pick = 'Show';
  const s = swarm({ '/a': ['T-1', 'T-2'], '/b': ['T-9'] });
  s.block();
  s.notices.update(3);
  await settle();
  assert.deepEqual(said.warn, ['T-1 is blocked: Task T-1', 'T-2 is blocked: Task T-2', 'T-9 is blocked: Task T-9']);
  assert.deepEqual(s.resolved, [['acc.task.show', { project: '/a', task: 'T-1' }], ['acc.task.show', { project: '/a', task: 'T-2' }], ['acc.task.show', { project: '/b', task: 'T-9' }]]);
  assert.equal(s.offered.length, 3);
  s.notices.update(3);
  await settle();
  assert.equal(said.warn.length, 3, 'nothing new: nothing more said');
  s.notices.dispose();
});
