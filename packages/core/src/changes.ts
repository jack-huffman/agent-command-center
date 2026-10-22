import type { Runner } from './exec.ts';
import { type Actor, type Emit, mutate, readLedger, type Task } from './ledger.ts';
import { branchFiles, nulPaths, sameFile } from './overlap.ts';
import type { RepoPaths } from './paths.ts';

/**
 * What a task's work changed, kept with it when it merges (T-99). While its branch is in flight, what it
 * changed is read live from git (branchFiles). Once it merges its branch can go, so acc keeps its changed
 * paths in the ledger: when acc land opens or updates its pull request, when autopilot merges it, when acc
 * sync sees it merged, and when a person moves it to done. Its page shows them after the branch is gone,
 * and a ticket's package.xml (T-101) can read them. A task that merged before this keeps none.
 */

/** A task's changed paths, as git names them in the repo, and when acc read them. */
export interface KeptChanges {
  at: string;
  paths: string[];
}

const git = (run: Runner, root: string, ...args: string[]) => run('git', args, { cwd: root });

/** Whether `ref` names a commit in this clone. */
const isCommit = (run: Runner, root: string, ref: string): boolean => git(run, root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`).code === 0;

/**
 * What a merge commit brought in: for a merge, what its second parent changed since it left the first; for
 * a squash, what changed from its parent. Null when git can't say, as when the commit isn't in this clone.
 */
export function mergeCommitPaths(run: Runner, root: string, sha: string): string[] | null {
  if (!isCommit(run, root, sha)) return null;
  const parents = git(run, root, 'rev-list', '--parents', '-n', '1', sha);
  const [, first, second] = parents.stdout.trim().split(/\s+/);
  if (parents.code !== 0 || !first) return null;
  const r = git(run, root, 'diff', '--name-only', '--no-renames', '-z', ...(second ? [`${first}...${second}`] : [first, sha]), '--');
  return r.code === 0 ? [...new Set(nulPaths(r.stdout))].sort() : null;
}

/**
 * The merge commit that took `head` into its environment's branch, origin's copy first: the oldest merge
 * that descends from it. Null when `head` isn't in that branch, as after a squash merge.
 */
export function mergeOf(run: Runner, root: string, head: string, env: string): string | null {
  for (const ref of [`refs/remotes/origin/${env}`, `refs/heads/${env}`]) {
    if (!isCommit(run, root, ref) || git(run, root, 'merge-base', '--is-ancestor', head, ref).code !== 0) continue;
    const merges = git(run, root, 'rev-list', '--ancestry-path', '--merges', '--reverse', `${head}..${ref}`);
    const first = merges.code === 0 ? merges.stdout.trim().split('\n')[0] : '';
    if (first) return first;
  }
  return null;
}

/**
 * What a task's work changed, as it merges or after: what its branch committed while its environment's
 * branch doesn't hold it yet, else what the merge commit that took it in brought, its pull request's or the
 * one git finds. Its worktree's uncommitted files don't merge, so they don't count. Null when git can't say.
 */
export function mergedPaths(run: Runner, root: string, task: Pick<Task, 'environment' | 'run' | 'pr'>): string[] | null {
  const branch = task.run?.branch;
  if (branch) {
    const files = branchFiles(run, root, task.environment, branch);
    if (files.length) return files;
  }
  // Its branch is in its environment's branch now, or gone: the merge commit says what it brought.
  const merge = task.pr?.mergeSha ?? (branch && isCommit(run, root, `refs/heads/${branch}`) ? mergeOf(run, root, `refs/heads/${branch}`, task.environment) : null);
  return merge ? mergeCommitPaths(run, root, merge) : null;
}

/** Keeps `paths` with a task, unless there are none to keep: what it kept before stands. True when it kept them. */
export function keepChanges(t: Task, paths: string[] | null, at: string, emit: Emit, who: { actor: Actor; by: string }): boolean {
  if (!paths?.length) return false;
  t.changes = { at, paths };
  emit({ type: 'task.updated', task: t.id, actor: who.actor, by: who.by, data: { changes: t.changes } });
  return true;
}

/** Reads what a task's work changed and keeps it in the ledger. Null, and nothing kept, when git can't say. */
export function recordChanges(paths: RepoPaths, run: Runner, now: () => Date, id: string, who: { actor: Actor; by: string }): KeptChanges | null {
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) return null;
  const found = mergedPaths(run, paths.root, task);
  if (!found?.length) return null;
  return mutate(paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === id);
    return t && keepChanges(t, found, now().toISOString(), emit, who) ? t.changes ?? null : null;
  });
}

// ---------------------------------------------------------------- planned against actual

/**
 * How a path stands against the plan: in the plan and changed, changed where there's no plan to compare
 * with, changed outside the plan, or planned and not changed.
 */
export type ChangeMark = 'planned' | 'changed' | 'unplanned' | 'unmade';

export interface ChangeRow {
  path: string;
  mark: ChangeMark;
}

/**
 * The changed paths against the planned ones (T-99): each changed path, in the plan or not, then each
 * planned path nothing changed. A planned folder, as a glob in a plan names one, holds the files under it.
 * With no plan, nothing is marked outside it.
 */
export function planAgainst(planned: string[] | null, changed: string[]): ChangeRow[] {
  const plan = planned ?? [];
  const rows: ChangeRow[] = changed.map((path) => ({ path, mark: !planned ? 'changed' : plan.some((p) => sameFile(p, path)) ? 'planned' : 'unplanned' }));
  for (const path of plan) if (!changed.some((c) => sameFile(path, c))) rows.push({ path, mark: 'unmade' });
  return rows;
}
