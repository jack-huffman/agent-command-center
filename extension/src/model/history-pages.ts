/**
 * History a page at a time (D-170): the Overview gets the newest HISTORY_PAGE entries and each filter's count;
 * the page asks for the next page as a person scrolls near its end, and for the pages up to an entry a line
 * opens it at. No vscode import, so it's testable.
 */

import { type HistoryItem, newestFirst } from './history.ts';
import { type ModelArea, short } from './shared.ts';

/** How many entries one page holds. */
export const HISTORY_PAGE = 40;

/** History's filters: everything, or one kind. Autopilot's steps are Tasks (D-064). */
export const HISTORY_FILTERS = ['all', 'answer', 'move', 'run'] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

/** The filter an entry counts under. */
export const historyKind = (i: HistoryItem): Exclude<HistoryFilter, 'all'> => (i.kind === 'autopilot' ? 'move' : i.kind);

/** How many entries each filter holds, from every entry, not from the ones on the page. */
export type HistoryCounts = Record<HistoryFilter, number>;

export function historyCounts(items: HistoryItem[]): HistoryCounts {
  const n: HistoryCounts = { all: items.length, answer: 0, move: 0, run: 0 };
  for (const i of items) n[historyKind(i)]++;
  return n;
}

/** Where a page starts: just after this entry, in History's order. */
export interface HistoryAfter { at: string; id: string }

/** One or more pages of a filter's entries, newest first, and whether older ones are still to come. */
export interface HistoryPage {
  filter: HistoryFilter;
  items: HistoryItem[];
  more: boolean;
  counts: HistoryCounts;
}

const ofFilter = (items: HistoryItem[], filter: HistoryFilter): HistoryItem[] => (filter === 'all' ? items : items.filter((i) => historyKind(i) === filter));

/** Where the entries after `after` start. An entry that's gone still has its place, by its time and id. */
const startAfter = (shown: HistoryItem[], after: HistoryAfter | undefined): number => {
  if (!after) return 0;
  const i = shown.findIndex((x) => newestFirst(after, x) < 0);
  return i < 0 ? shown.length : i;
};

/** A filter's first page, or the page after `after`. */
export function historyPage(items: HistoryItem[], filter: HistoryFilter, after?: HistoryAfter): HistoryPage {
  const shown = ofFilter(items, filter);
  const from = startAfter(shown, after);
  const to = from + HISTORY_PAGE;
  return { filter, items: shown.slice(from, to), more: to < shown.length, counts: historyCounts(items) };
}

/**
 * The pages after `after` up to the one that holds entry `id`, so a line can open History at it. An entry
 * that isn't in the filter after `after`, as one that's gone, gives just the next page, with found false.
 */
export function historyUpTo(items: HistoryItem[], filter: HistoryFilter, id: string, after?: HistoryAfter): HistoryPage & { found: boolean } {
  const shown = ofFilter(items, filter);
  const from = startAfter(shown, after);
  const at = shown.findIndex((x, i) => i >= from && x.id === id);
  if (at < 0) return { ...historyPage(items, filter, after), found: false };
  const to = from + Math.ceil((at - from + 1) / HISTORY_PAGE) * HISTORY_PAGE;
  return { filter, items: shown.slice(from, to), more: to < shown.length, counts: historyCounts(items), found: true };
}

export type Message =
  /** The page asks for a filter's next page, after its last entry, or for the pages up to entry `upTo`. */
  { type: 'history-more'; filter: HistoryFilter; after?: HistoryAfter; upTo?: string };

const isAfter = (x: unknown): boolean => {
  const a = x as Record<string, unknown> | null;
  return !!a && typeof a === 'object' && short(a.at, 64) && short(a.id, 500);
};

export const area: ModelArea = {
  messages: {
    'history-more': (x) => (HISTORY_FILTERS as readonly unknown[]).includes(x.filter) && (x.after === undefined || isAfter(x.after)) && (x.upTo === undefined || short(x.upTo, 500)),
  },
};

/** What the extension sends back: the page asked for, with what it was asked, so the page can tell a late answer. */
export interface HistoryReply { type: 'history-page'; filter: HistoryFilter; after: HistoryAfter | null; upTo: string | null; found: boolean; page: HistoryPage }

/** The answer to a history-more, from every entry History holds now. */
export function historyReply(items: HistoryItem[], m: Message): HistoryReply {
  const after = m.after ?? null;
  if (m.upTo) {
    const { found, ...page } = historyUpTo(items, m.filter, m.upTo, m.after);
    return { type: 'history-page', filter: m.filter, after, upTo: m.upTo, found, page };
  }
  return { type: 'history-page', filter: m.filter, after, upTo: null, found: false, page: historyPage(items, m.filter, m.after) };
}
