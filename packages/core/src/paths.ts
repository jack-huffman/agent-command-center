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
  /** What GitHub's checks said on a commit autopilot sent back to its builder (D-???). */
  checks: string;
  packets: string;
  logs: string;
  config: string;
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
    packets: join(stateDir, 'packets'),
    logs: join(stateDir, 'logs'),
    config: join(root, '.acc', 'config.json'),
  };
}
