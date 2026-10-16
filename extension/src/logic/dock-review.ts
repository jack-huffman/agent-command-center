// A review run's verdict, read when the run ends (T-63): the task's newest verdict file in the repo's reviews
// folder, and the lines of the change around each finding, as the task page reads them (T-53). No vscode
// import, so it's testable against a real folder.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { verdictFrom, type VerdictRead } from '../model/dock-review.ts';
import { type Git, mergeBase, reviewExcerpts } from './review-excerpts.ts';

/** A task's verdict file, as core's reviewPath names it: the task, a dash and the commit. */
const verdictFile = (task: string, name: string): boolean => name.startsWith(`${task}-`) && /^[0-9a-f]{7,64}\.json$/.test(name.slice(task.length + 1));

/**
 * The text of the task's newest verdict file, by when it was written, or null with none: no folder, no file,
 * or none that can be read. A review under way (`<task>.running.json`) is no verdict.
 */
export function newestVerdictText(reviews: string, task: string): string | null {
  let names: string[];
  try {
    names = readdirSync(reviews).filter((n) => verdictFile(task, n));
  } catch {
    return null;
  }
  const dated = names.flatMap((n) => {
    try {
      return [{ n, at: statSync(join(reviews, n)).mtimeMs }];
    } catch {
      return [];
    }
  }).sort((a, b) => b.at - a.at || b.n.localeCompare(a.n));
  for (const { n } of dated) {
    try {
      return readFileSync(join(reviews, n), 'utf8');
    } catch {
      // gone since it was listed: the next newest
    }
  }
  return null;
}

/** What reading a review run's verdict needs: where the verdicts are, the run, and the task's checkout and base branch for its findings' lines. */
export interface ReviewReadIn {
  reviews: string;
  task: string;
  startedAt: number;
  /** The task's checkout, or null when it has none; a checkout gone from disk reads as none. */
  checkout: string | null;
  there: boolean;
  /** The branch its findings' lines are compared with: the task's environment's. */
  branch: string;
  git: Git;
}

/**
 * The verdict a review run wrote, with the lines around each finding, or why there is none: the run wrote no
 * verdict, or its file isn't one. A checkout that is gone gives the verdict with no lines.
 */
export async function readReviewRun(o: ReviewReadIn): Promise<VerdictRead> {
  const got = verdictFrom(newestVerdictText(o.reviews, o.task), o.startedAt);
  if ('why' in got) return { ok: false, why: got.why };
  const v = got.verdict;
  if (!o.checkout || !o.there) return { ok: true, verdict: v, checkout: false, excerpts: [] };
  const base = await mergeBase(o.git, o.checkout, o.branch, v.sha);
  return { ok: true, verdict: v, checkout: true, excerpts: await reviewExcerpts(o.git, o.checkout, base, v.sha, v.findings) };
}
