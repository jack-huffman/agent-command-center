/**
 * A tracker task's ticket, changed from the task sheet where the project allows edits (T-80): the ticket
 * read for the sheet, Save's write of its title and description, and Change on its status, assignee and
 * labels. A client's tracker is theirs, so each refuses where the tracker doesn't say "edits": true (D-066),
 * whatever the page sent. The quick picks a Change opens are the ticket page's own, here so both use them.
 */

import * as vscode from 'vscode';
import { textRefusal, type Ticket, type TrackerClient } from '../../packages/core/src/trackers/types.ts';
import type { Hub, Project } from './hub.ts';
import { accImport, accRefusal, trackInput } from './logic/connect.ts';
import { inProcessWords } from './logic/processes.ts';
import { ticketActionRefusal } from './model/task-page.ts';
import { EDITS_OFF, type SheetTicket } from './model/task-sheet.ts';
import { saveTicketText, type SheetRow, sheetRows, type SheetTicketField, type TextSaveReply, type TicketTextBase } from './model/ticket-text.ts';
import type { Trackers } from './trackers.ts';

type AccRun = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

/** How a Change in the sheet went: the ticket's fields as they are now, or why not. */
export type FieldReply = { ok: true; changed: boolean; rows: SheetRow[] } | { ok: false; error: string };

export class TicketEdits {
  private readonly hub: Hub;
  private readonly trackers: Trackers;
  private readonly acc: AccRun;

  constructor(hub: Hub, trackers: Trackers, acc: AccRun) {
    this.hub = hub;
    this.trackers = trackers;
    this.acc = acc;
  }

  /** The project, the tracker that holds a key, and whether it allows edits: null for a key none holds. */
  private where(root: string, key: string): { p: Project; index: number; edits: boolean; kind: SheetTicket['kind'] } | null {
    const p = this.hub.project(root);
    const index = p ? this.trackers.trackerFor(p, key) : null;
    const t = p && index !== null ? this.trackers.trackers(p)[index] : undefined;
    return p && index !== null && t ? { p, index, edits: !!t.edits, kind: t.kind } : null;
  }

  /** A tracker task's ticket for the sheet: read only where edits are on; a read that fails says why. */
  async sheetTicket(root: string, key: string): Promise<SheetTicket | null> {
    const w = this.where(root, key);
    if (!w) return null;
    if (!w.edits) return { edits: false, kind: w.kind, ticket: null, error: null };
    try {
      const client = await this.trackers.client(w.p, w.index);
      return { edits: true, kind: w.kind, fields: client.fields, ticket: await client.ticket(key), error: null };
    } catch (e) {
      return { edits: true, kind: w.kind, ticket: null, error: inProcessWords((e as Error).message) };
    }
  }

  /**
   * Save's write of a ticket's title and description (T-80), only where edits are on and its tracker takes
   * them. The ticket is read again first, and a change made since the sheet opened stops it. Once written,
   * the task is refreshed from the ticket, keeping the dependencies intake gave it, and the boards reload.
   */
  async saveText(root: string, key: string, base: TicketTextBase, written: TicketTextBase): Promise<TextSaveReply> {
    const w = this.where(root, key);
    if (!w) return { ok: false, error: `${key} isn't one of the project's tickets any more.` };
    if (!w.edits) return { ok: false, error: `Its ticket can't change from here. ${EDITS_OFF}` };
    const no = textRefusal(w.kind);
    if (no) return { ok: false, error: no };
    let client: TrackerClient;
    try {
      client = await this.trackers.client(w.p, w.index);
    } catch (e) {
      return { ok: false, error: inProcessWords((e as Error).message) };
    }
    const r = await saveTicketText({
      read: () => client.ticket(key),
      write: (text) => client.setText(key, text).catch((e: unknown) => { throw new Error(inProcessWords((e as Error).message)); }),
      refresh: () => this.refresh(w.p, client, key),
    }, base, written);
    if (r.ok && r.wrote) void this.trackers.loadBoards(root);
    return r;
  }

  /** The task read again from its ticket, as Track does, with the dependencies it has now. */
  private async refresh(p: Project, client: TrackerClient, key: string): Promise<void> {
    const deps = this.hub.ledger(p.root)?.tasks.find((t) => t.id === key.toUpperCase())?.deps ?? [];
    const input = trackInput(await client.ticket(key)).map((x) => ({ ...x, deps }));
    const why = accRefusal(await accImport(this.acc, p.root, input));
    if (why !== null) throw new Error(why);
    await this.hub.loadTasks(true);
  }

  /** Change on the sheet's status, assignee or labels: the ticket page's quick pick, with its rule (D-066), then the fields as they are now. */
  async changeField(root: string, key: string, field: SheetTicketField): Promise<FieldReply> {
    const w = this.where(root, key);
    if (!w) return { ok: false, error: `${key} isn't one of the project's tickets any more.` };
    const refused = ticketActionRefusal(field, w.edits);
    if (refused) return { ok: false, error: inProcessWords(refused) };
    try {
      const client = await this.trackers.client(w.p, w.index);
      const ticket = await client.ticket(key);
      const changed = await pickField(client, key, ticket, field);
      const now = changed ? await client.ticket(key) : ticket;
      if (changed) void this.trackers.loadBoards(root);
      return { ok: true, changed, rows: sheetRows(now, client.fields) };
    } catch (e) {
      return { ok: false, error: inProcessWords((e as Error).message) };
    }
  }
}

/** Change on a ticket's status, assignee or labels: its quick pick, as the ticket page and the sheet open it. False when nothing changed. */
export function pickField(client: TrackerClient, key: string, ticket: Pick<Ticket, 'status' | 'assignees' | 'labels'>, field: SheetTicketField): Promise<boolean> {
  return field === 'status' ? pickStatus(client, key, ticket) : field === 'assign' ? pickAssignees(client, key, ticket) : pickLabels(client, key, ticket);
}

/** The ticket's status, picked from the moves it can make now. False when it has none, or none was picked. */
async function pickStatus(client: TrackerClient, key: string, ticket: Pick<Ticket, 'status'>): Promise<boolean> {
  const moves = await client.transitions(key);
  if (!moves.length) {
    void vscode.window.showInformationMessage(`${key} has no moves from ${ticket.status.name} right now.`);
    return false;
  }
  const pick = await vscode.window.showQuickPick(moves.map((m) => ({ label: m.name, description: m.to.name === m.name ? undefined : `→ ${m.to.name}`, m })), { title: `${key}: ${ticket.status.name}`, placeHolder: 'Move it to…' });
  if (!pick) return false;
  await client.transition(key, pick.m);
  return true;
}

/** The ticket's assignees: several from a checklist on GitHub and monday.com, one by search on Jira. False when it was cancelled. */
async function pickAssignees(client: TrackerClient, key: string, ticket: Pick<Ticket, 'assignees'>): Promise<boolean> {
  const current = ticket.assignees;
  if (client.kind === 'github' || client.kind === 'monday') {
    // GitHub and a monday.com People column take several: a checklist of everyone who can be assigned.
    const people = await client.assignable(key, '');
    const items = people.map((x) => ({ label: x.name, picked: current.some((c) => c.id === x.id), x }));
    const chosen = await vscode.window.showQuickPick(items, { title: `Assignees for ${key}`, canPickMany: true, placeHolder: 'Tick everyone who should work on it' });
    if (!chosen) return false;
    await client.assign(key, chosen.map((c) => c.x));
    return true;
  }
  // Jira takes one: search as you type, with yourself and nobody first.
  const me = await client.me();
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { id: string | null; name: string }>();
  qp.title = `Assignee for ${key}`;
  qp.placeholder = 'Type a name to search';
  const base = [{ label: '$(account) Assign to me', description: me.name, id: me.id, name: me.name }, { label: '$(circle-slash) Unassigned', id: null, name: '' }];
  qp.items = base;
  let timer: NodeJS.Timeout | undefined;
  qp.onDidChangeValue((v) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      qp.busy = true;
      try {
        const found = await client.assignable(key, v);
        qp.items = [...base, ...found.map((x) => ({ label: x.name, id: x.id, name: x.name }))];
      } finally {
        qp.busy = false;
      }
    }, 250);
  });
  const pick = await new Promise<(typeof base)[number] | undefined>((resolve) => {
    qp.onDidAccept(() => { resolve(qp.selectedItems[0] as (typeof base)[number] | undefined); qp.hide(); });
    qp.onDidHide(() => resolve(undefined));
    qp.show();
  });
  qp.dispose();
  if (!pick) return false;
  await client.assign(key, pick.id ? [{ id: pick.id, name: pick.name }] : []);
  return true;
}

/** The ticket's labels, ticked from the tracker's, or a new one typed on Jira. False when nothing changed. */
async function pickLabels(client: TrackerClient, key: string, ticket: Pick<Ticket, 'labels'>): Promise<boolean> {
  const have = new Set(ticket.labels.map((l) => l.name));
  const all = await client.labels();
  const names = [...new Set([...all.map((l) => l.name), ...have])].sort((a, b) => a.localeCompare(b));
  const qp = vscode.window.createQuickPick<vscode.QuickPickItem>();
  qp.title = `Labels for ${key}`;
  qp.canSelectMany = true;
  qp.placeholder = client.kind === 'jira' ? 'Tick labels, or type a new one' : 'Tick labels';
  const items = names.map((label) => ({ label }));
  qp.items = items;
  qp.selectedItems = items.filter((i) => have.has(i.label));
  if (client.kind === 'jira') {
    // Jira labels are free text, so a typed name that isn't there yet can be added.
    qp.onDidChangeValue((v) => {
      const typed = v.trim().replace(/\s+/g, '-');
      const extra = typed && !names.includes(typed) ? [{ label: typed, description: 'new label' }] : [];
      const kept = qp.selectedItems;
      qp.items = [...extra, ...items];
      qp.selectedItems = qp.items.filter((i) => kept.some((k) => k.label === i.label));
    });
  }
  const chosen = await new Promise<readonly vscode.QuickPickItem[] | undefined>((resolve) => {
    qp.onDidAccept(() => { resolve(qp.selectedItems); qp.hide(); });
    qp.onDidHide(() => resolve(undefined));
    qp.show();
  });
  qp.dispose();
  if (!chosen) return false;
  const want = new Set(chosen.map((c) => c.label));
  const add = [...want].filter((n) => !have.has(n));
  const remove = [...have].filter((n) => !want.has(n));
  if (!add.length && !remove.length) return false;
  await client.setLabels(key, add, remove);
  return true;
}
