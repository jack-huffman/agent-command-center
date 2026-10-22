/**
 * Decisions, one file each (T-102). A repo that keeps them in `docs/decisions/` names each
 * `D-NNN-<slug>.md`. A task branch adds `new-<task>-<slug>.md` and calls it `D-<task>` (D-T-97), so two
 * branches never pick the same number or append to the same file. At merge, numberDecisions gives each new
 * file the next free number, renames it, and writes the number over `D-<task>` in the lines the branch added
 * or changed, and nowhere else. `docs/DECISIONS.md` is an index made from the folder, never edited by hand.
 * A repo with no `docs/decisions/` has nothing to number.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from './atomic.ts';
import { AccError, type RunResult, type Runner } from './exec.ts';

/** Where the decisions live, from the checkout's top. */
export const DECISIONS_DIR = 'docs/decisions';
/** The index made from them. */
export const DECISIONS_INDEX = 'docs/DECISIONS.md';

const NUMBERED = /^D-(\d{3,})-([a-z0-9][a-z0-9-]*)\.md$/;
const NEW = /^new-([A-Z][A-Z0-9_]*-\d+)-([a-z0-9][a-z0-9-]*)\.md$/;
/** A decision's heading: `## D-NNN <title> (<yyyy-mm-dd>)`, or `## D-<task> …` before it has a number. */
const HEADING = /^## (D-(?:\d{3,}|[A-Z][A-Z0-9_]*-\d+)) (.+?)(?: \((\d{4}-\d{2}-\d{2})\))?$/;

/** What a decision file's name says: its number, or the task that added it before the merge numbered it. */
export interface DecisionName {
  file: string;
  number: number | null;
  task: string | null;
  slug: string;
}

/** A file name in the folder, read; null for anything that isn't a decision's. */
export function parseDecisionName(file: string): DecisionName | null {
  const n = NUMBERED.exec(file);
  if (n) return { file, number: Number(n[1]), task: null, slug: n[2]! };
  const t = NEW.exec(file);
  return t ? { file, number: null, task: t[1]!, slug: t[2]! } : null;
}

/** A decision's id from its number: D-007, D-196. */
export const decisionId = (n: number): string => `D-${String(n).padStart(3, '0')}`;

/** A file name's slug from a title: lower case, words joined by dashes, cut at a word under 60 characters. */
export function decisionSlug(title: string): string {
  const words = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  let slug = '';
  for (const w of words) {
    const next = slug ? `${slug}-${w}` : w;
    if (next.length > 60 && slug) break;
    slug = next;
  }
  return slug || 'decision';
}

/** One numbered decision, as the index lists it. */
export interface DecisionEntry {
  number: number;
  title: string;
  date: string | null;
  file: string;
}

/** A decision's heading, from its file's first line: null when that isn't one. */
export function decisionHeading(text: string): { id: string; title: string; date: string | null } | null {
  const m = HEADING.exec(text.split('\n', 1)[0] ?? '');
  return m ? { id: m[1]!, title: m[2]!, date: m[3] ?? null } : null;
}

/**
 * The numbered decisions in a checkout's folder, by number. A file whose heading doesn't carry its own
 * number, or two files with one number, is an error: the index would name the wrong decision.
 */
export function readDecisions(root: string): DecisionEntry[] {
  const dir = join(root, DECISIONS_DIR);
  if (!existsSync(dir)) return [];
  const out: DecisionEntry[] = [];
  for (const file of readdirSync(dir).sort()) {
    const name = parseDecisionName(file);
    if (name?.number == null) continue;
    const h = decisionHeading(readFileSync(join(dir, file), 'utf8'));
    if (!h || h.id !== decisionId(name.number)) throw new AccError('bad-decision', `${DECISIONS_DIR}/${file} doesn't start with "## ${decisionId(name.number)} <title> (<date>)".`);
    out.push({ number: name.number, title: h.title, date: h.date, file });
  }
  out.sort((a, b) => a.number - b.number);
  const twice = out.filter((e, i) => i && out[i - 1]!.number === e.number).map((e) => decisionId(e.number));
  if (twice.length) throw new AccError('bad-decision', `Two decisions share a number in ${DECISIONS_DIR}: ${[...new Set(twice)].join(', ')}. acc decisions number gives a branch's own the next free one.`);
  return out;
}

export const DECISIONS_HEADER = `# Decisions

<!-- Made from docs/decisions/ by acc decisions index. Don't edit it: a test fails when it's stale. -->

Each decision is a file in [decisions/](decisions/), and records what was decided and why, so later
changes can see what they are overturning. A task adds \`decisions/new-<task>-<slug>.md\` and calls it
\`D-<task>\`. At merge, acc gives it the next free number.
`;

const cell = (s: string): string => s.replace(/\|/g, '\\|');

/** The index's text: a row a decision, by number, linking its file. */
export function decisionsIndex(entries: DecisionEntry[]): string {
  const rows = entries.map((e) => `| [${decisionId(e.number)}](decisions/${e.file}) | ${cell(e.title)} | ${e.date ?? ''} |`);
  return `${DECISIONS_HEADER}\n| Decision | Title | Date |\n| --- | --- | --- |\n${rows.join('\n')}\n`;
}

/** The index a checkout's folder makes, or null when it keeps no decisions folder. */
export const decisionsIndexFor = (root: string): string | null => (existsSync(join(root, DECISIONS_DIR)) ? decisionsIndex(readDecisions(root)) : null);

/** Writes the index when it changed. True when it did. */
export function writeDecisionsIndex(root: string): boolean {
  const text = decisionsIndexFor(root);
  const file = join(root, DECISIONS_INDEX);
  if (text === null || (existsSync(file) && readFileSync(file, 'utf8') === text)) return false;
  writeAtomic(file, text);
  return true;
}

// ---------------------------------------------------------------- numbering at merge

/** One decision a merge numbered: its file before and after, and the id it was called by before. */
export interface Renumbered {
  from: string;
  to: string;
  was: string;
  id: string;
}

const git = (run: Runner, cwd: string, ...args: string[]): RunResult => run('git', args, { cwd });
const ok = (r: RunResult, what: string): string => {
  if (r.code !== 0) throw new AccError('decisions', `${what}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
  return r.stdout;
};

/**
 * What a branch's merge into `base` would number: each decision file the branch added that is still
 * `new-<task>-…`, and each it numbered that `base` has since given to another file. In file-name order,
 * from one past the highest number either side uses. Empty when there's nothing to do.
 */
export function decisionsToNumber(run: Runner, root: string, base: string, head = 'HEAD'): Renumbered[] {
  const mb = git(run, root, 'merge-base', base, head).stdout.trim();
  if (!mb) throw new AccError('decisions', `${head} and ${base} share no history.`);
  const listAt = (ref: string) => git(run, root, 'ls-tree', '--name-only', `${ref}:${DECISIONS_DIR}`).stdout.split('\n').filter(Boolean);
  const onBase = new Map(listAt(base).flatMap((f) => {
    const n = parseDecisionName(f);
    return n?.number != null ? [[n.number, f] as const] : [];
  }));
  const added = git(run, root, 'diff', '--name-only', '--no-renames', '--diff-filter=A', mb, head, '--', DECISIONS_DIR).stdout.split('\n').filter(Boolean)
    .map((p) => parseDecisionName(p.slice(DECISIONS_DIR.length + 1))).filter((n): n is DecisionName => !!n).sort((a, b) => a.file.localeCompare(b.file));
  const taken = (n: DecisionName) => n.number !== null && onBase.has(n.number) && onBase.get(n.number) !== n.file;
  const todo = added.filter((n) => n.number === null || taken(n));
  if (!todo.length) return [];
  const used = [...onBase.keys(), ...added.filter((n) => n.number !== null && !taken(n)).map((n) => n.number!)];
  let next = Math.max(0, ...used) + 1;
  return todo.map((n) => {
    const id = decisionId(next++);
    return { from: n.file, to: `${id}-${n.slug}.md`, was: n.task ? `D-${n.task}` : decisionId(n.number!), id };
  });
}

/**
 * What a numbering on `branch` itself counts against: where `branch` is checked out at a merge commit, the
 * merge's first parent, which is the branch as it was before the merge. So two pull requests landed against
 * one base, and given one number each before either merged, are numbered again at the second's merge: the
 * number the first took is taken. Null anywhere else, where the base is `branch` itself.
 */
export function mergedOnto(run: Runner, root: string, branch: string): string | null {
  if (git(run, root, 'symbolic-ref', '--quiet', '--short', 'HEAD').stdout.trim() !== branch) return null;
  const parents = git(run, root, 'rev-list', '--parents', '-n', '1', 'HEAD').stdout.trim().split(/\s+/).slice(1);
  return parents.length > 1 ? parents[0]! : null;
}

/** The lines each file's diff from `from` adds or changes, by path, numbered from 1 in the file as it is now. */
function addedLines(run: Runner, root: string, from: string): Map<string, Set<number>> {
  const diff = ok(git(run, root, 'diff', '-U0', '--no-renames', '--no-color', '--no-ext-diff', from, 'HEAD'), 'git couldn\'t read what the branch changed');
  const out = new Map<string, Set<number>>();
  let file: string | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) file = line === '+++ /dev/null' ? null : line.slice(6);
    else if (file && line.startsWith('@@')) {
      const m = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!m) continue;
      const [start, count] = [Number(m[1]), m[2] === undefined ? 1 : Number(m[2])];
      const set = out.get(file) ?? new Set<number>();
      for (let i = 0; i < count; i++) set.add(start + i);
      out.set(file, set);
    }
  }
  return out;
}

/** `D-T-97` or `D-196` as a whole id: not inside a longer one, such as D-T-970 or XD-196. */
const idPattern = (ids: string[]): RegExp => new RegExp(`(?<![\\w-])(${ids.map((i) => i.replace(/[-]/g, '\\-')).join('|')})(?![\\w]|-\\d)`, 'g');

/**
 * Numbers a branch's new decisions, in a clean checkout on that branch, against `base` (T-102): renames each
 * file, writes its number over its old id in the lines the branch added or changed since it left `base`,
 * writes the index again, and commits that as one commit with `commit`'s git (the repo's identity). Null when
 * there was nothing to number. Anything that stops it leaves the checkout as it was.
 */
export function numberDecisions(run: Runner, root: string, base: string, commit: (...args: string[]) => RunResult): { sha: string; numbered: Renumbered[] } | null {
  const numbered = decisionsToNumber(run, root, base);
  if (!numbered.length) return null;
  if (git(run, root, 'status', '--porcelain', '--untracked-files=no').stdout.trim()) throw new AccError('decisions', `${root} has changes nobody committed: commit them before numbering its decisions.`);
  const from = git(run, root, 'rev-parse', 'HEAD').stdout.trim();
  const mb = git(run, root, 'merge-base', base, 'HEAD').stdout.trim();
  const ids = new Map(numbered.map((n) => [n.was, n.id]));
  const pattern = idPattern([...ids.keys()]);
  try {
    for (const [path, lines] of addedLines(run, root, mb)) {
      const file = join(root, path);
      if (!existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      if (text.includes('\0')) continue;
      const split = text.split('\n');
      let changed = false;
      for (const n of lines) {
        const line = split[n - 1];
        if (line === undefined) continue;
        const now = line.replace(pattern, (id) => ids.get(id) ?? id);
        if (now !== line) [split[n - 1], changed] = [now, true];
      }
      if (changed) writeFileSync(file, split.join('\n'));
    }
    for (const n of numbered) ok(git(run, root, 'mv', `${DECISIONS_DIR}/${n.from}`, `${DECISIONS_DIR}/${n.to}`), `git couldn't rename ${n.from}`);
    // The index is staged even when this commit makes it.
    if (writeDecisionsIndex(root)) ok(git(run, root, 'add', '--', DECISIONS_INDEX), 'git couldn\'t stage the index');
    ok(git(run, root, 'add', '-u'), 'git couldn\'t stage the numbering');
    ok(commit('commit', '-q', '-m', numberedMessage(numbered)), 'The numbering commit was refused');
  } catch (e) {
    git(run, root, 'reset', '-q', '--hard', from);
    throw e;
  }
  return { sha: git(run, root, 'rev-parse', 'HEAD').stdout.trim(), numbered };
}

/** What a numbering says, in a commit and in a step's reason: "D-T-97 is D-196". */
export const numberedWords = (numbered: Renumbered[]): string => numbered.map((n) => `${n.was} is ${n.id}`).join(', ');

const numberedMessage = (numbered: Renumbered[]): string => `Number the decisions this branch adds: ${numberedWords(numbered)}`;
