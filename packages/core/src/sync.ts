import { type Config, environmentByBranch } from './config.ts';
import { releaseAwake } from './awake.ts';
import { AccError, type Runner } from './exec.ts';
import { applyMove, checkMove, mutate, noGateHooks, type PullRequest, readLedger, type State } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { draftUpdate } from './updates.ts';

/**
 * Keeps tasks in step with their pull requests (D-033): merged is done, closed without merging is
 * blocked, and failing checks, a person's requested changes or a conflict with the base show the task
 * as needs you. It only reads GitHub, and fetches to see the conflicts (D-049). A task it moves to done
 * gets a draft update for its ticket, which a person posts (D-066): sync itself posts nothing.
 */

export interface SyncChange {
  task: string;
  pr: number;
  /** The move it made, if any. */
  moved: { from: State; to: State } | null;
  note: string;
  /** The update it drafted for the ticket, when it moved the task to done. */
  update?: { id: string; key: string };
}

interface GhPr {
  number: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  url: string;
  reviewDecision?: string | null;
  baseRefName?: string;
  headRefName?: string;
  /** The commit a merge left on the base: a squash or a merge commit, which a deploy finds (D-066). */
  mergeCommit?: { oid?: string } | null;
  /** A check run has a name and its workflow's; a commit status has a context. */
  statusCheckRollup?: { status?: string; conclusion?: string | null; state?: string; name?: string; context?: string; workflowName?: string }[] | null;
}

const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']);

/** One word for all of a pull request's checks: failing if any failed, else pending if any are running. */
export function ciOf(rollup: GhPr['statusCheckRollup']): PullRequest['ci'] {
  const items = rollup ?? [];
  if (!items.length) return null;
  if (items.some((c) => FAILED.has(String(c.conclusion ?? '').toUpperCase()) || FAILED.has(String(c.state ?? '').toUpperCase()))) return 'failing';
  if (items.some((c) => (c.status && c.status.toUpperCase() !== 'COMPLETED') || ['PENDING', 'EXPECTED'].includes(String(c.state ?? '').toUpperCase()))) return 'pending';
  return 'passing';
}

/** The names of a pull request's checks that failed, as ciOf counts them, so a task can name them (D-???). */
export function failingOf(rollup: GhPr['statusCheckRollup']): string[] {
  const failed = (rollup ?? []).filter((c) => FAILED.has(String(c.conclusion ?? '').toUpperCase()) || FAILED.has(String(c.state ?? '').toUpperCase()));
  return [...new Set(failed.map((c) => c.name || c.context || c.workflowName || '').filter(Boolean))];
}

/** How long a fetch may take before acc stops it. */
export const FETCH_TIMEOUT_MS = 2 * 60_000;

/**
 * Brings the branches' latest commits from origin into its remote-tracking refs. Never a local branch,
 * a checkout or the working tree. False when it couldn't: offline, or a branch gone.
 */
export function fetchBranches(run: Runner, root: string, branches: string[], env: NodeJS.ProcessEnv): boolean {
  const refs = [...new Set(branches)].map((b) => `+refs/heads/${b}:refs/remotes/origin/${b}`);
  return run('git', ['fetch', '--quiet', '--no-tags', 'origin', ...refs], { cwd: root, env, timeoutMs: FETCH_TIMEOUT_MS }).code === 0;
}

/**
 * The files a pull request conflicts in with its base: git merges origin's two branches in memory and
 * names what it couldn't merge. Empty when it merges cleanly, null when git couldn't tell.
 */
export function conflictsOf(run: Runner, root: string, base: string, head: string): string[] | null {
  const r = run('git', ['merge-tree', '--write-tree', '--name-only', '-z', '--no-messages', `origin/${base}`, `origin/${head}`], { cwd: root });
  // A conflict and a missing branch both exit 1; only a merge writes a tree first.
  const [tree, ...files] = r.stdout.split('\0');
  if ((r.code !== 0 && r.code !== 1) || !/^[0-9a-f]{40,64}$/.test(tree ?? '')) return null;
  return r.code === 0 ? [] : [...new Set(files.filter(Boolean))];
}

export function sync(paths: RepoPaths, config: Config, deps: { run: Runner; now: () => Date; env: NodeJS.ProcessEnv }): { checked: number; changes: SyncChange[] } {
  const { run, now } = deps;
  const open = readLedger(paths.ledger).tasks.filter((t) => t.pr?.state === 'open');
  if (!open.length) return { checked: 0, changes: [] };
  const gh = config.github;
  if (!gh) throw new AccError('no-github', 'This project has no "github" section in .acc/config.json, so there are no pull requests to follow.');
  const token = run('gh', ['auth', 'token', '-u', gh.account]);
  if (token.code !== 0) throw new AccError('no-github', `gh isn't logged in as ${gh.account}, the account this repo works as.`);
  const env = { ...deps.env, GH_TOKEN: token.stdout.trim() };
  const seen = new Map<number, GhPr>();
  for (const t of open) {
    const r = run('gh', ['pr', 'view', String(t.pr!.number), '-R', gh.repo, '--json', 'number,state,url,reviewDecision,baseRefName,headRefName,mergeCommit,statusCheckRollup'], { env, timeoutMs: 60_000 });
    if (r.code !== 0) continue; // unreachable for now: try again next time
    try {
      seen.set(t.pr!.number, JSON.parse(r.stdout) as GhPr);
    } catch {
      // not JSON: try again next time
    }
  }
  // Whether each open one still merges into its base, worked out here: GitHub says only that it conflicts.
  const branches = new Map<number, { base: string; head: string }>();
  for (const t of open) {
    const p = seen.get(t.pr!.number);
    const base = p?.baseRefName || t.environment;
    const head = p?.headRefName || t.run?.branch;
    if (p?.state === 'OPEN' && head) branches.set(p.number, { base, head });
  }
  const conflicts = new Map<number, string[]>();
  // Unattended, so git never stops to ask for a password.
  if (branches.size && fetchBranches(run, paths.root, [...branches.values()].flatMap((b) => [b.base, b.head]), { ...deps.env, GIT_TERMINAL_PROMPT: '0' })) {
    for (const [n, b] of branches) {
      const files = conflictsOf(run, paths.root, b.base, b.head);
      if (files) conflicts.set(n, files);
    }
  }
  const at = now().toISOString();
  const changes = mutate(paths, now, (ledger, emit) => {
    const out: SyncChange[] = [];
    for (const t of ledger.tasks) {
      const p = t.pr && t.pr.state === 'open' ? seen.get(t.pr.number) : undefined;
      if (!p || !t.pr) continue;
      const before = JSON.stringify(t.pr);
      const ci = ciOf(p.statusCheckRollup);
      const changesRequested = p.reviewDecision === 'CHANGES_REQUESTED';
      let moved: SyncChange['moved'] = null;
      let note = '';
      if (p.state === 'MERGED') {
        const mergeSha = p.mergeCommit?.oid && /^[0-9a-f]{40,64}$/.test(p.mergeCommit.oid) ? p.mergeCommit.oid : undefined;
        t.pr = { ...t.pr, state: 'merged', ci, ...(mergeSha ? { mergeSha } : {}), syncedAt: at };
        const req = { to: 'done' as const, actor: 'sync' as const, by: 'acc sync', reason: `Pull request #${p.number} merged.` };
        if (t.state === 'review' && !checkMove(ledger, config, t, req, noGateHooks).length) {
          moved = { from: t.state, to: 'done' };
          applyMove(t, req, emit, now);
        }
        note = `#${p.number} merged`;
      } else if (p.state === 'CLOSED') {
        t.pr = { ...t.pr, state: 'closed', ci, syncedAt: at };
        const req = { to: 'blocked' as const, actor: 'sync' as const, by: 'acc sync', reason: `Pull request #${p.number} was closed without merging. Reopen it, or decide what happens to ${t.id}.` };
        if (t.state !== 'blocked' && t.state !== 'done' && !checkMove(ledger, config, t, req, noGateHooks).length) {
          moved = { from: t.state, to: 'blocked' };
          applyMove(t, req, emit, now);
        }
        note = `#${p.number} closed without merging`;
      } else {
        // When git couldn't tell this time, what it last said stands.
        const files = conflicts.get(p.number) ?? t.pr.conflicts;
        const failing = ci === 'failing' ? failingOf(p.statusCheckRollup) : [];
        t.pr = { ...t.pr, url: p.url, ci, changesRequested, ...(files ? { conflicts: files } : {}), syncedAt: at };
        // Which checks failed, by name (D-???); none kept once they pass.
        if (failing.length) t.pr.failing = failing;
        else delete t.pr.failing;
        const why = [
          changesRequested ? 'a person asked for changes' : '',
          ci === 'failing' ? 'checks failing' : '',
          files?.length ? `conflicts with ${branches.get(p.number)?.base ?? t.environment} in ${files.join(', ')}` : '',
        ].filter(Boolean);
        note = why.length ? `#${p.number}: ${why.join('; ')}` : `#${p.number} open${ci ? `, checks ${ci}` : ''}`;
      }
      // Only what changed is written down: an unchanged pull request leaves the event log alone.
      const after = JSON.stringify({ ...t.pr, syncedAt: undefined });
      if (moved || after !== JSON.stringify({ ...JSON.parse(before), syncedAt: undefined })) {
        emit({ type: 'task.updated', task: t.id, actor: 'sync', by: 'acc sync', data: { pr: t.pr } });
        out.push({ task: t.id, pr: p.number, moved, note });
      }
    }
    return out;
  });
  // A task sync moved out of running, as moveTask does, stops keeping the Mac awake for its builder (D-067).
  for (const c of changes) if (c.moved?.from === 'running') releaseAwake(paths, c.task);
  // Merged into its environment: the ticket can hear so, once a person posts it. Drafted after the
  // ledger's write, under the drafts' own lock; a draft that can't be written leaves the move as it is.
  const ledger = readLedger(paths.ledger);
  for (const c of changes) {
    if (c.moved?.to !== 'done') continue;
    const t = ledger.tasks.find((x) => x.id === c.task);
    if (!t) continue;
    try {
      const u = draftUpdate(paths, t, { event: 'merged', env: environmentByBranch(config, t.environment)?.name ?? t.environment }, 'acc sync', now);
      if (u) c.update = { id: u.id, key: u.key };
    } catch (e) {
      // The task stays done, and the next sync won't draft it again: say so where sync reports.
      c.note += `; no update drafted: ${(e as Error).message}`;
    }
  }
  return { checked: seen.size, changes };
}
