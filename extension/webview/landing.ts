// The Overview's lines (GH-160): each one line high, a raised card of its own, with its state, its task's
// key and title, two short facts at most and one button, the rest in its ⋯ menu. A click opens its detail.

import type { Detail, LandingGroup, LandingRow, RowButton, RowDo } from '../src/model/landing.ts';
import { type Child, el, icon, menuButton, peekKey, withMenu } from './dom.ts';
import { closeDetail, openDetail } from './detail.ts';
import { api, go } from './state.ts';

/** What a line's button, its click or Show all does. A task or a section opens in place of any detail open. */
export function runDo(d: RowDo): void {
  switch (d.kind) {
    case 'run': return api.postMessage({ type: 'run', command: d.command, ref: d.ref });
    case 'toolbar': return api.postMessage({ type: 'toolbar', command: d.command, arg: d.arg });
    case 'link': return api.postMessage({ type: 'open', url: d.url });
    case 'detail': return openDetail(d.detail);
    case 'go':
      closeDetail();
      return go(d.section);
    case 'task':
      closeDetail();
      return api.postMessage({ type: 'task-modal-open', project: d.project, key: d.key });
  }
}

/** What marks the line or button that opened a detail, so focus goes back to it when the detail closes. */
export const opensKey = (d: Detail): string => JSON.stringify({ ...d, at: undefined, item: undefined });

/** A line's button: its words cut short where there's no room, all of them on hover and read out. */
function rowButton(b: RowButton): HTMLElement {
  const btn = el('button', `btn lp-btn${b.primary ? ' primary' : ''}`, icon(b.icon), el('span', 'lp-btn-text', b.label)) as HTMLButtonElement;
  btn.type = 'button';
  btn.title = b.tip ?? b.label;
  btn.setAttribute('aria-label', b.label);
  if (b.do.kind === 'detail') btn.dataset.opens = opensKey(b.do.detail);
  btn.addEventListener('click', (e) => { e.stopPropagation(); runDo(b.do); });
  return btn;
}

/** One of the Overview's lines. All it says is on hover; Enter or a click opens it, where it opens anything. */
export function landingRow(r: LandingRow): HTMLElement {
  const state = el('span', `status tone-${r.look.tone} lp-state`, icon(r.look.icon, r.look.tone), el('span', 'lp-state-text', r.look.label));
  state.title = r.look.label;
  const facts: Child[] = r.facts.map((f) => Object.assign(el('span', 'lp-fact', f.text), { title: f.text }));
  const caret = r.menu ? menuButton(r.id ? `${r.id} ${r.title}` : r.title) : null;
  const row = el('li', `lp-row tone-row-${r.look.tone}`, state, r.id ? el('span', 'tcard-key lp-key', r.id) : null, el('span', 'lp-title', r.title), ...facts,
    el('span', 'lp-do', r.action ? rowButton(r.action) : null, caret));
  row.dataset.overviewRow = '';
  row.title = r.tip?.includes(r.title) ? r.tip : [r.id ? `${r.id} ${r.title}` : r.title, r.tip].filter(Boolean).join('\n');
  if (r.menu) withMenu(row, r.menu.section, r.menu.ref, r.menu.flags);
  if (r.fading !== undefined) {
    row.classList.add('lp-fading');
    row.style.animationDelay = `-${r.fading}s`;
  }
  const open = r.open;
  if (open) {
    row.classList.add('openable');
    row.tabIndex = 0;
    row.setAttribute('role', 'link');
    row.setAttribute('aria-label', `${r.look.label}: ${r.id ? `${r.id} ` : ''}${r.title}`);
    // Focus comes back here when what it opened closes: the task modal finds it by data-peek.
    if (open.kind === 'task') row.dataset.peek = peekKey(open.project, open.key);
    if (open.kind === 'detail') row.dataset.opens = opensKey(open.detail);
    const go = (e: Event) => {
      if ((e.target as HTMLElement).closest('button, a.ext')) return;
      e.preventDefault();
      runDo(open);
    };
    row.addEventListener('click', go);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) go(e); });
  }
  return row;
}

/** A list of lines, as the page or a detail shows it. */
export function landingRows(rows: LandingRow[], label: string): HTMLElement {
  const list = el('ol', 'lp-rows', ...rows.map(landingRow));
  list.setAttribute('aria-label', label);
  return list;
}

/** Show all N: the list in the modal, or the section's own page. */
export function showAll(g: LandingGroup): HTMLElement | null {
  const more = g.more;
  if (!more) return null;
  const b = el('button', 'btn ghost small lp-more', icon(more.do.kind === 'go' ? 'arrow-right' : 'list-flat'), more.label) as HTMLButtonElement;
  b.type = 'button';
  b.title = more.do.kind === 'go' ? `${more.label}, on its own page` : `${more.label}, over the page`;
  if (more.do.kind === 'detail') b.dataset.opens = opensKey(more.do.detail);
  b.addEventListener('click', () => runDo(more.do));
  return b;
}

/**
 * One of the Overview's lists: its heading with its count, its first five lines, and Show all. `head`
 * takes the heading's place, as In progress's fold does; `top` goes under it, as its machine line does.
 */
export function landingGroup(g: LandingGroup, head?: HTMLElement, top?: Child): HTMLElement {
  const h = head ?? el('h2', '', icon(g.icon, g.tone), g.title, g.count ? el('span', 'count', String(g.count)) : null);
  const box = el('section', `lp-group lp-${g.key}`, h, top ?? null);
  box.dataset.overviewGroup = g.key;
  box.setAttribute('aria-label', g.title);
  if (!g.rows.length) {
    if (g.empty) box.append(el('p', 'muted quiet', g.empty));
    return box;
  }
  box.append(landingRows(g.rows, g.title));
  const more = showAll(g);
  if (more) box.append(more);
  return box;
}
