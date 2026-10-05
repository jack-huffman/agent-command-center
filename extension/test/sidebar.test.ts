import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GH_TIMEOUT_MS, PUSH_TIMEOUT_MS } from '../../packages/core/src/land.ts';
import { FETCH_TIMEOUT_MS } from '../../packages/core/src/sync.ts';
import { agentLook, agentName, groupTasks, isUnder, parseWorktrees, type TaskRow } from '../src/logic.ts';
import { accTimeoutMs } from '../src/run.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const c = manifest.contributes;

test('every menu and welcome button calls a contributed command, in a view that exists', () => {
  const commands = new Set(c.commands.map((x: { command: string }) => x.command));
  const views = new Set(c.views.acc.map((v: { id: string }) => v.id));
  for (const [where, items] of Object.entries(c.menus) as [string, { command: string; when?: string }[]][]) {
    for (const m of items) {
      assert.ok(commands.has(m.command), `${where}: ${m.command}`);
      const view = /view == ([\w.]+)/.exec(m.when ?? '')?.[1];
      if (view) assert.ok(views.has(view), `${where}: unknown view ${view}`);
    }
  }
  for (const w of c.viewsWelcome) {
    assert.ok(views.has(w.view), w.view);
    for (const m of w.contents.matchAll(/\(command:([\w.]+)\)/g)) assert.ok(commands.has(m[1]), m[1]);
  }
  assert.ok(existsSync(join(root, c.viewsContainers.activitybar[0].icon)));
});

test('agent states read as words, with orange for anything that needs a person', () => {
  assert.deepEqual(agentLook({ cwd: '/', kind: 'background', startedAt: 0, state: 'blocked', waitingFor: 'permission prompt' }), { label: 'Needs you: permission prompt', icon: 'bell', tone: 'orange', needsYou: true });
  assert.equal(agentLook({ cwd: '/', kind: 'interactive', startedAt: 0, status: 'busy', pid: 1 }).label, 'Working');
  assert.equal(agentLook({ cwd: '/', kind: 'background', startedAt: 0, state: 'failed' }).tone, 'orange');
  assert.equal(agentLook({ cwd: '/', kind: 'background', startedAt: 0, state: 'done' }).label, 'Done');
  assert.equal(agentLook({ cwd: '/', kind: 'interactive', startedAt: 0, status: 'idle', pid: 3 }).label, 'Idle');
  assert.equal(agentLook({ cwd: '/', kind: 'interactive', startedAt: 0, status: 'idle' }).label, 'Idle (exited)');
});

test('worktree listings parse, main checkout first', () => {
  const w = parseWorktrees('worktree /r\nHEAD abc\nbranch refs/heads/devbox\n\nworktree /r.worktrees/AV-1\nHEAD def\nbranch refs/heads/task/AV-1-login\nlocked\n\nworktree /gone\nHEAD 123\ndetached\nprunable gitdir file points to non-existent location\n');
  assert.deepEqual(w.map((x) => [x.path, x.branch, x.locked, x.prunable]), [['/r', 'devbox', false, false], ['/r.worktrees/AV-1', 'task/AV-1-login', true, false], ['/gone', null, false, true]]);
});

test('tasks group in the order a person should look at them', () => {
  const row = (id: string, display: TaskRow['display']): TaskRow => ({ id, title: id, state: display, display, environment: 'dev', deps: [], source: { kind: 'manual', url: null } });
  assert.deepEqual(groupTasks([row('a', 'done'), row('b', 'needs-you'), row('c', 'ready'), row('d', 'todo')]).map((g) => g.group), ['needs-you', 'ready', 'todo', 'done']);
});

test('small helpers', () => {
  assert.equal(agentName('Fix the login page on the Account layout'), 'fix-the-login-page-on');
  assert.equal(agentName('!!!'), 'agent');
  assert.ok(isUnder('/a/b/c', '/a/b'));
  assert.ok(!isUnder('/a/bc', '/a/b'));
});

test('a land gets as long as its push, fetch and gh calls can take; other acc commands keep 3 minutes', () => {
  const land = accTimeoutMs(['land', 'GH-1', '--json']);
  assert.ok(land >= PUSH_TIMEOUT_MS + FETCH_TIMEOUT_MS + 4 * GH_TIMEOUT_MS, `${land} ms is less than land's own timeouts`);
  assert.ok(land > 180_000);
  assert.equal(accTimeoutMs(['add', 'x', '--json']), 180_000);
  assert.equal(accTimeoutMs(['review', 'GH-1', '--json']), 180_000);
});
