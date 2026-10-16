// The History entries a tab has loaded (D-???), a page at a time: what each new model adds at the top, and
// each page the extension sends added at the end, and the row in view kept in place as it draws again. It
// reads only the boxes it's given, never the page's own, so it's testable. The page imports no values from
// the extension's model (D-121), so historyKind and newestFirst are copies of model/history-pages.ts's and
// model/history.ts's; test/history-pages.test.ts holds them to the same answers.

import type { HistoryItem } from '../src/model/history.ts';
import type { HistoryAfter, HistoryCounts, HistoryFilter, HistoryPage, HistoryReply } from '../src/model/history-pages.ts';

/** The filter an entry counts under. Autopilot's steps are Tasks (D-064). */
export const historyKind = (i: HistoryItem): Exclude<HistoryFilter, 'all'> => (i.kind === 'autopilot' ? 'move' : i.kind);

/** History's order: newest first, and by id where two are at the same moment. */
export const newestFirst = (a: { at: string; id: string }, b: { at: string; id: string }): number => b.at.localeCompare(a.at) || a.id.localeCompare(b.id);

/** A filter's entries so far, newest first; whether older ones are still to come; and whether a page is asked for. */
export interface Loaded {
  filter: HistoryFilter;
  items: HistoryItem[];
  more: boolean;
  /** A page is asked for and not yet here: "Loading…" shows, and nothing more is asked. */
  waiting: boolean;
  counts: HistoryCounts;
}

/**
 * What a filter starts from, given the model's first page, which is All's. All has its first page already;
 * another filter waits for its own.
 */
export function startFrom(first: HistoryPage, filter: HistoryFilter): Loaded {
  return filter === 'all' ? { filter, items: first.items, more: first.more, waiting: false, counts: first.counts }
    : { filter, items: [], more: true, waiting: true, counts: first.counts };
}

/**
 * A new model's first page, added to what's loaded: entries newer than the newest one loaded go on top, and
 * nothing loaded is lost. When All's whole first page is newer and more are still to come, there may be a gap
 * between them, so All starts again from the new page.
 */
export function withNewer(l: Loaded, first: HistoryPage): Loaded {
  const top = l.items[0];
  const mine = (i: HistoryItem) => l.filter === 'all' || historyKind(i) === l.filter;
  // Nothing loaded: a page asked for is still to come, or the filter held nothing, so any of its kind is new.
  if (!top) return l.waiting ? { ...l, counts: first.counts } : l.filter === 'all' ? startFrom(first, 'all') : { ...l, items: first.items.filter(mine), counts: first.counts };
  const newer = first.items.filter((i) => mine(i) && newestFirst(i, top) < 0);
  if (l.filter === 'all' && first.more && newer.length === first.items.length) return startFrom(first, 'all');
  return { ...l, items: [...newer, ...l.items], counts: first.counts };
}

/** Where the next page starts: after the last entry loaded. */
export const afterOf = (l: Loaded): HistoryAfter | undefined => {
  const last = l.items.at(-1);
  return last ? { at: last.at, id: last.id } : undefined;
};

/**
 * A page the extension sent, added at the end, or null when it isn't for what's loaded now: another filter's,
 * or one asked for after a different entry. Entries already loaded aren't added twice.
 */
export function withPage(l: Loaded, r: Omit<HistoryReply, 'type'>): Loaded | null {
  const after = afterOf(l) ?? null;
  if (r.filter !== l.filter || r.after?.id !== after?.id) return null;
  const have = new Set(l.items.map((i) => i.id));
  return { ...l, items: [...l.items, ...r.page.items.filter((i) => !have.has(i.id))], more: r.page.more, waiting: false, counts: r.page.counts };
}

/**
 * How much an element is drawn bigger or smaller than its layout: under 1 while the modal grows in as it
 * opens (task-modal.css), 1 once it's open, and 1 for an element with no height, which can't say.
 */
export const scaleOf = (e: HTMLElement): number => (e.offsetHeight ? e.getBoundingClientRect().height / e.offsetHeight : 1);

/**
 * Keeps a person's place in History as it draws again: the first row in view stays where it was, though new
 * entries came in above it. At the top, the new entries show.
 */
export function keepPlace(body: HTMLElement): () => void {
  if (body.scrollTop <= 0) return () => {};
  const top = body.getBoundingClientRect().top;
  const rows = () => [...body.querySelectorAll<HTMLElement>('.history-feed > li[data-id]')];
  const first = rows().find((r) => r.getBoundingClientRect().bottom > top);
  if (!first) return () => {};
  const id = first.dataset.id;
  // Measured from the box's own top, which moves if what holds it scrolls, in the layout's px.
  const was = (first.getBoundingClientRect().top - top) / scaleOf(body);
  return () => {
    const again = rows().find((r) => r.dataset.id === id);
    if (!again) return;
    // Measured again after each move, as a scroll may land short of where it was set (a whole px, or what
    // the browser makes of it), up to three times.
    for (let i = 0; i < 3; i++) {
      const off = (again.getBoundingClientRect().top - body.getBoundingClientRect().top) / scaleOf(body) - was;
      if (Math.abs(off) < 1) break;
      body.scrollTop += off;
    }
  };
}
