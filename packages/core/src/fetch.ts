/**
 * Fetching from origin (T-86): a leaf module, so the modules that follow branches on GitHub (sync, cloud,
 * cloud-review, land) can share it without a cycle that reaches a module-level constant before it exists.
 * sync.ts exports both again, as it always did.
 */
import type { Runner } from './exec.ts';

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
