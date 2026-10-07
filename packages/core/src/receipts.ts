import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, type GateScope, requiredGates } from './config.ts';
import type { Runner } from './exec.ts';
import type { Hooks, Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';

/** pass: the change is right. fail: it isn't. error: the gate couldn't run. skip: it didn't apply (D-024). */
export const GATE_STATUSES = ['pass', 'fail', 'error', 'skip'] as const;
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
  /** What ran, or null when the gate decided without running anything. */
  command: string | null;
  log: string | null;
  /** Salesforce: the job id, org, test level and tests run. */
  details?: Record<string, unknown>;
  /** Set when a person set the gate aside on this commit (D-031): who, why, and what it had been. */
  waived?: { by: string; reason: string; at: string; was: GateStatus | null; wasSummary: string | null };
}

/** A skip satisfies a required gate: `lint` with no JavaScript changed has nothing to find, and a waived gate is a skip a person chose. */
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
