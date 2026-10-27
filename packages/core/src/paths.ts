import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { AccError, type Runner } from './exec.ts';

/**
 * A Windows path as Windows compares them (D-T-123): one kind of slash, no trailing one, and no case. git
 * gives C:/Users/…, Node and Claude Code C:\Users\…, and each is the same folder.
 */
export const windowsPathKey = (path: string): string => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();

/** A path as this system compares them: Windows' key there, the path as it is elsewhere. */
export const pathKey = (path: string, platform: NodeJS.Platform = process.platform): string => (platform === 'win32' ? windowsPathKey(path) : path);

export interface RepoPaths {
  /** Top of the current checkout (main checkout or a worktree). */
  root: string;
  /** The git directory every worktree shares (D-008). */
  commonDir: string;
  stateDir: string;
  ledger: string;
  events: string;
  lock: string;
  /** Held while acc autopilot runs, so only one runs against a repo (D-055). */
  autopilotLock: string;
  receipts: string;
  reviews: string;
  /** What each task's analysis found (D-052). */
  analyses: string;
  /** Drafts of ticket updates, which a person reviews and posts (D-066). */
  updates: string;
  /** What GitHub's checks said on a commit autopilot sent back to its builder (D-076). */
  checks: string;
  /** What the merge queue found on a commit it sent back to its builder (GH-73). */
  queue: string;
  /** What a person did with each rule acc suggested from the reviews: accepted or dismissed (GH-102). */
  suggestions: string;
  packets: string;
  logs: string;
  config: string;
  /** Each ratchet's floor or ceiling, committed with the branch (GH-99). */
  floors: string;
  /** Who relaxed a ratchet's floor, to what, and why: a person, always (GH-99). */
  relaxed: string;
}

export function repoPaths(cwd: string, run: Runner): RepoPaths {
  const top = run('git', ['rev-parse', '--show-toplevel'], { cwd });
  if (top.code !== 0) throw new AccError('not-a-repo', `${cwd} isn't inside a git repository.`);
  const common = run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd });
  if (common.code !== 0) throw new AccError('not-a-repo', `Couldn't find the git directory for ${cwd}.`);
  const root = top.stdout.trim();
  const commonDir = common.stdout.trim();
  const stateDir = join(commonDir, 'acc');
  return {
    root,
    commonDir,
    stateDir,
    ledger: join(stateDir, 'ledger.json'),
    events: join(stateDir, 'events.jsonl'),
    lock: join(stateDir, 'ledger.lock'),
    autopilotLock: join(stateDir, 'autopilot.lock'),
    receipts: join(stateDir, 'receipts'),
    reviews: join(stateDir, 'reviews'),
    analyses: join(stateDir, 'analyses'),
    updates: join(stateDir, 'updates'),
    checks: join(stateDir, 'checks'),
    queue: join(stateDir, 'queue'),
    suggestions: join(stateDir, 'rules'),
    packets: join(stateDir, 'packets'),
    logs: join(stateDir, 'logs'),
    config: join(root, '.acc', 'config.json'),
    floors: join(root, '.acc', 'floors.json'),
    relaxed: join(stateDir, 'relaxed.jsonl'),
  };
}

/**
 * Whether two paths name one folder, however each is spelled: through symlinks such as macOS's /var to
 * /private/var, and as Claude Code lists a session's real path. A path that doesn't exist matches only itself.
 */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  // On Windows also its slashes, its case and its short 8.3 names (C:\Users\RUNNER~1), which only the native
  // realpath spells out (pathKey).
  if (a === b || pathKey(a, platform) === pathKey(b, platform)) return true;
  const real = platform === 'win32' ? realpathSync.native : realpathSync;
  try {
    return pathKey(real(a), platform) === pathKey(real(b), platform);
  } catch {
    return false;
  }
}

/**
 * The main checkout: the first entry in `git worktree list`. Worktrees are placed beside it, and a deploy
 * reads the project's settings from it, never from a task's worktree (D-206).
 */
export function mainCheckout(run: Runner, cwd: string): string {
  const r = run('git', ['worktree', 'list', '--porcelain'], { cwd });
  const first = /^worktree (.+)$/m.exec(r.stdout)?.[1];
  if (r.code !== 0 || !first) throw new AccError('not-a-repo', `${cwd} isn't inside a git repository.`);
  return first;
}
