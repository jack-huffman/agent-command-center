// The command palette (T-52): one box that searches every section, part of Settings, task, agent and
// action the page offers (the model's `palette`, built by model/palette.ts), and Enter runs the choice, as
// its control on the page would. It opens from the rail's button, from `/` outside a text box, and from the
// extension's acc.palette command (Cmd+K or Ctrl+K while the tab has focus). It sits in the page's modal
// (modal.ts) at the top of the tab: Escape or a click outside closes it, and focus goes back to what opened it.

import type { Model } from '../src/model/home.ts';
import type { PaletteItem } from '../src/model/palette.ts';
import { answerHere } from './detail.ts';
import { el, icon, plural, refreshPage } from './dom.ts';
import { boldParts, hintAt, PALETTE_KINDS, paletteResults, RECENTS, type Results, type Shown } from './fuzzy.ts';
import { makeModal } from './modal.ts';
import { api, go, memory, type PageArea, remember, state, view } from './state.ts';

/** What the rail's button and the box are called. */
const NAME = 'Search or run a command';
const MAC = /Mac/i.test(navigator.platform || navigator.userAgent);
/** The key that opens it, as its button's title says it. */
const KEY = MAC ? '⌘K' : 'Ctrl+K';

let parts: { dialog: HTMLDialogElement; box: HTMLInputElement; list: HTMLElement; foot: HTMLElement } | null = null;
/** What it shows now, in the order the keys move through, and which is chosen. */
let shown: Shown[] = [];
let active = 0;
/** What had focus when it opened, which gets it back when it closes. */
let opener: HTMLElement | null = null;

const items = (): PaletteItem[] => (state.last?.kind === 'home' ? state.last.palette : []);

/** The rail's button, under the brand. */
export function paletteButton(): HTMLElement {
  const b = el('button', 'palette-btn', icon('search'), el('span', 'palette-btn-label', NAME)) as HTMLButtonElement;
  b.type = 'button';
  b.title = `${NAME} (${KEY}, or /)`;
  b.setAttribute('aria-label', NAME);
  b.setAttribute('aria-keyshortcuts', MAC ? 'Meta+K /' : 'Control+K /');
  b.addEventListener('click', () => openPalette());
  return b;
}

function make(): NonNullable<typeof parts> {
  const box = document.createElement('input');
  box.type = 'text';
  box.className = 'palette-box';
  box.placeholder = 'Search sections, settings, tasks, agents and actions';
  box.autocomplete = 'off';
  box.spellcheck = false;
  box.setAttribute('role', 'combobox');
  box.setAttribute('aria-label', NAME);
  box.setAttribute('aria-expanded', 'true');
  box.setAttribute('aria-autocomplete', 'list');
  box.setAttribute('aria-controls', 'palette-list');
  const list = el('div', 'palette-list');
  list.id = 'palette-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Results');
  // How many results there are, or none, or why the choice didn't run: read out as it changes.
  const foot = el('p', 'palette-foot muted small');
  foot.setAttribute('aria-live', 'polite');
  const m = makeModal('palette-modal', [icon('search'), box], shut);
  m.dialog.setAttribute('aria-label', NAME);
  m.body.append(list, foot);
  box.addEventListener('input', () => { active = 0; draw(); });
  box.addEventListener('keydown', onKey);
  // Focus stays in it: Tab and Shift+Tab go nowhere, and typing anywhere in it goes to the box.
  m.dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      box.focus();
    } else if (e.target !== box && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) box.focus();
  });
  m.dialog.addEventListener('close', () => { if (opener) closed(); });
  return { dialog: m.dialog, box, list, foot };
}

/** Up and Down move the choice, Home and End go to the ends, and Enter runs it. */
function onKey(e: KeyboardEvent): void {
  const last = shown.length - 1;
  const to = e.key === 'ArrowDown' ? active + 1 : e.key === 'ArrowUp' ? active - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
  if (to !== null) {
    e.preventDefault();
    choose(Math.max(0, Math.min(last, to)));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const choice = shown[active];
    if (choice) run(choice.item);
  }
}

/** Marks the result at i as the choice, and keeps it in view. */
function choose(i: number): void {
  if (!parts || i < 0) return;
  active = i;
  const options = [...parts.list.querySelectorAll<HTMLElement>('[role=option]')];
  options.forEach((o, k) => o.setAttribute('aria-selected', String(k === i)));
  const on = options[i];
  if (on) {
    parts.box.setAttribute('aria-activedescendant', on.id);
    on.scrollIntoView({ block: 'nearest' });
  } else parts.box.removeAttribute('aria-activedescendant');
}

/** A text with the characters the query matched in bold. */
const bolded = (cls: string, text: string, at: number[], from: number | null): HTMLElement =>
  el('span', cls, ...(from === null ? [text] : boldParts(text, at, from).map((p) => (p.bold ? el('b', '', p.text) : p.text))));

function option(s: Shown, i: number): HTMLElement {
  const { item, at } = s;
  const hint = item.disabled ? el('span', 'palette-hint', icon('circle-slash'), item.disabled) : item.hint ? bolded('palette-hint', item.hint, at, hintAt(item)) : null;
  const o = el('div', 'palette-option', icon(item.icon), bolded('palette-title', item.title, at, 0), el('span', 'palette-kind muted', PALETTE_KINDS[item.kind].word), hint);
  o.id = `palette-opt-${i}`;
  o.setAttribute('role', 'option');
  o.setAttribute('aria-selected', String(i === active));
  if (item.disabled) {
    o.setAttribute('aria-disabled', 'true');
    o.title = `${item.title}: ${item.disabled}`;
  } else o.title = item.hint ? `${item.title} · ${item.hint}` : item.title;
  // A click runs it, and the box keeps focus.
  o.addEventListener('mousedown', (e) => e.preventDefault());
  o.addEventListener('mousemove', () => { if (active !== i) choose(i); });
  o.addEventListener('click', () => { choose(i); run(item); });
  return o;
}

/** The results for what's typed, in their groups, and the line under them. */
function draw(): void {
  if (!parts) return;
  const query = parts.box.value;
  const r: Results = paletteResults(items(), query, memory().palette ?? []);
  shown = r.groups.flatMap((g) => g.items);
  active = Math.min(active, Math.max(0, shown.length - 1));
  let i = 0;
  parts.list.replaceChildren(...r.groups.map((g) => {
    const head = el('div', 'palette-head muted small', g.heading);
    head.id = `palette-group-${g.key}`;
    const group = el('div', 'palette-group', head, ...g.items.map((s) => option(s, i++)));
    group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', head.id);
    return group;
  }));
  parts.foot.textContent = !query.trim() ? `${plural(r.total, 'result')}: what you ran last, then the sections. Type to search everything.`
    : !r.total ? `Nothing matches "${query.trim()}".`
      : r.more ? `${plural(r.total, 'result')}, ${r.more} more not shown: type more to narrow them.` : plural(r.total, 'result');
  choose(shown.length ? active : -1);
  if (!shown.length) parts.box.removeAttribute('aria-activedescendant');
}

/** Runs an item, as its control on the page would. One that's off says why, and stays open. */
function run(item: PaletteItem): void {
  if (!parts) return;
  if (item.disabled) {
    parts.foot.textContent = `${item.title} can't run now: ${item.disabled}`;
    return;
  }
  remember((m) => { m.palette = [item.id, ...(m.palette ?? []).filter((id) => id !== item.id)].slice(0, RECENTS); });
  shut();
  const d = item.does;
  if (d.kind === 'go') go(d.section, d.part);
  else if (d.kind === 'task') api.postMessage({ type: 'task-modal-open', project: d.project, key: d.key });
  else if (d.kind === 'run') api.postMessage({ type: 'run', command: d.command, ref: d.ref });
  else if (d.kind === 'toolbar') api.postMessage({ type: 'toolbar', command: d.command, project: d.project });
  else if (d.kind === 'answer') { go('overview'); answerHere(d.question); } else refreshPage();
}

/** Opens it over the page, with what's typed, and focus in its box. Open already, it takes focus again. */
function openPalette(query = ''): void {
  if (view !== 'home' || state.last?.kind !== 'home') return;
  parts ??= make();
  if (!parts.dialog.open) {
    const a = document.activeElement as HTMLElement | null;
    opener = a && a !== document.body ? a : null;
    parts.box.value = query;
    active = 0;
    draw();
    parts.dialog.showModal();
  } else if (query) { parts.box.value = query; draw(); }
  parts.box.focus();
  parts.box.select();
}

/** Closes it, whichever way it was asked to. */
function shut(): void {
  if (!parts?.dialog.open) return;
  parts.dialog.close();
  closed();
}

/** It closed: focus goes back to what opened it, found again when the page redrew it, as the rail's button. */
function closed(): void {
  const o = opener;
  opener = null;
  if (!o) return;
  const again = o.isConnected ? o : o.classList.contains('palette-btn') ? document.querySelector<HTMLElement>('.palette-btn') : null;
  again?.focus({ preventScroll: true });
}

/** `/` opens it from anywhere on the page but a text box, a text area or another open modal. */
function onSlash(e: KeyboardEvent): void {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], dialog[open]')) return;
  e.preventDefault();
  openPalette();
}
let listening = false;

export const area: PageArea = {
  // The page's first draw starts listening for `/`; a new model while it's open draws its results again, with what's typed.
  after(model: Model) {
    if (!listening) { listening = true; document.addEventListener('keydown', onSlash); }
    if (model.kind === 'home' && parts?.dialog.open) draw();
  },
  // The extension's acc.palette (Cmd+K, Ctrl+K). The screenshot run sends a query, to show results.
  receive: { palette: (msg: { query?: string }) => openPalette(typeof msg.query === 'string' ? msg.query : '') },
};

