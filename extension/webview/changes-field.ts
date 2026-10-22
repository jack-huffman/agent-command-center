// A tracker's changes field (T-105). In Settings' Trackers and on the Connect page: the field a ticket's changes
// are kept in, with Choose… or Change…. On a ticket's page, under its Changes: what the ticket's field says now,
// and whether it says what the Command Center found. Its new text is a draft update, drawn with the ticket's
// other drafts (updates.ts), whose Save to the ticket is the one thing that writes the field.

import type { ChangesFieldRow, TicketField } from '../src/model/changes-field.ts';
import { el, icon, renderDoc, settingsButton, status, work } from './dom.ts';

/** The setting's value: what's chosen, or why it can't be, and its button. */
export function changesFieldValue(r: ChangesFieldRow): HTMLElement {
  return el('div', 'settings-state', status(r.look), settingsButton(r.action));
}

/** The Connect page's row, after its place (T-105): the label, then the value and its button, as the page's other rows. */
export function changesFieldConnect(r: ChangesFieldRow): HTMLElement {
  return el('div', 'cfield', el('span', 'cfield-label', r.label), el('div', 'cfield-control', changesFieldValue(r)));
}

/** The section: what the ticket's field says, and how it compares with what the Command Center found. */
export function renderField(f: TicketField): HTMLElement {
  const sec = el('section', `analysis changes-field tone-edge-${f.look.tone}`, el('div', 'an-head', el('h2', '', f.heading), status(f.look)));
  sec.setAttribute('aria-label', `${f.heading}: ${f.look.label}`);
  if (f.note) sec.append(el('p', 'muted an-note', f.note));
  if (f.error) sec.append(el('div', 'notice attention', icon('warning', 'orange'), el('span', '', f.error)));
  if (f.doc) sec.append(work(renderDoc(f.doc, ''), 'files'));
  return sec;
}
