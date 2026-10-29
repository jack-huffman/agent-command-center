// A list of the Connect modal's board step as a dropdown (T-140): a button that names the choice, and a list
// under it to pick from, each choice with its details and how many tickets it would hold. A long list gets a
// box to find a choice by typing; a list that ticks several stays open while it's ticked. The list stays open
// while the page redraws, as the board switch's does.

import type { CardCount, ConnectModel, ConnectPicker } from '../src/model/connect.ts';
import { el, icon } from './dom.ts';
import { connectSend } from './choose-board.ts';
import { api } from './state.ts';

// The list open, by page and list, and what's typed in its box, so a redraw keeps them. The screenshot harness can start one open.
const started = api.getState() as { openDrop?: string; dropQuery?: string } | undefined;
let openDrop: string | null = started?.openDrop ?? null;
const typed = new Map<string, string>(started?.openDrop && started.dropQuery ? [[started.openDrop, started.dropQuery]] : []);

/** A choice of a list (T-140): its value, words and count. '' is the whole project, for a list that has one. */
interface Choice { value: string; label: string; detail: string | null; usedBy: string | null; count: CardCount | null }

/** The choices a list shows for what's typed (T-140): the whole project always, the rest when their words have it. */
export function dropChoices(p: Pick<ConnectPicker, 'whole' | 'wholeCount' | 'options'>, query: string): Choice[] {
  const q = query.trim().toLowerCase();
  const all: Choice[] = [...(p.whole ? [{ value: '', label: p.whole, detail: null, usedBy: null, count: p.wholeCount }] : []), ...p.options];
  return all.filter((o) => !q || !o.value || `${o.label} ${o.detail ?? ''}`.toLowerCase().includes(q));
}

/** What the button says (T-140): the choice, the choices ticked, or the whole project when none is. */
export function dropText(p: Pick<ConnectPicker, 'whole' | 'options' | 'selected' | 'multi'>): string {
  const names = p.selected.map((v) => p.options.find((o) => o.value === v)?.label ?? v);
  if (!names.length) return p.whole ?? (p.multi ? 'None ticked' : 'Choose one');
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(', ');
}

/** A choice's count (T-140): a quiet bar while it's read, its number once it is, and why in orange with a warning when it couldn't be. */
function countNote(c: CardCount): HTMLElement {
  if (c.state === 'waiting' || c.state === 'loading') return el('span', 'cdrop-count', el('span', 'ccard-skeleton'), el('span', '', c.label));
  if (c.state === 'failed') return el('span', 'cdrop-count tone-orange', icon('warning', 'orange'), el('span', '', c.label));
  return el('span', 'cdrop-count', icon('issues'), el('span', '', c.label));
}

/**
 * One list as a dropdown (T-140). One choice picks it and closes the list; a list that ticks several ticks and
 * unticks, and its whole project unticks every one. Opening asks for the counts of the choices in view.
 * `id` is the button's, which the dropdown's label names.
 */
export function pickerDropdown(m: ConnectModel, p: ConnectPicker, id: string): HTMLElement {
  const key = `${m.id}:${p.key}`;
  const text = dropText(p);
  const btn = el('button', 'btn cdrop-btn', el('span', 'cdrop-text', text), icon('chevron-down')) as HTMLButtonElement;
  btn.type = 'button';
  btn.id = id;
  btn.title = `${p.label}: ${text}`;
  btn.disabled = p.disabled;
  btn.dataset.keep = `cdrop:${key}`;
  btn.setAttribute('aria-haspopup', 'listbox');
  const list = el('div', 'cdrop-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', p.label);
  if (p.multi) list.setAttribute('aria-multiselectable', 'true');
  const send = (value: string): void => {
    if (!p.multi) {
      show(false);
      btn.focus();
      if (!(value ? p.selected[0] === value : !p.selected.length)) connectSend(m, { type: 'connect-pick', key: p.key, value: value || null });
      return;
    }
    // The whole project unticks every one; one ticked leaves the whole project.
    const next = !value ? [] : p.selected.includes(value) ? p.selected.filter((v) => v !== value) : [...p.selected, value];
    connectSend(m, { type: 'connect-pick', key: p.key, value: next });
  };
  const option = (o: Choice): HTMLElement => {
    const on = o.value ? p.selected.includes(o.value) : !p.selected.length;
    const b = el('button', `cdrop-option${on ? ' on' : ''}`, icon(on ? 'pass-filled' : 'circle-large-outline', on ? 'blue' : undefined),
      el('span', 'cdrop-option-text', el('span', 'cdrop-name', o.label), o.detail ? el('span', 'cdrop-detail', o.detail) : null,
        o.count ? countNote(o.count) : null,
        o.usedBy ? el('span', 'used-by tone-orange', icon('warning', 'orange'), el('span', '', o.usedBy)) : null)) as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(on));
    b.dataset.value = o.value;
    b.dataset.count = o.count?.state ?? '';
    b.dataset.keep = `cdrop:${key}:${o.value}`;
    b.addEventListener('click', (e) => { e.stopPropagation(); send(o.value); });
    return b;
  };
  const askCounts = (): void => {
    const values = [...list.querySelectorAll<HTMLElement>('.cdrop-option[data-count="waiting"]')].map((c) => c.dataset.value ?? '').slice(0, m.countMost);
    if (values.length && !list.hidden) connectSend(m, { type: 'connect-count', key: p.key, values });
  };
  const fill = (query: string): void => {
    const choices = dropChoices(p, query);
    list.replaceChildren(...choices.map(option), ...(choices.some((c) => c.value) || !query.trim() ? [] : [el('p', 'muted small cdrop-none', icon('search'), el('span', '', `None of the ${p.label.toLowerCase()} has “${query.trim()}” in it.`))]));
  };
  const find = p.search ? document.createElement('input') : null;
  if (find) {
    find.type = 'search';
    find.className = 'text-input cdrop-find';
    find.placeholder = `Find ${/^[aeiou]/i.test(p.label) ? 'an' : 'a'} ${p.label.toLowerCase()}`;
    find.setAttribute('aria-label', find.placeholder);
    find.dataset.keep = `cdrop:${key}:find`;
    find.value = typed.get(key) ?? '';
    find.addEventListener('input', () => { typed.set(key, find.value); fill(find.value); askCounts(); });
  }
  fill(find?.value ?? '');
  const pop = el('div', 'cdrop-pop', find, list);
  const show = (open: boolean): void => {
    pop.hidden = !open;
    list.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    openDrop = open ? key : openDrop === key ? null : openDrop;
  };
  show(openDrop === key && !p.disabled);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !!pop.hidden;
    document.querySelectorAll<HTMLElement>('.cdrop-pop').forEach((x) => { if (x !== pop) x.hidden = true; });
    show(opening);
    if (!opening) return;
    askCounts();
    (find ?? list.querySelector<HTMLElement>('.cdrop-option.on') ?? list.querySelector<HTMLElement>('.cdrop-option'))?.focus();
  });
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' || !pop.hidden) return;
    e.preventDefault();
    btn.click();
  });
  pop.addEventListener('keydown', (e) => {
    const all = [...pop.querySelectorAll<HTMLElement>('.cdrop-find, .cdrop-option')];
    const here = all.indexOf(document.activeElement as HTMLElement);
    // Escape closes the list, not the modal under it.
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); show(false); btn.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); all[(here + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus(); }
    // Enter in the box picks the first choice it finds.
    if (e.key === 'Enter' && document.activeElement === find) { e.preventDefault(); list.querySelector<HTMLElement>('.cdrop-option[data-value]:not([data-value=""])')?.click(); }
  });
  if (!pop.hidden) queueMicrotask(askCounts);
  const box = el('div', 'cdrop', btn, pop);
  box.addEventListener('click', (e) => e.stopPropagation());
  box.addEventListener('mousedown', (e) => e.stopPropagation());
  return box;
}

/** A click outside a list closes it (T-140). */
document.addEventListener('mousedown', () => {
  if (!openDrop) return;
  openDrop = null;
  document.querySelectorAll<HTMLElement>('.cdrop-pop').forEach((x) => { x.hidden = true; x.previousElementSibling?.setAttribute('aria-expanded', 'false'); });
});
