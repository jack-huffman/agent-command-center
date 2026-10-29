/**
 * My work's Done lane (T-147): the finished tasks that still have a worktree to clean up, and under a
 * closed "Cleaned up (n)" fold at its foot, the rest. Nothing finished is lost, and the lane stays short.
 * Plain data, no vscode import, so it's testable; the page draws the fold and moves a card into it as soon
 * as the extension says Clean up removed its worktree.
 */

/** A finished task stays in the Done lane while it has a worktree: Clean up is its next step. */
export const stillToTidy = (card: { worktree: string | null }): boolean => !!card.worktree;

/** Done's cards split: those still to tidy, in the lane, and those cleaned up, in the fold, each in the order given. */
export function splitDone<C extends { worktree: string | null }>(cards: C[]): { cards: C[]; cleaned: C[] } {
  return { cards: cards.filter(stillToTidy), cleaned: cards.filter((c) => !stillToTidy(c)) };
}
