import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { readQueueReport } from '../src/checks.ts';
import { type Config, parseConfig } from '../src/config.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { failureOf, type GroupFailure, importsOf, LOG_LINES, matchFailure, reachOf, loggedPath, resolveImport } from '../src/group-blame.ts';
import { checkedWords, checkTogether, GROUP_CHECK_COMMAND, GROUP_MIN, groupEnabled, groupEnvironment, groupLockDir, groupReady, groupRunning, groupSummary, halves, listWords, markTasks, MOVED_AGAIN, GROUP_MARKS, notReady, sentBackWords, settleGroup, type GroupCheckResult } from '../src/group-check.ts';
import { groupSection } from '../src/group-report.ts';
import { AUTOPILOT_BY, GROUP_OUTCOMES, mutate, readLedger, reworkCause, type Task, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { reviewPath, type Verdict } from '../src/review.ts';
import { fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, ok, tempDir } from './support.ts';

const NOW = '2026-10-30T12:00:00Z';
const now = () => new Date(NOW);
const who = { actor: 'human' as const, by: 'human:jordan-kim' };
const fail = (files: string[] = [], tests: string[] = [], pages: string[] = []): GroupFailure => ({ checks: ['test'], tests, files: [...files, ...tests], pages, lines: [] });

// ---------------------------------------------------------------- reading a failure

test('a failure names the failing test, the files in its stack and a geometry page, and nothing untracked', () => {
  const tracked = new Set(['extension/test/where.test.ts', 'src/where.ts', 'src/other.ts', 'extension/scripts/fixtures/agents.ts']);
  const log = [
    'not ok 3 - extension/test/where.test.ts',
    '  Error: expected 2',
    '    at where (/tmp/wt/src/where.ts:12:3)',
    '    at node_modules/tsx/dist/loader.js:4:1',
    'agents dark 620px: overlap: a button: it overlaps the title',
    'ok 4 - src/fine.test.ts',
  ].join('\n');
  const f = failureOf(['test'], log, tracked, ['/tmp/wt']);
  assert.deepEqual(f.tests, ['extension/test/where.test.ts']);
  assert.deepEqual(f.files, ['extension/test/where.test.ts', 'src/where.ts']);
  assert.deepEqual(f.pages, ['agents']);
  assert.equal(f.lines.length, 3, 'the lines that name one of those');
  assert.ok(!f.files.some((x) => x.includes('node_modules')));
});

test('an empty log names nothing: no file, test or page', () => {
  // A long log keeps only LOG_LINES of its lines for the builder.
  const many = Array.from({ length: LOG_LINES + 5 }, (_, i) => `  at f (a.ts:${i}:1)`).join('\n');
  assert.equal(failureOf(['test'], many, new Set(['a.ts'])).lines.length, LOG_LINES);
  assert.deepEqual(failureOf(['test'], '', new Set(['a.ts'])), { checks: ['test'], tests: [], files: [], pages: [], lines: [] });
});

test('a path is the repo\'s: back slashes turned, the checkout\'s folder taken off', () => {
  assert.equal(loggedPath('C:\\wt\\src\\a.ts', ['C:\\wt']), 'src/a.ts');
  assert.equal(loggedPath('./src/a.ts', []), 'src/a.ts');
  assert.equal(loggedPath('file:///tmp/wt/src/a.ts', ['/tmp/wt']), 'src/a.ts');
});

test('imports resolve with an extension, an index file, or a .js written for a .ts', () => {
  assert.deepEqual(importsOf("import { a } from './a.ts';\nconst b = await import('../b');\nconst c = require('./c');\nimport './side.js';\nimport x from 'node:fs';"), ['./a.ts', '../b', './c', './side.js']);
  const tracked = new Set(['src/a.ts', 'b/index.ts', 'src/side.ts']);
  assert.equal(resolveImport('src/x.ts', './a', tracked), 'src/a.ts');
  assert.equal(resolveImport('src/x.ts', '../b', tracked), 'b/index.ts');
  assert.equal(resolveImport('src/x.ts', './side.js', tracked), 'src/side.ts');
  assert.equal(resolveImport('src/x.ts', './gone', tracked), null, 'an import of nothing tracked resolves to nothing');
});

test('a change reaches what it changed, what those import, and the tests that import them', () => {
  const files: Record<string, string> = {
    'src/a.ts': "import { b } from './b.ts';",
    'src/b.ts': '',
    'src/c.ts': '',
    'test/a.test.ts': "import { a } from '../src/a.ts';",
    'test/c.test.ts': "import { c } from '../src/c.ts';",
  };
  const reach = reachOf(['src/a.ts'], new Set(Object.keys(files)), (f) => files[f] ?? null);
  assert.deepEqual([...reach].sort(), ['src/a.ts', 'src/b.ts', 'test/a.test.ts']);
});

test('a failure matches only the task whose change reaches its files, never one whose files do not', () => {
  const suspects = [
    { id: 'T-1', changed: ['src/a.ts'], reach: new Set(['src/a.ts', 'test/a.test.ts']) },
    { id: 'T-2', changed: ['src/b.ts'], reach: new Set(['src/b.ts']) },
    { id: 'T-3', changed: ['extension/scripts/fixtures/agents.ts'], reach: new Set(['extension/scripts/fixtures/agents.ts']) },
  ];
  assert.deepEqual(matchFailure(fail([], ['test/a.test.ts']), suspects), [{ id: 'T-1', files: ['test/a.test.ts'] }]);
  assert.deepEqual(matchFailure(fail([], [], ['agents']), suspects), [{ id: 'T-3', files: ['the agents page'] }]);
  assert.deepEqual(matchFailure(fail(['src/zzz.ts']), suspects), [], 'a file no task reaches matches none');
});

// ---------------------------------------------------------------- finding the task

/** A check that fails while any of `bad` is in the group, naming `files`; and, with `pair`, while both of a pair are. */
function checker(o: { bad?: Record<string, string[]>; pair?: [string, string] }) {
  const seen: string[][] = [];
  const check = (g: string[]): GroupCheckResult => {
    seen.push(g);
    const culprit = Object.keys(o.bad ?? {}).find((id) => g.includes(id));
    if (culprit) return { ok: false, failure: fail(o.bad![culprit]!) };
    if (o.pair && o.pair.every((p) => g.includes(p))) return { ok: false, failure: fail(['src/shared.ts']) };
    return { ok: true };
  };
  return { check, seen };
}
const byFiles = (owner: Record<string, string[]>) => (f: GroupFailure, ids: string[]) => ids.filter((id) => (owner[id] ?? []).some((x) => f.files.includes(x))).map((id) => ({ id, files: f.files.filter((x) => owner[id]!.includes(x)) }));

test('all pass: the group is checked once, and every task passes', () => {
  const c = checker({});
  const s = settleGroup(['T-1', 'T-2', 'T-3'], c.check, byFiles({}));
  assert.deepEqual(s.passed, ['T-1', 'T-2', 'T-3']);
  assert.equal(c.seen.length, 1, 'one full check for the group');
});

test('one task matches: it goes back, and the rest are checked again without it', () => {
  const c = checker({ bad: { 'T-2': ['src/b.ts'] } });
  const s = settleGroup(['T-1', 'T-2', 'T-3'], c.check, byFiles({ 'T-1': ['src/a.ts'], 'T-2': ['src/b.ts'], 'T-3': ['src/c.ts'] }));
  assert.deepEqual(s.sentBack.map((x) => [x.id, x.files, x.alone]), [['T-2', ['src/b.ts'], false]]);
  assert.deepEqual(c.seen, [['T-1', 'T-2', 'T-3'], ['T-1', 'T-3']]);
  assert.deepEqual(s.passed, ['T-1', 'T-3']);
});

test('no task matches: the group splits until the failing task is alone, and only that task goes back', () => {
  const c = checker({ bad: { 'T-3': ['src/nobody.ts'] } });
  const s = settleGroup(['T-1', 'T-2', 'T-3', 'T-4'], c.check, byFiles({ 'T-1': ['src/a.ts'], 'T-3': ['src/c.ts'] }));
  assert.deepEqual(s.sentBack.map((x) => [x.id, x.alone]), [['T-3', true]]);
  assert.deepEqual(s.passed, ['T-1', 'T-2', 'T-4']);
  assert.deepEqual(c.seen, [['T-1', 'T-2', 'T-3', 'T-4'], ['T-1', 'T-2'], ['T-3', 'T-4'], ['T-3'], ['T-1', 'T-2', 'T-4']]);
});

test('two tasks match: neither goes back on a guess; the split finds the one that fails', () => {
  const c = checker({ bad: { 'T-1': ['src/shared.ts'] } });
  const s = settleGroup(['T-1', 'T-2'], c.check, byFiles({ 'T-1': ['src/shared.ts'], 'T-2': ['src/shared.ts'] }));
  assert.deepEqual(s.sentBack.map((x) => x.id), ['T-1']);
  assert.deepEqual(c.seen, [['T-1', 'T-2'], ['T-1'], ['T-2']]);
});

test('each task passes alone but the group fails: nothing is sent back and nothing passes, and acc names the tasks', () => {
  const c = checker({ pair: ['T-1', 'T-2'] });
  const s = settleGroup(['T-1', 'T-2'], c.check, byFiles({ 'T-1': ['src/shared.ts'], 'T-2': ['src/shared.ts'] }));
  assert.deepEqual([s.sentBack, s.passed, s.together], [[], [], ['T-1', 'T-2']]);
});

test('every task goes back: nothing is left to pass', () => {
  const c = checker({ bad: { 'T-1': ['src/a.ts'], 'T-2': ['src/b.ts'] } });
  const s = settleGroup(['T-1', 'T-2'], c.check, byFiles({ 'T-1': ['src/a.ts'], 'T-2': ['src/b.ts'] }));
  assert.deepEqual([s.sentBack.map((x) => x.id), s.passed], [['T-1', 'T-2'], []]);
});

test('halves: the first is the larger, and an empty list gives two empty halves', () => {
  assert.deepEqual(halves([1, 2, 3]), [[1, 2], [3]]);
  assert.deepEqual(halves([]), [[], []]);
});

// ---------------------------------------------------------------- the command and its words

const CONFIG = parseConfig({ ...GENERIC_CONFIG, environments: [{ name: 'main', default: true }, { name: 'release', protected: true }] }).config as Config;

test('the command has an id, its params, and an enabled rule that says why not', () => {
  assert.equal(GROUP_CHECK_COMMAND.id, 'acc.task.checkTogether');
  assert.match(GROUP_CHECK_COMMAND.params, /every task ready/);
  assert.deepEqual(GROUP_CHECK_COMMAND.enabled({ config: CONFIG, env: 'main', ready: 3, running: false }), { ok: true });
  const why = (s: Parameters<typeof groupEnabled>[0]) => { const r = groupEnabled(s); return r.ok ? '' : r.why; };
  assert.match(why({ config: CONFIG, env: 'release', ready: 3, running: false }), /protected/);
  assert.match(why({ config: CONFIG, env: 'main', ready: 3, running: true }), /under way/);
  assert.match(why({ config: CONFIG, env: 'main', ready: GROUP_MIN - 1, running: false }), /1 is ready/);
  assert.match(why({ config: CONFIG, env: 'main', ready: 0, running: false }), /0 are ready/);
  assert.match(why({ config: CONFIG, env: 'nowhere', ready: 3, running: false }), /isn't in the project's settings/);
  assert.match(why({ config: CONFIG, env: null, ready: 3, running: false }), /isn't in the project's settings/);
});

test('words: lists, a check, a send-back and the summary', () => {
  assert.deepEqual([listWords([]), listWords(['T-1']), listWords(['T-1', 'T-2']), listWords(['T-1', 'T-2', 'T-3'])], ['', 'T-1', 'T-1 and T-2', 'T-1, T-2 and T-3']);
  assert.equal(checkedWords('T-1', ['T-1', 'T-155', 'T-159', 'T-160'], true), 'Checked with T-155, T-159 and T-160: passed');
  assert.equal(checkedWords('T-1', ['T-1'], false, ['check']), 'Checked alone: failed (check)');
  assert.equal(sentBackWords({ failure: fail([], ['extension/test/where.test.ts']), files: [], alone: false }), 'Sent back: its change fails extension/test/where.test.ts');
  assert.equal(sentBackWords({ failure: fail(), files: [], alone: true }), 'Sent back: its change fails test, checked alone');
  assert.equal(groupSummary({ env: 'main', merged: [], leftOut: [], sentBack: [], together: ['T-1', 'T-2'], needsYou: [], checks: 3 }), 'Nothing merged into main; T-1 and T-2 fail only together, and need you. The full check ran 3 times.');
  assert.equal(MOVED_AGAIN, 3);
  assert.ok(GROUP_OUTCOMES.includes('sent-back'));
});

test('the packet section names the tests, the files and the log\'s lines; a task with no pull request says nothing of one', () => {
  const lines = groupSection({ v: 1, task: 'T-2', sha: 'abcdef1234', base: 'main', pr: null, kind: 'check', conflicts: [], checks: [{ gate: 'test', status: 'fail', summary: 'Failed.', file: '/logs/test.log', log: null }], merge: null, at: NOW },
    { with: ['T-1'], alone: false, tests: ['test/b.test.ts'], files: ['src/b.ts'], lines: ['not ok 1 - test/b.test.ts'] }).join('\n');
  assert.match(lines, /## What the group check found/);
  assert.match(lines, /`test\/b\.test\.ts`/);
  assert.match(lines, /`src\/b\.ts`/);
  assert.match(lines, /not ok 1 - test\/b\.test\.ts/);
  assert.doesNotMatch(lines, /pull request/);
});

// ---------------------------------------------------------------- with git

/**
 * A repo whose origin is a local bare repo, with tasks built in worktrees of their own, each in review and its
 * review passed on its latest commit. The full check is `npm test`; the fixture `check` answers it, given the
 * folder it runs in.
 */
function setup() {
  const RAW = { ...GENERIC_CONFIG, environments: [{ name: 'main', default: true }, { name: 'release', protected: true }], gates: { required: ['test'], commands: { test: 'npm test' } }, strayFiles: { required: false } };
  const origin = tempDir('group-origin-');
  run('git', ['init', '-q', '--bare', origin]);
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(RAW), 'src/base.ts': 'export const base = 1;\n' });
  gitIn(dir, 'remote', 'add', 'origin', origin);
  gitIn(dir, 'push', '-q', 'origin', 'main');
  const config = parseConfig(RAW).config as Config;
  config.worktrees.root = tempDir('group-trees-');
  const paths = repoPaths(dir, run);
  const trees = tempDir('group-wt-');
  const write = (root: string, files: Record<string, string>, message: string): string => {
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
    gitIn(root, 'add', '-A');
    gitIn(root, 'commit', '-q', '-m', message);
    return gitIn(root, 'rev-parse', 'HEAD');
  };
  const task = (id: string, files: Record<string, string>, more: Partial<Task> = {}): string => {
    const wt = join(trees, id);
    gitIn(dir, 'worktree', 'add', '-q', '-b', `task/${id}`, wt, 'main');
    const sha = write(wt, files, `${id}: the change`);
    const v: Verdict = { v: 1, task: id, sha, env: 'main', verdict: 'pass', summary: 'Fine.', criteria: [], findings: [], sessionId: 's', at: NOW, durationMs: 1, costUsd: null };
    mkdirSync(paths.reviews, { recursive: true });
    writeFileSync(reviewPath(paths, id, sha), JSON.stringify(v));
    mutate(paths, now, (l, emit) => {
      upsertTasks(l, config, [{ source: { kind: 'manual', key: id }, title: `Task ${id}` }], 'human', 'human:test', emit, now);
      const t = l.tasks.find((x) => x.id === id)!;
      t.state = 'review';
      t.run = { branch: `task/${id}`, worktree: wt };
      Object.assign(t, more);
    });
    return sha;
  };
  const originMain = () => run('git', ['rev-parse', 'refs/heads/main'], { cwd: origin }).stdout.trim();
  return { dir, origin, config, paths, task, write, originMain };
}

/** The full check, answered by `check` from the folder it runs in; git really runs. */
function deps(check: (cwd: string) => RunResult, calls: string[] = []) {
  return {
    run: fakeRunner({ 'nice -n 15 sh -c': (o?: RunOptions) => check(String(o?.cwd ?? '')) }, calls),
    now, env: {}, slots: { dir: join(tempDir('group-slots-'), 'heavy') },
  };
}
const has = (cwd: string, f: string) => existsSync(join(cwd, f));
const failing = (lines: string[]): RunResult => ({ code: 1, stdout: lines.join('\n'), stderr: '' });
const get = (s: ReturnType<typeof setup>, id: string) => readLedger(s.paths.ledger).tasks.find((t) => t.id === id)!;

test('a group that passes: one full check, each task merged in order on origin, and each moved to done', () => {
  const s = setup();
  s.task('T-1', { 'src/a.ts': 'export const a = 1;\n' });
  s.task('T-2', { 'src/b.ts': 'export const b = 2;\n' });
  s.task('T-3', { 'src/c.ts': 'export const c = 3;\n' });
  const calls: string[] = [];
  const r = checkTogether(s.paths, s.config, [], deps(() => ok('3 passing'), calls), who);
  assert.deepEqual(r.merged, ['T-1', 'T-2', 'T-3']);
  assert.equal(r.checks, 1, 'one full check for three tasks');
  assert.equal(calls.filter((c) => c.startsWith('nice -n 15 sh -c')).length, 1);
  // origin's main holds each task's merge, in order.
  const subjects = run('git', ['log', '--merges', '--format=%s', 'main'], { cwd: s.origin }).stdout.trim().split('\n').reverse();
  assert.deepEqual(subjects, ['T-1', 'T-2', 'T-3'].map((id) => `Merge ${id} into the group check for main`));
  for (const id of ['T-1', 'T-2', 'T-3']) {
    const t = get(s, id);
    assert.equal(t.state, 'done');
    assert.match(t.groupChecks!.at(-1)!.words, /^Checked with .+: passed, and merged into main as [0-9a-f]{7}$/);
  }
  assert.equal(get(s, 'T-1').groupChecks!.at(-1)!.words.startsWith('Checked with T-2 and T-3'), true);
  // The scratch worktree and branch are gone, and the main checkout is untouched.
  assert.equal(existsSync(join(s.config.worktrees.root!, 'group-main')), false);
  assert.equal(gitIn(s.dir, 'branch', '--list', 'acc/group/main'), '');
  assert.equal(gitIn(s.dir, 'status', '--porcelain'), '');
});

test('a task that conflicts with the group is left out before the check, naming the files and the task, and the rest go on', () => {
  const s = setup();
  s.task('T-1', { 'src/base.ts': 'export const base = 2;\n' });
  s.task('T-2', { 'src/base.ts': 'export const base = 3;\n' });
  s.task('T-3', { 'src/c.ts': 'export const c = 3;\n' });
  const r = checkTogether(s.paths, s.config, [], deps(() => ok('passing')), who);
  assert.deepEqual(r.leftOut, [{ id: 'T-2', files: ['src/base.ts'], with: 'T-1' }]);
  assert.deepEqual(r.merged, ['T-1', 'T-3']);
  assert.equal(get(s, 'T-2').state, 'review');
  assert.equal(get(s, 'T-2').groupChecks!.at(-1)!.words, 'Left out of the group check: it conflicts with T-1 in src/base.ts');
});

test('a failure in one task\'s files sends that task back, checks the rest again without it, and merges them', () => {
  const s = setup();
  s.task('T-1', { 'src/a.ts': 'export const a = 1;\n' });
  const t2 = s.task('T-2', { 'src/b.ts': 'export const b = 2;\n', 'test/b.test.ts': "import { b } from '../src/b.ts';\n" });
  s.task('T-3', { 'src/c.ts': 'export const c = 3;\n' });
  const r = checkTogether(s.paths, s.config, [], deps((cwd) => (has(cwd, 'src/b.ts') ? failing(['not ok 1 - test/b.test.ts', '  at b (src/b.ts:1:1)']) : ok('passing'))), who);
  assert.deepEqual(r.sentBack, [{ id: 'T-2', words: 'Sent back: its change fails test/b.test.ts' }]);
  assert.deepEqual(r.merged, ['T-1', 'T-3']);
  assert.equal(r.checks, 2);
  const t = get(s, 'T-2');
  assert.equal(t.state, 'rework');
  assert.equal(reworkCause(t), 'queue', 'it shares autopilot\'s send-back and re-dispatch');
  assert.equal(t.history.at(-1)!.by, AUTOPILOT_BY);
  const report = readQueueReport(s.paths, 'T-2', t2)!;
  assert.deepEqual([report.group?.tests, report.group?.with, report.group?.alone], [['test/b.test.ts'], ['T-1', 'T-3'], false]);
  assert.ok(report.group!.lines.some((l) => l.includes('test/b.test.ts')));
  assert.deepEqual(t.groupChecks!.map((m) => m.outcome), ['failed', 'sent-back']);
  assert.equal(get(s, 'T-1').state, 'done');
});

test('a failed check merges nothing: tasks that fail only together stay in review, and origin\'s main is as it was', () => {
  const s = setup();
  s.task('T-1', { 'src/a.ts': 'export const a = 1;\n' });
  s.task('T-2', { 'src/b.ts': 'export const b = 2;\n' });
  const before = s.originMain();
  const r = checkTogether(s.paths, s.config, [], deps((cwd) => (has(cwd, 'src/a.ts') && has(cwd, 'src/b.ts') ? failing(['not ok 1 - something']) : ok('passing'))), who);
  assert.deepEqual([r.merged, r.sentBack, r.together, r.checks], [[], [], ['T-1', 'T-2'], 3]);
  assert.equal(s.originMain(), before);
  assert.equal(get(s, 'T-1').state, 'review');
  assert.equal(get(s, 'T-1').groupChecks!.at(-1)!.words, 'Passes alone, but fails with T-2: a person decides');
});

test('the environment\'s branch moved after the check: the group is checked again on the new one before it merges', () => {
  const s = setup();
  s.task('T-1', { 'src/a.ts': 'export const a = 1;\n' });
  s.task('T-2', { 'src/b.ts': 'export const b = 2;\n' });
  let n = 0;
  const other = makeRepo({});
  const r = checkTogether(s.paths, s.config, [], deps(() => {
    // Someone else's merge lands on origin's main while the first check runs.
    if (n++ === 0) {
      gitIn(other, 'fetch', '-q', s.origin, 'main');
      gitIn(other, 'checkout', '-q', '-B', 'x', 'FETCH_HEAD');
      s.write(other, { 'src/other.ts': 'export const other = 1;\n' }, 'Another task');
      gitIn(other, 'push', '-q', s.origin, 'x:main');
    }
    return ok('passing');
  }), who);
  assert.equal(r.checks, 2, 'checked again on the moved branch');
  assert.deepEqual(r.merged, ['T-1', 'T-2']);
  assert.equal(run('git', ['cat-file', '-e', 'main:src/other.ts'], { cwd: s.origin }).code, 0, 'the other merge is kept');
});

test('refused before anything runs: fewer than two ready, a task whose review is old, or a group already under way', () => {
  const s = setup();
  s.task('T-1', { 'src/a.ts': 'a\n' });
  assert.throws(() => checkTogether(s.paths, s.config, [], deps(() => ok()), who), /takes 2 or more tasks/);
  s.task('T-2', { 'src/b.ts': 'b\n' });
  // A commit after T-2's review: its review is no longer on its latest commit.
  const wt = get(s, 'T-2').run!.worktree!;
  s.write(wt, { 'src/b.ts': 'b2\n' }, 'more');
  assert.match(notReady(s.paths, run, get(s, 'T-2'), 'main')!, /review hasn't passed on its latest commit/);
  assert.throws(() => checkTogether(s.paths, s.config, ['T-1', 'T-2'], deps(() => ok()), who), /review hasn't passed/);
  assert.deepEqual(groupReady(s.paths, run, readLedger(s.paths.ledger), 'main').map((m) => m.id), ['T-1']);
  mkdirSync(groupLockDir(s.paths, 'main'), { recursive: true });
  writeFileSync(join(groupLockDir(s.paths, 'main'), 'owner'), JSON.stringify({ pid: process.pid, at: Date.now() }));
  assert.equal(groupRunning(s.paths, 'main'), true);
  assert.equal(groupRunning(s.paths, 'release'), false, 'no lock: none under way');
});

test('the environment: the one asked for, else the named tasks\', and two environments are refused', () => {
  const ledger = { tasks: [{ id: 'T-1', environment: 'main' }, { id: 'T-2', environment: 'release' }] as Task[] };
  assert.equal(groupEnvironment(CONFIG, ledger, ['T-1']).branch, 'main');
  assert.equal(groupEnvironment(CONFIG, ledger, [], 'release').branch, 'release');
  assert.equal(groupEnvironment(CONFIG, ledger, []).branch, 'main', 'the default when nothing says');
  assert.throws(() => groupEnvironment(CONFIG, ledger, ['T-1', 'T-2']), /one environment/);
  assert.throws(() => groupEnvironment(CONFIG, ledger, [], 'nowhere'), /isn't an environment/);
});

test('a live checking step is replaced by its result, and a task keeps at most GROUP_MARKS steps', () => {
  const s = setup();
  s.task('T-1', { 'src/a.ts': 'a\n' });
  const mark = (outcome: 'checking' | 'passed', group = 'g') => markTasks(s.paths, now, who, group, 'main', [{ id: 'T-1', with: [], outcome, words: outcome }]);
  mark('checking');
  mark('passed');
  assert.deepEqual(get(s, 'T-1').groupChecks!.map((m) => m.outcome), ['passed']);
  for (let i = 0; i < GROUP_MARKS + 5; i++) mark('passed', `g${i}`);
  assert.equal(get(s, 'T-1').groupChecks!.length, GROUP_MARKS);
  assert.equal(readFileSync(s.paths.ledger, 'utf8').includes('"groupChecks"'), true);
});
