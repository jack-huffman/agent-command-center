/**
 * Drafted acceptance criteria on a task's page and in its sheet (T-81): a tracker task's page has "Draft
 * acceptance criteria", and once there is a draft, shows it with its two ways out. Add to the description
 * opens the task sheet with the draft below the description's text, under its own heading, for the person
 * to edit and save. Open as an update makes it an update draft, to edit and post as a comment. The sheet
 * itself drafts too, and puts the draft in its description box. Nothing reaches the tracker until a
 * person saves or posts. Plain data and the messages' checks: no vscode import, so it's testable.
 */

import { criteriaSection, type CriteriaDraft, withCriteria } from '../../../packages/core/src/criteria.ts';
import { editRefusal } from '../../../packages/core/src/edit.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import { fromMarkdown, type Doc, unkeptRefusal } from '../../../packages/core/src/trackers/doc.ts';
import { textRefusal, type TrackerKind } from '../../../packages/core/src/trackers/types.ts';
import { ticketOf } from '../../../packages/core/src/updates.ts';
import { KEY, type Look, type ModelArea, short } from './shared.ts';
import type { TaskSheet } from './task-sheet.ts';
import { EDITS_OFF } from './task-sheet.ts';

/** What tells a page how a draft, or its update, went; and what gives the sheet a draft for its description. */
export const CRITERIA_DONE = 'criteria-done';
export const TASK_SHEET_DRAFT = 'task-sheet-draft';

/** A button of the section: its label, and why it's off, or null when it's on. */
export interface CriteriaButton {
  label: string;
  disabled: string | null;
}

/** The task page's Acceptance criteria draft section. */
export interface TicketCriteria {
  task: string;
  look: Look;
  /** What the section says before there is a draft, or while one is drafted. */
  note: string | null;
  /** The draft, as the page draws it. Null before the first. */
  body: Doc | null;
  /** How many criteria the draft holds, for a collapsed section's line (T-132). Null before the first. */
  count: number | null;
  at: string | null;
  /** What the drafter read, in words. */
  read: string | null;
  /** The wording check's findings that stayed after the drafter's fix: orange, with their count. */
  wording: Look | null;
  draft: CriteriaButton;
  /** Add to the description: opens the sheet with the draft below its text. Null before there is a draft. */
  sheet: CriteriaButton | null;
  /** Open as an update: an update draft, to post as a comment. Null before there is a draft. */
  update: CriteriaButton | null;
}

export interface CriteriaIn {
  task: Pick<Task, 'id' | 'source' | 'state'>;
  draft: CriteriaDraft | null;
  drafting: boolean;
  /** The project's tracker says "edits": true, so the sheet writes the ticket's description. */
  edits: boolean;
  kind: TrackerKind | null;
  /** What the ticket's description holds that can't be written back, by name (T-80). */
  unkept?: string[];
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/** What the drafter read, in words: the ticket and how many comments and related tickets, or the description only. */
export const readWords = (r: CriteriaDraft['read']): string =>
  (r.full ? `Drafted from the ticket, ${plural(r.comments, 'comment')} and ${plural(r.related, 'related ticket')}.` : 'Drafted from the task\'s description only: its comments weren\'t read.');

/**
 * Why the draft can't go in the sheet's description, or null: the task can't be edited now, its tracker's
 * settings keep edits off, its tracker's text can't be written, or its description holds what can't be
 * written back. The person can still open it as an update.
 */
export function sheetRefusal(i: Pick<CriteriaIn, 'task' | 'edits' | 'kind' | 'unkept'>): string | null {
  const busy = editRefusal(i.task);
  if (busy) return busy;
  if (!i.edits || !i.kind) return `Its description can't change from here. ${EDITS_OFF}`;
  return textRefusal(i.kind) ?? (i.unkept?.length ? unkeptRefusal(i.unkept) : null);
}

/** The section for a tracker task's page, or null for a task with no ticket: its sheet holds its brief. */
export function ticketCriteria(i: CriteriaIn): TicketCriteria | null {
  if (!ticketOf(i.task)) return null;
  const d = i.draft;
  const look: Look = i.drafting ? { label: 'Drafting', icon: 'sync~spin', tone: 'blue' }
    : d ? { label: 'Drafted', icon: 'pass', tone: 'blue' } : { label: 'Not drafted yet', icon: 'circle-large-outline', tone: 'neutral' };
  const note = i.drafting ? 'An agent is reading the ticket, its comments, its related tickets and the code. It changes nothing.'
    : d ? null : 'An agent can draft acceptance criteria, test steps and edge cases from the ticket, its comments and the code, for you to edit.';
  const busy = i.drafting ? 'It\'s drafting now' : null;
  return {
    task: i.task.id, look, note, body: d ? fromMarkdown(d.markdown) : null, count: d ? d.criteria.length : null, at: d?.at ?? null, read: d ? readWords(d.read) : null,
    wording: d?.wording.length ? { label: `Wording: ${plural(d.wording.length, 'finding')}`, icon: 'whole-word', tone: 'orange' } : null,
    draft: { label: d ? 'Draft again' : 'Draft acceptance criteria', disabled: busy },
    sheet: d ? { label: 'Add to the description', disabled: busy ?? sheetRefusal(i) } : null,
    update: d ? { label: 'Open as an update', disabled: busy } : null,
  };
}

/** The sheet's own drafting (T-81): what it can add to its description, and whether it's drafting now. */
export interface SheetCriteria {
  /** The stored draft under its heading, to add at once. Null before the first. */
  section: string | null;
  at: string | null;
  drafting: boolean;
}

/**
 * The sheet with its drafting, for a tracker task whose description Save writes to the ticket. With `add`,
 * the draft is already below the description's text, under its own heading, as Add to the description
 * opens it. A sheet whose description is read-only, or a task with no ticket, is as it was.
 */
export function withSheetCriteria(sheet: TaskSheet, draft: CriteriaDraft | null, drafting: boolean, add = false): TaskSheet {
  const writable = !!sheet.ticketEdits?.base && !sheet.ticketEdits.unkept;
  if (!writable) return sheet;
  const fields = add && draft ? { ...sheet.fields, brief: withCriteria(sheet.fields.brief, draft.markdown) } : sheet.fields;
  return { ...sheet, fields, criteria: { section: draft ? criteriaSection(draft.markdown) : null, at: draft?.at ?? null, drafting }, ...(add && draft ? { drafted: true } : {}) };
}

/** The ways a page asks for a draft: draft it, open it as an update, or open the sheet with it in the description. */
export const CRITERIA_ACTIONS = ['criteria-draft', 'criteria-update', 'criteria-sheet'] as const;

export type Message =
  /** A task page's Draft acceptance criteria, Open as an update, or Add to the description (T-81). */
  | { type: (typeof CRITERIA_ACTIONS)[number]; project: string; task: string }
  /** The sheet's Draft acceptance criteria (T-81): the draft comes back for its description box. */
  | { type: 'task-sheet-criteria'; project: string; task: string };

const forTask = (x: Record<string, unknown>): boolean => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string);

export const area: ModelArea = {
  messages: { 'criteria-draft': forTask, 'criteria-update': forTask, 'criteria-sheet': forTask, 'task-sheet-criteria': forTask },
};
