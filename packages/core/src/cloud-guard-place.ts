/**
 * The push guard on the branch a cloud session clones (T-145): whether it's committed there, and pushed, and
 * committing and pushing it, each a person's click in Set up cloud builders. A cloud session clones the repo's
 * default branch (origin/HEAD), so that's where the guard must be, as cloudGuard checks before each dispatch.
 */
import { GUARD_PATH, guardCommitted, installGuard, PRE_PUSH_PATH, SETTINGS_PATH } from './cloud-guard.ts';
import { AccError, type Runner } from './exec.ts';
import { PUSH_TIMEOUT_MS } from './land.ts';

/** Where the guard stands on the branch the cloud clones. */
export interface GuardPlace {
  /** The branch a cloud session clones: origin's default, else the first environment's. */
  base: string;
  /** The branch checked out in the project's folder, null when none is (a detached HEAD). */
  checkedOut: string | null;
  /** Committed on base here, and on GitHub's base, each with why not. */
  local: { ok: boolean; why: string | null };
  pushed: { ok: boolean; why: string | null };
  /** How many of base's commits here GitHub doesn't have yet: what a push sends. */
  ahead: number;
}

/** The files the guard is, committed together. */
export const GUARD_FILES = [GUARD_PATH, PRE_PUSH_PATH, SETTINGS_PATH] as const;

/** The branch a cloud session clones: origin/HEAD's, as cloudGuard reads it, else the first environment's. */
export function cloneBranch(run: Runner, root: string, mainBranch: string): string {
  const head = run('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd: root }).stdout.trim();
  return head.startsWith('origin/') ? head.slice('origin/'.length) : mainBranch;
}

export function guardPlace(run: Runner, root: string, mainBranch: string): GuardPlace {
  const base = cloneBranch(run, root, mainBranch);
  const branch = run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root });
  const checkedOut = branch.code === 0 ? branch.stdout.trim() || null : null;
  const has = (ref: string) => run('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: root }).code === 0;
  const local = has(`refs/heads/${base}`) ? guardCommitted(run, root, `refs/heads/${base}`) : { ok: false, why: `There's no ${base} branch here.` };
  const remote = `refs/remotes/origin/${base}`;
  const pushed = has(remote) ? guardCommitted(run, root, remote) : { ok: false, why: `GitHub has no ${base} branch that this folder knows of.` };
  const count = has(remote) && has(`refs/heads/${base}`) ? run('git', ['rev-list', '--count', `${remote}..refs/heads/${base}`], { cwd: root }) : null;
  const ahead = count?.code === 0 ? Number(count.stdout.trim()) || 0 : 0;
  return { base, checkedOut, local: local.ok ? { ok: true, why: null } : { ok: false, why: local.why }, pushed: pushed.ok ? { ok: true, why: null } : { ok: false, why: pushed.why }, ahead };
}

/**
 * Commits the guard on the branch the cloud clones, which must be the one checked out: the three files only,
 * written first if they aren't there or are older than this acc writes. Nothing else that's changed goes in.
 */
export function commitGuard(run: Runner, root: string, mainBranch: string): { base: string; committed: boolean } {
  const place = guardPlace(run, root, mainBranch);
  if (place.local.ok) return { base: place.base, committed: false };
  if (place.checkedOut !== place.base) throw new AccError('refused', `The cloud clones ${place.base}, and this folder has ${place.checkedOut ?? 'no branch'} checked out: switch it to ${place.base}, then commit the push guard.`);
  installGuard(root);
  const add = run('git', ['add', '--', ...GUARD_FILES], { cwd: root });
  if (add.code !== 0) throw new AccError('git', `git couldn't add the push guard: ${(add.stderr || add.stdout).trim().split('\n')[0]}`);
  const commit = run('git', ['commit', '-m', 'Commit the push guard cloud builders run', '--', ...GUARD_FILES], { cwd: root });
  if (commit.code !== 0) throw new AccError('git', `git couldn't commit the push guard: ${(commit.stderr || commit.stdout).trim().split('\n')[0]}`);
  return { base: place.base, committed: true };
}

/** Pushes the branch the cloud clones to GitHub, once the guard is committed on it here. A person asks for it. */
export function pushGuard(run: Runner, root: string, mainBranch: string, env: NodeJS.ProcessEnv): { base: string; pushed: number } {
  const place = guardPlace(run, root, mainBranch);
  if (!place.local.ok) throw new AccError('refused', `The push guard isn't committed on ${place.base} yet: commit it first.`);
  if (place.pushed.ok && !place.ahead) return { base: place.base, pushed: 0 };
  const r = run('git', ['push', 'origin', `refs/heads/${place.base}:refs/heads/${place.base}`], { cwd: root, env: { ...env, GIT_TERMINAL_PROMPT: '0' }, timeoutMs: PUSH_TIMEOUT_MS });
  if (r.code !== 0) throw new AccError('git', `git couldn't push ${place.base}: ${(r.stderr || r.stdout).trim().split('\n').pop()}`);
  return { base: place.base, pushed: place.ahead };
}
