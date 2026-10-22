// acc team and acc refresh (T-103): the team as of now, in words and as JSON, and a builder taking merges
// into its own branch only.

import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from '../../core/src/exec.ts';
import { mutate, type Task } from '../../core/src/ledger.ts';
import { repoPaths } from '../../core/src/paths.ts';
import { GENERIC_CONFIG, gitIn, makeRepo, tempDir } from '../../core/test/support.ts';
import { cli } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));
const now = () => new Date('2026-10-22T12:00:00Z');

function task(id: string, state: Task['state'], extra: Partial<Task> = {}): Task {
  return { id, title: `Task ${id}`, brief: '', source: { kind: 'manual', key: id, url: null }, environment: 'main', deps: [], labels: [], state, blocker: null, run: null, pr: null, history: [], createdAt: '', updatedAt: '', ...extra };
}

/** T-1 and T-2 running, both changing src/a.ts; T-3 merged into main on origin since, changing src/a.ts too. */
function setup() {
  const origin = tempDir('origin-');
  gitIn(origin, 'init', '-q', '--bare', '-b', 'main');
  const root = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), '.gitignore': '.claude/\n', 'src/a.ts': 'a\n' }));
  gitIn(root, 'remote', 'add', 'origin', origin);
  gitIn(root, 'push', '-q', 'origin', 'main');
  const wts = ['T-1', 'T-2'].map((id) => {
    const wt = join(root, '.claude', 'worktrees', id);
    gitIn(root, 'worktree', 'add', '-q', '-b', `task/${id}`, wt, 'main');
    writeFileSync(join(wt, 'src', 'a.ts'), `a from ${id}\n`);
    gitIn(wt, 'commit', '-qam', `${id}: a`);
    return wt;
  });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'a from T-3\n');
  gitIn(root, 'commit', '-qam', 'Merge T-3: Another a');
  gitIn(root, 'push', '-q', 'origin', 'main');
  const tasks = [
    task('T-1', 'running', { run: { branch: 'task/T-1', worktree: wts[0] } }),
    task('T-2', 'running', { title: 'Rewrite a', run: { branch: 'task/T-2', worktree: wts[1] } }),
    task('T-3', 'done', { title: 'Another a' }),
  ];
  mutate(repoPaths(root, run), now, (l, emit) => {
    l.tasks.push(...tasks);
    for (const t of tasks) emit({ type: 'task.added', task: t.id, actor: 'human', by: 'human:test', data: {} });
  });
  return { root, wts };
}

test('acc team says a task\'s team as of now: sharing first, what merged since, and its JSON', () => {
  const s = setup();
  const words = acc(s.wts[0]!, ['team'], undefined, { ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.equal(words.code, 0, words.err);
  assert.match(words.out, /^T-1's team, as of now\. 1 merge behind main\./);
  assert.match(words.out, /### Sharing files with you\n\n- \*\*T-2\*\* \(being built, into `main`\): Rewrite a\n {2}- \*\*Shares with you:\*\* `src\/a\.ts`/);
  assert.match(words.out, /- \*\*T-3\*\*: Another a \([0-9a-f]{7}\): changed `src\/a\.ts`\. \*\*Shares with you:\*\* `src\/a\.ts`/);
  const json = acc(s.root, ['team', 'T-1', '--json']).json();
  assert.equal(json.task, 'T-1');
  assert.equal(json.behind, 1);
  assert.deepEqual(json.mates.map((m: { id: string; shares: string[] }) => [m.id, m.shares]), [['T-2', ['src/a.ts']]]);
  assert.deepEqual(json.landed.map((l: { task: string }) => l.task), ['T-3']);
  const none = acc(s.root, ['team', 'T-9']);
  assert.notEqual(none.code, 0, 'a task the ledger doesn\'t hold');
  assert.match(none.err, /No task T-9/);
  assert.notEqual(acc(s.root, ['team']).code, 0, 'a person names the task');
});

test('a builder\'s acc refresh is refused for another task\'s branch, and leaves a conflict in its own to resolve', () => {
  const s = setup();
  const other = acc(s.wts[0]!, ['refresh', 'T-2'], undefined, { ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.notEqual(other.code, 0);
  assert.match(other.err, /You're the builder for T-1: acc refresh takes merges into your own branch only/);
  const conflict = acc(s.wts[0]!, ['refresh'], undefined, { ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.notEqual(conflict.code, 0, 'T-3 changed the same line');
  assert.match(conflict.err, /Conflicts with main in src\/a\.ts\. The merge is left in/);
  assert.equal(run('git', ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { cwd: s.wts[0]! }).code, 0, 'left for the builder to resolve');
});
