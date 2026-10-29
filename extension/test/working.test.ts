// T-147: a card's action is answered at every step, Clean up asks before anything else, the tidy-up count asks
// git without holding up the extension, a cleaned-up task leaves Done for its fold, and Refresh shows a cleanup
// made from a terminal. The extension's side runs over a stand-in for vscode, with a real repo and acc's own cleanup.
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig, type Config } from '../../packages/core/src/config.ts';
import { cleanup } from '../../packages/core/src/dispatch.ts';
import { run } from '../../packages/core/src/exec.ts';
import { mutate, type Task, upsertTasks } from '../../packages/core/src/ledger.ts';
import { repoPaths } from '../../packages/core/src/paths.ts';
import { inEnvironmentAsks } from '../../packages/core/src/tidy.ts';
import { GENERIC_CONFIG, gitIn, makeRepo } from '../../packages/core/test/support.ts';
import { answerRun, GONE, type RanMessage, ranResult } from '../src/logic/ran.ts';
import { type AskGit, InEnvironmentAsks } from '../src/logic/in-environment.ts';
import { splitDone, stillToTidy } from '../src/model/done-fold.ts';
import { tasksModel } from '../src/model/tasks.ts';
import type { TaskRow } from '../src/logic/shared.ts';
import { row } from './support.ts';

/** tasks.ts and hub.ts import vscode: this stand-in holds what they call, and when the confirmation opened. */
const shown = { asked: [] as number[], answer: undefined as string | undefined, info: [] as string[], warn: [] as string[] };
(globalThis as { accWorkingVscode?: unknown }).accWorkingVscode = {
  EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
  window: {
    showWarningMessage: async (m: string, opts?: { modal?: boolean }) => {
      if (opts?.modal) { shown.asked.push(performance.now()); return shown.answer; }
      shown.warn.push(m);
      return undefined;
    },
    showInformationMessage: async (m: string) => { shown.info.push(m); },
  },
  workspace: { workspaceFolders: [] as { uri: { fsPath: string } }[], getConfiguration: () => ({ get: <T>(_k: string, d: T) => d }) },
  commands: { executeCommand: async () => undefined },
};
const STUB = `data:text/javascript,${encodeURIComponent('const v = globalThis.accWorkingVscode; export const { EventEmitter, window, workspace, commands } = v; export default v;')}`;
registerHooks({ resolve: (spec, ctx, next) => (spec === 'vscode' ? { url: STUB, format: 'module', shortCircuit: true } : next(spec, ctx)) });
const { Hub } = await import('../src/hub.ts');
const { TaskCommands } = await import('../src/tasks.ts');

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ref = { project: '/r', task: 'T-1' };

// ---------------------------------------------------------------- the answer (logic/ran.ts)

test('an action is answered as it goes: asked, running, then its result; a throw is answered with why', async () => {
  const heard: RanMessage[] = [];
  await answerRun('acc.task.cleanup', ref, async (say) => { say({ phase: 'asked' }); say({ phase: 'running' }); return { ok: false, error: 'Kept the worktree: 1 uncommitted change.' }; }, (m) => heard.push(m));
  assert.deepEqual(heard.map((m) => [m.phase, m.ok, m.error]), [['asked', undefined, undefined], ['running', undefined, undefined], ['done', false, 'Kept the worktree: 1 uncommitted change.']]);
  assert.ok(heard.every((m) => m.type === 'ran' && m.command === 'acc.task.cleanup' && m.ref === ref), 'each names the action as the page pressed it');
  heard.length = 0;
  await answerRun('acc.task.block', ref, () => { throw new Error('No task T-1.'); }, (m) => heard.push(m));
  assert.deepEqual(heard.map((m) => [m.phase, m.ok, m.error]), [['done', false, 'No task T-1.']]);
});

test('edge cases: a handler that returns nothing is done and ok, one that said done is not answered twice, and a cleanup carries cleaned', async () => {
  assert.deepEqual(ranResult(undefined), { phase: 'done', ok: true });
  assert.deepEqual(ranResult(true), { phase: 'done', ok: true }, 'a command\'s own return value is no result');
  assert.deepEqual(ranResult({ ok: true, cleaned: true, extra: 1 }), { phase: 'done', ok: true, cleaned: true });
  const heard: RanMessage[] = [];
  await answerRun('acc.task.cleanup', ref, (say) => { say({ phase: 'done', ok: true, cleaned: true }); return { ok: true }; }, (m) => heard.push(m));
  assert.deepEqual(heard.map((m) => [m.phase, m.cleaned]), [['done', true]], 'acc\'s answer went first; the return after the reload adds nothing');
  assert.match(GONE, /isn't here any more/);
});

// ---------------------------------------------------------------- Clean up asks first (tasks.ts)

/** Clean up as the Command Center registers it, over `hub`, with acc's cleanup answering `out`, and every acc call it makes, timed. */
function cleanupWith(hub: unknown, out: unknown, accMs = 0) {
  const calls: { args: string[]; at: number }[] = [];
  const acc = async (args: string[]) => { calls.push({ args, at: performance.now() }); await wait(accMs); return { code: 0, stdout: JSON.stringify(out), stderr: '' }; };
  const tasks = new TaskCommands({ hub, acc, log: { warn() {} }, openTicket: null, helpers: {}, terminals: new Map() } as never, () => false, () => false);
  const reg = new Map<string, (...a: unknown[]) => unknown>();
  tasks.register((id, fn) => reg.set(id, fn));
  return { calls, reg, clean: (node: unknown) => reg.get('acc.task.cleanup')!(node) };
}
const done = (over: Partial<TaskRow> = {}): TaskRow => ({ ...row('T-1', 'done', 'done'), run: { worktree: '/r/.claude/worktrees/T-1', branch: 'task/T-1' }, ...over });

test('Clean up says it asked before the question opens, says it is running after the yes, and answers acc\'s result before the reload', async () => {
  let reloaded = 0;
  const hub = { taskRows: () => [done()], loadTasks: async () => { reloaded++; }, loadWorktrees: async () => {} };
  const c = cleanupWith(hub, { removed: true, reasons: [] });
  const heard: RanMessage[] = [];
  shown.answer = 'Clean up';
  await answerRun('acc.task.cleanup', ref, (say) => c.clean({ kind: 'task', project: { root: '/r', name: 'Acme' }, task: done(), say }), (m) => { heard.push({ ...m, at: reloaded } as never); });
  assert.deepEqual(heard.map((m) => m.phase), ['asked', 'running', 'done']);
  assert.equal((heard[2] as unknown as { at: number }).at, 0, 'the card leaves Done on acc\'s answer, before the reload');
  assert.deepEqual([heard[2]!.ok, heard[2]!.cleaned], [true, true]);
  assert.deepEqual(c.calls.map((x) => x.args), [['cleanup', 'T-1', '--json']]);
  assert.equal(reloaded, 1, 'then it reads the tasks again');
});

test('edge cases: a cancelled Clean up runs nothing and ends ok, so the button goes back; a refused one ends with why', async () => {
  const hub = { taskRows: () => [done()], loadTasks: async () => {}, loadWorktrees: async () => {} };
  const node = (say: unknown) => ({ kind: 'task', project: { root: '/r', name: 'Acme' }, task: done(), say });
  shown.answer = undefined;
  const cancel = cleanupWith(hub, {});
  const heard: RanMessage[] = [];
  await answerRun('acc.task.cleanup', ref, (say) => cancel.clean(node(say)), (m) => heard.push(m));
  assert.deepEqual(heard.map((m) => [m.phase, m.ok, m.error]), [['asked', undefined, undefined], ['done', true, undefined]]);
  assert.deepEqual(cancel.calls, [], 'nothing ran');
  shown.answer = 'Clean up';
  const refuse = cleanupWith(hub, { removed: false, reasons: ['The worktree has 2 uncommitted change(s).'] });
  heard.length = 0;
  await answerRun('acc.task.cleanup', ref, (say) => refuse.clean(node(say)), (m) => heard.push(m));
  assert.deepEqual(heard.at(-1), { type: 'ran', command: 'acc.task.cleanup', ref, phase: 'done', ok: false, error: 'Kept the worktree: The worktree has 2 uncommitted change(s).' });
  assert.ok(!heard.some((m) => m.cleaned), 'a refused one stays in Done');
});

// ---------------------------------------------------------------- the tidy-up count asks git in the background (logic/in-environment.ts)

/** A git that answers each ask after `ms`: yes for the tips in `merged`. It records each ask, and how many are under way at once. */
function slowGit(ms: number, merged: (tip: string) => boolean = () => true) {
  const asked: string[] = [];
  let now = 0;
  let most = 0;
  const ask: AskGit = async (args) => {
    asked.push(args.join(' '));
    most = Math.max(most, ++now);
    await wait(ms);
    now--;
    return { code: merged(args[2]!) ? 0 : 1 };
  };
  return { ask, asked, most: () => most };
}
const doneTask = (id: string, branch?: string): Task => ({ id, environment: 'main', run: branch ? { branch } : {} }) as unknown as Task;

test('the tidy-up count reads what git has said at once, and asks the rest one at a time in the background', async () => {
  const git = slowGit(40);
  let answered = 0;
  const asks = new InEnvironmentAsks('/r', '/r/.git/acc/reviews', git.ask, () => { answered++; });
  const at = performance.now();
  const read = asks.read();
  assert.deepEqual([read(doneTask('T-1', 'task/T-1')), read(doneTask('T-2', 'task/T-2'))], [false, false], 'not asked yet: not counted yet');
  assert.ok(performance.now() - at < 20, 'the read waited on no git');
  assert.deepEqual(git.asked, [], 'nothing is asked inside the draw that read it');
  await asks.settled();
  assert.equal(git.most(), 1, 'one git at a time');
  assert.equal(answered, 1, 'the page draws again once, when the round is in');
  assert.deepEqual(git.asked, ['merge-base --is-ancestor refs/heads/task/T-1 refs/remotes/origin/main', 'merge-base --is-ancestor refs/heads/task/T-2 refs/remotes/origin/main'], 'the first yes ends a task\'s asks');
  assert.deepEqual([asks.read()(doneTask('T-1', 'task/T-1')), asks.read()(doneTask('T-2', 'task/T-2'))], [true, true]);
  assert.deepEqual(inEnvironmentAsks(doneTask('T-1', 'task/T-1')).map(([tip, r]) => `${tip}>${r}`), ['refs/heads/task/T-1>refs/remotes/origin/main', 'refs/heads/task/T-1>refs/heads/main', 'refs/remotes/origin/task/T-1>refs/remotes/origin/main', 'refs/remotes/origin/task/T-1>refs/heads/main'], 'branchInEnvironment\'s asks, in its order');
});

test('edge cases: a new read of the ledger asks again only what wasn\'t merged; a task with nothing to ask is a no without git; a failing git is a no', async () => {
  const git = slowGit(1, (tip) => tip.endsWith('T-1'));
  const asks = new InEnvironmentAsks('/r', '/r/.git/acc/reviews', git.ask, () => {});
  asks.read()(doneTask('T-1', 'task/T-1'));
  asks.read()(doneTask('T-2', 'task/T-2'));
  asks.read()(doneTask('T-3'));
  await asks.settled();
  assert.equal(git.asked.filter((a) => a.includes('T-2')).length, 4, 'every ask, then a no');
  assert.equal(git.asked.filter((a) => a.includes('T-3')).length, 0, 'no branch and no review: nothing to ask');
  asks.forgetNos();
  git.asked.length = 0;
  asks.read()(doneTask('T-1', 'task/T-1'));
  asks.read()(doneTask('T-2', 'task/T-2'));
  await asks.settled();
  assert.ok(git.asked.length > 0 && git.asked.every((a) => a.includes('T-2')), 'merged work stays merged; a no is asked again');
  const broken = new InEnvironmentAsks('/r', '/r/reviews', async () => { throw new Error('git is gone'); }, () => {});
  broken.read()(doneTask('T-9', 'task/T-9'));
  await broken.settled();
  assert.equal(broken.read()(doneTask('T-9', 'task/T-9')), false);
});

// ---------------------------------------------------------------- a real repo: no wait before the question, and Refresh

/** A repo acc keeps, with T-1 done in a worktree whose branch is merged, opened in a Hub as VSCode would. */
async function repoWithDoneTask() {
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), '.gitignore': '.claude/\n' }));
  const config = parseConfig(GENERIC_CONFIG).config as Config;
  const paths = repoPaths(repo, run);
  const worktree = join(repo, '.claude', 'worktrees', 'T-1');
  gitIn(repo, 'worktree', 'add', '-q', '-b', 'task/T-1', worktree);
  mutate(paths, () => new Date(), (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'Write the changelog' }], 'human', 'human:test', emit, () => new Date());
    const t = l.tasks.find((x) => x.id === 'T-1')!;
    t.state = 'done';
    t.run = { worktree, branch: 'task/T-1' };
  });
  (globalThis as unknown as { accWorkingVscode: { workspace: { workspaceFolders: unknown[] } } }).accWorkingVscode.workspace.workspaceFolders = [{ uri: { fsPath: repo } }];
  const hub = new Hub();
  await hub.loadProjects();
  return { repo, config, paths, worktree, hub };
}

test('Clean up\'s question opens as the click arrives, while the tidy-up count\'s git asks are still under way (timed with a slow git)', async () => {
  const { repo, hub } = await repoWithDoneTask();
  const git = slowGit(150);
  hub.askGit = git.ask;
  // What held a click up before (T-147): the tidy-up count's git asks, on the draw after a read of the ledger.
  const at = performance.now();
  assert.ok(hub.tidy(repo), 'the count is read');
  assert.ok(performance.now() - at < 50, `the count waited ${Math.round(performance.now() - at)} ms on git`);
  const c = cleanupWith(hub, { removed: true, reasons: [] });
  shown.answer = undefined;
  shown.asked.length = 0;
  const clicked = performance.now();
  const task = hub.taskRows(repo).find((t) => t.id === 'T-1');
  await answerRun('acc.task.cleanup', { project: repo, task: 'T-1' }, (say) => c.clean({ kind: 'task', project: hub.project(repo), task, say }), () => {});
  assert.equal(shown.asked.length, 1, 'the question opened');
  assert.ok(shown.asked[0]! - clicked < 100, `it opened ${Math.round(shown.asked[0]! - clicked)} ms after the click`);
  assert.ok(git.asked.length >= 1 && git.asked.length < 4, `git was still being asked when it opened: ${git.asked.length} asks so far`);
  assert.deepEqual(c.calls, [], 'nothing is loaded or run before the question');
});

test('Refresh reads acc\'s record again, so a cleanup made from a terminal takes the card out of Done and into its fold', async () => {
  const { repo, config, paths, worktree, hub } = await repoWithDoneTask();
  hub.askGit = async () => ({ code: 1 });
  const lane = () => tasksModel(hub, () => [], 'test').projects[0]!.columns.find((c) => c.group === 'done')!;
  assert.deepEqual([lane().cards.map((c) => c.id), lane().cleaned?.map((c) => c.id)], [['T-1'], []], 'before: still to clean up, in Done');
  // acc's own cleanup, as a terminal runs it: the Command Center hears nothing of it.
  const r = cleanup(paths, config, 'T-1', run, () => new Date());
  assert.deepEqual([r.removed, r.reasons], [true, []], `acc removed ${worktree}`);
  assert.deepEqual(lane().cards.map((c) => c.id), ['T-1'], 'edge case: before Refresh, the page still shows what it last read');
  const commands = cleanupWith(hub, {});
  await commands.reg.get('acc.tasks.refresh')!();
  assert.deepEqual([lane().cards.map((c) => c.id), lane().cleaned?.map((c) => c.id)], [[], ['T-1']], 'after Refresh: in the Cleaned up fold');
});

// ---------------------------------------------------------------- Done's split (model/done-fold.ts)

test('Done keeps the tasks with a worktree to clean up, in order, and the rest go under its fold; edge case: an empty lane splits to two empty lists', () => {
  const card = (id: string, worktree: string | null) => ({ id, worktree });
  assert.deepEqual(splitDone([card('T-3', '/w/3'), card('T-2', null), card('T-1', '/w/1'), card('T-0', null)]), { cards: [card('T-3', '/w/3'), card('T-1', '/w/1')], cleaned: [card('T-2', null), card('T-0', null)] });
  assert.deepEqual(splitDone([]), { cards: [], cleaned: [] });
  assert.equal(stillToTidy({ worktree: '' }), false, 'an empty path is no worktree');
  // Only Done splits: a blocked task with no worktree stays in its lane.
  const hub = { projects: [{ name: 'Acme', root: '/r', config: { github: null } }], taskRows: () => [done(), done({ id: 'T-2', run: null } as never), { ...row('T-3', 'blocked', 'blocked') }] };
  const cols = tasksModel(hub as never, () => [], 'test').projects[0]!.columns;
  const doneLane = cols.find((c) => c.group === 'done')!;
  assert.deepEqual([doneLane.cards.map((c) => c.id), doneLane.cleaned?.map((c) => c.id)], [['T-1'], ['T-2']]);
  assert.deepEqual(cols.find((c) => c.group === 'blocked')!.cards.map((c) => c.id), ['T-3']);
  assert.equal(cols.find((c) => c.group === 'blocked')!.cleaned, undefined);
});
