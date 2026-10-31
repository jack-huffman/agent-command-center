/**
 * Where a ticket's work is, as acc last read it (T-155): one reading per environment, kept beside the ledger in
 * `where/<task>.json`. `acc where` writes it, and only when asked: a row's Check this org reads its one
 * environment (T-167). A page reads this file beside the row, as a note; it never moves the ticket, and no
 * draw, refresh or time reads an org.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileId } from './analyze.ts';
import { writeAtomic } from './atomic.ts';
import type { Config, Environment } from './config.ts';
import type { RepoPaths } from './paths.ts';
import { environmentsAhead } from './ticket-path.ts';

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

/**
 * The environments a ticket's work can be in (T-158): its path, then each environment off the usual way that
 * the ticket can still be deployed to, as Hotfix off QA, in the order environmentsAhead finds them.
 */
export function ticketEnvironments(config: Pick<Config, 'environments'>, start: string): Environment[] {
  const path = pathFrom(config.environments, start);
  const first = path[0];
  return first ? [...path, ...environmentsAhead(config, first).filter((e) => !path.includes(e))] : path;
}
