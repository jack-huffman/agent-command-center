// Choosing a board by seeing it (T-106): each list's choices as cards, and the board they would make, drawn
// beside the steps before anything is kept.

import type { CardCount, ConnectModel, ConnectPicker } from '../src/model/connect.ts';
import type { TrackerBoard, TrackerColumn } from '../src/model/boards.ts';
import { button, type Child, el, icon, keptInput, stateChip, status } from './dom.ts';
import { trackerCard } from './tasks.ts';
import { api } from './state.ts';

/** What's typed in each list's search, by page and list, so a redraw keeps it. */
const searches = new Map<string, string>();

const send = (m: ConnectModel, msg: Record<string, unknown>): void => api.postMessage({ ...msg, session: m.id });

/** A choice another repo on this machine uses already (GH-81): an icon and its words, never colour alone. */
export const usedMark = (words: string): HTMLElement => el('span', 'used-by tone-orange', icon('warning', 'orange'), el('span', '', words));

/**
 * A card's count of tickets (T-106): a skeleton while it's read, its number once it is, and on a failure the
 * reason, in orange with a warning icon. The card can be chosen whichever it is.
 */
function countLine(c: CardCount): HTMLElement {
  if (c.state === 'waiting' || c.state === 'loading') return el('span', 'ccard-count', el('span', 'ccard-skeleton'), el('span', '', c.label));
  if (c.state === 'failed') return el('span', 'ccard-count tone-orange', icon('warning', 'orange'), el('span', '', c.label));
  return el('span', 'ccard-count', icon('issues'), el('span', '', c.label));
}

/** One choice as a card (T-106): a tick when it's chosen, its name and details, how many tickets it would hold, and their first titles. */
function choiceCard(m: ConnectModel, p: ConnectPicker, o: { value: string; label: string; detail: string | null; usedBy: string | null; count: CardCount | null }, on: boolean, pick: (input: HTMLInputElement) => void): HTMLElement {
  const input = document.createElement('input');
  input.type = p.multi ? 'checkbox' : 'radio';
  input.name = `connect-${p.key}`;
  input.className = 'ccard-input';
  input.value = o.value;
  input.checked = on;
  input.disabled = p.disabled;
  input.dataset.keep = `connect:${m.id}:${p.key}:${o.value}`;
  input.addEventListener('change', () => pick(input));
  const titles = o.count?.titles.length ? el('ul', 'ccard-titles', ...o.count.titles.map((t) => el('li', '', t))) : null;
  const card = el('label', `ccard${on ? ' on' : ''}`, input,
    icon(on ? 'pass-filled' : 'circle-large-outline', on ? 'blue' : undefined),
    el('span', 'ccard-body', el('span', 'ccard-name', o.label), o.detail ? el('span', 'ccard-detail', o.detail) : null, o.count ? countLine(o.count) : null, titles, o.usedBy ? usedMark(o.usedBy) : null));
  card.dataset.value = o.value;
  card.dataset.count = o.count?.state ?? '';
  card.dataset.find = `${o.label} ${o.detail ?? ''}`.toLowerCase();
  return card;
}

/**
 * Asks for the counts of the cards in view that haven't been read (T-106), the first countMost of them, so a
 * long list is counted as it's searched rather than all at once.
 */
function askCounts(m: ConnectModel, p: ConnectPicker, grid: HTMLElement): void {
  const values = [...grid.querySelectorAll<HTMLElement>('.ccard[data-count="waiting"]:not([hidden])')].map((c) => c.dataset.value ?? '').slice(0, m.countMost);
  if (values.length) send(m, { type: 'connect-count', key: p.key, values });
}

/**
 * A list's choices as cards (T-106), the whole project first where it has one. A long list gets a search box
 * that hides the cards it doesn't match, and says when none do. One choice sends it; ticks send every card ticked.
 */
export function pickerCards(m: ConnectModel, p: ConnectPicker): Child[] {
  const id = `connect-${p.key}`;
  const grid = el('div', 'ccards');
  grid.id = id;
  grid.setAttribute('role', p.multi ? 'group' : 'radiogroup');
  grid.setAttribute('aria-label', p.label);
  const pick = (input: HTMLInputElement) => {
    if (!p.multi) return send(m, { type: 'connect-pick', key: p.key, value: input.value || null });
    // The whole project unticks every label; a label ticked leaves the whole project.
    const ticked = input.value ? [...grid.querySelectorAll<HTMLInputElement>('.ccard-input:checked')].map((b) => b.value).filter(Boolean) : [];
    send(m, { type: 'connect-pick', key: p.key, value: ticked });
  };
  if (p.whole) grid.append(choiceCard(m, p, { value: '', label: p.whole, detail: null, usedBy: null, count: p.wholeCount }, !p.selected.length, pick));
  for (const o of p.options) grid.append(choiceCard(m, p, o, p.selected.includes(o.value), pick));
  const none = el('p', 'muted small ccards-none', icon('search'), el('span', '', `No ${p.label.toLowerCase()} matches.`));
  const k = `${m.id}:${p.key}`;
  const filter = () => {
    const q = (searches.get(k) ?? '').trim().toLowerCase();
    let shown = 0;
    for (const card of grid.querySelectorAll<HTMLElement>('.ccard')) {
      const hide = !!q && !!card.dataset.value && !(card.dataset.find ?? '').includes(q);
      card.hidden = hide;
      if (!hide && card.dataset.value) shown++;
    }
    none.hidden = !q || shown > 0;
    askCounts(m, p, grid);
  };
  const search = p.search ? keptInput(`connect:${k}:search`, searches.get(k) ?? '', `Search ${p.label.toLowerCase()}`, (v) => { searches.set(k, v); filter(); }) : null;
  if (search) {
    search.setAttribute('aria-label', `Search ${p.label.toLowerCase()}`);
    search.classList.add('ccards-search');
  }
  filter();
  return [search, p.options.length || p.whole ? grid : null, none];
}

/** One column of the preview (T-106): its name and how many it holds, its first cards, and how many more. */
function previewColumn(b: TrackerBoard, c: TrackerColumn, total: number): HTMLElement {
  const more = total - c.cards.length;
  return el('section', `cpreview-col tone-edge-${c.tone}`,
    el('h3', 'cpreview-head', stateChip({ label: c.name, icon: c.icon, tone: c.tone, quiet: c.quiet }), el('span', 'count', String(total))),
    ...c.cards.map((x) => trackerCard('', b, x, true)),
    more > 0 ? el('div', 'muted small cpreview-more', `and ${more} more`) : null,
    total ? null : el('div', 'muted small cpreview-more', 'None here'));
}

/**
 * The board the choices would make (T-106), beside the steps, or below them at 620 px and under: its line,
 * its columns with their first cards drawn as the Tasks tab draws them, what to change when it's empty, Read
 * it again when it failed, and the foot with Use this board, which saves the place only from here.
 */
export function previewPanel(m: ConnectModel, foot: HTMLElement): HTMLElement {
  const p = m.preview;
  const skeleton = p.state === 'loading' ? el('div', 'cpreview-cols', ...[0, 1, 2].map(() => el('div', 'cpreview-col', el('span', 'ccard-skeleton cpreview-skel'), el('span', 'ccard-skeleton cpreview-skel')))) : null;
  const board = p.board ? el('div', 'cpreview-cols', ...p.board.columns.map((c, i) => previewColumn(p.board!, c, p.totals[i] ?? c.cards.length))) : null;
  return el('section', `connect-step connect-preview preview-${p.state}`,
    el('h2', '', icon('project'), ' Your board'),
    status(p.look),
    p.board ? el('div', 'muted small cpreview-title', p.board.title) : null,
    skeleton, board,
    p.empty ? el('p', 'cpreview-empty', icon('info'), el('span', '', p.empty)) : null,
    p.retry ? button('Read it again', 'refresh', () => send(m, { type: 'connect-preview' }), 'ghost') : null,
    foot);
}
