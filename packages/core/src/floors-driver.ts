/**
 * The floors file's git merge driver (T-102). Two branches that both raised a floor change the same line of
 * `.acc/floors.json`, so git alone stops on it. With `.gitattributes` naming the driver and the repo's git
 * config holding its command, git runs `acc floors merge %O %A %B`, which keeps the better of each floor, as
 * acc's own merge does (GH-99). What mergeFloors leaves to a person, such as a floor one side relaxed, stays
 * a conflict with git's usual markers. A clone without the driver conflicts as before: git never picks a side.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from './atomic.ts';
import type { Runner } from './exec.ts';
import { FLOORS_FILE, mergeFloors } from './ratchets.ts';

/** The driver's name, in `.gitattributes` and in git's config. */
export const FLOORS_DRIVER = 'acc-floors';
/** The line `.gitattributes` holds for it. */
export const FLOORS_ATTRIBUTE = `${FLOORS_FILE} merge=${FLOORS_DRIVER}`;
/** The command git runs: the common ancestor, ours (written in place) and theirs. */
export const FLOORS_DRIVER_COMMAND = 'acc floors merge %O %A %B';

/**
 * Merges the three versions git hands the driver, writing the result over `ours`. True when every floor
 * merged; false when a person decides, with `ours` holding git's conflict markers.
 */
export function mergeFloorsFiles(run: Runner, common: string, ours: string, theirs: string): boolean {
  // A version git didn't hand over, or one that can't be read, such as a folder, is empty: it merges nothing.
  const read = (f: string) => {
    try {
      return readFileSync(f, 'utf8');
    } catch {
      return '';
    }
  };
  const merged = mergeFloors(read(common), read(ours), read(theirs));
  if (merged !== null) {
    writeAtomic(ours, merged);
    return true;
  }
  // Left to a person: the usual markers, so the conflict reads as any other.
  run('git', ['merge-file', '-L', 'ours', '-L', 'base', '-L', 'theirs', ours, common, theirs]);
  return false;
}

/** Whether a repo's git config and `.gitattributes` have the driver: each is needed for git to run it. */
export function floorsDriverState(run: Runner, root: string): { configured: boolean; attributed: boolean } {
  const driver = run('git', ['config', '--get', `merge.${FLOORS_DRIVER}.driver`], { cwd: root }).stdout.trim();
  const file = join(root, '.gitattributes');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').map((l) => l.trim()) : [];
  return { configured: driver === FLOORS_DRIVER_COMMAND, attributed: lines.includes(FLOORS_ATTRIBUTE) };
}

/** The shell command that sets the driver up in a repo: its git config, and the `.gitattributes` line when it's missing. */
export function floorsDriverFix(state: { configured: boolean; attributed: boolean }): string {
  return [
    ...(state.configured ? [] : [`git config merge.${FLOORS_DRIVER}.name 'Keep the better of each floor'`, `git config merge.${FLOORS_DRIVER}.driver '${FLOORS_DRIVER_COMMAND}'`]),
    ...(state.attributed ? [] : [`printf '${FLOORS_ATTRIBUTE}\\n' >> .gitattributes`]),
  ].join(' && ');
}
