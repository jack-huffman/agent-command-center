// The page's modal (GH-158): a native <dialog> opened with showModal(), raised with the depth tokens over
// a backdrop mixed from the theme, its buttons in a bar along its top and a body that scrolls under them.
// A task's page over the board opens one (task-modal.ts), and so does a detail of the Overview (detail.ts,
// GH-160): both look and close the same way.

import { el } from './dom.ts';

/** A mouse event on the backdrop, outside the modal's box: the dialog itself gets those. */
function onBackdrop(d: HTMLDialogElement, e: MouseEvent): boolean {
  if (e.target !== d) return false;
  const r = d.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}

/**
 * Makes a modal, closed, at the end of the page's body: its bar holds `bar`, and `shut` is asked to close
 * it on Escape and on a click that began and ended on the backdrop, so a drag out of a text box doesn't.
 * Escape is handled here, at once: the browser's close event comes later, after the next open sometimes.
 */
export function makeModal(cls: string, bar: HTMLElement[], shut: () => void): { dialog: HTMLDialogElement; body: HTMLElement } {
  const dialog = document.createElement('dialog');
  dialog.className = `task-modal ${cls}`.trim();
  const body = el('div', 'task-modal-body');
  body.tabIndex = -1;
  dialog.append(el('div', 'task-modal-bar', ...bar), body);
  let downOnBackdrop = false;
  dialog.addEventListener('mousedown', (e) => { downOnBackdrop = onBackdrop(dialog, e); });
  dialog.addEventListener('click', (e) => { if (downOnBackdrop && onBackdrop(dialog, e)) shut(); downOnBackdrop = false; });
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); shut(); });
  document.body.append(dialog);
  return { dialog, body };
}
