/**
 * A project's several boards (T-127): which one each is, and the order they're read in. The board on show is
 * read first, and the rest behind it, READS_AT_ONCE at a time, so ten boards fill in without stalling the page
 * and no site is asked more than once a board per refresh. Plain logic, no vscode import, so it's testable.
 */
import { createHash } from 'node:crypto';
import type { Tracker } from '../../../packages/core/src/config.ts';
import { sameSource } from '../../../packages/core/src/config.ts';
import { outsideKeys } from './connect.ts';

/**
 * How many boards are read at once: a project's boards on the Tasks tab (T-127), the one on show and two more
 * behind it, and the Connect page's previews and counts (T-106), so a long list never floods a tracker.
 */
export const READS_AT_ONCE = 3;

/**
 * Each board's id in a project's list, which the Tasks tab remembers the board on show by: its settings but its
 * name, so a rename keeps the choice, and another place is another board. A short hash, the same in every window.
 * Two boards with the same settings (a hand-edited config, which parseConfig warns of) are still two: the later
 * one's id adds its place in the list, so the switch never matches both.
 */
export function boardIds(trackers: readonly Tracker[]): string[] {
  const ids: string[] = [];
  for (const [i, t] of trackers.entries()) {
    const id = createHash('sha256').update(JSON.stringify({ ...t, name: null })).digest('hex').slice(0, 12);
    ids.push(ids.includes(id) ? `${id}-${i}` : id);
  }
  return ids;
}

/**
 * Reads each of `count` boards once by its place in the list, READS_AT_ONCE at a time, the one on show first.
 * `shown` is asked each time a read finishes, so a board the person switches to while others are read goes next.
 * Resolves when every read has.
 */
export async function readInTurn(count: number, shown: () => number | null, read: (index: number) => Promise<void>, most = READS_AT_ONCE): Promise<void> {
  const waiting = Array.from({ length: count }, (_, i) => i);
  const next = (): number | undefined => {
    const want = shown();
    const at = want === null ? -1 : waiting.indexOf(want);
    return waiting.splice(at >= 0 ? at : 0, 1)[0];
  };
  const lane = async (): Promise<void> => {
    for (let i = next(); i !== undefined; i = next()) await read(i).catch(() => undefined);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(most, count)) }, lane));
}

/**
 * The boards that read one source as each board does (T-127), by index: two boards of one Jira project, say,
 * with other epics. A ticket one of them shows is one task, and only left the repo's place when it left every one.
 */
export function sourceGroups(trackers: readonly Tracker[]): number[][] {
  const groups: number[][] = [];
  trackers.forEach((t, i) => {
    const g = groups.find((x) => sameSource(trackers[x[0]!]!, t));
    if (g) g.push(i);
    else groups.push([i]);
  });
  return groups;
}

/**
 * The keys every board of one source says have left the repo's place (T-127): the first board's answer, narrowed by
 * each other's in turn. A ticket one of them still holds stays, and a read that fails says none have left (D-048).
 */
export async function outsideEvery<T extends { key: string }>(keys: string[], reads: readonly ((keys: string[]) => Promise<T[]>)[]): Promise<T[]> {
  let outside: T[] = keys.length && reads.length ? await outsideKeys(keys, reads[0]!) : [];
  for (const read of reads.slice(1)) {
    if (!outside.length) break;
    const too = new Set((await outsideKeys(outside.map((o) => o.key), read)).map((o) => o.key.toUpperCase()));
    outside = outside.filter((o) => too.has(o.key.toUpperCase()));
  }
  return outside;
}
