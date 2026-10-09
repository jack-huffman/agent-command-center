// Where this machine's own settings live (D-080): ~/.acc/machine.json, shared by every repo and worktree on
// it. Its heavy-check slots (semaphore.ts) and its total of builders (limits.ts) are both read and written
// through machineJson here, so the two never disagree about which file is the machine's (GH-131), and both
// are set through setMachineKey, the file's one writer (GH-148).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AccError } from './exec.ts';
import { withLock } from './lock.ts';

/**
 * This machine's own folder, from the environment acc runs in: beside ACC_MACHINE_FILE when it's set, else
 * ~/.acc under HOME. An environment with no home has none, so nothing machine-wide is read or written: a
 * test's made-up environment never reaches the machine it runs on.
 */
export function machineDir(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.ACC_MACHINE_FILE) return dirname(env.ACC_MACHINE_FILE);
  const home = env.HOME || env.USERPROFILE;
  return home ? join(home, '.acc') : null;
}

/**
 * This machine's machine.json, as its heavy-check slots and its total are read and written: ACC_MACHINE_FILE,
 * else machine.json in machineDir. None without a home, so neither is read nor written there.
 */
export function machineJson(env: NodeJS.ProcessEnv = process.env): string | null {
  const dir = machineDir(env);
  return env.ACC_MACHINE_FILE || (dir ? join(dir, 'machine.json') : null);
}

/** machine.json to write a setting to, or a refusal where machineJson finds none. */
export function machineJsonToWrite(env: NodeJS.ProcessEnv = process.env): string {
  const file = machineJson(env);
  if (!file) throw new AccError('refused', 'acc can\'t tell where this machine\'s settings are kept: its environment has no HOME. Set HOME, or ACC_MACHINE_FILE, and try again.');
  return file;
}

/**
 * Sets one key in this machine's machine.json, or, with undefined, takes it out, keeping what else the file
 * holds: the one writer the heavy-check slots and the total share (GH-148). It reads, merges and writes
 * holding a lock beside the file, writing a temp named for this process and renaming it into place, so a
 * slots change and a total change made at once each keep the other's key. With no home it refuses.
 */
export function setMachineKey(key: string, value: unknown, env: NodeJS.ProcessEnv = process.env): void {
  const file = machineJsonToWrite(env);
  mkdirSync(dirname(file), { recursive: true });
  withLock(`${file}.lock`, () => {
    let current: Record<string, unknown> = {};
    try { current = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { /* a new file */ }
    const { [key]: _was, ...rest } = current;
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value === undefined ? rest : { ...rest, [key]: value }, null, 2) + '\n');
    renameSync(tmp, file);
  });
}
