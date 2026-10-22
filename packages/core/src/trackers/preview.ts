/**
 * The board a Connect page's choices would make (T-106), read before anything is kept. A description gives a
 * client for the place; this reads its board and nothing else, so choosing never writes to a tracker. A
 * card's count is the board of the place with that one choice made, so it shares the same reads.
 */
import { plural } from '../text.ts';
import type { Board, TrackerClient } from './types.ts';
import type { PickerSpec, Values } from './connect.ts';

/** What a place's board read gives: the board, or words for a place that has none (a Slack channel with no reaction). */
export interface PlaceBoard {
  board: Board | null;
  none: string | null;
}

/** Reads the board, and only the board: a preview never calls a write. */
export async function readPlace(source: Pick<TrackerClient, 'board'> | string): Promise<PlaceBoard> {
  if (typeof source === 'string') return { board: null, none: source };
  return { board: await source.board(), none: null };
}

/** A place's key: the values chosen, in the description's order, so going back to a choice finds its board. */
export const placeKey = (values: Values): string => JSON.stringify(values);

/**
 * The place a card's count is read for: the values so far with this one choice made, and every list that
 * depends on it cleared, as choosing it would clear them. '' is the whole project: nothing chosen.
 */
export function countValues(pickers: PickerSpec[], values: Values, key: string, value: string): Values {
  const p = pickers.find((x) => x.key === key);
  const out: Values = { ...values, [key]: value ? (p?.multi ? [value] : value) : null };
  const below = new Set([key]);
  for (const q of pickers) {
    if (!q.dependsOn.some((k) => below.has(k))) continue;
    below.add(q.key);
    out[q.key] = null;
  }
  return out;
}

/** How many cards a preview column shows before "and N more" (T-106). */
export const PREVIEW_CARDS = 3;

/** How many ticket titles a card for the place (an epic, labels, an area path, a group) shows under its count (T-106). */
export const CARD_TITLES = 2;

/** "47 tickets would be on your board, in 5 columns." */
export function previewLine(tickets: number, columns: number): string {
  return `${plural(tickets, 'ticket')} would be on your board, in ${plural(columns, 'column')}.`;
}
