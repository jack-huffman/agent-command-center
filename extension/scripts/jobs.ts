/**
 * The screenshot run's jobs (T-58): it draws K pages at once, each job in its own Chrome with its own
 * profile and output folders, and the behaviour cases and mutants run in a pool of K. Results come back in
 * the order they'd have come one at a time, so the log and what's noted are the same whatever K is.
 */
import { spawn } from 'node:child_process';
import { stop, track } from './stops.ts';

/** How many jobs or slots k gives for n items: a whole number, at least 1, at most n. */
const slotsFor = (k: number, n: number): number => Math.min(Math.max(1, Math.floor(k) || 1), n);

/** How many pages the run draws at once unless --jobs says. */
export const DEFAULT_JOBS = 3;

/** --jobs as a count: DEFAULT_JOBS when it isn't given, null when it isn't a whole number of 1 or more. */
export function jobsOption(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_JOBS;
  const n = Number(raw);
  return /^\d+$/.test(raw.trim()) && Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * Splits items into at most k jobs whose costs are close: each item, dearest first, goes to the job with
 * the least so far. Each item is in one job only, and each job keeps the items' own order. No items give no
 * jobs, and a k below 1 is taken as 1.
 */
export function splitJobs<T>(items: readonly T[], k: number, cost: (item: T) => number = () => 1): T[][] {
  const n = slotsFor(k, items.length);
  const jobs = Array.from({ length: n }, () => ({ load: 0, at: [] as number[] }));
  const dearest = items.map((_, i) => i).sort((a, b) => cost(items[b]!) - cost(items[a]!) || a - b);
  for (const i of dearest) {
    const job = jobs.reduce((least, j) => (j.load < least.load ? j : least));
    job.at.push(i);
    job.load += cost(items[i]!);
  }
  return jobs.map((j) => j.at.sort((a, b) => a - b).map((i) => items[i]!));
}

/** Hands results on in their items' order as they finish in any order: each one once all before it have. */
export function inOrder<R>(emit: (result: R, index: number) => void): (index: number, result: R) => void {
  const held = new Map<number, R>();
  let next = 0;
  return (index, result) => {
    held.set(index, result);
    while (held.has(next)) {
      const r = held.get(next)!;
      held.delete(next);
      emit(r, next++);
    }
  };
}

/** Waits for every job, then throws the first one's error if any threw, so no job is left running. */
async function settled(jobs: Promise<unknown>[]): Promise<void> {
  const failed = (await Promise.allSettled(jobs)).find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
}

/**
 * Splits items into k jobs (splitJobs) and runs each job's items one after another, the jobs at once.
 * work gets the job's slot, 0 to k - 1, for its own folders; emit gets each result in the items' order.
 */
export async function runJobs<T, R>(items: readonly T[], k: number, work: (item: T, slot: number) => Promise<R>, emit: (result: R, index: number) => void = () => {}, cost: (item: T) => number = () => 1): Promise<R[]> {
  const results: R[] = [];
  const done = inOrder<R>((r, i) => { results[i] = r; emit(r, i); });
  const indexed = items.map((item, index) => ({ item, index }));
  await settled(splitJobs(indexed, k, (x) => cost(x.item)).map(async (job, slot) => {
    for (const { item, index } of job) done(index, await work(item, slot));
  }));
  return results;
}

/**
 * Runs work on every item, at most k at once: each of k slots takes the next item not yet started, so a
 * slot's folders are only ever used by one item at a time. emit gets each result in the items' order.
 * When an item fails, the other items still run, and the first failure is thrown at the end; the test
 * support's pool, which stops at the first failure, is kept apart for that (jobs.test.ts pins both).
 */
export async function pool<T, R>(items: readonly T[], k: number, work: (item: T, slot: number, index: number) => Promise<R>, emit: (result: R, index: number) => void = () => {}): Promise<R[]> {
  const results: R[] = [];
  const done = inOrder<R>((r, i) => { results[i] = r; emit(r, i); });
  let next = 0;
  const slots = slotsFor(k, items.length);
  await settled(Array.from({ length: slots }, async (_, slot) => {
    while (next < items.length) {
      const i = next++;
      done(i, await work(items[i]!, slot, i));
    }
  }));
  return results;
}

/** What a run of a program gave, as spawnSync gives it: error when it couldn't be run or didn't finish in time. */
export interface Ran { status: number | null; signal: NodeJS.Signals | null; stdout: string; error?: Error; stderr?: string }

/**
 * Runs a program without blocking, for at most timeout ms, gathering what it prints. When time runs out it
 * is sent SIGTERM and the error's code is ETIMEDOUT, as spawnSync's is, so drawRetried draws it again.
 * It runs in a process group of its own, tracked until it closes, so a run that stops stops it and its
 * helpers too (T-68).
 */
export function runAsync(cmd: string, args: string[], timeout: number): Promise<Ran> {
  return new Promise((resolve) => {
    let finished = false;
    const done = (r: Ran): void => { if (!finished) { finished = true; clearTimeout(timer); resolve(r); } };
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    track(child);
    const out: Buffer[] = [];
    // What it says on stderr, so a Chrome that can't start says why (T-108); only the first 64 KB is kept.
    const said: Buffer[] = [];
    let saidBytes = 0;
    let error: Error | undefined;
    const timer = setTimeout(() => {
      error = Object.assign(new Error(`spawn ${cmd} ETIMEDOUT`), { code: 'ETIMEDOUT' });
      stop(child);
    }, timeout);
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.on('data', (b: Buffer) => { if (saidBytes < 65536) { said.push(b); saidBytes += b.length; } });
    // It couldn't be started at all, such as a Chrome that isn't there: what close says after is ignored.
    child.on('error', (e) => done({ status: null, signal: null, stdout: '', error: error ?? e }));
    child.on('close', (status, signal) => done({ status, signal, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(said).toString('utf8'), ...(error ? { error } : {}) }));
  });
}
