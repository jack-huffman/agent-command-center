// Editing a task (T-74): a person changes its title, brief, dependencies, environment, labels or notes for
// the builder after it was added, with acc add's checks. A tracker's task keeps its own text in the tracker.

import { type CriterionFinding, refuseBriefWording } from './brief-wording.ts';
import type { Config } from './config.ts';
import { AccError } from './exec.ts';
import { type Actor, type Emit, environmentProblem, type Ledger, type State, type Task, taskDeps } from './ledger.ts';
import { trackerName } from './trackers/types.ts';

/** The fields an edit may change, in the order a sheet and acc show them. */
export const EDIT_FIELDS = ['title', 'brief', 'deps', 'environment', 'labels', 'notes'] as const;
export type EditField = (typeof EDIT_FIELDS)[number];

/** Each field's name in words, for a person. */
export const EDIT_FIELD_WORDS: Record<EditField, string> = {
  title: 'title', brief: 'description', deps: 'dependencies', environment: 'environment', labels: 'labels', notes: 'notes for the builder',
};

/** The fields an edit changed, in words for a person: "description, notes for the builder". A field a newer acc wrote shows as itself. */
export const editedWords = (fields: readonly string[]): string =>
  fields.map((f) => (Object.hasOwn(EDIT_FIELD_WORDS, f) ? EDIT_FIELD_WORDS[f as EditField] : f)).join(', ');

/** What an edit changes: a field left out stays as it is. */
export type TaskEdit = Partial<{ title: string; brief: string; deps: string[]; environment: string; labels: string[]; notes: string }>;

/** The states a person may edit a task in: not while a builder runs, which works from the brief it was given, nor once it's done. */
export const EDITABLE_STATES: readonly State[] = ['todo', 'blocked', 'rework', 'review'];

/** The fields a tracker's intake refreshes, so its ticket owns them: acc keeps the environment and the notes. */
export const TRACKER_OWNED: readonly EditField[] = ['title', 'brief', 'deps', 'labels'];

/** Why a task can't be edited now, or null when it can. In plain words, with no command in them (D-132). */
export function editRefusal(task: Pick<Task, 'state'>): string | null {
  if (task.state === 'running') return 'Its builder is working from the brief it was given. Edit it once the builder stops.';
  if (task.state === 'done') return 'It is done: its work has landed, so there is nothing left to change.';
  return (EDITABLE_STATES as readonly string[]).includes(task.state) ? null : `It is ${task.state}, and only a task to do, blocked, in rework or in review can be edited.`;
}

/** The fields its tracker owns, or none for a task acc keeps itself. */
export const trackerFields = (task: Pick<Task, 'source'>): readonly EditField[] => (task.source.kind === 'manual' ? [] : TRACKER_OWNED);

/** Why a tracker task's own fields are read-only, or null for a task acc keeps itself. */
export function trackerOwns(task: Pick<Task, 'source'>): string | null {
  if (task.source.kind === 'manual') return null;
  return `Its ${trackerName(task.source.kind)} ticket owns its title, description, dependencies and labels: change them there, and intake brings them in.`;
}

/** A list as acc keeps it: each item trimmed, empty ones dropped, each once. */
const cleanList = (xs: string[]): string[] => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

/** The fields an edit would change, with their new values: the same value as now is no change. Throws on a bad value. */
export function editChanges(task: Task, config: Config, edit: TaskEdit): Partial<Record<EditField, string | string[]>> {
  const next: Partial<Record<EditField, string | string[]>> = {};
  if (edit.title !== undefined) {
    const title = edit.title.trim();
    if (!title) throw new AccError('usage', `${task.id} needs a title.`);
    if (title !== task.title) next.title = title;
  }
  if (edit.brief !== undefined && edit.brief.trim() !== task.brief) next.brief = edit.brief.trim();
  if (edit.deps !== undefined) {
    const deps = taskDeps(cleanList(edit.deps), task.source.kind);
    if (deps.includes(task.id)) throw new AccError('usage', `${task.id} can't depend on itself.`);
    if (JSON.stringify(deps) !== JSON.stringify(task.deps)) next.deps = deps;
  }
  if (edit.environment !== undefined && edit.environment.trim() !== task.environment) {
    const env = edit.environment.trim();
    const why = environmentProblem(config, env);
    if (why) throw new AccError('usage', `${task.id}: ${why}`);
    next.environment = env;
  }
  if (edit.labels !== undefined) {
    const labels = cleanList(edit.labels);
    if (JSON.stringify(labels) !== JSON.stringify(task.labels)) next.labels = labels;
  }
  if (edit.notes !== undefined && edit.notes.trim() !== (task.notes ?? '')) next.notes = edit.notes.trim();
  return next;
}

export interface EditResult {
  task: Task;
  /** The fields it changed, in EDIT_FIELDS' order; none when every value was as it was. */
  changed: EditField[];
  /** The advisory wording findings on its new brief's acceptance criteria (T-148): advice, which didn't stop it. */
  advice: CriterionFinding[];
}

/**
 * Edits a task (T-74): refused while a builder runs or once it's done, for a field its tracker owns, and for
 * a brief whose acceptance criteria fail the wording check (T-148).
 * Records who changed which fields in its `edits`, and emits task.updated with the new values. A field
 * left out, or given as it is, stays as it is, and an edit that changes nothing records nothing.
 */
export function editTask(ledger: Ledger, config: Config, id: string, edit: TaskEdit, actor: Actor, by: string, emit: Emit, now: () => Date): EditResult {
  const task = ledger.tasks.find((t) => t.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  if (actor === 'builder' || actor === 'reviewer') throw new AccError('refused', `Only a person edits ${id}: a ${actor} works from the brief it was given.`);
  const refused = editRefusal(task);
  if (refused) throw new AccError('refused', `${id} can't be edited. ${refused}`);
  const next = editChanges(task, config, edit);
  const owned = trackerFields(task).filter((f) => f in next);
  if (owned.length) throw new AccError('refused', `${id}'s ${owned.map((f) => EDIT_FIELD_WORDS[f]).join(', ')} can't be edited here. ${trackerOwns(task)}`);
  // A new brief's acceptance criteria pass the wording check before anything is written (T-148). Only acc's own
  // task gets this far with one: a tracker's ticket owns its brief, so its client's words are never refused.
  const advice = typeof next.brief === 'string' ? refuseBriefWording(next.brief, id) : [];
  const changed = EDIT_FIELDS.filter((f) => f in next);
  if (!changed.length) return { task, changed, advice };
  Object.assign(task, next);
  const at = now().toISOString();
  task.updatedAt = at;
  (task.edits ??= []).push({ at, actor, by, fields: changed });
  emit({ type: 'task.updated', task: id, actor, by, data: next });
  return { task, changed, advice };
}
