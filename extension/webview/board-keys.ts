// A board's keys (T-54): which card an arrow goes to, which lane a held card's choice goes to, and what the
// live line says. Pure: no page state, so node:test loads it (board-keys.test.ts). board-nav.ts wires it to
// the page. It sits here, not in src/logic, because the page imports no values from outside extension/webview.

import type { Look } from '../src/model/shared.ts';

/** The keys that move focus between a board's cards. */
export const CARD_KEYS = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'] as const;
/** The keys that move a held card's choice between the lanes it may land in. */
export const LANE_KEYS = ['ArrowRight', 'ArrowLeft'] as const;

/**
 * The card a key moves focus to: `columns` holds each column's card ids, left to right, top to bottom. Down
 * and Up go to the next and previous card in the column, Home and End to its first and last. Right and Left
 * go to the card at the same place in the next and previous column that has cards, or that column's last
 * card when it has fewer. At an edge, focus stays on the card. Null for a key it doesn't take, or a card
 * that isn't on the board.
 */
export function nextCard(columns: readonly (readonly string[])[], card: string, key: string): string | null {
  if (!(CARD_KEYS as readonly string[]).includes(key)) return null;
  const col = columns.findIndex((c) => c.includes(card));
  if (col < 0) return null;
  const cards = columns[col]!;
  const row = cards.indexOf(card);
  if (key === 'ArrowDown') return cards[Math.min(row + 1, cards.length - 1)]!;
  if (key === 'ArrowUp') return cards[Math.max(row - 1, 0)]!;
  if (key === 'Home') return cards[0]!;
  if (key === 'End') return cards[cards.length - 1]!;
  const step = key === 'ArrowRight' ? 1 : -1;
  for (let i = col + step; i >= 0 && i < columns.length; i += step) {
    const there = columns[i]!;
    // An empty column is passed over, to the next one with a card.
    if (there.length) return there[Math.min(row, there.length - 1)]!;
  }
  return card;
}

/**
 * Where a held card's choice goes on a key: `columns` is every column's id, left to right; `lanes` the ones
 * the card may land in; `at` the chosen lane, or the card's own column before a choice. Right and Left go
 * to the nearest lane that way; at the last one, the choice stays. Null for a key it doesn't take.
 */
export function nextLane(columns: readonly string[], lanes: readonly string[], at: string, key: string): string | null {
  if (!(LANE_KEYS as readonly string[]).includes(key)) return null;
  const from = columns.indexOf(at);
  const order = columns.filter((c) => lanes.includes(c));
  const ahead = key === 'ArrowRight' ? order.find((c) => columns.indexOf(c) > from) : order.findLast((c) => columns.indexOf(c) < from);
  return ahead ?? at;
}

/** How each step of a move by keys shows, on the card and the board's live line: an icon and a word each. */
export const MOVE_LOOK: Record<'moving' | 'moved' | 'stays' | 'cannot', Look> = {
  moving: { label: 'Moving', icon: 'move', tone: 'blue' },
  moved: { label: 'Moved', icon: 'check', tone: 'blue' },
  stays: { label: 'Put down', icon: 'circle-slash', tone: 'neutral' },
  cannot: { label: 'Can\'t move', icon: 'warning', tone: 'orange' },
};

/** What the live line says at each step: picked up, a column chosen, dropped, put down, or why it can't move. */
export const MOVE_WORDS = {
  moving: (card: string): string => `Moving ${card}. Left and Right choose a column. Enter drops it. Escape cancels.`,
  choice: (card: string, column: string): string => `${column}. Enter drops ${card} here.`,
  moved: (card: string, column: string): string => `Moved ${card} to ${column}`,
  stays: (card: string, column: string): string => `Put ${card} down. It stays in ${column}.`,
  cannot: (card: string, column: string): string => `${card} can't move from ${column}. No other column takes it from here.`,
};
