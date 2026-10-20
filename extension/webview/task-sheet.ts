// The task sheet (T-74): the extension's task-sheet message opens it over the page, a task's tab or the
// Command Center, in the page's modal (modal.ts), as Dispatch's sheet opens (D-168). It writes a new task,
// or edits one: a title, a description of several lines in Markdown, its dependencies, environment and
// labels, and for a task already there, notes for the builder. A tracker's task shows what its ticket owns
// read-only, with why and a way to open the ticket. Enter in a one-line box saves, and so do Cmd+Enter and
// Ctrl+Enter anywhere; Escape cancels; focus goes back to what opened it. Save sends what was written, and
// the extension works out acc's arguments.

import type { TaskSheet, TaskSheetFields } from '../src/model/task-sheet.ts';
import { button, el, focusedElement, icon } from './dom.ts';
import { makeModal } from './modal.ts';
import { api, type PageArea } from './state.ts';

/** The open sheet: what it shows, and its boxes. */
let open: { sheet: TaskSheet; boxes: Partial<Record<keyof TaskSheetFields, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>> } | null = null;
let parts: { dialog: HTMLDialogElement; heading: HTMLElement; body: HTMLElement; go: HTMLButtonElement } | null = null;
/** What had focus when it opened, which gets it back when it closes. */
let opener: HTMLElement | null = null;
/** Ids for each box's label, unique on the page. */
let ids = 0;

/** What's written in it now: a read-only field keeps the sheet's own value. */
function written(): TaskSheetFields {
  const s = open!.sheet;
  const v = (k: keyof TaskSheetFields) => open!.boxes[k]?.value ?? s.fields[k];
  return { title: v('title'), brief: v('brief'), deps: v('deps'), environment: v('environment'), labels: v('labels'), notes: v('notes') };
}

/** Why the primary button is off, or null when it's on: the same check as the extension's taskSheetOff. */
const goOff = (): string | null => (written().title.trim() ? null : 'A task needs a title');

/** A field: its label, the box, and a line under it in muted type. */
function field(label: string, box: HTMLElement, hint: string | null): HTMLElement {
  const id = `ts-box-${++ids}`;
  box.id = id;
  const l = el('label', 'ts-label', label);
  l.setAttribute('for', id);
  return el('div', 'ts-field', l, box, hint ? el('p', 'ts-hint muted', hint) : null);
}

/** A one-line box, or one of several lines. */
function box(key: keyof TaskSheetFields, value: string, placeholder: string, lines = 0): HTMLInputElement | HTMLTextAreaElement {
  const b = lines ? document.createElement('textarea') : document.createElement('input');
  if (b instanceof HTMLTextAreaElement) b.rows = lines;
  else b.type = 'text';
  b.className = lines ? 'ts-box ts-text' : 'ts-box';
  b.value = value;
  b.placeholder = placeholder;
  b.spellcheck = key === 'brief' || key === 'notes' || key === 'title';
  b.addEventListener('input', foot);
  open!.boxes[key] = b;
  return b;
}

/** A field its ticket owns: its value as text, which can't be changed here. */
function kept(label: string, value: string): HTMLElement {
  return el('div', 'ts-field', el('p', 'ts-label', label), el('p', `ts-kept${value ? '' : ' muted'}`, value || 'None'));
}

/** Draws the sheet from what it shows. */
function draw(): void {
  if (!open || !parts) return;
  const s = open.sheet;
  parts.heading.textContent = s.heading;
  parts.dialog.setAttribute('aria-label', s.heading);
  open.boxes = {};
  const env = document.createElement('select');
  env.className = 'ts-box ts-select';
  for (const e of s.environments) {
    const o = document.createElement('option');
    o.value = e.value;
    o.textContent = e.label;
    o.selected = e.value === s.fields.environment;
    env.append(o);
  }
  open.boxes.environment = env;
  const locked = s.locked
    ? el('div', 'ts-locked', el('p', 'ts-locked-why', icon('lock'), el('span', '', s.locked)),
      s.ticket ? button(s.ticket.label, 'link-external', () => api.postMessage({ type: 'open', url: s.ticket!.url }), 'ghost ts-ticket') : null)
    : null;
  parts.body.replaceChildren(...[
    locked,
    s.locked ? kept('Title', s.fields.title) : field('Title', box('title', s.fields.title, 'What needs doing'), null),
    s.locked ? kept('Description', s.fields.brief) : field('Description', box('brief', s.fields.brief, 'The goal, what to build, and how a person will know it is done', 8), 'Markdown works here: headings, lists and code.'),
    s.locked ? kept('Dependencies', s.fields.deps) : field('Dependencies', box('deps', s.fields.deps, 'Such as T-3, ACME-12'), 'The tasks to finish first, with commas between them.'),
    field('Environment', env, 'The branch it builds from and lands on.'),
    s.locked ? kept('Labels', s.fields.labels) : field('Labels', box('labels', s.fields.labels, 'Such as ui, docs'), 'With commas between them.'),
    s.notes ? field('Notes for the builder', box('notes', s.fields.notes, 'What the builder should know that the description doesn\'t say', 4), 'The builder and the reviewer read these under their own heading.') : null,
  ].filter((x): x is HTMLElement => !!x));
  foot();
}

/** The primary button's label, and whether it's off, with why. */
function foot(): void {
  if (!open || !parts) return;
  const why = goOff();
  parts.go.replaceChildren(icon(open.sheet.task ? 'save' : 'add'), open.sheet.go);
  parts.go.disabled = !!why;
  parts.go.title = why ?? `${open.sheet.go} (Enter)`;
}

/** Add task or Save: what was written goes to the extension, and the sheet closes. Nothing goes while it's off. */
function save(): void {
  if (!open || goOff()) return;
  const s = open.sheet;
  api.postMessage({ type: 'task-sheet-go', project: s.project, ...(s.task ? { task: s.task } : {}), ...written() });
  shut();
}

function make(): NonNullable<typeof parts> {
  const heading = el('h2', 'ts-heading');
  const m = makeModal('task-sheet', [heading], shut);
  const cancel = button('Cancel', 'close', () => shut(), 'ts-cancel');
  cancel.title = 'Cancel (Escape)';
  const go = button('Save', 'save', () => save(), 'primary ts-go');
  m.dialog.append(el('div', 'ts-foot', cancel, go));
  // Enter in a one-line box saves; in a box of several lines it's a new line, and Cmd+Enter or Ctrl+Enter saves.
  m.dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.defaultPrevented || e.target === cancel || (e.target as HTMLElement).matches?.('button')) return;
    if (e.target instanceof HTMLTextAreaElement && !e.metaKey && !e.ctrlKey) return;
    e.preventDefault();
    save();
  });
  m.dialog.addEventListener('close', () => { if (open) closed(); });
  return { dialog: m.dialog, heading, body: m.body, go };
}

/** Opens the sheet; open already, it shows this one. Focus goes to the first box that can change. */
function openSheet(sheet: TaskSheet): void {
  parts ??= make();
  if (!parts.dialog.open) opener = focusedElement();
  open = { sheet, boxes: {} };
  draw();
  if (!parts.dialog.open) parts.dialog.showModal();
  (open.boxes.title ?? open.boxes.environment)?.focus();
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
  receive: { 'task-sheet': (msg: { sheet?: TaskSheet }) => { if (msg.sheet?.fields) openSheet(msg.sheet); } },
};
