// A burst of notices after a person was away (D-162): Notices.update() gathers every project's notices of
// one reload, shows what noticeBurst makes of them, and still offers Slack each event. And away from the
// window (D-164): news waits for the person on the Overview, and one notification counts it on their return.
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
    /** The window's focus as Notices reads it when it starts: a test sets it first. */
    state: { focused: true },
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

/** Projects, one per root in `ids`, each with its tasks running, a recorder for each resolve and each Slack event, and the Notices over them. */
function swarm(ids: Record<string, string[]>, clock: { now: number } = { now: 0 }) {
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
  let redraws = 0;
  const notices = new Notices(hub as never, (c, ref) => { resolved.push([c, ref]); }, () => false, parts as never, slack, { clock: () => clock.now, onSince: () => { redraws++; } });
  notices.arm();
  /** These tasks move to a state, as a new array, so the next look sees each move. */
  const move = (to: string, only?: string[]) => { for (const [root, list] of state) state.set(root, list.map((r) => (!only || only.includes(r.id) ? row(r.id, to) : r))); };
  /** Every task of every project is blocked. */
  const block = () => move('blocked');
  return { notices, block, move, resolved, offered, redraws: () => redraws };
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

const reset = () => { said.info.length = 0; said.warn.length = 0; said.ran.length = 0; said.pick = 'Show'; };

test('news while away makes no notification and waits on the Overview; urgent still shows; focus back makes one, whose Show opens Since you last looked', async () => {
  reset();
  const clock = { now: 0 };
  const s = swarm({ '/a': ['T-1', 'T-2', 'T-3'] }, clock);
  s.notices.focus(false);
  clock.now = 11 * 60_000;
  s.move('review', ['T-1', 'T-2']);
  s.notices.update(0);
  await settle();
  assert.deepEqual([said.warn, said.info], [[], []], 'news while away: no notification');
  assert.deepEqual(s.notices.since().map((p) => p.notice.task), ['T-1', 'T-2'], 'it waits for the Overview');
  assert.equal(s.redraws(), 1, 'the page is told to draw it');
  s.move('blocked', ['T-3']);
  s.notices.update(1);
  await settle();
  assert.deepEqual(said.warn, ['T-3 is blocked: Task T-3'], 'an urgent notice still shows, through the burst rule');
  assert.equal(s.redraws(), 1, 'and holds nothing new');
  assert.deepEqual(s.offered.map((e) => e.kind), ['needs-you'], 'Slack is offered what it was before, away or not');
  clock.now = 12 * 60_000;
  s.notices.focus(true);
  await settle();
  assert.deepEqual(said.info, ['While you were away: 2 ready for review.'], 'focus back: one notification counts the news');
  assert.deepEqual(said.ran, [['acc.open.home', ['overview', 'overview:since']]], 'its Show opens the Overview at the group');
  assert.equal(s.redraws(), 2);
  s.notices.focus(true);
  await settle();
  assert.equal(said.info.length, 1, 'a second focus event says nothing more');
  s.notices.clearSince();
  assert.deepEqual(s.notices.since(), [], 'Clear empties the list');
  assert.equal(s.redraws(), 3, 'and the page draws it gone');
  s.notices.dispose();
});

test('focus back before the person was away, or after a span with no news, makes no notification (edge case: no news in the span)', async () => {
  reset();
  const clock = { now: 0 };
  const s = swarm({ '/a': ['T-1'] }, clock);
  s.notices.focus(false);
  clock.now = 5 * 60_000;
  s.move('review');
  s.notices.update(0);
  await settle();
  assert.deepEqual(said.info, ['T-1 is ready for review: Task T-1'], 'gone five minutes: news still shows');
  s.notices.focus(true);
  s.notices.focus(false);
  clock.now = 30 * 60_000;
  s.notices.focus(true);
  await settle();
  assert.equal(said.info.length, 1, 'a span with no news says nothing on return');
  assert.deepEqual(s.notices.since(), []);
  s.notices.dispose();
});

test('a new away span that holds as many news items as the last one still redraws the Overview with its own (edge case: same length)', async () => {
  reset();
  const clock = { now: 0 };
  const s = swarm({ '/a': ['T-1', 'T-2', 'T-3', 'T-4'] }, clock);
  s.notices.focus(false);
  clock.now = 11 * 60_000;
  s.move('review', ['T-1', 'T-2']);
  s.notices.update(0);
  clock.now = 12 * 60_000;
  s.notices.focus(true);
  await settle();
  const drawn = s.redraws();
  s.notices.focus(false);
  clock.now = 30 * 60_000;
  s.move('review', ['T-3', 'T-4']);
  s.notices.update(0);
  await settle();
  assert.deepEqual(s.notices.since().map((p) => p.notice.task), ['T-3', 'T-4'], 'the new span holds only its own news');
  assert.equal(s.redraws(), drawn + 1, 'and the page is told to draw it, though the count is the same');
  s.notices.dispose();
});
