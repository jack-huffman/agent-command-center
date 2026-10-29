/**
 * Whether each finished task's work is in its environment's branch, for the tidy-up offer's count (GH-104),
 * asked of git in the background (T-147). The Overview's tidy-up line used to ask git once a task, one
 * process after another, on the first draw after each read of the ledger: on a repo of 227 finished tasks
 * that held the extension for 6 to 11 seconds, and a click on a card waited behind it. Now a draw reads
 * only what git has answered; the rest are asked one at a time without holding anything up, and the page
 * draws again once they're in. Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */

import type { Task } from '../../../packages/core/src/ledger.ts';
import { type InEnvironment, inEnvironmentAsks, inEnvironmentKey as keyOf } from '../../../packages/core/src/tidy.ts';

/** Runs git with these arguments in a folder, without holding up the extension: its exit code is the answer. */
export type AskGit = (args: string[], cwd: string) => Promise<{ code: number }>;


/** One repo's answers, and the asks still to make. */
export class InEnvironmentAsks {
  private readonly known = new Map<string, boolean>();
  private readonly waiting = new Map<string, Pick<Task, 'id' | 'environment' | 'run'>>();
  private draining: Promise<void> | null = null;
  private readonly root: string;
  private readonly reviews: string;
  private readonly ask: AskGit;
  private readonly answered: () => void;

  /**
   * `answered` runs once a round of asks has found something new, so the page draws again. `reviews` is the
   * repo's reviews folder: a commit a review read counts once its branch has gone (branchInEnvironment).
   */
  constructor(root: string, reviews: string, ask: AskGit, answered: () => void) {
    this.root = root;
    this.reviews = reviews;
    this.ask = ask;
    this.answered = answered;
  }

  /**
   * What git has said so far, as tidyDue reads it. A task git hasn't answered for counts as not in its
   * environment for now, and is asked about in the background.
   */
  read(): InEnvironment {
    return (t) => {
      const k = keyOf(t);
      const v = this.known.get(k);
      if (v === undefined && !this.waiting.has(k)) {
        this.waiting.set(k, t);
        this.draining ??= this.drain();
      }
      return v ?? false;
    };
  }

  /**
   * The ledger was read again: a task that wasn't in its environment may be now, so it's asked again. One
   * that was stays so: merged work doesn't leave its environment's branch.
   */
  forgetNos(): void {
    for (const [k, v] of this.known) if (!v) this.known.delete(k);
  }

  /** Settles once every ask made so far has an answer: for tests, and for what waits on the count. */
  async settled(): Promise<void> {
    while (this.draining) await this.draining;
  }

  /** Asks git about each task waiting, one process at a time, so the machine isn't flooded. */
  private async drain(): Promise<void> {
    let found = false;
    try {
      // Never inside the draw that asked: it carries on once the draw is done.
      await Promise.resolve();
      for (let next = this.waiting.entries().next(); !next.done; next = this.waiting.entries().next()) {
        const [k, t] = next.value;
        let yes = false;
        for (const [tip, ref] of inEnvironmentAsks(t, this.reviews)) {
          if ((await this.ask(['merge-base', '--is-ancestor', tip, ref], this.root).catch(() => ({ code: 1 }))).code === 0) { yes = true; break; }
        }
        this.waiting.delete(k);
        this.known.set(k, yes);
        found = true;
      }
    } finally {
      this.draining = null;
    }
    if (found) this.answered();
  }
}
