/**
 * A ticket's own text, written from the task sheet where the project allows edits (T-80): what changed
 * since the sheet opened, whether someone else changed the ticket meanwhile, and Save's steps in order:
 * read the ticket again, stop on a change made meanwhile, write, then refresh the task from the ticket.
 * Its status, assignee and labels as the sheet shows them. No vscode import, so it's testable.
 */

import { type Ticket, type TicketText, type TrackerField, trackerHasField } from '../../../packages/core/src/trackers/types.ts';

/** A ticket's title and description as Markdown: what the sheet opened with, what's on the ticket now, or what a person wrote. */
export interface TicketTextBase {
  title: string;
  markdown: string;
}

/** What Save writes: the title or description a person changed from what the sheet opened with, and nothing else. */
export function textChanges(base: TicketTextBase, written: TicketTextBase): TicketText {
  const out: TicketText = {};
  if (written.title.trim() !== base.title.trim()) out.title = written.title.trim();
  if (written.markdown.trim() !== base.markdown.trim()) out.markdown = written.markdown.trim();
  return out;
}

/** The ticket's text now, when someone changed it after the sheet opened, or null when it's as it was. Space at either end isn't a change. */
export function textConflict(base: TicketTextBase, now: TicketTextBase): TicketTextBase | null {
  const same = (a: string, b: string) => a.trim() === b.trim();
  return same(base.title, now.title) && same(base.markdown, now.markdown) ? null : { title: now.title, markdown: now.markdown };
}

/** How Save went: written, or not needed; why not, with the person's text kept; or the ticket's text now, changed meanwhile. */
export type TextSaveReply = { ok: true; wrote: boolean } | { ok: false; error: string } | { ok: false; conflict: TicketTextBase };

/** What Save does to the ticket, passed in so it's tested without a tracker or acc. */
export interface TextSaveSteps {
  /** The ticket, read again from its tracker. */
  read(): Promise<TicketTextBase>;
  /** Writes the fields given to the ticket. */
  write(text: TicketText): Promise<void>;
  /** The task read again from the ticket, as intake would. */
  refresh(): Promise<void>;
}

const why = (e: unknown): string => (e as Error)?.message || 'It gave no reason.';

/**
 * Save for a ticket's text (T-80). Nothing changed: nothing is read or written. Otherwise the ticket is
 * read again first: someone changed it since the sheet opened, so Save stops, writes nothing, and gives
 * the ticket's text now, for the person to pick from. A ticket that now says just what the person wrote
 * needs no write. A failed read or write says why, and writes nothing more. Once written, the task is
 * refreshed from the ticket; a refresh that fails leaves it to the next intake, since the ticket is right.
 */
export async function saveTicketText(steps: TextSaveSteps, base: TicketTextBase, written: TicketTextBase): Promise<TextSaveReply> {
  const change = textChanges(base, written);
  if (!Object.keys(change).length) return { ok: true, wrote: false };
  let now: TicketTextBase;
  try {
    now = await steps.read();
  } catch (e) {
    return { ok: false, error: `Its ticket couldn't be read again, so nothing was written. ${why(e)}` };
  }
  const theirs = textConflict(base, now);
  if (theirs && !textConflict(written, now)) return { ok: true, wrote: false };
  if (theirs) return { ok: false, conflict: theirs };
  try {
    await steps.write(change);
  } catch (e) {
    return { ok: false, error: `Its ticket wasn't changed. ${why(e)}` };
  }
  await steps.refresh().catch(() => undefined);
  return { ok: true, wrote: true };
}

/** The ticket fields the sheet changes through the tracker, as the ticket page's Change does. */
export const SHEET_TICKET_FIELDS = ['status', 'assign', 'labels'] as const;
export type SheetTicketField = (typeof SHEET_TICKET_FIELDS)[number];

/** One of the ticket's fields in the sheet: what it's called, what it is now, and its Change button's label. */
export interface SheetRow {
  field: SheetTicketField;
  label: string;
  value: string;
  change: string;
}

const TRACKER_FIELD: Record<SheetTicketField, TrackerField> = { status: 'status', assign: 'assignee', labels: 'labels' };

/** The ticket's status, assignees and labels as the sheet shows them, each only where its tracker has the field. */
export function sheetRows(t: Pick<Ticket, 'status' | 'assignees' | 'labels'>, fields?: readonly TrackerField[]): SheetRow[] {
  const rows: SheetRow[] = [
    { field: 'status', label: 'Status', value: t.status.name, change: 'Change status' },
    { field: 'assign', label: t.assignees.length > 1 ? 'Assignees' : 'Assignee', value: t.assignees.map((p) => p.name).join(', ') || 'Nobody', change: 'Change assignee' },
    { field: 'labels', label: 'Labels', value: t.labels.map((l) => l.name).join(', ') || 'None', change: 'Change labels' },
  ];
  return rows.filter((r) => trackerHasField({ fields }, TRACKER_FIELD[r.field]));
}
