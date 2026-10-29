// What every board shares: a card's footer and its ⋯ menu, and scrolling a board sideways.

import type { Action } from '../src/model/shared.ts';
import { el, icon, work } from './dom.ts';
import { actionTile } from './task-actions.ts';
import { answerHere } from './detail.ts';
import { api, go } from './state.ts';
import { explains } from './plain-words.ts';
import { dress, dressMenu, press } from './working.ts';

/**
 * A mouse wheel scrolls the board sideways wherever a lane wouldn't scroll itself: over a heading, the
 * gaps between lanes, or a lane short enough to need no scrolling. Trackpads and Shift already go sideways.
 */
export function wheelSideways(board: HTMLElement): void {
  board.addEventListener('wheel', (e) => {
    if (e.shiftKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const t = e.target as HTMLElement;
    const lane = t.closest<HTMLElement>('.column');
    const laneScrolls = !!lane && !t.closest('.column > h2') && lane.scrollHeight > lane.clientHeight + 1;
    if (laneScrolls || board.scrollWidth <= board.clientWidth) return;
    e.preventDefault();
    board.scrollLeft += e.deltaY;
  }, { passive: false });
}

/**
 * While a card is dragged near a board's left or right edge, the board scrolls that way, faster the
 * closer it is, so a lane off screen can take the drop. It stops when the card leaves the edge, the board
 * or the drag ends: dragover fires every few dozen milliseconds while a card hovers, so silence means gone.
 */
export function dragAutoScroll(board: HTMLElement): void {
  let speed = 0;
  let lastOver = 0;
  let frame = 0;
  const step = () => {
    frame = 0;
    if (!speed || performance.now() - lastOver > 150) { speed = 0; return; }
    board.scrollLeft += speed;
    frame = requestAnimationFrame(step);
  };
  board.addEventListener('dragover', (e) => {
    const r = board.getBoundingClientRect();
    const zone = Math.min(96, r.width * 0.18);
    const fromLeft = e.clientX - r.left;
    const fromRight = r.right - e.clientX;
    const most = 22;
    speed = fromLeft < zone ? -Math.ceil(most * (1 - fromLeft / zone)) : fromRight < zone ? Math.ceil(most * (1 - fromRight / zone)) : 0;
    lastOver = performance.now();
    if (speed && !frame) frame = requestAnimationFrame(step);
  });
  const stop = () => { speed = 0; if (frame) cancelAnimationFrame(frame); frame = 0; };
  board.addEventListener('drop', stop);
  board.addEventListener('dragend', stop);
}

/** A card's one next step, if it has one: the button its footer shows (D-062). */
const cardPrimary = (actions: Action[]): Action | undefined => actions.find((a) => a.primary && a.command !== 'acc.task.move');
/** Its pull request, when that isn't the next step: a link in the footer, not a button. */
const cardPr = (actions: Action[]): Action | undefined => actions.find((a) => a.command === 'acc.task.openPr' && a !== cardPrimary(actions));
/** What goes behind ⋯: the rest, with the card itself opening its page, and drag doing Move. */
export const cardMenu = (actions: Action[]): Action[] => actions.filter((a) => a !== cardPrimary(actions) && a !== cardPr(actions) && a.command !== 'acc.task.move' && !(a.command === 'acc.task.show' && !a.primary));

/**
 * A card's next step as a full-width button, the task page's size (D-168). An Answer with its question
 * opens that question in Needs you, on the Overview, as the Agents tab's Answer does (T-39); any other runs
 * its command.
 */
export function nextStep(a: Action): HTMLElement {
  if (!a.question) return actionTile(a, true);
  const id = a.question;
  const b = actionTile(a, true, () => { go('overview'); answerHere(id); });
  b.title = `${a.label}: go to its question in Needs you, on the Overview, and answer it there`;
  return b;
}

/** A card's footer: where it lives and its pull request, then its one next step, full width, under them. */
export function cardFoot(card: { worktree: string | null; actions: Action[] }): HTMLElement | null {
  const primary = cardPrimary(card.actions);
  const pr = cardPr(card.actions);
  if (!card.worktree && !pr && !primary) return null;
  const prLink = pr ? el('button', 'card-link', icon(pr.icon), pr.label.replace(/^Pull request /, 'PR ')) as HTMLButtonElement : null;
  if (prLink && pr) {
    prLink.type = 'button';
    prLink.title = pr.label;
    prLink.addEventListener('click', (e) => { e.stopPropagation(); api.postMessage({ type: 'run', command: pr.command, ref: pr.ref }); });
  }
  return el('div', 'card-foot',
    // The worktree's last two folders, with the whole path on hover, since a narrow card cuts it short.
    card.worktree || prLink ? el('div', 'card-meta', card.worktree ? Object.assign(work(el('span', 'card-where mono muted', icon('git-branch'), card.worktree.split('/').slice(-2).join('/')), 'branch'), { title: card.worktree }) : null, prLink) : null,
    primary ? nextStep(primary) : null);
}

// The screenshot harness can start with a menu open, to see it laid out.
let openMenu: string | null = ((api.getState() as { openMenu?: string } | undefined)?.openMenu) ?? null;

/**
 * A ⋯ button that opens a short menu of actions, each with its icon and label. It stays open while the
 * page redraws, and closes on a pick, a click elsewhere, or Escape. Null when there's nothing to put in it.
 * A pick runs its command on its ref, or does what `send` says, as the Overview's header's does (T-36).
 */
export function moreMenu(key: string, name: string, actions: Action[], send?: (a: Action) => void): HTMLElement | null {
  if (!actions.length) return null;
  const btn = el('button', 'more-btn', icon('ellipsis')) as HTMLButtonElement;
  btn.type = 'button';
  btn.title = `More for ${name}`;
  btn.setAttribute('aria-label', `More actions for ${name}`);
  btn.setAttribute('aria-haspopup', 'menu');
  // A pick the extension is still answering (T-147): ⋯ spins and says what's under way, and stays open to the rest.
  if (!send) dressMenu(btn, actions, name);
  const safe = actions.filter((a) => !a.danger);
  const danger = actions.filter((a) => a.danger);
  const item = (a: Action) => {
    const label = el('span', '', a.label);
    const b = el('button', `more-item${a.danger ? ' danger' : ''}`, icon(a.icon), label) as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    // One that can't be used now is disabled, with its reason, never left to do nothing (GH-69).
    if (a.disabled) {
      b.disabled = true;
      b.title = a.disabled;
      b.setAttribute('aria-description', a.disabled);
    } else b.title = explains(a.command, a.label);
    b.addEventListener('click', (e) => { e.stopPropagation(); openMenu = null; menu.hidden = true; if (send) send(a); else if (!b.disabled) press(a); });
    return send ? b : dress(b, a, label);
  };
  const menu = el('div', 'more-menu', ...safe.map(item), danger.length && safe.length ? el('div', 'more-sep') : null, ...danger.map(item));
  menu.setAttribute('role', 'menu');
  const draw = (open: boolean) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  // Opening one closes any other; drawing never changes which is open, so a redraw keeps it.
  const show = (open: boolean) => { draw(open); openMenu = open ? key : openMenu === key ? null : openMenu; };
  draw(openMenu === key);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !!menu.hidden;
    document.querySelectorAll<HTMLElement>('.more-menu').forEach((m) => { if (m !== menu) m.hidden = true; });
    show(opening);
    if (opening) menu.querySelector<HTMLElement>('.more-item')?.focus();
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll<HTMLElement>('.more-item')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); show(false); btn.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus(); }
  });
  const wrap = el('div', 'more', btn, menu);
  // Clicks on it don't reach the card, which would open the task.
  wrap.addEventListener('click', (e) => e.stopPropagation());
  wrap.addEventListener('mousedown', (e) => e.stopPropagation());
  return wrap;
}

document.addEventListener('mousedown', () => { if (openMenu) { openMenu = null; document.querySelectorAll<HTMLElement>('.more-menu').forEach((m) => { m.hidden = true; }); } });

/** Marks each board with the edges that have more lanes past them, for the fade. */
export function boardEdges(board: HTMLElement): void {
  const update = () => {
    board.classList.toggle('more-left', board.scrollLeft > 2);
    board.classList.toggle('more-right', board.scrollLeft + board.clientWidth < board.scrollWidth - 2);
  };
  board.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(board);
  update();
}
