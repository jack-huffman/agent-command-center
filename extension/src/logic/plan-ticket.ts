/**
 * Make a plan reads the whole ticket (T-110): the Command Center holds the tracker's sign-in, so it reads the
 * ticket, its comments, related tickets and changes field, and hands them to acc in a file, as drafting
 * acceptance criteria does (T-81). A read that fails hands over why, so the plan says its comments weren't read.
 * Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Task } from '../../../packages/core/src/ledger.ts';
import { planTicket } from '../../../packages/core/src/plan-ticket.ts';
import type { Ticket } from '../../../packages/core/src/trackers/types.ts';
import { ticketOf } from '../../../packages/core/src/updates.ts';
import { inProcessWords } from './processes.ts';

/** What reading a plan's ticket needs from the extension, passed in so it's tested without VS Code or a tracker. */
export interface PlanTicketHost {
  /** The ticket from its tracker, with its comments and related tickets. */
  ticket(root: string, key: string): Promise<Pick<Ticket, 'key' | 'title' | 'url' | 'markdown' | 'body' | 'comments' | 'related'>>;
  /** The ticket's changes field (T-105), with its name, or null where the tracker names none. */
  changes(root: string, key: string): Promise<{ name: string; markdown: string } | null>;
}

/** Why the ticket wasn't read, as the plan says it: a sentence that ends in a full stop. */
export function unreadWhy(e: unknown): string {
  const said = inProcessWords(String((e as Error)?.message ?? e ?? '').trim()).replace(/[.\s]+$/, '');
  return said ? `The ticket couldn't be read from its tracker: ${said}.` : 'The ticket couldn\'t be read from its tracker.';
}

/**
 * Writes the ticket file Make a plan hands to acc (`--ticket`) into `dir`, and gives back its path: the whole ticket,
 * or its key and why it couldn't be read. Null for a task with no tracker, which plans from its description.
 * A changes field that can't be read is left out; the rest of the ticket still is read.
 */
export async function writePlanTicketFile(host: PlanTicketHost, root: string, task: Pick<Task, 'id' | 'source'>, dir: string): Promise<string | null> {
  const t = ticketOf(task);
  if (!t) return null;
  let body: unknown;
  try {
    const ticket = await host.ticket(root, t.key);
    const changes = await host.changes(root, t.key).catch(() => null);
    body = planTicket(ticket, changes);
  } catch (e) {
    body = { key: t.key, unread: unreadWhy(e) };
  }
  const file = join(dir, 'ticket.json');
  writeFileSync(file, JSON.stringify(body));
  return file;
}
