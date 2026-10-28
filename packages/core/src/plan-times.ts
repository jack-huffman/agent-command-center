import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from './atomic.ts';
import type { RepoPaths } from './paths.ts';

/**
 * How long a project's plans take (T-131): each plan's duration, recorded as it ends, so the Command Center can
 * say how long plans usually take there. Kept beside the plans, the newest last; only the last PLAN_TIMES_KEPT.
 */

export interface PlanTime {
  task: string;
  /** How long the planning agent took, from its start to the plan saved. */
  ms: number;
  at: string;
}

/** How many durations are kept: enough for a fair middle, few enough that an old way of working drops out. */
export const PLAN_TIMES_KEPT = 20;

/** How many plans a project needs before it says how long they usually take: fewer is a guess. */
export const PLAN_TIMES_MIN = 3;

const timesPath = (paths: Pick<RepoPaths, 'analyses'>): string => join(paths.analyses, 'plan-times.json');

/** The project's recorded plan durations, oldest first; none when the file is missing or isn't a list of them. */
export function planTimes(paths: Pick<RepoPaths, 'analyses'>): PlanTime[] {
  try {
    const r = JSON.parse(readFileSync(timesPath(paths), 'utf8')) as unknown;
    return Array.isArray(r) ? r.filter((x): x is PlanTime => !!x && typeof x.task === 'string' && typeof x.ms === 'number' && x.ms > 0 && typeof x.at === 'string') : [];
  } catch {
    return [];
  }
}

/** Records a plan's duration as it ends: written whole, so another process never reads half a file. */
export function recordPlanTime(paths: Pick<RepoPaths, 'analyses'>, t: PlanTime): void {
  if (!(t.ms > 0)) return;
  mkdirSync(paths.analyses, { recursive: true });
  writeAtomic(timesPath(paths), `${JSON.stringify([...planTimes(paths), t].slice(-PLAN_TIMES_KEPT), null, 2)}\n`);
}

/** How long plans usually take, as the middle of the recorded durations; null with fewer than PLAN_TIMES_MIN. */
export function typicalPlanMs(times: readonly Pick<PlanTime, 'ms'>[]): number | null {
  if (times.length < PLAN_TIMES_MIN) return null;
  const xs = times.map((t) => t.ms).sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid]! : Math.round((xs[mid - 1]! + xs[mid]!) / 2);
}
