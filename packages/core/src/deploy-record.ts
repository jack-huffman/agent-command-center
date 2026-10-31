/**
 * Where a ticket's work went, by acc's own record (T-167): every deploy goes through acc (the builder's deploy
 * gate to its development org, D-244, and the deploy guide past it, D-239), so the ticket keeps each deploy,
 * each deploy that failed, and each promotion that merged. Its Changes tab draws each environment's row from this
 * alone, and never reads an org to draw it.
 */
import type { TaskDeploy } from './deploy-gate.ts';
import { mutate, type Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';

/** A deploy that failed: where, when, and why in words. `by` and `checkId` are there for the deploy guide's, as on a deploy. */
export interface TaskDeployFailure {
  env: string;
  org: string;
  at: string;
  reason: string;
  by?: string;
  checkId?: string;
}

/** An environment's state by acc's record: deployed, its last deploy failed, merged into its branch alone, or none of them. */
export const RECORD_STATES = ['deployed', 'failed', 'merged', 'not-deployed'] as const;
export type RecordState = (typeof RECORD_STATES)[number];

/** Who deployed it: a builder's deploy gate to its own org, or the deploy guide's agent past it. */
export type Deployer = 'builder' | 'guide';

export interface EnvRecord {
  state: RecordState;
  /** When it got there, or the deploy failed; null when it's not deployed, or merged with no time kept. */
  at: string | null;
  /** Who deployed it, or whose deploy failed; null for merged and not deployed. */
  by: Deployer | null;
  /** Why the deploy failed, in one line; null for the rest. */
  reason: string | null;
}

/** A deploy's or a failure's deployer: the deploy guide's carries the person's check (T-137), a builder's doesn't. */
const deployer = (x: { checkId?: string }): Deployer => (x.checkId ? 'guide' : 'builder');

/** The first line of a reason, trimmed: a row says it on one line. */
export const oneLine = (s: string): string => s.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';

/**
 * What acc recorded of the ticket in `env`: its latest deploy there, or its latest failed deploy if that came
 * after; else merged where a promotion to it merged (or, for its own environment, its pull request); else not
 * deployed.
 */
export function envRecord(t: Pick<Task, 'environment' | 'deploys' | 'deployFailures' | 'promotions' | 'pr'>, env: string): EnvRecord {
  const done: TaskDeploy | undefined = (t.deploys ?? []).filter((d) => d.env === env).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  const failed = (t.deployFailures ?? []).filter((f) => f.env === env).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  if (failed && (!done || failed.at > done.at)) return { state: 'failed', at: failed.at, by: deployer(failed), reason: oneLine(failed.reason) };
  if (done) return { state: 'deployed', at: done.at, by: deployer(done), reason: null };
  const merges = (t.promotions ?? []).filter((p) => p.state === 'merged' && p.to === env).map((p) => p.mergedAt ?? p.at).sort();
  if (merges.length) return { state: 'merged', at: merges.at(-1)!, by: null, reason: null };
  if (env === t.environment && t.pr?.state === 'merged') return { state: 'merged', at: null, by: null, reason: null };
  return { state: 'not-deployed', at: null, by: null, reason: null };
}

/** Keeps a deploy that failed on its task, so its row says so. Nothing without a task, or one the ledger doesn't hold. */
export function recordDeployFailure(paths: RepoPaths, now: () => Date, task: string | undefined, failure: TaskDeployFailure, actor: 'builder' | 'human' = 'builder'): TaskDeployFailure | null {
  if (!task) return null;
  return mutate(paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === task);
    if (!t) return null;
    t.deployFailures = [...(t.deployFailures ?? []), failure];
    emit({ type: 'task.updated', task: t.id, actor, by: failure.by ?? `builder:${t.id}`, data: { deployFailed: failure } });
    return failure;
  });
}
