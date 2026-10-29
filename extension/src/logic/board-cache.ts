/**
 * The boards a project drew last, kept in its repo's own state folder (`<git dir>/acc/boards.json`, never
 * committed), so a fresh window shows each tracker's board at once, marked as refreshing, and then refreshes
 * it (2026-10-21). Before this, a fresh window had no boards until every tracker answered, and the Tasks tab
 * showed the agent board, with GitHub's import, in their place. Plain logic, no vscode import, so it's testable.
 */
import { mkdirSync } from 'node:fs';
import { writeAtomic } from '../../../packages/core/src/atomic.ts';
import type { Tracker } from '../../../packages/core/src/config.ts';
import { boardCacheFile, type CachedBoard, readCachedBoards, trackerKey } from '../../../packages/core/src/saved-tickets.ts';
import type { Board } from '../../../packages/core/src/trackers/types.ts';

// The file and its key live in core (T-141), where acc reads the saved board for a session too.
export { boardCacheFile, type CachedBoard, trackerKey };

/** Each tracker's last board, by its place in the project's list, or null where none was kept for it as it is now. */
export function readBoardCache(paths: { stateDir: string }, trackers: readonly Tracker[]): (CachedBoard | null)[] {
  const all = readCachedBoards(paths);
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
