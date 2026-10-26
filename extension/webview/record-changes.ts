// Record changes on a task's page (T-100): each change the plan lists and each one recorded, with who made it,
// when and whether it was planned; "Add a change made by hand", a form for what a person did in the org's own
// pages; and for each environment the work was promoted to, its steps, each with the commands that make it,
// Mark done, and Skip with a reason. Each button asks the extension, and shows it's on its way until the
// extension says how it went; a refusal shows why, beside the buttons.

import type { RecordForm, StepRow, TicketRecords } from '../src/model/record-changes.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { button, el, icon, linkTo, peekKey, status, when, work } from './dom.ts';
import { memory, type PageArea, remember, state } from './state.ts';
import { TicketAsks } from './ticket-asks.ts';

/** What the record-changes section has asked for, by task. */
const asks = new TicketAsks();

/**
 * The open form, and the step whose Skip is open, kept in the tab's memory with what's typed, so a redraw or a
 * hidden tab keeps them: by `records-form:` and `records-skip:` and the task's key.
 */
export const FORM_KEY = 'records-form:';
export const SKIP_KEY = 'records-skip:';
type Skip = { step: string; reason: string };
function kept<T>(prefix: string, key: string): T | null {
  try {
    const v = memory().drafts[prefix + key];
    return v ? JSON.parse(v) as T : null;
  } catch {
    return null;
  }
}
function keep(prefix: string, key: string, v: unknown): void {
  remember((m) => { if (v === null) delete m.drafts[prefix + key]; else m.drafts[prefix + key] = JSON.stringify(v); });
}

let ids = 0;
const redraw = (): void => { if (state.last) state.draw(state.last); };
const stepKey = (s: Pick<StepRow, 'change' | 'env'>): string => `${s.env}:${s.change}`;
/** Who made a change, as a person reads it: its builder, or the person's name. */
export const whoWords = (by: string): string => (by.startsWith('builder:') ? 'its builder' : by.replace(/^human:/, ''));
const textLines = (s: string): string[] => s.split('\n').map((l) => l.trim()).filter(Boolean);

function send(m: TicketModel, r: TicketRecords, what: string, msg: Record<string, unknown>): void {
  asks.ask(peekKey(m.project, r.task), what, { project: m.project, task: r.task, ...msg });
}

/** A field of the form: its label over its box, and a muted line under it. */
function field(label: string, box: HTMLElement, hint: string | null): HTMLElement {
  const id = `rc-box-${++ids}`;
  box.id = id;
  const l = el('label', 'ts-label', label);
  l.setAttribute('for', id);
  return el('div', 'ts-field', l, box, hint ? el('p', 'ts-hint muted', hint) : null);
}

/** A box of the form, kept in `f` as it's typed in. */
function box(page: string, f: RecordForm, key: 'object' | 'why' | 'match' | 'set', placeholder: string, lines = 0): HTMLInputElement | HTMLTextAreaElement {
  const b = lines ? document.createElement('textarea') : document.createElement('input');
  if (lines) (b as HTMLTextAreaElement).rows = lines;
  else (b as HTMLInputElement).type = 'text';
  b.className = lines ? 'ts-box ts-text' : 'ts-box';
  b.value = key === 'match' || key === 'set' ? f[key].join('\n') : f[key];
  b.placeholder = placeholder;
  b.spellcheck = key === 'why';
  b.addEventListener('input', () => {
    if (key === 'match' || key === 'set') f[key] = textLines(b.value);
    else f[key] = b.value;
    keep(FORM_KEY, page, f);
  });
  return b;
}

/** Why the form's Save is off, or null: it needs an object, a key, and a why. */
export const formOff = (f: RecordForm): string | null => (!f.object.trim() ? 'Name the object' : !f.match.length ? 'Say how to find the record' : !f.why.trim() ? 'Say why it was made' : f.action === 'update' && !f.set.length ? 'Say what it set' : null);

/** "Add a change made by hand": the object, what it did, how to find the record, what it set, and why. */
function form(m: TicketModel, r: TicketRecords, f: RecordForm): HTMLElement {
  const key = peekKey(m.project, r.task);
  const action = document.createElement('select');
  action.className = 'select-input ts-select';
  for (const [v, label] of [['update', 'Changed a record'], ['create', 'Created a record'], ['delete', 'Deleted a record']] as const) {
    const o = document.createElement('option');
    o.value = v;
    o.append(label);
    o.selected = f.action === v;
    action.append(o);
  }
  action.addEventListener('change', () => { f.action = action.value as RecordForm['action']; keep(FORM_KEY, key, f); redraw(); });
  const busy = asks.busy(key) === 'record-add';
  const save = button(busy ? 'Saving…' : 'Save the change', busy ? 'loading~spin' : 'save', () => {
    if (formOff(f)) return;
    send(m, r, 'record-add', { type: 'record-add', object: f.object.trim(), action: f.action, match: f.match, set: f.action === 'delete' ? [] : f.set, why: f.why.trim() });
  }, 'primary');
  const off = formOff(f) ?? (asks.busy(key) ? 'Wait for the one on its way' : null);
  save.disabled = !!off;
  if (off) save.title = off;
  const cancel = button('Cancel', 'close', () => { keep(FORM_KEY, key, null); redraw(); }, 'ghost');
  return el('div', 'rc-form',
    field('Object', box(key, f, 'object', 'Account'), 'Its API name, such as Account or Region__c.'),
    field('What you did', action, null),
    field('How to find it in any org', box(key, f, 'match', 'Name=Acme Corp', 2), 'One field=value a line: an external ID, a unique name, or fields that match one record. Never its record ID.'),
    f.action === 'delete' ? null : field('What it set', box(key, f, 'set', 'Name=Acme Corporation', 2), 'One field=value a line.'),
    field('Why', box(key, f, 'why', 'The brand changed'), 'Whoever makes it in the next org reads this.'),
    el('div', 'actions rc-form-foot', cancel, save));
}

/** One step: its state, the change, the commands, and while it's to do, Mark done and Skip. */
function step(m: TicketModel, r: TicketRecords, s: StepRow): HTMLElement {
  const key = peekKey(m.project, r.task);
  const skip = kept<Skip>(SKIP_KEY, key);
  const mine = skip?.step === stepKey(s);
  const busy = asks.busy(key) ? 'Wait for the one on its way' : null;
  // Its buttons go under its words, over the commands, so the commands keep the row's width at any size.
  let actions: HTMLElement | null = null;
  if (s.done && s.skip && !mine) {
    const done = button(asks.busy(key) === `done:${stepKey(s)}` ? 'Marking…' : s.done.label, 'check', () => send(m, r, `done:${stepKey(s)}`, { type: 'record-step', change: s.change, env: s.env, skip: null }), 'small');
    const sk = button(s.skip.label, 'debug-step-over', () => { keep(SKIP_KEY, key, { step: stepKey(s), reason: '' }); redraw(); }, 'ghost small');
    for (const b of [done, sk]) { b.disabled = !!busy; if (busy) b.title = busy; }
    actions = el('div', 'rc-step-actions', done, sk);
  }
  const body = el('div', 'vf-text',
    el('span', '', s.words),
    s.reason ? el('span', 'muted vf-sub', `Skipped: ${s.reason}`) : null,
    s.by && s.at ? el('span', 'muted vf-sub', `${s.look.label} by ${whoWords(s.by)} `, when(s.at)) : null,
    actions,
    s.script.length ? work(el('pre', 'rc-script', s.script.join('\n')), 'output') : null);
  const li = el('li', 'vf-row rc-step', status(s.look), body);
  if (mine) {
    const reason = document.createElement('input');
    reason.type = 'text';
    reason.className = 'ts-box';
    reason.value = skip.reason;
    reason.placeholder = 'Production already has it';
    const go = button(asks.busy(key) === `skip:${stepKey(s)}` ? 'Skipping…' : 'Skip it', 'debug-step-over', () => {
      if (!skip.reason.trim()) return;
      send(m, r, `skip:${stepKey(s)}`, { type: 'record-step', change: s.change, env: s.env, skip: skip.reason.trim() });
    }, 'small');
    const off = !skip.reason.trim() ? 'Say why it\'s skipped' : busy;
    go.disabled = !!off;
    if (off) go.title = off;
    reason.addEventListener('input', () => { skip.reason = reason.value; keep(SKIP_KEY, key, skip); go.disabled = !reason.value.trim() || !!busy; go.title = go.disabled ? (busy ?? 'Say why it\'s skipped') : ''; });
    const back = button('Cancel', 'close', () => { keep(SKIP_KEY, key, null); redraw(); }, 'ghost small');
    body.append(el('div', 'rc-skip', field('Why skip it', reason, null), el('div', 'rc-step-actions', back, go)));
  }
  return li;
}

/** The section: its state, each record change, the form, and each promotion's steps. */
export function renderRecords(m: TicketModel, r: TicketRecords): HTMLElement {
  const key = peekKey(m.project, r.task);
  const sec = el('section', `analysis records tone-edge-${r.look.tone}`, el('div', 'an-head', el('h2', '', 'Record changes'), status(r.look)));
  sec.setAttribute('aria-label', `Record changes: ${r.look.label}`);
  if (r.note) sec.append(el('p', 'muted an-note', r.note));
  if (r.rows.length) {
    sec.append(el('ul', 'vf-list', ...r.rows.map((x) => el('li', 'vf-row', status(x.look), el('div', 'vf-text',
      el('span', '', x.words),
      x.why ? el('span', 'muted vf-sub', `Why: ${x.why}`) : null,
      x.refused ? el('span', 'vf-sub rc-refused', icon('warning', 'orange'), ` ${x.refused}`) : null,
      x.by && x.at ? el('span', 'muted vf-sub', `By ${whoWords(x.by)} `, when(x.at)) : null)))));
  }
  for (const p of r.promotions) {
    sec.append(el('div', 'rc-promotion',
      el('h3', 'vf-h rc-env', `Promoted to ${p.name}`, p.pr ? linkTo(p.pr.url, `#${p.pr.number}`) : null, p.left ? status(p.left) : null),
      el('p', 'muted vf-sub', 'Git doesn\'t carry these. Make each one in the org, then mark it. Nothing makes them by itself.'),
      el('ul', 'vf-list', ...p.steps.map((s) => step(m, r, s)))));
  }
  const error = asks.error(key);
  if (error) sec.append(el('div', 'notice attention', icon('warning', 'orange'), el('span', '', error)));
  const f = kept<RecordForm>(FORM_KEY, key);
  if (f) sec.append(form(m, r, f));
  else {
    const add = button(r.add.label, 'add', () => { keep(FORM_KEY, key, { object: '', action: 'update', match: [], set: [], why: '' }); redraw(); }, 'ghost');
    if (r.add.disabled) { add.disabled = true; add.title = r.add.disabled; }
    sec.append(el('div', 'actions an-actions', add));
  }
  return sec;
}

/** How a button went: done closes its form and redraws with what acc kept; a refusal shows why, to try again. */
function done(msg: { action?: string; project?: string; task?: string; ok?: boolean; error?: string }): void {
  asks.done(msg, (key) => keep(msg.action === 'record-add' ? FORM_KEY : SKIP_KEY, key, null));
}

export const area: PageArea = {
  receive: { 'records-done': done },
};
