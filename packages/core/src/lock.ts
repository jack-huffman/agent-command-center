import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AccError } from './exec.ts';

export interface LockOptions {
  timeoutMs?: number;
  staleMs?: number;
}

export const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** Whether a process is still running. EPERM means it is, but belongs to someone else. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Runs `fn` while holding a lock directory. `mkdir` is atomic, so only one process wins.
 * A lock whose owner process is gone, or that is older than `staleMs`, is broken.
 */
export function withLock<T>(lockDir: string, fn: () => T, opts: LockOptions = {}): T {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const staleMs = opts.staleMs ?? 60_000;
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, 'owner'), JSON.stringify({ pid: process.pid, at: Date.now() }));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let owner: { pid: number; at: number } | null = null;
      try {
        owner = JSON.parse(readFileSync(join(lockDir, 'owner'), 'utf8'));
      } catch {
        owner = null;
      }
      let age = 0;
      try {
        age = Date.now() - (owner?.at ?? statSync(lockDir).mtimeMs);
      } catch {
        continue; // released between our mkdir and stat
      }
      if ((owner && !alive(owner.pid)) || age > staleMs) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started > timeoutMs) {
        throw new AccError('lock-timeout', `Another acc process is holding ${lockDir}. Try again in a moment.`);
      }
      sleep(20 + Math.floor(Math.random() * 40));
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}
