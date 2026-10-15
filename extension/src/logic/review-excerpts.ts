// The lines of the change around each review finding (T-53): what a person reads on the task page, under
// the finding, before they open the file. The extension reads them with git in the task's checkout; the
// page only draws them. No vscode import, so it's testable against a real repository.

import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Finding } from '../../../packages/core/src/review.ts';

/** Runs git with an argument list in a folder. Never throws: a failure is a code that isn't 0. */
export type Git = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

/** One line of an excerpt: its number to show (null for a line the change removed), its mark, and its text. */
export interface ExcerptLine {
  n: number | null;
  mark: 'add' | 'del' | 'same';
  text: string;
  /** The finding's own line. */
  at: boolean;
}

/**
 * A finding's lines, and where they came from. diff: the change around its line. unchanged: no hunk holds
 * its line, so the file at the reviewed commit. removed: the change removed the file, so its removed lines.
 * The rest have no lines: outside, a path outside the checkout; gone, the checkout is gone; unread, git
 * couldn't read them at the reviewed commit.
 */
export interface Excerpt {
  kind: 'diff' | 'unchanged' | 'removed' | 'outside' | 'gone' | 'unread';
  lines: ExcerptLine[];
}

/** At most this many lines of the change around a finding's line. */
export const DIFF_LINES = 7;
/** At most this many lines of the file, when the change didn't touch the finding's line. */
export const FILE_LINES = 5;
/** A longer line is cut here, with an ellipsis: the excerpt is for reading, not a diff viewer. */
export const LINE_MAX = 240;

/**
 * Where a finding's file is in the checkout, or null when its path leads outside it: up with "..", an
 * absolute path elsewhere, or a link inside the checkout that points out of it.
 */
export function fileInCheckout(checkout: string, file: string): string | null {
  if (!file || file.includes('\0')) return null;
  const root = resolve(checkout);
  const path = resolve(root, file);
  const inside = (r: string, p: string) => {
    const rel = relative(r, p);
    return !!rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
  };
  if (!inside(root, path)) return null;
  // A link inside the checkout can point anywhere: where it leads must be inside too.
  if (existsSync(path)) {
    try {
      if (!inside(realpathSync(root), realpathSync(path))) return null;
    } catch {
      return null;
    }
  }
  return path;
}

/** The file's path as git names it in the repository: from the checkout's root, with forward slashes. */
const repoPath = (checkout: string, path: string): string => relative(resolve(checkout), path).split(sep).join('/');

const cut = (text: string): string => (text.length > LINE_MAX ? `${text.slice(0, LINE_MAX - 1)}…` : text);

/** Up to `n` items of a list around index `i`, as close to the middle as its ends allow. */
export function around<T>(list: T[], i: number, n: number): T[] {
  const start = Math.max(0, Math.min(i - Math.floor((n - 1) / 2), list.length - n));
  return list.slice(start, start + n);
}

interface DiffLine { mark: ExcerptLine['mark']; text: string; old: number | null; now: number | null }
interface FileDiff { removed: boolean; hunks: DiffLine[][] }

/** One file's diff, as git prints it, read into its hunks: each line with its number before and after. */
export function parseDiff(out: string): FileDiff {
  const hunks: DiffLine[][] = [];
  let removed = false;
  let hunk: DiffLine[] | null = null;
  let old = 0;
  let now = 0;
  for (const line of out.split('\n')) {
    const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (head) {
      hunk = [];
      hunks.push(hunk);
      old = Number(head[1]);
      now = Number(head[2]);
      continue;
    }
    if (!hunk) {
      if (line.startsWith('deleted file mode')) removed = true;
      continue;
    }
    // "\ No newline at end of file" belongs to the line before it.
    if (line.startsWith('\\')) continue;
    const c = line[0];
    if (c === '+') hunk.push({ mark: 'add', text: line.slice(1), old: null, now: now++ });
    else if (c === '-') hunk.push({ mark: 'del', text: line.slice(1), old: old++, now: null });
    else if (c === ' ') hunk.push({ mark: 'same', text: line.slice(1), old: old++, now: now++ });
    // The next file's header, or the output's end, closes the hunk.
    else hunk = null;
  }
  return { removed, hunks };
}

/** The line a finding names, as a whole number from 1, or null. */
const lineOf = (f: Pick<Finding, 'line'>): number | null => (typeof f.line === 'number' && Number.isInteger(f.line) && f.line >= 1 ? f.line : null);

/**
 * The merge base of the reviewed commit and the environment's branch: its own, else origin's copy's.
 * Null when git finds neither.
 */
export async function mergeBase(git: Git, checkout: string, branch: string, sha: string): Promise<string | null> {
  for (const ref of [`origin/${branch}`, branch]) {
    const r = await git(['merge-base', ref, sha], checkout);
    if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

/**
 * Each finding's excerpt, in the findings' order: null for one with no file or line. The change is
 * `git diff <base>...<sha> -- <file>` in the task's checkout, read once a file. A line inside a hunk shows
 * at most DIFF_LINES of it; a line no hunk holds shows at most FILE_LINES of the file at the sha. A path
 * outside the checkout is never read. With no checkout, or no base, there are no lines.
 */
export async function reviewExcerpts(git: Git, checkout: string, base: string | null, sha: string, findings: readonly Pick<Finding, 'file' | 'line'>[]): Promise<(Excerpt | null)[]> {
  const there = existsSync(checkout);
  const diffs = new Map<string, Promise<FileDiff | null>>();
  const diffOf = (file: string) => {
    if (!diffs.has(file)) diffs.set(file, git(['diff', '--no-color', '--no-ext-diff', '-U3', `${base}...${sha}`, '--', file], checkout).then((r) => (r.code === 0 ? parseDiff(r.stdout) : null)));
    return diffs.get(file)!;
  };
  const out: (Excerpt | null)[] = [];
  for (const f of findings) {
    const line = lineOf(f);
    if (!f.file || line === null) { out.push(null); continue; }
    if (!there) { out.push({ kind: 'gone', lines: [] }); continue; }
    const path = fileInCheckout(checkout, f.file);
    if (!path) { out.push({ kind: 'outside', lines: [] }); continue; }
    if (!base) { out.push({ kind: 'unread', lines: [] }); continue; }
    const file = repoPath(checkout, path);
    const diff = await diffOf(file);
    if (!diff) { out.push({ kind: 'unread', lines: [] }); continue; }
    out.push(diff.removed ? removedLines(diff, line) : changedLines(diff, line) ?? await fileLines(git, checkout, sha, file, line));
  }
  return out;
}

/** The change around a line, numbered as the reviewed commit numbers it, or null when no hunk holds it. */
function changedLines(diff: FileDiff, line: number): Excerpt | null {
  for (const hunk of diff.hunks) {
    const i = hunk.findIndex((l) => l.now === line);
    if (i < 0) continue;
    return { kind: 'diff', lines: around(hunk, i, DIFF_LINES).map((l) => ({ n: l.now, mark: l.mark, text: cut(l.text), at: l.now === line })) };
  }
  return null;
}

/** A removed file's lines around the line, numbered as they were. A line past its end shows none. */
function removedLines(diff: FileDiff, line: number): Excerpt {
  const all = diff.hunks.flat();
  const i = all.findIndex((l) => l.old === line);
  return { kind: 'removed', lines: i < 0 ? [] : around(all, i, DIFF_LINES).map((l) => ({ n: l.old, mark: l.mark, text: cut(l.text), at: l.old === line })) };
}

/** The file at the sha around a line the change didn't touch. Unread when git can't show it, or the line is past its end. */
async function fileLines(git: Git, checkout: string, sha: string, file: string, line: number): Promise<Excerpt> {
  const r = await git(['show', `${sha}:${file}`], checkout);
  if (r.code !== 0) return { kind: 'unread', lines: [] };
  const text = r.stdout.endsWith('\n') ? r.stdout.slice(0, -1) : r.stdout;
  const all = text.split('\n').map((t, i) => ({ n: i + 1, t }));
  if (line > all.length) return { kind: 'unread', lines: [] };
  return { kind: 'unchanged', lines: around(all, line - 1, FILE_LINES).map((l) => ({ n: l.n, mark: 'same' as const, text: cut(l.t), at: l.n === line })) };
}
