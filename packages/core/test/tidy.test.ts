// The tidy-up after a burst of parallel work (GH-104): counted from the ledger, scoped to the files those
// merges touched, drafted for a person, and never added on its own.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { autopilotPass } from '../src/autopilot.ts';
import { type Config, parseConfig } from '../src/config.ts';
import { run } from '../src/exec.ts';
import { emptyLedger, type Ledger, mutate, readLedger, type Task, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { sync } from '../src/sync.ts';
import { addTidy, draftTidy, readTidy, rememberInEnvironment, skipTidy, TIDY_LABEL, tidyDue, tidyFile, type TidyRecord, tidyScope, tidyStatus } from '../src/tidy.ts';
import { fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, ok, tempDir } from './support.ts';

const now = () => new Date('2026-10-08T12:00:00Z');
const CONFIG = parseConfig(GENERIC_CONFIG).config as Config;
const at = (n: number) => new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString();

/** A task whose pull request merged and moved it to done at minute `n`. */
function merged(id: string, n: number, extra: Partial<Task> = {}): Task {
  return {
    id, title: `Task ${id}`, brief: '', source: { kind: 'manual', key: null, url: null }, environment: 'main', deps: [], labels: [], state: 'done', blocker: null, run: null,
    pr: { number: n, url: `https://github.com/acme/tool/pull/${n}`, state: 'merged', mergeSha: `${n}`.padStart(40, 'a') },
    history: [{ at: at(n), actor: 'sync', by: 'acc sync', from: 'review', to: 'done', reason: `Pull request #${n} merged.` }],
    createdAt: at(0), updatedAt: at(n), ...extra,
  };
}
const ledgerOf = (...tasks: Task[]): Ledger => ({ ...emptyLedger(), tasks });
const many = (k: number, from = 1) => Array.from({ length: k }, (_, i) => merged(`T-${from + i}`, from + i));
const withEvery = (every: number) => parseConfig({ ...GENERIC_CONFIG, tidy: { every } }).config as Config;
const record = (n: number, extra: Partial<TidyRecord> = {}): TidyRecord => ({ v: 1, at: at(n), by: 'human:sam', outcome: 'skipped', covered: [], ...extra });

// ---------------------------------------------------------------- the count

test('a tidy-up is due once 8 tasks have merged, by default; 7 isn\'t enough', () => {
  const seven = tidyDue(ledgerOf(...many(7)), CONFIG, null);
  assert.deepEqual([seven.every, seven.count, seven.due], [8, 7, false]);
  const eight = tidyDue(ledgerOf(...many(8)), CONFIG, null);
  assert.deepEqual([eight.count, eight.due, eight.open], [8, true, null]);
  assert.deepEqual(eight.tasks.map((t) => t.id), ['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6', 'T-7', 'T-8'], 'oldest first');
});

test('what counts: tasks a merged pull request took to done, not a tidy-up\'s own, nor work not merged', () => {
  const tasks = [
    ...many(7),
    merged('T-20', 20, { labels: [TIDY_LABEL] }),
    merged('T-21', 21, { state: 'review' }),
    merged('T-22', 22, { pr: { number: 22, url: 'u', state: 'closed' } }),
    { ...merged('T-23', 23), pr: null },
  ];
  const s = tidyDue(ledgerOf(...tasks), CONFIG, null);
  assert.deepEqual([s.count, s.due], [7, false]);
  assert.ok(!s.tasks.some((t) => ['T-20', 'T-21', 'T-22', 'T-23'].includes(t.id)));
});

test('with no tidy-up on record, only the newest `every` count; after one, every merge since it does', () => {
  const twelve = ledgerOf(...many(12));
  assert.deepEqual(tidyDue(twelve, CONFIG, null).tasks.map((t) => t.id), ['T-5', 'T-6', 'T-7', 'T-8', 'T-9', 'T-10', 'T-11', 'T-12'], 'the newest 8, not the 4 before');
  // A person skipped one at minute 4: what merged after counts, all of it.
  const since = tidyDue(twelve, CONFIG, record(4, { covered: ['T-1', 'T-2', 'T-3', 'T-4'] }));
  assert.deepEqual([since.count, since.due, since.tasks[0]!.id], [8, true, 'T-5']);
  // Added or skipped, the count starts again from the record.
  for (const outcome of ['added', 'skipped'] as const) {
    const reset = tidyDue(twelve, CONFIG, record(12, { outcome, covered: twelve.tasks.slice(4).map((t) => t.id) }));
    assert.deepEqual([reset.count, reset.due], [0, false], outcome);
  }
});

test('an open tidy-up task holds the next offer back; `every` sets the threshold, and 0 never offers', () => {
  const open = tidyDue(ledgerOf(...many(9), merged('T-30', 30, { labels: [TIDY_LABEL], state: 'todo', pr: null })), CONFIG, null);
  assert.deepEqual([open.count, open.due, open.open], [8, false, 'T-30']);
  assert.deepEqual([tidyDue(ledgerOf(...many(2)), withEvery(3), null).due, tidyDue(ledgerOf(...many(3)), withEvery(3), null).due], [false, true]);
  const never = tidyDue(ledgerOf(...many(40)), withEvery(0), null);
  assert.deepEqual([never.count, never.due], [0, false]);
  assert.equal(tidyDue(ledgerOf(...many(40)), withEvery(0), record(0)).due, false, 'not after a record either');
});

test('a task merged in git counts once, as one merged by a pull request does; a branch not merged does not (edge case: no pull request)', () => {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, tidy: { every: 2 } }), 'src/keep.ts': 'export const k = 1;\n' });
  const branchWith = (branch: string, file: string) => {
    gitIn(dir, 'checkout', '-q', '-b', branch, 'main');
    writeFileSync(join(dir, file), `export const x = '${branch}';\n`);
    gitIn(dir, 'add', '-A');
    gitIn(dir, 'commit', '-q', '-m', `${branch}: change`);
    gitIn(dir, 'checkout', '-q', 'main');
  };
  branchWith('task/T-1', 'src/a.ts');
  gitIn(dir, 'merge', '-q', '--no-ff', '-m', 'Merge T-1', 'task/T-1');
  branchWith('task/T-2', 'src/b.ts');
  const onBranch = (id: string): Partial<Task> => ({ run: { branch: `task/${id}`, worktree: '/gone' } });
  const tasks = [
    merged('T-1', 1, { pr: null, ...onBranch('T-1') }),
    merged('T-3', 3),
    merged('T-2', 2, { pr: null, ...onBranch('T-2') }),
    merged('T-4', 4, { pr: null, run: null }),
    merged('T-5', 5, { pr: null, state: 'review', ...onBranch('T-1') }),
  ];
  const s = tidyStatus(repoPaths(dir, run), withEvery(2), ledgerOf(...tasks));
  assert.deepEqual(s.tasks.map((t) => [t.id, t.pr]), [['T-1', null], ['T-3', 3]], 'merged in git once, merged by a pull request once; unmerged, branchless and not-done tasks left out');
  assert.deepEqual([s.count, s.due], [2, true]);
  assert.equal(tidyDue(ledgerOf(...tasks), withEvery(2), null).count, 1, 'without git to ask, only the pull request counts');
});

test('rememberInEnvironment asks git once for each branch, and for each environment of one (edge case: asked again)', () => {
  const asked: string[] = [];
  const known = new Map<string, boolean>();
  const ask = rememberInEnvironment((t) => (asked.push(`${t.run?.branch}>${t.environment}`), t.run?.branch === 'task/T-1'), known);
  const t = (branch: string | null, environment = 'main'): Task => merged('T-9', 9, { environment, run: branch ? { branch, worktree: '/gone' } : null });
  assert.deepEqual([ask(t('task/T-1')), ask(t('task/T-1')), ask(t('task/T-2')), ask(t('task/T-2')), ask(t('task/T-1', 'prod'))], [true, true, false, false, true]);
  assert.deepEqual(asked, ['task/T-1>main', 'task/T-2>main', 'task/T-1>prod']);
  const fresh = rememberInEnvironment(ask, new Map());
  assert.equal(fresh(t('task/T-1')), true, 'a new set of answers (a ledger read again) asks again');
});

// ---------------------------------------------------------------- the files they touched

/**
 * A repo whose origin is a bare repo, with five tasks merged by merge commits: T-1 before the window,
 * T-2 to T-5 in it. T-2 touched a file and the append-only decision log; T-3 a file deleted later;
 * T-4 left no merge commit or branch; T-5 left no merge commit but its branch is still there.
 */
function mergedRepo() {
  const raw = { ...GENERIC_CONFIG, tidy: { every: 4 }, autopilot: { appendOnly: ['docs/DECISIONS.md'] } };
  const origin = tempDir('origin-');
  run('git', ['init', '-q', '--bare', origin]);
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(raw), 'docs/DECISIONS.md': '# Decisions\n', 'src/keep.ts': 'export const k = 1;\n' });
  gitIn(dir, 'remote', 'add', 'origin', origin);
  const config = parseConfig(raw).config as Config;
  const branchWith = (branch: string, files: Record<string, string>) => {
    gitIn(dir, 'checkout', '-q', '-b', branch, 'main');
    for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
    gitIn(dir, 'add', '-A');
    gitIn(dir, 'commit', '-q', '-m', `${branch}: change`);
    gitIn(dir, 'checkout', '-q', 'main');
  };
  const mergeIn = (branch: string): string => {
    gitIn(dir, 'merge', '-q', '--no-ff', '-m', `Merge ${branch}`, branch);
    return gitIn(dir, 'rev-parse', 'HEAD');
  };
  branchWith('task/T-1', { 'src/old.ts': 'export const old = 1;\n' });
  const m1 = mergeIn('task/T-1');
  branchWith('task/T-2', { 'src/a.ts': 'export const a = 1;\n', 'docs/DECISIONS.md': '# Decisions\n\n## D-1\n', '.acc/rules.md': '- A rule.\n' });
  const m2 = mergeIn('task/T-2');
  branchWith('task/T-3', { 'src/b.ts': 'export const b = 1;\n', 'src/c.ts': 'export const c = 1;\n' });
  const m3 = mergeIn('task/T-3');
  branchWith('task/T-5', { 'src/e.ts': 'export const e = 1;\n', 'src/a.ts': 'export const a = 2;\n' });
  mergeIn('task/T-5');
  // Later, someone deletes c.ts on main.
  gitIn(dir, 'rm', '-q', 'src/c.ts');
  gitIn(dir, 'commit', '-q', '-m', 'Remove c');
  gitIn(dir, 'push', '-q', 'origin', 'main');
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    emit({ type: 'task.added', task: 'T-1', actor: 'human', by: 'human:test', data: {} });
    l.tasks.push(
      merged('T-1', 1, { pr: { number: 1, url: 'u', state: 'merged', mergeSha: m1 } }),
      merged('T-2', 2, { pr: { number: 2, url: 'u', state: 'merged', mergeSha: m2 } }),
      merged('T-3', 3, { pr: { number: 3, url: 'u', state: 'merged', mergeSha: m3 } }),
      merged('T-4', 4, { pr: { number: 4, url: 'u', state: 'merged' } }),
      merged('T-5', 5, { pr: { number: 5, url: 'u', state: 'merged' }, run: { branch: 'task/T-5', worktree: '/gone' } }),
    );
  });
  return { dir, config, paths };
}

test('the scope is exactly the files the window\'s merges changed that are still there, without append-only files or .acc/', () => {
  const { dir, config, paths } = mergedRepo();
  const status = tidyStatus(paths, config, readLedger(paths.ledger));
  assert.deepEqual([status.due, status.tasks.map((t) => t.id)], [true, ['T-2', 'T-3', 'T-4', 'T-5']], 'the newest 4: T-1 is before the window');
  const scope = tidyScope(run, dir, config, status.tasks);
  assert.deepEqual(scope.files, ['src/a.ts', 'src/b.ts', 'src/e.ts'], 'not old.ts (before the window), c.ts (deleted), the decision log or .acc/');
  assert.deepEqual(scope.leftOut, ['.acc/rules.md', 'docs/DECISIONS.md']);
  assert.deepEqual([scope.branch, scope.tip, scope.fetched], ['main', 'origin/main', true]);
  assert.deepEqual(scope.unknown, [{ task: 'T-4', why: 'acc didn\'t record its merge commit or its branch' }], 'listed, never dropped');

  // Its branch gone too, T-5 is unknown, and says why.
  gitIn(dir, 'branch', '-q', '-D', 'task/T-5');
  const gone = tidyScope(run, dir, config, status.tasks);
  assert.deepEqual(gone.unknown.map((u) => [u.task, u.why]), [['T-4', 'acc didn\'t record its merge commit or its branch'], ['T-5', 'acc didn\'t record its merge commit, and its branch task/T-5 is gone']]);
  assert.deepEqual(gone.files, ['src/a.ts', 'src/b.ts']);
});

test('a merge commit this clone doesn\'t have is unknown, and a failed fetch says so', () => {
  const { dir, config, paths } = mergedRepo();
  const tasks = tidyStatus(paths, config, readLedger(paths.ledger)).tasks.map((t) => (t.id === 'T-2' ? { ...t, mergeSha: 'f'.repeat(40) } : t));
  const offline = fakeRunner({ 'git fetch': { code: 128, stdout: '', stderr: 'Could not resolve host' } });
  const scope = tidyScope(offline, dir, config, tasks);
  assert.equal(scope.fetched, false);
  assert.deepEqual(scope.unknown[0], { task: 'T-2', why: 'its merge commit fffffff isn\'t in this clone, and fetching it failed' });
});

test('the draft names the tasks it covers, lists the files, and asks for duplicated helpers and contradicting comments with no change in behaviour', () => {
  const { dir, config, paths } = mergedRepo();
  const status = tidyStatus(paths, config, readLedger(paths.ledger));
  const d = draftTidy(status, tidyScope(run, dir, config, status.tasks));
  assert.equal(d.title, 'Tidy up after 4 merges');
  assert.deepEqual([d.labels, d.covered, d.files], [[TIDY_LABEL], ['T-2', 'T-3', 'T-4', 'T-5'], ['src/a.ts', 'src/b.ts', 'src/e.ts']]);
  assert.match(d.brief, /^4 tasks merged in this repo since the last tidy-up: T-2, T-3, T-4, T-5\./);
  assert.match(d.brief, /\*\*Duplicated helpers:\*\*/);
  assert.match(d.brief, /\*\*Comments that contradict the code:\*\*/);
  assert.match(d.brief, /- \[ \] It changes no behaviour: no test's expectations change/);
  assert.match(d.brief, /- \[ \] It changes only the files below\./);
  assert.match(d.brief, /## The files \(3\)\n\n.*\n\n- `src\/a\.ts`\n- `src\/b\.ts`\n- `src\/e\.ts`\n/);
  assert.match(d.brief, /## Tasks whose files aren't known\n\n.*\n\n- T-4: acc didn't record its merge commit or its branch\.$/);
  assert.ok(!/src\/(old|c)\.ts|DECISIONS/.test(d.brief), 'nothing outside the scope');
});

// ---------------------------------------------------------------- a person's choice, and nothing on its own

test('adding the tidy-up makes one T-n task in todo, labelled tidy-up, records it whole, and starts the count again', () => {
  const { dir, config, paths } = mergedRepo();
  const before = readLedger(paths.ledger).tasks.length;
  const status = tidyStatus(paths, config, readLedger(paths.ledger));
  const draft = draftTidy(status, tidyScope(run, dir, config, status.tasks));
  const r = addTidy(paths, config, draft, { by: 'human:sam', now });
  const l = readLedger(paths.ledger);
  assert.equal(l.tasks.length, before + 1);
  const t = l.tasks.find((x) => x.id === r.task)!;
  assert.deepEqual([t.id, t.state, t.labels, t.environment, t.title, t.source.kind], ['T-6', 'todo', [TIDY_LABEL], 'main', 'Tidy up after 4 merges', 'manual']);
  assert.equal(t.brief, draft.brief);
  assert.deepEqual(readTidy(paths), { v: 1, at: now().toISOString(), by: 'human:sam', outcome: 'added', task: 'T-6', covered: ['T-2', 'T-3', 'T-4', 'T-5'] });
  assert.ok(readFileSync(tidyFile(paths), 'utf8').endsWith('}\n'), 'written whole');
  assert.ok(!existsSync(`${tidyFile(paths)}.${process.pid}.tmp`), 'no temp file left behind');
  const after = tidyStatus(paths, config, readLedger(paths.ledger));
  assert.deepEqual([after.count, after.due, after.open], [0, false, 'T-6']);
  assert.throws(() => addTidy(paths, config, draft, { by: 'human:sam', now }), /T-6 is a tidy-up that isn't done yet/);
});

test('skipping records who and when, and the next offer comes after another `every` merges', () => {
  const { config, paths } = mergedRepo();
  const r = skipTidy(paths, config, { by: 'human:sam', now });
  assert.deepEqual(r, { v: 1, at: now().toISOString(), by: 'human:sam', outcome: 'skipped', covered: ['T-2', 'T-3', 'T-4', 'T-5'] });
  assert.deepEqual(readTidy(paths), r);
  assert.equal(tidyStatus(paths, config, readLedger(paths.ledger)).count, 0);
  assert.throws(() => skipTidy(paths, config, { by: 'human:sam', now }), /Nothing has merged since the last tidy-up/);
  rmSync(tidyFile(paths));
  writeFileSync(tidyFile(paths), 'not json');
  assert.equal(readTidy(paths), null, 'a record acc can\'t read is none');
});

test('nothing adds a tidy-up on its own: neither a sync that merges 8 tasks nor an autopilot pass after it', () => {
  const raw = { ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'jordan-kim' }, autonomy: 'review' };
  const config = parseConfig(raw).config as Config;
  const paths = repoPaths(makeRepo({ '.acc/config.json': JSON.stringify(raw) }), run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, Array.from({ length: 8 }, (_, i) => ({ source: { kind: 'manual' as const }, title: `Task ${i + 1}` })), 'human', 'human:test', emit, now);
    l.tasks.forEach((t, i) => { t.state = 'review'; t.pr = { number: i + 1, url: `https://github.com/acme/tool/pull/${i + 1}`, state: 'open' }; });
  });
  const calls: string[] = [];
  const gh = fakeRunner({
    'gh auth token -u jordan-kim': ok('gho_token\n'),
    'gh pr view': ok(JSON.stringify({ number: 1, state: 'MERGED', url: 'https://github.com/acme/tool/pull/1', mergeCommit: { oid: 'c0ffee'.padEnd(40, '0') }, statusCheckRollup: [] })),
    'gh pr list': ok('[]'),
    'claude': ok(''),
  }, calls);
  const r = sync(paths, config, { run: gh, now, env: {} });
  assert.equal(r.changes.filter((c) => c.moved?.to === 'done').length, 8, 'all 8 merged to done');
  assert.equal(tidyStatus(paths, config, readLedger(paths.ledger)).due, true, 'so a tidy-up is due');
  autopilotPass(paths, config, { run: gh, now, env: {}, accBinDir: '/opt/acc/bin' });
  const l = readLedger(paths.ledger);
  assert.equal(l.tasks.length, 8, 'no task added');
  assert.ok(!l.tasks.some((t) => t.labels.includes(TIDY_LABEL)));
  assert.equal(existsSync(tidyFile(paths)), false, 'and nothing recorded');
});
