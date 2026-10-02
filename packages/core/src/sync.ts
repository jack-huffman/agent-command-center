import type { Config } from './config.ts';
import { AccError, type Runner } from './exec.ts';
import { applyMove, checkMove, mutate, noGateHooks, type PullRequest, readLedger, type State } from './ledger.ts';
import type { RepoPaths } from './paths.ts';

/**
 * Keeps tasks in step with their pull requests (D-033): merged is done, closed without merging is
 * blocked, and failing checks or a person's requested changes show the task as needs you. It only
 * reads GitHub.
 */

export interface SyncChange {
  task: string;
  pr: number;
  /** The move it made, if any. */
  moved: { from: State; to: State } | null;
  note: string;
}

interface GhPr {
  number: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  url: string;
  reviewDecision?: string | null;
  statusCheckRollup?: { status?: string; conclusion?: string | null; state?: string }[] | null;
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
    const r = run('gh', ['pr', 'view', String(t.pr!.number), '-R', gh.repo, '--json', 'number,state,url,reviewDecision,statusCheckRollup'], { env, timeoutMs: 60_000 });
    if (r.code !== 0) continue; // unreachable for now: try again next time
    try {
      seen.set(t.pr!.number, JSON.parse(r.stdout) as GhPr);
    } catch {
      // not JSON: try again next time
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
        t.pr = { ...t.pr, state: 'merged', ci, syncedAt: at };
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
        t.pr = { ...t.pr, url: p.url, ci, changesRequested, syncedAt: at };
        note = changesRequested ? `#${p.number}: a person asked for changes` : ci === 'failing' ? `#${p.number}: checks failing` : `#${p.number} open${ci ? `, checks ${ci}` : ''}`;
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
  return { checked: seen.size, changes };
}
