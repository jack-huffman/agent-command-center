/**
 * Environment branches on GitHub, watched (GH-69): on every sync of a project that opted in to cloud
 * builders, acc looks at each environment's branch on origin and flags one that moved by anything but a
 * merge acc knows of, as a notice needing a person. A cloud builder can't push an environment branch past
 * the repo's guard, but a person or something else might, and the ledger would never hear of it
 * otherwise. A move is acc's own when its commit is a merge acc recorded, by its sha: the commit a pull
 * request's merge left on the base (sync's `mergeCommit.oid`), a merge commit whose second parent is a head
 * acc landed, or a rebased copy of the branch's commits (`git cherry`). GitHub's squash subject, "Title
 * (#N)", is kept only as a fallback for a squash whose sha sync hasn't recorded; a pushed commit that
 * merely mentions a number is never explained by it. Nothing here changes a branch.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.ts';
import type { Runner } from './exec.ts';
import { type Ledger, writeAtomic } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { fetchBranches } from './sync.ts';
import { remoteHead } from './cloud.ts';

export interface BranchMove {
  branch: string;
  from: string;
  to: string;
  at: string;
  /** Each commit that came in and isn't acc's merge, newest first, as `abc1234 subject`; empty when git couldn't list them. */
  commits: string[];
}

export interface BranchRecord {
  /** origin's head when acc last looked, and when. */
  head: string;
  at: string;
  /** A move nobody has explained, until a person clears it: acc sync --branches-seen. */
  moved: BranchMove | null;
}

export const branchesPath = (paths: Pick<RepoPaths, 'stateDir'>): string => join(paths.stateDir, 'branches.json');

/** What acc last saw of each environment branch, by branch. */
export function readBranches(paths: Pick<RepoPaths, 'stateDir'>): Record<string, BranchRecord> {
  const file = branchesPath(paths);
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, BranchRecord>;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeBranches(paths: Pick<RepoPaths, 'stateDir'>, records: Record<string, BranchRecord>): void {
  mkdirSync(paths.stateDir, { recursive: true });
  writeAtomic(branchesPath(paths), JSON.stringify(records, null, 2) + '\n');
}

/** The moves still waiting for a person, across every environment branch. */
export const branchMoves = (paths: Pick<RepoPaths, 'stateDir'>): BranchMove[] => Object.values(readBranches(paths)).flatMap((r) => (r.moved ? [r.moved] : []));

// ---------------------------------------------------------------- what acc merged

/** A merge acc knows of: a task's pull request, a promotion's, or one autopilot merged. */
export interface KnownMerge {
  number: number;
  /** The commit its merge left on the base, as sync read it from GitHub: a merge commit, a squash, or the last rebased commit. */
  mergeSha?: string;
  /** The head acc landed, or autopilot merged: a merge commit's second parent. */
  head?: string;
  /** The branch it merged, whose commits a rebase copied. */
  branch?: string;
}

/** The merges the ledger knows: each task's pull request, each promotion's, and each autopilot merged (D-055). */
export function knownMerges(ledger: Pick<Ledger, 'tasks'>): KnownMerge[] {
  const out: KnownMerge[] = [];
  for (const t of ledger.tasks) {
    if (t.pr?.number) out.push({ number: t.pr.number, ...(t.pr.mergeSha ? { mergeSha: t.pr.mergeSha } : {}), ...(t.pr.sha ? { head: t.pr.sha } : {}), ...(t.run?.branch ? { branch: t.run.branch } : {}) });
    const m = t.autopilot?.merged;
    if (m) out.push({ number: m.pr.number, head: m.sha, ...(t.run?.branch ? { branch: t.run.branch } : {}) });
    for (const p of t.promotions ?? []) out.push({ number: p.pr.number, ...(p.mergeSha ? { mergeSha: p.mergeSha } : {}), branch: p.from });
  }
  return out;
}

/** The pull request a squash merge's subject names, as GitHub writes it, "Title (#12)"; null for any other subject. */
export function squashOf(subject: string): number | null {
  const m = /\(#(\d+)\)\s*$/.exec(subject.trim());
  return m ? Number(m[1]) : null;
}

/** One commit on the base's first-parent line, as `git log` gives it. */
export interface BaseCommit {
  sha: string;
  parents: string[];
  subject: string;
}

/** `abc1234 subject`, for a notice. */
export const commitWords = (c: BaseCommit): string => `${c.sha.slice(0, 7)} ${c.subject}`;

/**
 * The commits between two heads of a base branch that aren't acc's merges, newest first, read along the
 * first-parent line so a merge counts once, as its merge commit, and never as the branch's own commits.
 * `listed` is false when git couldn't list them: a force push, a rewrite, or an old head that's gone.
 */
export function unexplained(run: Runner, root: string, prev: string, head: string, known: KnownMerge[]): { listed: boolean; commits: BaseCommit[] } {
  // A head the old one doesn't lead to is a rewrite: nothing between them can be listed as a move forward.
  if (run('git', ['merge-base', '--is-ancestor', prev, head], { cwd: root }).code !== 0) return { listed: false, commits: [] };
  const log = run('git', ['log', '--first-parent', '--format=%H%x00%P%x00%s', `${prev}..${head}`], { cwd: root });
  if (log.code !== 0) return { listed: false, commits: [] };
  const commits: BaseCommit[] = log.stdout.split('\n').filter(Boolean).map((l) => {
    const [sha = '', parents = '', ...rest] = l.split('\0');
    return { sha, parents: parents.split(' ').filter(Boolean), subject: rest.join('\0').trim() };
  });
  const merges = new Set(known.flatMap((k) => (k.mergeSha ? [k.mergeSha] : [])));
  const heads = new Set(known.flatMap((k) => (k.head ? [k.head] : [])));
  const numbers = new Set(known.map((k) => k.number));
  const explained = new Set<string>();
  for (const c of commits) {
    // Its sha is what sync read as the merge's commit, or it merges a head acc landed.
    if (merges.has(c.sha) || c.parents.slice(1).some((p) => heads.has(p))) explained.add(c.sha);
    // GitHub's squash subject, for a squash sync hasn't recorded yet; never a merge commit, never a plain mention.
    else if (c.parents.length === 1) {
      const n = squashOf(c.subject);
      if (n !== null && numbers.has(n)) explained.add(c.sha);
    }
  }
  // What's left may be a rebase merge: the branch's commits copied onto the base, with new shas but the
  // same patches. git cherry marks each commit in the range that has an equivalent on the branch.
  const left = () => commits.filter((c) => !explained.has(c.sha));
  if (left().length) {
    const branches = [...new Set(known.flatMap((k) => (k.branch ? [k.branch] : [])))];
    for (const branch of branches) {
      const ref = ['refs/heads', 'refs/remotes/origin'].map((p) => `${p}/${branch}`).find((r) => run('git', ['rev-parse', '--verify', '--quiet', r], { cwd: root }).code === 0);
      if (!ref) continue;
      const cherry = run('git', ['cherry', ref, head, prev], { cwd: root });
      if (cherry.code !== 0) continue;
      for (const line of cherry.stdout.split('\n')) {
        const m = /^-\s+([0-9a-f]{40,64})$/.exec(line.trim());
        if (m) explained.add(m[1]!);
      }
      if (!left().length) break;
    }
  }
  return { listed: true, commits: left() };
}

/**
 * Looks at each environment branch on origin, and records a move nobody explains (GH-69). The first look
 * at a branch only records where it stands. A move whose every first-parent commit is a merge acc knows
 * passes quietly; any other is kept as a notice until a person clears it. origin not answering for a
 * branch leaves its record as it was. Returns the moves found on this look; branchMoves gives every move
 * still waiting.
 */
export function followBranches(paths: RepoPaths, config: Pick<Config, 'environments'>, ledger: Pick<Ledger, 'tasks'>, deps: { run: Runner; now: () => Date; env: NodeJS.ProcessEnv }): BranchMove[] {
  const { run, now, env } = deps;
  const records = readBranches(paths);
  const known = knownMerges(ledger);
  const at = now().toISOString();
  const moves: BranchMove[] = [];
  let changed = false;
  for (const e of config.environments) {
    const head = remoteHead(run, paths.root, e.branch, env);
    if (!head) continue;
    const prev = records[e.branch];
    if (!prev) {
      records[e.branch] = { head, at, moved: null };
      changed = true;
      continue;
    }
    if (prev.head === head) continue;
    // The commits that came in, from this clone's view of origin once fetched; none when the old head is gone.
    const fetched = fetchBranches(run, paths.root, [e.branch], { ...env, GIT_TERMINAL_PROMPT: '0' });
    const found = fetched ? unexplained(run, paths.root, prev.head, head, known) : { listed: false, commits: [] };
    const ours = found.listed && found.commits.length === 0;
    const move: BranchMove | null = ours ? prev.moved : { branch: e.branch, from: prev.head, to: head, at, commits: found.commits.map(commitWords) };
    if (move && move !== prev.moved) moves.push(move);
    records[e.branch] = { head, at, moved: move };
    changed = true;
  }
  if (changed) writeBranches(paths, records);
  return moves;
}

/** A person has seen the moves: they're cleared, and the next sync starts from where each branch stands now. */
export function clearBranchMoves(paths: Pick<RepoPaths, 'stateDir'>, branch?: string): string[] {
  const records = readBranches(paths);
  const cleared: string[] = [];
  for (const [b, r] of Object.entries(records)) {
    if (!r.moved || (branch && b !== branch)) continue;
    r.moved = null;
    cleared.push(b);
  }
  if (cleared.length) writeBranches(paths, records);
  return cleared;
}

/** "main moved by 2 commits nobody explains: abc1234 Hotfix, def5678 Bump", for a notice or acc sync. */
export function moveWords(m: BranchMove): string {
  const n = m.commits.length;
  const list = m.commits.slice(0, 3).join(', ');
  return n
    ? `${m.branch} moved from ${m.from.slice(0, 7)} to ${m.to.slice(0, 7)} by ${n} commit${n === 1 ? '' : 's'} that ${n === 1 ? 'isn\'t' : 'aren\'t'} acc's merges: ${list}${n > 3 ? ` and ${n - 3} more` : ''}. Look before anything builds on it.`
    : `${m.branch} moved from ${m.from.slice(0, 7)} to ${m.to.slice(0, 7)}, and git couldn't list how: a force push or a rewrite. Look before anything builds on it.`;
}

/** The compare page on GitHub for a move, for a person to look at it. */
export const moveUrl = (repo: string, m: BranchMove): string => `https://github.com/${repo}/compare/${m.from}...${m.to}`;
