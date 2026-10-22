// The Build it sheet (D-168, T-96): the extension's dispatch-sheet message opens it over the page, a task's tab or
// the Command Center, in the page's modal (modal.ts). It asks for the model, the effort and where the
// builder runs, with what the builder would use already chosen. Enter dispatches and Escape cancels; focus
// goes back to what opened it. Dispatch sends the choice, and the extension works out acc's arguments.

import type { DispatchSheet, EffortValue, SheetEffort, SheetModel } from '../src/model/dispatch-sheet.ts';
import { button, el, focusedElement, icon, work } from './dom.ts';
import { makeModal } from './modal.ts';
import { api, type PageArea } from './state.ts';
import { BUILD_IT_TITLE, WORDS } from './plain-words.ts';

/** A model name as claude --model takes it: MODEL_NAME in the core's config, copied (D-121). */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/;

/** The open sheet: what it shows, what's chosen, and its parts. */
let open: {
  sheet: DispatchSheet;
  model: number;
  /** The effort's label, once a person picked one: kept across models that take it. */
  effort: string | null;
  where: DispatchSheet['place'];
  /** The name typed for Another model…. */
  name: string;
} | null = null;
let parts: { dialog: HTMLDialogElement; title: HTMLElement; body: HTMLElement; go: HTMLButtonElement } | null = null;
/** What had focus when it opened, which gets it back when it closes. */
let opener: HTMLElement | null = null;

/** The model chosen, and its effort segment chosen: the one picked when the model takes it, else its own. */
const chosen = (): { model: SheetModel; effort: SheetEffort | null } => {
  const model = open!.sheet.models[open!.model]!;
  const picked = open!.effort === null ? -1 : model.efforts.findIndex((e) => e.label === open!.effort);
  return { model, effort: model.efforts[picked >= 0 ? picked : model.effort] ?? null };
};

/** The model's name it dispatches with: its own, or the one typed for Another model…; null when that's not a name. */
const modelName = (): string | null => {
  const m = chosen().model;
  if (m.value !== null) return m.value;
  const typed = open!.name.trim();
  return MODEL_NAME.test(typed) ? typed : null;
};

/** Why Dispatch is off, or null when it's on. */
const goOff = (): string | null => (modelName() === null ? (open!.name.trim() ? 'That isn\'t a model name: letters, digits, dots, dashes, colons and brackets' : 'Type a model\'s name first') : null);

/**
 * A group of choices, one on, as radio buttons: Up, Down, Left and Right move the choice, and focus with
 * it, skipping one that's off. A choice that's off says why in its title.
 */
function radios(label: string, cls: string, itemCls: string, items: { label: Node[]; title: string; on: boolean; off?: string }[], pick: (i: number) => void): HTMLElement {
  const g = el('div', cls);
  g.setAttribute('role', 'radiogroup');
  g.setAttribute('aria-label', label);
  const buttons = items.map((it, i) => {
    const b = el('button', `${itemCls}${it.on ? ' on' : ''}`, ...it.label) as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(it.on));
    b.tabIndex = it.on ? 0 : -1;
    b.title = it.off ? `${it.title}: ${it.off}` : it.title;
    if (it.off) b.setAttribute('aria-disabled', 'true');
    b.addEventListener('click', () => { if (!it.off) pick(i); });
    return b;
  });
  g.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    for (let k = 1; k <= items.length; k++) {
      const i = (at + step * k + items.length * k) % items.length;
      if (!items[i]!.off) { pick(i); return; }
    }
  });
  g.append(...buttons);
  return g;
}

/** A part of the sheet: its name, then what it holds. */
const part = (name: string, ...children: (Node | null)[]): HTMLElement => {
  const p = el('section', 'ds-part', el('h3', 'ds-label', name), ...children);
  p.dataset.section = name.toLowerCase();
  return p;
};

/** Draws the sheet from what's chosen, keeping focus in the part that had it. */
function draw(): void {
  if (!open || !parts) return;
  const s = open.sheet;
  const { model, effort } = chosen();
  const focused = (document.activeElement as HTMLElement | null)?.closest('[role=radiogroup], .ds-name')?.getAttribute('data-part') ?? null;
  parts.title.textContent = s.title;
  parts.dialog.setAttribute('aria-label', s.title);

  const models = radios('Model', 'ds-models', 'ds-row', s.models.map((m, i) => ({
    label: [el('span', 'ds-row-name', m.label), el('span', 'ds-row-about muted', m.about)],
    title: `${m.label} · ${m.about}`,
    on: i === open!.model,
  })), (i) => { open!.model = i; draw(); });
  models.dataset.part = 'model';
  let name: HTMLInputElement | null = null;
  if (model.value === null) {
    name = document.createElement('input');
    name.type = 'text';
    name.className = 'ds-name';
    name.dataset.part = 'name';
    name.placeholder = 'An alias or a full model name';
    name.setAttribute('aria-label', 'Model name');
    name.spellcheck = false;
    name.value = open.name;
    name.addEventListener('input', () => { open!.name = name!.value; foot(); });
  }

  const efforts = model.efforts.length
    ? radios('Effort', 'segmented ds-seg', 'seg', model.efforts.map((e) => ({ label: [document.createTextNode(e.label)], title: `${e.label} · ${e.about}`, on: e === effort })), (i) => { open!.effort = model.efforts[i]!.label; draw(); })
    : null;
  if (efforts) efforts.dataset.part = 'effort';
  const effortLine = el('p', 'ds-note muted', effort ? effort.about : model.none);

  const places = radios('Where', 'segmented ds-seg', 'seg', s.places.map((p) => ({ label: [icon(p.icon), document.createTextNode(p.label)], title: p.label, on: p.value === open!.where, off: p.disabled })), (i) => { open!.where = s.places[i]!.value; draw(); });
  places.dataset.part = 'where';
  const off = s.places.find((p) => p.disabled);
  const whereLine = open.where === 'cloud' ? el('p', 'ds-note muted', s.cloudNote)
    : off ? el('p', 'ds-note muted', icon('info'), el('span', '', off.disabled!)) : null;

  // Dispatch anyway (D-093): what it shares, and with which tasks.
  const shares = s.shares ? el('div', 'ds-shares', el('p', 'ds-shares-head', icon('warning', 'orange'), el('span', 'strong', s.shares.message)),
    el('ul', 'ds-shares-list', ...s.shares.lines.map((l) => el('li', '', el('span', 'strong', `${l.task}: `), work(el('span', 'mono', l.files), 'files'))))) : null;

  parts.body.replaceChildren(...[
    shares,
    part('Model', models, name),
    part('Effort', efforts, effortLine),
    part('Where', places, whereLine),
    s.size ? el('p', 'ds-size muted', icon('symbol-ruler'), el('span', '', s.size)) : null,
  ].filter((x): x is HTMLElement => !!x));
  foot();
  const again = focused ? parts.body.querySelector<HTMLElement>(`[data-part="${focused}"]`) : null;
  (again?.matches('input') ? again : again?.querySelector<HTMLElement>('[aria-checked="true"]'))?.focus({ preventScroll: true });
}

/** Dispatch's label, and whether it's off, with why. */
function foot(): void {
  if (!open || !parts) return;
  const why = goOff();
  parts.go.replaceChildren(icon('rocket'), open.sheet.go);
  parts.go.disabled = !!why;
  parts.go.title = why ?? `${BUILD_IT_TITLE} (Enter)`;
}

/** Dispatch: the choice goes to the extension, and the sheet closes. Nothing goes while Dispatch is off. */
function dispatch(): void {
  if (!open || goOff()) return;
  const { model, effort } = chosen();
  const s = open.sheet;
  api.postMessage({
    type: 'dispatch-sheet-go', project: s.project, task: s.task, model: modelName()!,
    ...(model.efforts.length ? { effort: (effort?.value ?? null) as EffortValue } : {}),
    where: open.where, ...(s.anyway ? { anyway: true } : {}),
  });
  shut();
}

function make(): NonNullable<typeof parts> {
  const title = el('h2', 'ds-title');
  const m = makeModal('dispatch-sheet', [title], shut);
  const cancel = button('Cancel', 'close', () => shut(), 'ds-cancel');
  cancel.title = 'Cancel (Escape)';
  const go = button(WORDS.buildIt, 'rocket', () => dispatch(), 'primary ds-go');
  m.dialog.append(el('div', 'ds-foot', cancel, go));
  // Enter dispatches from anywhere in it, but on Cancel, which cancels.
  m.dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.defaultPrevented || e.target === cancel) return;
    e.preventDefault();
    dispatch();
  });
  m.dialog.addEventListener('close', () => { if (open) closed(); });
  return { dialog: m.dialog, title, body: m.body, go };
}

/** Opens the sheet for a task, with what its builder uses chosen; open already, it shows this one. */
function openSheet(sheet: DispatchSheet): void {
  parts ??= make();
  if (!parts.dialog.open) opener = focusedElement();
  open = { sheet, model: 0, effort: null, where: sheet.place, name: '' };
  draw();
  if (!parts.dialog.open) parts.dialog.showModal();
  parts.body.querySelector<HTMLElement>('[data-part="model"] [aria-checked="true"]')?.focus();
}

/** Closes it, whichever way it was asked to: nothing is sent. */
function shut(): void {
  if (!parts?.dialog.open) return;
  parts.dialog.close();
  closed();
}

/** It closed: focus goes back to what opened it, when that's still on the page. */
function closed(): void {
  open = null;
  parts?.body.replaceChildren();
  const o = opener;
  opener = null;
  if (o?.isConnected) o.focus({ preventScroll: true });
}

export const area: PageArea = {
  receive: { 'dispatch-sheet': (msg: { sheet?: DispatchSheet }) => { if (msg.sheet?.models?.length) openSheet(msg.sheet); } },
};
