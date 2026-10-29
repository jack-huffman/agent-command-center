/**
 * The tickets the Command Center saved for a session to read (T-141, D-T-141). The Command Center holds each
 * tracker's sign-in (D-027) and a session can't reach it, so the Command Center writes what it already reads where a
 * session can read it: each card's whole ticket, one file a ticket in `<git dir>/acc/tickets/<key>.json`, beside the
 * boards it drew last (`boards.json`). Neither is committed, and neither holds a sign-in or a token.
 *
 * A saved ticket is the ticket a plan reads (`planTicket`), with what a reader needs to tell whether it is current:
 * when it was read, and the tracker's last-changed time it was read at. `acc analyze --ticket` and
 * `acc draft criteria --ticket` take the file as it is. `acc board` and `acc ticket` read these for a session, and never
 * call a tracker.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileId } from './analyze.ts';
import { writeAtomic } from './atomic.ts';
import type { Config, Tracker } from './config.ts';
import { type PlanTicket, planTicket } from './plan-ticket.ts';
import { isObj, plural } from './text.ts';
import type { Board, BoardCard, Ticket } from './trackers/types.ts';

// ---------------------------------------------------------------- the boards a project drew last

/** One tracker's last board, with who Mine meant, and when it loaded. */
export interface CachedBoard {
  /** The tracker's settings as written, so a tracker that changed never shows another place's cards. */
  tracker: string;
  board: Board;
  me: { id: string; name: string } | null;
  at: string;
}

export const boardCacheFile = (paths: { stateDir: string }): string => join(paths.stateDir, 'boards.json');

/** A tracker's key in the cache, and in each saved ticket: its settings as written. They hold no sign-in: those are kept in the editor's secrets. */
export const trackerKey = (t: Tracker): string => JSON.stringify(t);

/** A project's trackers as their boards are kept: a GitHub tracker with no repo uses the project's own repo. */
export const boardTrackers = (config: Pick<Config, 'trackers' | 'github'>): Tracker[] =>
  config.trackers.map((t) => (t.kind === 'github' && !t.repo && config.github ? { ...t, repo: config.github.repo } : t));

/** Whether a value looks like a board this version can draw: a place, a title, and lists of columns and cards. */
function isBoard(x: unknown): x is Board {
  return isObj(x) && typeof x.place === 'string' && typeof x.title === 'string' && typeof x.source === 'string'
    && Array.isArray(x.columns) && Array.isArray(x.cards);
}

function isCached(x: unknown): x is CachedBoard {
  return isObj(x) && typeof x.tracker === 'string' && typeof x.at === 'string' && isBoard(x.board)
    && (x.me === null || (isObj(x.me) && typeof x.me.id === 'string' && typeof x.me.name === 'string'));
}

/** Every cached board in the file. A missing or broken file is none: the next load fills it, and says nothing. */
export function readCachedBoards(paths: { stateDir: string }): CachedBoard[] {
  try {
    const r = JSON.parse(readFileSync(boardCacheFile(paths), 'utf8')) as unknown;
    return isObj(r) && Array.isArray(r.boards) ? r.boards.filter(isCached) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- one saved ticket

/** The ticket as `planTicket` gives it, with a field the tracker can't give left out, and what says whether it is current. */
export interface SavedTicket extends Omit<PlanTicket, 'url' | 'changes' | 'full' | 'why'> {
  v: 1;
  /** Its tracker's key (`trackerKey`): a tracker whose settings change drops the tickets it saved. */
  tracker: string;
  url?: string;
  /** The ticket's changes field (T-105), where the tracker names one and it holds text. */
  changes?: { name: string; markdown: string };
  /** The tracker's last-changed time the ticket was read at. Left out where the tracker gives none. */
  changed?: string;
  /** When it was read. */
  saved: string;
  /** Why the last read of it failed, and when: this copy is the last good one. */
  failed?: { why: string; at: string };
}

/** The ticket as its tracker's full read gives it: what a plan reads, and when it last changed. */
export type TicketRead = Pick<Ticket, 'key' | 'title' | 'url' | 'markdown' | 'body' | 'comments' | 'related' | 'updated'>;

export const ticketsDir = (paths: { stateDir: string }): string => join(paths.stateDir, 'tickets');

/** A ticket's file. A key that could leave the folder is refused before any path is built from it. */
export const savedTicketFile = (paths: { stateDir: string }, key: string): string => join(ticketsDir(paths), `${fileId(key.toUpperCase())}.json`);

/** The ticket to save, from its tracker's read: a field the tracker can't give is left out, never an empty string. */
export function savedTicketOf(t: TicketRead, changes: { name: string; markdown: string } | null, tracker: string, now: Date): SavedTicket {
  const { url, changes: field, full: _full, why: _why, ...rest } = planTicket(t, changes);
  return {
    v: 1, tracker, ...rest, ...(url ? { url } : {}), ...(field ? { changes: field } : {}),
    ...(t.updated?.trim() ? { changed: t.updated.trim() } : {}), saved: now.toISOString(),
  };
}

function isSaved(x: unknown): x is SavedTicket {
  return isObj(x) && x.v === 1 && typeof x.key === 'string' && typeof x.tracker === 'string' && typeof x.saved === 'string'
    && typeof x.title === 'string' && typeof x.markdown === 'string' && Array.isArray(x.comments) && Array.isArray(x.related);
}

/** A ticket's saved copy, or null: none saved, a key no file can be named for, or a file this version can't read. */
export function readSavedTicket(paths: { stateDir: string }, key: string): SavedTicket | null {
  try {
    const x = JSON.parse(readFileSync(savedTicketFile(paths, key), 'utf8')) as unknown;
    return isSaved(x) ? x : null;
  } catch {
    return null;
  }
}

/** Every saved ticket, by key. */
export function readSavedTickets(paths: { stateDir: string }): SavedTicket[] {
  let names: string[];
  try {
    names = readdirSync(ticketsDir(paths)).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  return names.map((n) => readSavedTicket(paths, n.slice(0, -'.json'.length))).filter((t): t is SavedTicket => !!t).sort((a, b) => a.key.localeCompare(b.key));
}

/** Saves a ticket whole, as soon as it is read, so a queue stopped part-way never reads it again. */
export function writeSavedTicket(paths: { stateDir: string }, t: SavedTicket): void {
  mkdirSync(ticketsDir(paths), { recursive: true });
  writeAtomic(savedTicketFile(paths, t.key), `${JSON.stringify(t, null, 2)}\n`);
}

/**
 * A read that failed: the last good copy is kept, marked with why. A ticket with no saved copy saves nothing, so the
 * next load reads it again. Gives back whether a copy was marked.
 */
export function markSavedFailed(paths: { stateDir: string }, key: string, why: string, now: Date): boolean {
  const last = readSavedTicket(paths, key);
  if (!last) return false;
  writeSavedTicket(paths, { ...last, failed: { why, at: now.toISOString() } });
  return true;
}

/** Removes a ticket's saved copy. */
export function removeSavedTicket(paths: { stateDir: string }, key: string): void {
  rmSync(savedTicketFile(paths, key), { force: true });
}

/**
 * The saved tickets that follow the boards (D-072): a ticket of a tracker the project no longer names, as its settings
 * are now, is removed, and so is one that left every board that loaded. A board that didn't load (`keys` null) keeps
 * its tracker's tickets. A ticket two trackers' boards show is saved under one of them: when it leaves that board but
 * another loaded board still shows it, it is kept, and moves to that board's tracker, so a sign-out removes it with
 * the board that shows it. `saved` is every saved ticket, read once by the caller. Gives back the keys removed.
 */
export function pruneSavedTickets(
  paths: { stateDir: string }, boards: readonly { tracker: string; keys: readonly string[] | null }[], saved: readonly SavedTicket[] = readSavedTickets(paths),
): string[] {
  const removed: string[] = [];
  const shows = (b: { keys: readonly string[] | null }, key: string): boolean => !!b.keys?.some((k) => k.toUpperCase() === key);
  for (const t of saved) {
    const key = t.key.toUpperCase();
    const mine = boards.filter((b) => b.tracker === t.tracker);
    if (mine.some((b) => !b.keys || shows(b, key))) continue;
    // Its tracker is still named, and another tracker's board shows it: kept, under that tracker.
    const other = mine.length ? boards.find((b) => b.tracker !== t.tracker && shows(b, key)) : undefined;
    if (other) {
      writeSavedTicket(paths, { ...t, tracker: other.tracker });
      continue;
    }
    removeSavedTicket(paths, t.key);
    removed.push(t.key);
  }
  return removed;
}

/** Removes every ticket a tracker saved, as on signing out of it. Gives back the keys removed. */
export function removeTrackerTickets(paths: { stateDir: string }, tracker: string): string[] {
  const gone = readSavedTickets(paths).filter((t) => t.tracker === tracker);
  for (const t of gone) removeSavedTicket(paths, t.key);
  return gone.map((t) => t.key);
}

// ---------------------------------------------------------------- whether a saved ticket is current

/**
 * How long a saved ticket of a card with no last-changed time is current: such a card is read again once its copy is
 * older. Every tracker acc reads gives one on its cards (T-141), so only a card list that left it out meets this.
 */
export const UNTIMED_MAX_MS = 24 * 60 * 60 * 1000;

const time = (s: string): number => Date.parse(s);

/** Whether `card` changed after `saved`: by the clock where both are times, or else where they differ. */
export function changedSince(card: string, saved: string | undefined): boolean {
  if (!saved) return true;
  const a = time(card);
  const b = time(saved);
  return Number.isNaN(a) || Number.isNaN(b) ? card !== saved : a > b;
}

/**
 * Whether a card's ticket is read in full again: it has no saved copy, its last-changed time moved since the copy was
 * read, or, for a card with no last-changed time, its copy is older than UNTIMED_MAX_MS. An unchanged ticket never is.
 */
export function needsRead(card: Pick<BoardCard, 'updated'>, saved: SavedTicket | null, now: Date): boolean {
  if (!saved) return true;
  if (card.updated) return changedSince(card.updated, saved.changed);
  return now.getTime() - time(saved.saved) > UNTIMED_MAX_MS;
}

/** When a ticket was saved, in words: "saved just now", "saved 12 minutes ago", "saved 3 hours ago", "saved 2 days ago". */
export function savedWords(saved: string, now: Date): string {
  const ms = now.getTime() - time(saved);
  if (Number.isNaN(ms) || ms < 60_000) return 'saved just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `saved ${plural(m, 'minute')} ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `saved ${plural(h, 'hour')} ago` : `saved ${plural(Math.floor(h / 24), 'day')} ago`;
}

/** What a session is told when nothing is saved: the Command Center saves the board and its tickets when it opens the project. */
export const NOTHING_SAVED = 'Nothing is saved for this project yet. Open the project in the Command Center: it saves its boards and their tickets as they load.';

/** A saved board's card for a session: where it sits, and whether its ticket is saved and current. */
export interface SavedCard {
  key: string;
  title: string;
  column: string;
  type: string | null;
  assignees: string[];
  priority: string | null;
  /** When the tracker last changed it, as the board's last load found it. */
  updated: string | null;
  /** Its saved ticket's read time, or null when none is saved yet. */
  saved: string | null;
  /** The board's last load found it changed since its saved copy, and it waits to be read again. */
  waiting: boolean;
  /** Why its last read failed, where it did. */
  failed: string | null;
}

/** A saved board for a session: its columns and their cards, each with whether its ticket is saved and current. */
export interface SavedBoardView {
  title: string;
  place: string;
  /** When the board last loaded. */
  at: string;
  columns: { name: string; cards: SavedCard[] }[];
}

/**
 * The saved boards as a session reads them. A card's ticket waits when the board's last load found a change after its
 * saved copy was read, or it has no saved copy yet. Only the boards the project's trackers name now are given.
 */
export function savedBoards(paths: { stateDir: string }, trackers: readonly Tracker[], now: Date): SavedBoardView[] {
  const keys = new Set(trackers.map(trackerKey));
  const tickets = new Map(readSavedTickets(paths).map((t) => [t.key.toUpperCase(), t]));
  return readCachedBoards(paths).filter((c) => keys.has(c.tracker)).map((c) => ({
    title: c.board.title, place: c.board.place, at: c.at,
    columns: c.board.columns.map((col) => ({
      name: col.name,
      cards: c.board.cards.filter((card) => col.statusIds.includes(card.status.id)).map((card): SavedCard => {
        const t = tickets.get(card.key.toUpperCase()) ?? null;
        return {
          key: card.key, title: card.fullTitle ?? card.title, column: col.name, type: card.type, assignees: card.assignees.map((a) => a.name), priority: card.priority,
          updated: card.updated ?? null, saved: t?.saved ?? null, waiting: needsRead(card, t, now), failed: t?.failed?.why ?? null,
        };
      }),
    })),
  }));
}

/** Whether the board's last load found the ticket changed since its saved copy, so a newer read waits. False when no board shows it. */
export function ticketWaiting(paths: { stateDir: string }, t: SavedTicket, now: Date): boolean {
  const card = readCachedBoards(paths).filter((c) => c.tracker === t.tracker).flatMap((c) => c.board.cards).find((c) => c.key.toUpperCase() === t.key.toUpperCase());
  return card ? needsRead(card, t, now) : false;
}
