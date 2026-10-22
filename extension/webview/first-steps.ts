/**
 * First steps, said once (T-96): the first time a person opens the Tasks tab with a tracker connected, one
 * line says how the Command Center works, in five steps. Got it hides it, and the page's memory keeps it
 * hidden across redraws and the tab being hidden.
 */
import { button, el, icon } from './dom.ts';
import { FIRST_STEPS } from './plain-words.ts';
import { memory, remember, state } from './state.ts';

/** The line, while it hasn't been dismissed; null once it has. */
export function firstSteps(): HTMLElement | null {
  if (memory().firstStepsSeen) return null;
  const steps = el('ol', 'first-steps-list', ...FIRST_STEPS.map((s, i) => el('li', '', el('span', 'muted', `${i + 1}.`), icon(s.icon, 'blue'), el('span', '', s.step))));
  steps.setAttribute('aria-label', 'How the Command Center works');
  const done = button('Got it', 'check', () => {
    remember((m) => { m.firstStepsSeen = true; });
    if (state.last) state.draw(state.last);
  }, 'ghost small');
  done.title = 'Hide these steps';
  return el('div', 'notice info first-steps', icon('info', 'blue'),
    el('div', 'first-steps-text', el('strong', '', 'How it works:'), steps),
    done);
}
