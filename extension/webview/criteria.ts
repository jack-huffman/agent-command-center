// A task's drafted acceptance criteria (T-81): Draft acceptance criteria, then the draft with its two ways
// out, Add to the description and Open as an update. Each button asks the extension, and shows it's on its
// way until the extension says how it went; a refusal shows why, beside the buttons.

import type { TicketCriteria, CriteriaButton } from '../src/model/criteria.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { button, el, foldable, icon, renderDoc, status, when } from './dom.ts';
import { api, type PageArea, state } from './state.ts';

type Ask = 'criteria-draft' | 'criteria-update' | 'criteria-sheet';

/** What's on its way, by project and task, and why the last one didn't go. */
const asked = new Map<string, Ask>();
const failed = new Map<string, string>();
const keyOf = (project: string, task: string): string => `${project}#${task.toUpperCase()}`;

function ask(m: TicketModel, c: TicketCriteria, type: Ask): void {
  const key = keyOf(m.project, c.task);
  if (asked.has(key)) return;
  asked.set(key, type);
  failed.delete(key);
  api.postMessage({ type, project: m.project, task: c.task });
  if (state.last) state.draw(state.last);
}

/** A button of the section: off with why, or while another of its buttons is on its way. */
function action(m: TicketModel, c: TicketCriteria, b: CriteriaButton, type: Ask, iconName: string, primary: boolean): HTMLButtonElement {
  const busy = asked.get(keyOf(m.project, c.task));
  const label = busy === type ? (type === 'criteria-draft' ? 'Drafting…' : 'Opening…') : b.label;
  const x = button(label, busy === type ? 'loading~spin' : iconName, () => ask(m, c, type), primary ? 'primary' : '');
  const why = b.disabled ?? (busy ? 'Wait for the one on its way' : null);
  x.disabled = !!why;
  if (why) x.title = why;
  return x;
}

/** The section: its state, the draft, what it was drafted from, and its buttons. */
export function renderCriteria(m: TicketModel, c: TicketCriteria): HTMLElement {
  const key = keyOf(m.project, c.task);
  const sec = el('section', `analysis criteria tone-edge-${c.look.tone}`,
    el('div', 'an-head', el('h2', '', 'Acceptance criteria draft'), status(c.look), c.wording ? status(c.wording) : null, el('span', 'spacer'), c.at ? when(c.at) : null));
  sec.setAttribute('aria-label', `Acceptance criteria draft: ${c.look.label}`);
  if (c.note) sec.append(el('p', 'muted an-note', c.note));
  if (c.body) sec.append(foldable(`criteria:${key}`, renderDoc(c.body, ''), null, 10));
  if (c.read) sec.append(el('p', 'muted an-note', c.read, ' Nothing is on the ticket until you save the description or post the update.'));
  const error = failed.get(key);
  if (error) sec.append(el('div', 'notice attention', icon('warning', 'orange'), el('span', '', error)));
  sec.append(el('div', 'actions an-actions',
    ...(c.sheet ? [action(m, c, c.sheet, 'criteria-sheet', 'edit', true)] : []),
    ...(c.update ? [action(m, c, c.update, 'criteria-update', 'comment-draft', false)] : []),
    action(m, c, c.draft, 'criteria-draft', c.body ? 'refresh' : 'sparkle', !c.body)));
  return sec;
}

/** How a button went: done redraws with what acc did; a refusal shows why, to try again. */
function done(msg: { action?: string; project?: string; task?: string; ok?: boolean; error?: string }): void {
  const key = keyOf(msg.project ?? '', msg.task ?? '');
  if (!asked.has(key)) return;
  asked.delete(key);
  if (msg.ok) failed.delete(key);
  else failed.set(key, msg.error?.trim() || 'It didn\'t go, and acc didn\'t say why.');
  if (state.last) state.draw(state.last);
}

export const area: PageArea = {
  receive: { 'criteria-done': done },
};
