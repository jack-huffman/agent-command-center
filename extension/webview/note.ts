// An agent's note to a person, drawn (T-146): its headline, then a bullet per thing, each option on its own line
// with the one it recommends marked, and API names as code. A long thing folds on its own, not the whole note.
// A note with no shape is its paragraph, under a fold as before. The task page's notice and History, the Agent
// panel and Needs you all draw a note through here.

import type { NoteItem, NoteOption } from '../../packages/core/src/agent-notes.ts';
import type { AgentNote } from '../src/logic/relayed.ts';
import { type Child, el, foldable, icon, md, rememberedFold } from './dom.ts';

/** A thing longer than this folds to its first two lines, with Show all under it. */
export const ITEM_FOLD = 160;

/** An option's words, without the "(recommended)" its mark says: the banner's choice (T-168) shows them too. */
export const optionWords = (o: NoteOption): string => (o.recommended ? o.text.replace(/\s*\(recommended\)/i, '').trim() : o.text);

/** One option, on its own line: its letter, its words, and Recommended with an icon where the agent picked it. */
function optionLine(o: NoteOption): HTMLElement {
  return el('li', `note-option${o.recommended ? ' is-recommended' : ''}`, el('span', 'note-letter', `${o.label})`),
    el('span', 'note-option-text', md(optionWords(o)), o.recommended ? el('span', 'note-rec', icon('star-full', 'blue'), 'Recommended') : null));
}

/** One thing: its words, folded on their own when long, then its options. */
function itemLine(item: NoteItem, key: string): HTMLElement {
  const words = item.text ? el('div', 'note-item-text', md(item.text)) : null;
  const text = words && item.text.length > ITEM_FOLD ? foldable(key, words, null, 2) : words;
  return el('li', 'note-item', text, item.options.length ? el('ol', 'note-options', ...item.options.map(optionLine)) : null);
}

/** The bullets of a note with a shape. */
export function noteItems(n: AgentNote, key: string): HTMLElement | null {
  const items = n.shape?.items ?? [];
  return items.length ? el('ul', 'note-items', ...items.map((it, i) => itemLine(it, `${key}#${i}`))) : null;
}

/**
 * A note, drawn: `lead` goes before its headline, such as "Why it's blocked:". With a shape, the headline and its
 * bullets; calm, as on the Overview, the bullets fold under a count, closed at first and remembered by `key`.
 * Without one, its paragraph, its first two lines and Show all. Keys are the tab's, as the page's other folds.
 */
export function drawNote(n: AgentNote, key: string, opts: { lead?: Child; calm?: boolean } = {}): HTMLElement {
  const items = noteItems(n, key);
  if (!n.shape) return foldable(key, el('div', 'note', el('div', 'note-para', opts.lead ?? null, md(n.text))), 'note-para', 2);
  const head = el('p', 'note-head', opts.lead ?? null, md(n.shape.headline));
  if (!items) return el('div', 'note', head);
  if (!opts.calm) return el('div', 'note', head, items);
  const count = n.shape.items.length;
  return el('div', 'note is-calm', head, rememberedFold('note-fold', `note-fold:${key}`, [el('span', '', count === 1 ? '1 point' : `${count} points`)], items));
}

/** A note's headline alone, on one line, cut with an ellipsis where there's no room: all of it on hover. */
export function noteHeadline(n: AgentNote, lead: Child = null): HTMLElement {
  const line = el('span', 'note-headline', lead, md(n.headline));
  line.title = n.headline.replace(/`/g, '');
  return line;
}
