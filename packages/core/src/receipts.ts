import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.ts';
import type { Runner } from './exec.ts';
import type { Hooks, Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';

export interface Receipt {
  gate: string;
  sha: string;
  status: 'pass' | 'fail' | 'error';
  startedAt: string;
  finishedAt: string;
  summary: string;
}

export function receiptPath(paths: RepoPaths, sha: string, gate: string): string {
  return join(paths.receipts, sha, `${gate}.json`);
}

export function readReceipt(paths: RepoPaths, sha: string, gate: string): Receipt | null {
  const f = receiptPath(paths, sha, gate);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as Receipt;
  } catch {
    return null;
  }
}

/** Gate hooks backed by receipt files: a required gate counts only if it passed on the branch's current commit. */
export function receiptHooks(paths: RepoPaths, config: Config, run: Runner): Hooks {
  return {
    missingGates(task: Task): string[] {
      const required = config.gates.required;
      if (!required.length) return [];
      const branch = task.run?.branch;
      if (!branch) return required;
      const sha = run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: paths.root });
      if (sha.code !== 0) return required;
      const head = sha.stdout.trim();
      return required.filter((g) => readReceipt(paths, head, g)?.status !== 'pass');
    },
  };
}
