import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { AccError, type Runner } from './exec.ts';

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
export function samePath(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}
