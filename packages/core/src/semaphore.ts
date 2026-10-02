import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AccError } from './exec.ts';
import { alive, sleep } from './lock.ts';

export interface SlotOptions {
  /** The folder holding the slots. Machine-wide by default, so every repo and worktree shares it. */
  dir?: string;
  slots?: number;
  timeoutMs?: number;
  pollMs?: number;
  /** Called once, when the first attempt finds every slot taken. */
  onWait?: () => void;
}

export const heavyDir = (env: NodeJS.ProcessEnv = process.env): string => env.ACC_HEAVY_DIR || join(homedir(), '.acc', 'heavy');
export const heavySlots = (env: NodeJS.ProcessEnv = process.env): number => Math.max(1, Math.floor(Number(env.ACC_HEAVY_SLOTS)) || 1);

/** A slot whose owner file isn't written yet is being taken right now; past this age, its taker died. */
const UNOWNED_GRACE_MS = 10_000;

function take(slot: string): boolean {
  try {
    mkdirSync(slot);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    return false;
  }
  writeFileSync(join(slot, 'owner'), JSON.stringify({ pid: process.pid, at: Date.now() }));
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

/**
 * Runs `fn` holding one of the machine's heavy-check slots (D-024), so a Salesforce validation or a
 * full build never runs alongside another. There's no age limit: a validation can take an hour, and
 * only a dead owner frees a slot early.
 */
export function withSlot<T>(fn: () => T, opts: SlotOptions = {}): T {
  const dir = opts.dir ?? heavyDir();
  const slots = opts.slots ?? heavySlots();
  const timeoutMs = opts.timeoutMs ?? 3 * 60 * 60_000;
  mkdirSync(dir, { recursive: true });
  const started = Date.now();
  let waiting = false;
  for (;;) {
    for (let i = 0; i < slots; i++) {
      const slot = join(dir, `slot-${i}`);
      reclaim(slot);
      if (!take(slot)) continue;
      try {
        return fn();
      } finally {
        rmSync(slot, { recursive: true, force: true });
      }
    }
    if (!waiting) {
      waiting = true;
      opts.onWait?.();
    }
    if (Date.now() - started > timeoutMs) {
      throw new AccError('busy', `Every heavy-check slot in ${dir} stayed taken for ${Math.round(timeoutMs / 60_000)} minutes. If no check is running, delete that folder.`);
    }
    sleep(opts.pollMs ?? 500);
  }
}
