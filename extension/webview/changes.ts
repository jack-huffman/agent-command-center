// A task's changes on its page (T-99), a section of their own: Planned changes before there's work, then
// Changes, with "Planned: 6 · Changed: 8" beside the heading. Each count is a button that shows its list;
// which one shows stays as the page redraws. A change outside the plan, and a planned one not made, carry
// their mark. Each group is a list of sets, by type or folder; record changes (T-100) are another group.

import type { ChangeGroup, TicketChanges } from '../src/model/changes.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { type Child, el, status, when, work } from './dom.ts';
import { memory, remember, state } from './state.ts';

/** One group: its title, then each type or folder with its count, and its items. */
function group(g: ChangeGroup): HTMLElement {
  const sets = g.sets.map((s) => {
    const items = s.items.map((i) => {
      const name = work(el('span', 'mono chg-name', i.name), 'files');
      name.title = i.paths.join('\n');
      return el('li', 'chg-item', name, i.look ? status(i.look) : null);
    });
    return el('div', 'chg-set', el('div', 'chg-head', work(el('strong', '', s.head), 'files'), el('span', 'count', String(s.items.length))), el('ul', 'chg-list', ...items));
  });
  const box = el('div', 'chg-group', el('h3', 'chg-title', g.title), ...sets);
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', g.title);
  return box;
}

/** A count that shows its list: pressed while it does. */
function countButton(label: string, pressed: boolean, show: () => void): HTMLButtonElement {
  const b = el('button', `btn ghost small chg-count${pressed ? ' on' : ''}`, label) as HTMLButtonElement;
  b.type = 'button';
  b.setAttribute('aria-pressed', String(pressed));
  b.addEventListener('click', show);
  return b;
}

/** The section: its heading, the counts once there's work, a note, and the list that shows. */
export function renderChanges(m: TicketModel, c: TicketChanges): HTMLElement {
  const key = `chg:${m.project}#${c.task}:plan`;
  // The plan shows by default only before there's work; after, a click away.
  const plan = !c.counts || (c.counts.planned !== null && memory().opened.includes(key));
  const show = (on: boolean) => () => {
    remember((x) => { x.opened = on ? [...new Set([...x.opened, key])] : x.opened.filter((y) => y !== key); });
    if (state.last) state.draw(state.last);
  };
  const counts: Child = c.counts ? el('span', 'chg-counts',
    c.counts.planned !== null ? countButton(`Planned: ${c.counts.planned}`, plan, show(true)) : null,
    c.counts.planned !== null ? el('span', 'muted', '·') : null,
    countButton(`Changed: ${c.counts.changed}`, !plan, show(false))) : null;
  const sec = el('section', 'block changes', el('div', 'chg-top', el('h2', '', c.title), counts));
  sec.setAttribute('aria-label', c.title);
  if (c.note) sec.append(el('p', 'muted chg-note', c.note));
  if (c.keptAt && !plan) sec.append(el('p', 'muted small chg-note', 'Kept with the task ', when(c.keptAt), ', so they stay after its branch is gone.'));
  // Its builder's own deploy to the org (D-206): "Deployed to Acme Dev", when, and what the tests found there.
  for (const d of c.deployed) sec.append(el('p', 'small chg-note chg-deploy', status(d.look), when(d.at), el('span', 'muted', d.words)));
  sec.append(...(plan ? c.planned : c.changed).map(group));
  return sec;
}
