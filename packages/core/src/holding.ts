// Holding a task for others' files at dispatch, and claiming a held one to start it, so two starters never both do.

import { AccError } from './exec.ts';
import { type Actor, mutate, type Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import type { StartLook } from './overlap.ts';
import type { DispatchOptions, HeldResult } from './dispatch.ts';

/** How long a claim on a held task stands: a start that takes longer than this crashed, and another may take it. */
export const STARTING_STALE_MS = 10 * 60_000;

/** Who is starting a held task now, unless their claim is stale. */
export const startingNow = (task: Task, now: Date): { at: string; by: string } | null => {
  const s = task.held?.starting;
  return s && now.getTime() - Date.parse(s.at) < STARTING_STALE_MS ? s : null;
};

// ---------------------------------------------------------------- a task that waits for others' files (D-093)

/** Records the hold. A task already waiting keeps its place, since the oldest hold starts first; one whose start failed is asked again. */
export function holdTask(paths: RepoPaths, now: () => Date, id: string, opts: DispatchOptions, look: StartLook): HeldResult {
  return mutate(paths, now, (ledger, emit) => {
    const task = ledger.tasks.find((t) => t.id === id);
    if (!task) throw new AccError('no-task', `No task ${id}.`);
    if (task.state !== 'todo') throw new AccError('move-refused', `Can't dispatch ${id}: it's ${task.state} now.`);
    const at = now().toISOString();
    const kept = task.held && !task.held.failed ? task.held : null;
    // A model picked for it (D-086) is kept for its start, until another is picked.
    const model = opts.model ?? task.held?.model;
    // So is an effort (D-128), and `default`, which dropped one.
    const effort = opts.effort ?? task.held?.effort;
    task.held = { at: kept?.at ?? at, actor: kept?.actor ?? opts.actor, by: kept?.by ?? opts.by, waitsFor: look.shares, first: look.first, ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
    task.updatedAt = at;
    emit({ type: 'task.updated', task: id, actor: opts.actor, by: opts.by, data: { held: task.held } });
    return { held: true as const, task, waitsFor: look.shares, first: look.first };
  });
}

/** Claims a held task for its start, unless it moved, its start failed, or someone else is starting it. */
export function claimHeld(paths: RepoPaths, now: () => Date, id: string, opts: { actor: Actor; by: string }): boolean {
  return mutate(paths, now, (ledger, emit) => {
    const t = ledger.tasks.find((x) => x.id === id);
    if (!t || t.state !== 'todo' || !t.held || t.held.failed || startingNow(t, now())) return false;
    t.held.starting = { at: now().toISOString(), by: opts.by };
    emit({ type: 'task.updated', task: id, actor: opts.actor, by: opts.by, data: { held: t.held } });
    return true;
  });
}

/** Lets go of a claim: for now, or with why its start failed, written on the task, which then needs a person. */
export function releaseHeld(paths: RepoPaths, now: () => Date, id: string, opts: { actor: Actor; by: string }, reason: string | null): void {
  mutate(paths, now, (ledger, emit) => {
    const t = ledger.tasks.find((x) => x.id === id);
    if (!t || t.state !== 'todo' || !t.held) return;
    const at = now().toISOString();
    t.held = { ...t.held, starting: null, ...(reason ? { failed: { reason, at, by: opts.by } } : {}) };
    t.updatedAt = at;
    emit({ type: 'task.updated', task: id, actor: opts.actor, by: opts.by, data: { held: t.held } });
  });
}
