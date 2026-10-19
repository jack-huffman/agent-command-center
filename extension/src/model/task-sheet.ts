/**
 * The task sheet (T-74): one sheet over the page writes a new task, or edits one, with its title, a
 * description of several lines in Markdown, its dependencies, environment and labels, and, for a task
 * already there, notes for the builder. A tracker's task shows the fields its ticket owns read-only, with
 * why, and a way to open the ticket. Plain data, posted to the page, and acc's arguments for what a person
 * wrote. No vscode import, so it's testable.
 */

import { editRefusal, trackerFields, trackerOwns } from '../../../packages/core/src/edit.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import { trackerName } from '../../../packages/core/src/trackers/types.ts';
import { KEY, type ModelArea, short } from './shared.ts';

/** The message the page opens the sheet on (webview/task-sheet.ts). */
export const TASK_SHEET_MESSAGE = 'task-sheet';

/** The fields the sheet shows, as text: a list is its items with commas between them. */
export interface TaskSheetFields {
  title: string;
  brief: string;
  deps: string;
  environment: string;
  labels: string;
  notes: string;
}

export interface TaskSheet {
  project: string;
  /** The task it edits, or null for a new one. */
  task: string | null;
  /** "New task in Tool", or "Edit ACME-12". */
  heading: string;
  /** The primary button's label: Add task, or Save. */
  go: string;
  fields: TaskSheetFields;
  /** The environments a task may build on: the project's, but the protected ones. */
  environments: { value: string; label: string }[];
  /** Why its title, description, dependencies and labels are read-only: its ticket owns them. Null when it's acc's own. */
  locked: string | null;
  /** Its ticket, to open where its own text is changed. */
  ticket: { url: string; label: string } | null;
  /** Notes for the builder: shown for a task already there, which a builder reads. */
  notes: boolean;
}

/** What the sheet is made from: the project, its environments, and the task it edits, if any. */
export interface TaskSheetInput {
  project: string;
  name: string;
  environments: { name: string; branch: string; protected?: boolean; default?: boolean }[];
  task?: Pick<Task, 'id' | 'title' | 'brief' | 'deps' | 'environment' | 'labels' | 'notes' | 'source' | 'state'> | null;
}

const listText = (xs: readonly string[]): string => xs.join(', ');
const listOf = (s: string): string[] => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))];

/** The sheet for a new task, or for editing one. Null for a task that can't be edited now: its Edit is off with why. */
export function taskSheet(i: TaskSheetInput): TaskSheet | null {
  const t = i.task ?? null;
  if (t && editRefusal(t)) return null;
  const environments = i.environments.filter((e) => !e.protected).map((e) => ({ value: e.branch, label: e.name }));
  const first = i.environments.find((e) => e.default && !e.protected)?.branch ?? environments[0]?.value ?? '';
  const ticket = t && t.source.kind !== 'manual' && t.source.url ? { url: t.source.url, label: `Open in ${trackerName(t.source.kind)}` } : null;
  return {
    project: i.project,
    task: t?.id ?? null,
    heading: t ? `Edit ${t.id}` : `New task in ${i.name}`,
    go: t ? 'Save' : 'Add task',
    fields: {
      title: t?.title ?? '', brief: t?.brief ?? '', deps: listText(t?.deps ?? []), environment: t?.environment ?? first, labels: listText(t?.labels ?? []), notes: t?.notes ?? '',
    },
    environments,
    locked: t ? trackerOwns(t) : null,
    ticket,
    notes: !!t,
  };
}

/** What a person wrote in the sheet, as the page sends it. */
export type TaskSheetChoice = TaskSheetFields;

/**
 * acc's arguments for what a person wrote: acc add's for a new task, acc edit's for one already there,
 * with only the fields that changed, and none its ticket owns. Empty for an edit that changes nothing.
 * Each value goes as --flag=value, so a description that starts with a dash is still its value.
 */
export function taskSheetArgs(i: TaskSheetInput, c: TaskSheetChoice): string[] {
  const t = i.task ?? null;
  const lists = (flag: string, xs: string[]) => (xs.length ? xs.map((x) => `--${flag}=${x}`) : [`--${flag}=`]);
  if (!t) {
    const deps = listOf(c.deps);
    const labels = listOf(c.labels);
    return [
      'add', `--title=${c.title.trim()}`,
      ...(c.brief.trim() ? [`--brief=${c.brief.trim()}`] : []),
      ...(deps.length ? lists('dep', deps) : []),
      ...(c.environment ? [`--env=${c.environment}`] : []),
      ...(labels.length ? lists('label', labels) : []),
    ];
  }
  const owned = trackerFields(t);
  const args: string[] = [];
  const same = (a: string[], b: readonly string[]) => JSON.stringify(a) === JSON.stringify(b);
  if (!owned.includes('title') && c.title.trim() !== t.title) args.push(`--title=${c.title.trim()}`);
  if (!owned.includes('brief') && c.brief.trim() !== t.brief) args.push(`--brief=${c.brief.trim()}`);
  if (!owned.includes('deps') && !same(listOf(c.deps).map((d) => d.toUpperCase()), t.deps)) args.push(...lists('dep', listOf(c.deps)));
  if (c.environment && c.environment !== t.environment) args.push(`--env=${c.environment}`);
  if (!owned.includes('labels') && !same(listOf(c.labels), t.labels)) args.push(...lists('label', listOf(c.labels)));
  if (c.notes.trim() !== (t.notes ?? '')) args.push(`--notes=${c.notes.trim()}`);
  return args.length ? ['edit', t.id, ...args] : [];
}

/** What the sheet reads from the hub: a project's name and environments, and its tasks. */
export interface TaskSheetHub {
  project(root: string): { name: string; config: { environments: TaskSheetInput['environments'] } } | undefined;
  ledger(root: string): { tasks: NonNullable<TaskSheetInput['task']>[] } | undefined;
}

/** The sheet's input for a project, and the task it edits when one is named, from the hub as it is now. Null when either isn't there. */
export function taskSheetInput(hub: TaskSheetHub, root: string, id: string | null): TaskSheetInput | null {
  const project = hub.project(root);
  if (!project) return null;
  const task = id === null ? null : hub.ledger(root)?.tasks.find((t) => t.id === id.toUpperCase()) ?? null;
  if (id !== null && !task) return null;
  return { project: root, name: project.name, environments: project.config.environments, task };
}

/**
 * Opens the sheet for a new task in a project, or for editing a task, as Dispatch's opens (D-168). `say`
 * posts to the page that asked, a task's tab or the modal; without it, `tell` shows it over the Command
 * Center, which opens first when it's closed. False when the project or task isn't there, or the task
 * can't be edited now.
 */
export function openTaskSheet(hub: TaskSheetHub, tell: (msg: Record<string, unknown>) => void, root: string, id: string | null, say?: (msg: Record<string, unknown>) => void): boolean {
  const i = taskSheetInput(hub, root, id);
  const sheet = i ? taskSheet(i) : null;
  if (!sheet) return false;
  (say ?? tell)({ type: TASK_SHEET_MESSAGE, sheet });
  return true;
}

/** Why the sheet's primary button is off, or null when it's on: a task needs a title. */
export const taskSheetOff = (c: Pick<TaskSheetChoice, 'title'>): string | null => (c.title.trim() ? null : 'A task needs a title');

export type Message =
  /** The sheet's Add task or Save: the task it edits, if any, and what was written in it. */
  | { type: 'task-sheet-go'; project: string; task?: string; title: string; brief: string; deps: string; environment: string; labels: string; notes: string };

/** A field's text the page may send: a description holds up to 64 KB. */
const text = (v: unknown, max: number): boolean => typeof v === 'string' && v.length <= max;

export const area: ModelArea = {
  commands: ['acc.task.edit'],
  messages: {
    'task-sheet-go': (x) => short(x.project, 4096) && (x.task === undefined || (short(x.task, 100) && KEY.test(x.task as string))) && short(x.title, 500)
      && text(x.brief, 65536) && text(x.deps, 2000) && text(x.environment, 200) && text(x.labels, 2000) && text(x.notes, 65536),
  },
};
