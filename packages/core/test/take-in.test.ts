import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { type Config, parseConfig } from '../src/config.ts';
import { AccError, run } from '../src/exec.ts';
import { mutate, type Task } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { MergeConflict } from '../src/refresh.ts';
import { TAKE_IN_STATES, takeIn, takeInGates } from '../src/take-in.ts';
import { fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, tempDir } from './support.ts';

const now = () => new Date('2026-10-22T12:00:00Z');
const BRANCH = 'task/T-1-add';
// The builder's lighter checks, where auto-merge is on (GH-73): near runs tests, lint doesn't.
const RAW = {
  ...GENERIC_CONFIG, autonomy: 'review', autopilot: { autoMerge: true, appendOnly: ['docs/DECISIONS.md'] }, strayFiles: { required: false },
  gates: { required: ['check'], builder: ['lint', 'near'], tests: ['check', 'near'], commands: { check: 'true', lint: 'true', near: 'echo near' } },
};

const write = (root: string, files: Record<string, string>, message: string): string => {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  gitIn(root, 'add', '-A');
  gitIn(root, 'commit', '-q', '-m', message);
  return gitIn(root, 'rev-parse', 'HEAD');
};

/**
 * T-1 running in its own worktree, its branch never pushed. A teammate's T-2 merged into main on origin from
 * another clone, so this clone doesn't hold it until it fetches.
 */
function setup(state: Task['state'] = 'running') {
  const origin = tempDir('origin-');
  gitIn(origin, 'init', '-q', '--bare', '-b', 'main');
  const root = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(RAW), '.gitignore': '.claude/\n', 'src/a.ts': 'a\n', 'src/b.ts': 'b\n', 'docs/DECISIONS.md': '# Decisions\n' }));
  gitIn(root, 'remote', 'add', 'origin', origin);
  gitIn(root, 'push', '-q', 'origin', 'main');
  const wt = join(root, '.claude', 'worktrees', 'T-1');
  gitIn(root, 'worktree', 'add', '-q', '-b', BRANCH, wt, 'main');
  const config = parseConfig(RAW).config as Config;
  const paths = repoPaths(root, run);
  mutate(paths, now, (l, emit) => {
    l.tasks.push(
      { id: 'T-1', title: 'Add b', brief: '', source: { kind: 'manual', key: 'T-1', url: null }, environment: 'main', deps: [], labels: [], state, blocker: null, run: { branch: BRANCH, worktree: wt }, pr: null, history: [], createdAt: '', updatedAt: '' },
      { id: 'T-2', title: 'Change a', brief: '', source: { kind: 'manual', key: 'T-2', url: null }, environment: 'main', deps: [], labels: [], state: 'done', blocker: null, run: null, pr: null, history: [], createdAt: '', updatedAt: '' },
    );
    emit({ type: 'task.added', task: 'T-1', actor: 'human', by: 'human:test', data: {} });
  });
  /** A teammate's merge, on origin only. */
  const teammate = (files: Record<string, string>): string => {
    const other = join(tempDir('other-'), 'clone');
    gitIn(dirname(other), 'clone', '-q', origin, other);
    gitIn(other, 'config', 'user.name', 'Teammate');
    gitIn(other, 'config', 'user.email', 'mate@example.com');
    const sha = write(other, files, 'T-2: Change a');
    gitIn(other, 'push', '-q', 'origin', 'main');
    return sha;
  };
  return { root, origin, wt, config, paths, teammate };
}

const deps = (calls: string[], near = { code: 0, stdout: '# tests 2\n# pass 2\n# fail 0\n', stderr: '' }) => ({
  run: fakeRunner({ 'nice -n 15 sh -c echo near': near, 'nice -n 15 sh -c true': { code: 0, stdout: '', stderr: '' } }, calls), now, env: {}, slots: { dir: join(tempDir('slots-'), 'heavy') },
});
const pushes = (calls: string[]) => calls.filter((c) => /^git push|^gh /.test(c));
const head = (wt: string) => gitIn(wt, 'rev-parse', 'HEAD');
const mergingIn = (wt: string) => run('git', ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { cwd: wt }).code === 0;

test('acc refresh fetches main, merges origin\'s copy into the task\'s branch as a commit there, and runs its near tests', () => {
  const s = setup();
  const from = write(s.wt, { 'src/b.ts': 'b from T-1\n' }, 'T-1: b');
  const theirs = s.teammate({ 'src/a.ts': 'a from T-2\n' });
  const calls: string[] = [];
  const r = takeIn(s.paths, s.config, 'T-1', deps(calls), { actor: 'builder', by: 'builder:T-1', leave: true });
  assert.ok(r.sha);
  assert.equal(head(s.wt), r.sha, 'a commit on the task\'s branch');
  assert.equal(gitIn(s.root, 'rev-parse', `refs/heads/${BRANCH}`), r.sha);
  assert.deepEqual(gitIn(s.wt, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').slice(1), [from, theirs], 'its branch, then origin\'s main');
  assert.equal(readFileSync(join(s.wt, 'src/a.ts'), 'utf8'), 'a from T-2\n', 'the teammate\'s work is in the worktree');
  assert.deepEqual(r.landed.map((l) => [l.task, l.shares]), [['T-2', []]], 'what it took in, matched to its task');
  assert.ok(calls.some((c) => c.startsWith('git fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main')), 'main fetched first');
  assert.deepEqual(r.tests, [{ gate: 'near', status: 'pass', summary: r.tests[0]!.summary }], 'the builder\'s test checks only: near, not lint');
  assert.ok(calls.some((c) => c === 'nice -n 15 sh -c echo near'));
  assert.ok(!calls.some((c) => c.includes('sh -c true')), 'lint runs no tests, so it isn\'t run');
  assert.match(r.reason, /^Merged origin\/main into [0-9a-f]{7} as [0-9a-f]{7}: 1 merge taken in\. near passed\. Nothing was pushed\.$/);
  assert.deepEqual(pushes(calls), [], 'nothing pushed');
  const events = readFileSync(s.paths.events, 'utf8');
  assert.match(events, /"tookIn":\{"base":"main"/, 'kept with the task');
  // Again: the branch holds main now.
  const again = takeIn(s.paths, s.config, 'T-1', deps(calls), { actor: 'builder', by: 'builder:T-1', leave: true });
  assert.equal(again.sha, null);
  assert.match(again.reason, /already holds main: nothing to take in/);
});

test('acc refresh whose near tests fail keeps the merge, says which failed, and pushes nothing', () => {
  const s = setup();
  write(s.wt, { 'src/b.ts': 'b from T-1\n' }, 'T-1: b');
  s.teammate({ 'src/a.ts': 'a from T-2\n' });
  const calls: string[] = [];
  const r = takeIn(s.paths, s.config, 'T-1', deps(calls, { code: 1, stdout: '# tests 2\n# pass 1\n# fail 1\n', stderr: 'not ok 2' }), { actor: 'builder', by: 'builder:T-1', leave: true });
  assert.equal(r.tests[0]!.status, 'fail');
  assert.equal(head(s.wt), r.sha, 'the merge is the builder\'s to fix, on its branch');
  assert.match(r.reason, /near failed: .*Fix it on your branch/);
  assert.deepEqual(pushes(calls), []);
});

test('a conflict stops acc refresh with the files listed: left in the builder\'s worktree to resolve, and nothing pushed', () => {
  const s = setup();
  const from = write(s.wt, { 'src/a.ts': 'a from T-1\n', 'docs/DECISIONS.md': '# Decisions\n\nT-1\n' }, 'T-1: a');
  s.teammate({ 'src/a.ts': 'a from T-2\n', 'docs/DECISIONS.md': '# Decisions\n\nT-2\n' });
  const calls: string[] = [];
  assert.throws(() => takeIn(s.paths, s.config, 'T-1', deps(calls), { actor: 'builder', by: 'builder:T-1', leave: true }), (e: unknown) => {
    assert.ok(e instanceof MergeConflict);
    assert.deepEqual(e.files, ['src/a.ts'], 'the decisions both added to are resolved; the code isn\'t');
    assert.match(e.message, /Conflicts with main in src\/a\.ts\. The merge is left in .* for you to resolve: fix each file, git add it, then git commit\. Nothing was pushed\./);
    return true;
  });
  assert.ok(mergingIn(s.wt), 'half merged, for the builder');
  assert.equal(head(s.wt), from);
  assert.match(readFileSync(join(s.wt, 'src/a.ts'), 'utf8'), /^<<<<<<< /m);
  assert.equal(readFileSync(join(s.wt, 'docs/DECISIONS.md'), 'utf8'), '# Decisions\n\nT-2\n\nT-1\n', 'the append-only file kept both');
  assert.ok(!calls.some((c) => c.includes('sh -c')), 'no tests on a merge that isn\'t made');
  assert.deepEqual(pushes(calls), []);
});

test('a person\'s acc refresh that conflicts puts the builder\'s worktree back as it was', () => {
  const s = setup();
  const from = write(s.wt, { 'src/a.ts': 'a from T-1\n' }, 'T-1: a');
  s.teammate({ 'src/a.ts': 'a from T-2\n' });
  const calls: string[] = [];
  assert.throws(() => takeIn(s.paths, s.config, 'T-1', deps(calls), { actor: 'human', by: 'human:jordan', leave: false }), (e: unknown) => {
    assert.ok(e instanceof MergeConflict);
    assert.deepEqual(e.files, ['src/a.ts']);
    assert.match(e.message, /The branch is as it was.*Its builder runs acc refresh in its worktree to resolve them there\./s);
    return true;
  });
  assert.ok(!mergingIn(s.wt));
  assert.equal(head(s.wt), from);
  assert.equal(gitIn(s.wt, 'status', '--porcelain'), '');
  assert.deepEqual(pushes(calls), []);
});

test('acc refresh is refused for a task its builder isn\'t working on, with uncommitted work, and when origin can\'t be fetched', () => {
  assert.deepEqual(TAKE_IN_STATES, ['running', 'rework', 'blocked']);
  const review = setup('review');
  assert.throws(() => takeIn(review.paths, review.config, 'T-1', deps([]), { actor: 'human', by: 'human:jordan', leave: false }), (e: unknown) => e instanceof AccError && e.code === 'refused' && /T-1 is review/.test(e.message));
  assert.throws(() => takeIn(review.paths, review.config, 'T-9', deps([]), { actor: 'human', by: 'human:jordan', leave: false }), (e: unknown) => e instanceof AccError && e.code === 'no-task');
  const s = setup();
  writeFileSync(join(s.wt, 'src/b.ts'), 'not committed\n');
  assert.throws(() => takeIn(s.paths, s.config, 'T-1', deps([]), { actor: 'builder', by: 'builder:T-1', leave: true }), /changes nobody committed\. Commit them first/);
  const gone = setup();
  gitIn(gone.root, 'remote', 'set-url', 'origin', join(tempDir(), 'missing'));
  assert.throws(() => takeIn(gone.paths, gone.config, 'T-1', deps([]), { actor: 'builder', by: 'builder:T-1', leave: true }), /Couldn't fetch main from origin, so nothing was merged/);
});

test('a project with no test checks for a builder takes the merge in and says none ran', () => {
  const s = setup();
  const config = parseConfig({ ...RAW, gates: { required: ['check'], commands: { check: 'true' } }, autopilot: { autoMerge: false } }).config as Config;
  assert.deepEqual(takeInGates(config, 'main'), [], 'auto-merge off: the full check is a builder\'s, and nothing names it a test check');
  assert.deepEqual(takeInGates(s.config, 'main'), ['near']);
  s.teammate({ 'src/a.ts': 'a from T-2\n' });
  const r = takeIn(s.paths, config, 'T-1', deps([]), { actor: 'builder', by: 'builder:T-1', leave: true });
  assert.ok(r.sha);
  assert.deepEqual(r.tests, []);
  assert.match(r.reason, /names no test checks for a builder, so none ran/);
});
