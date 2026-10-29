// The task sheet (T-74): the extension's task-sheet message opens it over the page, a task's tab or the
// Command Center, in the page's modal (modal.ts), as Dispatch's sheet opens (D-168). It writes a new task,
// or edits one: a title, a description of several lines in Markdown, its dependencies, environment and
// labels, and for a task already there, notes for the builder. A tracker's task shows what its ticket owns
// read-only, with why and a way to open the ticket. Enter in a one-line box saves, and so do Cmd+Enter and
// Ctrl+Enter anywhere; Escape cancels; focus goes back to what opened it. Save sends what was written, and
// the extension works out acc's arguments. Where the project allows edits (T-80), a tracker's task has its
// ticket's title and description to edit, and its status, assignee and labels each with a Change. Its Save
// waits for the extension: a ticket changed since the sheet opened shows both versions to pick from, and a
// failed write says why. Either way the sheet stays open with what the person wrote. There, its description
// can take drafted acceptance criteria (T-81): Draft acceptance criteria puts the draft below its text.
// A new task's description, and acc's own task's, shows each wording finding beside its acceptance criterion
// as the person writes (T-148): the page asks the extension, which runs the check acc add and acc edit run.

import type { SheetWording } from '../src/model/sheet-wording.ts';
import type { TaskSheet, TaskSheetFields } from '../src/model/task-sheet.ts';
import type { SheetRow, TicketTextBase } from '../src/model/ticket-text.ts';
import { button, el, focusedElement, icon, plural } from './dom.ts';
import { makeModal } from './modal.ts';
import { api, type PageArea } from './state.ts';

/**
 * The open sheet: what it shows, and its boxes. Where Save writes the ticket's text (T-80): the text it
 * checks the ticket against, which Use theirs and Keep mine move on; whether a Save is on its way; why the
 * last Save or Change didn't go; the ticket's text when someone changed it after the sheet opened; and the
 * Change on its way.
 */
let open: {
  sheet: TaskSheet;
  boxes: Partial<Record<keyof TaskSheetFields, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>>;
  base: TicketTextBase | null;
  saving: boolean;
  error: string | null;
  theirs: TicketTextBase | null;
  changing: SheetRow['field'] | null;
  /** Drafting acceptance criteria for its description (T-81): on its way, and whether a draft is in the box. */
  drafting: boolean;
  added: boolean;
  /** The wording findings on its acceptance criteria (T-148), for the description they were found on. Null: not checked. */
  wording: SheetWording | null;
  /** Where the findings are drawn, updated in place so the box keeps its focus and caret. */
  wordingAt: HTMLElement | null;
} | null = null;
/** The wait after a key before the sheet asks for the wording check again. */
const WORDING_WAIT_MS = 250;
let wordingTimer: ReturnType<typeof setTimeout> | undefined;
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

/**
 * Why the primary button is off, or null when it's on: the same check as the extension's taskSheetOff,
 * and, where Save writes the ticket's text (T-80), not while a Save is on its way or a version is to pick.
 * A hard wording finding on its acceptance criteria keeps it off until the next check finds none (T-148), as
 * the extension's wordingOff says, once the description is changed: acc edit doesn't check one left as it was.
 */
const goOff = (): string | null => (open?.saving ? 'Saving to its ticket' : open?.theirs ? 'Pick a version first' : !written().title.trim() ? 'A task needs a title'
  : open?.wording?.hard && briefChanged() ? `Fix the wording of the acceptance criteria first: ${plural(open.wording.hard, 'finding')}` : null);

/** Whether the description differs from the one the sheet opened with: a new task's always does once written. */
const briefChanged = (): boolean => !!open && written().brief !== open.sheet.fields.brief;

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
  if (key === 'brief' && open!.wording) b.addEventListener('input', askWording);
  open!.boxes[key] = b;
  return b;
}

/** A field its ticket owns: its value as text, which can't be changed here. */
function kept(label: string, value: string): HTMLElement {
  return el('div', 'ts-field', el('p', 'ts-label', label), el('p', `ts-kept${value ? '' : ' muted'}`, value || 'None'));
}

/** A line in orange, with its icon: why a Save or a Change didn't go (T-80). */
const trouble = (text: string): HTMLElement => el('div', 'notice attention', icon('warning', 'orange'), el('span', '', text));

/** The ticket's status, assignee and labels (T-80), each with a Change that asks as the ticket page's does. One Change at a time. */
function rows(r: SheetRow[]): HTMLElement[] {
  return r.map((row) => {
    const busy = open!.changing === row.field;
    const b = button(busy ? 'Changing…' : 'Change', busy ? 'loading~spin' : 'edit', () => change(row.field), 'ghost small ts-change');
    b.setAttribute('aria-label', row.change);
    b.title = row.change;
    b.disabled = !!open!.changing;
    return el('div', 'ts-field', el('p', 'ts-label', row.label), el('div', 'ts-row', el('p', 'ts-kept', row.value), b));
  });
}

/** Change on one of the ticket's fields: the extension asks, and gives the rows back as the ticket has them. */
function change(f: SheetRow['field']): void {
  if (!open?.sheet.task || open.changing) return;
  open.changing = f;
  open.error = null;
  api.postMessage({ type: 'task-sheet-field', project: open.sheet.project, task: open.sheet.task, field: f });
  redraw();
}

/** The tracker's name, from the sheet's Open in button: "Jira". */
const trackerWord = (): string => open?.sheet.ticket?.label.replace(/^Open in /, '') ?? 'its tracker';

/**
 * The ticket's text changed after the sheet opened (T-80): what's on the ticket now beside what the person
 * wrote, and the choice. Use theirs puts the ticket's text in the boxes; Keep mine saves the person's over it.
 */
function choice(theirs: TicketTextBase): HTMLElement {
  const mine = written();
  const version = (heading: string, t: TicketTextBase) => el('div', 'ts-version', el('p', 'ts-label', heading), el('p', 'ts-kept', t.title),
    el('p', `ts-kept${t.markdown.trim() ? '' : ' muted'}`, t.markdown.trim() || 'No description'));
  return el('div', 'ts-conflict',
    trouble(`Someone changed this ticket in ${trackerWord()} after you opened it, so nothing was saved. Pick the version to keep.`),
    el('div', 'ts-versions', version(`In ${trackerWord()} now`, theirs), version('What you wrote', { title: mine.title, markdown: mine.brief })),
    el('div', 'ts-pick', button('Use theirs', 'discard', () => useTheirs()), button('Keep mine', 'save', () => keepMine(), 'primary')));
}

/** Use theirs: the ticket's text goes in the boxes, and Save checks against it from now on. */
function useTheirs(): void {
  if (!open?.theirs) return;
  const t = open.theirs;
  open.sheet = { ...open.sheet, fields: { ...written(), title: t.title, brief: t.markdown } };
  open.base = t;
  open.theirs = null;
  draw();
  open.boxes.title?.focus();
}

/** Keep mine: the person's text is saved over the ticket's, checked against the ticket's text as it was just read. */
function keepMine(): void {
  if (!open?.theirs) return;
  open.base = open.theirs;
  open.theirs = null;
  save();
}

/**
 * A description with drafted acceptance criteria below its text (T-81). The page can't import core's
 * withCriteria, so this is its copy; the section comes from the extension with its heading.
 */
const below = (text: string, section: string): string => (text.trim() ? `${text.trimEnd()}\n\n${section}` : section);

/** The draft goes in the description box, below what's written, and the box takes focus. */
function addDraft(section: string): void {
  if (!open) return;
  open.sheet = { ...open.sheet, fields: { ...written(), brief: below(written().brief, section) } };
  open.added = true;
  draw();
  open.boxes.brief?.focus();
}

/** Draft acceptance criteria from the sheet: the extension drafts, and gives the draft back for the box. */
function draftCriteria(): void {
  if (!open?.sheet.task || open.drafting) return;
  open.drafting = true;
  open.error = null;
  api.postMessage({ type: 'task-sheet-criteria', project: open.sheet.project, task: open.sheet.task });
  redraw();
}

/** The line under the description where the sheet drafts acceptance criteria (T-81), or adds the stored draft. */
function criteriaRow(): HTMLElement | null {
  const c = open?.sheet.criteria;
  if (!open || !c) return null;
  const busy = open.drafting || c.drafting;
  const draft = button(busy ? 'Drafting…' : c.section ? 'Draft again' : 'Draft acceptance criteria', busy ? 'loading~spin' : 'sparkle', () => draftCriteria(), 'ghost small');
  draft.disabled = busy;
  if (busy) draft.title = 'An agent is reading the ticket, its comments and the code. It changes nothing.';
  const add = c.section && !open.added ? button('Add the draft', 'add', () => addDraft(c.section!), 'ghost small') : null;
  const said = open.added || open.sheet.drafted ? 'The draft is below your text, under its own heading. Edit it: nothing reaches the ticket until you save.'
    : busy ? 'An agent is reading the ticket, its comments and the code. The draft goes below your text.'
      : 'An agent can draft acceptance criteria, test steps and edge cases for you to edit.';
  return el('div', 'ts-field', el('div', 'ts-row', el('p', 'ts-hint muted', said), add, draft));
}

/** A moment after the description changes, the extension checks its acceptance criteria again. */
function askWording(): void {
  clearTimeout(wordingTimer);
  wordingTimer = setTimeout(() => {
    if (open?.wording) api.postMessage({ type: 'task-sheet-wording', project: open.sheet.project, brief: written().brief });
  }, WORDING_WAIT_MS);
}

/**
 * The findings beside each acceptance criterion (T-148): a line that says how many, then each criterion with
 * its line and text, and each finding's rule and fix under it. A hard finding is orange, with its warning
 * icon; advice is blue, with its info icon. A description with no criteria shows nothing.
 */
function wordingParts(w: SheetWording): HTMLElement[] {
  if (!w.checked) return [];
  if (!w.criteria.length) return [el('p', 'ts-hint muted', icon('check'), ` ${plural(w.checked, 'acceptance criterion', 'acceptance criteria')} ${w.checked === 1 ? 'passes' : 'pass'} the wording check.`)];
  const advice = w.criteria.reduce((n, c) => n + c.findings.length, 0) - w.hard;
  const head = w.hard
    ? el('p', 'ts-wording-head', icon('warning', 'orange'), ` Wording: ${plural(w.hard, 'finding')} to fix${briefChanged() ? ' before you save' : ', once you change the description'}${advice ? `, and ${plural(advice, 'piece')} of advice` : ''}.`)
    : el('p', 'ts-wording-head', icon('info', 'blue'), ` Wording: ${plural(advice, 'piece')} of advice. It doesn't stop Save.`);
  return [head, ...w.criteria.map((c) => el('div', 'ts-wording-item',
    el('p', 'ts-wording-place', `Criterion ${c.criterion}, line ${c.line}`),
    el('p', 'ts-wording-text', c.text),
    ...c.findings.map((f) => el('p', 'ts-wording-finding', icon(f.hard ? 'warning' : 'info', f.hard ? 'orange' : 'blue'),
      el('span', '', el('strong', '', f.hard ? f.rule : `Advice: ${f.rule}`), ` ${f.message}`, f.match ? el('span', 'muted', ` [${f.match}]`) : null)))))];
}

/** Draws the findings where they go, without drawing the boxes again, and Save's state with them. */
function drawWording(): void {
  if (!open?.wordingAt || !open.wording) return;
  open.wordingAt.replaceChildren(...wordingParts(open.wording));
  foot();
}

/** The extension's check of the description (T-148): only for this sheet's project, and the text in the box now. */
function worded(msg: { project?: string; wording?: SheetWording }): void {
  if (!open?.wording || msg.project !== open.sheet.project || !msg.wording || msg.wording.brief !== written().brief) return;
  open.wording = msg.wording;
  drawWording();
}

/** Draws again with what's written kept: a draw starts from the sheet's own fields. */
function redraw(): void {
  if (!open) return;
  open.sheet = { ...open.sheet, fields: written() };
  draw();
}

/** The place for the wording findings, under the description, which a screen reader reads as they change. */
function wordingBox(): HTMLElement | null {
  if (!open) return null;
  open.wordingAt = null;
  if (!open.wording) return null;
  const at = el('div', 'ts-wording');
  at.setAttribute('aria-live', 'polite');
  open.wordingAt = at;
  at.replaceChildren(...wordingParts(open.wording));
  return at;
}

/** Draws the sheet from what it shows. */
function draw(): void {
  if (!open || !parts) return;
  const s = open.sheet;
  // Where Save writes the ticket's text (T-80), the title and description are boxes, though its ticket owns them.
  const text = !s.locked || !!open.base;
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
    open.theirs ? choice(open.theirs) : null,
    open.error ? trouble(open.error) : null,
    text ? field('Title', box('title', s.fields.title, 'What needs doing'), null) : kept('Title', s.fields.title),
    text && s.ticketEdits?.unkept ? trouble(s.ticketEdits.unkept) : null,
    text && s.ticketEdits?.unkept ? kept('Description', s.fields.brief) : text ? field('Description', box('brief', s.fields.brief, 'The goal, what to build, and how a person will know it is done', 8), open.base ? `Markdown works here. Save writes it to the ticket in ${trackerWord()}.` : open.wording ? 'Markdown works here. Each item under an Acceptance criteria heading gets a wording check.' : 'Markdown works here: headings, lists and code.') : kept('Description', s.fields.brief),
    text && !s.ticketEdits?.unkept ? criteriaRow() : null,
    wordingBox(),
    s.locked ? kept('Dependencies', s.fields.deps) : field('Dependencies', box('deps', s.fields.deps, 'Such as T-3, ACME-12'), 'The tasks to finish first, with commas between them.'),
    field('Environment', env, 'The branch it builds from and lands on.'),
    ...(s.ticketEdits ? rows(s.ticketEdits.rows) : [s.locked ? kept('Labels', s.fields.labels) : field('Labels', box('labels', s.fields.labels, 'Such as ui, docs'), 'With commas between them.')]),
    s.notes ? field('Notes for the builder', box('notes', s.fields.notes, 'What the builder should know that the description doesn\'t say', 4), 'The builder and the reviewer read these under their own heading.') : null,
  ].filter((x): x is HTMLElement => !!x));
  foot();
}

/** The primary button's label, and whether it's off, with why. */
function foot(): void {
  if (!open || !parts) return;
  const why = goOff();
  parts.go.replaceChildren(icon(open.saving ? 'loading~spin' : open.sheet.task ? 'save' : 'add'), open.saving ? 'Saving…' : open.sheet.go);
  parts.go.disabled = !!why;
  parts.go.title = why ?? `${open.sheet.go} (Enter)`;
}

/**
 * Add task or Save: what was written goes to the extension, and the sheet closes. Nothing goes while it's
 * off. Where Save writes the ticket's text (T-80), it sends the text it checks the ticket against, and the
 * sheet stays open, with what was written, until the extension says how it went.
 */
function save(): void {
  if (!open || goOff()) return;
  const s = open.sheet;
  api.postMessage({ type: 'task-sheet-go', project: s.project, ...(s.task ? { task: s.task } : {}), ...written(), ...(open.base ? { base: open.base } : {}) });
  if (!open.base) return shut();
  open.saving = true;
  open.error = null;
  redraw();
}

/**
 * How a Save went (T-80): done closes the sheet; a change made meanwhile shows both versions; a failure
 * says why. What was written stays. Only a reply for this sheet's task counts, and done or a failure only
 * while its Save is on its way; the ticket's text changed meanwhile shows whenever it comes.
 */
function saved(msg: { project?: string; task?: string | null; ok?: boolean; error?: string; conflict?: TicketTextBase }): void {
  if (!open || msg.project !== open.sheet.project || (msg.task ?? null) !== open.sheet.task || !open.base || (!open.saving && !msg.conflict)) return;
  if (msg.ok) return shut();
  open.saving = false;
  open.theirs = msg.conflict ?? null;
  open.error = msg.conflict ? null : msg.error || 'It wasn\'t saved.';
  redraw();
}

/** How a Change went (T-80): the ticket's fields as they are now, or why it didn't go. */
function changed(msg: { project?: string; task?: string; ok?: boolean; error?: string; rows?: SheetRow[] }): void {
  if (!open?.changing || !open.sheet.ticketEdits || msg.project !== open.sheet.project || msg.task !== open.sheet.task) return;
  open.changing = null;
  open.error = msg.ok ? null : msg.error || 'It didn\'t change.';
  if (msg.ok && msg.rows) open.sheet = { ...open.sheet, ticketEdits: { ...open.sheet.ticketEdits, rows: msg.rows } };
  redraw();
}

/**
 * How the sheet's drafting went (T-81): on its way; the draft, which goes below the description's text; or
 * why not. Only a reply for this sheet's task counts.
 */
function drafted(msg: { project?: string; task?: string; drafting?: boolean; ok?: boolean; section?: string; error?: string }): void {
  if (!open?.sheet.criteria || msg.project !== open.sheet.project || msg.task?.toUpperCase() !== open.sheet.task) return;
  if (msg.drafting) {
    open.drafting = true;
    return redraw();
  }
  open.drafting = false;
  if (msg.ok && msg.section) {
    open.sheet = { ...open.sheet, criteria: { ...open.sheet.criteria, section: msg.section, drafting: false } };
    return addDraft(msg.section);
  }
  open.error = msg.error || 'The draft didn\'t come back.';
  redraw();
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
  open = { sheet, boxes: {}, base: sheet.ticketEdits?.base ?? null, saving: false, error: null, theirs: null, changing: null, drafting: !!sheet.criteria?.drafting, added: !!sheet.drafted, wording: sheet.wording ?? null, wordingAt: null };
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
  clearTimeout(wordingTimer);
  open = null;
  parts?.body.replaceChildren();
  const o = opener;
  opener = null;
  if (o?.isConnected) o.focus({ preventScroll: true });
}

export const area: PageArea = {
  receive: {
    'task-sheet': (msg: { sheet?: TaskSheet }) => { if (msg.sheet?.fields) openSheet(msg.sheet); },
    'task-sheet-done': saved,
    'task-sheet-rows': changed,
    'task-sheet-draft': drafted,
    'task-sheet-wording': worded,
  },
};
