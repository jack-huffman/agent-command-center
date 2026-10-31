import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, fullGates, type GateScope, requiredGates } from './config.ts';
import { DEPLOY_GATE } from './deploy-commands.ts';
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
  /**
   * Set when this run couldn't run the gate, and says where it runs instead (D-206): a deploy skipped by
   * a refresh, a verify or the merge queue. The skip satisfies that run, but not acc done, which waits for
   * the task's own run.
   */
  elsewhere?: string;
  /**
   * Set when the receipt was carried from the commit before (GH-99): this commit only records the floors
   * acc raised there, which that commit's own checks measured.
   */
  carried?: { from: string };
}

/**
 * What a ratchet measured (GH-99), in its receipt's `details.ratchet`: its number, the floor (or ceiling) it
 * was held to, the one on the environment's branch where this branch began, and the difference from that.
 * `raised` is set when acc wrote a better floor into the task's worktree, which the builder still has to commit.
 */
export interface RatchetDetails {
  label: string;
  limit: 'floor' | 'ceiling';
  value: number;
  floor: number | null;
  base: number | null;
  diff: number | null;
  raised?: { from: number | null; to: number };
}

/** A receipt's ratchet numbers, when it's a ratchet's and it measured one. */
export function ratchetOf(r: Pick<Receipt, 'details'> | null | undefined): RatchetDetails | null {
  const d = r?.details?.ratchet as Partial<RatchetDetails> | undefined;
  return d && typeof d.value === 'number' && typeof d.label === 'string' && (d.limit === 'floor' || d.limit === 'ceiling') ? (d as RatchetDetails) : null;
}

/**
 * A skip satisfies a required gate: `lint` with no JavaScript changed has nothing to find, and a waived gate
 * is a skip a person chose. A hold, like a fail, doesn't (GH-100), nor does a ratchet whose better floor acc
 * wrote, until that floor is committed and checked (GH-99).
 */
export const satisfies = (r: Pick<Receipt, 'status' | 'details'> | null): boolean => (r?.status === 'pass' || r?.status === 'skip') && !ratchetOf(r)?.raised;

/**
 * Whether a receipt counts towards acc done (D-206): one that satisfies, unless it's a skip for a gate
 * that runs elsewhere. A deploy a refresh skipped on the branch's merge commit doesn't say the task
 * deployed; only the task's own deploy, or a person's waiver, does.
 */
export const countsForDone = (r: Pick<Receipt, 'status' | 'details' | 'elsewhere' | 'waived'> | null): boolean => satisfies(r) && (!r?.elsewhere || !!r.waived);

/**
 * Whether a gate that runs elsewhere (D-206) was run by the task itself on `head` or a commit before it:
 * a deploy the task recorded, to its own environment, whose commit is an ancestor of `head`, with a
 * passing receipt of the task's own there. So a refresh's merge commit, or the merge queue's, carries the
 * deploy its branch made, and land and merge take the skip recorded on it. Only the deploy gate records
 * where the task ran it (`task.deploys`); another gate that says elsewhere has no record, and stays missing.
 */
export function ownRunBefore(paths: RepoPaths, run: Runner, task: Pick<Task, 'environment' | 'deploys'>, head: string, gate: string): boolean {
  if (gate !== DEPLOY_GATE) return false;
  for (const d of task.deploys ?? []) {
    if (d.env !== task.environment || !countsForDone(readReceipt(paths, d.sha, gate))) continue;
    if (run('git', ['merge-base', '--is-ancestor', d.sha, head], { cwd: paths.root }).code === 0) return true;
  }
  return false;
}

/**
 * Whether the task's own deploy to its environment passed on `sha` itself (T-157): a deploy the task recorded
 * there, with a passing receipt of its own, never a skip recorded elsewhere. Autopilot's merge asks this of the
 * commit the review read, so a branch never merges with a commit after its last deploy: what the reviewer read
 * is what the org holds. Land takes a deploy on an ancestor (`ownRunBefore`); the merge doesn't.
 */
export function ownDeployAt(paths: RepoPaths, task: Pick<Task, 'environment' | 'deploys'>, sha: string): boolean {
  return !!sha && (task.deploys ?? []).some((d) => d.sha === sha && d.env === task.environment && countsForDone(readReceipt(paths, d.sha, DEPLOY_GATE)));
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
 * queue runs the full ones before the merge, and the full ones cover them; a merge needs the full ones. A
 * gate that runs elsewhere (D-206) is settled by the task's own run on this commit or one before it,
 * unless `own` asks for one on this very commit, as a builder's acc done does.
 */
export function receiptHooks(paths: RepoPaths, config: Config, run: Runner): Hooks {
  return {
    missingGates(task: Task, scope: GateScope = 'builder', opts: { own?: boolean } = {}): string[] {
      const required = requiredGates(config, task.environment, scope);
      if (!required.length) return [];
      const branch = task.run?.branch;
      if (!branch) return required;
      const sha = run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: paths.root });
      if (sha.code !== 0) return required;
      const head = sha.stdout.trim();
      const passed = (g: string) => {
        const r = readReceipt(paths, head, g);
        return countsForDone(r) || (!opts.own && satisfies(r) && ownRunBefore(paths, run, task, head, g));
      };
      const missing = required.filter((g) => !passed(g));
      // The full check passed on this commit, as the queue runs it on its merge: that covers a builder's. When
      // the two lists are the same, what's missing is in both, so the full check can't have passed.
      const full = fullGates(config);
      if (missing.length && full.length && full.every(passed)) return [];
      return missing;
    },
  };
}
