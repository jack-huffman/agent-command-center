/**
 * What a ticket's Changes tab reads of its branch (T-138): the paths it deletes. Every deploy past the development
 * org is the deploy guide's agent's (T-158), so nothing here deploys. Like the rest of logic/, no `vscode` import,
 * so it's tested with node:test.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Runner } from '../../../packages/core/src/exec.ts';

/**
 * Of a branch's changed paths, those it deletes (T-138): gone from its worktree where it has one, else from
 * the branch's own tree. None when the branch can't be read, so nothing is called deleted by mistake.
 */
export function deletedPaths(run: Runner, root: string, branch: string, worktree: string | null | undefined, paths: string[]): string[] {
  if (!paths.length) return [];
  if (worktree && existsSync(worktree)) return paths.filter((p) => !existsSync(join(worktree, p)));
  const r = run('git', ['ls-tree', '-r', '--name-only', '-z', `refs/heads/${branch}`, '--', ...paths], { cwd: root });
  if (r.code !== 0) return [];
  const there = new Set(r.stdout.split('\0').filter(Boolean));
  return paths.filter((p) => !there.has(p));
}
