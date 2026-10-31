// A task page's content in tabs (T-134): Ticket, Plan & build, Changes and Verify, as an ARIA tablist. Each tab has
// its name in words, with no icon (T-168), a count where it helps, and an orange icon with "needs you" where something in it needs
// the person. The arrow keys move between tabs, Home and End go to the ends, and a tab switches in place, so
// focus stays on it. The tab on show is remembered per ticket; which one a page opens on is openingTab's, in tab-rules.ts.

import type { TicketModel } from '../src/model/task-page.ts';
import { NEEDS_YOU, openingTab, partTab, type TabId, type TaskTab, tabName } from './tab-rules.ts';
import { el, icon } from './dom.ts';
import { memory, remember } from './state.ts';

/** The ticket this page drew last, and the tab it showed: a redraw of the same ticket keeps its tab. */
let drawn = '';
let showing: TabId | null = null;
/** A comment a link named, to scroll to once the page is drawn (T-134). */
let toComment: string | null = null;

/** Forgets the ticket drawn last, so the next draw is an opening: as a page freshly loaded is. */
export function forgetDrawn(): void {
  drawn = '';
  showing = null;
}

/**
 * The comment a link asked for, once: Ticket's activity shows every entry while one is asked for, and the page
 * scrolls to it after the draw. Null when none is.
 */
export const askedComment = (): string | null => toComment;

/**
 * The tab to show for this draw. An opening (another ticket, or the page loaded afresh) and a link the page
 * hasn't followed yet go by openingTab; any other redraw keeps the tab on show, while it's still shown.
 */
export function chooseTab(m: TicketModel, tabs: readonly TaskTab[]): TabId {
  const id = `${m.project}#${m.key}`;
  const mem = memory();
  const jump = m.open && mem.jumps?.[id] !== m.open.at ? m.open : null;
  toComment = jump?.part.startsWith('comment:') ? jump.part.slice('comment:'.length) : null;
  let tab: TabId;
  if (jump || drawn !== id || !showing || !tabs.some((t) => t.id === showing)) tab = openingTab(tabs, partTab(jump?.part), mem.tabs?.[id]);
  else tab = showing;
  drawn = id;
  showing = tab;
  remember((x) => {
    x.tabs = { ...x.tabs, [id]: tab };
    if (jump) x.jumps = { ...x.jumps, [id]: jump.at };
  });
  return tab;
}

/** One tab's button: its name, with no icon (T-168), its count, and an orange icon and words where it needs the person. */
function tabButton(t: TaskTab, on: boolean): HTMLButtonElement {
  const b = el('button', 'task-tab', el('span', 'task-tab-name', t.name),
    t.count ? el('span', 'task-tab-count', t.count) : null,
    t.needs ? el('span', 'task-tab-needs', icon('bell', 'orange'), NEEDS_YOU) : null) as HTMLButtonElement;
  b.type = 'button';
  b.setAttribute('role', 'tab');
  b.setAttribute('id', `task-tab-${t.id}`);
  b.setAttribute('aria-controls', `task-panel-${t.id}`);
  b.setAttribute('aria-selected', String(on));
  b.tabIndex = on ? 0 : -1;
  b.dataset.tab = t.id;
  // Its name is its visible words (WCAG's label in name); its title says them whole, with what needs the person.
  b.title = t.needs ? `${tabName(t)}. ${t.needs}` : tabName(t);
  return b;
}

/**
 * The page's tabs and their panels: a tab for each shown part, in order, its panel holding what it's given.
 * The tabs and the one chosen come from taskTabs and chooseTab, which run before the parts are drawn, so
 * Ticket's activity knows a comment a link asked for. Only the chosen tab's panel shows; a click or a key switches in place, and the tab is remembered.
 */
export function renderTabs(m: TicketModel, tabs: readonly TaskTab[], chosen: TabId, parts: Record<TabId, HTMLElement[]>): HTMLElement {
  const id = `${m.project}#${m.key}`;
  const list = el('div', 'task-tabs');
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', `${m.key}'s page`);
  const buttons = tabs.map((t) => tabButton(t, t.id === chosen));
  const panels = tabs.map((t) => {
    const p = el('div', `task-panel task-panel-${t.id}`, ...parts[t.id]);
    p.setAttribute('role', 'tabpanel');
    p.setAttribute('id', `task-panel-${t.id}`);
    p.setAttribute('aria-labelledby', `task-tab-${t.id}`);
    p.dataset.tab = t.id;
    p.hidden = t.id !== chosen;
    return p;
  });
  const select = (i: number, focus: boolean): void => {
    buttons.forEach((b, j) => {
      b.setAttribute('aria-selected', String(i === j));
      b.tabIndex = i === j ? 0 : -1;
      panels[j]!.hidden = i !== j;
    });
    const tab = tabs[i]!.id;
    showing = tab;
    remember((x) => { x.tabs = { ...x.tabs, [id]: tab }; });
    if (focus) buttons[i]!.focus();
  };
  buttons.forEach((b, i) => {
    b.addEventListener('click', () => select(i, false));
    b.addEventListener('keydown', (e: KeyboardEvent) => {
      const n = buttons.length;
      const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
      if (to < 0) return;
      e.preventDefault();
      select(to, true);
    });
  });
  list.append(...buttons);
  return el('div', 'task-tabbed', list, ...panels);
}

/** After the draw: a comment a link named, scrolled to and focused. The tab row wraps, so every tab is in view. */
export function afterTabs(): void {
  if (!toComment) return;
  const c = document.querySelector<HTMLElement>(`[data-comment="${CSS.escape(toComment)}"]`);
  toComment = null;
  if (!c) return;
  c.scrollIntoView({ block: 'center' });
  c.focus({ preventScroll: true });
}
