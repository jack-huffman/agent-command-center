// The Overview's lines (GH-160): each one line high, a raised card of its own, with its state, its task's
// key and title, two short facts at most and one button, the rest in its ⋯ menu. A click opens its detail.
// On the Overview itself a line drops its facts, and each list but Needs you is a quiet card (T-36).

import type { Detail, LandingGroup, LandingRow, OverviewCard, RowButton, RowDo } from '../src/model/landing.ts';
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

/** A line's button: its words cut short where there's no room, or its icon alone on a line under 600 px; all its words on hover and read out. */
function rowButton(b: RowButton): HTMLElement {
  const btn = el('button', `btn lp-btn${b.primary ? ' primary' : ''}`, icon(b.icon), el('span', 'lp-btn-text', b.label)) as HTMLButtonElement;
  btn.type = 'button';
  btn.title = b.tip ?? b.label;
  btn.setAttribute('aria-label', b.label);
  if (b.do.kind === 'detail') btn.dataset.opens = opensKey(b.do.detail);
  btn.addEventListener('click', (e) => { e.stopPropagation(); runDo(b.do); });
  return btn;
}

/**
 * One of the Overview's lines. All it says is on hover; Enter or a click opens it, where it opens anything.
 * Calm, as on the Overview itself (T-36), it keeps its state, its task, its title and its button: its facts
 * are in its title.
 */
export function landingRow(r: LandingRow, calm = false): HTMLElement {
  const state = el('span', `status tone-${r.look.tone} lp-state`, icon(r.look.icon, r.look.tone), el('span', 'lp-state-text', r.look.label));
  state.title = r.look.label;
  const facts: Child[] = calm ? [] : r.facts.map((f) => Object.assign(el('span', 'lp-fact', f.text), { title: f.text }));
  const caret = r.menu ? menuButton(r.id ? `${r.id} ${r.title}` : r.title) : null;
  const title = el('span', 'lp-title', r.title);
  const row = el('li', `lp-row tone-row-${r.look.tone}`, state, r.id ? el('span', 'tcard-key lp-key', r.id) : null, title, ...facts,
    el('span', 'lp-do', r.action ? rowButton(r.action) : null, caret));
  row.dataset.overviewRow = '';
  row.title = [r.tip?.includes(r.title) ? r.tip : [r.id ? `${r.id} ${r.title}` : r.title, r.tip].filter(Boolean).join('\n'), ...(calm ? r.facts.map((f) => f.text) : [])].join('\n');
  if (r.menu) withMenu(row, r.menu.section, r.menu.ref, r.menu.flags);
  if (r.fading !== undefined) {
    row.classList.add('lp-fading');
    row.style.animationDelay = `-${r.fading}s`;
  }
  const open = r.open;
  if (open) {
    // The line stays a list item (T-59): its title is the link in it, which takes focus, and a click anywhere
    // on the line opens it too.
    row.classList.add('openable');
    title.tabIndex = 0;
    title.setAttribute('role', 'link');
    title.setAttribute('aria-label', lineName(r));
    // Focus comes back here when what it opened closes: the task modal finds it by data-peek.
    if (open.kind === 'task') title.dataset.peek = peekKey(open.project, open.key);
    if (open.kind === 'detail') title.dataset.opens = opensKey(open.detail);
    const go = (e: Event) => {
      if ((e.target as HTMLElement).closest('button, a.ext')) return;
      e.preventDefault();
      runDo(open);
    };
    row.addEventListener('click', go);
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e); });
  }
  return row;
}

/**
 * The name of a line's link (T-59): its title, which is what the link shows, then its state and its task's
 * key, which the line shows beside it. A screen reader on the link hears the title first, as it reads.
 */
export const lineName = (r: Pick<LandingRow, 'title' | 'id' | 'look'>): string => `${r.title}, ${r.look.label}${r.id ? `, ${r.id}` : ''}`;

/** A list of lines, as a detail shows it, or calm, as the Overview does. */
export function landingRows(rows: LandingRow[], label: string, calm = false): HTMLElement {
  const list = el('ol', 'lp-rows', ...rows.map((r) => landingRow(r, calm)));
  list.setAttribute('aria-label', label);
  return list;
}

/** Show all N: the list in the modal. */
export function showAll(g: LandingGroup): HTMLElement | null {
  const more = g.more;
  if (!more) return null;
  const b = el('button', 'btn ghost small lp-more', icon('list-flat'), more.label) as HTMLButtonElement;
  b.type = 'button';
  b.title = `${more.label}, over the page`;
  if (more.do.kind === 'detail') b.dataset.opens = opensKey(more.do.detail);
  b.addEventListener('click', () => runDo(more.do));
  return b;
}

/**
 * Needs you on the Overview: its heading with its count, its first three lines, calm, and Show all. With
 * nothing in it, one calm line says so, with no heading (T-36).
 */
export function landingGroup(g: LandingGroup): HTMLElement {
  const box = el('section', `lp-group lp-${g.key}`);
  box.dataset.overviewGroup = g.key;
  box.setAttribute('aria-label', g.title);
  if (!g.rows.length) {
    if (g.empty) box.append(el('p', 'lp-clear', icon(g.icon, g.tone), el('span', '', g.empty)));
    return box;
  }
  box.append(el('h2', '', icon(g.icon, g.tone), g.title, g.count ? el('span', 'count', String(g.count)) : null), landingRows(g.rows, g.title, true));
  const more = showAll(g);
  if (more) box.append(more);
  return box;
}

/**
 * One of the other lists, as a quiet card (T-36): its name, its count and one muted line. A click, or Enter,
 * opens it in full over the page; focus comes back to it when that closes. Its name says its count.
 */
export function landingCard(c: OverviewCard): HTMLElement {
  // The spaces draw nothing in its flex rows, and keep its title, count and line apart as words (T-59).
  const b = el('button', 'lp-card', el('span', 'lp-card-top', icon(c.icon, c.tone), el('span', 'lp-card-title', c.title), ' ', el('span', 'count', String(c.count))),
    ' ', el('span', 'lp-card-line', c.line)) as HTMLButtonElement;
  b.type = 'button';
  b.dataset.overviewCard = c.key;
  b.dataset.opens = opensKey(c.opens);
  b.setAttribute('aria-label', `${c.title}, ${c.count}: ${c.line}`);
  b.title = `${c.title}: ${c.line}`;
  b.addEventListener('click', () => openDetail(c.opens));
  return b;
}
