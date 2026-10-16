// A review in the output panel (T-63): the run knows its task, and once it ends, its card carries the verdict
// it wrote. The model is pure; these tests give it verdicts and read what the panel would show. The reader is
// tested against a real folder, and a run that isn't a review draws as it did.
import assert from 'node:assert/strict';
import { readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { Verdict } from '../../packages/core/src/review.ts';
import { newestVerdictText, readReviewRun } from '../src/logic/dock-review.ts';
import type { Excerpt } from '../src/logic/review-excerpts.ts';
import { CRITERION_LOOK, dockReview, type DockReview, keptReview, REVIEW_RUN_LOOK, reviewCount, reviewNext, type ReviewRun, type ReviewRunIn, verdictFrom, type VerdictRead } from '../src/model/dock-review.ts';
import { runCard, type RunInput } from '../src/model/runs.ts';
import { REVIEW_LOOK } from '../src/model/task-page.ts';
import { pageSource, root } from './support.ts';
import { tempDir } from '../../packages/core/test/support.ts';

const START = Date.parse('2026-10-15T10:00:00Z');
const diff: Excerpt = { kind: 'diff', lines: [{ n: 10, mark: 'add', text: 'c', at: true }] };

/** A verdict that asks for changes: two criteria met, one not, a finding worth a look, then a must-fix one. */
const verdict = (o: Partial<Verdict> = {}): Verdict => ({
  v: 1, task: 'T-9', sha: 'abc1234def', env: 'devbox', verdict: 'changes', summary: 'Adds the field, but the empty case has no test.', client: 'The field shows on the form.',
  criteria: [
    { text: 'The field shows.', met: true, evidence: 'src/a.ts:3' },
    { text: 'The empty case is tested.', met: false, evidence: 'No test covers an empty list.' },
    { text: 'The docs say so.', met: true, evidence: 'docs/DESIGN.md:40' },
  ],
  findings: [
    { message: 'Name the constant.', must: false, file: 'src/b.ts', line: 2 },
    { message: 'Test the empty case.', must: true, file: 'src/a.ts', line: 10, kind: 'untested edge case' },
  ],
  sessionId: 'rv-1', name: 'Acme · T-9 · review', at: '2026-10-15T10:04:00Z', durationMs: 4 * 60_000, costUsd: null, ...o,
});
const read = (v: Verdict = verdict(), o: Partial<Extract<VerdictRead, { ok: true }>> = {}): VerdictRead => ({ ok: true, verdict: v, checkout: true, excerpts: [null, diff], ...o });
const run = (o: Partial<ReviewRunIn> = {}, review: Partial<ReviewRun> = {}): ReviewRunIn => ({ startedAt: START, endedAt: START + 240_000, stopped: false, review: { project: '/r', task: 'T-9', sha: 'abc1234def', read: read(), ...review }, ...o });
const done = (r: DockReview): Extract<DockReview, { phase: 'done' }> => {
  assert.equal(r.phase, 'done');
  return r as Extract<DockReview, { phase: 'done' }>;
};

test('changes asked: the header says so in orange with its count, and its next step sends it back to the builder', () => {
  const r = done(dockReview(run()));
  assert.deepEqual(r.look, REVIEW_LOOK.changes);
  assert.equal(r.task, 'T-9');
  assert.equal(r.count, '2 of 3 criteria, 2 findings');
  assert.deepEqual(r.next, { command: 'acc.task.dispatch', label: 'Send back to the builder', icon: 'reply', ref: { project: '/r', task: 'T-9' }, primary: true });
  assert.equal(r.summary, 'Adds the field, but the empty case has no test.');
  assert.equal(r.client, 'The field shows on the form.');
  // Who, when and how long go in the header's hover.
  assert.equal(r.by, 'Acme · T-9 · review');
  assert.equal(r.at, '2026-10-15T10:04:00Z');
  assert.equal(r.took, '4 min');
});

test('a criterion not met, then each finding, must-fix first, each with its own file, line and lines', () => {
  const r = done(dockReview(run()));
  assert.deepEqual(r.rows.map((x) => [x.key, x.look.label, x.text]), [
    ['c1', 'Not met', 'The empty case is tested.'],
    ['f0', 'Must fix', 'Test the empty case.'],
    ['f1', 'Worth a look', 'Name the constant.'],
  ]);
  const [unmet, must, worth] = r.rows;
  assert.deepEqual(unmet!.look, CRITERION_LOOK.unmet);
  assert.equal(unmet!.evidence, 'No test covers an empty list.');
  assert.equal(unmet!.finding, null);
  assert.equal(must!.finding!.place, 'src/a.ts:10');
  assert.deepEqual(must!.finding!.excerpt, diff, 'the must-fix finding keeps its own lines after the sort');
  assert.deepEqual(must!.finding!.opens, { project: '/r', task: 'T-9', file: 'src/a.ts', line: 10 });
  assert.equal(must!.finding!.kind, 'untested edge case');
  assert.equal(worth!.finding!.excerpt, null);
  // The met criteria fold into one row.
  assert.deepEqual(r.met, { look: { ...CRITERION_LOOK.met, label: '2 criteria met' }, items: ['The field shows.', 'The docs say so.'] });
});

test('a pass: blue, its next step is Land, and with every criterion met no row is open to read but the fold', () => {
  const v = verdict({ verdict: 'pass', findings: [], criteria: [{ text: 'The field shows.', met: true, evidence: 'src/a.ts:3' }] });
  const r = done(dockReview(run({}, { read: read(v, { excerpts: [] }) })));
  assert.deepEqual(r.look, REVIEW_LOOK.pass);
  assert.equal(r.look.tone, 'blue');
  assert.deepEqual(r.next, { command: 'acc.task.land', label: 'Land', icon: 'git-pull-request-create', ref: { project: '/r', task: 'T-9' }, primary: true });
  assert.equal(r.count, '1 of 1 criterion, no findings');
  assert.deepEqual(r.rows, []);
  assert.equal(r.met!.look.label, '1 criterion met');
});

test('edge case: a verdict with no client sentence, no criteria met, and an older one with no name or duration', () => {
  const v = verdict({ client: '  ', criteria: [{ text: 'The empty case is tested.', met: false, evidence: '' }], name: undefined, durationMs: undefined as unknown as number });
  const r = done(dockReview(run({}, { read: read(v) })));
  assert.equal(r.client, null, 'a blank sentence is none');
  assert.equal(r.met, null, 'no fold with no criterion met');
  assert.equal(r.rows[0]!.evidence, null, 'blank evidence is none, which the page says');
  assert.equal(r.by, 'The reviewer');
  assert.equal(r.took, null, 'no duration is none, not a made-up minute (T-63 review)');
  assert.equal(done(dockReview(run({}, { read: read(verdict({ client: undefined })) }))).client, null, 'a verdict from before client sentences has none');
});

test('edge case: a checkout that is gone: each finding\'s link is off with why, and no lines show', () => {
  const r = done(dockReview(run({}, { read: read(verdict(), { checkout: false, excerpts: [] }) })));
  const must = r.rows.find((x) => x.key === 'f0')!.finding!;
  assert.equal(must.opens, null);
  assert.match(must.off!, /checkout is gone/);
  assert.equal(must.excerpt, null);
});

test('reviewCount: criteria met of all, then findings; with no criteria, the findings alone', () => {
  assert.equal(reviewCount([{ met: true }, { met: false }], 1), '1 of 2 criteria, 1 finding');
  assert.equal(reviewCount([], 3), '3 findings');
  // Edge case: nothing to count.
  assert.equal(reviewCount([], 0), 'No findings');
  assert.equal(reviewCount([{ met: true }], 0), '1 of 1 criterion, no findings');
});

test('reviewNext: Land for a pass, Send back to the builder for changes, both the one primary button', () => {
  assert.equal(reviewNext('/r', 'T-1', 'pass').command, 'acc.task.land');
  assert.equal(reviewNext('/r', 'T-1', 'changes').command, 'acc.task.dispatch');
  assert.ok(reviewNext('/r', 'T-1', 'pass').primary && reviewNext('/r', 'T-1', 'changes').primary);
});

test('edge case: before the verdict: a running review is one live line with its commit; ended and not read yet, it reads its verdict', () => {
  const live = dockReview(run({ endedAt: null }, { read: undefined }));
  assert.deepEqual(live, { phase: 'running', project: '/r', task: 'T-9', look: REVIEW_RUN_LOOK.running, sha: 'abc1234', startedAt: START, live: true });
  const reading = dockReview(run({}, { read: undefined }));
  assert.equal(reading.phase, 'running');
  assert.deepEqual(reading.look, REVIEW_RUN_LOOK.reading);
  assert.equal((reading as Extract<DockReview, { phase: 'running' }>).live, false, 'its clock stops once the run ends');
  assert.equal((dockReview(run({ endedAt: null }, { sha: null, read: undefined })) as Extract<DockReview, { phase: 'running' }>).sha, null, 'an unknown commit shows none');
});

test('edge case: a stopped review, and a verdict that can\'t be read, show the run\'s lines with why', () => {
  const stopped = dockReview(run({ stopped: true }, { read: undefined }));
  assert.deepEqual(stopped, { phase: 'unread', project: '/r', task: 'T-9', look: REVIEW_RUN_LOOK.unread, why: 'It was stopped before it gave a verdict.' });
  const failed = dockReview(run({}, { read: { ok: false, why: 'The review wrote no verdict. Its output says why.' } }));
  assert.equal(failed.phase, 'unread');
  assert.equal((failed as Extract<DockReview, { phase: 'unread' }>).why, 'The review wrote no verdict. Its output says why.');
});

test('edge case: verdictFrom: a missing file, one that isn\'t JSON, one that isn\'t a verdict, and an older review\'s', () => {
  assert.deepEqual(verdictFrom(null, START), { why: 'The review wrote no verdict. Its output says why.' });
  assert.match((verdictFrom('{"verdict": "pa', START) as { why: string }).why, /isn't JSON/);
  assert.match((verdictFrom('[1, 2]', START) as { why: string }).why, /doesn't hold a verdict/);
  assert.match((verdictFrom(JSON.stringify({ ...verdict(), verdict: 'maybe' }), START) as { why: string }).why, /doesn't hold a verdict/);
  assert.match((verdictFrom(JSON.stringify({ ...verdict(), findings: null }), START) as { why: string }).why, /doesn't hold a verdict/);
  // A verdict written before the run started is another review's: this one wrote none.
  assert.deepEqual(verdictFrom(JSON.stringify(verdict({ at: '2026-10-15T09:00:00Z' })), START), { why: 'The review wrote no verdict. Its output says why.' });
  assert.deepEqual(verdictFrom(JSON.stringify(verdict()), START), { verdict: verdict() });
});

test('edge case: keptReview: a review kept over a reload while its verdict was read says it wasn\'t; a read or stopped one stays', () => {
  const r: ReviewRun = { project: '/r', task: 'T-9', sha: null };
  const kept = keptReview(r, false);
  assert.equal(kept.read?.ok, false);
  assert.match((kept.read as { why: string }).why, /window closed before its verdict was read/);
  assert.deepEqual(keptReview(r, true), r, 'a stopped one says it was stopped');
  const withRead = { ...r, read: read() };
  assert.deepEqual(keptReview(withRead, false), withRead);
});

// ---------------------------------------------------------------- the reader, against a real folder

function folder(): string {
  return tempDir('acc-dock-review-');
}

test('edge case: newestVerdictText: no folder, a review under way, another task\'s, then the newest of the task\'s by when it was written', (t) => {
  const dir = folder();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(newestVerdictText(join(dir, 'none'), 'T-6'), null, 'no folder');
  writeFileSync(join(dir, 'T-6.running.json'), '{}');
  writeFileSync(join(dir, 'T-63-abc1234.json'), '"T-63\'s"');
  assert.equal(newestVerdictText(dir, 'T-6'), null, 'a review under way and T-63\'s are not T-6\'s');
  writeFileSync(join(dir, 'T-6-aaaaaaa.json'), '"older"');
  writeFileSync(join(dir, 'T-6-bbbbbbb.json'), '"newer"');
  utimesSync(join(dir, 'T-6-aaaaaaa.json'), new Date(START), new Date(START));
  utimesSync(join(dir, 'T-6-bbbbbbb.json'), new Date(START + 1000), new Date(START + 1000));
  assert.equal(newestVerdictText(dir, 'T-6'), '"newer"');
  // A re-review of the older commit rewrites its file, which makes it the newest.
  utimesSync(join(dir, 'T-6-aaaaaaa.json'), new Date(START + 2000), new Date(START + 2000));
  assert.equal(newestVerdictText(dir, 'T-6'), '"older"');
});

test('a review run ends with its verdict on the card: running, then the verdict it wrote, read from the reviews folder', async (t) => {
  const dir = folder();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input: RunInput = { id: 'r1', label: 'Review T-9', command: 'acc review T-9', startedAt: START, endedAt: null, code: null, stopped: false, lines: ['Reviewing T-9 at abc1234.'], prompt: null, step: null, review: { project: '/r', task: 'T-9', sha: 'abc1234def' } };
  assert.equal(runCard(input).review?.phase, 'running', 'while it runs');
  writeFileSync(join(dir, 'T-9-abc1234def.json'), JSON.stringify(verdict()));
  // acc review exits 1 when it asks for changes.
  const ended: RunInput = { ...input, endedAt: START + 240_000, code: 1, ok: true };
  assert.equal(runCard(ended).review?.phase, 'running', 'ended, before its verdict is read');
  const got = await readReviewRun({ reviews: dir, task: 'T-9', startedAt: START, checkout: null, there: false, branch: 'devbox', git: async () => ({ code: 1, stdout: '', stderr: '' }) });
  const card = runCard({ ...ended, review: { ...ended.review!, read: got } });
  const r = done(card.review!);
  assert.equal(r.count, '2 of 3 criteria, 2 findings');
  assert.deepEqual(card.look, REVIEW_LOOK.changes, 'the card wears the verdict\'s look, not a failed exit');
  assert.deepEqual(card.lines, ['Reviewing T-9 at abc1234.'], 'its lines stay, for Show output');
});

test('edge case: a review run whose verdict file is missing or isn\'t JSON ends with why, and its lines', async (t) => {
  const dir = folder();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const o = { reviews: dir, task: 'T-9', startedAt: START, checkout: null, there: false, branch: 'devbox', git: async () => ({ code: 1, stdout: '', stderr: '' }) };
  const missing = await readReviewRun(o);
  assert.deepEqual(missing, { ok: false, why: 'The review wrote no verdict. Its output says why.' });
  writeFileSync(join(dir, 'T-9-abc1234def.json'), '{ not json');
  const broken = await readReviewRun(o);
  assert.equal(broken.ok, false);
  const ended: RunInput = { id: 'r1', label: 'Review T-9', command: 'acc review T-9', startedAt: START, endedAt: START + 1, code: 1, stopped: false, lines: ['It failed.'], prompt: null, step: null, review: { project: '/r', task: 'T-9', sha: null, read: broken } };
  const card = runCard(ended);
  assert.equal(card.review?.phase, 'unread');
  assert.match((card.review as { why: string }).why, /isn't JSON/);
  assert.equal(card.look.label, 'Failed (exit 1)', 'with no verdict, the run\'s own look');
  assert.deepEqual(card.lines, ['It failed.']);
});

test('edge case: a checkout on disk reads each finding\'s lines with git; git failing gives lines it couldn\'t read, one for each finding', async (t) => {
  const dir = folder();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'T-9-abc1234def.json'), JSON.stringify(verdict()));
  const asked: string[][] = [];
  const got = await readReviewRun({ reviews: dir, task: 'T-9', startedAt: START, checkout: dir, there: true, branch: 'devbox', git: async (args) => { asked.push(args); return { code: 1, stdout: '', stderr: 'no' }; } });
  assert.ok(got.ok);
  assert.equal(got.checkout, true);
  assert.equal(got.excerpts.length, 2, 'one for each finding');
  assert.ok(asked.length > 0, 'git was asked');
});

test('a run that is not a review draws as it did: no review, its own look', () => {
  const plain: RunInput = { id: 'r2', label: 'Open Dev', command: 'sf org open', startedAt: START, endedAt: START + 1, code: 0, stopped: false, lines: ['ok'], prompt: null, step: null };
  const card = runCard(plain);
  assert.equal('review' in card, false);
  assert.equal(card.look.label, 'Done');
  assert.deepEqual(Object.keys(card).sort(), ['command', 'endedAt', 'id', 'label', 'lines', 'look', 'prompt', 'running', 'startedAt', 'step']);
});

test('the panel draws a finding with the task page\'s parts, with no second copy, and the Command Center opens its file as the task page does', () => {
  const page = pageSource('dock-review.ts');
  assert.match(page, /import \{ excerpt, place \} from '\.\/review\.ts';/);
  assert.doesNotMatch(page, /function (excerpt|place)\(/, 'no copy of the task page\'s parts');
  const dock = pageSource('dock.ts');
  assert.match(dock, /import \{ openKey, renderDockReview, showsLines \} from '\.\/dock-review\.ts';/);
  assert.match(dock, /renderDockReview\(run\.id, review, redrawDock\)/, 'the panel draws a run\'s review');
  const ext = readFileSync(join(root, 'src', 'dock-review.ts'), 'utf8');
  assert.match(ext, /receive\('review-file'/, 'the Command Center takes a finding\'s click');
  assert.match(ext, /openReviewFile\(/);
  assert.match(readFileSync(join(root, 'src', 'ticket.ts'), 'utf8'), /return openReviewFile\(o\.key,/, 'the task page opens it with the same function');
});
