import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { type AutopilotDeps, autopilotEvent, autopilotPass, type AutopilotStep } from '../src/autopilot.ts';
import { queueSection, readQueueReport } from '../src/checks.ts';
import { type Config, parseConfig } from '../src/config.ts';
import { renderPacket } from '../src/dispatch.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { AUTOPILOT_BY, displayState, emptyLedger, type LedgerEvent, mutate, readLedger, reworkCause, type Task, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { ordinal, phaseWords, queueOrder, queuePlaces, queueWaits } from '../src/queue.ts';
import { readReceipt, writeReceipt } from '../src/receipts.ts';
import { latestVerdict, reviewCurrent, reviewedAt, reviewPath, type Verdict } from '../src/review.ts';
import { bad, fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, ok, tempDir } from './support.ts';

const NOW = '2026-10-06T12:00:00Z';
let clock = Date.parse(NOW);
const now = () => new Date(clock);
const LONG_AGO = '2026-10-06T10:00:00.000Z';
const DECISIONS = '# Decisions\n\n## D-001 Sums (2026-10-01)\n\nsum adds.\n';
const SUM = 'export const sum = (a, b) => a + b;\n';

/**
 * A repo with auto-merge on, whose origin is a local bare repo. Builders run `lint`; the full check, `test`,
 * runs in the merge queue. Each task added is built in a worktree of its own, on its own branch, landed at
 * its latest commit with pull request #4N, reviewed there, and its lint passed: what a builder leaves.
 */
function setup(opts: { config?: Record<string, unknown> } = {}) {
  clock = Date.parse(NOW);
  const RAW = {
    ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'jordan-kim' }, autonomy: 'review',
    environments: [{ name: 'main', default: true }, { name: 'release', protected: true }],
    gates: { required: ['test'], builder: ['lint'], commands: { test: 'npm test', lint: 'npm run lint' } },
    autopilot: { appendOnly: ['docs/DECISIONS.md'], autoMerge: true },
    ...opts.config,
  };
  const origin = tempDir('origin-');
  run('git', ['init', '-q', '--bare', origin]);
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(RAW), 'docs/DECISIONS.md': DECISIONS, 'sum.js': SUM });
  gitIn(dir, 'remote', 'add', 'origin', origin);
  gitIn(dir, 'push', '-q', 'origin', 'main');
  const config = parseConfig(RAW).config as Config;
  const paths = repoPaths(dir, run);
  const trees = tempDir('worktrees-');
  const write = (root: string, files: Record<string, string>, message: string): string => {
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
    gitIn(root, 'add', '-A');
    gitIn(root, 'commit', '-q', '-m', message);
    return gitIn(root, 'rev-parse', 'HEAD');
  };
  const branchOf = (id: string) => `task/${id}`;
  const wtOf = (id: string) => join(trees, id);
  const verdict = (id: string, sha: string) => {
    const v: Verdict = { v: 1, task: id, sha, env: 'main', verdict: 'pass', summary: `${id}'s change.`, criteria: [], findings: [], sessionId: 's', at: now().toISOString(), durationMs: 1, costUsd: null };
    mkdirSync(paths.reviews, { recursive: true });
    writeFileSync(reviewPath(paths, id, sha), JSON.stringify(v));
  };
  /** A task built, reviewed and landed: its lint passed, and nothing else ran. */
  const task = (id: string, files: Record<string, string>, more: Partial<Task> = {}): string => {
    gitIn(dir, 'worktree', 'add', '-q', '-b', branchOf(id), wtOf(id), 'main');
    const sha = write(wtOf(id), files, `${id}: the change`);
    gitIn(dir, 'push', '-q', 'origin', `${branchOf(id)}:${branchOf(id)}`);
    verdict(id, sha);
    writeReceipt(paths, { gate: 'lint', sha, env: 'main', status: 'pass', startedAt: NOW, finishedAt: NOW, durationMs: 1, summary: 'Passed.', command: 'npm run lint', log: null });
    const n = 40 + Number(id.split('-')[1]);
    mutate(paths, now, (l, emit) => {
      upsertTasks(l, config, [{ source: { kind: 'manual', key: id }, title: `Task ${id}` }], 'human', 'human:test', emit, now);
      const t = l.tasks.find((x) => x.id === id)!;
      t.state = 'review';
      t.run = { branch: branchOf(id), worktree: wtOf(id) };
      t.pr = { number: n, url: `https://github.com/acme/tool/pull/${n}`, state: 'open', sha, landedAt: LONG_AGO, conflicts: [] };
      Object.assign(t, more);
    });
    return sha;
  };
  /** Someone else's work merged into main on GitHub. */
  const onMain = (files: Record<string, string>): string => {
    const sha = write(dir, files, 'Another task');
    gitIn(dir, 'push', '-q', 'origin', 'main');
    return sha;
  };
  return { dir, origin, config, paths, task, onMain, write, branchOf, wtOf, verdict };
}
type Setup = ReturnType<typeof setup>;

type Fixture = RunResult | ((o?: RunOptions) => RunResult);

/**
 * gh and the checks, recording every call; git really runs. GitHub has each pull request open at its
 * branch's latest commit on origin, mergeable, with no checks of its own, as in this repo. Its merge
 * moves origin's main to that commit, as a merge would. `check` is the full check's answer.
 */
function deps(s: Setup, calls: string[], opts: { check?: Fixture; more?: Record<string, Fixture>; slots?: AutopilotDeps['slots'] } = {}): AutopilotDeps {
  const ids = readLedger(s.paths.ledger).tasks.map((t) => t.id);
  const origin = (id: string) => run('git', ['rev-parse', `refs/heads/${s.branchOf(id)}`], { cwd: s.origin }).stdout.trim();
  const per: Record<string, Fixture> = {};
  for (const id of ids) {
    const n = 40 + Number(id.split('-')[1]);
    per[`gh pr view ${n}`] = () => ok(JSON.stringify({ state: 'OPEN', headRefOid: origin(id), mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: null, baseRefName: 'main', isDraft: false }));
    per[`gh pr list -R acme/tool --head ${s.branchOf(id)}`] = ok(JSON.stringify([{ number: n, url: `https://github.com/acme/tool/pull/${n}` }]));
    per[`gh pr merge ${n}`] = () => {
      run('git', ['push', '-q', s.origin, `${origin(id)}:refs/heads/main`], { cwd: s.dir });
      return ok('');
    };
  }
  return {
    run: fakeRunner({
      'gh auth token -u jordan-kim': ok('gho_token\n'),
      'gh pr checks': bad('no checks reported on the branch'),
      'gh pr edit': ok(''),
      'gh repo view': ok(JSON.stringify({ mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true })),
      'claude -p': bad('no review is asked for in the merge queue'),
      'nice -n 15 sh -c': opts.check ?? ok('3 passing'),
      ...per,
      ...opts.more,
    }, calls),
    now, env: { ACC_QUESTIONS_DIR: tempDir('questions-') }, accBinDir: '/opt/acc/bin',
    slots: opts.slots ?? { dir: join(tempDir('slots-'), 'heavy') },
  };
}

const ledger = (s: Setup) => readLedger(s.paths.ledger);
const get = (s: Setup, id: string): Task => ledger(s).tasks.find((t) => t.id === id)!;
const brief = (steps: AutopilotStep[]) => steps.map((x) => [x.task, x.step, x.outcome]);
const of = (steps: AutopilotStep[], id: string) => steps.find((x) => x.task === id)!;
const head = (s: Setup, id: string) => gitIn(s.dir, 'rev-parse', s.branchOf(id));
const checksRun = (calls: string[]) => calls.filter((c) => c.startsWith('nice -n 15 sh -c'));
const merges = (calls: string[]) => calls.filter((c) => c.startsWith('gh pr merge'));
const pushes = (calls: string[]) => calls.filter((c) => c.startsWith('git push'));
const events = (s: Setup): LedgerEvent[] => readFileSync(s.paths.events, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as LedgerEvent);
const clean = (wt: string) => gitIn(wt, 'status', '--porcelain') === '' && run('git', ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { cwd: wt }).code !== 0;

// ---------------------------------------------------------------- the order

const CONFIG = parseConfig({ ...GENERIC_CONFIG, autonomy: 'review', autopilot: { autoMerge: true }, environments: [{ name: 'main', default: true }, { name: 'release', protected: true }] }).config as Config;

test('the queue goes in the order its tasks were ready, ties in ledger order, one queue a repo; only tasks in review that joined, where auto-merge covers them (GH-73)', () => {
  const l = emptyLedger();
  const at = (m: number) => `2026-10-06T12:0${m}:00.000Z`;
  for (const [id, state, queued, env] of [['T-1', 'review', at(5), 'main'], ['T-2', 'review', at(1), 'main'], ['T-3', 'review', at(5), 'main'], ['T-4', 'rework', at(0), 'main'], ['T-5', 'review', null, 'main'], ['T-6', 'review', at(0), 'release']] as const) {
    upsertTasks(l, CONFIG, [{ source: { kind: 'manual', key: id }, title: id }], 'human', 'h', () => {}, now);
    const t = l.tasks.at(-1)!;
    Object.assign(t, { state, environment: env, ...(queued ? { autopilot: { failed: null, queued: { at: queued, sha: 'a'.repeat(40), phase: 'waiting' } } } : {}) });
  }
  assert.deepEqual(queueOrder(l, CONFIG).map((t) => t.id), ['T-2', 'T-1', 'T-3'], 'T-4 is in rework, T-5 never joined, T-6 is protected');
  assert.deepEqual(queuePlaces(l, CONFIG), [
    { id: 'T-2', place: 1, of: 3, ahead: null, phase: 'waiting', why: null },
    { id: 'T-1', place: 2, of: 3, ahead: 'T-2', phase: 'waiting', why: null },
    { id: 'T-3', place: 3, of: 3, ahead: 'T-1', phase: 'waiting', why: null },
  ]);
  assert.deepEqual(queueOrder(l, { ...CONFIG, autopilot: { appendOnly: [] } }), [], 'auto-merge off: no queue');
  assert.deepEqual(queueOrder(l, { ...CONFIG, autonomy: 'manual' }), []);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd']);
  // What each waits on, in words.
  const places = queuePlaces(l, CONFIG);
  assert.deepEqual(places.map((p) => queueWaits(p, 'main')), ['Next to merge', 'Behind T-2', 'Behind T-1']);
  assert.deepEqual((['waiting', 'refreshing', 'slot', 'checking', 'github', 'held', 'merging'] as const).map((p) => phaseWords(p, 'main')),
    ['Next to merge', 'Merging main in', 'Waiting for a heavy-check slot', 'Running the full check', 'Waiting for GitHub\'s checks', 'Waiting', 'Merging']);
  // Held, the head says why, in the wait's own words.
  assert.equal(phaseWords('held', 'main', 'GitHub is still working out whether pull request #41 can merge.'), 'GitHub is still working out whether pull request #41 can merge');
  assert.equal(queueWaits({ ...places[0]!, phase: 'held', why: 'Couldn\'t fetch main and task/T-2 from origin.' }, 'main'), 'Couldn\'t fetch main and task/T-2 from origin');
});

test('a place in the queue counts only while auto-merge covers the task: switched off, or under autonomy manual, a pull request that conflicts needs you again, whatever autopilot last wrote (GH-73)', () => {
  const l = emptyLedger();
  upsertTasks(l, CONFIG, [{ source: { kind: 'manual', key: 'T-1' }, title: 'T-1' }], 'human', 'h', () => {}, now);
  const t = l.tasks[0]!;
  const sha = 'a'.repeat(40);
  Object.assign(t, { state: 'review', environment: 'main', pr: { number: 41, url: 'u', state: 'open', sha, conflicts: ['sum.js'] }, autopilot: { failed: null, queued: { at: NOW, sha, phase: 'waiting' } } });
  assert.equal(displayState(l, t, undefined, CONFIG), 'review', 'in the queue: its turn merges main in');
  const off = { ...CONFIG, autopilot: { appendOnly: [] } };
  const manual = { ...CONFIG, autonomy: 'manual' as const };
  assert.deepEqual([displayState(l, t, undefined, off), displayState(l, t, undefined, manual)], ['needs-you', 'needs-you'], 'no autopilot clears what it wrote: the config decides');
  assert.equal(displayState(l, t), 'needs-you', 'read without the config, a conflict shows');
  assert.deepEqual([queueOrder(l, CONFIG).length, queueOrder(l, off).length, queueOrder(l, manual).length], [1, 0, 0]);
});

test('ready pull requests join in the order autopilot first sees them; a task that leaves and comes back joins at the back (GH-73)', () => {
  const s = setup();
  s.task('T-1', { 'one.js': '1\n' });
  s.task('T-2', { 'two.js': '2\n' });
  const turns: string[] = [];
  const quiet = (calls: string[] = []) => ({ ...deps(s, calls), steps: { queue: (id: string) => { turns.push(id); return { step: 'queue' as const, outcome: 'waiting' as const, reason: 'Waiting for GitHub.' }; } } });
  autopilotPass(s.paths, s.config, quiet());
  const at = get(s, 'T-1').autopilot?.queued?.at;
  assert.deepEqual([get(s, 'T-1').autopilot?.queued, get(s, 'T-2').autopilot?.queued], [
    { at: NOW.replace('Z', '.000Z'), sha: head(s, 'T-1'), phase: 'waiting' },
    { at: NOW.replace('Z', '.000Z'), sha: head(s, 'T-2'), phase: 'waiting' },
  ], 'ready in the same pass: ledger order breaks the tie');
  // T-3 is ready a minute later, and joins behind them.
  clock += 60_000;
  s.task('T-3', { 'three.js': '3\n' });
  const r = autopilotPass(s.paths, s.config, quiet());
  assert.equal(get(s, 'T-1').autopilot?.queued?.at, at, 'a place is kept');
  assert.deepEqual(queueOrder(ledger(s), s.config).map((t) => t.id), ['T-1', 'T-2', 'T-3']);
  assert.deepEqual([of(r.steps, 'T-2').reason, of(r.steps, 'T-3').reason], ['In the merge queue, 2nd: behind T-1.', 'In the merge queue, 3rd: behind T-2.']);
  assert.deepEqual(turns, ['T-1', 'T-1'], 'only the head takes a turn');

  // A person asks for changes on T-1's pull request: it leaves. Once they're dealt with, it joins at the back.
  mutate(s.paths, now, (l, emit) => {
    l.tasks.find((t) => t.id === 'T-1')!.pr!.changesRequested = true;
    emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'human:test', data: {} });
  });
  clock += 60_000;
  const left = autopilotPass(s.paths, s.config, quiet());
  assert.equal(get(s, 'T-1').autopilot?.queued, null);
  assert.equal(of(left.steps, 'T-1').reason, 'A person asked for changes on pull request #41, so autopilot doesn\'t merge it.');
  assert.deepEqual(turns.at(-1), 'T-2', 'the next is the head');
  mutate(s.paths, now, (l, emit) => {
    l.tasks.find((t) => t.id === 'T-1')!.pr!.changesRequested = false;
    emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'human:test', data: {} });
  });
  clock += 60_000;
  autopilotPass(s.paths, s.config, quiet());
  assert.deepEqual(queueOrder(ledger(s), s.config).map((t) => t.id), ['T-2', 'T-3', 'T-1']);
  // Joining, leaving and a phase aren't steps: History lists none of them.
  assert.ok(events(s).filter((e) => 'queued' in e.data).length >= 4);
  assert.ok(events(s).filter((e) => 'queued' in e.data).every((e) => autopilotEvent(e) === null));
});

test('what never joins: a protected environment, a change to .acc/, a failed step, a review not passed, or auto-merge off (GH-73)', () => {
  const s = setup();
  s.task('T-1', { 'one.js': '1\n' }, { environment: 'release' });
  s.task('T-2', { '.acc/rules.md': 'Be kind.\n' });
  s.task('T-3', { 'three.js': '3\n' });
  s.task('T-4', { 'four.js': '4\n' });
  mutate(s.paths, now, (l, emit) => {
    const t3 = l.tasks.find((t) => t.id === 'T-3')!;
    t3.autopilot = { failed: { step: 'land', sha: 'b'.repeat(40), state: 'review', reason: 'git push refused', at: NOW } };
    emit({ type: 'task.updated', task: 'T-3', actor: 'human', by: 'human:test', data: {} });
  });
  writeFileSync(reviewPath(s.paths, 'T-4', head(s, 'T-4')), JSON.stringify({ v: 1, task: 'T-4', sha: head(s, 'T-4'), env: 'main', verdict: 'changes', summary: 'No.', criteria: [], findings: [], sessionId: 's', at: NOW, durationMs: 1, costUsd: null }));
  const r = autopilotPass(s.paths, s.config, { ...deps(s, []), steps: { queue: () => assert.fail('nothing is in the queue') } });
  assert.deepEqual(ledger(s).tasks.map((t) => t.autopilot?.queued ?? null), [null, null, null, null]);
  assert.deepEqual(of(r.steps, 'T-2').outcome, 'failed');
  assert.equal(of(r.steps, 'T-2').reason, 'It changes .acc/, which a person merges: .acc/rules.md.');
  assert.equal(displayState(ledger(s), get(s, 'T-2')), 'needs-you');

  const off = setup({ config: { autopilot: { appendOnly: [] } } });
  off.task('T-1', { 'one.js': '1\n' });
  const calls: string[] = [];
  const plain = autopilotPass(off.paths, off.config, deps(off, calls));
  assert.deepEqual(brief(plain.steps), [['T-1', null, 'skipped']]);
  assert.equal(get(off, 'T-1').autopilot, undefined, 'auto-merge off: nothing is written');
  assert.ok(!calls.some((c) => c.startsWith('git fetch') || c.startsWith('gh pr merge') || c.startsWith('nice')));
});

// ---------------------------------------------------------------- the head's turn

test('the head, up to date: its full check runs once on its own commit, it merges at that commit, and nothing is merged in; the rest wait and make no call for the queue (GH-73)', () => {
  const s = setup();
  const one = s.task('T-1', { 'one.js': '1\n' });
  const two = s.task('T-2', { 'two.js': '2\n' });
  const calls: string[] = [];
  const r = autopilotPass(s.paths, s.config, deps(s, calls));
  assert.deepEqual(brief(r.steps), [['T-1', 'merge', 'done'], ['T-2', null, 'waiting']]);
  assert.equal(of(r.steps, 'T-2').reason, 'In the merge queue, 2nd: behind T-1.');
  assert.deepEqual(merges(calls), [`gh pr merge 41 -R acme/tool --merge --match-head-commit ${one}`]);
  assert.equal(checksRun(calls).length, 1, 'the full check, once');
  assert.equal(readReceipt(s.paths, one, 'test')?.status, 'pass');
  assert.equal(readReceipt(s.paths, two, 'test'), null, 'none for the task behind it');
  assert.equal(head(s, 'T-1'), one, 'nothing merged in');
  assert.ok(!calls.some((c) => c.includes(s.branchOf('T-2')) && (c.startsWith('git fetch') || c.startsWith('git merge') || c.startsWith('git push'))), 'nothing for T-2');
  assert.equal(get(s, 'T-1').autopilot?.merged?.sha, one);
  assert.equal(get(s, 'T-1').autopilot?.queued, null, 'merged, it left');

  // At most one merge a pass: T-2 takes its turn on the next, and starts from the main T-1 left.
  const next: string[] = [];
  const r2 = autopilotPass(s.paths, s.config, deps(s, next));
  assert.deepEqual(brief(r2.steps), [['T-1', null, 'skipped'], ['T-2', 'queue', 'done']]);
  const merge = head(s, 'T-2');
  assert.deepEqual(gitIn(s.dir, 'rev-list', '--parents', '-n', '1', merge).split(' ').slice(1), [two, one], 'main merged in, with T-1 on it');
});

test('the head, behind its base: main is merged in, the full check runs once on the merge in a heavy-check slot, it\'s pushed, waits for GitHub\'s checks, then merges, with no review in between (GH-73)', () => {
  const s = setup();
  const before = s.task('T-1', { 'sum.test.js': 'test("sum", () => {});\n' });
  const base = s.onMain({ 'README.md': '# test, updated\n' });
  const slotDir = join(tempDir('slots-'), 'heavy');
  const phases: string[] = [];
  let inSlot = false;
  const calls: string[] = [];
  const check: Fixture = () => {
    // The phase the Command Center shows while the check runs, and the slot it holds.
    phases.push(get(s, 'T-1').autopilot!.queued!.phase);
    inSlot = existsSync(join(slotDir, 'slot-0'));
    return ok('3 passing');
  };
  const d = deps(s, calls, { check, slots: { dir: slotDir, slots: 1 } });
  const r = autopilotPass(s.paths, s.config, d);
  const merge = head(s, 'T-1');
  assert.deepEqual(brief(r.steps), [['T-1', 'queue', 'done']]);
  assert.equal(r.steps[0]!.reason, `Merged main into ${before.slice(0, 7)} as ${merge.slice(0, 7)}, and its full check passed. Pushed it to pull request #41: it merges once GitHub's checks pass.`);
  assert.deepEqual(gitIn(s.dir, 'rev-list', '--parents', '-n', '1', merge).split(' ').slice(1), [before, base]);
  assert.deepEqual([phases, inSlot], [['checking'], true], 'the full check ran in a heavy-check slot');
  assert.equal(readReceipt(s.paths, merge, 'test')?.status, 'pass');
  assert.equal(readReceipt(s.paths, merge, 'lint'), null, 'only the full check: it covers a builder\'s');
  assert.deepEqual(pushes(calls), [`git push --set-upstream origin ${s.branchOf('T-1')}:${s.branchOf('T-1')}`]);
  const t = get(s, 'T-1');
  assert.deepEqual([t.pr?.sha, t.autopilot?.queued?.phase, t.autopilot?.carried?.from, t.autopilot?.carried?.to], [merge, 'github', before, merge]);
  // It carries the review of the commit it was made on: one place says so, for land and the merge alike.
  assert.equal(reviewedAt(s.paths, t, merge)?.sha, before);
  assert.equal(reviewedAt(s.paths, { id: 'T-1', autopilot: undefined }, merge), null, 'no carried review, no review');
  // The Command Center reads it the same way: the review stays current on the merge, not out of date.
  const latest = latestVerdict(s.paths, 'T-1')!;
  assert.deepEqual([latest.sha, reviewCurrent(s.paths, t, latest, merge), reviewCurrent(s.paths, t, latest, before)], [before, true, true]);
  assert.equal(reviewCurrent(s.paths, { id: 'T-1', autopilot: undefined }, latest, merge), false, 'no carried review: out of date on a later commit');
  assert.equal(reviewCurrent(s.paths, t, latest, ''), false, 'no branch, nothing current');
  // History: the queue's merge, and the land that pushed it.
  const told = events(s).map(autopilotEvent).filter(Boolean);
  assert.deepEqual(told.map((e) => [e!.step, e!.outcome, e!.queue ?? null]).slice(-2), [['refresh', 'done', true], ['land', 'done', null]]);
  assert.deepEqual(merges(calls), []);

  // GitHub has no checks on the merge yet: a minute after its land, it waits, and keeps its place.
  clock += 60_000;
  const early: string[] = [];
  const wait = autopilotPass(s.paths, s.config, deps(s, early));
  assert.deepEqual(brief(wait.steps), [['T-1', null, 'waiting']]);
  assert.equal(wait.steps[0]!.reason, 'First in the merge queue. GitHub reports no checks on pull request #41 yet. Autopilot gives them 2 minutes after a land.');
  assert.deepEqual([merges(early), checksRun(early)], [[], []]);
  // Two and a half minutes after: it merges, at the merge commit. No review, no second check.
  clock += 90_000;
  const later: string[] = [];
  const done = autopilotPass(s.paths, s.config, deps(s, later));
  assert.deepEqual(brief(done.steps), [['T-1', 'merge', 'done']]);
  assert.deepEqual(merges(later), [`gh pr merge 41 -R acme/tool --merge --match-head-commit ${merge}`]);
  assert.deepEqual(checksRun(later), []);
  assert.ok(![...calls, ...early, ...later].some((c) => c.startsWith('claude -p')));
});

test('a pull request that conflicted from its land has no checks on GitHub: it joins at once, and its turn merges main in and pushes a commit GitHub\'s checks run on, then merges (GH-73)', () => {
  const s = setup();
  // The branch and main each add a decision at the end: they conflict in DECISIONS.md, which autopilot resolves (D-058).
  const before = s.task('T-1', { 'docs/DECISIONS.md': `${DECISIONS}\n## D-??? Sums of three (2026-10-06)\n\nsum adds three.\n` });
  const base = s.onMain({ 'docs/DECISIONS.md': `${DECISIONS}\n## D-002 Products (2026-10-05)\n\nproduct multiplies.\n` });
  // Landed just now, after main moved on: GitHub runs none of its pull_request checks on a pull request that conflicts.
  mutate(s.paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === 'T-1')!;
    t.pr = { ...t.pr!, landedAt: NOW, conflicts: ['docs/DECISIONS.md'] };
    emit({ type: 'task.updated', task: 'T-1', actor: 'sync', by: 'acc sync', data: { pr: t.pr } });
  });
  assert.deepEqual(get(s, 'T-1').pr?.conflicts, ['docs/DECISIONS.md']);
  const calls: string[] = [];
  const r = autopilotPass(s.paths, s.config, deps(s, calls));
  const merge = head(s, 'T-1');
  assert.deepEqual(brief(r.steps), [['T-1', 'queue', 'done']], 'no 2 minutes waited for checks that won\'t come');
  assert.equal(r.steps[0]!.reason, `Merged main into ${before.slice(0, 7)} as ${merge.slice(0, 7)}, keeping both sides' additions to docs/DECISIONS.md, and its full check passed. Pushed it to pull request #41: it merges once GitHub's checks pass.`);
  assert.deepEqual(gitIn(s.dir, 'rev-list', '--parents', '-n', '1', merge).split(' ').slice(1), [before, base]);
  const kept = gitIn(s.dir, 'show', `${merge}:docs/DECISIONS.md`);
  assert.ok(kept.includes('## D-002 Products') && kept.includes('## D-??? Sums of three'), kept);
  assert.equal(checksRun(calls).length, 1);
  assert.deepEqual(pushes(calls), [`git push --set-upstream origin ${s.branchOf('T-1')}:${s.branchOf('T-1')}`]);
  const t = get(s, 'T-1');
  assert.deepEqual([t.pr?.sha, t.pr?.conflicts, t.autopilot?.queued?.phase], [merge, [], 'github'], 'the land found it no longer conflicts');

  // GitHub runs its checks on the merge commit. Until they settle it keeps its place; once they pass, it merges there.
  const ci = (bucket: string) => ({ more: { 'gh pr checks': ok(JSON.stringify([{ name: 'test', bucket, link: 'https://github.com/acme/tool/actions/runs/1/job/2', workflow: 'CI', state: bucket === 'pass' ? 'SUCCESS' : 'IN_PROGRESS' }])) } });
  clock += 30_000;
  const running: string[] = [];
  const wait = autopilotPass(s.paths, s.config, deps(s, running, ci('pending')));
  assert.deepEqual([brief(wait.steps), get(s, 'T-1').autopilot?.queued?.phase, merges(running)], [[['T-1', null, 'waiting']], 'github', []]);
  const later: string[] = [];
  const done = autopilotPass(s.paths, s.config, deps(s, later, ci('pass')));
  assert.deepEqual(brief(done.steps), [['T-1', 'merge', 'done']]);
  assert.deepEqual(merges(later), [`gh pr merge 41 -R acme/tool --merge --match-head-commit ${merge}`]);
  assert.deepEqual(checksRun([...running, ...later]), [], 'the full check ran once, on the merge');
});

test('a conflict it can\'t resolve:the branch is as it was, nothing is pushed, and it goes back to its builder with the files; its packet says how to merge main in (GH-73)', () => {
  const s = setup();
  const before = s.task('T-1', { 'sum.js': 'export const sum = (a, b) => a + b; // the branch\n' });
  s.onMain({ 'sum.js': 'export const sum = (a, b) => b + a;\n' });
  const calls: string[] = [];
  const r = autopilotPass(s.paths, s.config, deps(s, calls));
  assert.deepEqual(brief(r.steps), [['T-1', 'queue', 'done']]);
  assert.equal(r.steps[0]!.reason, 'Sent it back to its builder: merging main in conflicts in sum.js.');
  assert.equal(head(s, 'T-1'), before);
  assert.ok(clean(s.wtOf('T-1')));
  assert.deepEqual([pushes(calls), merges(calls), checksRun(calls)], [[], [], []]);
  const t = get(s, 'T-1');
  assert.deepEqual([t.state, t.autopilot?.queued ?? null, t.autopilot?.sentBack?.kind, t.autopilot?.sentBack?.conflicts, reworkCause(t)], ['rework', null, 'queue', ['sum.js'], 'queue']);
  const moved = t.history.at(-1)!;
  assert.deepEqual([moved.from, moved.to, moved.by, moved.reason], ['review', 'rework', AUTOPILOT_BY, 'The merge queue sent it back: merging main in conflicts in sum.js.']);
  // History and notices read it as the queue's send-back, not GitHub's checks'.
  const e = events(s).find((x) => x.type === 'task.moved' && x.data.to === 'rework')!;
  assert.deepEqual(autopilotEvent(e), { seq: e.seq, at: e.at, task: 'T-1', step: 'queue', outcome: 'done', checks: [], conflicts: ['sum.js'], reason: 'The merge queue sent it back: merging main in conflicts in sum.js.' });
  // What its builder reads.
  const report = readQueueReport(s.paths, 'T-1', before)!;
  assert.deepEqual([report.kind, report.conflicts, report.base, report.pr.number], ['conflict', ['sum.js'], 'main', 41]);
  const packet = renderPacket({ task: t, config: s.config, env: s.config.environments[0]!, worktree: s.wtOf('T-1'), branch: s.branchOf('T-1'), rules: null, environmentSpecific: [], queue: report });
  assert.match(packet, /## What the merge queue found\n\nThis is a rework\. Your change is pull request #41\. Its review passed, and the merge queue took it to merge into `main`, but `main` has moved on, and merging it into [0-9a-f]{7} conflicts in: `sum\.js`\./);
  assert.match(packet, /run `git merge origin\/main`, resolve each of those files/);
  assert.match(packet, /- push, merge a pull request, or open one/);
  // The next pass re-dispatches it for what the queue found.
  const next = autopilotPass(s.paths, s.config, { ...deps(s, []), steps: { dispatch: (id) => ({ reason: `Re-dispatched ${id}.` }) } });
  assert.deepEqual(brief(next.steps), [['T-1', 'dispatch', 'done']]);
});

test('a full check that fails on the merge: put back, sent back with each gate and the end of its log; again on that commit, or a fourth time, it needs you (GH-73)', () => {
  const s = setup();
  const before = s.task('T-1', { 'one.js': '1\n' });
  s.onMain({ 'README.md': '# test, updated\n' });
  const failing = bad('not ok 3 - sum adds\n# fail 1', 1);
  const calls: string[] = [];
  const r = autopilotPass(s.paths, s.config, deps(s, calls, { check: failing }));
  assert.deepEqual(brief(r.steps), [['T-1', 'queue', 'done']]);
  assert.equal(r.steps[0]!.reason, 'Sent it back to its builder: the full check failed with main merged in: test.');
  assert.equal(head(s, 'T-1'), before, 'put back');
  assert.ok(clean(s.wtOf('T-1')));
  assert.deepEqual([pushes(calls), merges(calls)], [[], []]);
  const t = get(s, 'T-1');
  assert.deepEqual([t.state, t.autopilot?.sentBack?.kind, t.autopilot?.sentBack?.checks], ['rework', 'queue', ['test']]);
  const report = readQueueReport(s.paths, 'T-1', before)!;
  assert.deepEqual([report.kind, report.checks.map((c) => [c.gate, c.status]), !!report.merge], ['check', [['test', 'fail']], true]);
  assert.match(report.checks[0]!.log!, /not ok 3 - sum adds\n# fail 1/);
  const section = queueSection(report).join('\n');
  assert.match(section, /the full check failed after merging `main` in \(as [0-9a-f]{7}, put back since\): test\. You ran the lighter checks; the full one runs once, in the queue\./);
  assert.match(section, /### test\n\n.*\n\nIts whole log: `.+test\.log`\n\nThe end of its log:\n\n```text\n[^]*not ok 3 - sum adds/);

  // A person moves it back to review at the same commit: the check fails there again, and it needs you.
  mutate(s.paths, now, (l, emit) => {
    const x = l.tasks.find((y) => y.id === 'T-1')!;
    x.state = 'review';
    x.history.push({ at: NOW, actor: 'human', by: 'human:test', from: 'rework', to: 'review', reason: 'try again' });
    emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'human:test', data: {} });
  });
  const again = autopilotPass(s.paths, s.config, deps(s, [], { check: failing }));
  assert.deepEqual(brief(again.steps), [['T-1', 'queue', 'failed']]);
  assert.match(again.steps[0]!.reason, /^The full check failed with main merged in: test\. Autopilot already sent [0-9a-f]{7} back once: a person decides\./);
  assert.deepEqual([get(s, 'T-1').state, get(s, 'T-1').autopilot?.failed?.step, get(s, 'T-1').autopilot?.queued], ['review', 'queue', null]);
  assert.equal(displayState(ledger(s), get(s, 'T-1')), 'needs-you');

  // Three send-backs already, GitHub's checks' and the queue's together: the fourth needs you.
  const many = setup();
  many.task('T-1', { 'one.js': '1\n' });
  many.onMain({ 'README.md': '# test, updated\n' });
  mutate(many.paths, now, (l, emit) => {
    const x = l.tasks[0]!;
    for (const kind of ['checks', 'queue', 'checks']) x.history.push({ at: NOW, actor: 'orchestrator', by: AUTOPILOT_BY, from: 'review', to: 'rework', reason: kind }, { at: NOW, actor: 'orchestrator', by: AUTOPILOT_BY, from: 'rework', to: 'running', reason: null }, { at: NOW, actor: 'builder', by: 'builder:T-1', from: 'running', to: 'review', reason: null });
    emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'human:test', data: {} });
  });
  const fourth = autopilotPass(many.paths, many.config, deps(many, [], { check: failing }));
  assert.deepEqual(brief(fourth.steps), [['T-1', 'queue', 'failed']]);
  assert.match(fourth.steps[0]!.reason, /Autopilot sent T-1 back to its builder 3 times already: a person decides\./);
});

test('what stops the queue for a person: a dirty worktree, a heavy-check slot that stays taken, GitHub blocking it, or gh failing to merge; the next task is the head on the next pass (GH-73)', () => {
  // Its worktree has changes nobody committed.
  const dirty = setup();
  dirty.task('T-1', { 'one.js': '1\n' });
  dirty.task('T-2', { 'two.js': '2\n' });
  writeFileSync(join(dirty.wtOf('T-1'), 'scratch.txt'), 'notes\n');
  const r = autopilotPass(dirty.paths, dirty.config, deps(dirty, []));
  assert.deepEqual(brief(r.steps), [['T-1', 'queue', 'failed'], ['T-2', null, 'waiting']]);
  assert.equal(r.steps[0]!.reason, 'T-1\'s worktree has changes nobody committed, so autopilot leaves it alone.');
  assert.deepEqual([get(dirty, 'T-1').autopilot?.failed?.step, get(dirty, 'T-1').autopilot?.queued, displayState(ledger(dirty), get(dirty, 'T-1'))], ['queue', null, 'needs-you']);
  const next = autopilotPass(dirty.paths, dirty.config, deps(dirty, []));
  assert.match(of(next.steps, 'T-1').reason, /^Autopilot couldn't take [0-9a-f]{7} through the merge queue: T-1's worktree has changes nobody committed/);
  assert.deepEqual(of(next.steps, 'T-2').step, 'merge', 'the next task is the head');

  // Every heavy-check slot stays taken (D-069): put back, and it needs you.
  const busy = setup();
  const before = busy.task('T-1', { 'one.js': '1\n' });
  busy.onMain({ 'README.md': '# test, updated\n' });
  const slotDir = join(tempDir('slots-'), 'heavy');
  mkdirSync(join(slotDir, 'slot-0'), { recursive: true });
  writeFileSync(join(slotDir, 'slot-0', 'owner'), JSON.stringify({ pid: process.pid, at: Date.now() }));
  const b = autopilotPass(busy.paths, busy.config, deps(busy, [], { slots: { dir: slotDir, slots: 1, timeoutMs: 0, pollMs: 1 } }));
  assert.deepEqual(brief(b.steps), [['T-1', 'queue', 'failed']]);
  assert.match(b.steps[0]!.reason, /^Merged main in, but its checks couldn't run: Every heavy-check slot in .+ stayed taken for 0 minutes\. If no check is running, delete that folder\. The branch is as it was, at [0-9a-f]{7}, and nothing was pushed\./);
  assert.equal(head(busy, 'T-1'), before);
  assert.equal(get(busy, 'T-1').autopilot?.queued?.phase ?? null, null);

  // GitHub won't merge it: its rules block it. The merge's failure, as GH-67 records it.
  const blocked = setup();
  blocked.task('T-1', { 'one.js': '1\n' });
  const view = () => ok(JSON.stringify({ state: 'OPEN', headRefOid: head(blocked, 'T-1'), mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', reviewDecision: null, baseRefName: 'main', isDraft: false }));
  const bl = autopilotPass(blocked.paths, blocked.config, deps(blocked, [], { more: { 'gh pr view 41': view } }));
  assert.deepEqual(brief(bl.steps), [['T-1', 'merge', 'failed']]);
  assert.match(bl.steps[0]!.reason, /^GitHub won't merge pull request #41: main's rules block it/);
  assert.deepEqual([get(blocked, 'T-1').autopilot?.failed?.step, get(blocked, 'T-1').autopilot?.queued], ['merge', null]);

  // gh can't merge it.
  const refused = setup();
  refused.task('T-1', { 'one.js': '1\n' });
  const rf = autopilotPass(refused.paths, refused.config, deps(refused, [], { more: { 'gh pr merge 41': bad('GraphQL: Pull request is not mergeable') } }));
  assert.deepEqual(brief(rf.steps), [['T-1', 'merge', 'failed']]);
  assert.equal(rf.steps[0]!.reason, 'gh couldn\'t merge pull request #41: GraphQL: Pull request is not mergeable');
});

test('a pull request pushed to on GitHub, such as with Update branch, at the head of the queue: its turn fetches it and finds the commit this clone lacks, so it needs you rather than hold the queue for good, and the next is the head (GH-73)', () => {
  const s = setup();
  const before = s.task('T-1', { 'one.js': '1\n' });
  s.task('T-2', { 'two.js': '2\n' });
  const base = s.onMain({ 'README.md': '# test, updated\n' });
  // Update branch on GitHub: main merged into T-1's branch there. GitHub's pull request, and its checks, are at that commit.
  const updated = gitIn(s.dir, 'commit-tree', `${before}^{tree}`, '-p', before, '-p', base, '-m', 'Merge branch \'main\' into task/T-1');
  gitIn(s.dir, 'push', '-q', s.origin, `${updated}:refs/heads/${s.branchOf('T-1')}`);
  const calls: string[] = [];
  const r = autopilotPass(s.paths, s.config, deps(s, calls));
  assert.deepEqual(brief(r.steps), [['T-1', 'queue', 'failed'], ['T-2', null, 'waiting']]);
  assert.equal(r.steps[0]!.reason, `origin's task/T-1 has commits this clone's branch doesn't, perhaps pushed on GitHub, such as with Update branch. Bring them into ${before.slice(0, 7)} by hand, and autopilot reviews it again.`);
  assert.equal(of(r.steps, 'T-2').reason, 'In the merge queue, 2nd: behind T-1.');
  assert.deepEqual([head(s, 'T-1'), clean(s.wtOf('T-1'))], [before, true], 'nothing merged in');
  assert.deepEqual([pushes(calls), merges(calls), checksRun(calls)], [[], [], []]);
  const t = get(s, 'T-1');
  assert.deepEqual([t.autopilot?.failed?.step, t.autopilot?.queued, displayState(ledger(s), t, undefined, s.config)], ['queue', null, 'needs-you']);
  // Next pass, T-2 is the head, and takes its turn.
  const next = autopilotPass(s.paths, s.config, deps(s, []));
  assert.deepEqual(brief(next.steps), [['T-1', null, 'waiting'], ['T-2', 'queue', 'done']]);
});

test('an agent in its worktree waiting for your answer keeps a pull request out of the merge queue: it never joins, one in it leaves, and once answered it joins at the back (GH-73)', () => {
  const s = setup();
  s.task('T-1', { 'one.js': '1\n' });
  s.task('T-2', { 'two.js': '2\n' });
  const turns: string[] = [];
  const d = deps(s, []);
  const quiet = { ...d, steps: { queue: (id: string) => { turns.push(id); return { step: 'queue' as const, outcome: 'waiting' as const, reason: 'Waiting for GitHub.' }; } } };
  // An agent working in T-1's worktree asks a person something.
  const file = join(d.env.ACC_QUESTIONS_DIR!, 'q-1.json');
  const ask = () => writeFileSync(file, JSON.stringify({ v: 1, id: 'q-1', pid: process.pid, at: Date.now(), sessionId: 's-1', cwd: join(s.wtOf('T-1'), 'src'), transcript: null, tool: 'Bash', input: { command: 'npm test' }, suggestions: [] }));
  ask();
  const r = autopilotPass(s.paths, s.config, quiet);
  assert.equal(of(r.steps, 'T-1').reason, 'An agent in T-1\'s worktree is waiting for your answer: it joins the merge queue once you\'ve answered.');
  assert.deepEqual([queueOrder(ledger(s), s.config).map((t) => t.id), turns], [['T-2'], ['T-2']]);
  // Answered: it joins, behind T-2.
  rmSync(file);
  clock += 60_000;
  autopilotPass(s.paths, s.config, quiet);
  assert.deepEqual(queueOrder(ledger(s), s.config).map((t) => t.id), ['T-2', 'T-1']);
  // Asked again while it's in the queue: it leaves.
  ask();
  clock += 60_000;
  autopilotPass(s.paths, s.config, quiet);
  assert.deepEqual([queueOrder(ledger(s), s.config).map((t) => t.id), get(s, 'T-1').autopilot?.queued], [['T-2'], null]);
});

test('the head says what it waits on, from the wait itself: GitHub\'s checks only when it\'s them, else the wait\'s own words (GH-73)', () => {
  const s = setup();
  const one = s.task('T-1', { 'one.js': '1\n' });
  s.task('T-2', { 'two.js': '2\n' });
  const view = (mergeable: string, status: string) => ({ 'gh pr view 41': ok(JSON.stringify({ state: 'OPEN', headRefOid: one, mergeable, mergeStateStatus: status, reviewDecision: null, baseRefName: 'main', isDraft: false })) });
  const ci = (bucket: string) => ({ 'gh pr checks': ok(JSON.stringify([{ name: 'test', bucket, link: 'https://github.com/acme/tool/actions/runs/1/job/2', workflow: 'CI', state: bucket === 'pass' ? 'SUCCESS' : 'IN_PROGRESS' }])) });
  const waits = () => queueWaits(queuePlaces(ledger(s), s.config)[0]!, 'main');
  // Its turn: the full check passes, and GitHub is still working out whether it can merge.
  const calls: string[] = [];
  const r = autopilotPass(s.paths, s.config, deps(s, calls, { more: view('UNKNOWN', 'UNKNOWN') }));
  assert.deepEqual(brief(r.steps), [['T-1', 'queue', 'waiting'], ['T-2', null, 'waiting']]);
  assert.deepEqual([get(s, 'T-1').autopilot?.queued?.phase, get(s, 'T-1').autopilot?.queued?.why], ['held', 'GitHub is still working out whether pull request #41 can merge.']);
  assert.equal(waits(), 'GitHub is still working out whether pull request #41 can merge');
  assert.equal(checksRun(calls).length, 1);
  // gh can't read its checks: held, in those words.
  clock += 60_000;
  autopilotPass(s.paths, s.config, deps(s, [], { more: { ...view('MERGEABLE', 'CLEAN'), 'gh pr checks': bad('HTTP 502: Bad Gateway') } }));
  assert.match(waits(), /^Autopilot couldn't read pull request #41's checks on GitHub: gh couldn't read pull request #41's checks: HTTP 502: Bad Gateway\. It tries again next pass$/);
  // GitHub's checks are running: that's what it waits for, and nothing else is kept.
  clock += 60_000;
  autopilotPass(s.paths, s.config, deps(s, [], { more: { ...view('MERGEABLE', 'CLEAN'), ...ci('pending') } }));
  assert.deepEqual([get(s, 'T-1').autopilot?.queued?.phase, get(s, 'T-1').autopilot?.queued?.why, waits()], ['github', undefined, 'Waiting for GitHub\'s checks']);
  // They pass: it merges, with no second full check.
  clock += 60_000;
  const later: string[] = [];
  const done = autopilotPass(s.paths, s.config, deps(s, later, { more: { ...view('MERGEABLE', 'CLEAN'), ...ci('pass') } }));
  assert.deepEqual(brief(done.steps), [['T-1', 'merge', 'done'], ['T-2', null, 'waiting']]);
  assert.deepEqual([merges(later), checksRun(later)], [[`gh pr merge 41 -R acme/tool --merge --match-head-commit ${one}`], []]);
});

test('a waiver holds for its own commit: a full check waived there that fails on the merge needs you, not its builder (GH-73, D-031)', () => {
  const s = setup();
  const before = s.task('T-1', { 'one.js': '1\n' });
  writeReceipt(s.paths, { gate: 'test', sha: before, env: 'main', status: 'skip', startedAt: NOW, finishedAt: NOW, durationMs: 0, summary: 'Waived.', command: null, log: null, waived: { by: 'human:jordan', reason: 'flaky', at: NOW, was: 'fail', wasSummary: 'failed' } });
  s.onMain({ 'README.md': '# test, updated\n' });
  const r = autopilotPass(s.paths, s.config, deps(s, [], { check: bad('not ok', 1) }));
  assert.deepEqual(brief(r.steps), [['T-1', 'queue', 'failed']]);
  assert.match(r.steps[0]!.reason, /^The full check failed with main merged in: test\. test was waived on [0-9a-f]{7}, and a waiver holds for its own commit only: a person decides\./);
  assert.equal(get(s, 'T-1').state, 'review');
});
