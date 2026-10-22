/**
 * The boards a project drew last, kept in its repo's own state folder (`<git dir>/acc/boards.json`, never
 * committed), so a fresh window shows each tracker's board at once, marked as refreshing, and then refreshes
 * it (2026-10-21). Before this, a fresh window had no boards until every tracker answered, and the Tasks tab
 * showed the agent board, with GitHub's import, in their place. Plain logic, no vscode import, so it's testable.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from '../../../packages/core/src/atomic.ts';
import type { Tracker } from '../../../packages/core/src/config.ts';
import type { Board } from '../../../packages/core/src/trackers/types.ts';

/** One tracker's last board, with who Mine meant, and when it loaded. */
export interface CachedBoard {
  /** The tracker's settings as written, so a tracker that changed never shows another place's cards. */
  tracker: string;
  board: Board;
  me: { id: string; name: string } | null;
  at: string;
}

export const boardCacheFile = (paths: { stateDir: string }): string => join(paths.stateDir, 'boards.json');

/** A tracker's key in the cache: its settings as written. They hold no sign-in: those are kept in the editor's secrets. */
export const trackerKey = (t: Tracker): string => JSON.stringify(t);

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

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
function readAll(paths: { stateDir: string }): CachedBoard[] {
  try {
    const r = JSON.parse(readFileSync(boardCacheFile(paths), 'utf8')) as unknown;
    return isObj(r) && Array.isArray(r.boards) ? r.boards.filter(isCached) : [];
  } catch {
    return [];
  }
}

/** Each tracker's last board, by its place in the project's list, or null where none was kept for it as it is now. */
export function readBoardCache(paths: { stateDir: string }, trackers: readonly Tracker[]): (CachedBoard | null)[] {
  const all = readAll(paths);
  return trackers.map((t) => all.find((c) => c.tracker === trackerKey(t)) ?? null);
}

/**
 * Keeps the boards that loaded now, in place of their last ones, written whole. A tracker whose board didn't
 * load keeps its last one; a tracker the project no longer names leaves the file.
 */
export function writeBoardCache(paths: { stateDir: string }, trackers: readonly Tracker[], loaded: readonly ({ board: Board; me: CachedBoard['me'] } | null)[], now: Date): void {
  const last = readBoardCache(paths, trackers);
  const boards = trackers.flatMap((t, i): CachedBoard[] => {
    const l = loaded[i];
    if (l) return [{ tracker: trackerKey(t), board: l.board, me: l.me, at: now.toISOString() }];
    return last[i] ? [last[i]!] : [];
  });
  mkdirSync(paths.stateDir, { recursive: true });
  writeAtomic(boardCacheFile(paths), `${JSON.stringify({ v: 1, boards })}\n`);
}
