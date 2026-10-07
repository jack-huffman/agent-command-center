/**
 * Work under way that leaves no other mark until it ends (D-092): a land, a refresh, a promotion, a deploy,
 * and the step autopilot is taking. Each writes a marker beside the ledger while it runs, and removes it
 * when it ends, however it ends, so every window shows it, wherever it was started (D-012: acc writes, the
 * Command Center reads). A marker whose process has gone is ignored, and cleared by the next one written.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTOPILOT_STEPS, type AutopilotStepName } from './ledger.ts';
import { alive } from './lock.ts';
import type { RepoPaths } from './paths.ts';

export const JOB_KINDS = ['land', 'refresh', 'promote', 'deploy', 'autopilot'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export interface JobStart {
  kind: JobKind;
  task?: string;
  /** A deploy's environment, or a promotion's destination, by branch. */
  env?: string;
  /** A promotion's source branch. */
  from?: string;
  /** The step autopilot is taking. */
  step?: AutopilotStepName;
  by: string;
}

export interface Job extends JobStart {
  /** Its marker's name, unique while it runs. */
  key: string;
  pid: number;
  startedAt: string;
}

export const jobsDir = (paths: Pick<RepoPaths, 'stateDir'>): string => join(paths.stateDir, 'jobs');
let marked = 0;

/** Every marker in the folder that reads as a job, live or not. */
function readJobs(paths: Pick<RepoPaths, 'stateDir'>): Job[] {
  const dir = jobsDir(paths);
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out: Job[] = [];
  for (const n of names) {
    try {
      const j = JSON.parse(readFileSync(join(dir, n), 'utf8')) as Job;
      if (!(JOB_KINDS as readonly string[]).includes(j.kind) || !Number.isInteger(j.pid) || j.pid <= 0 || typeof j.startedAt !== 'string') continue;
      if (j.step !== undefined && !(AUTOPILOT_STEPS as readonly string[]).includes(j.step)) continue;
      out.push({ ...j, key: n.slice(0, -5) });
    } catch {
      // half-written, or removed while we looked
    }
  }
  return out;
}

/** Writes a job's marker and returns its key. Markers left by processes that have gone are cleared first. */
export function startJob(paths: Pick<RepoPaths, 'stateDir'>, job: JobStart, now: () => Date = () => new Date()): string {
  const dir = jobsDir(paths);
  mkdirSync(dir, { recursive: true });
  for (const old of readJobs(paths)) if (!alive(old.pid)) rmSync(join(dir, `${old.key}.json`), { force: true });
  const key = `${job.kind}-${job.task ?? job.env ?? 'repo'}-${process.pid}-${++marked}`.replace(/[^\w.-]/g, '_');
  const file = join(dir, `${key}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify({ ...job, key, pid: process.pid, startedAt: now().toISOString() }) + '\n');
  renameSync(`${file}.tmp`, file);
  return key;
}

export function endJob(paths: Pick<RepoPaths, 'stateDir'>, key: string): void {
  rmSync(join(jobsDir(paths), `${key}.json`), { force: true });
}

/** Runs `fn` with a marker saying it's under way. A marker that can't be written never stops the work. */
export function withJob<T>(paths: Pick<RepoPaths, 'stateDir'>, job: JobStart, fn: () => T, now?: () => Date): T {
  let key: string | null = null;
  try {
    key = startJob(paths, job, now);
  } catch {
    key = null;
  }
  try {
    return fn();
  } finally {
    if (key) endJob(paths, key);
  }
}

/** The jobs under way in a repo, oldest first: those whose process is still running. Only reads. */
export function jobsUnderWay(paths: Pick<RepoPaths, 'stateDir'>): Job[] {
  return readJobs(paths).filter((j) => alive(j.pid)).sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.key.localeCompare(b.key));
}
