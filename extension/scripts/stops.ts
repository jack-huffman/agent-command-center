/**
 * Leaves no browser running (T-68). Every browser the screenshot and behaviour runs start is tracked
 * here, each in a process group of its own, so its helper processes go with it. On exit, on an error, and on
 * SIGINT or SIGTERM, stopOnExit stops every group still running.
 */
import type { ChildProcess } from 'node:child_process';

/** The browsers started and not yet closed. */
const running = new Set<ChildProcess>();

/** Tracks a child until it closes. It must have been spawned detached, so its pid names its group. */
export function track(child: ChildProcess): void {
  running.add(child);
  child.once('close', () => running.delete(child));
  // It never started, so there's nothing to stop.
  child.once('error', () => running.delete(child));
}

/** How many tracked browsers are still running. */
export const runningCount = (): number => running.size;

/** Sends a child's whole group the signal; a group already gone is ignored. */
export function stop(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (child.pid === undefined) return;
  try {
    // Windows has no process groups: the child alone.
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch { /* already gone */ }
}

/** Stops every tracked browser. */
export function stopAll(signal: NodeJS.Signals = 'SIGTERM'): void {
  for (const child of running) stop(child, signal);
}

/** The exit code for a run stopped by a signal, as a shell gives it: 128 plus the signal's number. */
export const SIGNAL_EXITS: Record<'SIGINT' | 'SIGTERM', number> = { SIGINT: 130, SIGTERM: 143 };

let installed = false;

/**
 * Stops every tracked browser when this process exits, throws, or is sent SIGINT or SIGTERM; a signal or an
 * error then ends the run with its exit code. Installed once, however often it's called.
 */
export function stopOnExit(proc: NodeJS.Process = process): void {
  if (installed) return;
  installed = true;
  proc.on('exit', () => stopAll());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    proc.on(signal, () => {
      stopAll();
      proc.exit(SIGNAL_EXITS[signal]);
    });
  }
  const failed = (e: unknown): void => {
    stopAll();
    console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
    proc.exit(1);
  };
  proc.on('uncaughtException', failed);
  proc.on('unhandledRejection', failed);
}
