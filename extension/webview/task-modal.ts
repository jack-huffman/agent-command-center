// A task over the Tasks board (GH-158): a card's click opens its page in a modal, drawn by the task page's
// own renderer from the model its tab gets, with Open as tab and Close in its top-right corner. Its
// controls send what the tab's send, and the extension handles them as the tab's. The board stays under
// it: a redraw there leaves the modal, its scroll and what's typed in it as they were.
// It opens the moment it's asked for (T-162): the click's own message opens it, with the task's key and title
// and a loading state, and the model fills it when it arrives. A model for a task the modal no longer waits
// for, closed or replaced since, doesn't open it again.

import type { Model } from '../src/model/home.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { button, el, keepFocus, peekKey } from './dom.ts';
import { Opening } from './loading.ts';
import { makeModal } from './modal.ts';
import { api, onSent, type PageArea, state } from './state.ts';
import { renderTicket } from './task-page.ts';
import { afterTabs } from './task-tabs.ts';
import { forgetAnswered, tellAfresh, tellEdits } from './updates.ts';

/** The modal, made the first time it opens, and the part of it that scrolls. */
let dialog: HTMLDialogElement | null = null;
let body: HTMLElement | null = null;
/** What Open as tab sends: what the card sent before, as the extension says (GH-158). */
let asTab: Record<string, unknown> | null = null;
/** The model the page last drew under the modal. A draw of the same one is the page's own, such as a fold opened in the modal. */
let under: Model | null = null;
/** Open as tab, off while the task loads: what it sends comes with the model. */
let tabButton: HTMLButtonElement | null = null;

/** What a click asked to open (T-162): the message it sent, and its title, as the line or card showed it. */
interface Ask { project: string; key: string; title?: string; tracker?: number | null; part?: string }
/** The task the modal waits for, and its wait: the loading state, or why it didn't open. */
let asked: Ask | null = null;
const opening = new Opening();
/** The task the modal last closed on: a model for it that comes after doesn't open it again. */
let lastShut: string | null = null;

function make(): HTMLDialogElement {
  // Closed first, so the extension hears it closed before what the card sent opens the tab.
  const tab = tabButton = button('Open as tab', 'empty-window', () => {
    const msg = asTab;
    shut();
    if (msg) api.postMessage(msg);
  }, 'ghost task-modal-tab');
  tab.title = 'Open this task in its own editor tab, as a click on its card did, and close this';
  const close = button('Close', 'close', () => shut(), 'ghost task-modal-close');
  close.title = 'Close it (Escape)';
  // Escape and the backdrop close it as Close does (modal.ts). The browser's close event only catches a
  // close made some other way.
  const m = makeModal('', [tab, close], shut);
  body = m.body;
  m.dialog.addEventListener('close', () => { if (!m.dialog.open && (state.modal || asked)) closed(); });
  return m.dialog;
}

/** The board's card for a task, found again: the board may have redrawn since the modal opened. */
const cardOf = (m: { project: string; key: string }): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-peek="${CSS.escape(peekKey(m.project, m.key))}"]`);

/**
 * Points the modal's scale at its card (transform-origin), so it grows from the card on opening and shrinks
 * back into it on closing. With no card on the page, such as a task opened from a link, it stays at its
 * centre. The dialog's offsets ignore its transform, so a half-grown modal gives the same answer.
 */
function aim(d: HTMLDialogElement, m: { project: string; key: string }): void {
  const r = cardOf(m)?.getBoundingClientRect();
  d.style.setProperty('--origin', r ? `${r.left + r.width / 2 - d.offsetLeft}px ${r.top + r.height / 2 - d.offsetTop}px` : '50% 50%');
}

/** Closes the modal, whichever way it was asked to. */
function shut(): void {
  if (!dialog?.open) return;
  const m = state.modal ?? asked;
  if (m) aim(dialog, m);
  dialog.close();
  closed();
}

/** The modal closed: the extension stops drawing it, and focus goes back to the card it came from. */
function closed(): void {
  const m = state.modal ?? asked;
  state.modal = null;
  asTab = null;
  asked = null;
  opening.end();
  body?.replaceChildren();
  lastShut = m ? peekKey(m.project, m.key) : null;
  if (!m) return;
  api.postMessage({ type: 'task-modal-close', project: m.project, key: m.key });
  // Found again: the board may have redrawn since, with new cards.
  cardOf(m)?.focus();
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

/**
 * A click asked for a task (T-162): the modal opens now, in place of any it showed, with the task's key and
 * title over the loading state, busy until the model comes. Open as tab waits for the model, which says what
 * it sends. Try again asks again, as the click did.
 */
function waitFor(a: Ask): void {
  dialog ??= make();
  const key = a.key.toUpperCase();
  // The extension closes the task the modal showed as it opens this one; the page forgets it here.
  state.modal = null;
  asTab = null;
  asked = a;
  lastShut = null;
  dialog.setAttribute('aria-label', a.title ? `${key}: ${a.title}` : key);
  if (tabButton) {
    tabButton.disabled = true;
    tabButton.title = 'Open as tab is ready once the task has opened';
  }
  const lead = el('header', 'loading-lead', el('span', 'tcard-key', key), a.title ? el('h1', 'loading-title', a.title) : null);
  opening.start(peekKey(a.project, a.key), body!, `Opening ${key}…`, key, [lead], () => api.postMessage({ type: 'task-modal-open', ...a }));
  if (!dialog.open) {
    dialog.showModal();
    aim(dialog, a);
  }
  body?.focus({ preventScroll: true });
}

/** The extension couldn't open the task it was asked for: the modal says why, with Try again. */
function failed(m: { project?: string; key?: string; why?: string }): void {
  if (typeof m.project === 'string' && typeof m.key === 'string' && opening.waits(peekKey(m.project, m.key))) opening.fail(m.why || 'The Command Center didn\'t say why.');
}

/** The extension sent the modal's task: to open it, or because it changed, as its tab would redraw. */
function show(msg: { model?: TicketModel; tab?: Record<string, unknown> }): void {
  if (!msg.model || msg.model.kind !== 'ticket') return;
  const k = peekKey(msg.model.project, msg.model.key);
  // Another task is opening, or this one closed before it came: the model is late, and opens nothing.
  if (asked && !opening.waits(k)) return;
  if (!asked && !dialog?.open && lastShut === k) return;
  asked = null;
  opening.end();
  dialog ??= make();
  if (tabButton) {
    tabButton.disabled = false;
    tabButton.title = 'Open this task in its own editor tab, as a click on its card did, and close this';
  }
  const fresh = !dialog.open || !state.modal || state.modal.project !== msg.model.project || state.modal?.key !== msg.model.key;
  state.modal = msg.model;
  asTab = msg.tab ?? null;
  // What its tab does before each draw: drafts for questions and updates that have gone are dropped, and
  // the extension hears of every edit, all of them afresh when it opens.
  forgetAnswered(state.last?.kind === 'home' ? state.last : msg.model);
  if (fresh) tellAfresh();
  tellEdits(msg.model);
  draw();
  if (!dialog.open) {
    dialog.showModal();
    aim(dialog, msg.model);
    body?.focus({ preventScroll: true });
  }
  // A task just opened starts at its top: the browser would bring back where the last one was left.
  if (fresh && body) body.scrollTop = 0;
  // A comment a link named, scrolled to and focused once the page is drawn (T-134).
  afterTabs();
}

// Every way to open a task in the modal sends this message, so hearing it opens the modal at the click.
onSent((m) => {
  if (m.type !== 'task-modal-open' || typeof m.project !== 'string' || typeof m.key !== 'string') return;
  const { project, key, title, tracker, part } = m as unknown as Ask;
  waitFor({ project, key, ...(title ? { title } : {}), ...(tracker === undefined ? {} : { tracker }), ...(part ? { part } : {}) });
});
/** The screenshot run's shot of the modal while it loads, or once it failed: from the tab's memory, on the first draw. */
let shotOpened = false;
function shotOpening(): void {
  if (shotOpened) return;
  shotOpened = true;
  const o = (api.getState() as { opening?: Ask & { failed?: string } } | undefined)?.opening;
  if (!o) return;
  waitFor({ project: o.project, key: o.key, ...(o.title ? { title: o.title } : {}) });
  if (o.failed) opening.fail(o.failed);
}

export const area: PageArea = {
  // A redraw of the model the page last drew is the page's own, as a fold or Show all in the modal, or a
  // reply to what it sent: the modal draws again with it. A new one from the extension is the board's, and
  // the modal stays as it is.
  after(model) {
    shotOpening();
    const own = model === under;
    under = model;
    if (own && state.modal && dialog?.open) draw();
  },
  // The task's page opened in a tab for its conversation (T-112): the modal closes onto it.
  receive: { 'task-modal': show, 'task-modal-failed': failed, 'task-modal-shut': (m: { project?: string; key?: string }) => { if (state.modal?.project === m.project && state.modal?.key === m.key) shut(); } },
};
