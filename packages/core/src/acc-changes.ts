/**
 * What a pull request changes under `.acc/` that a person merges (GH-67), as autopilot and its merge read
 * it. acc's own config is a person's to change, but a floors file whose every floor only rose is the
 * ratchets' and the screenshot run's own doing (T-102), which most UI changes now carry: that one goes through.
 */
import type { Runner } from './exec.ts';
import { FLOORS_FILE, type Floors, floorsAt, isWorse, limitOf } from './ratchets.ts';

/**
 * Whether `head`'s floors only raise `base`'s: each floor kept, of its kind, at the same number or a better
 * one, with no person's relax on it that `base` didn't have. A new floor raises one from nothing.
 */
export function floorsOnlyRise(base: Floors, head: Floors): boolean {
  const kept = Object.entries(base).every(([name, was]) => {
    const now = head[name];
    const limit = limitOf(was);
    return !!now && limitOf(now) === limit && !isWorse(limit, now[limit]!, was[limit]!);
  });
  return kept && Object.entries(head).every(([name, e]) => !e.relaxed || JSON.stringify(e.relaxed) === JSON.stringify(base[name]?.relaxed));
}

/**
 * The paths under `.acc/` that `head` changes since it left `base`, for a person to merge: every one but a
 * floors file that only raises floors. Null when git can't list them. A floors file that can't be read on
 * either side is a person's too.
 */
export function accChangesFor(run: Runner, root: string, base: string, head: string): string[] | null {
  const r = run('git', ['diff', '--name-only', '--no-renames', `${base}...${head}`, '--', '.acc'], { cwd: root });
  if (r.code !== 0) return null;
  const changed = r.stdout.split('\n').filter(Boolean);
  if (!changed.includes(FLOORS_FILE)) return changed;
  const from = run('git', ['merge-base', base, head], { cwd: root }).stdout.trim();
  let rises = false;
  try {
    rises = !!from && floorsOnlyRise(floorsAt(run, root, from), floorsAt(run, root, head));
  } catch {
    rises = false;
  }
  return rises ? changed.filter((f) => f !== FLOORS_FILE) : changed;
}
