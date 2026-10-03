import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskRow } from '../src/logic.ts';
import { type BoardInput, initials, isFromWebview, priorityIcon, ticketModel, trackerBoard, typeIcon } from '../src/model.ts';
import type { Ticket } from '../../packages/core/src/trackers/types.ts';

const row = (id: string, state: string, display: TaskRow['display'], extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: `Task ${id}`, state, display, environment: 'dev', deps: [], source: { kind: 'jira', url: null }, ...extra });

const board = (): BoardInput => ({
  index: 0, kind: 'jira', title: 'Jira · ACME', error: null, connect: null, loading: false,
  board: {
    source: 'jira-board', title: 'ACME board', url: 'https://acme.atlassian.net/x', notice: null,
    columns: [{ id: 'c0', name: 'To Do', category: 'todo', statusIds: ['1'] }, { id: 'c1', name: 'Doing', category: 'doing', statusIds: ['3', '4'] }, { id: 'c2', name: 'Done', category: 'done', statusIds: ['10'] }],
    cards: [
      { key: 'ACME-1', title: 'Ready one', url: 'u', status: { id: '1', name: 'To Do' }, type: 'Story', assignees: [{ name: 'Pat Lee' }], labels: [], priority: 'High' },
      { key: 'ACME-2', title: 'Untracked', url: 'u', status: { id: '1', name: 'To Do' }, type: 'Bug', assignees: [], labels: [{ name: 'ui', color: 'ff0000' }], priority: 'Medium' },
      { key: 'ACME-3', title: 'Waiting on a person', url: 'u', status: { id: '4', name: 'In Review' }, type: 'Task', assignees: [], labels: [], priority: null },
      { key: 'ACME-4', title: 'Shipped', url: 'u', status: { id: '10', name: 'Done' }, type: null, assignees: [], labels: [], priority: null },
    ],
  },
});

test('a tracker board keeps the tracker\'s columns, places cards by status, and shows acc\'s side where it has a task', () => {
  const rows = [row('ACME-1', 'todo', 'ready'), row('ACME-3', 'running', 'needs-you', { run: { bgId: 'bg3' }, agent: { label: 'Needs you: permission prompt', icon: 'bell-dot', tone: 'orange' } })];
  const b = trackerBoard(board(), rows, '/r');
  assert.deepEqual(b.columns.map((c) => [c.name, c.tone, c.done, c.cards.map((x) => x.key)]), [['To Do', 'neutral', false, ['ACME-1', 'ACME-2']], ['Doing', 'blue', false, ['ACME-3']], ['Done', 'neutral', true, ['ACME-4']]]);
  const [ready, untracked] = b.columns[0]!.cards;
  assert.equal(ready!.acc!.look.label, 'Ready');
  assert.equal(ready!.acc!.action!.command, 'acc.task.dispatch', 'a ready ticket offers Dispatch right on its card');
  assert.deepEqual(ready!.assignees, [{ name: 'Pat Lee', initials: 'PL' }]);
  assert.equal(untracked!.acc, null, 'a ticket acc doesn\'t keep has no agent badge');
  const waiting = b.columns[1]!.cards[0]!;
  assert.deepEqual([waiting.acc!.needsYou, waiting.acc!.look.label, waiting.acc!.action!.command], [true, 'Needs you: permission prompt', 'acc.task.openInClaude'], 'waiting in its own terminal: open its conversation in Claude Code');
  assert.equal(trackerBoard({ ...board(), board: null, error: 'Connect to Jira', connect: { command: 'acc.trackers.signIn', label: 'Sign in to Jira', arg: '{"root":"/r","index":0}' } }, [], '/r').columns.length, 0);
});

test('icons for types and priorities, and initials for people', () => {
  assert.deepEqual(['Bug', 'Story', 'Task', 'Sub-task', 'Epic', null].map(typeIcon), ['bug', 'bookmark', 'tasklist', 'list-tree', 'zap', 'issues']);
  assert.deepEqual(['Highest', 'High', 'Medium', 'Low', 'Lowest', null].map(priorityIcon), ['chevron-up', 'arrow-up', null, 'arrow-down', 'chevron-down', null]);
  assert.deepEqual(['Pat Lee', 'jordan.kim', 'ghost', 'Ana María de la Cruz', ''].map(initials), ['PL', 'JK', 'G', 'AM', '?']);
});

const ticket: Ticket = {
  key: 'ACME-1', kind: 'jira', url: 'https://acme.atlassian.net/browse/ACME-1', title: 'Ready one', type: 'Story', status: { id: '3', name: 'In Progress', category: 'doing' },
  assignees: [{ id: 'a', name: 'Pat Lee' }], reporter: null, labels: [], priority: 'High', created: '2026-09-01T00:00:00Z', updated: '2026-09-02T00:00:00Z',
  body: { blocks: [{ t: 'p', c: [{ t: 'text', text: 'Body' }] }] }, markdown: 'Body', comments: [], related: [],
};

test('a ticket page: the tracker\'s ticket can be changed from it; acc\'s side shows when acc keeps it; otherwise it offers Track in acc', () => {
  const task = { id: 'ACME-1', title: 'Ready one', brief: 'Brief', source: { kind: 'jira', key: 'ACME-1', url: null }, environment: 'dev', deps: [], labels: [], state: 'todo', blocker: null, run: null, pr: null,
    history: [{ at: '2026-09-01T00:00:00Z', from: null, to: 'todo', by: 'human:me' }, { at: '2026-09-02T00:00:00Z', from: 'todo', to: 'running', by: 'human:me' }], createdAt: '', updatedAt: '' } as never;
  const base = { project: '/r', tracker: 0, trackerTitle: 'Jira · ACME', trackerKind: 'jira' as const, key: 'ACME-1', loading: false, error: null, connect: null, checks: [] };
  const tracked = ticketModel({ ...base, ticket, row: row('ACME-1', 'todo', 'ready'), task });
  assert.deepEqual(tracked.can, { status: true, assign: true, labels: true, comment: true });
  assert.deepEqual([tracked.status, tracked.sourceKind, tracked.trackable], [{ name: 'In Progress', tone: 'blue' }, 'jira', false]);
  assert.equal(tracked.acc!.history[0]!.to, 'running', 'newest history first');
  assert.ok(!tracked.acc!.actions.some((a) => a.command === 'acc.task.show'), 'no Details button on the details page');
  assert.equal(ticketModel({ ...base, ticket, row: null, task: null }).trackable, true);

  const local = ticketModel({ ...base, tracker: null, trackerTitle: null, trackerKind: null, ticket: null, row: row('ACME-1', 'todo', 'ready'), task });
  assert.deepEqual([local.sourceKind, local.sourceLabel, local.can.comment, local.trackable], ['acc', 'Task kept by acc', false, false]);
  assert.deepEqual(local.body, { blocks: [{ t: 'p', c: [{ t: 'text', text: 'Brief' }] }] }, 'a task acc alone keeps shows its brief, rendered');
  assert.deepEqual(local.status, { name: 'Ready', tone: 'blue' });
});

test('messages from the board and ticket pages are checked before anything acts on them', () => {
  for (const ok of [
    { type: 'ticket', project: '/r', tracker: 0, key: 'ACME-1' }, { type: 'ticket', project: '/r', tracker: null, key: 'GH-12' },
    { type: 'move', project: '/r', tracker: 0, key: 'ACME-1', to: 'col-2' },
    { type: 'ticket-action', action: 'comment', text: 'Looks good' }, { type: 'ticket-action', action: 'status' },
    { type: 'open', url: 'https://acme.atlassian.net/browse/ACME-1' },
    { type: 'toolbar', command: 'acc.trackers.signIn', arg: '{"root":"/r","index":0}' },
  ]) assert.ok(isFromWebview(ok), JSON.stringify(ok));
  for (const bad of [
    { type: 'open', url: 'javascript:alert(1)' }, { type: 'open', url: 'file:///etc/passwd' },
    { type: 'ticket', project: '/r', tracker: 0, key: '../../etc' }, { type: 'move', project: '/r', tracker: 'x', key: 'ACME-1', to: 'c' },
    { type: 'ticket-action', action: 'delete' }, { type: 'ticket-action', action: 'comment', text: 'x'.repeat(70_000) },
    { type: 'toolbar', command: 'workbench.action.terminal.sendSequence' }, { type: 'nope' }, null,
  ]) assert.ok(!isFromWebview(bad), JSON.stringify(bad)?.slice(0, 80));
});

test('pasted tracker URLs give the organization or site', async () => {
  const { parseHost } = await import('../src/logic.ts');
  assert.equal(parseHost('azure', 'https://dev.azure.com/avalign-co/CRM/_boards/board/t/Team/Stories'), 'avalign-co');
  assert.equal(parseHost('azure', 'acme.visualstudio.com/CRM'), 'acme');
  assert.equal(parseHost('azure', 'acme'), 'acme');
  assert.equal(parseHost('azure', 'not a url!'), null);
  assert.equal(parseHost('jira', 'https://Acme.atlassian.net/jira/software/projects/MSP/boards/1'), 'acme.atlassian.net');
  assert.equal(parseHost('jira', 'acme'), 'acme.atlassian.net');
});

test('a repo\'s GitHub identity reads at a glance: what\'s wrong is said in words', async () => {
  const { lookOf } = await import('../src/model.ts');
  const base = { repo: 'o/r', account: 'me', from: 'config' as const, projectAccount: 'me', signedIn: true, commit: { name: 'Me', email: 'me@x.y' }, pushesAs: 'me', push: 'follows' as const,
    accounts: [{ login: 'me', active: false, scopes: ['repo', 'project'] }, { login: 'work', active: true, scopes: ['repo'] }] };
  assert.deepEqual(lookOf(base), { ok: true, problem: null, scopes: ['repo', 'project'], projects: true });
  assert.equal(lookOf({ ...base, signedIn: false }).problem, 'gh isn\'t signed in as me');
  assert.equal(lookOf({ ...base, pushesAs: 'work' }).problem, 'git push would use work');
  assert.equal(lookOf({ ...base, accounts: null }).problem, 'gh isn\'t installed');
  assert.equal(lookOf({ ...base, accounts: [{ login: 'me', active: true, scopes: ['repo'] }] }).projects, false);
});
