import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outsideKeys, placeCandidates, rowAnalysis, type TaskRow } from '../src/logic.ts';
import type { Analysis } from '../../packages/core/src/analyze.ts';
import { type BoardInput, initials, isFromWebview, priorityIcon, ticketActionRefusal, ticketModel, trackerBoard, typeIcon } from '../src/model.ts';
import type { Update } from '../../packages/core/src/updates.ts';
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

test('a tracker board says where its tickets come from, and names tasks that left the place after they started (D-072)', () => {
  const left = ['ACME-9 left this repo\'s place: it isn\'t in epic ACME-3; ACME-9 is still running'];
  const b = trackerBoard({ ...board(), place: 'Jira · ACME · epic ACME-3 Premium Support', left }, [row('ACME-9', 'running', 'running')], '/r');
  assert.equal(b.place, 'Jira · ACME · epic ACME-3 Premium Support');
  assert.deepEqual(b.left, left);
  assert.ok(!b.columns.some((c) => c.cards.some((x) => x.key === 'ACME-9')), 'it isn\'t on the tracker\'s board; it stays on the agent board');
  const plain = trackerBoard(board(), [], '/r');
  assert.deepEqual([plain.place, plain.left], [null, []], 'nothing to say before the board knows');

  // A ticket outside the place is said plainly on its page, and can't be tracked.
  const page = ticketModel({ project: '/r', tracker: 0, trackerTitle: 'Jira · ACME', trackerKind: 'jira', key: 'OPS-1', ticket: null, loading: false, error: null, outside: 'OPS-1 isn\'t one of this repo\'s tickets, which come from Jira · ACME: it\'s in project OPS.', connect: null, row: null, task: null, checks: [] });
  assert.deepEqual([page.outside, page.error, page.trackable], ['OPS-1 isn\'t one of this repo\'s tickets, which come from Jira · ACME: it\'s in project OPS.', null, false]);
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

test('a stopped builder\'s task page quotes what it last said in full, and lists Resume (D-067)', () => {
  const said = `API Error: Your computer went to sleep mid-response. ${'The response above may be incomplete. '.repeat(6).trim()}`;
  const task = { id: 'ACME-1', title: 'Ready one', brief: 'Brief', source: { kind: 'jira', key: 'ACME-1', url: null }, environment: 'dev', deps: [], labels: [], state: 'running', blocker: null,
    run: { worktree: '/w1', branch: 'b1', bgId: 'bg1', sessionId: 'sess-1' }, pr: null, history: [], createdAt: '', updatedAt: '' } as never;
  const stopped = row('ACME-1', 'running', 'needs-you', { run: { worktree: '/w1', branch: 'b1', bgId: 'bg1', sessionId: 'sess-1' }, agent: { label: 'Needs you', icon: 'bell', tone: 'orange' }, stopped: { said } });
  const page = ticketModel({ project: '/r', tracker: 0, trackerTitle: 'Jira · ACME', trackerKind: 'jira', key: 'ACME-1', loading: false, error: null, connect: null, checks: [], ticket, row: stopped, task });
  assert.deepEqual(page.acc!.look, { label: `Needs you: its agent stopped: ${said}`, icon: 'debug-disconnect', tone: 'orange' }, 'in full on its page');
  assert.equal(page.acc!.agent, null);
  assert.deepEqual(page.acc!.actions.filter((a) => a.primary).map((a) => a.command), ['acc.task.resume']);
  assert.ok(page.acc!.actions.some((a) => a.command === 'acc.task.watch'));
});

test('a ticket page: the tracker\'s ticket takes comments, and its fields change only where the tracker says edits; acc\'s side shows when acc keeps it; otherwise it offers Track in acc', () => {
  const task = { id: 'ACME-1', title: 'Ready one', brief: 'Brief', source: { kind: 'jira', key: 'ACME-1', url: null }, environment: 'dev', deps: [], labels: [], state: 'todo', blocker: null, run: null, pr: null,
    history: [{ at: '2026-09-01T00:00:00Z', from: null, to: 'todo', by: 'human:me' }, { at: '2026-09-02T00:00:00Z', from: 'todo', to: 'running', by: 'human:me' }], createdAt: '', updatedAt: '' } as never;
  const base = { project: '/r', tracker: 0, trackerTitle: 'Jira · ACME', trackerKind: 'jira' as const, key: 'ACME-1', loading: false, error: null, connect: null, checks: [] };
  const tracked = ticketModel({ ...base, ticket, row: row('ACME-1', 'todo', 'ready'), task });
  // A client's tracker is theirs: no status, assignee or labels controls unless it opts in (D-066). Comments stay.
  assert.deepEqual(tracked.can, { status: false, assign: false, labels: false, comment: true });
  assert.deepEqual(ticketModel({ ...base, ticket, row: row('ACME-1', 'todo', 'ready'), task, trackerEdits: true }).can, { status: true, assign: true, labels: true, comment: true });
  // Sent anyway, the page refuses them before it asks the tracker for anything.
  for (const action of ['status', 'assign', 'labels']) {
    assert.match(ticketActionRefusal(action, false) ?? '', /read-only here\. Set "edits": true/, action);
    assert.equal(ticketActionRefusal(action, true), null, action);
  }
  assert.equal(ticketActionRefusal('comment', false), null, 'comments stay');
  assert.deepEqual([tracked.status, tracked.sourceKind, tracked.trackable], [{ name: 'In Progress', tone: 'blue' }, 'jira', false]);
  assert.equal(tracked.acc!.history[0]!.to, 'running', 'newest history first');
  assert.ok(!tracked.acc!.actions.some((a) => a.command === 'acc.task.show'), 'no Details button on the details page');
  assert.equal(ticketModel({ ...base, ticket, row: null, task: null }).trackable, true);

  const local = ticketModel({ ...base, tracker: null, trackerTitle: null, trackerKind: null, ticket: null, row: row('ACME-1', 'todo', 'ready'), task });
  assert.deepEqual([local.sourceKind, local.sourceLabel, local.can.comment, local.trackable], ['acc', 'Task kept by acc', false, false]);
  assert.deepEqual(local.body, { blocks: [{ t: 'p', c: [{ t: 'text', text: 'Brief' }] }] }, 'a task acc alone keeps shows its brief, rendered');
  assert.deepEqual(local.status, { name: 'Ready', tone: 'blue' });
  assert.equal(local.acc!.conflicts, null);

  // Its open pull request conflicts with its base: the page names every file (D-049).
  const files = ['docs/DECISIONS.md', 'plugin/bin/acc', 'a.ts', 'b.ts'];
  // The page names each in full; the card by folder and name.
  const pr = { number: 16, url: 'u', state: 'open', ci: 'passing', changesRequested: false, conflicts: files };
  const conflicted = ticketModel({ ...base, ticket, row: row('ACME-1', 'review', 'needs-you', { pr }), task });
  assert.equal(conflicted.acc!.conflicts, 'Conflicts with dev: docs/DECISIONS.md, plugin/bin/acc, a.ts, b.ts', 'every file, in full');
  assert.equal(ticketModel({ ...base, ticket, row: row('ACME-1', 'done', 'done', { pr: { ...pr, state: 'merged' } }), task }).acc!.conflicts, null, 'a merged one no longer conflicts');
  const onBoard = trackerBoard(board(), [row('ACME-3', 'review', 'needs-you', { pr })], '/r').columns[1]!.cards[0]!.acc!;
  assert.deepEqual([onBoard.needsYou, onBoard.conflicts], [true, 'Conflicts with dev: docs/DECISIONS.md, bin/acc, a.ts and 1 more'], 'the tracker\'s card says why too');
});

test('a task\'s page shows its analysis gist first: the verdict, the summary, its questions to answer, then the rest folded (D-052)', () => {
  const task = { id: 'ACME-1', title: 'Ready one', brief: '', source: { kind: 'jira', key: 'ACME-1', url: null }, environment: 'dev', deps: [], labels: [], state: 'todo', blocker: null, run: null, pr: null, history: [], createdAt: '', updatedAt: '' } as never;
  const base = { project: '/r', tracker: 0, trackerTitle: 'Jira · ACME', trackerKind: 'jira' as const, key: 'ACME-1', ticket, loading: false, error: null, connect: null, checks: [], task };
  const a: Analysis = {
    v: 1, task: 'ACME-1', env: 'dev', base: 'abc', verdict: 'questions', summary: 'Add the role on conversion.',
    requirements: { goal: 'Roles survive conversion.', criteria: ['A primary contact has a role'], assumptions: ['One handler converts'], outOfScope: [] },
    questions: [{ id: 'q1', question: 'Every contact?', why: 'More records.', suggested: 'Only the primary.' }, { id: 'q2', question: 'Which role?', why: '', suggested: 'Influencer', answer: { text: 'Decision Maker', by: 'me', at: 't' } }],
    findings: [{ area: 'Handler', detail: 'Makes no role.', source: 'Handler.cls' }],
    approach: { plan: ['Insert the role'], files: [{ path: 'Handler.cls', change: 'update', why: 'The insert' }], refactors: [{ what: 'Query out of the loop', why: 'Limits' }], risks: ['Duplicates'], tests: ['HandlerTest'], size: 'M' },
    split: [], orgs: ['Dev'], sessionId: 's', at: '2026-10-05T10:00:00.000Z', durationMs: 1, costUsd: null,
  };
  const todo = (more: Partial<TaskRow> = {}) => row('ACME-1', 'todo', 'needs-you', { analysisRequired: true, analysis: rowAnalysis(a), ...more });
  const m = ticketModel({ ...base, row: todo(), analysis: a }).analysis!;
  assert.deepEqual(m.look, { label: '1 question for you', icon: 'question', tone: 'orange' });
  assert.deepEqual([m.summary, m.size, m.at], ['Add the role on conversion.', 'M', '2026-10-05T10:00:00.000Z']);
  assert.deepEqual(m.open, [{ id: 'q1', question: 'Every contact?', why: 'More records.', suggested: 'Only the primary.' }], 'each open question with its suggestion');
  assert.deepEqual(m.decided, [{ question: 'Which role?', answer: 'Decision Maker', assumed: false }]);
  assert.deepEqual([m.criteria, m.assumptions, m.findings.length, m.plan, m.refactors.length, m.risks, m.tests, m.files.length], [['A primary contact has a role'], ['One handler converts'], 1, ['Insert the role'], 1, ['Duplicates'], ['HandlerTest'], 1]);
  assert.deepEqual(m.actions.map((x) => [x.label, x.command]), [['Analyze again', 'acc.task.analyze']]);
  const side = ticketModel({ ...base, row: todo(), analysis: a }).acc!.actions;
  assert.ok(!side.some((x) => ['acc.task.analyze', 'acc.task.watchAnalysis', 'acc.task.show'].includes(x.command)), 'its buttons are in its own section');

  const ready = { ...a, verdict: 'ready' as const, questions: a.questions.filter((q) => q.answer) };
  assert.deepEqual(ticketModel({ ...base, row: todo({ display: 'ready', analysis: rowAnalysis(ready) }), analysis: ready }).analysis!.look, { label: 'Ready to build', icon: 'pass', tone: 'blue' });
  const split = { ...a, verdict: 'split' as const, questions: [], split: ['Part one', 'Part two'] };
  const big = ticketModel({ ...base, row: todo({ analysis: rowAnalysis(split) }), analysis: split }).analysis!;
  assert.deepEqual([big.look, big.split], [{ label: 'Too big for one task', icon: 'split-horizontal', tone: 'orange' }, ['Part one', 'Part two']]);

  const live = ticketModel({ ...base, row: todo({ analyzing: { sessionId: 's2' } }), analysis: a }).analysis!;
  assert.deepEqual([live.look.label, live.actions.map((x) => x.label)], ['Analyzing', ['Watch the analysis']], 'no Analyze again while one runs');
  const building = ticketModel({ ...base, row: row('ACME-1', 'running', 'running'), analysis: a }).analysis!;
  assert.deepEqual([building.look.label, building.actions, building.open], ['Analyzed before the build', [], []], 'no Analyze again while it\'s built, and nothing left to answer');
  assert.deepEqual(building.decided.map((d) => [d.answer, d.assumed]), [['Only the primary.', true], ['Decision Maker', false]], 'what its builder assumed, and what a person decided');
  const none = ticketModel({ ...base, row: row('ACME-1', 'todo', 'ready', { analysisRequired: true }), analysis: null }).analysis!;
  assert.deepEqual([none.look.label, none.actions.map((x) => [x.label, !!x.primary])], ['Not analyzed yet', [['Analyze', true]]]);
  assert.equal(ticketModel({ ...base, row: row('ACME-1', 'running', 'running'), analysis: null }).analysis, null, 'built without one: no section');

  const card = trackerBoard(board(), [todo(), row('ACME-3', 'todo', 'ready', { analysisRequired: true })], '/r');
  const acc = (key: string) => card.columns.flatMap((c) => c.cards).find((c) => c.key === key)!.acc!;
  assert.deepEqual([acc('ACME-1').look.label, acc('ACME-1').needsYou, acc('ACME-1').action!.label], ['Needs you: 1 question from its analysis', true, 'Answer']);
  assert.equal(acc('ACME-3').action!.command, 'acc.task.analyze', 'a tracker\'s card offers the analysis first, where it\'s wanted');
});

test('messages from the board and ticket pages are checked before anything acts on them', () => {
  for (const ok of [
    { type: 'ticket', project: '/r', tracker: 0, key: 'ACME-1' }, { type: 'ticket', project: '/r', tracker: null, key: 'GH-12' },
    { type: 'move', project: '/r', tracker: 0, key: 'ACME-1', to: 'col-2' },
    { type: 'ticket-action', action: 'comment', text: 'Looks good' }, { type: 'ticket-action', action: 'status' },
    { type: 'open', url: 'https://acme.atlassian.net/browse/ACME-1' },
    { type: 'toolbar', command: 'acc.trackers.signIn', arg: '{"root":"/r","index":0}' },
    { type: 'analysis-answer', project: '/r', task: 'ACME-1', question: 'q1', text: 'Only the primary contact.' },
    { type: 'analysis-answer', project: '/r', task: 'ACME-1', question: 'q12', text: '-5 days' },
    // A ticket's updates (D-066): post with the edited text, discard, or draft a question for the client.
    { type: 'update-post', project: '/r', id: 'ACME-1.2', text: 'Ready for review: https://github.com/o/r/pull/3' },
    { type: 'update-post', project: '/r', id: 'GH-41.10', text: 'x'.repeat(65_536), again: true },
    { type: 'update-discard', project: '/r', id: 'ACME-1.2' },
    { type: 'update-ask', project: '/r', task: 'ACME-1', question: 'q2' },
    // The task page's unsent edit of an update, so the Overview won't post acc's text instead (GH-46): any
    // text up to a post's length, even none, or null once it's acc's text again.
    { type: 'update-edit', project: '/r', id: 'ACME-1.2', text: 'Ready for review, Dana.' },
    { type: 'update-edit', project: '/r', id: 'GH-41.10', text: 'x'.repeat(65_536) },
    { type: 'update-edit', project: '/r', id: 'ACME-1.2', text: '' },
    { type: 'update-edit', project: '/r', id: 'ACME-1.2', text: null },
  ]) assert.ok(isFromWebview(ok), JSON.stringify(ok));
  for (const bad of [
    { type: 'open', url: 'javascript:alert(1)' }, { type: 'open', url: 'file:///etc/passwd' },
    { type: 'ticket', project: '/r', tracker: 0, key: '../../etc' }, { type: 'move', project: '/r', tracker: 'x', key: 'ACME-1', to: 'c' },
    { type: 'ticket-action', action: 'delete' }, { type: 'ticket-action', action: 'comment', text: 'x'.repeat(70_000) },
    { type: 'toolbar', command: 'workbench.action.terminal.sendSequence' }, { type: 'nope' }, null,
    // An answer to an analysis's question (D-052): a real project, task and question, and words.
    { type: 'analysis-answer', project: '/r', task: 'ACME-1', question: 'q1', text: '' },
    { type: 'analysis-answer', project: '/r', task: 'ACME-1', question: 'q1', text: '   ' },
    { type: 'analysis-answer', project: '/r', task: 'ACME-1', question: 'q1', text: 'x'.repeat(4001) },
    { type: 'analysis-answer', project: '/r', task: 'ACME-1', question: 'q1; rm -rf ~', text: 'Yes' },
    { type: 'analysis-answer', project: '/r', task: 'ACME-1', question: 'q1234', text: 'Yes' },
    { type: 'analysis-answer', project: '/r', task: '../ACME-1', question: 'q1', text: 'Yes' },
    { type: 'analysis-answer', task: 'ACME-1', question: 'q1', text: 'Yes' },
    { type: 'analysis-answer', project: '/r', task: 'ACME-1', question: 'q1', text: 42 },
    { type: 'update-post', project: '/r', id: 'ACME-1.2', text: 'x'.repeat(65_537) },
    { type: 'update-post', project: '/r', id: 'ACME-1.2', text: '  ' },
    { type: 'update-post', project: '/r', id: '../ACME-1.2', text: 'Hi' },
    { type: 'update-post', project: '/r', id: 'ACME-1', text: 'Hi' },
    { type: 'update-post', project: '/r', id: 'ACME-1.2', text: 'Hi', again: 'yes' },
    { type: 'update-post', id: 'ACME-1.2', text: 'Hi' },
    { type: 'update-discard', project: '/r', id: 'ACME-1.2/../x' },
    { type: 'update-ask', project: '/r', task: 'ACME-1', question: 'all' },
    { type: 'update-edit', project: '/r', id: 'ACME-1.2', text: 'x'.repeat(65_537) },
    { type: 'update-edit', project: '/r', id: '../ACME-1.2', text: 'Hi' },
    { type: 'update-edit', project: '/r', id: 'ACME-1', text: 'Hi' },
    { type: 'update-edit', project: '/r', id: 'ACME-1.2' },
    { type: 'update-edit', project: '/r', id: 'ACME-1.2', text: 42 },
    { type: 'update-edit', id: 'ACME-1.2', text: 'Hi' },
  ]) assert.ok(!isFromWebview(bad), JSON.stringify(bad)?.slice(0, 80));
});

test('a task\'s page shows each update waiting to be posted, with who it posts as, and a sign-in when there\'s none (D-066)', () => {
  const task = { id: 'ACME-1', title: 'Ready one', brief: '', source: { kind: 'jira', key: 'ACME-1', url: null }, environment: 'dev', deps: [], labels: [], state: 'review', blocker: null, run: null, pr: null, history: [], createdAt: '', updatedAt: '' } as never;
  const base = { project: '/r', tracker: 0, trackerTitle: 'Jira · ACME', trackerKind: 'jira' as const, key: 'ACME-1', loading: false, error: null, connect: null, checks: [], ticket, row: row('ACME-1', 'review', 'review'), task };
  const draft = (id: string, extra: Partial<Update> = {}): Update => ({ v: 1, id, task: id.split('.')[0]!, tracker: 'jira', key: id.split('.')[0]!, url: null, event: 'pr-opened', text: 'The change is ready for review: https://github.com/o/r/pull/3', state: 'draft', pr: { number: 3, url: 'https://github.com/o/r/pull/3' }, createdAt: '2026-10-05T12:00:00.000Z', by: 'acc land', ...extra });
  const updates = [
    draft('ACME-1.1', { state: 'posted', posted: { at: '2026-10-05T12:01:00.000Z', by: 'human:me', text: 'x' } }),
    draft('ACME-1.2', { event: 'merged', env: 'Dev', text: 'The change was approved and merged into Dev.', failed: { at: '2026-10-05T12:02:00.000Z', reason: 'Jira said 401' } }),
    draft('ACME-1.3', { state: 'posting', posting: { at: '2026-10-05T12:00:00.000Z', by: 'human:me' } }),
    draft('ACME-2.1'),
  ];
  const now = Date.parse('2026-10-05T12:10:00.000Z');
  const signedIn = { ...board(), signedInAs: 'me@acme.example' };
  const m = ticketModel({ ...base, updates, boards: [signedIn], github: 'me', now });
  assert.deepEqual(m.updates.map((u) => [u.id, u.key, u.about, u.look.label, u.look.tone, u.stale, u.postAs, u.blocked, u.failed]), [
    ['ACME-1.2', 'ACME-1', 'Merged into Dev', 'Draft update', 'orange', false, 'me@acme.example', null, 'Jira said 401'],
    ['ACME-1.3', 'ACME-1', 'Pull request #3 is ready for review', 'May have posted', 'orange', true, 'me@acme.example', null, null],
  ], 'its own task\'s, waiting on a person: not the posted one, nor another task\'s');
  // Not signed in to Jira: Post waits for the sign-in, and says so.
  const out = ticketModel({ ...base, updates, boards: [board()], github: 'me', now }).updates[0]!;
  assert.deepEqual([out.postAs, out.blocked, out.signIn], [null, 'Sign in to Jira first.', { command: 'acc.trackers.signIn', label: 'Sign in to Jira', arg: '{"root":"/r","index":0}' }]);
  assert.equal(ticketModel({ ...base, updates, boards: [], github: 'me', now }).updates[0]!.blocked, 'This repo has no Jira tracker to post through.');
  // A GitHub issue's posts as the repo's account (D-028), named by its task.
  const gh = ticketModel({ ...base, updates: [draft('ACME-1.4', { tracker: 'github', key: '#7' })], boards: [], github: 'me', now }).updates[0]!;
  assert.deepEqual([gh.key, gh.postAs, gh.blocked], ['ACME-1', 'me', null]);
  assert.deepEqual(ticketModel({ ...base, ticket: null, row: null, task: null, updates }).updates, [], 'a ticket acc doesn\'t keep has none');
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

test('after a board loads, acc asks its tracker only about its own unfinished tasks the board didn\'t show, and a failed read removes nothing (D-072)', async () => {
  const tasks = [
    { id: 'ACME-1', state: 'todo', source: { kind: 'jira' } },
    { id: 'ACME-2', state: 'running', source: { kind: 'jira' } },
    { id: 'ACME-3', state: 'done', source: { kind: 'jira' } },
    { id: 'OPS-4', state: 'todo', source: { kind: 'jira' } },
    { id: 'AB-5', state: 'todo', source: { kind: 'azure' } },
    { id: 'ACME-6', state: 'todo', source: { kind: 'jira' } },
  ];
  const owner = (key: string) => (key.startsWith('ACME-') ? 0 : key.startsWith('OPS-') ? 1 : null);
  const keys = placeCandidates(tasks, { kind: 'jira', index: 0, cards: [{ key: 'acme-6' }] }, owner);
  assert.deepEqual(keys, ['ACME-1', 'ACME-2'], 'not done ones, not another tracker\'s, not another kind, not one the board shows');

  const asked: string[][] = [];
  assert.deepEqual(await outsideKeys(keys, async (k) => { asked.push(k); return [{ key: 'ACME-2', why: 'not in epic ACME-9' }, { key: 'OPS-4', why: 'in project OPS' }]; }), [{ key: 'ACME-2', why: 'not in epic ACME-9' }], 'a key it wasn\'t asked about is never taken');
  assert.deepEqual(asked, [['ACME-1', 'ACME-2']]);
  assert.deepEqual(await outsideKeys(keys, async (): Promise<{ key: string }[]> => { throw new Error('401 Unauthorized'); }), [], 'a failed read says nothing left');
  let called = false;
  assert.deepEqual(await outsideKeys([], async () => { called = true; return [{ key: 'ACME-1' }]; }), []);
  assert.equal(called, false, 'nothing to ask, nothing asked');
});
