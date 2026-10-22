/**
 * Make a plan reads the whole ticket (T-110): the Command Center holds the tracker's sign-in, so it reads the
 * ticket, its comments, related tickets and changes field, and hands them to acc in a file, as drafting
 * acceptance criteria does (T-81). A read that fails hands over why, so the plan says its comments weren't read.
 * Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */
import { rmSync, writeFileSync } from 'node:fs';
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

/** Why the ticket's file couldn't be written, as the person is told it: a sentence that ends in a full stop. */
export function unwrittenWhy(e: unknown): string {
  const code = (e as { code?: unknown })?.code;
  const said = typeof code === 'string' ? code : inProcessWords(String((e as Error)?.message ?? e ?? '').trim()).replace(/[.\s]+$/, '');
  return `The ticket couldn't be handed to the plan${said ? ` (${said})` : ''}, so this plan reads its description only and says the ticket wasn't read.`;
}

/**
 * The ticket's file for Make a plan, in a folder of its own that `remove` deletes once acc ends. A folder or a
 * file that can't be written is removed at once, and `failed` says why in words for the person; acc then plans
 * from the description. A task with no tracker has no file, so its folder is removed at once too.
 */
export async function planTicketFolder(host: PlanTicketHost, root: string, task: Pick<Task, 'id' | 'source'>, makeDir: () => string): Promise<{ file: string | null; failed: string | null; remove: () => void }> {
  let dir: string | null = null;
  let file: string | null = null;
  let failed: string | null = null;
  try {
    dir = makeDir();
    file = await writePlanTicketFile(host, root, task, dir);
  } catch (e) {
    failed = unwrittenWhy(e);
  } finally {
    if (!file && dir) rmSync(dir, { recursive: true, force: true });
  }
  const kept = file ? dir : null;
  return { file, failed, remove: () => { if (kept) rmSync(kept, { recursive: true, force: true }); } };
}
