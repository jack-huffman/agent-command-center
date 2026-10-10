// In progress on the Overview: the machine's line, then a line per task with something under way.

import type { LandingGroup } from '../src/model/landing.ts';
import type { ProgressModel } from '../src/progress.ts';
import { el, icon, status } from './dom.ts';
import { landingGroup } from './landing.ts';
import { memory, remember, state } from './state.ts';

export { answerHere } from './detail.ts';

/**
 * In progress (D-092): the machine's line on top (heavy-check slots, builders, load), then a line per
 * task, busiest first, five at most (GH-160). A line says what its first job is doing, for how long, and
 * its checks as one fact; its page opens on a click, and Watch, Open in Claude Code and Stop are in its
 * ⋯ menu. Its heading folds it to the heading, remembered for the tab. A job that ended stays a minute as
 * a line that fades; the fade starts as far in as the job is old, by the extension's clock, so a redraw
 * never restarts it.
 */
export function renderInProgress(g: LandingGroup, p: ProgressModel): HTMLElement {
  const open = memory().sections?.['in-progress'] ?? true;
  const toggle = el('button', 'progress-toggle', el('span', 'tool-chev', icon('chevron-right')), icon('pulse', p.count ? 'blue' : undefined), 'In progress', p.count ? el('span', 'count', String(p.count)) : null) as HTMLButtonElement;
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.title = open ? 'Fold In progress to its heading' : 'Show what\'s in progress';
  toggle.addEventListener('click', () => {
    remember((m) => { m.sections = { ...(m.sections ?? {}), 'in-progress': !open }; });
    if (state.last) state.draw(state.last);
  });
  const head = el('h2', '', toggle);
  if (!open) {
    const folded = el('section', 'lp-group lp-progress folded', head);
    folded.setAttribute('aria-label', 'In progress');
    return folded;
  }
  const machine = p.machine.length ? el('div', 'machine-line', ...p.machine.map((c) => Object.assign(status(c.look), { title: c.tip }))) : null;
  return landingGroup(g, head, machine);
}
