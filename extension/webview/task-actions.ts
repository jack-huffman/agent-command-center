// A task's actions, on its page and on its card (D-168): one size and one place. The next step is a
// full-width button on a row of its own; the rest sit under it in a grid of equal columns, each as high as
// the next. Each shows its icon and its label, cut with an ellipsis where it's too long, whole in its title.
// One that can't run now stays in its place, disabled, with its reason in its title. The order is the
// model's (actionOrder): the next step, then Move, then Block, then the rest.

import type { Action } from '../src/model/shared.ts';
import { el, icon } from './dom.ts';
import { explains } from './plain-words.ts';
import { dress, press, refusal } from './working.ts';

/**
 * One action as a button of the shared size. A click runs its command on its ref, or does what `onClick`
 * says, as a card's Answer does; it doesn't reach the card under it.
 */
export function actionTile(a: Action, primary: boolean, onClick?: () => void): HTMLButtonElement {
  const label = el('span', 'ta-label', a.label);
  const b = el('button', `btn ta-btn${primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`, icon(a.icon), label) as HTMLButtonElement;
  b.type = 'button';
  b.title = a.disabled ? `${a.label}: ${a.disabled}` : explains(a.command, a.label);
  if (a.disabled) {
    b.disabled = true;
    b.setAttribute('aria-description', a.disabled);
  }
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onClick) onClick();
    else if (!b.disabled) press(a);
  });
  // One the extension is still answering shows it's working (T-147).
  return onClick ? b : dress(b, a, label);
}

/**
 * A task's actions: its next step, when the first is one, full width; the rest in the grid. Null when
 * there are none. The screenshot run's geometry check measures each set it marks (data-action-set).
 */
export function taskActions(actions: Action[]): HTMLElement | null {
  if (!actions.length) return null;
  const next = actions[0]!.primary ? actions[0]! : null;
  const rest = next ? actions.slice(1) : actions;
  // Under them, why the last one the extension refused didn't go (T-147), until it's tried again.
  const set = el('div', 'task-actions', next ? actionTile(next, true) : null, rest.length ? el('div', 'ta-grid', ...rest.map((a) => actionTile(a, false))) : null, refusal(actions));
  set.dataset.actionSet = 'task';
  return set;
}
