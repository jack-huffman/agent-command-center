import { type Config, environmentByBranch } from './config.ts';
import { releaseAwake } from './awake.ts';
import { arrivedAt } from './carried.ts';
import { closeWords, issueToClose, settleCloses } from './closing.ts';
import { AccError, type Runner } from './exec.ts';
import { applyMove, checkMove, mutate, noGateHooks, type PullRequest, readLedger, type State } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { discardUpdate, draftUpdate, listUpdates } from './updates.ts';

/**
 * Keeps tasks in step with their pull requests (D-033): merged is done, closed without merging is
 * blocked, and failing checks, a person's requested changes or a conflict with the base show the task
 * as needs you. It reads GitHub, and fetches to see the conflicts (D-049). A task it moves to done gets
 * a draft update for its ticket, which a person posts (D-066). It follows the promotions that took tasks
 * on too (D-075): merged, each task's ticket hears its change is in the next environment; closed without
 * merging, the draft saying it was ready to go is set aside. The one change it makes on GitHub: where the
 * GitHub tracker says "edits": true, a task it moves to done has its issue closed in place of the draft,
 * with a comment naming the pull request (D-???), and a close that failed is tried again.
 */

export interface SyncChange {
  task: string;
  pr: number;
  /** The move it made, if any. */
  moved: { from: State; to: State } | null;
  note: string;
  /** The update it drafted for the ticket, when it moved the task to done or a promotion of it merged. */
  update?: { id: string; key: string };
  /** What became of the task's GitHub issue, where acc closes it (D-???): closed, left as it is, or not yet, with why. */
  issue?: { key: string; outcome: 'closed' | 'left' | 'failed'; reason?: string };
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
  mergedAt?: string | null;
  /** A check run has a name and its workflow's; a commit status has a context. */
  statusCheckRollup?: { status?: string; conclusion?: string | null; state?: string; name?: string; context?: string; workflowName?: string }[] | null;
}

/** The commit a merge left on its base, when GitHub gave one. */
const mergeShaOf = (p: GhPr): string | undefined => (p.mergeCommit?.oid && /^[0-9a-f]{40,64}$/.test(p.mergeCommit.oid) ? p.mergeCommit.oid : undefined);

const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']);

/** One word for all of a pull request's checks: failing if any failed, else pending if any are running. */
export function ciOf(rollup: GhPr['statusCheckRollup']): PullRequest['ci'] {
  const items = rollup ?? [];
  if (!items.length) return null;
  if (items.some((c) => FAILED.has(String(c.conclusion ?? '').toUpperCase()) || FAILED.has(String(c.state ?? '').toUpperCase()))) return 'failing';
  if (items.some((c) => (c.status && c.status.toUpperCase() !== 'COMPLETED') || ['PENDING', 'EXPECTED'].includes(String(c.state ?? '').toUpperCase()))) return 'pending';
  return 'passing';
}

/** The names of a pull request's checks that failed, as ciOf counts them, so a task can name them (D-076). */
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
  const tasks = readLedger(paths.ledger).tasks;
  const open = tasks.filter((t) => t.pr?.state === 'open');
  // A promotion carries several tasks: each open one is read once (D-075).
  const promotions = [...new Set(tasks.flatMap((t) => (t.promotions ?? []).filter((p) => p.state === 'open').map((p) => p.pr.number)))];
  // An issue whose close failed is tried again, even with no pull request left open (D-???).
  const closing = tasks.some((t) => t.pr?.issue?.state === 'pending');
  if (!open.length && !promotions.length && !closing) return { checked: 0, changes: [] };
  const gh = config.github;
  if (!gh) throw new AccError('no-github', 'This project has no "github" section in .acc/config.json, so there are no pull requests to follow.');
  const token = run('gh', ['auth', 'token', '-u', gh.account]);
  if (token.code !== 0) throw new AccError('no-github', `gh isn't logged in as ${gh.account}, the account this repo works as.`);
  const env = { ...deps.env, GH_TOKEN: token.stdout.trim() };
  const view = (n: number, fields: string): GhPr | undefined => {
    const r = run('gh', ['pr', 'view', String(n), '-R', gh.repo, '--json', fields], { env, timeoutMs: 60_000 });
    if (r.code !== 0) return undefined; // unreachable for now: try again next time
    try {
      return JSON.parse(r.stdout) as GhPr;
    } catch {
      return undefined; // not JSON: try again next time
    }
  };
  const seen = new Map<number, GhPr>();
  for (const t of open) {
    const p = view(t.pr!.number, 'number,state,url,reviewDecision,baseRefName,headRefName,mergeCommit,statusCheckRollup');
    if (p) seen.set(t.pr!.number, p);
  }
  const promoted = new Map<number, GhPr>();
  for (const n of promotions) {
    const p = view(n, 'number,state,url,mergeCommit,mergedAt');
    if (p) promoted.set(n, p);
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
  // What to tell each ticket once the ledger is written: its change is in the next environment, or the
  // promotion that would have taken it there closed.
  const arrived: { change: SyncChange; env: string }[] = [];
  const closed: { change: SyncChange; pr: number }[] = [];
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
        const mergeSha = mergeShaOf(p);
        t.pr = { ...t.pr, state: 'merged', ci, ...(mergeSha ? { mergeSha } : {}), syncedAt: at };
        const req = { to: 'done' as const, actor: 'sync' as const, by: 'acc sync', reason: `Pull request #${p.number} merged.` };
        if (t.state === 'review' && !checkMove(ledger, config, t, req, noGateHooks).length) {
          moved = { from: t.state, to: 'done' };
          applyMove(t, req, emit, now);
          // Its tracker lets acc change its tickets: the issue closes once the ledger is written (D-???).
          if (issueToClose(config, t)) t.pr.issue = { state: 'pending', at };
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
        // Which checks failed, by name (D-076); none kept once they pass.
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
    // The promotions that took tasks on (D-075). Merged: where the change arrived, which a deploy finds.
    // Closed: the task isn't there, so the next promotion carries it again.
    for (const t of ledger.tasks) {
      for (const promotion of t.promotions ?? []) {
        const p = promotion.state === 'open' ? promoted.get(promotion.pr.number) : undefined;
        if (!p || (p.state !== 'MERGED' && p.state !== 'CLOSED')) continue;
        const env = environmentByBranch(config, promotion.to)?.name ?? promotion.to;
        const change: SyncChange = { task: t.id, pr: promotion.pr.number, moved: null, note: '' };
        if (p.state === 'MERGED') {
          // Already there by an earlier promotion: the client heard so then.
          const before = arrivedAt(t, promotion.to);
          const mergeSha = mergeShaOf(p);
          promotion.state = 'merged';
          if (mergeSha) promotion.mergeSha = mergeSha;
          if (p.mergedAt && !Number.isNaN(Date.parse(p.mergedAt))) promotion.mergedAt = p.mergedAt;
          change.note = `promotion #${p.number} merged into ${env}`;
          if (!before) arrived.push({ change, env });
        } else {
          promotion.state = 'closed';
          change.note = `promotion #${p.number} to ${env} closed without merging`;
          closed.push({ change, pr: p.number });
        }
        emit({ type: 'task.updated', task: t.id, actor: 'sync', by: 'acc sync', data: { promotion } });
        out.push(change);
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
    // Its issue closes with a comment saying it merged, so no draft says it again (D-???).
    if (!t || t.pr?.issue) continue;
    try {
      const u = draftUpdate(paths, t, { event: 'merged', env: environmentByBranch(config, t.environment)?.name ?? t.environment }, 'acc sync', now);
      if (u) c.update = { id: u.id, key: u.key };
    } catch (e) {
      // The task stays done, and the next sync won't draft it again: say so where sync reports.
      c.note += `; no update drafted: ${(e as Error).message}`;
    }
  }
  // In the next environment: the ticket can hear so. It overtakes the draft saying it was ready to go (D-071).
  for (const { change, env } of arrived) {
    const t = ledger.tasks.find((x) => x.id === change.task);
    if (!t) continue;
    try {
      const u = draftUpdate(paths, t, { event: 'promoted', env }, 'acc sync', now);
      if (u) change.update = { id: u.id, key: u.key };
    } catch (e) {
      change.note += `; no update drafted: ${(e as Error).message}`;
    }
  }
  // Closed without merging: the change isn't going there after all, so its unposted draft is set aside,
  // kept and marked. One posted, or being posted, is left as it is.
  const drafts = closed.length ? listUpdates(paths) : [];
  for (const { change, pr } of closed) {
    const gone: string[] = [];
    for (const u of drafts) {
      if (u.task !== change.task || u.event !== 'promotion-opened' || u.pr?.number !== pr || u.state !== 'draft') continue;
      try {
        discardUpdate(paths, u.id, 'acc sync', now);
        gone.push(u.id);
      } catch {
        // Claimed for posting since: a person has it.
      }
    }
    if (gone.length) change.note += `; discarded its unposted update ${gone.join(', ')}`;
  }
  // Each issue waiting to close, as the repo's account (D-007): those just merged, and any that failed
  // before. One that fails again is named here, and the next sync tries it again.
  for (const r of settleCloses(paths, config, { run, now, env })) {
    const issue = { key: r.key, outcome: r.outcome as 'closed' | 'left' | 'failed', ...(r.reason ? { reason: r.reason } : {}) };
    const c = changes.find((x) => x.task === r.task && x.pr === r.pr && x.moved?.to === 'done');
    if (c) {
      c.issue = issue;
      c.note += `; ${closeWords(r)}`;
    } else changes.push({ task: r.task, pr: r.pr, moved: null, note: closeWords(r), issue });
  }
  return { checked: seen.size + promoted.size, changes };
}
