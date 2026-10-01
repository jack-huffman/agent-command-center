import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { TaskRow } from '../src/logic.ts';
import { agentsModel, cardActions, environmentsModel, type HubLike, isFromWebview, promotionPaths, setupModel, tasksModel, VIEW_KINDS, worktreesModel } from '../src/model.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const envs = [
  { name: 'Production', branch: 'production', type: 'production' as const, org: 'P', default: false, protected: true, promotesTo: [] },
  { name: 'Aleysian', branch: 'aleysian', type: 'developer' as const, org: 'A', default: true, protected: false, promotesTo: ['sandbox', 'production'] },
  { name: 'Sandbox', branch: 'sandbox', type: 'partial' as const, org: 'S', default: false, protected: false, promotesTo: ['production'] },
];
const row = (id: string, state: string, display: TaskRow['display'], url: string | null = null): TaskRow => ({ id, title: `Task ${id}`, state, display, environment: 'aleysian', deps: display === 'todo' ? ['AV-1'] : [], source: { kind: 'jira', url } });

function hub(): HubLike {
  const project = {
    name: 'Avalign', root: '/r', branch: 'aleysian',
    config: { github: { repo: 'o/r', account: 'me' }, environments: envs, profile: 'salesforce' },
    worktrees: [
      { path: '/r', head: 'abc1234', branch: 'aleysian', main: true, changed: 0, locked: false, prunable: false },
      { path: '/r.worktrees/AV-2', head: 'def5678', branch: 'task/AV-2-login', main: false, changed: 3, locked: false, prunable: false },
    ],
  };
  return {
    projects: [project],
    agents: [
      { cwd: '/r.worktrees/AV-2', kind: 'background', startedAt: 2, id: 'bg1', name: 'av-2', state: 'blocked', waitingFor: 'permission prompt' },
      { cwd: '/elsewhere', kind: 'interactive', startedAt: 1, sessionId: 'uuid', name: 'other', status: 'idle', pid: 9 },
    ],
    agentsError: null,
    taskRows: () => [row('AV-1', 'running', 'running'), row('AV-2', 'todo', 'todo', 'https://x/AV-2'), row('AV-3', 'blocked', 'blocked'), row('AV-4', 'done', 'done')],
    projectFor: (p: string) => (p.startsWith('/r') ? project : undefined),
  };
}

test('the board has a column for every status, in attention order, and each card has the right actions', () => {
  const m = tasksModel(hub());
  const cols = m.projects[0]!.columns;
  assert.deepEqual(cols.map((c) => c.group), ['needs-you', 'ready', 'running', 'review', 'rework', 'blocked', 'todo', 'done']);
  const card = (id: string) => cols.flatMap((c) => c.cards).find((c) => c.id === id)!;
  assert.deepEqual(card('AV-2').actions.map((a) => a.label), ['Move', 'Block', 'Ticket', 'Details']);
  assert.deepEqual(card('AV-3').actions.map((a) => a.label), ['Move', 'Unblock', 'Details']);
  assert.deepEqual(card('AV-4').actions.map((a) => a.label), ['Move', 'Details'], 'done tasks can\'t be blocked');
  assert.deepEqual(card('AV-2').waitingOn, ['AV-1']);
  assert.deepEqual(card('AV-2').actions[0]!.ref, { project: '/r', task: 'AV-2' });
});

test('agents: this project first, needs-you on top, background sessions can be stopped', () => {
  const m = agentsModel(hub());
  assert.deepEqual(m.places.map((p) => p.label), ['Avalign', 'Elsewhere on this machine']);
  const bg = m.places[0]!.agents[0]!;
  assert.equal(bg.look.label, 'Needs you: permission prompt');
  assert.equal(bg.where, 'AV-2');
  assert.deepEqual(bg.actions.map((a) => a.label), ['Attach', 'Logs', 'Stop', 'Folder']);
  assert.deepEqual(m.places[1]!.agents[0]!.actions.map((a) => a.label), ['Folder'], 'interactive sessions are managed where they run');
});

test('worktrees show changes in words, and the main checkout can\'t be removed', () => {
  const [main, linked] = worktreesModel(hub()).projects[0]!.worktrees;
  assert.equal(main!.state.label, 'Clean');
  assert.equal(linked!.state.label, '3 changed');
  assert.equal(linked!.state.tone, 'orange');
  assert.ok(!main!.actions.some((a) => a.label === 'Remove'));
  assert.ok(linked!.actions.some((a) => a.label === 'Remove' && a.danger));
});

test('environments draw every promotion path, including skipping QA (D-018)', () => {
  assert.deepEqual(promotionPaths(envs), [['aleysian', 'sandbox', 'production'], ['aleysian', 'production']]);
  const m = environmentsModel(hub()).projects[0]!;
  const aleysian = m.envs.find((e) => e.branch === 'aleysian')!;
  assert.deepEqual(aleysian.badges, ['default', 'checked out']);
  assert.ok(!aleysian.actions.some((a) => a.label === 'Compare'), 'no comparing a branch with itself');
  assert.deepEqual(m.envs.find((e) => e.branch === 'production')!.badges, ['protected']);
});

test('setup counts steps done, and offers fixes only where something is open', () => {
  const m = setupModel([
    { id: 'B0.repo', part: 'project', title: 'Repo', status: 'pass', detail: 'ok' },
    { id: 'B2.identity', part: 'project', title: 'Identity', status: 'fail', detail: 'wrong', fix: 'git config user.name x' },
    { id: 'A3.trackers', part: 'machine', title: 'Trackers', status: 'unknown', detail: '?' },
    { id: 'B11.drift', part: 'project', title: 'Drift', status: 'skip', detail: 'later' },
  ], new Set());
  assert.equal(m.total, 3, 'planned steps stay out');
  assert.equal(m.done, 1);
  const steps = m.parts.flatMap((p) => p.steps);
  assert.deepEqual(steps.find((s) => s.id === 'B2.identity')!.actions.map((a) => a.label), ['Do it', 'Check']);
  assert.deepEqual(steps.find((s) => s.id === 'A3.trackers')!.actions.map((a) => a.label), ['Check', 'I\'ve done this']);
  assert.deepEqual(steps.find((s) => s.id === 'B0.repo')!.actions.map((a) => a.label), ['Check', 'Guide'], 'passing steps keep only Check and the guide')
});

test('webview messages: only known shapes and acc commands get through', () => {
  assert.ok(isFromWebview({ type: 'ready' }));
  assert.ok(isFromWebview({ type: 'run', command: 'acc.task.move', ref: {} }));
  assert.ok(!isFromWebview({ type: 'run', command: 'workbench.action.terminal.sendSequence', ref: {} }));
  assert.ok(!isFromWebview({ type: 'eval', command: 'acc.x' }));
  assert.ok(!isFromWebview(null));
});

test('the tab page never turns data into markup, and runs under a strict nonce CSP', async () => {
  const src = readFileSync(join(root, 'webview', 'main.ts'), 'utf8');
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) assert.ok(!src.includes(bad), bad);
  const { htmlFor } = await import('../src/panels.ts').catch(() => ({ htmlFor: null as never }));
  void htmlFor; // panels.ts needs vscode; its HTML is checked in the activation test.
});

test('every view has an "open as tab" button', () => {
  const commands = new Set(manifest.contributes.commands.map((c: { command: string }) => c.command));
  for (const k of VIEW_KINDS) {
    assert.ok(commands.has(`acc.open.${k}`), k);
    assert.ok(manifest.contributes.menus['view/title'].some((m: { command: string; when: string }) => m.command === `acc.open.${k}` && m.when === `view == acc.${k}`), k);
  }
});

test('cards follow a task through dispatch: Dispatch, then Attach and Abandon, then Clean up', () => {
  const labels = (r: Partial<TaskRow>) => cardActions({ ...row('AV-9', 'todo', 'ready'), deps: [], ...r } as TaskRow, {}).map((a) => a.label);
  assert.deepEqual(labels({}), ['Dispatch', 'Move', 'Block', 'Details']);
  assert.deepEqual(labels({ state: 'running', display: 'running', run: { bgId: 'bg1', worktree: '/w/AV-9' } }), ['Attach', 'Worktree', 'Move', 'Abandon', 'Details']);
  assert.deepEqual(labels({ state: 'rework', display: 'rework', run: { worktree: '/w/AV-9' } }), ['Re-dispatch', 'Worktree', 'Move', 'Block', 'Details']);
  assert.deepEqual(labels({ state: 'done', display: 'done', run: { worktree: '/w/AV-9' } }), ['Worktree', 'Move', 'Clean up', 'Details']);
  assert.equal(cardActions({ ...row('AV-9', 'todo', 'ready'), deps: [] }, {})[0]!.primary, true, 'Dispatch is the main action on a ready card');
});
