// A modal that opens the moment it's asked for (T-162): it opens at the click with what the page already
// knows, and a loading state in its body, a turning ring and words such as "Opening GH-69…", read out once.
// What it waits for fills it when it arrives. A wait that fails, or that nothing answers in time, says why in
// the modal with Try again, and never leaves the ring turning. The task modal, the dispatch and deploy sheets,
// and the tracker and cloud-setup modals each keep one Opening.

import { button, type Child, el, icon } from './dom.ts';

/** How long a modal waits for what fills it before it says it didn't open. */
export const LOAD_LIMIT_MS = 20_000;

/** Why a modal didn't open when nothing answered in time. */
export const NO_ANSWER = `The Command Center didn't answer in ${LOAD_LIMIT_MS / 1000} seconds.`;

/** The loading state: a turning ring and its words. A status, so a screen reader reads it once as it appears. */
export function loadingState(words: string): HTMLElement {
  const ring = el('span', 'loading-ring');
  ring.setAttribute('aria-hidden', 'true');
  const box = el('div', 'loading-state', ring, el('p', 'loading-words', words));
  box.setAttribute('role', 'status');
  return box;
}

/** The words a task's page shows while its first draw fills (T-162). */
export const FILLING = 'Reading its checks, its branch and its team…';

/** One line that says a part of the page is still loading: a small ring and its words, read out once. */
export function loadingLine(words: string): HTMLElement {
  const ring = el('span', 'loading-ring small');
  ring.setAttribute('aria-hidden', 'true');
  const line = el('p', 'loading-line', ring, el('span', '', words));
  line.setAttribute('role', 'status');
  return line;
}

/** A load that failed: what didn't open and why, in orange with its icon, then Try again. An alert, read out at once. */
export function failedState(what: string, why: string, retry: () => void): HTMLElement {
  const box = el('div', 'loading-failed', el('p', 'loading-why', icon('warning', 'orange'), el('span', '', `${what} didn't open. ${why}`)),
    button('Try again', 'refresh', retry, 'primary loading-retry'));
  box.setAttribute('role', 'alert');
  return box;
}

/**
 * One modal's wait for what fills it. `key` names what it waits for, so what arrives for something else, or
 * after the wait ended, is told apart. While it waits the body is busy and shows `lead`, what the page
 * already knows, over the loading state; past LOAD_LIMIT_MS with no answer, it fails with NO_ANSWER.
 */
export class Opening {
  key: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** What the wait says while it lasts, and what Try again does. */
  private shown: { body: HTMLElement; what: string; lead: Child[]; retry: () => void } | null = null;

  /** Starts waiting for `key`: the body shows `lead` and the loading state with `words`, at once. */
  start(key: string, body: HTMLElement, words: string, what: string, lead: Child[], retry: () => void): void {
    this.end();
    this.key = key;
    this.shown = { body, what, lead, retry };
    body.setAttribute('aria-busy', 'true');
    body.replaceChildren(...lead.filter((c): c is Node | string => !!c), loadingState(words));
    this.timer = setTimeout(() => this.fail(NO_ANSWER), LOAD_LIMIT_MS);
  }

  /** Whether it's waiting for `key` now, its failure included: what arrives for it fills the modal. */
  waits(key: string): boolean {
    return this.key === key;
  }

  /** Waiting, and not failed: the ring is turning. */
  get busy(): boolean {
    return this.timer !== null;
  }

  /** The wait failed: the body says why, with Try again, and the ring stops. A wait that ended says nothing. */
  fail(why: string): void {
    const s = this.shown;
    if (!s || this.key === null) return;
    this.stopTimer();
    s.body.removeAttribute('aria-busy');
    s.body.replaceChildren(...s.lead.filter((c): c is Node | string => !!c), failedState(s.what, why, s.retry));
    s.body.querySelector<HTMLElement>('.loading-retry')?.focus({ preventScroll: true });
  }

  /** The wait is over: filled, closed, or replaced. The body is no longer busy. */
  end(): void {
    this.stopTimer();
    this.shown?.body.removeAttribute('aria-busy');
    this.shown = null;
    this.key = null;
  }

  private stopTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
