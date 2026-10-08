import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, type GateScope, requiredGates } from './config.ts';
import type { Runner } from './exec.ts';
import type { Hooks, Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import type { TestCounts } from './test-counts.ts';

/**
 * pass: the change is right. fail: it isn't. error: the gate couldn't run. skip: it didn't apply (D-024).
 * hold: it ran, but acc can't vouch for it: a test check ran no tests, or skipped more than before. Like a
 * fail it settles nothing, and only a person clears it (GH-100).
 */
export const GATE_STATUSES = ['pass', 'fail', 'error', 'skip', 'hold'] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];

/** The result of one gate on one commit. A new commit makes it stale. */
export interface Receipt {
  gate: string;
  sha: string;
  /** The environment's branch it was checked against. */
  env: string;
  status: GateStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  summary: string;
  /** What ran, or null when the gate decided without running anything. A waiver keeps what its counts came from. */
  command: string | null;
  log: string | null;
  /** Salesforce: the job id, org, test level and the Apex tests the builder named. */
  details?: Record<string, unknown>;
  /** A test check's counts, as its runner reported them (GH-100). */
  counts?: TestCounts;
  /** What acc made of them: that it couldn't read any, or what they were compared with. */
  countsNote?: string;
  /** Set when a person set the gate aside on this commit (D-031): who, why, and what it had been. */
  waived?: { by: string; reason: string; at: string; was: GateStatus | null; wasSummary: string | null };
}

/**
 * A skip satisfies a required gate: `lint` with no JavaScript changed has nothing to find, and a waived gate is a
 * skip a person chose. A hold, like a fail, doesn't (GH-100).
 */
export const satisfies = (r: Pick<Receipt, 'status'> | null): boolean => r?.status === 'pass' || r?.status === 'skip';

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

/** Every receipt recorded for a commit, by gate. */
export function receiptsAt(paths: RepoPaths, sha: string): Record<string, Receipt> {
  const dir = join(paths.receipts, sha);
  if (!existsSync(dir)) return {};
  const out: Record<string, Receipt> = {};
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const r = readReceipt(paths, sha, f.slice(0, -5));
    if (r) out[r.gate] = r;
  }
  return out;
}

/** How many commits back from the base acc looks for an earlier count (GH-100). */
export const EARLIER_LIMIT = 500;

/**
 * The nearest receipt with counts for this gate and command at or before `base`, the commit a branch grew
 * from on its environment's branch, other than `sha`'s own (GH-100). The tip isn't used: it can hold changes
 * the branch doesn't. Null when there's none in the last EARLIER_LIMIT commits, as in a repo that squashes,
 * whose merged commits aren't ancestors. A count a person accepted on the branch itself, by waiving the
 * check on one of its commits, comes first: the merge queue's merge of that commit is compared with it.
 */
export function earlierCounts(paths: RepoPaths, run: Runner, base: string, gate: string, command: string, sha: string): Receipt | null {
  const kept = existsSync(paths.receipts) ? new Set(readdirSync(paths.receipts)) : new Set<string>();
  kept.delete(sha);
  if (!kept.size) return null;
  const nearest = (range: string[], ok: (r: Receipt) => boolean): Receipt | null => {
    const r = run('git', ['rev-list', `--max-count=${EARLIER_LIMIT}`, ...range], { cwd: paths.root });
    for (const at of r.code === 0 ? r.stdout.split('\n').map((l) => l.trim()).filter((l) => kept.has(l)) : []) {
      const receipt = readReceipt(paths, at, gate);
      if (receipt?.counts && receipt.command === command && ok(receipt)) return receipt;
    }
    return null;
  };
  return nearest([sha, `^${base}`], (r) => !!r.waived) ?? nearest([base], () => true);
}

/** Written whole or not at all, so a reader never sees half a receipt. */
export function writeReceipt(paths: RepoPaths, receipt: Receipt): string {
  const f = receiptPath(paths, receipt.sha, receipt.gate);
  mkdirSync(join(paths.receipts, receipt.sha), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(receipt, null, 2) + '\n');
  renameSync(tmp, f);
  return f;
}

/**
 * Gate hooks backed by receipt files: a required gate counts only if it passed, or didn't apply, on the
 * branch's current commit. By scope (GH-73): a builder's commit needs the builder's checks where the merge
 * queue runs the full ones before the merge, and the full ones cover them; a merge needs the full ones.
 */
export function receiptHooks(paths: RepoPaths, config: Config, run: Runner): Hooks {
  return {
    missingGates(task: Task, scope: GateScope = 'builder'): string[] {
      const required = requiredGates(config, task.environment, scope);
      if (!required.length) return [];
      const branch = task.run?.branch;
      if (!branch) return required;
      const sha = run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: paths.root });
      if (sha.code !== 0) return required;
      const head = sha.stdout.trim();
      const passed = (g: string) => satisfies(readReceipt(paths, head, g));
      const missing = required.filter((g) => !passed(g));
      // The full check passed on this commit, as the queue runs it on its merge: that covers a builder's.
      const full = config.gates.required;
      if (missing.length && required !== full && full.length && full.every(passed)) return [];
      return missing;
    },
  };
}
