// A task page's Review block (T-53): the verdict, its count, and each finding, must-fix first, with its
// file and line and the lines around it. The model is built from a verdict and the excerpts the extension
// read; these tests give it both and read the block.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Task } from '../../packages/core/src/ledger.ts';
import type { Excerpt } from '../src/logic/review-excerpts.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { modalTakes } from '../src/model/task-modal.ts';
import { REVIEW_LOOK, type ReviewIn, ticketModel, ticketReview } from '../src/model/task-page.ts';
import { row } from './support.ts';

const diff: Excerpt = { kind: 'diff', lines: [{ n: 9, mark: 'same', text: 'a', at: false }, { n: null, mark: 'del', text: 'b', at: false }, { n: 10, mark: 'add', text: 'c', at: true }] };
const unchanged: Excerpt = { kind: 'unchanged', lines: [{ n: 2, mark: 'same', text: 'x', at: true }] };

/** A verdict with changes: a finding worth a look, the must-fix one, then one with no file or line. */
const review = (o: Partial<ReviewIn> = {}, v: Partial<ReviewIn['verdict']> = {}): ReviewIn => ({
  verdict: {
    task: 'T-9', sha: 'abc1234', verdict: 'changes', summary: 'Adds the field, but the test is missing.', sessionId: 'rv-1', name: 'Acme · T-9 · review', at: '2026-10-15T10:00:00Z',
    findings: [
      { message: 'Name the constant.', must: false, file: 'src/b.ts', line: 2, kind: 'naming' },
      { message: 'Test the empty case.', must: true, file: 'src/a.ts', line: 10, kind: 'untested edge case' },
      { message: 'The note overstates the tests.', must: false },
    ],
    ...v,
  },
  current: true, checkout: true, excerpts: [unchanged, diff, null], ...o,
});

test('a verdict with changes: the block says so in orange, counts its findings, and lists the must-fix one first, each with its excerpt', () => {
  const r = ticketReview('/r', 'rework', review())!;
  assert.deepEqual(r.look, REVIEW_LOOK.changes);
  assert.equal(r.look.tone, 'orange');
  assert.equal(r.count, '3 findings, 1 must fix');
  assert.equal(r.summary, 'Adds the field, but the test is missing.');
  assert.equal(r.by, 'Acme · T-9 · review');
  assert.equal(r.stale, null);
  assert.equal(r.gone, null);
  assert.deepEqual(r.findings.map((f) => [f.look.label, f.message]), [['Must fix', 'Test the empty case.'], ['Worth a look', 'Name the constant.'], ['Worth a look', 'The note overstates the tests.']]);
  const [must, worth, bare] = r.findings;
  assert.deepEqual(must!.excerpt, diff, 'the must-fix finding keeps its own excerpt after the sort');
  assert.equal(must!.note, null, 'a diff needs no note');
  assert.equal(must!.place, 'src/a.ts:10');
  assert.equal(must!.kind, 'untested edge case');
  assert.deepEqual(must!.opens, { project: '/r', task: 'T-9', file: 'src/a.ts', line: 10 });
  assert.deepEqual(worth!.excerpt, unchanged);
  assert.match(worth!.note!, /^Unchanged code/);
  assert.deepEqual(r.open, { project: '/r', task: 'T-9', sha: 'abc1234' });
  assert.ok(bare);
});

test('edge case: a pass with no findings is blue and says No findings', () => {
  const r = ticketReview('/r', 'review', review({ excerpts: [] }, { verdict: 'pass', findings: [] }))!;
  assert.deepEqual(r.look, REVIEW_LOOK.pass);
  assert.equal(r.look.tone, 'blue');
  assert.equal(r.count, 'No findings');
  assert.deepEqual(r.findings, []);
});

test('edge case: a finding with no file or line has no place, no link and no excerpt', () => {
  const bare = ticketReview('/r', 'rework', review())!.findings[2]!;
  assert.deepEqual([bare.place, bare.opens, bare.off, bare.excerpt, bare.note], [null, null, null, null, null]);
  // A file with no line opens at its top, and shows as its file alone.
  const fileOnly = ticketReview('/r', 'rework', review({ excerpts: [null] }, { findings: [{ message: 'm', must: false, file: 'src/c.ts' }] }))!.findings[0]!;
  assert.equal(fileOnly.place, 'src/c.ts');
  assert.deepEqual(fileOnly.opens, { project: '/r', task: 'T-9', file: 'src/c.ts', line: 1 });
});

test('edge case: a verdict on an older commit says so in a muted line, and still shows in rework', () => {
  const r = ticketReview('/r', 'rework', review({ current: false }))!;
  assert.equal(r.stale, 'This review is of an older commit. The task has changed since.');
  assert.equal(r.findings.length, 3);
});

test('edge case: a task not in review has no block, unless its latest verdict is on its current commit', () => {
  for (const state of ['todo', 'running', 'blocked', 'done']) assert.equal(ticketReview('/r', state, review({ current: false })), null, state);
  assert.ok(ticketReview('/r', 'done', review({ current: true })), 'a done task whose verdict is on its latest commit shows it');
  assert.equal(ticketReview('/r', 'review', null), null, 'no verdict, no block');
  // Through the page's model: the row's state is the task's.
  const task = { id: 'T-9', title: 'T', brief: '', state: 'running', environment: 'devbox', deps: [], labels: [], blocker: null, run: null, history: [], source: { kind: 'acc', url: null } } as unknown as Task;
  const input = { project: '/r', tracker: null, trackerTitle: null, trackerKind: null, key: 'T-9', ticket: null, loading: false, error: null, connect: null, row: row('T-9', 'running', 'running'), task, checks: [] };
  assert.equal(ticketModel({ ...input, review: review({ current: false }) }).review, null);
  assert.equal(ticketModel({ ...input, task: { ...task, state: 'rework' }, review: review() }).review?.count, '3 findings, 1 must fix');
});

test('edge case: a gone checkout says so once, shows no lines, and turns every file link off with why', () => {
  const r = ticketReview('/r', 'rework', review({ checkout: false, excerpts: [{ kind: 'gone', lines: [] }, { kind: 'gone', lines: [] }, null] }))!;
  assert.match(r.gone!, /checkout is gone/);
  for (const f of r.findings.filter((x) => x.place)) {
    assert.equal(f.opens, null);
    assert.match(f.off!, /checkout is gone/);
    assert.equal(f.excerpt, null);
    assert.equal(f.note, null, 'said once, for the block');
  }
});

test('edge case: a path outside the checkout, or a removed file, is a link that is off, with why', () => {
  const r = ticketReview('/r', 'rework', review({ excerpts: [{ kind: 'outside', lines: [] }, { kind: 'removed', lines: [{ n: 10, mark: 'del', text: 'b', at: true }] }, null] }))!;
  const [removed, outside] = r.findings;
  assert.equal(outside!.opens, null);
  assert.match(outside!.off!, /outside the task's checkout/);
  assert.equal(outside!.excerpt, null, 'no lines to show');
  assert.equal(removed!.opens, null);
  assert.match(removed!.off!, /removed this file/);
  assert.equal(removed!.excerpt?.lines.length, 1, 'its removed lines still show');
  assert.equal(removed!.note, 'The change removed this file.');
});

test('the page\'s message to open a finding\'s file is one the extension takes, and the modal takes it for its own task only', () => {
  const m = { type: 'review-file', project: '/r', task: 'T-9', file: 'src/a.ts', line: 10 };
  assert.ok(isFromWebview(m));
  for (const bad of [{ ...m, line: 0 }, { ...m, line: 1.5 }, { ...m, file: '' }, { ...m, task: '../x' }]) assert.equal(isFromWebview(bad), false, JSON.stringify(bad));
  assert.ok(isFromWebview(m) && modalTakes({ project: '/r', key: 'T-9' }, m, new Set()));
  assert.ok(isFromWebview(m) && !modalTakes({ project: '/r', key: 'T-8' }, m, new Set()), 'another task\'s click is not the modal\'s');
});

test('every review state has an icon and words, orange against blue', () => {
  assert.deepEqual(Object.entries(REVIEW_LOOK).map(([k, l]) => [k, l.tone]), [['pass', 'blue'], ['changes', 'orange'], ['must', 'orange'], ['worth', 'blue']]);
});
