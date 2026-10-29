import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { alive } from './lock.ts';
import type { RepoPaths } from './paths.ts';
import { childEnv } from './start.ts';

/**
 * Keeping the Mac awake while acc's agents run (D-067). On 2026-10-05 GH-41's builder stopped when the
 * Mac went to sleep mid-response. On macOS acc holds `caffeinate -i -w <pid>` for as long as the agent's
 * process lives: only idle sleep is held off, so the display still sleeps and closing the lid still
 * sleeps the Mac. Other platforms aren't kept awake: nothing is started there, and nothing fails.
 */

/** How acc starts caffeinate. Tests put their own in, to see what it's asked to run. */
export type Spawner = (cmd: string, args: string[]) => { pid?: number; unref(): void };

export interface AwakeDeps {
  platform?: NodeJS.Platform;
  spawn?: Spawner;
  /** For tests: how a caffeinate is ended. */
  kill?: (pid: number) => void;
}

export interface Awake {
  /** The caffeinate process. */
  pid: number;
  release(): void;
}

const detached: Spawner = (cmd, args) => {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', env: childEnv() });
  // No caffeinate on PATH is only a Mac that may sleep, as on any other platform.
  child.on('error', () => undefined);
  return child;
};

const stop = (pid: number): void => {
  try {
    process.kill(pid);
  } catch {
    // already gone
  }
};

/**
 * Holds the machine awake while `watchPid` lives: `caffeinate -i -w <pid>`, detached, so it ends by
 * itself when that process does, even if acc has gone. Null off macOS, where nothing is started.
 */
export function holdAwake(watchPid: number, deps: AwakeDeps = {}): Awake | null {
  if ((deps.platform ?? process.platform) !== 'darwin' || !Number.isInteger(watchPid) || watchPid <= 0) return null;
  const child = (deps.spawn ?? detached)('caffeinate', ['-i', '-w', String(watchPid)]);
  child.unref();
  const pid = child.pid;
  if (!pid) return null;
  const kill = deps.kill ?? stop;
  return { pid, release: () => kill(pid) };
}

/** Where a task's caffeinate is written down, so it ends when the task leaves running. */
export const awakePath = (paths: Pick<RepoPaths, 'stateDir'>, id: string): string => join(paths.stateDir, 'awake', `${id}.pid`);

interface AwakeRecord {
  pid: number;
  /** The agent's process it watches. */
  watch: number;
}

/** Whether a pid is still a caffeinate, so a pid the system gave to something else is never killed. */
function isCaffeinate(pid: number): boolean {
  if (!alive(pid)) return false;
  const r = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' });
  return r.status === 0 && basename(r.stdout.trim()) === 'caffeinate';
}

/**
 * Keeps the machine awake while a task's agent runs, and writes the caffeinate down beside the ledger.
 * One a task: an earlier one is ended first.
 */
export function keepAwakeFor(paths: Pick<RepoPaths, 'stateDir'>, id: string, watchPid: number, deps: AwakeDeps = {}): Awake | null {
  releaseAwake(paths, id, deps);
  const held = holdAwake(watchPid, deps);
  if (!held) return null;
  try {
    mkdirSync(join(paths.stateDir, 'awake'), { recursive: true });
    writeFileSync(awakePath(paths, id), JSON.stringify({ pid: held.pid, watch: watchPid } satisfies AwakeRecord));
  } catch {
    // Not written down, it still ends with the agent's process.
  }
  return held;
}

/**
 * Ends a task's caffeinate, if it has one: when it leaves running, or its agent has stopped. Its agent's
 * process can outlive its turn, idle, and would hold the Mac awake for nothing.
 */
export function releaseAwake(paths: Pick<RepoPaths, 'stateDir'>, id: string, deps: AwakeDeps = {}): boolean {
  const file = awakePath(paths, id);
  let rec: AwakeRecord;
  try {
    rec = JSON.parse(readFileSync(file, 'utf8')) as AwakeRecord;
  } catch {
    return false;
  }
  rmSync(file, { force: true });
  if (!Number.isInteger(rec.pid) || rec.pid <= 0) return false;
  if (deps.kill) deps.kill(rec.pid);
  else if (isCaffeinate(rec.pid)) stop(rec.pid);
  return true;
}
