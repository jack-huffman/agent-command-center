// Choosing a board by seeing it (T-106): the board the choices would make, drawn before anything is kept. In
// the Connect modal (T-140) it is under the dropdowns, its columns side by side as the Tasks tab draws them.

import type { ConnectModel } from '../src/model/connect.ts';
import type { TrackerBoard, TrackerColumn } from '../src/model/boards.ts';
import { button, el, icon, stateChip, status } from './dom.ts';
import { trackerCard } from './tasks.ts';
import { api } from './state.ts';

/** Sends a Connect page's message, with its session: the one way both its dropdowns and its preview speak to the extension. */
export const connectSend = (m: ConnectModel, msg: Record<string, unknown>): void => api.postMessage({ ...msg, session: m.id });

/** One column of the preview (T-106): its name and how many it holds, its first cards, and how many more. */
function previewColumn(b: TrackerBoard, c: TrackerColumn, total: number): HTMLElement {
  const more = total - c.cards.length;
  return el('section', `cpreview-col tone-edge-${c.tone}`,
    el('h3', 'cpreview-head', stateChip({ label: c.name, icon: c.icon, tone: c.tone, quiet: c.quiet }), el('span', 'count', String(total))),
    ...c.cards.map((x) => trackerCard('', b, x, true)),
    more > 0 ? el('div', 'muted small cpreview-more', `and ${more} more`) : null,
    total ? null : el('div', 'muted small cpreview-more', 'None here'));
}

/**
 * The board the choices would make (T-106), under the dropdowns (T-140): its line with how many tickets, its
 * columns side by side with their first cards drawn as the Tasks tab draws them, a quiet skeleton while it's
 * read, which choice to widen when it's empty, and Read it again when it failed. Nothing on it opens or moves.
 */
export function previewPanel(m: ConnectModel): HTMLElement {
  const p = m.preview;
  const skeleton = p.state === 'loading' ? el('div', 'cpreview-cols', ...[0, 1, 2].map(() => el('div', 'cpreview-col', el('span', 'ccard-skeleton cpreview-skel'), el('span', 'ccard-skeleton cpreview-skel')))) : null;
  const board = p.board ? el('div', 'cpreview-cols', ...p.board.columns.map((c, i) => previewColumn(p.board!, c, p.totals[i] ?? c.cards.length))) : null;
  // Its columns scroll sideways on a narrow modal, so the keyboard can reach them too.
  if (board) Object.assign(board, { tabIndex: 0 }).setAttribute('aria-label', `${p.board!.title}: its columns`);
  const box = el('section', 'connect-preview',
    el('div', 'cpreview-line', status(p.look), p.board ? el('span', 'muted small cpreview-title', p.board.title) : null),
    skeleton, board,
    p.empty ? el('p', 'cpreview-empty', icon('info'), el('span', '', p.empty)) : null,
    p.retry ? button('Read it again', 'refresh', () => connectSend(m, { type: 'connect-preview' }), 'ghost') : null);
  box.setAttribute('aria-label', 'Your board');
  box.setAttribute('aria-busy', String(p.state === 'loading'));
  return box;
}
