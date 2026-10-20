// A board's person filter, drawn (T-79): a button that says the choice and its count, and a menu of the
// choices, each with an icon and a label. Which choices, and which cards they show, is person-filter.ts.
// The choice is kept in this window's state by the board's key, so it outlasts a redraw.

import { el, icon } from './dom.ts';
import { type Choice, choicesFor, effective, headerLine, noMatch, type Person } from './person-filter.ts';
import { api, memory, remember, state } from './state.ts';

// The screenshot harness can start with a filter's menu open, to see it laid out.
let openFilter: string | null = ((api.getState() as { openFilter?: string } | undefined)?.openFilter) ?? null;

/** What a board gets back: the control for its header, the choice to filter its cards by, and its words. */
export interface PersonFilter {
  control: HTMLElement;
  /** The choice that applies now: the one kept, or Everyone. */
  choice: string;
  /** The line to draw above a board whose choice shows no card, with the way back to Everyone. It makes the empty board reachable by keyboard. */
  none(board: HTMLElement): HTMLElement;
}

const keep = (key: string, choice: string | null): void => {
  remember((m) => {
    const filters = { ...m.filters };
    if (choice) filters[key] = choice;
    else delete filters[key];
    m.filters = filters;
  });
  if (state.last) state.draw(state.last);
};

/**
 * The filter for one board. `key` names it ("tracker:<root>#<index>", "agents:<root>"); `cards` is every card
 * on it, before filtering; `me` is the key Mine means, or null when the tracker can't say.
 */
export function personFilter(key: string, cards: readonly { people: readonly Person[] }[], me: string | null): PersonFilter {
  const kept = memory().filters?.[key];
  const choices = choicesFor(cards, me, kept);
  const { choice: at, text } = headerLine(choices, kept, me, cards.length);
  const btn = el('button', 'btn ghost person-btn', icon(at.icon), el('span', '', text), icon('chevron-down')) as HTMLButtonElement;
  btn.type = 'button';
  btn.title = 'Show the cards of one person';
  btn.setAttribute('aria-label', `Person filter: ${text}`);
  btn.setAttribute('aria-haspopup', 'menu');
  const item = (c: Choice): HTMLElement => {
    const b = el('button', `more-item person-item${c.id === at.id ? ' on' : ''}`, icon(c.icon), el('span', 'person-name', c.label), el('span', 'muted person-count', String(c.count))) as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', String(c.id === at.id));
    // A choice that can't be used says why, never left to do nothing.
    if (c.disabled) { b.disabled = true; b.title = c.disabled; b.setAttribute('aria-description', c.disabled); }
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openFilter = null;
      keep(key, c.id);
    });
    return b;
  };
  const menu = el('div', 'more-menu person-menu', ...choices.map(item));
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Person');
  const show = (open: boolean): void => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    openFilter = open ? key : openFilter === key ? null : openFilter;
  };
  show(openFilter === key);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !!menu.hidden;
    document.querySelectorAll<HTMLElement>('.more-menu').forEach((m) => { if (m !== menu) m.hidden = true; });
    show(opening);
    if (opening) menu.querySelector<HTMLElement>('.person-item.on')?.focus();
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll<HTMLElement>('.person-item:not(:disabled)')];
    const here = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); show(false); btn.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(here + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus(); }
  });
  const control = el('div', 'person-filter', btn, menu);
  control.addEventListener('click', (e) => e.stopPropagation());
  control.addEventListener('mousedown', (e) => e.stopPropagation());
  const none = (board: HTMLElement): HTMLElement => {
    // With no card to focus, the board's lanes still scroll sideways: the board itself takes the keys that scroll them.
    board.tabIndex = 0;
    board.setAttribute('role', 'group');
    board.setAttribute('aria-label', `No card shows for ${at.label}`);
    const back = el('button', 'btn ghost', icon('organization'), 'Show everyone') as HTMLButtonElement;
    back.type = 'button';
    back.addEventListener('click', () => keep(key, null));
    return el('div', 'notice info person-none', icon('info', 'blue'), el('span', '', noMatch(at.label)), back);
  };
  return { control, choice: effective(kept, me), none };
}
