/**
 * A ticket's changes field, drafted as an update (T-105, D-066): when a ticket's changes change (its pull
 * request opened or updated with new commits, a builder's finish, a record change recorded, its package.xml
 * built, or its merge), acc drafts the field's new text from them, one draft per ticket, which a person reads
 * on the Overview and the ticket's page, edits and saves. Only that save writes the field. A draft that says
 * what the last one did is not made again.
 */
import { changesDraft, changesFieldRefusal, sameChanges } from './changes-field.ts';
import { type Config, trackerForKey } from './config.ts';
import type { Runner } from './exec.ts';
import { readLedger, type Task } from './ledger.ts';
import { readManifest } from './manifest.ts';
import { outsideOf } from './outside-changes.ts';
import { branchFiles } from './overlap.ts';
import type { RepoPaths } from './paths.ts';
import type { TextField } from './trackers/types.ts';
import { draftUpdate, isOpenUpdate, listUpdates, ticketOf, type Update } from './updates.ts';

/** The field a task's tracker keeps its changes in, or null: no ticket, no field named, or a tracker with none (Slack). */
export function changesFieldOf(config: Pick<Config, 'trackers'>, task: Pick<Task, 'id' | 'source'>): TextField | null {
  const ticket = ticketOf(task);
  if (!ticket || changesFieldRefusal(ticket.tracker)) return null;
  const index = trackerForKey(config.trackers ?? [], ticket.tracker === 'github' ? task.id : ticket.key);
  const t = index === null ? undefined : config.trackers[index];
  return t && t.kind === ticket.tracker ? t.changesField : null;
}

/** The texts acc drafted for a task's field, oldest first: what tells the lines it wrote from those a person did. */
export const writtenFor = (updates: Update[], task: string): string[] =>
  updates.filter((u) => u.task === task && u.event === 'changes').map((u) => u.text);

/**
 * What a task changed, as its Changes section lists it: in flight, its branch's paths, else what acc kept
 * at its land; once done, what acc kept.
 */
export function changedPathsOf(paths: RepoPaths, run: Runner, task: Task): string[] {
  const live = task.state !== 'done' && task.run?.branch ? branchFiles(run, paths.root, task.environment, task.run.branch) : [];
  return live.length ? live : task.changes?.paths ?? [];
}

/**
 * Drafts the field's new text for a task's ticket, from its changes now: null where its tracker names no
 * field, it has no changes to say, or the open draft, or else the last saved one, says the same already.
 * It only writes a draft: nothing reaches the ticket.
 */
export function draftChangesField(paths: RepoPaths, run: Runner, config: Pick<Config, 'trackers' | 'profile'>, id: string, by: string, now: () => Date): Update | null {
  try {
    const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
    const field = task ? changesFieldOf(config, task) : null;
    if (!task || !field) return null;
    const text = changesDraft({
      profile: config.profile, paths: changedPathsOf(paths, run, task), outside: outsideOf(task).changes,
      manifest: config.profile === 'salesforce' ? readManifest(paths, task.id) : null, at: now(),
    });
    if (!text) return null;
    const mine = listUpdates(paths).filter((u) => u.task === id && u.event === 'changes');
    const last = mine.filter(isOpenUpdate).at(-1) ?? mine.filter((u) => u.state === 'posted').at(-1);
    if (last && last.field?.id === field.id && sameChanges(last.text, text)) return null;
    return draftUpdate(paths, task, { event: 'changes', field, text }, by, now);
  } catch {
    // A draft that can't be made never stops the land, merge or record it follows: the next change drafts it.
    return null;
  }
}
