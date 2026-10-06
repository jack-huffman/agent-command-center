import type { Runner } from './exec.ts';
import { readLedger, type Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import type { PromotionPlan } from './promote.ts';

/**
 * Where a task's change has got to (GH-56). A promotion copies files rather than merging, so a task's
 * merge commit on Dev never reaches UAT's history: each environment has its own commit where the change
 * arrived. A promotion and a deploy both work out what they carry from it.
 */

/**
 * The commit where a task's change reached a branch: its own pull request's merge, when it was built on
 * that branch, or else the merge of the first promotion that took it there. A squash merge's commit is the
 * one acc sync recorded; a task merged before acc recorded it falls back to its branch's commit (D-066).
 */
export function arrivedAt(t: Pick<Task, 'environment' | 'pr' | 'promotions'>, branch: string): string | undefined {
  if (t.environment === branch && t.pr?.state === 'merged') return t.pr.mergeSha ?? t.pr.sha;
  return t.promotions?.find((p) => p.to === branch && p.state === 'merged' && p.mergeSha)?.mergeSha;
}

const git = (run: Runner, root: string, ...args: string[]) => run('git', args, { cwd: root });

/**
 * The tasks a promotion carries: each whose change had reached the source branch by the commit promoted,
 * hasn't reached the destination yet, and whose own merge touched a file the promotion brings or deletes.
 * A change that was only environment-specific travels nowhere. When a task's merge can't be read, only
 * that last test is skipped. A task promoted by hand, or before acc recorded promotions, is carried again
 * if a later change touches the same file.
 */
export function carriedTasks(paths: Pick<RepoPaths, 'root' | 'ledger'>, run: Runner, plan: Pick<PromotionPlan, 'from' | 'to' | 'fromSha' | 'files' | 'deleted'>): Task[] {
  const on = (sha: string, tip: string) => git(run, paths.root, 'merge-base', '--is-ancestor', sha, tip).code === 0;
  const reached = readLedger(paths.ledger).tasks.filter((t) => {
    const at = arrivedAt(t, plan.from.branch);
    return !!at && !arrivedAt(t, plan.to.branch) && on(at, plan.fromSha);
  });
  if (!reached.length) return [];
  // A task that came to the source by an earlier promotion was merged on another branch: fetch those once.
  const others = [...new Set(reached.map((t) => t.environment).filter((b) => b !== plan.from.branch))];
  if (others.length) git(run, paths.root, 'fetch', '--quiet', 'origin', ...others);
  const moving = new Set([...plan.files, ...plan.deleted]);
  return reached.filter((t) => {
    const own = t.pr?.state === 'merged' ? t.pr.mergeSha ?? t.pr.sha : undefined;
    if (!own) return true;
    const r = git(run, paths.root, 'diff-tree', '-r', '-z', '--no-commit-id', '--name-only', '-m', '--first-parent', own);
    if (r.code !== 0) return true;
    return r.stdout.split('\0').some((f) => moving.has(f));
  });
}
