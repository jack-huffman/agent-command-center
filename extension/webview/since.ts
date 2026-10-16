// Since you last looked (D-164): what changed while the person was away from the window, as a group on the
// Overview between Needs you and the cards. A calm line for each notice, which opens its task, then Clear.

import type { SinceGroup } from '../src/model/since.ts';
import { el, icon } from './dom.ts';
import { landingRows } from './landing.ts';
import { api } from './state.ts';

/**
 * The group, headed with its count. Its heading is where the welcome back's Show opens the Overview. Clear
 * takes the group off at once, and asks the extension to forget the list, so the next model has none.
 */
export function sinceSection(g: SinceGroup): HTMLElement {
  const box = el('section', 'lp-group lp-since');
  box.dataset.overviewGroup = g.key;
  box.setAttribute('aria-label', g.title);
  const h = el('h2', '', icon(g.icon, g.tone), g.title, el('span', 'count', String(g.count)));
  h.tabIndex = -1;
  h.dataset.part = g.part;
  const clear = el('button', 'btn ghost small lp-more', icon(g.clear.icon), g.clear.label) as HTMLButtonElement;
  clear.type = 'button';
  clear.title = g.clear.tip;
  clear.addEventListener('click', () => {
    // Focus would go with the group: it goes to the page, as after any section's redraw.
    document.querySelector<HTMLElement>('.home-main')?.focus({ preventScroll: true });
    box.remove();
    api.postMessage({ type: 'toolbar', command: g.clear.command });
  });
  box.append(h, landingRows(g.rows, g.title, true), clear);
  return box;
}
