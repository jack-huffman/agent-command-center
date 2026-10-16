// A task's card: its next step, and what it says when something stops it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TaskRow } from '../src/logic/shared.ts';
import { agentsModel } from '../src/model/agents.ts';
import { actionOrder, cardActions } from '../src/model/cards.ts';
import { tasksModel } from '../src/model/tasks.ts';
import { type BoardInput, trackerBoard } from '../src/model/boards.ts';
import { homeModel } from '../src/model/home.ts';
import { needsYouCount } from '../src/model/overview.ts';
import { ticketModel } from '../src/model/task-page.ts';
import { pageStyles } from '../scripts/styles.ts';
import { emptyLedger, type Task } from '../../packages/core/src/ledger.ts';
import type { Question } from '../../packages/core/src/questions.ts';
import type { Hub } from '../src/hub.ts';
import { deriveRows } from '../src/task-rows.ts';
import { root, manifest, pageSource, row, hub } from './support.ts';

test('in review, a card offers the one next step: watch the reviewer, land a passing review, then follow the pull request', () => {
  const first = (r: Partial<TaskRow>) => cardActions({ ...row('AV-9', 'review', 'review'), deps: [], run: { worktree: '/w', branch: 'b' }, ...r } as TaskRow, {}).find((a) => a.primary)!.label;
  assert.equal(first({}), 'Review');
  assert.equal(first({ reviewing: { sessionId: 's' } }), 'Watch the review');
  assert.equal(first({ review: { verdict: 'pass', summary: 's', current: true } }), 'Land');
  assert.equal(first({ review: { verdict: 'pass', summary: 's', current: false } }), 'Review', 'a review of an older commit doesn\'t count');
  assert.equal(first({ review: { verdict: 'changes', summary: 's', current: true } }), 'Review again');
  const open = cardActions({ ...row('AV-9', 'review', 'review'), deps: [], run: { worktree: '/w' }, review: { verdict: 'pass', summary: 's', current: true }, pr: { number: 42, url: 'u', state: 'open' } } as TaskRow, {}).map((a) => a.label);
  assert.deepEqual(open.slice(0, 4), ['Pull request #42', 'Move', 'Block', 'Update pull request'], 'the next step, then Move and Block, then the rest (D-168)');
});

test('a pull request that conflicts with its base says so on its card and on the Overview, naming the files (D-049)', () => {
  const h = hub();
  const pr = (conflicts: string[]) => ({ number: 16, url: 'https://github.com/o/r/pull/16', state: 'open', ci: 'passing', changesRequested: false, conflicts });
  const rows = [
    { ...row('AV-5', 'review', 'needs-you'), pr: pr(['docs/DECISIONS.md', 'plugin/bin/acc']) },
    { ...row('AV-6', 'review', 'review'), pr: pr([]) },
    { ...row('AV-7', 'review', 'needs-you'), pr: pr(['force-app/main/default/layouts/Lead-Lead Layout.layout-meta.xml', 'b.ts', 'c.ts', 'd.ts']) },
  ];
  const conflicted = { ...h, taskRows: () => rows };
  const card = (id: string) => tasksModel(conflicted).projects[0]!.columns.flatMap((c) => c.cards).find((c) => c.id === id)!;
  assert.equal(card('AV-5').conflicts, 'Conflicts with devbox: docs/DECISIONS.md, bin/acc');
  assert.equal(card('AV-6').conflicts, null, 'a clean merge says nothing');
  assert.equal(card('AV-7').conflicts, 'Conflicts with devbox: layouts/Lead-Lead Layout.layout-meta.xml, b.ts, c.ts and 1 more', 'a card names the first few, by folder and name');
  assert.equal(tasksModel(conflicted).projects[0]!.columns.find((c) => c.group === 'needs-you')!.cards.length, 2);
  const m = homeModel({ hub: conflicted, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const item = m.overview.attention.find((a) => a.title === 'AV-5 Task AV-5')!;
  assert.deepEqual([item.look.label, item.look.icon, item.look.tone], ['Conflicts', 'git-pull-request', 'orange'], 'its words and icon, in orange');
  assert.equal(item.detail, 'Acme · pull request #16: it conflicts with devbox in docs/DECISIONS.md, bin/acc', 'by folder and name, as on the cards');
  assert.equal(item.tip, 'docs/DECISIONS.md\nplugin/bin/acc', 'every file in full, on hover');
  const many = m.overview.attention.find((a) => a.title === 'AV-7 Task AV-7')!;
  assert.equal(many.detail, 'Acme · pull request #16: it conflicts with devbox in layouts/Lead-Lead Layout.layout-meta.xml, b.ts, c.ts and 1 more');
  assert.equal(many.tip?.split('\n').length, 4);
  assert.equal(item.actions[0]!.command, 'acc.task.openPr');
});

test('checks that failed on GitHub say so on the card, the tracker\'s card and the task page, in orange with an icon, in review and after autopilot sent it back (D-076)', () => {
  const pr = { number: 16, url: 'https://github.com/o/r/pull/16', state: 'open', ci: 'failing', changesRequested: false, conflicts: [] };
  const rows: TaskRow[] = [
    { ...row('AV-5', 'review', 'needs-you'), run: { worktree: '/w5', branch: 'b5' }, review: { verdict: 'pass', summary: 's', current: true }, pr, checks: ['build', 'test'] },
    { ...row('AV-6', 'rework', 'rework'), run: { worktree: '/w6', branch: 'b6' }, pr, checks: ['build', 'test'] },
    // Re-dispatched: its builder is on it, so the card says it's running and nothing more.
    { ...row('AV-7', 'running', 'running'), run: { worktree: '/w7', branch: 'b7' }, pr, checks: null },
  ];
  const h = { ...hub(), agents: [], taskRows: () => rows };
  const card = (id: string) => tasksModel(h).projects[0]!.columns.flatMap((c) => c.cards).find((c) => c.id === id)!;
  assert.equal(card('AV-5').failedChecks, 'Checks failed on GitHub: build, test');
  assert.equal(card('AV-6').failedChecks, 'Checks failed on GitHub: build, test', 'in rework, the ones autopilot sent it back for');
  assert.equal(card('AV-7').failedChecks, null);
  assert.equal(card('AV-5').conflicts, null, 'its own line, apart from a conflict\'s');

  // The Overview's needs-you item names them.
  const m = homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const item = m.overview.attention.find((a) => a.title === 'AV-5 Task AV-5')!;
  assert.deepEqual([item.look.label, item.look.tone], ['Checks failing', 'orange']);
  assert.equal(item.detail, 'Acme · pull request #16: its checks are failing: build, test');

  const board: BoardInput = {
    index: 0, kind: 'jira', title: 'Jira', error: null, connect: null, loading: false,
    board: { source: 'jira-board', title: 'Board', url: null, notice: null, columns: [{ id: 'c', name: 'In Review', category: 'doing', statusIds: ['4'] }], cards: ['AV-5', 'AV-6', 'AV-7'].map((key) => ({ key, title: `Task ${key}`, url: 'u', status: { id: '4', name: 'In Review' }, type: 'Story', assignees: [], labels: [], priority: null })) },
  };
  const tracked = trackerBoard(board, rows, '/r').columns[0]!.cards.map((c) => [c.key, c.acc!.failedChecks]);
  assert.deepEqual(tracked, [['AV-5', 'Checks failed on GitHub: build, test'], ['AV-6', 'Checks failed on GitHub: build, test'], ['AV-7', null]], 'the tracker\'s card says it too');

  const task = { id: 'AV-6', title: 'Task AV-6', brief: '', source: { kind: 'jira', key: 'AV-6', url: null }, environment: 'devbox', deps: [], labels: [], state: 'rework', blocker: null, run: rows[1]!.run, pr,
    history: [{ at: '2026-10-06T09:00:00Z', from: 'review', to: 'rework', by: 'orchestrator:autopilot', reason: 'Checks failed on GitHub on abc1234: build, test.' }], createdAt: '', updatedAt: '' } as never;
  const page = ticketModel({ project: '/r', tracker: null, trackerTitle: null, trackerKind: null, key: 'AV-6', ticket: null, loading: false, error: null, connect: null, checks: [], row: rows[1]!, task });
  assert.equal(page.acc!.failedChecks, 'Checks failed on GitHub: build, test', 'and its page');

  // Drawn as a note, which is orange, with GitHub's checks icon beside the words.
  const main = pageSource();
  assert.match(main, /card\.failedChecks \? el\('div', 'card-note conflict', icon\('github-action'\)/);
  assert.match(main, /c\.acc\?\.failedChecks \? el\('div', 'card-note conflict tcard-conflict', icon\('github-action'\)/);
  assert.match(main, /icon\('github-action', 'orange'\)/);
  assert.match(pageStyles(), /\.card-note \{[^}]*color: var\(--orange\)/);
});

test('a task autopilot couldn\'t move on says why on its card and on the Overview, with the step to take by hand (D-055)', () => {
  const rows: TaskRow[] = [
    { ...row('AV-5', 'review', 'needs-you'), run: { worktree: '/w', branch: 'b' }, review: { verdict: 'pass', summary: 's', current: true }, autopilot: { step: 'land', reason: 'git push refused task/AV-5: rejected' } },
    { ...row('AV-6', 'rework', 'needs-you'), run: { worktree: '/w6', branch: 'b6' }, autopilot: { step: 'dispatch', reason: 'Claude Code doesn\'t trust /r yet.' } },
  ];
  const failed = { ...hub(), agents: [], taskRows: () => rows };
  const card = (id: string) => tasksModel(failed).projects[0]!.columns.flatMap((c) => c.cards).find((c) => c.id === id)!;
  assert.deepEqual(card('AV-5').autopilot, { label: 'Needs you: autopilot couldn\'t land: git push refused task/AV-5: rejected', icon: 'bell', tone: 'orange' });
  assert.equal(card('AV-6').autopilot!.label, 'Needs you: autopilot couldn\'t re-dispatch: Claude Code doesn\'t trust /r yet.');
  assert.equal(card('AV-5').actions[0]!.label, 'Land', 'the step it couldn\'t take, to take by hand');
  const m = homeModel({ hub: failed, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const item = m.overview.attention.find((a) => a.title === 'AV-5 Task AV-5')!;
  assert.deepEqual([item.look.label, item.look.icon, item.look.tone], ['Needs you: autopilot couldn\'t land', 'bell', 'orange'], 'its words and icon, in orange');
  assert.equal(item.detail, 'Acme · git push refused task/AV-5: rejected. Do it by hand, or a new commit lets autopilot try again.', 'why, not an agent waiting in its terminal');
  assert.deepEqual(item.actions.map((a) => a.label), ['Land', 'Open']);
  assert.deepEqual(m.overview.attention.find((a) => a.title === 'AV-6 Task AV-6')!.actions.map((a) => a.label), ['Re-dispatch', 'Open']);
  assert.equal(needsYouCount(m.overview), 2);
});

test('a pull request autopilot couldn\'t update from its base says so in words, with the bell, in orange, and offers the pull request (D-058)', () => {
  const reason = 'Conflicts with devbox that autopilot can\'t resolve: force-app/main/default/classes/Sum.cls. The branch is as it was, at abc1234, and nothing was pushed.';
  const rows: TaskRow[] = [{
    ...row('AV-7', 'review', 'needs-you'), run: { worktree: '/w7', branch: 'b7' }, review: { verdict: 'pass', summary: 's', current: true },
    pr: { number: 18, url: 'https://github.com/o/r/pull/18', state: 'open', conflicts: ['force-app/main/default/classes/Sum.cls'] },
    autopilot: { step: 'refresh', reason },
  }];
  const failed = { ...hub(), agents: [], taskRows: () => rows };
  const card = tasksModel(failed).projects[0]!.columns.flatMap((c) => c.cards).find((c) => c.id === 'AV-7')!;
  assert.deepEqual(card.autopilot, { label: `Needs you: autopilot couldn't update from its base: ${reason}`, icon: 'bell', tone: 'orange' });
  const m = homeModel({ hub: failed, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const item = m.overview.attention.find((a) => a.title === 'AV-7 Task AV-7')!;
  assert.deepEqual([item.look.label, item.look.icon, item.look.tone], ['Needs you: autopilot couldn\'t update from its base', 'bell', 'orange']);
  assert.equal(item.detail, `Acme · ${reason} Do it by hand, or a new commit lets autopilot try again.`);
  assert.deepEqual(item.actions.map((a) => a.label), ['Pull request #18', 'Open'], 'the pull request, where a person resolves it');
});

test('a closed pull request in review says so in words, with its icon, in orange, on the card, the tracker\'s card and the Overview, and offers Land (D-063)', () => {
  const closed = { number: 16, url: 'https://github.com/o/r/pull/16', state: 'closed', ci: 'passing', changesRequested: false, conflicts: [] };
  const rows: TaskRow[] = [
    // Its builder's session is still around: the closed pull request is what needs you, not the agent.
    { ...row('AV-8', 'review', 'needs-you'), run: { worktree: '/w8', branch: 'b8', bgId: 'bg8' }, agent: { label: 'Idle', icon: 'circle-outline', tone: 'neutral' }, pr: closed, review: { verdict: 'pass', summary: 's', current: true } },
    { ...row('AV-9', 'review', 'needs-you'), run: { worktree: '/w9', branch: 'b9' }, pr: { ...closed, number: 17, url: 'https://github.com/o/r/pull/17' } },
    { ...row('AV-10', 'blocked', 'blocked'), pr: { ...closed, number: 18 } },
  ];
  const h = { ...hub(), agents: [], taskRows: () => rows };
  const look = { label: 'Needs you: pull request #16 was closed without merging', icon: 'git-pull-request-closed', tone: 'orange' };
  const cards = tasksModel(h).projects[0]!.columns;
  const card = (id: string) => cards.flatMap((c) => c.cards).find((c) => c.id === id)!;
  assert.deepEqual(card('AV-8').closedPr, look);
  assert.deepEqual(cards.find((c) => c.group === 'needs-you')!.cards.map((c) => c.id), ['AV-8', 'AV-9']);
  assert.equal(card('AV-8').actions[0]!.label, 'Land');
  assert.equal(card('AV-10').closedPr, null, 'blocked, as acc sync leaves it, it says blocked');

  const m = homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const item = m.overview.attention.find((a) => a.title === 'AV-8 Task AV-8')!;
  assert.deepEqual([item.look.label, item.look.icon, item.look.tone], ['Pull request closed', 'git-pull-request-closed', 'orange']);
  assert.equal(item.detail, 'Acme · pull request #16 was closed without merging. Land it to open a new one, or reopen it on GitHub and land to update it.');
  assert.doesNotMatch(item.detail, /terminal/, 'not an agent waiting in its terminal');
  assert.deepEqual(item.actions.map((a) => [a.label, !!a.primary]), [['Land', true], ['Pull request #16', false], ['Open', false]]);
  const unreviewed = m.overview.attention.find((a) => a.title === 'AV-9 Task AV-9')!;
  assert.deepEqual(unreviewed.actions.map((a) => a.label), ['Review', 'Pull request #17', 'Open'], 'nothing reviewed its latest commit yet');

  const board: BoardInput = {
    index: 0, kind: 'jira', title: 'Jira', error: null, connect: null, loading: false,
    board: { source: 'jira-board', title: 'Board', url: null, notice: null, columns: [{ id: 'c', name: 'In Review', category: 'doing', statusIds: ['4'] }], cards: [{ key: 'AV-8', title: 'Task AV-8', url: 'u', status: { id: '4', name: 'In Review' }, type: 'Story', assignees: [], labels: [], priority: null }] },
  };
  const tracked = trackerBoard(board, rows, '/r').columns[0]!.cards[0]!.acc!;
  assert.deepEqual([tracked.look, tracked.needsYou], [look, true], 'the tracker\'s card says the same');
});

test('a builder that stopped says so with what it last said, in orange with its icon, on the card, the tracker\'s card and the Overview, and offers Resume (D-067)', () => {
  const said = 'API Error: Your computer went to sleep mid-response. The response above may be incomplete.';
  const rows: TaskRow[] = [
    // Its old background session still says blocked: the stopped line says it all.
    { ...row('AV-5', 'running', 'needs-you'), run: { worktree: '/w5', branch: 'b5', bgId: 'bg5', sessionId: 'sess-5' }, agent: { label: 'Needs you', icon: 'bell', tone: 'orange' }, stopped: { said } },
    { ...row('AV-6', 'running', 'needs-you'), run: { worktree: '/w6', branch: 'b6', bgId: 'bg6', sessionId: 'sess-6' }, stopped: { said: `I stopped here. ${'x'.repeat(300)}` } },
    { ...row('AV-7', 'running', 'needs-you'), run: { worktree: '/w7', branch: 'b7', sessionId: 'sess-7' }, stopped: { said: null } },
    // Being resumed: no second Resume.
    { ...row('AV-11', 'running', 'running'), run: { worktree: '/w11', branch: 'b11', sessionId: 'sess-11' }, resuming: true, agent: { label: 'Resumed: working', icon: 'sync~spin', tone: 'blue' } },
  ];
  const h = { ...hub(), agents: [], taskRows: () => rows };
  const cards = tasksModel(h).projects[0]!.columns;
  const card = (id: string) => cards.flatMap((c) => c.cards).find((c) => c.id === id)!;
  assert.deepEqual(card('AV-5').stopped, { label: `Needs you: its agent stopped: ${said}`, icon: 'debug-disconnect', tone: 'orange' });
  assert.equal(card('AV-5').agent, null, 'not "Agent: Needs you" as well');
  assert.ok(card('AV-6').stopped!.label.length < 160 && card('AV-6').stopped!.label.endsWith('…'), 'a long quote is clipped on a card');
  assert.equal(card('AV-7').stopped!.label, 'Needs you: its agent stopped before it finished or blocked');
  assert.deepEqual(cards.find((c) => c.group === 'needs-you')!.cards.map((c) => c.id), ['AV-5', 'AV-6', 'AV-7']);
  // Its one next step is Resume (D-062); Watch and Open in Claude Code wait behind ⋯.
  const acts = card('AV-5').actions;
  assert.deepEqual([acts[0]!.command, acts[0]!.label, acts[0]!.icon, !!acts[0]!.primary], ['acc.task.resume', 'Resume', 'debug-continue', true]);
  assert.deepEqual(acts.filter((a) => a.primary).map((a) => a.command), ['acc.task.resume']);
  assert.ok(acts.some((a) => a.command === 'acc.task.watch') && acts.some((a) => a.command === 'acc.task.openInClaude'));
  assert.ok(!card('AV-11').actions.some((a) => a.command === 'acc.task.resume'));
  assert.equal(card('AV-11').stopped, null);

  const m = homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const item = m.overview.attention.find((a) => a.title === 'AV-5 Task AV-5')!;
  assert.deepEqual([item.look.label, item.look.icon, item.look.tone], ['Its agent stopped', 'debug-disconnect', 'orange']);
  assert.equal(item.detail, `Acme · ${said}`);
  assert.doesNotMatch(item.detail, /terminal/, 'not an agent waiting in its terminal');
  assert.deepEqual(item.actions.map((a) => [a.label, !!a.primary]), [['Resume', true], ['Watch', false], ['Open', false]]);
  assert.equal(m.overview.attention.find((a) => a.title === 'AV-7 Task AV-7')!.detail, 'Acme · its turn ended before it finished or blocked');
  assert.ok(needsYouCount(m.overview) >= 3, 'counted in the badge and the status bar');

  const board: BoardInput = {
    index: 0, kind: 'jira', title: 'Jira', error: null, connect: null, loading: false,
    board: { source: 'jira-board', title: 'Board', url: null, notice: null, columns: [{ id: 'c', name: 'Doing', category: 'doing', statusIds: ['3'] }], cards: [{ key: 'AV-5', title: 'Task AV-5', url: 'u', status: { id: '3', name: 'Doing' }, type: 'Story', assignees: [], labels: [], priority: null }] },
  };
  const tracked = trackerBoard(board, rows, '/r').columns[0]!.cards[0]!.acc!;
  assert.deepEqual([tracked.look.label, tracked.look.tone, tracked.needsYou, tracked.action?.command], [`Needs you: its agent stopped: ${said}`, 'orange', true, 'acc.task.resume']);
});

test('a task that waits for others\' files says so with a clock, in blue; its next step is Dispatch anyway, and Stop waiting sits behind ⋯ (D-093)', () => {
  const held = { at: '2026-10-06T10:00:00.000Z', failed: null, byAutopilot: false };
  const todo = (id: string, display: TaskRow['display'], files: TaskRow['files']): TaskRow => ({ ...row(id, 'todo', display), deps: [], files });
  const rows: TaskRow[] = [
    todo('AV-5', 'ready', { known: true, shares: [{ task: 'AV-1', files: ['src/a.ts', 'force-app/main/default/classes/X.cls'] }], first: ['AV-6'], held }),
    todo('AV-6', 'ready', { known: true, shares: [], first: [], held: null }),
    todo('AV-7', 'ready', { known: false, shares: [], first: [], held: null }),
    todo('AV-8', 'ready', { known: true, shares: [{ task: 'AV-1', files: ['src/a.ts'] }], first: ['AV-6'], held: null }),
    { ...row('AV-1', 'running', 'running'), run: { bgId: 'bg1', worktree: '/w1', branch: 'b1' }, files: { known: true, shares: [{ task: 'AV-9', files: ['lib/b.ts'] }], first: [], held: null } },
    todo('AV-10', 'needs-you', { known: true, shares: [], first: [], held: { ...held, failed: 'Claude Code doesn\'t trust /r yet.', byAutopilot: true } }),
    todo('AV-11', 'ready', { known: true, shares: [{ task: 'AV-1', files: ['src/a.ts'] }], first: [], held }),
    todo('AV-12', 'ready', { known: false, analyzed: true, shares: [], first: [], held: null }),
  ];
  const h = { ...hub(), agents: [], taskRows: () => rows };
  const card = (id: string) => tasksModel(h).projects[0]!.columns.flatMap((c) => c.cards).find((c) => c.id === id)!;
  // Held: a clock and the words, in blue, the files by folder and name, and the Ready task that goes first.
  assert.deepEqual(card('AV-5').files, { label: 'Waits for AV-1\'s files: src/a.ts, classes/X.cls, while AV-6 is ready to start', icon: 'clock', tone: 'blue' });
  assert.deepEqual(card('AV-5').actions.filter((a) => a.primary).map((a) => [a.label, a.command]), [['Dispatch anyway', 'acc.task.dispatchAnyway']]);
  assert.ok(card('AV-5').actions.some((a) => a.command === 'acc.task.stopWaiting' && !a.primary), 'Stop waiting, behind ⋯');
  assert.ok(!card('AV-5').actions.some((a) => a.command === 'acc.task.dispatch'), 'it was dispatched already');
  assert.ok(tasksModel(h).projects[0]!.columns.find((c) => c.group === 'ready')!.cards.some((c) => c.id === 'AV-5'), 'it stays in the Ready lane');
  // Its wait is over: it's about to start.
  assert.deepEqual([card('AV-11').files?.label, card('AV-11').files?.tone], ['Starting: nothing else is ready, so it shares files with AV-1', 'blue']);
  // Nothing to say about one that shares nothing.
  assert.equal(card('AV-6').files, null);
  assert.deepEqual(card('AV-6').actions.filter((a) => a.primary).map((a) => a.label), ['Dispatch']);
  // No analysis: its files aren't known, said in a neutral tone, and it's dispatched as ever.
  assert.deepEqual(card('AV-7').files, { label: 'Its files aren\'t known: no analysis to compare with work in flight', icon: 'info', tone: 'neutral' });
  assert.deepEqual(card('AV-7').actions.filter((a) => a.primary).map((a) => a.label), ['Dispatch']);
  // An analysis that names no files isn't told it has none.
  assert.deepEqual(card('AV-12').files, { label: 'Its files aren\'t known: its analysis names no files', icon: 'info', tone: 'neutral' });
  // Shares files but isn't held: said before Dispatch, and on a task that started beside another.
  assert.deepEqual(card('AV-8').files, { label: 'Shares files with AV-1: src/a.ts', icon: 'files', tone: 'neutral' });
  assert.deepEqual(card('AV-1').files, { label: 'Shares files with AV-9: lib/b.ts', icon: 'files', tone: 'neutral' });
  // A start that failed needs you: the bell, in orange, and on the Overview with Dispatch anyway.
  assert.deepEqual(card('AV-10').files, { label: 'Needs you: autopilot couldn\'t start it: Claude Code doesn\'t trust /r yet.', icon: 'bell', tone: 'orange' });
  const m = homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const item = m.overview.attention.find((a) => a.title === 'AV-10 Task AV-10')!;
  assert.deepEqual([item.look.label, item.look.icon, item.look.tone, item.detail], ['Needs you: autopilot couldn\'t start it', 'bell', 'orange', 'Acme · Claude Code doesn\'t trust /r yet. Dispatch it anyway, or stop it waiting.']);
  assert.deepEqual(item.actions.map((a) => a.label), ['Dispatch anyway', 'Open']);

  // The task page names every file in full; the tracker's card says it waits.
  const task = { id: 'AV-5', title: 'Task AV-5', brief: '', source: { kind: 'jira', key: 'AV-5', url: null }, environment: 'devbox', deps: [], labels: [], state: 'todo', blocker: null, run: null, pr: null, history: [], createdAt: '', updatedAt: '' } as never;
  const page = ticketModel({ project: '/r', tracker: null, trackerTitle: null, trackerKind: null, key: 'AV-5', ticket: null, loading: false, error: null, connect: null, checks: [], row: rows[0]!, task });
  assert.equal(page.acc!.files!.label, 'Waits for AV-1\'s files: src/a.ts, force-app/main/default/classes/X.cls, while AV-6 is ready to start');
  assert.deepEqual([page.acc!.look.label, page.acc!.look.icon, page.acc!.look.tone], ['Waits for AV-1\'s files, while AV-6 is ready to start', 'clock', 'blue'], 'its State, in a few words, with what goes first');
  assert.ok(page.acc!.actions.some((a) => a.command === 'acc.task.stopWaiting'));
  const board: BoardInput = {
    index: 0, kind: 'jira', title: 'Jira', error: null, connect: null, loading: false,
    board: { source: 'jira-board', title: 'Board', url: null, notice: null, columns: [{ id: 'c', name: 'To Do', category: 'todo', statusIds: ['1'] }], cards: [{ key: 'AV-5', title: 'Task AV-5', url: 'u', status: { id: '1', name: 'To Do' }, type: 'Story', assignees: [], labels: [], priority: null }] },
  };
  const tcard = trackerBoard(board, rows, '/r').columns[0]!.cards[0]!;
  assert.deepEqual([tcard.acc!.look.icon, tcard.acc!.look.tone, tcard.acc!.action?.label], ['clock', 'blue', 'Dispatch anyway']);

  // Drawn with its icon and words, on the card and the page, and the page and menus may run both commands.
  const main = pageSource();
  assert.match(main, /card\.files \? el\('div', 'card-agent', status\(card\.files\)\) : null/);
  assert.match(main, /if \(m\.acc\?\.files\)/);
  for (const command of ['acc.task.dispatchAnyway', 'acc.task.stopWaiting']) {
    assert.ok(manifest.contributes.commands.some((c: { command: string }) => c.command === command), command);
    assert.match(readFileSync(join(root, 'src', 'model', 'tasks.ts'), 'utf8'), new RegExp(`'${command.replace('.', '\\.')}'`));
    assert.match(readFileSync(join(root, 'src', 'ticket.ts'), 'utf8'), new RegExp(`'${command.replace('.', '\\.')}'`));
  }
});

test('no card or task page lists Dispatch with… or Dispatch to the cloud: one Dispatch opens the sheet, and their commands stay for one release (D-168)', () => {
  const actions = (r: Partial<TaskRow>) => cardActions({ ...row('AV-9', 'todo', 'ready'), deps: [], ...r } as TaskRow, { project: '/r', task: 'AV-9' });
  const gone = ['acc.task.dispatchWith', 'acc.task.dispatchCloud'];
  const states = [{}, { state: 'rework', display: 'rework' as const }, { files: { known: true, shares: [{ task: 'AV-1', files: ['a.ts'] }], first: [], held: { at: '', failed: null, byAutopilot: false } } }, { state: 'running', display: 'running' as const, run: { bgId: 'bg1' } }, { state: 'review', display: 'review' as const }, { analysisRequired: true }];
  for (const r of states) assert.ok(!actions(r as Partial<TaskRow>).some((a) => gone.includes(a.command)), JSON.stringify(r));
  assert.equal(actions({}).filter((a) => a.label.startsWith('Dispatch')).length, 1, 'one Dispatch');
  const task = { id: 'AV-9', title: 'Task AV-9', brief: '', source: { kind: 'jira', key: 'AV-9', url: null }, environment: 'devbox', deps: [], labels: [], state: 'todo', blocker: null, history: [], createdAt: '', updatedAt: '' } as never;
  const page = ticketModel({ project: '/r', tracker: null, trackerTitle: null, trackerKind: null, key: 'AV-9', ticket: null, loading: false, error: null, connect: null, checks: [], row: { ...row('AV-9', 'todo', 'ready'), deps: [] }, task });
  assert.deepEqual(page.acc!.actions.map((a) => a.command), ['acc.task.dispatch', 'acc.task.move', 'acc.task.block'], 'the task page: Dispatch, then Move, then Block');
  // Their commands are kept, so a key binding still works, and each opens the sheet (dispatch-sheet-open.test.ts runs them).
  for (const command of gone) assert.ok(manifest.contributes.commands.some((c: { command: string }) => c.command === command), command);
  const tasks = readFileSync(join(root, 'src', 'tasks.ts'), 'utf8');
  assert.match(tasks, /reg\('acc\.task\.dispatchWith', \(n: TaskNode\) => this\.ask\(n\)\)/);
  assert.match(tasks, /reg\('acc\.task\.dispatchCloud', \(n: TaskNode\) => this\.ask\(n, \{ where: 'cloud' \}\)\)/);
  assert.match(tasks, /reg\('acc\.task\.dispatchAnyway', \(n: TaskNode\) => this\.ask\(n, \{ anyway: true \}\)\)/);
});

test('a running card, its task page and its Agents row name the model its agent runs with, in plain text (D-086)', () => {
  const h = hub();
  const running: TaskRow = { ...row('AV-1', 'running', 'running'), run: { bgId: 'bg1', model: 'claude-sonnet-5-5', modelPicked: true }, agent: { label: 'Working', icon: 'sync~spin', tone: 'blue' }, model: 'claude-sonnet-5-5' };
  const stopped: TaskRow = { ...row('AV-3', 'running', 'needs-you'), run: { sessionId: 's3', model: 'claude-opus-5-5' }, stopped: { said: null }, agent: { label: 'Stopped', icon: 'debug-pause', tone: 'orange' }, model: 'claude-opus-5-5' };
  h.taskRows = () => [running, stopped, { ...row('AV-2', 'todo', 'ready'), deps: [] }];
  const cards = tasksModel(h).projects[0]!.columns.flatMap((c) => c.cards);
  assert.equal(cards.find((c) => c.id === 'AV-1')!.model, 'claude-sonnet-5-5');
  assert.equal(cards.find((c) => c.id === 'AV-3')!.model, null, 'a stopped builder\'s line says it all');
  assert.equal(cards.find((c) => c.id === 'AV-2')!.model, null, 'no agent, no model');
  const task = { id: 'AV-1', title: 'Task AV-1', brief: '', source: { kind: 'jira', key: 'AV-1', url: null }, environment: 'devbox', deps: [], labels: [], state: 'running', blocker: null, run: running.run, history: [], createdAt: '', updatedAt: '' } as never;
  const page = ticketModel({ project: '/r', tracker: null, trackerTitle: null, trackerKind: null, key: 'AV-1', ticket: null, loading: false, error: null, connect: null, checks: [], row: running, task });
  assert.equal(page.acc!.model, 'claude-sonnet-5-5');
  // The Agents tab asks the hub, which reads the transcript, then what acc started it with.
  h.modelFor = (s) => (s.id === 'bg1' ? 'claude-sonnet-5-5' : null);
  const rows = agentsModel(h).repos.flatMap((r) => r.tasks.flatMap((t) => t.agents));
  assert.deepEqual(rows.map((r) => [r.name, r.model]), [['av-2', 'claude-sonnet-5-5'], ['other', null]]);
  const main = pageSource();
  assert.match(main, /\['Model', 'model'\]/, 'a Model column');
  assert.match(main, /el\('td', 'mono muted model', el\('span', 'unbroken', a\.model \? shortModel\(a\.model\) : '—'\), a\.model && a\.effort \? ' ' : null, a\.model && a\.effort \? el\('span', 'unbroken', `· \$\{a\.effort\}`\) : null\), \{ title: a\.model \?/, 'a dash until it\'s known, in neutral mono text, its full name on hover, and an effort beside it (D-128)');
  assert.match(main, /card\.agent && card\.model \? el\('div', 'card-where card-model'/);
  assert.match(main, /field\('Model', el\('span', '', el\('span', 'mono', a\.model\), a\.effort \? el\('span', 'muted', ` · \$\{a\.effort\} effort`\) : null\)\)/);
});

test('a task page and its Agents row show a builder\'s effort beside its model only when it isn\'t the model\'s default (D-128)', () => {
  const h = hub();
  const at = (effort: 'xhigh' | 'high', model = 'claude-sonnet-5-5'): TaskRow => ({ ...row('AV-1', 'running', 'running'), run: { bgId: 'bg1', model, effort, effortPicked: true }, agent: { label: 'Working', icon: 'sync~spin', tone: 'blue' }, model, effort: effort === 'high' ? null : effort });
  const task = { id: 'AV-1', title: 'Task AV-1', brief: '', source: { kind: 'jira', key: 'AV-1', url: null }, environment: 'devbox', deps: [], labels: [], state: 'running', blocker: null, history: [], createdAt: '', updatedAt: '' };
  const page = (r: TaskRow) => ticketModel({ project: '/r', tracker: null, trackerTitle: null, trackerKind: null, key: 'AV-1', ticket: null, loading: false, error: null, connect: null, checks: [], row: r, task: { ...task, run: r.run } as never });
  assert.equal(page(at('xhigh')).acc!.effort, 'xhigh');
  assert.equal(page(at('high')).acc!.effort, null, 'Sonnet 5.5\'s default');
  h.modelFor = (s) => (s.id === 'bg1' ? 'claude-sonnet-5-5' : null);
  const lines = (r: TaskRow) => { h.taskRows = () => [r]; return agentsModel(h).repos.flatMap((x) => x.tasks.flatMap((t) => t.agents)).filter((a) => a.model); };
  assert.deepEqual(lines(at('xhigh')).map((a) => [a.model, a.effort]), [['claude-sonnet-5-5', 'xhigh']]);
  assert.deepEqual(lines(at('high')).map((a) => [a.model, a.effort]), [['claude-sonnet-5-5', null]]);
});

test('a card whose agent asks offers Answer, to its question, as its one next step on the right of its foot (T-39)', () => {
  const ref = { project: '/r', task: 'AV-9' };
  const asking: TaskRow = { ...row('AV-9', 'running', 'needs-you'), deps: [], run: { bgId: 'bg1', sessionId: 's9' }, agent: { label: 'Needs you: wants permission', icon: 'bell', tone: 'orange' }, asking: true, question: 'q-9' };
  const acts = cardActions(asking, ref);
  assert.deepEqual(acts.filter((a) => a.primary).map((a) => [a.label, a.command, a.icon, a.question]), [['Answer', 'acc.task.show', 'bell', 'q-9']]);
  assert.ok(acts.some((a) => a.command === 'acc.task.watch' && !a.primary), 'Watch goes behind ⋯');
  // Edge: its question isn't read yet, so there's no Answer, and Watch stays its next step.
  assert.deepEqual(cardActions({ ...asking, question: null }, ref).filter((a) => a.primary).map((a) => a.label), ['Watch']);
  // Edge: a stopped builder's next step is Resume, not Answer.
  assert.deepEqual(cardActions({ ...asking, stopped: { said: null } }, ref).filter((a) => a.primary).map((a) => a.label), ['Resume']);
  // Edge: in the cloud there's no question here to answer.
  assert.ok(!cardActions({ ...asking, run: { ...asking.run, where: 'cloud' } }, ref).some((a) => a.label === 'Answer'));
  // The page: the foot draws the next step full width under it (D-168) through nextStep, which goes to the question, as Agents' Answer does.
  const boards = pageSource('boards.ts');
  assert.match(boards, /el\('div', 'card-meta', [^\n]*\) : null,\n    primary \? nextStep\(primary\) : null\);/);
  assert.match(boards, /if \(!a\.question\) return actionTile\(a, true\);/);
  assert.match(boards, /go\('overview'\); answerHere\(id\);/);
  assert.match(pageSource('tasks.ts'), /c\.acc\.action \? nextStep\(c\.acc\.action\) : null/, 'a tracker card\'s next step too');
});

test('deriveRows gives a card its agent\'s question id; edge cases: no question, a question for another session, an agent that doesn\'t ask (T-39)', () => {
  const task = {
    id: 'AV-9', title: 'Task AV-9', brief: '', source: { kind: 'manual', url: null }, environment: 'devbox', deps: [], labels: [], state: 'running', blocker: null,
    run: { worktree: '/w', branch: 'task/AV-9', sessionId: 's9' }, pr: null, history: [], createdAt: '', updatedAt: '',
  } as unknown as Task;
  const session = { cwd: '/w', kind: 'interactive', startedAt: 1, sessionId: 's9', name: 'av-9', status: 'waiting', pid: 9 };
  const question = (id: string, sessionId: string) => ({ id, sessionId }) as Question;
  const read = (questions: Question[], asks = true): TaskRow => {
    const fake = {
      agentsAt: 1, agentsError: null, agents: [session], questions,
      askingFor: () => (asks ? 'wants permission' : null), tieFor: () => null, lastSaid: () => null, lastModel: () => null,
    } as unknown as Hub;
    return deriveRows(fake, { ...emptyLedger(), tasks: [task] })[0]!;
  };
  const asking = read([question('q-other', 's1'), question('q-9', 's9')]);
  assert.equal(asking.asking, true);
  assert.equal(asking.question, 'q-9', 'the question for this row\'s session');
  assert.equal(read([]).question, null, 'no question read yet');
  assert.equal(read([question('q-other', 's1')]).question, null, 'a question for a different session');
  assert.equal(read([question('q-9', 's9')], false).question, null, 'an agent that doesn\'t ask has no question to answer');
});

test('the task page draws its actions with taskActions: the next step full width, the rest in the grid, a disabled one in place with its reason (D-168)', () => {
  assert.match(pageSource('task-page.ts'), /taskActions\(a\.actions\)/, 'the task page\'s Agent panel');
  const tiles = pageSource('task-actions.ts');
  assert.match(tiles, /const next = actions\[0\]!\.primary \? actions\[0\]! : null;/, 'the next step only when the first is one');
  assert.match(tiles, /el\('div', 'ta-grid', \.\.\.rest\.map\(\(a\) => actionTile\(a, false\)\)\)/, 'the rest in the grid, none of them primary');
  assert.match(tiles, /set\.dataset\.actionSet = 'task';/, 'marked for the geometry check');
  assert.match(tiles, /b\.title = a\.disabled \? `\$\{a\.label\}: \$\{a\.disabled\}` : a\.label;/, 'its label whole in its title, and why it is off');
  // Edge: a cloud task's Open in Claude Code is off with its reason, and stays in its place on the page.
  const cloud = { sessionId: 's', url: 'https://claude.ai/code/s', firedAt: '', head: '', lastPushAt: '' };
  const acts = cardActions({ ...row('AV-9', 'running', 'running'), deps: [], run: { worktree: '/w', where: 'cloud', cloud }, cloud: { url: cloud.url, wait: null, finished: false } } as TaskRow, {});
  assert.ok(acts.find((a) => a.label === 'Open in Claude Code')?.disabled, 'off, with why');
  const styles = pageStyles();
  assert.match(styles, /\.ta-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/, 'two equal columns');
  assert.match(styles, /\.ta-btn \{[^}]*height: 30px;/, 'each the same height');
});

test('actionOrder puts the next step first, then Move, then Block or Unblock, then the rest as they came, with edge cases (D-168)', () => {
  const a = (command: string, primary = false) => ({ command, label: command.split('.').at(-1)!, icon: 'x', ref: {}, ...(primary ? { primary } : {}) });
  const names = (xs: { label: string }[]) => xs.map((x) => x.label);
  assert.deepEqual(names(actionOrder([a('acc.task.watch'), a('acc.task.block'), a('acc.task.show'), a('acc.task.move'), a('acc.task.review', true)])), ['review', 'move', 'block', 'watch', 'show']);
  assert.deepEqual(names(actionOrder([a('acc.task.show'), a('acc.task.unblock'), a('acc.task.move', true)])), ['move', 'unblock', 'show'], 'Move as the next step comes once');
  assert.deepEqual(names(actionOrder([a('acc.task.show'), a('acc.task.watch')])), ['show', 'watch'], 'no next step, Move or Block: as they came');
  assert.deepEqual(actionOrder([]), [], 'nothing to order');
  assert.deepEqual(names(actionOrder([a('acc.task.watch', true), a('acc.task.collect', true)])), ['watch', 'collect'], 'only the first primary leads');
});
