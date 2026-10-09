// Where this machine's own settings live (D-080): ~/.acc/machine.json, shared by every repo and worktree on
// it. Its heavy-check slots (semaphore.ts) and its total of builders (limits.ts) are both read and written
// through machineJson here, so the two never disagree about which file is the machine's (GH-131).

import { dirname, join } from 'node:path';
import { AccError } from './exec.ts';

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
