// A Settings row's explanation (T-40): one short sentence stays in view; a longer one folds under "What this
// means", closed at first, and the tab remembers each one opened as the page redraws.

import { el, icon } from './dom.ts';
import { foldsMeaning, meaningKey } from './settings-guide.ts';
import { memory, remember } from './state.ts';

export function whatThisMeans(id: string, text: string): HTMLElement | null {
  if (!text) return null;
  if (!foldsMeaning(text)) return el('p', 'muted small settings-meaning', text);
  const key = meaningKey(id);
  const d = el('details', 'settings-fold', el('summary', 'muted small', el('span', 'tool-chev', icon('chevron-right')), el('span', '', 'What this means')),
    el('p', 'muted small settings-meaning', text)) as HTMLDetailsElement;
  d.dataset.fold = id;
  d.open = memory().opened.includes(key);
  d.addEventListener('toggle', () => remember((x) => { x.opened = d.open ? [...new Set([...x.opened, key])].slice(-200) : x.opened.filter((y) => y !== key); }));
  return d;
}
