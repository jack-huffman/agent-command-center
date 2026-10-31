// In review's Check together (T-165): a button for each environment, off with why when it can't start, and
// the group check's step while one runs.

import type { Together } from '../src/model/group-check.ts';
import type { Look } from '../src/model/shared.ts';
import { actionButton, el, status } from './dom.ts';

/** Check together and the group's step, under In review's heading. */
export function togetherBar(t: Together): HTMLElement {
  const bar = el('div', 'column-together', actionButton(t.action), t.progress ? el('div', 'together-step', status(t.progress)) : null);
  bar.dataset.env = t.env;
  return bar;
}

/** A task's group checks on its page (T-165): every step under Details, newest first. */
export function groupRows(groups: Look[]): HTMLElement | null {
  return groups.length ? el('div', 'group-rows', el('h3', '', 'Checked together'), ...groups.map((g) => el('div', 'group-row', status(g)))) : null;
}
