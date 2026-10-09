// A task over the Tasks board (GH-158): a card's click opens its page in a modal, drawn by the task page's
// own renderer from the model its tab gets, with Open as tab and Close in its top-right corner. Its
// controls send what the tab's send, and the extension handles them as the tab's. The board stays under
// it: a redraw there leaves the modal, its scroll and what's typed in it as they were.

import type { Model } from '../src/model/home.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { button, el, keepFocus, peekKey } from './dom.ts';
import { api, type PageArea, state } from './state.ts';
import { renderTicket } from './task-page.ts';
import { forgetAnswered, tellAfresh, tellEdits } from './updates.ts';

/** The modal, made the first time it opens, and the part of it that scrolls. */
let dialog: HTMLDialogElement | null = null;
let body: HTMLElement | null = null;
/** What Open as tab sends: what the card sent before, as the extension says (GH-158). */
let asTab: Record<string, unknown> | null = null;
/** The model the page last drew under the modal. A draw of the same one is the page's own, such as a fold opened in the modal. */
let under: Model | null = null;

/** A mouse event on the backdrop, outside the modal's box: the dialog itself gets those. */
const onBackdrop = (e: MouseEvent): boolean => {
  if (!dialog || e.target !== dialog) return false;
  const r = dialog.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
};

function make(): HTMLDialogElement {
  const d = document.createElement('dialog');
  d.className = 'task-modal';
  // Closed first, so the extension hears it closed before what the card sent opens the tab.
  const tab = button('Open as tab', 'empty-window', () => {
    const msg = asTab;
    shut();
    if (msg) api.postMessage(msg);
  }, 'ghost task-modal-tab');
  tab.title = 'Open this task in its own editor tab, as a click on its card did, and close this';
  const close = button('Close', 'close', () => shut(), 'ghost task-modal-close');
  close.title = 'Close it, back to the board (Escape)';
  body = el('div', 'task-modal-body');
  body.tabIndex = -1;
  d.append(el('div', 'task-modal-bar', tab, close), body);
  // A click that began and ended on the backdrop closes it, so a drag out of a text box doesn't.
  let downOnBackdrop = false;
  d.addEventListener('mousedown', (e) => { downOnBackdrop = onBackdrop(e); });
  d.addEventListener('click', (e) => { if (downOnBackdrop && onBackdrop(e)) shut(); downOnBackdrop = false; });
  // Escape: closed here, at once, as Close does. The browser's close event comes later, after the next
  // open sometimes, so it only catches a close made some other way.
  d.addEventListener('cancel', (e) => { e.preventDefault(); shut(); });
  d.addEventListener('close', () => { if (!d.open && state.modal) closed(); });
  document.body.append(d);
  return d;
}

/** Closes the modal, whichever way it was asked to. */
function shut(): void {
  if (!dialog?.open) return;
  dialog.close();
  closed();
}

/** The modal closed: the extension stops drawing it, and focus goes back to the card it came from. */
function closed(): void {
  const m = state.modal;
  state.modal = null;
  asTab = null;
  body?.replaceChildren();
  if (!m) return;
  api.postMessage({ type: 'task-modal-close', project: m.project, key: m.key });
  // Found again: the board may have redrawn since, with new cards.
  document.querySelector<HTMLElement>(`[data-peek="${CSS.escape(peekKey(m.project, m.key))}"]`)?.focus();
}

/** Draws the task's page in the modal, where it was scrolled to, and keeps the focus where it was. */
function draw(): void {
  const m = state.modal;
  if (!dialog || !body || !m) return;
  const y = body.scrollTop;
  const inside = dialog.contains(document.activeElement);
  const keep = keepFocus();
  dialog.setAttribute('aria-label', `${m.key}: ${m.title}`);
  body.replaceChildren(...renderTicket(m));
  body.scrollTop = y;
  // Its text boxes grow to fit on the next frame, and only then is there room to scroll back that far.
  if (body.scrollTop < y) requestAnimationFrame(() => { if (body && body.scrollTop < y) body.scrollTop = y; });
  keep();
  // A button that went with the redraw leaves focus in the modal, not on the board under it.
  if (inside && !dialog.contains(document.activeElement)) body.focus({ preventScroll: true });
}

/** The extension sent the modal's task: to open it, or because it changed, as its tab would redraw. */
function show(msg: { model?: TicketModel; tab?: Record<string, unknown> }): void {
  if (!msg.model || msg.model.kind !== 'ticket') return;
  dialog ??= make();
  const opening = !dialog.open || state.modal?.project !== msg.model.project || state.modal?.key !== msg.model.key;
  state.modal = msg.model;
  asTab = msg.tab ?? null;
  // What its tab does before each draw: drafts for questions and updates that have gone are dropped, and
  // the extension hears of every edit, all of them afresh when it opens.
  forgetAnswered(state.last?.kind === 'home' ? state.last : msg.model);
  if (opening) tellAfresh();
  tellEdits(msg.model);
  draw();
  if (!dialog.open) {
    dialog.showModal();
    body?.focus({ preventScroll: true });
  }
  // A task just opened starts at its top: the browser would bring back where the last one was left.
  if (opening && body) body.scrollTop = 0;
}

export const area: PageArea = {
  // A redraw of the model the page last drew is the page's own, as a fold or Show all in the modal, or a
  // reply to what it sent: the modal draws again with it. A new one from the extension is the board's, and
  // the modal stays as it is.
  after(model) {
    const own = model === under;
    under = model;
    if (own && state.modal && dialog?.open) draw();
  },
  receive: { 'task-modal': show },
};
