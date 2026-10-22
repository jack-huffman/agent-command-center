// A tracker's changes field (T-105). In Settings' Trackers and on the Connect page: the field a ticket's changes
// are kept in, with Choose… or Change…. On a ticket's page, under its Changes: what the ticket's field says now,
// whether it says what the Command Center found, and where it doesn't, the Command Center's draft of its new text
// in a box to edit, with Save to the ticket. The edit stays in the tab's memory until it's saved; nothing reaches
// the ticket before that.

import type { ChangesFieldRow, TicketField } from '../src/model/changes-field.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { button, el, icon, peekKey, renderDoc, settingsButton, status, work } from './dom.ts';
import { api, memory, type PageArea, remember, state } from './state.ts';

/** The setting's value: what's chosen, or why it can't be, and its button. */
export function changesFieldValue(r: ChangesFieldRow): HTMLElement {
  return el('div', 'settings-state', status(r.look), settingsButton(r.action));
}

/** The Connect page's row, after its place (T-105): the label, then the value and its button, as the page's other rows. */
export function changesFieldConnect(r: ChangesFieldRow): HTMLElement {
  return el('div', 'cfield', el('span', 'cfield-label', r.label), el('div', 'cfield-control', changesFieldValue(r)));
}

/** Where a person's edit of a draft is kept in the tab's memory, by the task's key. */
export const FIELD_EDIT_KEY = 'changes-field:';

/** Saves on their way, by project and task, and why the last one didn't go. */
const saving = new Set<string>();
const failed = new Map<string, string>();
const redraw = (): void => { if (state.last) state.draw(state.last); };

/** The draft: its title, the box with the person's edit or the Command Center's text, and Save to the ticket. */
function draftBox(m: TicketModel, f: TicketField): HTMLElement {
  const d = f.draft!;
  const key = peekKey(m.project, f.task);
  const held = memory().drafts[FIELD_EDIT_KEY + key];
  const box = el('textarea', 'comment-box act-draft-text') as HTMLTextAreaElement;
  box.value = held ?? d.text;
  box.rows = 6;
  box.maxLength = 65_536;
  box.spellcheck = false;
  box.setAttribute('aria-label', d.title);
  const fit = () => { box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight + 2, 420)}px`; };
  requestAnimationFrame(fit);
  const busy = saving.has(key);
  const save = button(busy ? 'Saving…' : d.save.label, busy ? 'loading~spin' : 'save', () => {
    if (!box.value.trim() || saving.has(key)) return;
    saving.add(key);
    failed.delete(key);
    api.postMessage({ type: 'changes-field-save', project: m.project, task: f.task, text: box.value, before: d.replaces });
    redraw();
  }, 'primary');
  const off = d.save.disabled ?? (busy ? 'Wait for the one on its way' : null);
  save.disabled = !!off || !box.value.trim();
  if (off) save.title = off;
  const reset = button('Use the drafted text', 'discard', () => { remember((x) => { delete x.drafts[FIELD_EDIT_KEY + key]; }); redraw(); }, 'ghost');
  reset.disabled = held === undefined || busy;
  box.disabled = busy;
  box.addEventListener('input', () => {
    fit();
    const edited = box.value.trim() !== d.text.trim();
    remember((x) => { if (edited) x.drafts[FIELD_EDIT_KEY + key] = box.value; else delete x.drafts[FIELD_EDIT_KEY + key]; });
    reset.disabled = !edited;
    save.disabled = !!off || !box.value.trim();
  });
  const why = d.save.disabled ? el('span', 'acting draft-blocked', icon('warning'), d.save.disabled) : el('span', 'acting', icon('info'), 'Nothing is written to the ticket until you save.');
  const error = failed.get(key);
  const box2 = el('div', `act-draft tone-edge-${d.look.tone}`,
    el('div', 'act-draft-head', status(d.look), el('span', 'strong', d.title)),
    el('p', 'muted small', d.replaces ? 'It replaces what the ticket says now, above.' : 'The field is empty on the ticket, so this is its first text.'),
    el('div', 'act-draft-edit', box, el('div', 'composer-bar', why, el('span', 'spacer'), reset, save)),
    error ? el('div', 'notice attention', icon('warning', 'orange'), el('span', '', error)) : null);
  box2.setAttribute('role', 'group');
  box2.setAttribute('aria-label', `${d.title}: a draft, not saved`);
  return box2;
}

/** The section: what the ticket's field says, how it compares, and the draft where it differs. */
export function renderField(m: TicketModel, f: TicketField): HTMLElement {
  const sec = el('section', `analysis changes-field tone-edge-${f.look.tone}`, el('div', 'an-head', el('h2', '', f.heading), status(f.look)));
  sec.setAttribute('aria-label', `${f.heading}: ${f.look.label}`);
  if (f.note) sec.append(el('p', 'muted an-note', f.note));
  if (f.error) sec.append(el('div', 'notice attention', icon('warning', 'orange'), el('span', '', f.error)));
  if (f.doc) sec.append(work(renderDoc(f.doc, ''), 'files'));
  if (f.draft) sec.append(draftBox(m, f));
  return sec;
}

/** How a save went: saved, the edit goes and the page shows what the ticket says now; refused, why, with the edit kept. */
function saved(msg: { project?: string; task?: string; ok?: boolean; error?: string }): void {
  const key = peekKey(msg.project ?? '', msg.task ?? '');
  if (!saving.has(key)) return;
  saving.delete(key);
  if (msg.ok) {
    failed.delete(key);
    remember((x) => { delete x.drafts[FIELD_EDIT_KEY + key]; });
  } else failed.set(key, msg.error?.trim() || 'It wasn\'t saved, and the Command Center didn\'t say why.');
  redraw();
}

export const area: PageArea = {
  receive: { 'changes-field-saved': saved },
};
