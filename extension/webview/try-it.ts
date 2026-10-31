// Try it in the org (T-161): once a builder's deploy to the ticket's development org passed, Open <environment>
// opens that org, How to test it says what to do there in its builder's own words, and each component it deployed
// opens at its own page. Drawn on the development environment's row of the Changes tab, and, without the
// components, in the Agent panel once the build is done. Off, Open says why beside it and in its title.

import type { TicketModel } from '../src/model/task-page.ts';
import type { TryComponent, TryIt } from '../src/model/try-it.ts';
import { api } from './state.ts';
import { button, el, icon, md, work } from './dom.ts';

/** Open <environment>: it opens the org's home; off, it says why in its title and to a screen reader. */
function openButton(m: Pick<TicketModel, 'project'>, t: TryIt): HTMLButtonElement {
  const b = button(t.open.label, 'globe', () => { if (!b.disabled) api.postMessage({ type: 'org-open', project: m.project, task: t.task }); }, 'try-open');
  if (t.open.disabled) {
    b.disabled = true;
    b.title = `${t.open.label}: ${t.open.disabled}`;
    b.setAttribute('aria-description', t.open.disabled);
  } else b.title = `${t.open.label}: open ${t.org} in your browser`;
  return b;
}

/** How to test it, in its builder's own words: a numbered list, or a line that says it gave none. */
function howTo(t: TryIt): HTMLElement {
  const box = el('div', 'try-how', el('h4', 'try-sub', 'How to test it'));
  if (t.howTo.length) box.append(el('ol', 'try-steps', ...t.howTo.map((l) => el('li', '', work(el('span', '', md(l)), 'transcript')))));
  else box.append(el('p', 'muted small try-none', 'Its builder gave no steps. Check its note.'));
  return box;
}

/** One component: its type and name, and an Open that goes to its own page in the org, saying where in its title. */
function componentRow(m: Pick<TicketModel, 'project'>, t: TryIt, c: TryComponent): HTMLElement {
  const go = button('Open', 'link-external', () => { if (!go.disabled) api.postMessage({ type: 'org-open', project: m.project, task: t.task, path: c.path }); }, 'ghost small try-comp-open');
  go.setAttribute('aria-label', `Open ${c.name} in ${c.where}`);
  if (t.open.disabled) {
    go.disabled = true;
    go.title = `Open ${c.name}: ${t.open.disabled}`;
  } else go.title = `Open ${c.name} in ${c.where}`;
  return el('li', 'try-comp', el('span', 'muted small try-type', c.label), work(el('span', 'mono try-name', c.name), 'files'), go);
}

/** The whole of it, on the development environment's row: Open, why it's off, how to test it, then each component. */
export function renderTryIt(m: Pick<TicketModel, 'project'>, t: TryIt, components = true): HTMLElement {
  const box = el('div', 'try', el('div', 'actions try-actions', openButton(m, t)));
  box.setAttribute('aria-label', `Try it in ${t.name}`);
  if (t.open.disabled) box.append(el('p', 'muted small try-why', icon('info'), el('span', '', t.open.disabled)));
  box.append(howTo(t));
  if (components && t.components.length) {
    const list = el('ul', 'try-comps', ...t.components.map((c) => componentRow(m, t, c)));
    list.setAttribute('aria-label', 'Open each component');
    box.append(el('h4', 'try-sub', 'Open each component'), list);
  }
  return box;
}
