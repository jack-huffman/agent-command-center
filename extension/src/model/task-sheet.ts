/**
 * The task sheet (T-74): one sheet over the page writes a new task, or edits one, with its title, a
 * description of several lines in Markdown, its dependencies, environment and labels, and, for a task
 * already there, notes for the builder. A tracker's task shows the fields its ticket owns read-only, with
 * why, and a way to open the ticket. Plain data, posted to the page, and acc's arguments for what a person
 * wrote. No vscode import, so it's testable.
 */

import { editRefusal, trackerFields, trackerOwns } from '../../../packages/core/src/edit.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import { textRefusal, type Ticket, type TrackerField, type TrackerKind, trackerName } from '../../../packages/core/src/trackers/types.ts';
import { KEY, type ModelArea, short } from './shared.ts';
import { SHEET_TICKET_FIELDS, type SheetRow, sheetRows, type TicketTextBase } from './ticket-text.ts';

/** The message the page opens the sheet on (webview/task-sheet.ts). */
export const TASK_SHEET_MESSAGE = 'task-sheet';
/** The message that tells the sheet how its Save went (T-80): it closes, keeps the person's text with why, or shows both versions. */
export const TASK_SHEET_DONE = 'task-sheet-done';
/** The message that gives the sheet its ticket's status, assignee and labels after a Change (T-80), or why it didn't go. */
export const TASK_SHEET_ROWS = 'task-sheet-rows';

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
  /**
   * Where the project allows edits to its tracker's tickets (T-80): the ticket's title and description the
   * sheet opened with, which Save checks again before it writes, or null where they can't be written from
   * here; and its status, assignee and labels, each with its Change. Null where edits are off.
   */
  ticketEdits: { base: TicketTextBase | null; rows: SheetRow[] } | null;
}

/** A tracker task's ticket as the sheet sees it (T-80): whether the project allows edits, and the ticket as read when the sheet opened, or why it couldn't be. */
export interface SheetTicket {
  edits: boolean;
  kind: TrackerKind;
  /** Which of status, assignee and labels its tracker has. Not set: all three. */
  fields?: readonly TrackerField[];
  /** Read only where edits are on. */
  ticket: Pick<Ticket, 'title' | 'markdown' | 'status' | 'assignees' | 'labels'> | null;
  error: string | null;
}

/** What the sheet is made from: the project, its environments, and the task it edits, if any. */
export interface TaskSheetInput {
  project: string;
  name: string;
  environments: { name: string; branch: string; protected?: boolean; default?: boolean }[];
  task?: Pick<Task, 'id' | 'title' | 'brief' | 'deps' | 'environment' | 'labels' | 'notes' | 'source' | 'state'> | null;
  /** Its ticket, for a tracker's task (T-80). Not given: as where edits are off. */
  ticket?: SheetTicket | null;
}

/** What the sheet says the project's settings do for a tracker's task where edits are off (T-80). */
export const EDITS_OFF = 'The project\'s settings can turn on edits, so its ticket changes from here.';

/**
 * Why a tracker task's fields are read-only in the sheet, or null for a task acc keeps itself (T-80).
 * Edits off: its ticket owns them, and the project's settings turn edits on. Edits on: only what can't be
 * written from here, which is its dependencies, and its title and description where the tracker can't
 * take them or its ticket couldn't be read.
 */
export function sheetLock(t: Pick<Task, 'source'>, st: SheetTicket | null | undefined): string | null {
  const owns = trackerOwns(t);
  if (!owns || t.source.kind === 'manual') return null;
  if (!st?.edits) return `${owns} ${EDITS_OFF}`;
  const name = trackerName(t.source.kind);
  if (!st.ticket) return `Its ${name} ticket couldn't be read, so its title and description can't change here now. ${st.error ?? ''}`.trim();
  return textRefusal(st.kind) ?? `Save writes its title and description to its ${name} ticket. Its dependencies come from the ticket: change them there.`;
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
  const st = t && t.source.kind !== 'manual' && i.ticket?.edits ? i.ticket : null;
  // Where acc can write the ticket's text, the sheet shows it as the ticket has it now, not as intake last brought it in.
  const base = st?.ticket && !textRefusal(st.kind) ? { title: st.ticket.title, markdown: st.ticket.markdown } : null;
  return {
    project: i.project,
    task: t?.id ?? null,
    heading: t ? `Edit ${t.id}` : `New task in ${i.name}`,
    go: t ? 'Save' : 'Add task',
    fields: {
      title: base?.title ?? t?.title ?? '', brief: base?.markdown ?? t?.brief ?? '', deps: listText(t?.deps ?? []), environment: t?.environment ?? first, labels: listText(t?.labels ?? []), notes: t?.notes ?? '',
    },
    environments,
    locked: t ? sheetLock(t, i.ticket) : null,
    ticket,
    notes: !!t,
    ticketEdits: st ? { base, rows: st.ticket ? sheetRows(st.ticket, st.fields) : [] } : null,
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

/** A tracker task's ticket, read for the sheet (T-80): null for a key no tracker of the project's holds. */
export type SheetTicketRead = (root: string, key: string) => Promise<SheetTicket | null>;

/**
 * Opens the sheet for a new task in a project, or for editing a task, as Dispatch's opens (D-168). `say`
 * posts to the page that asked, a task's tab or the modal; without it, `tell` shows it over the Command
 * Center, which opens first when it's closed. False when the project or task isn't there, or the task
 * can't be edited now. A tracker's task, given `read`, opens once its ticket is read (T-80); a read that
 * fails still opens it, read-only, saying why.
 */
export function openTaskSheet(hub: TaskSheetHub, tell: (msg: Record<string, unknown>) => void, root: string, id: string | null, say?: (msg: Record<string, unknown>) => void, read?: SheetTicketRead): boolean {
  const i = taskSheetInput(hub, root, id);
  const sheet = i ? taskSheet(i) : null;
  if (!i || !sheet) return false;
  const post = (s: TaskSheet | null) => { if (s) (say ?? tell)({ type: TASK_SHEET_MESSAGE, sheet: s }); };
  if (!read || !i.task || i.task.source.kind === 'manual') {
    post(sheet);
    return true;
  }
  void read(root, i.task.id).then((ticket) => post(taskSheet({ ...i, ticket })), () => post(sheet));
  return true;
}

/** Why the sheet's primary button is off, or null when it's on: a task needs a title. */
export const taskSheetOff = (c: Pick<TaskSheetChoice, 'title'>): string | null => (c.title.trim() ? null : 'A task needs a title');

export type Message =
  /**
   * The sheet's Add task or Save: the task it edits, if any, and what was written in it. base is the
   * ticket's text the sheet opened with, where Save writes the title and description to the ticket (T-80).
   */
  | { type: 'task-sheet-go'; project: string; task?: string; title: string; brief: string; deps: string; environment: string; labels: string; notes: string; base?: TicketTextBase }
  /** Change on one of the ticket's fields in the sheet (T-80): the extension asks, as the ticket page's Change does. */
  | { type: 'task-sheet-field'; project: string; task: string; field: (typeof SHEET_TICKET_FIELDS)[number] };

/** A field's text the page may send: a description holds up to 64 KB. */
const text = (v: unknown, max: number): boolean => typeof v === 'string' && v.length <= max;

export const area: ModelArea = {
  commands: ['acc.task.edit'],
  messages: {
    'task-sheet-go': (x) => short(x.project, 4096) && (x.task === undefined || (short(x.task, 100) && KEY.test(x.task as string))) && short(x.title, 500)
      && text(x.brief, 65536) && text(x.deps, 2000) && text(x.environment, 200) && text(x.labels, 2000) && text(x.notes, 65536)
      && (x.base === undefined || (typeof x.base === 'object' && x.base !== null && text((x.base as Record<string, unknown>).title, 500) && text((x.base as Record<string, unknown>).markdown, 65536))),
    'task-sheet-field': (x) => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string) && (SHEET_TICKET_FIELDS as readonly unknown[]).includes(x.field),
  },
};
