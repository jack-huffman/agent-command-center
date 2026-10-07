import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AccError } from './exec.ts';
import { alive, sleep } from './lock.ts';

/**
 * What holds a slot, or waits for one, written beside its pid, so the Command Center can say which task or
 * environment each heavy check runs for (D-092). An acc from before this writes only its pid.
 */
export interface SlotOwner {
  /** What it runs, in a few words: a gate's name, "Deploy dev", "Validate dev → qa". */
  what: string;
  task?: string;
  /** An environment's branch, for work that belongs to one rather than to a task (D-034). */
  env?: string;
  project?: string;
  cwd?: string;
}

export interface SlotOptions {
  /** The folder holding the slots. Machine-wide by default, so every repo and worktree shares it. */
  dir?: string;
  slots?: number;
  timeoutMs?: number;
  pollMs?: number;
  /** Called once, when the first attempt finds every slot taken, or kept for those waiting longer. */
  onWait?: () => void;
  owner?: SlotOwner;
}

export const heavyDir = (env: NodeJS.ProcessEnv = process.env): string => env.ACC_HEAVY_DIR || join(homedir(), '.acc', 'heavy');
/** This machine's own settings, shared by every repo and worktree on it (D-080). */
export const machineFile = (env: NodeJS.ProcessEnv = process.env): string => env.ACC_MACHINE_FILE || join(homedir(), '.acc', 'machine.json');

/** The most heavy checks a machine may run at once, whatever it's set to. */
export const MAX_HEAVY_SLOTS = 8;

const slotCount = (v: unknown): number | null => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(MAX_HEAVY_SLOTS, n) : null;
};

/** How many heavy checks may run at once on this machine: ACC_HEAVY_SLOTS, else machine.json's heavySlots, else one (D-024, D-080). */
export function heavySlots(env: NodeJS.ProcessEnv = process.env): number {
  const fromEnv = slotCount(env.ACC_HEAVY_SLOTS);
  if (fromEnv) return fromEnv;
  try {
    return slotCount((JSON.parse(readFileSync(machineFile(env), 'utf8')) as { heavySlots?: unknown }).heavySlots) ?? 1;
  } catch {
    return 1;
  }
}

/** Sets this machine's heavy-check slots in machine.json, keeping what else it holds. */
export function setHeavySlots(n: number, env: NodeJS.ProcessEnv = process.env): number {
  const slots = slotCount(n);
  if (!slots || slots !== n) throw new AccError('usage', `Heavy-check slots are a whole number from 1 to ${MAX_HEAVY_SLOTS}.`);
  const file = machineFile(env);
  let current: Record<string, unknown> = {};
  try { current = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { /* a new file */ }
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify({ ...current, heavySlots: slots }, null, 2) + '\n');
  renameSync(`${file}.tmp`, file);
  return slots;
}

/** A slot whose owner file isn't written yet is being taken right now; past this age, its taker died. */
const UNOWNED_GRACE_MS = 10_000;

function take(slot: string, owner?: SlotOwner): boolean {
  try {
    mkdirSync(slot);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    return false;
  }
  writeFileSync(join(slot, 'owner'), JSON.stringify({ ...owner, pid: process.pid, at: Date.now() }));
  return true;
}

/** Frees a slot whose holder is gone: its process ended, or it never finished taking the slot. */
function reclaim(slot: string): void {
  let owner: { pid: number } | null = null;
  try {
    owner = JSON.parse(readFileSync(join(slot, 'owner'), 'utf8'));
  } catch {
    owner = null;
  }
  let age = 0;
  try {
    age = Date.now() - statSync(slot).mtimeMs;
  } catch {
    return; // released while we looked
  }
  if (owner ? !alive(owner.pid) : age > UNOWNED_GRACE_MS) rmSync(slot, { recursive: true, force: true });
}

/** The slots free right now, after freeing any whose holder is gone. */
function freeSlots(dir: string, slots: number): string[] {
  const free: string[] = [];
  for (let i = 0; i < slots; i++) {
    const slot = join(dir, `slot-${i}`);
    reclaim(slot);
    try {
      statSync(slot);
    } catch {
      free.push(slot);
    }
  }
  return free;
}

// ---------------------------------------------------------------- the line (D-092)

/**
 * Who waits for a slot: a file each under `waiting/`, touched every poll. A waiter whose process has gone,
 * or that stopped touching its file (suspended, or killed before its finally ran), loses its place.
 */
const waitingDir = (dir: string): string => join(dir, 'waiting');
/** A waiter that hasn't touched its file for this long has lost its place in line. */
const STALE_WAIT_MS = 15_000;
let waited = 0;

interface WaitFile extends Partial<SlotOwner> {
  pid: number;
  /** When it started waiting: its place in line. */
  at: number;
}

/** Those waiting for a slot whose process is alive and whose file is fresh, first come first. */
function liveWaiters(dir: string, staleMs: number, now = Date.now()): (WaitFile & { file: string })[] {
  const folder = waitingDir(dir);
  let names: string[] = [];
  try {
    names = readdirSync(folder).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out: (WaitFile & { file: string })[] = [];
  for (const name of names) {
    const file = join(folder, name);
    try {
      if (now - statSync(file).mtimeMs > staleMs) continue;
      const w = JSON.parse(readFileSync(file, 'utf8')) as WaitFile;
      if (Number.isInteger(w.pid) && w.pid > 0 && typeof w.at === 'number' && alive(w.pid)) out.push({ ...w, file });
    } catch {
      // gone while we looked, or half-written
    }
  }
  return out.sort((a, b) => a.at - b.at || a.file.localeCompare(b.file));
}

/**
 * Runs `fn` holding one of the machine's heavy-check slots (D-024), so a Salesforce validation or a
 * full build never runs alongside another. There's no age limit: a validation can take an hour, and
 * only a dead owner frees a slot early. Slots go first come, first served (D-092): a check takes a free
 * slot only while fewer have waited longer than there are slots free, so no newcomer jumps the line.
 */
export function withSlot<T>(fn: () => T, opts: SlotOptions = {}): T {
  const dir = opts.dir ?? heavyDir();
  const slots = opts.slots ?? heavySlots();
  const timeoutMs = opts.timeoutMs ?? 3 * 60 * 60_000;
  const pollMs = opts.pollMs ?? 500;
  const staleMs = Math.max(STALE_WAIT_MS, pollMs * 10);
  mkdirSync(dir, { recursive: true });
  const started = Date.now();
  let mine: string | null = null;
  let told = false;
  try {
    for (;;) {
      const free = freeSlots(dir, slots);
      const line = liveWaiters(dir, staleMs);
      // Ahead of it: those who came before it, once it's in line; every waiter until then.
      const place = mine ? line.findIndex((w) => w.file === mine) : -1;
      if (mine && place < 0) mine = null; // its file went: it joins again, at the back
      const ahead = place >= 0 ? place : line.length;
      if (ahead < free.length) {
        for (const slot of free) {
          if (!take(slot, opts.owner)) continue;
          if (mine) rmSync(mine, { force: true });
          mine = null;
          try {
            return fn();
          } finally {
            rmSync(slot, { recursive: true, force: true });
          }
        }
      }
      if (!mine) {
        mkdirSync(waitingDir(dir), { recursive: true });
        const file = join(waitingDir(dir), `${process.pid}-${++waited}.json`);
        writeFileSync(file, JSON.stringify({ ...opts.owner, pid: process.pid, at: Date.now() } satisfies WaitFile));
        mine = file;
        if (!told) {
          told = true;
          opts.onWait?.();
        }
      } else {
        // Still waiting: a waiter that stops touching its file loses its place.
        const t = new Date();
        try {
          utimesSync(mine, t, t);
        } catch {
          mine = null;
        }
      }
      if (Date.now() - started > timeoutMs) {
        throw new AccError('busy', `Every heavy-check slot in ${dir} stayed taken for ${Math.round(timeoutMs / 60_000)} minutes. If no check is running, delete that folder.`);
      }
      sleep(pollMs);
    }
  } finally {
    if (mine) rmSync(mine, { force: true });
  }
}

// ---------------------------------------------------------------- reading the slots (D-092)

export interface SlotHolder extends Partial<SlotOwner> {
  /** Which slot, from 1. */
  slot: number;
  pid: number;
  /** When it took the slot, or 0 when its owner file doesn't say. */
  at: number;
}

export interface SlotWaiter extends Partial<SlotOwner> {
  pid: number;
  /** When it started waiting. */
  at: number;
  /** Its place in line, from 1. */
  place: number;
}

export interface HeavyState {
  dir: string;
  /** How many slots this machine has. A slot held beyond them, after the count went down, is listed too. */
  slots: number;
  held: SlotHolder[];
  waiting: SlotWaiter[];
}

/** Only an owner's known fields, each a string: the file is any process's to write. */
function ownerOf(o: Record<string, unknown>): Partial<SlotOwner> {
  const out: Partial<SlotOwner> = {};
  for (const k of ['what', 'task', 'env', 'project', 'cwd'] as const) if (typeof o[k] === 'string' && o[k]) out[k] = o[k] as string;
  return out;
}

/**
 * Who holds each heavy-check slot and who waits, in order, for the Command Center (D-092). It only reads.
 * A slot an older acc took says only its pid; a slot being taken, with no owner yet, isn't listed.
 */
export function heavyState(opts: { dir?: string; slots?: number; env?: NodeJS.ProcessEnv; now?: number } = {}): HeavyState {
  const env = opts.env ?? process.env;
  const dir = opts.dir ?? heavyDir(env);
  const slots = opts.slots ?? heavySlots(env);
  const held: SlotHolder[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    // no heavy check has run on this machine yet
  }
  for (const name of names) {
    const m = /^slot-(\d+)$/.exec(name);
    if (!m) continue;
    try {
      const o = JSON.parse(readFileSync(join(dir, name, 'owner'), 'utf8')) as Record<string, unknown>;
      if (typeof o.pid !== 'number' || !alive(o.pid)) continue;
      held.push({ ...ownerOf(o), slot: Number(m[1]) + 1, pid: o.pid, at: typeof o.at === 'number' ? o.at : 0 });
    } catch {
      // being taken, or freed while we looked
    }
  }
  held.sort((a, b) => a.slot - b.slot);
  const waiting = liveWaiters(dir, STALE_WAIT_MS, opts.now).map((w, i) => ({ ...ownerOf(w as unknown as Record<string, unknown>), pid: w.pid, at: w.at, place: i + 1 }));
  return { dir, slots, held, waiting };
}
