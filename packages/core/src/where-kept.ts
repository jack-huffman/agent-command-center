/**
 * Where a ticket's work is, as acc last read it (T-155): one reading per environment on its path, kept beside
 * the ledger in `where/<task>.json`. A page reads this file and never waits on an org; `acc where` writes it.
 * A reading is read again when it's older than WHERE_MAX_AGE_MS, or older than a deploy or promotion of its
 * environment acc recorded since.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileId } from './analyze.ts';
import { writeAtomic } from './atomic.ts';
import { type Config, type Environment, environmentByBranch } from './config.ts';
import type { Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';

/** One environment's state: all the ticket's work there, some of it, none, or acc can't tell. */
export const WHERE_STATES = ['deployed', 'partly', 'not-deployed', 'unknown'] as const;
export type WhereState = (typeof WHERE_STATES)[number];

/** What one oracle (git or the org) found in one environment, and when. */
export interface Reading {
  state: WhereState;
  /** Each component that differs from the ticket's, by its label and name: for partly and not deployed. */
  differs: string[];
  /** Why it can't tell, in words; null when it can. */
  why: string | null;
  at: string;
}

/** One environment on the ticket's path: its one state, from the org, with git's reading beside it. */
export interface EnvWhere extends Reading {
  env: string;
  name: string;
  git: Reading;
  org: Reading;
  /** Environment-specific files (D-016), left out of both readings. */
  leftOut: string[];
  /** Components the org couldn't be asked for, so they count neither way. */
  unchecked: string[];
  /** Where acc's own record, git and the org disagree, in words. */
  notes: string[];
}

export interface TicketWhere {
  v: 1;
  task: string;
  envs: EnvWhere[];
}

/** How old a reading may be before a page asks for it again: an hour. */
export const WHERE_MAX_AGE_MS = 60 * 60_000;

export const wherePath = (paths: Pick<RepoPaths, 'stateDir'>, task: string): string => join(paths.stateDir, 'where', `${fileId(task)}.json`);

/** The ticket's kept readings, or null before the first, or when the file isn't one acc wrote. */
export function readWhere(paths: Pick<RepoPaths, 'stateDir'>, task: string): TicketWhere | null {
  try {
    const w = JSON.parse(readFileSync(wherePath(paths, task), 'utf8')) as TicketWhere;
    return w.v === 1 && w.task === task && Array.isArray(w.envs) ? w : null;
  } catch {
    return null;
  }
}

/** Keeps new readings: each replaces its environment's, and the others stay. Written whole, then renamed. */
export function keepWhere(paths: Pick<RepoPaths, 'stateDir'>, task: string, envs: EnvWhere[]): TicketWhere {
  const old = readWhere(paths, task)?.envs ?? [];
  const w: TicketWhere = { v: 1, task, envs: [...old.filter((o) => !envs.some((e) => e.env === o.env)), ...envs] };
  mkdirSync(join(paths.stateDir, 'where'), { recursive: true });
  writeAtomic(wherePath(paths, task), JSON.stringify(w, null, 2) + '\n');
  return w;
}

/**
 * The environments on the ticket's path whose reading is due: none yet, older than WHERE_MAX_AGE_MS, or older
 * than a deploy or a promotion acc recorded to it since.
 */
export function whereDue(w: TicketWhere | null, t: Pick<Task, 'promotions' | 'deploys'>, envs: string[], now: Date): string[] {
  return envs.filter((env) => {
    const r = w?.envs.find((e) => e.env === env);
    if (!r) return true;
    if (now.getTime() - Date.parse(r.at) > WHERE_MAX_AGE_MS) return true;
    const since = [...(t.deploys ?? []).filter((d) => d.env === env).map((d) => d.at), ...(t.promotions ?? []).filter((p) => p.to === env).map((p) => p.mergedAt ?? p.at)];
    return since.some((at) => at > r.at);
  });
}

/** The environments from `start`, each one's usual next step, to the end of the path. */
export function pathFrom(envs: Environment[], start: string): Environment[] {
  const out: Environment[] = [];
  let at = envs.find((e) => e.branch === start || e.name === start);
  while (at && !out.includes(at)) {
    out.push(at);
    const next = at.promotesTo[0];
    at = next ? envs.find((e) => e.branch === next) : undefined;
  }
  return out;
}

/** Whether `to` is somewhere after `from`, along any of the steps the settings allow. */
export function isAfter(config: Pick<Config, 'environments'>, from: Environment, to: string): boolean {
  const seen = new Set<string>();
  const todo = [...from.promotesTo];
  while (todo.length) {
    const b = todo.shift()!;
    if (b === to) return true;
    if (seen.has(b)) continue;
    seen.add(b);
    todo.push(...(environmentByBranch(config, b)?.promotesTo ?? []));
  }
  return false;
}

/**
 * Where the ticket is, taking in what the orgs hold: from `at`, the furthest environment after it that a
 * reading found the ticket deployed in. A reading never takes it back: a disagreement is said, not acted on.
 */
export function furthestRead(config: Pick<Config, 'environments'>, at: Environment, w: Pick<TicketWhere, 'envs'> | null | undefined): Environment {
  let here = at;
  for (const r of w?.envs ?? []) {
    if (r.state !== 'deployed') continue;
    const e = environmentByBranch(config, r.env);
    if (e && isAfter(config, here, e.branch)) here = e;
  }
  return here;
}
