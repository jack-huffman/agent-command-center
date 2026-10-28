// A Command Center section on a task page, and the side column's Details and Agent panels, fold to their header line (T-132): its name in a button with a
// chevron, its state chip and a one-line summary stay; the rest hides. Each starts open, and the tab remembers
// each one a person collapsed, per ticket and per section, as foldable remembers what it opened.

import { el, icon } from './dom.ts';
import { memory, remember } from './state.ts';

/** The key the tab remembers a collapsed section by: one per section of one ticket. */
export const sectionKey = (id: string, project: string, key: string): string => `section:${id}:${project}#${key}`;

/** "3 criteria", "1 criterion", or null with none, so a collapsed section shows only its state then. */
export const criteriaSummary = (n: number | null): string | null => (n ? `${n} ${n === 1 ? 'criterion' : 'criteria'}` : null);

/** The first line of some words, its Markdown marks taken out: a summary has one line. Null for none. */
export function oneLine(text: string | null | undefined): string | null {
  const line = (text ?? '').split('\n').map((l) => l.trim()).find(Boolean);
  return line ? line.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim() || null : null;
}

/** Its element children: page-dom's small document keeps text beside them, a browser's children doesn't. */
const kids = (e: HTMLElement): HTMLElement[] => Array.from(e.children as unknown as ArrayLike<HTMLElement | string>).filter((c): c is HTMLElement => typeof c !== 'string');

/**
 * Makes a drawn section collapsible: its heading becomes a button that turns its chevron and says
 * aria-expanded, and a summary joins its header line, shown only while it's collapsed. A section with no
 * heading is left as it is.
 */
export function collapsible(sec: HTMLElement, id: string, ticket: { project: string; key: string }, summary: string | null): HTMLElement {
  let head = kids(sec)[0];
  // Its heading: the header itself, or one of the header line's own children.
  const h2 = head?.tagName === 'H2' ? head : head && kids(head).find((c) => c.tagName === 'H2');
  if (!head || !h2) return sec;
  // A section headed by its h2 alone gets a header line to hold the summary beside it.
  if (head === h2) {
    const rest = kids(sec).slice(1);
    head = el('div', 'an-head', h2);
    sec.replaceChildren(head, ...rest);
  }
  head.classList.add('sec-head');
  const name = h2.textContent ?? '';
  const k = sectionKey(id, ticket.project, ticket.key);
  // The heading's own words and icon (the Agent panel's robot) move into the button, after its chevron.
  const own = Array.from(((h2 as unknown as { childNodes?: ArrayLike<Node> }).childNodes ?? h2.children) as ArrayLike<Node>);
  const toggle = el('button', 'sec-toggle', el('span', 'tool-chev', icon('chevron-right'))) as HTMLButtonElement;
  toggle.append(...own);
  toggle.type = 'button';
  h2.replaceChildren(toggle);
  if (summary) {
    const sum = el('span', 'muted sec-sum', summary);
    sum.title = summary;
    // Beside the heading and its chips, before the spacer that pushes its time to the right.
    const items = kids(head);
    const at = items.findIndex((c) => c.classList.contains('spacer'));
    head.replaceChildren(...(at < 0 ? [...items, sum] : [...items.slice(0, at), sum, ...items.slice(at)]));
  }
  sec.classList.add('cc-section');
  sec.dataset.section = id;
  const show = (collapsed: boolean): void => {
    sec.classList.toggle('collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.title = `${collapsed ? 'Expand' : 'Collapse'} ${name}`;
  };
  show(memory().folded.includes(k));
  // In place, not a redraw: the page keeps its scroll, and focus stays on the button.
  const flip = (): void => {
    const collapsed = !sec.classList.contains('collapsed');
    remember((x) => { x.folded = collapsed ? [...new Set([...x.folded, k])].slice(-200) : x.folded.filter((y) => y !== k); });
    show(collapsed);
  };
  toggle.addEventListener('click', flip);
  // Enter and Space flip it on the key itself; preventing the key's default stops the button's own click
  // after it, which would flip it back.
  toggle.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    flip();
  });
  return sec;
}
