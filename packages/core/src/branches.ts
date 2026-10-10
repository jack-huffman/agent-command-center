/**
 * Environment branches on GitHub, watched (GH-69): on every sync, acc looks at each environment's branch on
 * origin and flags one that moved by anything but a merge acc knows of, as a notice needing a person. A cloud
 * builder can't push an environment branch past the repo's guard and GitHub's rules, but a person or
 * something else might, and the ledger would never hear of it otherwise. Nothing here changes a branch.
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
  /** Each commit that came in, newest first, as `abc1234 subject`, when git could list them. */
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

/** Whether a commit is a merge acc knows of: a pull request the ledger holds, merged or promoted, named in its subject. */
export function explained(subject: string, known: Set<number>): boolean {
  const numbers = [...subject.matchAll(/#(\d+)\b/g)].map((m) => Number(m[1]));
  return numbers.length > 0 && numbers.some((n) => known.has(n));
}

/** The pull requests the ledger knows merged: each task's, and each promotion's. Their merges explain a branch's move. */
export function knownMerges(ledger: Pick<Ledger, 'tasks'>): Set<number> {
  const out = new Set<number>();
  for (const t of ledger.tasks) {
    if (t.pr?.number) out.add(t.pr.number);
    for (const p of t.promotions ?? []) out.add(p.pr.number);
  }
  return out;
}

/**
 * Looks at each environment branch on origin, and records a move nobody explains (GH-69). The first look
 * at a branch only records where it stands. A move whose every commit names a pull request the ledger
 * knows is acc's own merge, or a promotion's, and passes quietly; any other is kept as a notice until a
 * person clears it. origin not answering for a branch leaves its record as it was.
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
    let commits: string[] = [];
    let listed = false;
    if (fetchBranches(run, paths.root, [e.branch], { ...env, GIT_TERMINAL_PROMPT: '0' })) {
      const log = run('git', ['log', '--format=%h %s', `${prev.head}..${head}`], { cwd: paths.root });
      if (log.code === 0) {
        listed = true;
        commits = log.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      }
    }
    const ours = listed && commits.length > 0 && commits.every((c) => explained(c.replace(/^\S+\s/, ''), known));
    const move: BranchMove | null = ours ? prev.moved : { branch: e.branch, from: prev.head, to: head, at, commits };
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
