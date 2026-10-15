// The lines of the change around each review finding (T-53), read with git in a real repository: a line
// inside a hunk, one outside any, a file the change removed, a file not in the change, a path outside the
// checkout, and a checkout that's gone. git itself is the oracle: the repository holds the right lines.
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { gitIn, makeRepo, tempDir } from '../../packages/core/test/support.ts';
import { around, DIFF_LINES, type Excerpt, FILE_LINES, fileInCheckout, type Git, LINE_MAX, mergeBase, parseDiff, reviewExcerpts } from '../src/logic/review-excerpts.ts';
import { runFile } from '../src/run.ts';

const git: Git = (args, cwd) => runFile('git', args, cwd);
const lines = (n: number, name: string) => Array.from({ length: n }, (_, i) => `${name} ${i + 1}`).join('\n') + '\n';

/**
 * A repository on main with three files, and a task branch that changes line 10 of a.ts (and adds a line
 * after 12), removes gone.ts, and leaves same.ts as it was. Returns the checkout, its base and the sha.
 */
async function sample(): Promise<{ dir: string; base: string; sha: string }> {
  const dir = makeRepo({ 'src/a.ts': lines(20, 'a'), 'src/gone.ts': lines(10, 'gone'), 'src/same.ts': lines(10, 'same') });
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-9');
  const a = lines(20, 'a').split('\n');
  a[9] = 'a 10 changed';
  a.splice(12, 0, 'a new after 12');
  writeFileSync(join(dir, 'src/a.ts'), a.join('\n'));
  rmSync(join(dir, 'src/gone.ts'));
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'the change');
  // main moves on after the branch started: the merge base, not main's tip, is what the change is read against.
  gitIn(dir, 'checkout', '-q', 'main');
  writeFileSync(join(dir, 'src/same.ts'), lines(12, 'same'));
  gitIn(dir, 'commit', '-q', '-am', 'main moves on');
  gitIn(dir, 'checkout', '-q', 'task/T-9');
  const sha = gitIn(dir, 'rev-parse', 'HEAD');
  const base = await mergeBase(git, dir, 'main', sha);
  assert.ok(base);
  return { dir, base, sha };
}

let read = 0;
/** Reads the findings' excerpts, counting each finding read, so the file fails if it read none. */
async function excerpts(dir: string, base: string | null, sha: string, findings: { file?: string; line?: number }[]): Promise<(Excerpt | null)[]> {
  const out = await reviewExcerpts(git, dir, base, sha, findings);
  read += out.length;
  return out;
}

test('a line inside a hunk shows at most 7 lines of the change around it, with what was added and removed', async () => {
  const { dir, base, sha } = await sample();
  const [x] = await excerpts(dir, base, sha, [{ file: 'src/a.ts', line: 10 }]);
  assert.equal(x?.kind, 'diff');
  assert.ok(x.lines.length <= DIFF_LINES && x.lines.length > 0);
  const at = x.lines.find((l) => l.at)!;
  assert.deepEqual(at, { n: 10, mark: 'add', text: 'a 10 changed', at: true });
  assert.deepEqual(x.lines.find((l) => l.mark === 'del'), { n: null, mark: 'del', text: 'a 10', at: false }, 'the removed line has no number at the sha');
  assert.ok(x.lines.some((l) => l.mark === 'same' && l.n === 9 && l.text === 'a 9'), 'with the unchanged line before it, numbered');
});

test('edge case: a line outside any hunk shows at most 5 lines of the file at the sha, as unchanged code', async () => {
  const { dir, base, sha } = await sample();
  const [top, end] = await excerpts(dir, base, sha, [{ file: 'src/a.ts', line: 1 }, { file: 'src/a.ts', line: 21 }]);
  assert.equal(top?.kind, 'unchanged');
  assert.deepEqual(top.lines.map((l) => [l.n, l.text, l.at]), [[1, 'a 1', true], [2, 'a 2', false], [3, 'a 3', false], [4, 'a 4', false], [5, 'a 5', false]]);
  assert.equal(top.lines.length, FILE_LINES);
  assert.equal(end?.kind, 'unchanged', 'the last line of the file at the sha, which moved down one');
  assert.deepEqual(end.lines.map((l) => l.n), [17, 18, 19, 20, 21]);
  assert.equal(end.lines.at(-1)!.text, 'a 20');
});

test('edge case: a file the change removed shows its removed lines, numbered as they were', async () => {
  const { dir, base, sha } = await sample();
  const [x] = await excerpts(dir, base, sha, [{ file: 'src/gone.ts', line: 4 }]);
  assert.equal(x?.kind, 'removed');
  assert.ok(x.lines.length <= DIFF_LINES);
  assert.ok(x.lines.every((l) => l.mark === 'del'));
  assert.deepEqual(x.lines.find((l) => l.at), { n: 4, mark: 'del', text: 'gone 4', at: true });
  const [past] = await excerpts(dir, base, sha, [{ file: 'src/gone.ts', line: 99 }]);
  assert.deepEqual(past, { kind: 'removed', lines: [] }, 'a line past its end shows none');
});

test('edge case: a file not in the change shows the file at the sha, not main\'s newer copy', async () => {
  const { dir, base, sha } = await sample();
  const [x] = await excerpts(dir, base, sha, [{ file: 'src/same.ts', line: 10 }]);
  assert.equal(x?.kind, 'unchanged');
  assert.deepEqual(x.lines.map((l) => l.text), ['same 6', 'same 7', 'same 8', 'same 9', 'same 10'], 'the sha has 10 lines; main has 12');
});

test('edge case: a path outside the checkout is refused, and never read', async () => {
  const { dir, base, sha } = await sample();
  const outside = tempDir();
  writeFileSync(join(outside, 'secret.ts'), 'secret\n');
  mkdirSync(join(dir, 'links'));
  symlinkSync(outside, join(dir, 'links', 'out'));
  for (const file of ['../secret.ts', join(outside, 'secret.ts'), 'links/out/secret.ts', '..', 'src/../../x.ts', '']) assert.equal(fileInCheckout(dir, file), null, file);
  assert.equal(fileInCheckout(dir, 'src/a.ts'), join(dir, 'src', 'a.ts'));
  assert.equal(fileInCheckout(dir, './src/../src/a.ts'), join(dir, 'src', 'a.ts'), 'a path that stays inside is taken');
  assert.equal(fileInCheckout(dir, 'src/new.ts'), join(dir, 'src', 'new.ts'), 'a file not there yet is still inside');
  const got = await excerpts(dir, base, sha, [{ file: '../secret.ts', line: 1 }, { file: 'links/out/secret.ts', line: 1 }]);
  assert.deepEqual(got, [{ kind: 'outside', lines: [] }, { kind: 'outside', lines: [] }]);
});

test('edge case: a missing checkout reads nothing, and a finding with no file or line has no excerpt', async () => {
  const gone = join(tempDir(), 'removed-checkout');
  let asked = 0;
  const counting: Git = (args, cwd) => { asked++; return git(args, cwd); };
  const out = await reviewExcerpts(counting, gone, 'abc1234', 'def5678', [{ file: 'src/a.ts', line: 3 }, { file: 'src/a.ts' }, { line: 3 }, {}]);
  read += out.length;
  assert.deepEqual(out, [{ kind: 'gone', lines: [] }, null, null, null]);
  assert.equal(asked, 0, 'git is never asked');
});

test('edge case: with no merge base, or a commit git doesn\'t have, the lines are unread', async () => {
  const { dir, base, sha } = await sample();
  assert.deepEqual(await excerpts(dir, null, sha, [{ file: 'src/a.ts', line: 10 }]), [{ kind: 'unread', lines: [] }]);
  assert.deepEqual(await excerpts(dir, base, '0000000000000000000000000000000000000000', [{ file: 'src/a.ts', line: 10 }]), [{ kind: 'unread', lines: [] }]);
  assert.equal(await mergeBase(git, dir, 'no-such-branch', sha), null);
});

test('edge case: git is asked for each file\'s diff once, however many findings it has', async () => {
  const { dir, base, sha } = await sample();
  const diffs: string[] = [];
  const counting: Git = (args, cwd) => { if (args[0] === 'diff') diffs.push(args.at(-1)!); return git(args, cwd); };
  const out = await reviewExcerpts(counting, dir, base, sha, [{ file: 'src/a.ts', line: 10 }, { file: 'src/a.ts', line: 13 }, { file: 'src/gone.ts', line: 1 }]);
  read += out.length;
  assert.deepEqual(diffs, ['src/a.ts', 'src/gone.ts']);
  assert.deepEqual(out[1]!.lines.find((l) => l.at), { n: 13, mark: 'add', text: 'a new after 12', at: true });
});

test('the diff reader numbers each line before and after, and skips git\'s no-newline note', () => {
  const d = parseDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -3,2 +3,2 @@ f()\n same\n-old\n\\ No newline at end of file\n+new\n');
  assert.equal(d.removed, false);
  assert.deepEqual(d.hunks, [[{ mark: 'same', text: 'same', old: 3, now: 3 }, { mark: 'del', text: 'old', old: 4, now: null }, { mark: 'add', text: 'new', old: null, now: 4 }]]);
  assert.equal(parseDiff('diff --git a/x b/x\ndeleted file mode 100644\n@@ -1 +0,0 @@\n-x\n').removed, true);
  assert.deepEqual(parseDiff(''), { removed: false, hunks: [] });
});

test('around keeps the line as near the middle as the list\'s ends allow, and a long line is cut', async () => {
  const ten = [...Array(10).keys()];
  assert.deepEqual(around(ten, 5, 7), [2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(around(ten, 0, 7), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(around(ten, 9, 5), [5, 6, 7, 8, 9]);
  assert.deepEqual(around([1, 2], 1, 7), [1, 2], 'a list shorter than the window is whole');
  const dir = makeRepo({ 'long.ts': `${'x'.repeat(LINE_MAX * 2)}\n` });
  const sha = gitIn(dir, 'rev-parse', 'HEAD');
  const [x] = await excerpts(dir, sha, sha, [{ file: 'long.ts', line: 1 }]);
  assert.equal(x?.lines[0]!.text.length, LINE_MAX);
  assert.ok(x.lines[0]!.text.endsWith('…'));
});

test('it read findings: a run that read none fails', () => {
  assert.ok(read >= 15, `read ${read} findings`);
});
