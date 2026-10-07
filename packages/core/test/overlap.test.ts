import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { run } from '../src/exec.ts';
import type { Ledger, Task } from '../src/ledger.ts';
import { branchFiles, branchMerged, envOpen, filesOf, inFlight, inFlightFiles, overlaps, plannedFiles, repoPath, sameFile, sharedFiles, startOrder, waits, waitWords } from '../src/overlap.ts';
import { repoPaths } from '../src/paths.ts';
import { GENERIC_CONFIG, gitIn, makeRepo, tempDir, writePlan } from './support.ts';

test('paths are compared as git names them: relative, without ./ or a trailing /, and a glob as its folder (D-093)', () => {
  assert.equal(repoPath('./src/a.ts', '/repo'), 'src/a.ts');
  assert.equal(repoPath('/repo/src/a.ts', '/repo'), 'src/a.ts');
  assert.equal(repoPath('src/views/', '/repo'), 'src/views');
  assert.equal(repoPath('force-app/main/default/classes/*.cls', '/repo'), 'force-app/main/default/classes');
  assert.equal(repoPath('**/*.ts', '/repo'), null, 'a glob over the whole repo names nothing');
  assert.equal(repoPath('/elsewhere/a.ts', '/repo'), null, 'outside the repo');
  assert.equal(repoPath('../a.ts', '/repo'), null);
  assert.equal(repoPath('  ', '/repo'), null);
  const plan = (paths: string[]) => ({ approach: { files: paths.map((path) => ({ path, change: 'update' as const, why: '' })) } }) as never;
  assert.deepEqual(plannedFiles(plan(['./src/b.ts', '/repo/src/a.ts', 'src/a.ts']), '/repo'), ['src/a.ts', 'src/b.ts']);
  assert.equal(plannedFiles(null, '/repo'), null, 'no analysis: its files aren\'t known');
  assert.equal(plannedFiles(plan([]), '/repo'), null, 'an analysis that names none: not known either');
});

test('two plans overlap on the same file, or a folder holding one, and never on shared or append-only files (D-093)', () => {
  assert.ok(sameFile('src/a.ts', 'src/a.ts'));
  assert.ok(sameFile('src', 'src/a.ts'));
  assert.ok(sameFile('src/a.ts', 'src'));
  assert.ok(!sameFile('src/a.ts', 'src/ab.ts'));
  assert.ok(!sameFile('src2/a.ts', 'src'));
  const others = [{ task: 'T-1', files: ['src/a.ts', 'docs/DECISIONS.md'] }, { task: 'T-2', files: ['lib'] }, { task: 'T-3', files: ['README.md'] }];
  assert.deepEqual(overlaps(['src/a.ts'], others, []), [{ task: 'T-1', files: ['src/a.ts'] }]);
  assert.deepEqual(overlaps(['src/b.ts'], others, []), [], 'disjoint lists share nothing');
  assert.deepEqual(overlaps(['lib/x.ts', 'src'], others, []), [{ task: 'T-1', files: ['src/a.ts'] }, { task: 'T-2', files: ['lib/x.ts'] }], 'named as the file, when one side lists its folder');
  assert.deepEqual(overlaps(['docs/DECISIONS.md'], others, ['docs/DECISIONS.md']), [], 'a decision log every task appends to never counts');
  assert.deepEqual(overlaps(['docs/DECISIONS.md', 'docs/x.md'], [{ task: 'T-4', files: ['docs/x.md', 'docs/DECISIONS.md'] }], ['docs']), [], 'nor does anything in a listed folder');
  assert.deepEqual(overlaps(null, others, []), [], 'files not known share nothing');
  const config = parseConfig({ ...GENERIC_CONFIG, autopilot: { appendOnly: ['docs/DECISIONS.md'] }, dispatch: { shared: ['README.md', 'docs/DESIGN.md'] } }).config!;
  assert.deepEqual(sharedFiles(config), ['docs/DECISIONS.md', 'README.md', 'docs/DESIGN.md'], 'autopilot.appendOnly and dispatch.shared both count');
  assert.deepEqual(overlaps(['README.md', 'docs/DECISIONS.md'], others, sharedFiles(config)), []);
  assert.equal(waitWords([{ task: 'T-1', files: ['a.ts', 'b.ts'] }, { task: 'T-2', files: ['c.ts'] }]), 'Waits for T-1\'s files: a.ts, b.ts, and T-2\'s: c.ts');
  assert.equal(filesOf([{ task: 'T-1', files: ['a.ts'] }]), 'T-1\'s files: a.ts');
});

test('dispatch.shared is a list of paths inside the repo', () => {
  assert.deepEqual(parseConfig({ ...GENERIC_CONFIG, dispatch: { shared: ['README.md', 'docs'] } }).config!.dispatch, { shared: ['README.md', 'docs'] });
  assert.equal(parseConfig(GENERIC_CONFIG).config!.dispatch, undefined, 'none by default: the core lists no project\'s files');
  assert.match(parseConfig({ ...GENERIC_CONFIG, dispatch: { shared: ['/abs'] } }).errors.join(' '), /dispatch.shared/);
  assert.match(parseConfig({ ...GENERIC_CONFIG, dispatch: { shared: ['../up'] } }).errors.join(' '), /dispatch.shared/);
  assert.match(parseConfig({ ...GENERIC_CONFIG, dispatch: 'README.md' }).errors.join(' '), /"dispatch" must be an object/);
  assert.match(parseConfig({ ...GENERIC_CONFIG, dispatch: { shared: [], queue: true } }).warnings.join(' '), /dispatch.queue/);
});

test('a task that shares files waits only while another Ready task shares none: prefer, don\'t block (D-093)', () => {
  const flying = [{ task: 'T-1', files: ['src/a.ts'] }];
  const cands = (more: { id: string; files: string[] | null; startable: boolean }[]) => [{ id: 'T-2', files: ['src/a.ts'], startable: true }, ...more];
  // Nothing else is ready: it starts, and says what it shares.
  const alone = startOrder({ id: 'T-2', files: ['src/a.ts'] }, cands([]), flying, []);
  assert.deepEqual(alone, { shares: [{ task: 'T-1', files: ['src/a.ts'] }], first: [] });
  assert.ok(!waits(alone));
  // Another Ready task shares nothing in flight: that one goes first.
  const free = startOrder({ id: 'T-2', files: ['src/a.ts'] }, cands([{ id: 'T-3', files: ['src/c.ts'], startable: true }]), flying, []);
  assert.deepEqual(free.first, ['T-3']);
  assert.ok(waits(free));
  // A task whose files aren't known, that can't start now, or that shares files too, isn't one to prefer.
  const none = startOrder({ id: 'T-2', files: ['src/a.ts'] }, cands([
    { id: 'T-4', files: null, startable: true },
    { id: 'T-5', files: ['src/c.ts'], startable: false },
    { id: 'T-6', files: ['src/a.ts'], startable: true },
  ]), flying, []);
  assert.deepEqual(none.first, []);
  // No overlap: nothing to wait for, whatever else is ready.
  assert.deepEqual(startOrder({ id: 'T-2', files: ['src/b.ts'] }, cands([{ id: 'T-3', files: ['src/c.ts'], startable: true }]), flying, []), { shares: [], first: [] });
  // No analysis: never held.
  assert.deepEqual(startOrder({ id: 'T-2', files: null }, cands([{ id: 'T-3', files: ['src/c.ts'], startable: true }]), flying, []), { shares: [], first: [] });
});

test('a Ready task in a protected environment never goes first: acc wouldn\'t start it there (D-093)', () => {
  const config = { environments: [{ name: 'Dev', branch: 'dev', protected: false }, { name: 'Production', branch: 'main', protected: true }] } as never;
  assert.equal(envOpen(config, { environment: 'dev' }), true);
  assert.equal(envOpen(config, { environment: 'main' }), false, 'protected');
  assert.equal(envOpen(config, { environment: 'gone' }), false, 'not in the config');
});

/** A task as the ledger keeps it, enough for what overlap reads. */
function task(id: string, state: Task['state'], extra: Partial<Task> = {}): Task {
  return { id, title: id, brief: '', source: { kind: 'manual', key: null, url: null }, environment: 'main', deps: [], labels: [], state, blocker: null, run: null, pr: null, history: [], createdAt: '', updatedAt: '', ...extra };
}

test('a branch\'s files: committed, uncommitted and untracked in its worktree, a rename as both paths', () => {
  const repo = realpathSync(makeRepo({ 'src/a.ts': 'a\n', 'src/old.ts': 'old\n', 'src/b.ts': 'b\n', '.gitignore': '.claude/\nignored.txt\n' }));
  const wt = join(repo, '.claude', 'worktrees', 'T-1');
  gitIn(repo, 'worktree', 'add', '-q', '-b', 'task/T-1-x', wt, 'main');
  writeFileSync(join(wt, 'src', 'a.ts'), 'a2\n');
  renameSync(join(wt, 'src', 'old.ts'), join(wt, 'src', 'new.ts'));
  gitIn(wt, 'add', '-A');
  gitIn(wt, 'commit', '-q', '-m', 'work');
  writeFileSync(join(wt, 'src', 'b.ts'), 'b2\n');
  mkdirSync(join(wt, 'lib'));
  writeFileSync(join(wt, 'lib', 'fresh.ts'), 'new\n');
  writeFileSync(join(wt, 'ignored.txt'), 'x\n');
  assert.deepEqual(branchFiles(run, repo, 'main', 'task/T-1-x', wt), ['lib/fresh.ts', 'src/a.ts', 'src/b.ts', 'src/new.ts', 'src/old.ts']);
  assert.deepEqual(branchFiles(run, repo, 'main', 'task/T-1-x'), ['src/a.ts', 'src/new.ts', 'src/old.ts'], 'without its worktree, what it committed');
  assert.deepEqual(branchFiles(run, repo, 'main', 'task/nowhere'), [], 'a branch this clone doesn\'t have holds nothing');
});

test('every dispatched task holds its files until its branch merges: running, in review, rework or blocked (D-093)', () => {
  const origin = tempDir('origin-');
  gitIn(origin, 'init', '-q', '--bare', '-b', 'main');
  const repo = realpathSync(makeRepo({ 'src/a.ts': 'a\n', 'src/b.ts': 'b\n' }));
  gitIn(repo, 'remote', 'add', 'origin', origin);
  gitIn(repo, 'push', '-q', 'origin', 'main');
  const paths = repoPaths(repo, run);
  // T-1 changed src/a.ts on its branch, and has no analysis: its branch's files still count.
  gitIn(repo, 'checkout', '-q', '-b', 'task/T-1-a');
  writeFileSync(join(repo, 'src', 'a.ts'), 'a2\n');
  gitIn(repo, 'commit', '-qam', 'a');
  gitIn(repo, 'checkout', '-q', 'main');
  writePlan(paths.analyses, 'T-2', ['src/b.ts']);
  const run1 = { branch: 'task/T-1-a' };
  const ledger: Ledger = {
    schema: 1, seq: 0, tasks: [
      task('T-1', 'review', { run: run1, pr: { number: 1, url: 'u', state: 'open' } }),
      task('T-2', 'blocked', { run: { branch: 'task/T-2-b' } }),
      task('T-3', 'done', { run: { branch: 'task/T-3-c' } }),
      task('T-4', 'todo'),
      task('T-5', 'blocked'),
    ],
  };
  assert.deepEqual(inFlight(ledger).map((t) => t.id), ['T-1', 'T-2'], 'done, to do, and blocked before it started don\'t hold');
  assert.deepEqual(inFlightFiles(paths, ledger, run), [{ task: 'T-1', files: ['src/a.ts'] }, { task: 'T-2', files: ['src/b.ts'] }]);
  assert.ok(!branchMerged(run, repo, ledger.tasks[0]!), 'its pull request is open');
  // Its pull request merges on GitHub: after a fetch its branch is in origin's main, and it holds nothing.
  gitIn(repo, 'merge', '-q', '--no-ff', '-m', 'Merge T-1', 'task/T-1-a');
  gitIn(repo, 'push', '-q', 'origin', 'main');
  gitIn(repo, 'reset', '-q', '--hard', 'HEAD~1');
  gitIn(repo, 'update-ref', 'refs/remotes/origin/main', 'main');
  assert.deepEqual(inFlightFiles(paths, ledger, run).map((f) => f.task), ['T-1', 'T-2'], 'not until origin is fetched');
  assert.deepEqual(inFlightFiles(paths, ledger, run, { fetch: true }).map((f) => f.task), ['T-2']);
  assert.ok(branchMerged(run, repo, task('T-9', 'review', { pr: { number: 9, url: 'u', state: 'merged' } })), 'acc sync saw it merge');
  assert.ok(!branchMerged(run, repo, task('T-8', 'running', { run: { branch: 'main' } })), 'a branch with no pull request is never taken as merged, though it has no commits yet');
});
