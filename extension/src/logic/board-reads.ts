/**
 * A project's several boards (T-127): which one each is, and the order they're read in. The board on show is
 * read first, and the rest behind it, BOARD_READS at a time, so ten boards fill in without stalling the page
 * and no site is asked more than once a board per refresh. Plain logic, no vscode import, so it's testable.
 */
import { createHash } from 'node:crypto';
import type { Tracker } from '../../../packages/core/src/config.ts';
import { sameSource } from '../../../packages/core/src/config.ts';

/** How many of a project's boards are read at once (T-127): the one on show, and two more behind it. */
export const BOARD_READS = 3;

/**
 * A board's id, which the Tasks tab remembers the board on show by: its settings but its name, so a rename keeps
 * the choice, and another place is another board. A short hash, the same in every window.
 */
export const boardId = (t: Tracker): string => createHash('sha256').update(JSON.stringify({ ...t, name: null })).digest('hex').slice(0, 12);

/**
 * Reads each board once, BOARD_READS at a time, the one on show first. `shown` is asked each time a read
 * finishes, so a board the person switches to while others are read goes next. Resolves when every read has.
 */
export async function readInTurn(ids: readonly string[], shown: () => string | null, read: (id: string) => Promise<void>, most = BOARD_READS): Promise<void> {
  const waiting = [...ids];
  const next = (): string | undefined => {
    const want = shown();
    const at = want ? waiting.indexOf(want) : -1;
    return waiting.splice(at >= 0 ? at : 0, 1)[0];
  };
  const lane = async (): Promise<void> => {
    for (let id = next(); id !== undefined; id = next()) await read(id).catch(() => undefined);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(most, ids.length)) }, lane));
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
