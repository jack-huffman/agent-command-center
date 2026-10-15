// Notices and the status bar: what a task's change says once, and what acc shows first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { row, ask } from './support.ts';

test('task notices say what changed once, and nothing for a task seen for the first time (D-043)', async () => {
  const { noticeActions, taskNotices } = await import('../src/logic/notices.ts');
  const { statusSummary } = await import('../src/logic/status.ts');
  type Row = import('../src/logic/shared.ts').TaskRow;
  const row = (id: string, state: string, more: Partial<Row> = {}): Row => ({ id, title: `Task ${id}`, state, display: state as Row['display'], environment: 'main', deps: [], source: { kind: 'github', url: null }, ...more });
  assert.deepEqual(taskNotices([], [row('T-1', 'review')]), [], 'first look: no news');
  const kinds = (b: Row[], a: Row[]) => taskNotices(b, a).map((n) => `${n.kind}:${n.task}:${n.urgent}`);
  assert.deepEqual(kinds([row('T-1', 'running')], [row('T-1', 'review')]), ['review:T-1:false'], 'a builder finished');
  assert.deepEqual(kinds([row('T-1', 'review')], [row('T-1', 'review')]), [], 'no change, no notice');
  assert.deepEqual(kinds([row('T-1', 'review')], [row('T-1', 'rework', { review: { verdict: 'changes', summary: 'Tests missing.', current: true } })]), ['rework:T-1:true']);
  assert.match(taskNotices([row('T-1', 'review')], [row('T-1', 'rework', { review: { verdict: 'changes', summary: 'Tests missing.', current: true } })])[0]!.text, /Tests missing\./);
  assert.deepEqual(kinds([row('T-1', 'running')], [row('T-1', 'blocked')]), ['blocked:T-1:true']);
  // Waiting on its own prompt says so; a question in the Command Center has its own notice.
  assert.deepEqual(kinds([row('T-1', 'running')], [row('T-1', 'running', { display: 'needs-you' })]), ['waiting:T-1:true']);
  assert.deepEqual(kinds([row('T-1', 'running')], [row('T-1', 'running', { display: 'needs-you', asking: true })]), []);
  const passed = { verdict: 'pass' as const, summary: 'Good.', current: true };
  assert.deepEqual(kinds([row('T-1', 'review', { review: { ...passed, current: false } })], [row('T-1', 'review', { review: passed })]), ['passed:T-1:false'], 'a pass on the latest commit');
  const pr = (more: Partial<NonNullable<Row['pr']>>) => ({ pr: { number: 7, url: 'u', state: 'open', ci: 'pending', changesRequested: false, ...more } });
  assert.deepEqual(kinds([row('T-1', 'review', pr({}))], [row('T-1', 'review', { ...pr({ ci: 'failing' }), display: 'needs-you' })]), ['ci-failed:T-1:true']);
  assert.deepEqual(kinds([row('T-1', 'review', pr({ ci: 'failing' }))], [row('T-1', 'review', pr({ ci: 'failing' }))]), [], 'said once');
  assert.deepEqual(kinds([row('T-1', 'review', pr({}))], [row('T-1', 'review', pr({ changesRequested: true }))]), ['changes:T-1:true']);
  assert.deepEqual(kinds([row('T-1', 'review', pr({}))], [row('T-1', 'done', pr({ state: 'merged' }))]), ['merged:T-1:false']);
  // A pull request that stops merging into its base names the files, once (D-049).
  const clash = pr({ conflicts: ['docs/DECISIONS.md', 'plugin/bin/acc'] });
  const conflicted = taskNotices([row('T-1', 'review', pr({ conflicts: [] }))], [row('T-1', 'review', { ...clash, display: 'needs-you' })]);
  assert.deepEqual(conflicted.map((n) => [n.kind, n.urgent, n.text]), [['conflicts', true, 'Pull request #7 (T-1) conflicts with main in docs/DECISIONS.md, plugin/bin/acc.']]);
  assert.deepEqual(noticeActions(conflicted[0]!), [['Open pull request', 'acc.task.openPr'], ['Show', 'acc.task.show']]);
  assert.deepEqual(kinds([row('T-1', 'review', clash)], [row('T-1', 'review', pr({ conflicts: ['docs/DECISIONS.md'] }))]), [], 'said once, not again as the files change');
  assert.deepEqual(kinds([row('T-1', 'review', pr({}))], [row('T-1', 'done', pr({ state: 'merged', conflicts: ['a'] }))]), ['merged:T-1:false'], 'only an open pull request conflicts');
  assert.match(taskNotices([row('T-1', 'review', pr({}))], [row('T-1', 'review', pr({ conflicts: ['a', 'b', 'c', 'd', 'e'] }))])[0]!.text, /in a, b, c and 2 more\.$/);
  assert.deepEqual(kinds([row('T-1', 'running'), row('T-2', 'review', pr({}))], [row('T-1', 'review'), row('T-2', 'review', pr({ ci: 'failing' }))]), ['review:T-1:false', 'ci-failed:T-2:true'], 'every task, in board order');

  assert.deepEqual(noticeActions({ kind: 'review', task: 'T-1', text: '', urgent: false }), [['Review', 'acc.task.review'], ['Show', 'acc.task.show']]);
  assert.deepEqual(noticeActions({ kind: 'blocked', task: 'T-1', text: '', urgent: true }), [['Show', 'acc.task.show']]);

  const s = statusSummary([row('T-1', 'running'), row('T-2', 'running'), row('T-3', 'review'), row('T-4', 'done')], 1);
  assert.equal(s.text, '$(bell) 1 needs you  $(sync) 2 running  $(eye) 1 in review', 'each count has its icon and its words');
  assert.ok(s.attention);
  assert.match(s.tooltip, /Running: T-1, T-2/);
  assert.equal(statusSummary([row('T-1', 'review')], 2).text, '$(bell) 2 need you  $(eye) 1 in review');
  assert.deepEqual(statusSummary([row('T-4', 'done')], 0), { text: '', tooltip: '', attention: false }, 'nothing in play: hidden');
});

test('an analysis that comes back says so once: ready, questions for you, or too big; an answer says nothing (D-052)', async () => {
  const { noticeActions, taskNotices } = await import('../src/logic/notices.ts');
  type Row = import('../src/logic/shared.ts').TaskRow;
  const row = (more: Partial<Row> = {}): Row => ({ id: 'T-1', title: 'Task T-1', state: 'todo', display: 'ready', environment: 'main', deps: [], source: { kind: 'github', url: null }, ...more });
  const ask = (id: string) => ({ id, question: `Question ${id}?`, why: 'It matters.', suggested: 'Yes.' });
  const analysis = (at: string, verdict: 'ready' | 'questions' | 'split', open = 0) => ({ analysis: { verdict, at, open: ['q1', 'q2', 'q3'].slice(0, open).map(ask), split: verdict === 'split' ? ['One', 'Two'] : [] } });
  const say = (b: Row, a: Row) => taskNotices([b], [a]).map((n) => [n.kind, n.urgent, n.text]);
  assert.deepEqual(say(row(), row(analysis('t1', 'ready'))), [['analysis-ready', false, 'T-1\'s analysis is ready.']]);
  assert.deepEqual(say(row(), row({ ...analysis('t1', 'questions', 2), display: 'needs-you' })), [['analysis-questions', true, 'T-1\'s analysis has 2 questions for you.']]);
  assert.deepEqual(say(row(), row({ ...analysis('t1', 'questions', 1), display: 'needs-you' })), [['analysis-questions', true, 'T-1\'s analysis has 1 question for you.']]);
  assert.deepEqual(say(row(), row({ ...analysis('t1', 'split'), display: 'needs-you' })), [['analysis-split', true, 'T-1\'s analysis says it\'s too big for one task.']]);
  assert.deepEqual(say(row(analysis('t1', 'questions', 2)), row(analysis('t1', 'questions', 1))), [], 'an answer keeps its time: no notice');
  assert.deepEqual(say(row(analysis('t1', 'questions', 1)), row(analysis('t1', 'ready'))), [], 'nor does the last answer');
  assert.deepEqual(say(row(analysis('t1', 'ready')), row(analysis('t2', 'questions', 1))), [['analysis-questions', true, 'T-1\'s analysis has 1 question for you.']], 'analyzed again: news');
  assert.deepEqual(taskNotices([], [row(analysis('t1', 'questions', 2))]), [], 'first look: no news');
  assert.deepEqual(noticeActions({ kind: 'analysis-questions', task: 'T-1', text: '', urgent: true }), [['Answer', 'acc.task.show']], 'Answer is the page: no second Show');
  assert.deepEqual(noticeActions({ kind: 'analysis-ready', task: 'T-1', text: '', urgent: false }), [['Dispatch', 'acc.task.dispatch'], ['Show', 'acc.task.show']]);
  assert.deepEqual(noticeActions({ kind: 'analysis-split', task: 'T-1', text: '', urgent: true }), [['Show', 'acc.task.show']]);
});

test('an analysis that comes back after the build is news: it asks for nothing the page can\'t take (D-059)', async () => {
  const { noticeActions, taskNotices } = await import('../src/logic/notices.ts');
  type Row = import('../src/logic/shared.ts').TaskRow;
  const row = (state: Row['state'], more: Partial<Row> = {}): Row => ({ id: 'T-1', title: 'Task T-1', state, display: state === 'rework' ? 'needs-you' : state, environment: 'main', deps: [], source: { kind: 'github', url: null }, ...more } as Row);
  const ask = (id: string) => ({ id, question: `Question ${id}?`, why: 'It matters.', suggested: 'Yes.' });
  const analysis = (at: string, verdict: 'ready' | 'questions' | 'split', open = 0) => ({ analysis: { verdict, at, open: ['q1', 'q2', 'q3'].slice(0, open).map(ask), split: verdict === 'split' ? ['One', 'Two'] : [] } });
  for (const state of ['review', 'rework', 'blocked'] as const) {
    const news = (a: Partial<Row>) => taskNotices([row(state, analysis('t1', 'ready'))], [row(state, a)]);
    assert.deepEqual(news(analysis('t2', 'questions', 2)).map((n) => [n.kind, n.urgent, n.text]), [['analysis-back', false, 'T-1\'s analysis is back. Its 2 questions can be answered on its page.']], state);
    assert.deepEqual(news(analysis('t2', 'split')).map((n) => [n.kind, n.urgent, n.text]), [['analysis-back', false, 'T-1\'s analysis is back.']], `${state}: too big`);
    assert.deepEqual(news(analysis('t2', 'ready')).map((n) => [n.kind, n.urgent]), [['analysis-back', false]], `${state}: ready`);
    for (const n of news(analysis('t2', 'questions', 1))) assert.deepEqual(noticeActions(n), [['Show', 'acc.task.show']], `${state}: no Answer, no Dispatch`);
  }
});

test('D-044\'s review notices stay quiet for a review autopilot ran, and still speak for a person\'s (D-064)', async () => {
  const { taskNotices } = await import('../src/logic/notices.ts');
  const { withoutAutopilotEcho } = await import('../src/logic/autopilot.ts');
  type Row = import('../src/logic/shared.ts').TaskRow;
  type Rec = import('../../packages/core/src/autopilot-log.ts').AutopilotRecord;
  const row = (id: string, state: string, more: Partial<Row> = {}): Row => ({ id, title: `Task ${id}`, state, display: state as Row['display'], environment: 'main', deps: [], source: { kind: 'github', url: null }, ...more });
  const passed = { verdict: 'pass' as const, summary: 'Good.', current: true };
  const changes = { verdict: 'changes' as const, summary: 'No test.', current: true };
  const news = taskNotices(
    [row('T-1', 'review', { review: { ...passed, current: false } }), row('T-2', 'review'), row('T-3', 'review', { review: { ...passed, current: false } })],
    [row('T-1', 'review', { review: passed }), row('T-2', 'rework', { review: changes }), row('T-3', 'review', { review: passed })],
  );
  assert.deepEqual(news.map((n) => `${n.kind}:${n.task}`), ['passed:T-1', 'rework:T-2', 'passed:T-3']);
  const log: Rec[] = [
    { seq: 1, at: 'a', task: 'T-1', step: 'review', outcome: 'done', verdict: 'pass' },
    { seq: 2, at: 'a', task: 'T-2', step: 'review', outcome: 'done', verdict: 'changes' },
    // T-3: autopilot landed it before, and a person reviewed its new commit by hand.
    { seq: 3, at: 'a', task: 'T-3', step: 'review', outcome: 'done', verdict: 'pass' },
    { seq: 4, at: 'a', task: 'T-3', step: 'land', outcome: 'done', pr: { number: 9, url: 'u', opened: true } },
  ];
  assert.deepEqual(withoutAutopilotEcho(news, log).map((n) => `${n.kind}:${n.task}`), ['passed:T-3'], 'autopilot\'s own notice said it, and it lands or re-dispatches it next');
  assert.equal(withoutAutopilotEcho(news, []).length, 3, 'with no autopilot, every one');
});

test('all of acc is one status bar item: what needs you first, a spinner while busy, the rest in its tooltip (D-065)', async () => {
  const { combinedStatus } = await import('../src/logic/status.ts');
  const base = { rows: [], needsYou: 0, asking: null, running: [], checking: false, setup: { done: 31, total: 32, todo: 0 }, autopilot: [], account: { name: 'jhuffman-aleysian', ok: true } };
  assert.equal(combinedStatus(base).text, '', 'nothing to say: it hides');
  assert.match(combinedStatus(base).tooltip.join('\n'), /GitHub: jhuffman-aleysian/);
  assert.equal(combinedStatus({ ...base, needsYou: 3 }).text, '$(bell) 3 need you');
  assert.equal(combinedStatus({ ...base, needsYou: 3 }).attention, true);
  assert.equal(combinedStatus({ ...base, needsYou: 3, checking: true }).text, '$(bell) 3 need you $(sync~spin)', 'busy: a spinner, not another item');
  assert.equal(combinedStatus({ ...base, checking: true }).text, '$(sync~spin) Checking setup');
  assert.equal(combinedStatus({ ...base, setup: { done: 31, total: 32, todo: 1 } }).text, '$(checklist) Setup: 1 to do');
  assert.equal(combinedStatus({ ...base, asking: 'Log in to Acme Dev' }).text, '$(bell) Log in to Acme Dev: waiting for you');
  const on = combinedStatus({ ...base, needsYou: 1, autopilot: [{ project: 'Acme', state: 'on' }] });
  assert.equal(on.text, '$(hubot) $(bell) 1 needs you', 'a robot while autopilot is on here');
  assert.match(on.tooltip.join('\n'), /Autopilot on here/);
  assert.equal(combinedStatus({ ...base, autopilot: [{ project: 'Acme', state: 'on' }] }).text, '$(hubot) Autopilot on');
  assert.equal(combinedStatus({ ...base, account: { name: 'someone-else', ok: false } }).attention, true, 'the wrong account says so');
});

test('a burst of notices says one line that counts them, the kinds that need you first (D-???)', async () => {
  const { BURST_AT, noticeBurst, OVERVIEW_COMMAND } = await import('../src/logic/notices.ts');
  type Notice = import('../src/logic/notices.ts').TaskNotice;
  const n = (kind: Notice['kind'], task: string, urgent: boolean, root = '/a'): { root: string; notice: Notice } => ({ root, notice: { kind, task, text: `${kind} ${task}`, urgent } });
  assert.equal(BURST_AT, 3);
  const three = [n('review', 'T-1', false), n('merged', 'T-2', false), n('blocked', 'T-3', true)];
  assert.deepEqual(noticeBurst(three).map((s) => [s.text, s.urgent, s.task?.task]), [['review T-1', false, 'T-1'], ['merged T-2', false, 'T-2'], ['blocked T-3', true, 'T-3']], 'three come back as three');
  assert.deepEqual(noticeBurst(three)[0]!.actions, [['Review', 'acc.task.review'], ['Show', 'acc.task.show']], 'each keeps its own buttons');
  const seven = [n('merged', 'T-1', false), n('passed', 'T-2', false), n('waiting', 'T-3', true), n('merged', 'T-4', false), n('blocked', 'T-5', true), n('passed', 'T-6', false), n('merged', 'T-7', false)];
  assert.deepEqual(noticeBurst(seven), [{ text: 'Since you last looked: 2 need you, 2 reviews passed, 3 merged.', urgent: true, actions: [['Show', OVERVIEW_COMMAND]], task: null }], 'counts in order: what needs you first');
  assert.deepEqual(noticeBurst([n('merged', 'T-1', false), n('merged', 'T-2', false), n('review', 'T-3', false), n('passed', 'T-4', false)]), [{ text: 'Since you last looked: 1 ready for review, 1 review passed, 2 merged.', urgent: false, actions: [['Show', OVERVIEW_COMMAND]], task: null }], 'four come back as one, singular words for one');
  const urgentOne = noticeBurst([n('merged', 'T-1', false), n('merged', 'T-2', false), n('merged', 'T-3', false), n('autopilot', 'T-4', true)]);
  assert.deepEqual(urgentOne.map((s) => [s.text, s.urgent]), [['Since you last looked: 1 autopilot step, 3 merged.', true]], 'one urgent notice makes the summary urgent, and goes first');
});

test('a burst about one task keeps its buttons; none says nothing; two projects make one burst (edge cases)', async () => {
  const { noticeBurst, OVERVIEW_COMMAND } = await import('../src/logic/notices.ts');
  type Notice = import('../src/logic/notices.ts').TaskNotice;
  const n = (kind: Notice['kind'], task: string, urgent: boolean, root = '/a'): { root: string; notice: Notice } => ({ root, notice: { kind, task, text: `${kind} ${task}`, urgent } });
  assert.deepEqual(noticeBurst([]), [], 'no notices: none');
  const one = noticeBurst([n('review', 'T-1', false), n('passed', 'T-1', false), n('ci-failed', 'T-1', true), n('changes', 'T-1', true)]);
  assert.deepEqual(one, [{ text: 'Since you last looked, T-1: 1 pull request failed its checks, 1 pull request with changes asked for, 1 ready for review, 1 review passed.', urgent: true, actions: [['Open pull request', 'acc.task.openPr'], ['Show', 'acc.task.show']], task: { root: '/a', task: 'T-1' } }], 'one task: its newest notice\'s buttons, on that task');
  const two = noticeBurst([n('merged', 'T-1', false, '/a'), n('merged', 'T-2', false, '/a'), n('merged', 'T-1', false, '/b'), n('merged', 'T-2', false, '/b')]);
  assert.deepEqual(two, [{ text: 'Since you last looked: 4 merged.', urgent: false, actions: [['Show', OVERVIEW_COMMAND]], task: null }], 'two projects count as one burst');
  const sameId = noticeBurst([n('merged', 'T-1', false, '/a'), n('merged', 'T-1', false, '/a'), n('merged', 'T-1', false, '/b'), n('merged', 'T-1', false, '/b')]);
  assert.equal(sameId[0]!.task, null, 'one id in two projects is two tasks: the Overview');
});

test('every kind of notice has words for one and for more, so a burst can count it (edge case: a kind with none)', async () => {
  const { NOTICE_KINDS, NOTICE_WORDS } = await import('../src/logic/notices.ts');
  assert.ok(NOTICE_KINDS.length > 0);
  for (const kind of NOTICE_KINDS) {
    const words = NOTICE_WORDS[kind];
    assert.ok(Array.isArray(words) && words.length === 2 && words.every((w) => typeof w === 'string' && w.trim()), `${kind} has no words`);
  }
  assert.deepEqual(Object.keys(NOTICE_WORDS).sort(), [...NOTICE_KINDS].sort(), 'no words for a kind that isn\'t one');
});
