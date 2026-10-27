// The Tasks tab's board switch (T-127): which of a project's boards is on show, and the way to another. Up to
// SEGMENTED_MOST boards, a row of buttons, the boards and My work. More, one button that names the board on show
// and opens a list of them all, grouped by site, with All boards and My work: one to find and pick a board in,
// as the person filter's menu is a list of people (D-205 names it so in extension/test/choice-limit.test.ts).
// The choice is kept per project in the tab's memory, as the board mode was before it.

import type { TrackerBoard } from '../src/model/boards.ts';
import { el, icon } from './dom.ts';
import { api, memory, remember, state } from './state.ts';
import { WORDS } from './plain-words.ts';

/** The most boards drawn as a row of buttons beside My work (T-127); past it, one button opens a list. */
export const SEGMENTED_MOST = 3;
/** The list gets a box to find a board by typing once it holds more boards than this (T-127). */
export const FILTER_FROM = 5;

/** What a project's Tasks tab shows: a board by its id, every board, or My work, as the tab's memory keeps it. */
export type BoardChoice = `board:${string}` | 'all' | 'agents';

type Board = Pick<TrackerBoard, 'id' | 'name' | 'group' | 'kind' | 'title' | 'tickets' | 'needs' | 'error' | 'loading' | 'columns'>;

/**
 * The choice that applies now (T-127): the one kept while its board is still there, else the first board. All
 * boards is the list's, so with SEGMENTED_MOST boards or fewer it falls back too. An older tab's "tracker" is the first board.
 */
export function boardChoice(boards: readonly Pick<Board, 'id'>[], kept: string | undefined): BoardChoice {
  if (kept === 'agents' || !boards.length) return 'agents';
  if (kept === 'all' && boards.length > SEGMENTED_MOST) return 'all';
  const id = kept?.startsWith('board:') ? kept.slice('board:'.length) : null;
  return `board:${boards.find((b) => b.id === id)?.id ?? boards[0]!.id}`;
}

/** The boards the list shows for what's typed (T-127), each site's together, in the order they first come. */
export function switchGroups<B extends Pick<Board, 'name' | 'group' | 'title'>>(boards: readonly B[], query: string): { group: string; boards: B[] }[] {
  const q = query.trim().toLowerCase();
  const out: { group: string; boards: B[] }[] = [];
  for (const b of boards) {
    if (q && ![b.name, b.group, b.title].some((s) => s.toLowerCase().includes(q))) continue;
    const g = out.find((x) => x.group === b.group);
    if (g) g.boards.push(b);
    else out.push({ group: b.group, boards: [b] });
  }
  return out;
}

/** A board's counts on the list (T-127): "12 tickets · 2 need you", Reading… before its first read, or why it couldn't be read. */
export function boardCounts(b: Pick<Board, 'tickets' | 'needs' | 'error' | 'loading' | 'columns'>): { text: string; failed: boolean } {
  if (b.error) return { text: b.error, failed: true };
  if (b.loading && !b.columns.length) return { text: 'Reading…', failed: false };
  return { text: `${b.tickets} ticket${b.tickets === 1 ? '' : 's'}${b.needs ? ` · ${b.needs} need${b.needs === 1 ? 's' : ''} you` : ''}`, failed: false };
}

/** The choice's words, for the button that names it and its screen reader name. */
const choiceName = (boards: readonly Board[], c: BoardChoice): string => (c === 'agents' ? WORDS.myWork : c === 'all' ? 'All boards' : boards.find((b) => `board:${b.id}` === c)?.name ?? '');

const pick = (root: string, c: BoardChoice): void => {
  remember((m) => { m.modes[root] = c; });
  openList = null;
  if (state.last) state.draw(state.last);
};

// The list open, and what's typed in its box, by project, so a redraw keeps them. The screenshot harness can start them.
const started = api.getState() as { openBoards?: string; boardQuery?: string } | undefined;
let openList: string | null = started?.openBoards ?? null;
const typed = new Map<string, string>(started?.openBoards && started.boardQuery ? [[started.openBoards, started.boardQuery]] : []);

/** A board's icon: its kind's, or an orange warning while it can't be read. */
const boardIcon = (b: Board, kindIcon: (kind: string) => string): HTMLElement => (b.error ? icon('warning', 'orange') : icon(kindIcon(b.kind)));

/**
 * The switch for one project's boards (T-127). `kindIcon` is each tracker's codicon. A board that couldn't be read
 * stays on the switch, with an orange icon and why, so its board, and its Sign in, can be shown.
 */
export function boardSwitch(root: string, boards: readonly Board[], choice: BoardChoice, kindIcon: (kind: string) => string): HTMLElement {
  if (boards.length <= SEGMENTED_MOST) {
    const g = el('div', 'segmented board-switch');
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', 'Which board');
    const seg = (c: BoardChoice, ic: HTMLElement, name: string, title: string): HTMLButtonElement => {
      const b = el('button', `seg${choice === c ? ' on' : ''}`, ic, el('span', 'seg-name', name)) as HTMLButtonElement;
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-pressed', String(choice === c));
      b.addEventListener('click', () => { if (choice !== c) pick(root, c); });
      return b;
    };
    for (const b of boards) g.append(seg(`board:${b.id}`, boardIcon(b, kindIcon), b.name, b.error ? `${b.name}: ${b.error}` : `${b.name} · ${b.group}. The tickets as the tracker has them, in its own columns.`));
    g.append(seg('agents', icon('hubot'), WORDS.myWork, `The tickets you've added, by stage: Ready, Running, In review, ${WORDS.sentBack}, Blocked, Done`));
    return g;
  }
  const on = boards.find((b) => `board:${b.id}` === choice);
  const name = choiceName(boards, choice);
  const btn = el('button', 'btn board-switch-btn', on ? boardIcon(on, kindIcon) : icon(choice === 'all' ? 'layers' : 'hubot'), el('span', 'board-switch-name', name), icon('chevron-down')) as HTMLButtonElement;
  btn.type = 'button';
  btn.title = `${name}. Choose another of the ${boards.length} boards.`;
  btn.setAttribute('aria-label', `Board on show: ${name}. Choose another`);
  btn.setAttribute('aria-haspopup', 'menu');
  const items = el('div', 'board-items');
  items.setAttribute('role', 'menu');
  items.setAttribute('aria-label', 'Boards');
  const item = (c: BoardChoice, ic: HTMLElement, label: string, note: { text: string; failed: boolean } | null): HTMLElement => {
    const b = el('button', `more-item board-item${choice === c ? ' on' : ''}`, ic,
      el('span', 'board-item-text', el('span', 'board-item-name', label),
        note ? el('span', `board-item-note${note.failed ? ' tone-orange' : ' muted'}`, note.text) : null)) as HTMLButtonElement;
    b.type = 'button';
    b.title = note ? `${label}: ${note.text}` : label;
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', String(choice === c));
    b.addEventListener('click', (e) => { e.stopPropagation(); pick(root, c); });
    return b;
  };
  const fill = (query: string): void => {
    const groups = switchGroups(boards, query);
    items.replaceChildren(
      ...(query.trim() ? [] : [item('agents', icon('hubot'), WORDS.myWork, null), item('all', icon('layers'), 'All boards', { text: 'Each board folded, one under another', failed: false })]),
      ...groups.map((g) => {
        const box = el('div', 'board-group', el('div', 'board-group-name', g.group), ...g.boards.map((b) => item(`board:${b.id}`, boardIcon(b, kindIcon), b.name, boardCounts(b))));
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', g.group);
        box.firstElementChild!.setAttribute('aria-hidden', 'true');
        return box;
      }),
      ...(groups.length ? [] : [el('p', 'muted board-none', `No board's name has “${query.trim()}” in it.`)]),
    );
  };
  const find = boards.length > FILTER_FROM ? document.createElement('input') : null;
  if (find) {
    find.type = 'search';
    find.className = 'board-find';
    find.placeholder = 'Find a board';
    find.setAttribute('aria-label', 'Find a board');
    find.value = typed.get(root) ?? '';
    find.addEventListener('input', () => { typed.set(root, find.value); fill(find.value); });
  }
  fill(find?.value ?? '');
  const menu = el('div', 'more-menu board-menu', find, items);
  const show = (open: boolean): void => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    openList = open ? root : openList === root ? null : openList;
  };
  show(openList === root);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !!menu.hidden;
    document.querySelectorAll<HTMLElement>('.more-menu').forEach((m) => { if (m !== menu) m.hidden = true; });
    show(opening);
    if (opening) (find ?? items.querySelector<HTMLElement>('.board-item.on') ?? items.querySelector<HTMLElement>('.board-item'))?.focus();
  });
  menu.addEventListener('keydown', (e) => {
    const all = [...menu.querySelectorAll<HTMLElement>('.board-find, .board-item')];
    const here = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); show(false); btn.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); all[(here + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus(); }
    // Enter in the box picks the first board it finds.
    if (e.key === 'Enter' && document.activeElement === find) { e.preventDefault(); items.querySelector<HTMLElement>('.board-group .board-item')?.click(); }
  });
  const control = el('div', 'board-switch-list', btn, menu);
  control.addEventListener('click', (e) => e.stopPropagation());
  control.addEventListener('mousedown', (e) => e.stopPropagation());
  return control;
}

/** The board each project's tab last told the extension it shows, so a redraw doesn't tell it again. */
const told = new Map<string, string | null>();

/** Tells the extension which board is on show (T-127), so it reads that one first: null for My work or All boards. */
export function tellShown(root: string, choice: BoardChoice): void {
  const board = choice.startsWith('board:') ? choice.slice('board:'.length) : null;
  if (told.has(root) && told.get(root) === board) return;
  told.set(root, board);
  api.postMessage({ type: 'board-shown', project: root, board });
}

/** Whether a board in All boards is opened (T-127): each starts folded to its heading and counts. */
export const boardOpen = (root: string, id: string): boolean => memory().opened.includes(`board-open:${root}#${id}`);

/** Opens or folds a board in All boards, and draws the page again. */
export function toggleBoard(root: string, id: string): void {
  const key = `board-open:${root}#${id}`;
  remember((m) => { m.opened = m.opened.includes(key) ? m.opened.filter((k) => k !== key) : [...m.opened, key]; });
  if (state.last) state.draw(state.last);
}
