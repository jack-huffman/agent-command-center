// My work's Done lane (T-147): the finished tasks with a worktree still to clean up, then a closed
// "Cleaned up (n)" fold at the lane's foot holding the rest. A task Clean up just removed moves into the
// fold as soon as the extension says so, before a model without its worktree arrives.

import type { Card, Column } from '../src/model/tasks.ts';
import { el, rememberedFold } from './dom.ts';
import { cleanedKey } from './working.ts';

/** The fold's words, with its count: "Cleaned up (3)". */
export const cleanedLabel = (n: number): string => `Cleaned up (${n})`;

/** Where the tab remembers the fold opened, for one project's board. Closed until a person opens it. */
export const doneFoldKey = (root: string): string => `done-fold:${root}`;

/**
 * Done's cards as the page draws them: a card in `gone`, whose worktree Clean up removed by the extension's
 * answer, moves from the lane into the fold, first. Once the model holds it in the fold itself, it's dropped
 * from `gone`: the model has caught up.
 */
export function withCleaned(c: Pick<Column, 'cards' | 'cleaned'>, root: string, gone: Set<string>): { cards: Card[]; cleaned: Card[] } {
  for (const x of c.cleaned ?? []) gone.delete(cleanedKey(root, x.id));
  const moved = c.cards.filter((x) => gone.has(cleanedKey(root, x.id)));
  return { cards: c.cards.filter((x) => !moved.includes(x)), cleaned: [...moved, ...(c.cleaned ?? [])] };
}

/** The fold at the foot of Done, closed until opened, holding the cleaned-up cards; none when there are none. */
export function cleanedFold(root: string, cards: HTMLElement[]): HTMLElement | null {
  if (!cards.length) return null;
  const d = rememberedFold('done-fold', doneFoldKey(root), [el('span', 'done-fold-label', cleanedLabel(cards.length))], el('div', 'done-fold-cards', ...cards));
  d.querySelector('summary')!.title = 'The finished tasks whose worktrees are cleaned up: nothing left to tidy.';
  return d;
}
