// Limits and checks (GH-111): how many builders a project runs at once (agents.max), how many this machine
// runs across every repo, and the checks a task must pass. A person sets each through acc, which changes
// only that key; Settings in the Command Center shows them, with what a change means, from this machine's
// own numbers.

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { loadConfig, STRAY_FILES } from './config.ts';
import { writeJsonKey } from './config-edit.ts';
import { AccError } from './exec.ts';
import { gatesFor } from './gates.ts';
import { builders, type Ledger, readLedger } from './ledger.ts';
import { machineDir, readMachineKey, setMachineKey } from './machine.ts';
import type { RepoPaths } from './paths.ts';

// ---------------------------------------------------------------- this project's (.acc/config.json)

/** The most builders a project may run at once, as the config allows (agents.max). */
export const MAX_AGENTS = 16;
/** A project's cap when its config sets none. */
export const DEFAULT_AGENTS = 3;

/**
 * Sets the project's builder cap, `agents.max`, in .acc/config.json, changing nothing else in the file. Nobody
 * else sees it until it's committed.
 */
export function setAgentsMax(configFile: string, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > MAX_AGENTS) throw new AccError('usage', `A project's builder cap is a whole number from 1 to ${MAX_AGENTS}.`);
  writeJsonKey(configFile, ['agents', 'max'], n);
  return n;
}

/** Whether the project's config names a key, such as ['gates', 'required'], or leaves it to acc's default. */
export function configSets(configFile: string, key: string[]): boolean {
  try {
    let v: unknown = JSON.parse(readFileSync(configFile, 'utf8'));
    for (const k of key) v = v && typeof v === 'object' && Object.hasOwn(v, k) ? (v as Record<string, unknown>)[k] : undefined;
    return v !== undefined;
  } catch {
    return false;
  }
}

/** Whether the project's config names its cap, or leaves it to acc's default. */
export const agentsMaxSet = (configFile: string): boolean => configSets(configFile, ['agents', 'max']);

/** Names, each once, in the order given; every one a check the project has. */
function gateNames(configFile: string, names: string[], what: string): string[] {
  const { config } = loadConfig(configFile);
  // stray-files is on unless strayFiles.required turns it off (GH-103): it isn't named in either list.
  const known = gatesFor(config).map((g) => g.name).filter((n) => n !== STRAY_FILES);
  const list = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (list.includes(STRAY_FILES)) throw new AccError('usage', `${STRAY_FILES} is required unless "strayFiles": { "required": false } turns it off in .acc/config.json, so it isn't named here. ${what} from: ${known.join(', ') || 'none yet'}.`);
  const unknown = list.filter((n) => !known.includes(n));
  if (unknown.length) {
    throw new AccError('usage', `${unknown.join(', ')} ${unknown.length === 1 ? 'isn\'t a check' : 'aren\'t checks'} this project has. ${what} from: ${known.join(', ') || 'none yet. Add commands under "gates.commands" in .acc/config.json'}.`);
  }
  return list;
}

/**
 * Sets the checks every task must pass, `gates.required`, in .acc/config.json, changing nothing else. Where
 * the merge queue runs, these are its full check, run once before each merge (D-096).
 */
export function setRequiredGates(configFile: string, names: string[]): string[] {
  const list = gateNames(configFile, names, 'Name the required checks');
  if (!list.length) throw new AccError('usage', 'Name at least one check: acc gate required <name>…');
  writeJsonKey(configFile, ['gates', 'required'], list);
  return list;
}

/**
 * Sets builders' lighter checks, `gates.builder`, where the merge queue runs the required ones (D-096), or,
 * with null, takes them out, so builders run the required checks everywhere. Nothing else in the file changes.
 */
export function setBuilderGates(configFile: string, names: string[] | null): string[] | null {
  if (names === null) {
    writeJsonKey(configFile, ['gates', 'builder'], undefined);
    return null;
  }
  const list = gateNames(configFile, names, 'Name builders\' checks');
  if (!list.length) throw new AccError('usage', 'Name at least one check, or say --none: acc gate builder <name>… | --none');
  writeJsonKey(configFile, ['gates', 'builder'], list);
  return list;
}

// ---------------------------------------------------------------- this machine's (~/.acc)

/** The most builders a machine may be set to run at once, across every repo on it. */
export const MAX_MACHINE_AGENTS = 64;

const agentCount = (v: unknown): number | null => (Number.isInteger(v) && (v as number) >= 1 ? Math.min(MAX_MACHINE_AGENTS, v as number) : null);

/**
 * How many builders this machine runs at once, across every repo on it: `agents` in ~/.acc/machine.json,
 * beside its heavy-check slots (D-080). Unset, there's no total, and each project's cap is the only limit.
 */
export function machineAgents(env: NodeJS.ProcessEnv = process.env): number | null {
  return agentCount(readMachineKey('agents', env));
}

/**
 * Sets this machine's total in machine.json, or, with null, takes it out, keeping what else the file holds.
 * It writes where machineAgents reads, and refuses where that's nowhere.
 */
export function setMachineAgents(n: number | null, env: NodeJS.ProcessEnv = process.env): number | null {
  if (n !== null && (!Number.isInteger(n) || n < 1 || n > MAX_MACHINE_AGENTS)) {
    throw new AccError('usage', `This machine's total is a whole number from 1 to ${MAX_MACHINE_AGENTS}, or --none for no total.`);
  }
  setMachineKey('agents', n ?? undefined, env);
  return n;
}

// ---------------------------------------------------------------- every repo's builders on this machine

/** Where acc notes each repo on this machine that has run a builder, a file each, so the total can count them all. */
export const ledgersDir = (env: NodeJS.ProcessEnv = process.env): string | null => (machineDir(env) ? join(machineDir(env)!, 'ledgers') : null);

/** A ledger however it's reached, so one repo is one entry, and the Command Center counts it once. */
export function realLedger(file: string): string {
  try {
    return join(realpathSync(dirname(file)), basename(file));
  } catch {
    return file;
  }
}

const entryName = (ledger: string): string => `${createHash('sha256').update(ledger).digest('hex').slice(0, 16)}.json`;

/**
 * Notes this repo as one that runs builders on this machine, once: its ledger, and its project's name. Every
 * worktree of a repo shares the one ledger (D-008), so a repo is one entry however many clones it has
 * worktrees in. Never fails what called it: without a note, its builders only go uncounted elsewhere.
 */
export function registerLedger(ledger: string, project: string, env: NodeJS.ProcessEnv = process.env): void {
  const dir = ledgersDir(env);
  if (!dir) return;
  const path = realLedger(ledger);
  const file = join(dir, entryName(path));
  try {
    statSync(file);
    return;
  } catch {
    // not noted yet
  }
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify({ ledger: path, project }) + '\n');
    renameSync(`${file}.${process.pid}.tmp`, file);
  } catch {
    // counted from its next dispatch
  }
}

/** One repo's builders on this machine: its project, its ledger, and how many of its tasks are running. */
export interface RepoBuilders {
  project: string;
  ledger: string;
  running: number;
}

/**
 * The builders running in each repo noted on this machine: tasks in Running, as each repo's own cap counts
 * them, whose builder may have stopped (D-067). A repo whose ledger has gone, or one this acc can't read, is
 * left out. `except` leaves out one ledger, such as the repo asking. `prune` also deletes the note of a repo
 * whose ledger has gone: only acc's own commands turn it on, since the Command Center only reads (D-012).
 */
export function machineRepos(env: NodeJS.ProcessEnv = process.env, { except, prune = false }: { except?: string; prune?: boolean } = {}): RepoBuilders[] {
  const dir = ledgersDir(env);
  if (!dir) return [];
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const skip = except ? realLedger(except) : null;
  const out: RepoBuilders[] = [];
  for (const n of names.sort()) {
    let entry: { ledger?: unknown; project?: unknown };
    try {
      entry = JSON.parse(readFileSync(join(dir, n), 'utf8'));
    } catch {
      continue;
    }
    if (typeof entry.ledger !== 'string' || entry.ledger === skip) continue;
    let ledger: Ledger;
    try {
      statSync(entry.ledger);
    } catch {
      if (prune) rmSync(join(dir, n), { force: true });
      continue;
    }
    try {
      ledger = readLedger(entry.ledger);
    } catch {
      continue;
    }
    out.push({ project: typeof entry.project === 'string' ? entry.project : basename(dirname(dirname(dirname(entry.ledger)))), ledger: entry.ledger, running: builders(ledger, '') });
  }
  return out;
}

/** This machine's total, and the builders running elsewhere on it, as a start in one repo weighs them. */
export interface MachineLoad {
  /** At most this many builders at once across every repo, or null for no total. */
  max: number | null;
  /** Builders running in the machine's other repos. */
  elsewhere: number;
}

/**
 * What a start in this repo weighs, beside the project's cap: this machine's total, and the builders running
 * in its other repos, read only when there's a total. It notes this repo first, so its builders count when
 * another repo asks.
 */
export function machineLoad(paths: Pick<RepoPaths, 'ledger'>, project: string, env: NodeJS.ProcessEnv = process.env): MachineLoad {
  registerLedger(paths.ledger, project, env);
  const max = machineAgents(env);
  if (max === null) return { max, elsewhere: 0 };
  return { max, elsewhere: machineRepos(env, { except: paths.ledger, prune: true }).reduce((n, r) => n + r.running, 0) };
}

/** "1 builder is", "3 builders are". */
const buildersAre = (n: number): string => `${n} ${n === 1 ? 'builder is' : 'builders are'}`;

/** A start that would pass this machine's total, in words that name it (GH-111). */
export const machineCapWords = (n: number, max: number): string => `${buildersAre(n)} running on this machine, across every repo, and its total is ${max} (acc machine agents).`;

/**
 * Why another builder can't start beside those running, for this machine's total, or null. The project's
 * own cap is the ledger's rule (checkMove's underCap); this is the machine's, which no one ledger knows.
 */
export function machineCapProblem(ledger: Ledger, except: string, machine: MachineLoad | null): string | null {
  if (!machine || machine.max === null) return null;
  const n = builders(ledger, except) + machine.elsewhere;
  return n >= machine.max ? machineCapWords(n, machine.max) : null;
}

// ---------------------------------------------------------------- what this machine's numbers say

/** How long builders took lately, and what reviews and analyses cost: what a change to the caps means, in this repo's own numbers. */
export interface RecentWork {
  /** Each recent builder run, dispatch to acc done, newest first: how long it took. */
  builds: number[];
  /** Recent reviews' and analyses' recorded cost, newest first: Claude Code's estimate at API prices. */
  reviews: number[];
  analyses: number[];
}

/** How many of each it looks at: lately, not ever. */
export const RECENT = 10;

/** Its newest records, by when each file was written. */
function newest(dir: string, keep: (name: string) => boolean): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json') && keep(n));
  } catch {
    return [];
  }
  const stamped = names.flatMap((n) => {
    try {
      return [{ n, at: statSync(join(dir, n)).mtimeMs }];
    } catch {
      return [];
    }
  });
  return stamped.sort((a, b) => b.at - a.at).map((s) => join(dir, s.n));
}

/** The recorded costs of a folder's newest records, up to RECENT that have one. */
function costs(files: string[]): number[] {
  const out: number[] = [];
  for (const f of files) {
    if (out.length >= RECENT) break;
    try {
      const c = (JSON.parse(readFileSync(f, 'utf8')) as { costUsd?: unknown }).costUsd;
      if (typeof c === 'number' && Number.isFinite(c) && c >= 0) out.push(c);
    } catch {
      // a record being written, or not one
    }
  }
  return out;
}

/**
 * A repo's recent work: each builder run's time from its dispatch to its acc done, from the ledger's
 * moves, and what its newest reviews and analyses cost.
 */
export function recentWork(paths: Pick<RepoPaths, 'reviews' | 'analyses'>, ledger: Ledger): RecentWork {
  const runs: { end: number; ms: number }[] = [];
  for (const t of ledger.tasks) {
    let start: number | null = null;
    for (const h of t.history) {
      if (h.to === 'running') start = Date.parse(h.at);
      else if (h.from === 'running' && h.to === 'review' && start !== null) {
        const end = Date.parse(h.at);
        if (end >= start) runs.push({ end, ms: end - start });
        start = null;
      } else if (h.from === 'running') start = null;
    }
  }
  return {
    builds: runs.sort((a, b) => b.end - a.end).slice(0, RECENT).map((r) => r.ms),
    reviews: costs(newest(paths.reviews, (n) => !n.endsWith('.running.json'))),
    analyses: costs(newest(paths.analyses, (n) => !n.endsWith('.running.json'))),
  };
}

/** The middle of some numbers, or null with none. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

