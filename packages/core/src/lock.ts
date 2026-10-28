import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AccError } from './exec.ts';

export interface LockOptions {
  timeoutMs?: number;
  staleMs?: number;
  /** Tests put their own in, to be a Windows machine and see mkdir fail as it does there (T-129). */
  platform?: NodeJS.Platform;
  mkdir?: (dir: string) => void;
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
 * Whether mkdir's error means another process holds the lock. On Windows, mkdir of a lock folder another
 * process is still removing fails with EPERM, not EEXIST (T-129): it's held, so wait. Elsewhere EPERM is real.
 */
export const lockHeld = (code: string | undefined, platform: NodeJS.Platform = process.platform): boolean =>
  code === 'EEXIST' || (platform === 'win32' && code === 'EPERM');

/**
 * Runs `fn` while holding a lock directory. `mkdir` is atomic, so only one process wins.
 * A lock whose owner process is gone, or that is older than `staleMs`, is broken.
 */
export function withLock<T>(lockDir: string, fn: () => T, opts: LockOptions = {}): T {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const staleMs = opts.staleMs ?? 60_000;
  const mkdir = opts.mkdir ?? ((dir: string) => { mkdirSync(dir); });
  const started = Date.now();
  // Every way round the loop again waits a moment and stays inside the timeout, so nothing spins (T-129).
  const waitOrGiveUp = (): void => {
    if (Date.now() - started > timeoutMs) {
      throw new AccError('lock-timeout', `Another acc process is holding ${lockDir}. Try again in a moment.`);
    }
    sleep(20 + Math.floor(Math.random() * 40));
  };
  for (;;) {
    try {
      mkdir(lockDir);
      writeFileSync(join(lockDir, 'owner'), JSON.stringify({ pid: process.pid, at: Date.now() }));
      break;
    } catch (e) {
      if (!lockHeld((e as NodeJS.ErrnoException).code, opts.platform)) throw e;
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
        // Released between our mkdir and stat, or on Windows still being removed: try again shortly.
        waitOrGiveUp();
        continue;
      }
      if ((owner && !alive(owner.pid)) || age > staleMs) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      waitOrGiveUp();
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}
