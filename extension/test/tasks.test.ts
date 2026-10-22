// Tasks: the agent board, a row's analysis, files a task waits for, and following its pull request.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeRepo, tempDir } from '../../packages/core/test/support.ts';
import { followsPullRequests } from '../src/logic/tasks.ts';
import type { TaskRow } from '../src/logic/shared.ts';
import { analysisLook, cardActions } from '../src/model/cards.ts';
import { dropLanes, laneMove, tasksModel } from '../src/model/tasks.ts';
import { root, row, hub, ask, asks, tooBig, analysed } from './support.ts';

test('a row reads its analysis and the one under way from beside the ledger; a dead analyst is no longer analyzing (D-052)', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { analyzing, readAnalysis } = await import('../../packages/core/src/analyze.ts');
  const { tempDir } = await import('../../packages/core/test/support.ts');
  const { analysisReady, analysisWait, rowAnalysis } = await import('../src/logic/tasks.ts');
  const paths = { analyses: join(tempDir(), 'acc', 'analyses') } as import('../../packages/core/src/paths.ts').RepoPaths;
  mkdirSync(paths.analyses, { recursive: true });
  const a = {
    v: 1, task: 'T-1', env: 'main', base: 'abc', verdict: 'questions', summary: 'Do it.', requirements: { goal: '', criteria: [], assumptions: [], outOfScope: [] },
    questions: [{ id: 'q1', question: 'Which?', why: 'Because.', suggested: 'This one.' }, { id: 'q2', question: 'When?', why: '', suggested: 'Now.', answer: { text: 'Later', by: 'me', at: 't' } }],
    findings: [], approach: { plan: [], files: [], refactors: [], risks: [], tests: [], size: 'S' }, split: [], orgs: [], sessionId: 's', at: '2026-10-05T10:00:00.000Z', durationMs: 1, costUsd: null,
  };
  writeFileSync(join(paths.analyses, 'T-1.json'), JSON.stringify(a));
  const row = rowAnalysis(readAnalysis(paths, 'T-1')!);
  assert.deepEqual(row, { verdict: 'questions', at: '2026-10-05T10:00:00.000Z', open: [{ id: 'q1', question: 'Which?', why: 'Because.', suggested: 'This one.', askOf: 'you' }], split: [], size: 'S', choices: 0, approved: false, version: 1 }, 'only the questions nobody answered, who answers each, and its size (D-086); its plan has no choice to make and isn\'t approved (T-97)');
  assert.equal(analysisWait({ state: 'todo', analysis: row }), 'questions');
  assert.equal(analysisWait({ state: 'running', analysis: row }), null, 'only a task to do waits on its analysis');
  assert.equal(analysisWait({ state: 'todo', analysis: row, analyzing: { sessionId: 's2' } }), null, 'nor while it\'s analyzed again');
  assert.equal(analysisReady({ analysis: { ...row, open: [] } }), true);
  assert.equal(analysisReady({ analysis: { ...row, open: [], verdict: 'split' } }), false);
  writeFileSync(join(paths.analyses, 'T-1.running.json'), JSON.stringify({ sessionId: 'live', startedAt: 't', pid: process.pid }));
  assert.equal(analyzing(paths, 'T-1')?.sessionId, 'live');
  writeFileSync(join(paths.analyses, 'T-1.running.json'), JSON.stringify({ sessionId: 'gone', startedAt: 't', pid: 999_999_999 }));
  assert.equal(analyzing(paths, 'T-1'), null, 'its process has gone');
});

test('an answer goes through acc, after --, so words that start with - stay words (D-012, D-052)', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { GENERIC_CONFIG, makeRepo } = await import('../../packages/core/test/support.ts');
  const { analysisAnswerArgs } = await import('../src/logic/tasks.ts');
  const args = analysisAnswerArgs('T-1', 'q1', '-5 days, not --json');
  assert.deepEqual(args, ['analysis', 'answer', 'T-1', 'q1', '--json', '--', '-5 days, not --json']);
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  const main = join(root, '..', 'packages', 'cli', 'src', 'main.ts');
  const acc = (a: string[]) => spawnSync(process.execPath, ['--no-warnings', main, ...a], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ACC_ROLE: '', ACC_TASK: '' } });
  assert.equal(acc(['add', 'Work']).status, 0);
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  const analyses = join(common, 'acc', 'analyses');
  mkdirSync(analyses, { recursive: true });
  writeFileSync(join(analyses, 'T-1.json'), JSON.stringify({
    v: 1, task: 'T-1', env: 'main', base: 'abc', verdict: 'questions', summary: 'Do it.', requirements: { goal: '', criteria: [], assumptions: [], outOfScope: [] },
    questions: [{ id: 'q1', question: 'How long?', why: '', suggested: '3 days' }], findings: [], approach: { plan: [], files: [], refactors: [], risks: [], tests: [], size: 'S' },
    split: [], orgs: [], sessionId: 's', at: '2026-10-05T10:00:00.000Z', durationMs: 1, costUsd: null,
  }));
  const r = acc(args);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const out = JSON.parse(r.stdout);
  assert.deepEqual([out.verdict, out.questions[0].answer.text], ['ready', '-5 days, not --json'], 'the words as given, and the last answer makes it ready');
});

test('a task that waits for others\' files is told in words: what it waits for, what goes first, and what Dispatch anyway risks (D-093)', async () => {
  const { anywayQuestion, filesUnknown, sharesLine, startedNotice, waitLine, waitQuestion, waitsForFiles } = await import('../src/logic/tasks.ts');
  const { autopilotNotices } = await import('../src/logic/autopilot.ts');
  const { noticeActions } = await import('../src/logic/notices.ts');
  const shares = [{ task: 'GH-70', files: ['extension/src/logic.ts', 'extension/src/model.ts', 'packages/cli/src/main.ts', 'docs/x.md'] }, { task: 'GH-71', files: ['extension/src/hub.ts'] }];
  // A card names the first three files short; the task page names every one in full.
  assert.equal(waitLine(shares), 'Waits for GH-70\'s files: src/logic.ts, src/model.ts and 2 more, and GH-71\'s: src/hub.ts', 'three names in all');
  assert.equal(waitLine([shares[0]!]), 'Waits for GH-70\'s files: src/logic.ts, src/model.ts, src/main.ts and 1 more');
  assert.equal(waitLine(shares, true), 'Waits for GH-70\'s files: extension/src/logic.ts, extension/src/model.ts, packages/cli/src/main.ts, docs/x.md, and GH-71\'s: extension/src/hub.ts');
  // With what goes first, as acc says it: a card names two of them, the page every one.
  assert.equal(waitLine([shares[1]!], false, ['GH-74']), 'Waits for GH-71\'s files: src/hub.ts, while GH-74 is ready to start');
  assert.equal(waitLine([shares[1]!], false, ['GH-74', 'GH-75', 'GH-76']), 'Waits for GH-71\'s files: src/hub.ts, while GH-74, GH-75 and 1 more are ready to start');
  assert.equal(waitLine([shares[1]!], true, ['GH-74', 'GH-75', 'GH-76']), 'Waits for GH-71\'s files: extension/src/hub.ts, while GH-74, GH-75 and GH-76 are ready to start');
  assert.equal(sharesLine([shares[1]!]), 'Shares files with GH-71: src/hub.ts');
  // No analysis, or one that names no files: each said as it is.
  assert.equal(filesUnknown(false), 'Its files aren\'t known: no analysis to compare with work in flight');
  assert.equal(filesUnknown(true), 'Its files aren\'t known: its analysis names no files');
  const files = { known: true, shares, first: ['GH-74'], held: null };
  assert.ok(waitsForFiles({ state: 'todo', files }));
  assert.ok(!waitsForFiles({ state: 'todo', files: { ...files, first: [] } }), 'nothing else is ready: it starts');
  assert.ok(!waitsForFiles({ state: 'running', files }));
  const q = waitQuestion({ id: 'GH-73', files });
  assert.equal(q.message, 'GH-73 shares files with GH-70 and GH-71');
  assert.equal(q.wait, 'Wait for GH-70 and GH-71');
  assert.equal(q.detail, 'GH-70: extension/src/logic.ts, extension/src/model.ts, packages/cli/src/main.ts, docs/x.md\nGH-71: extension/src/hub.ts\n\nGH-74 shares no files with work in flight, so it goes first. GH-73 waits, and starts on its own once GH-70 and GH-71 merge or nothing else is ready.');
  const a = anywayQuestion({ id: 'GH-73', files });
  assert.equal(a.message, 'Dispatch GH-73 anyway?');
  assert.match(a.detail, /^It shares files with work in flight:\nGH-70: extension\/src\/logic\.ts, .*\nGH-71: extension\/src\/hub\.ts\n\nBoth builders may change them, and the second pull request to merge may conflict there\.$/);
  assert.equal(anywayQuestion({ id: 'GH-73', files: { ...files, shares: [] } }).message, 'Dispatch GH-73 now?', 'its wait ended meanwhile');
  assert.equal(startedNotice('GH-73 started', { waitedFor: ['GH-70'], shares: [] }), 'GH-73 started: GH-70\'s files are free.');
  assert.equal(startedNotice('GH-73 started', { waitedFor: ['GH-70'], shares: [shares[0]!] }), 'GH-73 started: nothing else was ready, so it shares files with GH-70.');
  // Autopilot's own start, and one it couldn't make, are its notices.
  const at = '2026-10-06T12:00:00.000Z';
  const task = { id: 'GH-73', source: { kind: 'github', key: '73' }, history: [] };
  const say = (r: Record<string, unknown>) => autopilotNotices([{ seq: 1, at, task: 'GH-73', step: 'start', outcome: 'done', ...r } as never], [task]).map((n) => [n.text, n.urgent, noticeActions(n)]);
  assert.deepEqual(say({ waitedFor: ['GH-70'] }), [['Autopilot started GH-73: GH-70\'s files are free.', false, [['Watch', 'acc.task.watch'], ['Show', 'acc.task.show']]]]);
  assert.deepEqual(say({ outcome: 'failed', reason: 'Claude Code doesn\'t trust the repo yet' }), [['Autopilot couldn\'t start GH-73: Claude Code doesn\'t trust the repo yet.', true, [['Dispatch anyway', 'acc.task.dispatchAnyway'], ['Show', 'acc.task.show']]]]);
});

test('the board asks acc to start held tasks when one may go, and backs off while acc keeps them waiting (D-093)', async () => {
  const { HELD_ASK_MAX_MS, HELD_ASK_MS, heldAskDue, heldAsked, heldAskKey, heldDue } = await import('../src/logic/tasks.ts');
  const held = { at: '2026-10-06T10:00:00.000Z', failed: null, byAutopilot: false };
  const todo = (id: string, files: Record<string, unknown>, deps: string[] = []) => ({ id, state: 'todo', deps, pr: null, files: { known: true, shares: [], first: [], held, ...files } as never });
  const rows = [
    todo('T-2', {}),
    todo('T-3', { shares: [{ task: 'T-1', files: ['a.ts'] }], first: ['T-4'] }),
    todo('T-5', { held: { ...held, failed: 'No trust' } }),
    todo('T-6', { capped: 'project' }),
    todo('T-9', { capped: 'machine' }),
    todo('T-7', {}, ['T-1']),
    todo('T-8', { held: null }),
    { id: 'T-1', state: 'running', deps: [], pr: null, files: null },
  ];
  // Only T-2 may go: T-3 still waits, T-5's start failed, T-6 and T-9 wait for an agent (the project's cap, this
  // machine's total), T-7 for T-1, T-8 isn't held.
  assert.deepEqual(heldDue(rows), ['T-2']);
  const key = heldAskKey(rows, ['T-2']);
  let t = 0;
  assert.ok(heldAskDue(undefined, key, t), 'never asked: ask now');
  // acc keeps T-2 waiting (the board missed something): 60 seconds, then 2 minutes, then 4, up to 10.
  let ask = heldAsked(undefined, key, t, ['T-2'], ['T-2']);
  const delays = [];
  for (let i = 0; i < 6; i++) {
    delays.push(ask.delay);
    assert.ok(!heldAskDue(ask, key, t + ask.delay - 1));
    t += ask.delay;
    assert.ok(heldAskDue(ask, key, t));
    ask = heldAsked(ask, key, t, ['T-2'], ['T-2']);
  }
  assert.deepEqual(delays, [2 * HELD_ASK_MS, 4 * HELD_ASK_MS, 8 * HELD_ASK_MS, 16 * HELD_ASK_MS, HELD_ASK_MAX_MS, HELD_ASK_MAX_MS]);
  // The board sees a change, as T-1's pull request merging: it asks again 30 seconds after its last ask.
  const merged = heldAskKey(rows.map((r) => (r.id === 'T-1' ? { ...r, pr: { number: 1, url: '', state: 'merged' } } : r)), ['T-2']);
  assert.ok(!heldAskDue(ask, merged, t + HELD_ASK_MS - 1));
  assert.ok(heldAskDue(ask, merged, t + HELD_ASK_MS));
  // acc started it, or it waits no more: back to 30 seconds.
  assert.equal(heldAsked(ask, key, t, ['T-2'], []).delay, HELD_ASK_MS);
  assert.equal(heldAsked(ask, merged, t, ['T-2'], ['T-2']).delay, 2 * HELD_ASK_MS, 'a new view starts the back-off over');
});

test('acc sync runs for a project while a task\'s pull request or a promotion taking it on is open, and not otherwise (D-075)', () => {
  const pr = (state: string) => ({ number: 3, url: 'https://github.com/o/r/pull/3', state });
  assert.equal(followsPullRequests({ pr: pr('open') }), true);
  assert.equal(followsPullRequests({ pr: pr('merged'), promoting: true }), true, 'its promotion\'s merge tells the ticket it\'s in the next environment');
  assert.equal(followsPullRequests({ pr: pr('merged'), promoting: false }), false);
  assert.equal(followsPullRequests({ pr: pr('closed') }), false);
  assert.equal(followsPullRequests({ pr: null }), false);
});

test('acc sync keeps running while a merged task\'s issue waits to close, so a failed close is tried again (D-082)', () => {
  const merged = { number: 3, url: 'https://github.com/o/r/pull/3', state: 'merged' };
  assert.equal(followsPullRequests({ pr: merged, closing: true }), true);
  assert.equal(followsPullRequests({ pr: merged, closing: false }), false, 'closed, or left as it was: nothing to follow');
});

test('the board has a column for every status, left to right as a task goes, and each card has the right actions', () => {
  const m = tasksModel(hub());
  const cols = m.projects[0]!.columns;
  assert.deepEqual(cols.map((c) => c.group), ['todo', 'ready', 'running', 'needs-you', 'review', 'rework', 'blocked', 'done'], 'left to right as a task goes: To do first (D-068)');
  const card = (id: string) => cols.flatMap((c) => c.cards).find((c) => c.id === id)!;
  assert.deepEqual(card('AV-2').actions.map((a) => a.label), ['Move', 'Block', 'Analyze', 'Edit', 'Ticket', 'Details'], 'waiting on another task, it can still be analyzed, after Move and Block (D-168)');
  assert.deepEqual(card('AV-3').actions.map((a) => a.label), ['Move', 'Unblock', 'Edit', 'Details']);
  assert.deepEqual(card('AV-4').actions.map((a) => a.label), ['Move', 'Edit', 'Details'], 'done tasks can\'t be blocked');
  assert.deepEqual(card('AV-2').waitingOn, ['AV-1']);
  assert.deepEqual(card('AV-2').actions[0]!.ref, { project: '/r', task: 'AV-2' });
});

test('cards follow a task through dispatch: Dispatch, then Watch, Attach and Abandon, then Clean up', () => {
  const labels = (r: Partial<TaskRow>) => cardActions({ ...row('AV-9', 'todo', 'ready'), deps: [], ...r } as TaskRow, {}).map((a) => a.label);
  // The next step, then Move, then Block, then the rest (D-168).
  assert.deepEqual(labels({}), ['Dispatch', 'Move', 'Block', 'Analyze', 'Edit', 'Details']);
  assert.deepEqual(labels({ state: 'running', display: 'running', run: { bgId: 'bg1', worktree: '/w/AV-9' } }), ['Watch', 'Move', 'Open in Claude Code', 'Worktree', 'Instructions', 'Abandon', 'Edit', 'Details']);
  assert.equal(cardActions({ ...row('AV-9', 'running', 'running'), deps: [], run: { bgId: 'bg1' } } as TaskRow, {})[0]!.primary, true, 'Watch is the main action while it runs');
  assert.deepEqual(labels({ state: 'review', display: 'review', run: { sessionId: 's1', worktree: '/w/AV-9' } }).slice(0, 4), ['Review', 'Move', 'Block', 'Watch'], 'in review: Review first, and what its builder did can still be read');
  assert.deepEqual(labels({ state: 'rework', display: 'rework', run: { worktree: '/w/AV-9' } }), ['Re-dispatch', 'Move', 'Block', 'Worktree', 'Instructions', 'Edit', 'Details']);
  assert.deepEqual(labels({ state: 'done', display: 'done', run: { worktree: '/w/AV-9' } }), ['Clean up', 'Move', 'Worktree', 'Instructions', 'Edit', 'Details'], 'a finished task\'s next step is clearing its worktree away');
  assert.equal(cardActions({ ...row('AV-9', 'todo', 'ready'), deps: [] }, {})[0]!.primary, true, 'Dispatch is the main action on a ready card');
});

test('before a build, a card offers its analysis first, and Dispatch once it\'s ready or none is wanted (D-052)', () => {
  const labels = (r: Partial<TaskRow>) => cardActions({ ...row('AV-9', 'todo', 'ready'), deps: [], ...r } as TaskRow, {}).map((a) => `${a.label}${a.primary ? '*' : ''}`);
  // Where the project wants an analysis first: Dispatch waits for a ready one, and the command line keeps the override.
  assert.deepEqual(labels({ analysisRequired: true }), ['Analyze*', 'Move', 'Block', 'Edit', 'Details']);
  assert.deepEqual(labels({ analysisRequired: true, analyzing: { sessionId: 's' } }), ['Watch the analysis*', 'Move', 'Block', 'Edit', 'Details']);
  assert.deepEqual(labels({ analysisRequired: true, display: 'needs-you', analysis: asks }), ['Answer*', 'Move', 'Block', 'Edit', 'Details']);
  assert.deepEqual(labels({ analysisRequired: true, display: 'needs-you', analysis: tooBig }), ['See the split*', 'Move', 'Block', 'Edit', 'Details']);
  // Its plan waits for a person's approval before Dispatch (T-97); approved, Dispatch leads.
  assert.deepEqual(labels({ analysisRequired: true, display: 'needs-you', analysis: analysed }), ['See the plan*', 'Move', 'Block', 'Edit', 'Details']);
  assert.deepEqual(labels({ analysisRequired: true, analysis: { ...analysed, approved: true } }), ['Dispatch*', 'Move', 'Block', 'Edit', 'Details']);
  assert.deepEqual(labels({ analysisRequired: true, deps: ['AV-1'], display: 'todo' }), ['Analyze*', 'Move', 'Block', 'Edit', 'Details'], 'waiting on another task: analyze it meanwhile');
  // Where it's optional: Dispatch stays, second to answering questions the analysis did ask.
  assert.deepEqual(labels({}), ['Dispatch*', 'Move', 'Block', 'Analyze', 'Edit', 'Details']);
  assert.deepEqual(labels({ display: 'needs-you', analysis: asks }), ['Answer*', 'Move', 'Block', 'Dispatch', 'Edit', 'Details']);
  assert.deepEqual(labels({ analysis: analysed }), ['Dispatch*', 'Move', 'Block', 'Edit', 'Details']);
  assert.deepEqual(labels({ analyzing: { sessionId: 's' } }), ['Watch the analysis*', 'Move', 'Block', 'Edit', 'Details'], 'not while it\'s being analyzed');
  assert.equal(labels({ state: 'rework', display: 'rework', analysisRequired: true })[0], 'Re-dispatch*', 'a rework already had its analysis');
  // Dragging to Running is dispatching, so it's held the same way.
  const lanes = (r: Partial<TaskRow>) => dropLanes({ state: 'todo', display: 'ready', deps: [], ...r });
  assert.ok(!lanes({ analysisRequired: true }).includes('running'), 'held until its analysis is ready');
  assert.ok(lanes({ analysisRequired: true, analysis: analysed }).includes('running'));
  assert.ok(lanes({ display: 'needs-you', analysis: asks }).includes('running'), 'optional: it can still go');
  // What the card says, in words and an icon, orange when it waits on you.
  assert.deepEqual(analysisLook({ state: 'todo', analysis: asks }), { label: 'Needs you: 2 questions from its analysis', icon: 'question', tone: 'orange' });
  assert.equal(analysisLook({ state: 'todo', analysis: { ...asks, open: [ask('q1')] } })!.label, 'Needs you: 1 question from its analysis');
  assert.deepEqual(analysisLook({ state: 'todo', analysis: tooBig }), { label: 'Needs you: too big for one task', icon: 'split-horizontal', tone: 'orange' });
  assert.deepEqual(analysisLook({ state: 'todo', analyzing: { sessionId: 's' } }), { label: 'Analyzing', icon: 'sync~spin', tone: 'blue' });
  assert.deepEqual(analysisLook({ state: 'todo', analysis: analysed }), { label: 'Analyzed: ready to build', icon: 'pass', tone: 'blue' });
  assert.equal(analysisLook({ state: 'running', analysis: asks }), null, 'once it\'s built, its agent speaks for it');
});

test('a card can be dropped only in the lanes acc\'s rules let a person move it to, and Running means dispatching (D-041)', () => {
  const lanes = (state: string, display: string, deps: string[] = []) => dropLanes({ state, display, deps } as TaskRow);
  assert.deepEqual(lanes('todo', 'ready'), ['running', 'blocked'], 'a ready task: dispatch it, or block it');
  assert.deepEqual(lanes('running', 'running'), ['ready', 'review', 'blocked'], 'a running task: back to ready, review, or block');
  assert.deepEqual(lanes('running', 'running', ['T-2']), ['todo', 'review', 'blocked'], 'one that waits on another goes back to To do, where it will show');
  assert.deepEqual(lanes('review', 'review'), ['rework', 'blocked', 'done']);
  assert.deepEqual(lanes('blocked', 'blocked'), ['ready', 'review'], 'blocked work goes back, or on to review once its checks are settled');
  assert.deepEqual(lanes('rework', 'rework'), ['running', 'blocked']);
  assert.ok(!lanes('running', 'needs-you').includes('needs-you'), 'needs you is shown, never chosen');
  assert.deepEqual([laneMove('ready'), laneMove('running'), laneMove('needs-you')], ['todo', 'dispatch', null]);
  const card = tasksModel(hub()).projects[0]!.columns.flatMap((c) => c.cards)[0]!;
  assert.ok(Array.isArray(card.drops));
});
