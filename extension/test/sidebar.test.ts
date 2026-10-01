import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { agentLook, agentName, groupTasks, isUnder, parseWorktrees, type TaskRow } from '../src/logic.ts';

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

test('item menus show on the right items (the when-clause regexes really match)', () => {
  const menus = c.menus['view/item/context'] as { command: string; when: string; group: string }[];
  const shows = (view: string, contextValue: string, command: string) => menus.some((m) => {
    const [, v, rx] = /view == ([\w.]+) && viewItem =~ \/(.+)\/$/.exec(m.when) ?? [];
    return m.command === command && v === view && new RegExp(rx!).test(contextValue);
  });
  assert.ok(shows('acc.tasks', 'task task-todo hasUrl', 'acc.task.openTicket'));
  assert.ok(shows('acc.tasks', 'task task-running', 'acc.task.block'));
  assert.ok(!shows('acc.tasks', 'task task-done', 'acc.task.block'), 'done tasks can\'t be blocked');
  assert.ok(shows('acc.tasks', 'task task-blocked', 'acc.task.unblock'));
  assert.ok(!shows('acc.tasks', 'task task-todo', 'acc.task.openTicket'), 'no link, no button');
  assert.ok(shows('acc.agents', 'agent agentBackground', 'acc.agent.stop'));
  assert.ok(!shows('acc.agents', 'agent agentInteractive', 'acc.agent.stop'), 'interactive sessions are stopped where they run');
  assert.ok(shows('acc.worktrees', 'worktree worktreeLinked', 'acc.worktree.remove'));
  assert.ok(!shows('acc.worktrees', 'worktree worktreeMain', 'acc.worktree.remove'), 'the main checkout is never removed');
  assert.ok(shows('acc.environments', 'env envWithOrg envOnGithub', 'acc.env.openOrg'));
  assert.ok(shows('acc.setup', 'step stepFixable', 'acc.step.fix'));
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
  const w = parseWorktrees('worktree /r\nHEAD abc\nbranch refs/heads/aleysian\n\nworktree /r.worktrees/AV-1\nHEAD def\nbranch refs/heads/task/AV-1-login\nlocked\n\nworktree /gone\nHEAD 123\ndetached\nprunable gitdir file points to non-existent location\n');
  assert.deepEqual(w.map((x) => [x.path, x.branch, x.locked, x.prunable]), [['/r', 'aleysian', false, false], ['/r.worktrees/AV-1', 'task/AV-1-login', true, false], ['/gone', null, false, true]]);
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
