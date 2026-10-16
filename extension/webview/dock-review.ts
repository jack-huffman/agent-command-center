// A review in the output panel (T-63): short, so it reads at a glance over the page. A running review is one
// calm line; a finished one is a header line with the verdict and the next step, the summary in two lines,
// then a row for each criterion not met and each finding, which opens in place, and the met criteria folded
// into one row. A finding's parts are the task page's (review.ts).

import type { DockReview, DockReviewRow } from '../src/model/dock-review.ts';
import type { Action } from '../src/model/shared.ts';
import { el, icon, status, work } from './dom.ts';
import { excerpt, place } from './review.ts';
import { api, memory, remember } from './state.ts';

/** What the tab remembers a part of a run's review opened by. */
export const openKey = (run: string, part: string): string => `dock-review:${run}:${part}`;
const isOpen = (key: string): boolean => memory().opened.includes(key);

/** Opens or closes a part, and redraws the panel. */
function flip(key: string, redraw: () => void): void {
  remember((x) => { x.opened = x.opened.includes(key) ? x.opened.filter((y) => y !== key) : [...x.opened, key]; });
  redraw();
}

/** Whether the panel shows a review's lines in place of the review: Show output, remembered by run. */
export const showsLines = (run: string): boolean => isOpen(openKey(run, 'lines'));

/** A running review's time so far, as a clock: "0:42", "12:05", "1:02:05". */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return h ? `${h}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
}

let ticking: ReturnType<typeof setInterval> | undefined;
/** Moves every running review's clock on each second, while one is on the page. */
function tick(): void {
  if (ticking) return;
  ticking = setInterval(() => {
    const clocks = document.querySelectorAll<HTMLElement>('.dr-clock[data-start]');
    if (!clocks.length) { clearInterval(ticking); ticking = undefined; return; }
    for (const c of clocks) c.textContent = clock(Date.now() - Number(c.dataset.start));
  }, 1000);
}

/** The next step, the header line's one primary button; at 500 px its icon alone, its label still its name. */
function next(a: Action): HTMLElement {
  const b = el('button', 'btn primary dr-next', icon(a.icon), el('span', 'dr-btn-text', a.label)) as HTMLButtonElement;
  b.type = 'button';
  b.title = a.label;
  b.setAttribute('aria-label', a.label);
  b.addEventListener('click', () => api.postMessage({ type: 'run', command: a.command, ref: a.ref }));
  return b;
}

/**
 * A finding's file and line: the task page's link. In the row, the file's name and line, which say the most in
 * little room; in its detail, the whole path. Its title names the whole place, and why when it's off.
 */
function rowPlace(r: DockReviewRow, short: boolean): HTMLElement | null {
  const f = r.finding;
  if (!f?.place) return null;
  const b = place(short ? { ...f, place: f.place.split('/').pop()! } : f)!;
  // In the row, a name too long for its room is cut, and its line stays whole.
  const mono = short ? b.querySelector('.mono') : null;
  const at = /^(.*?)(:\d+)$/.exec(mono?.textContent ?? '');
  if (mono && at) {
    mono.replaceChildren(el('span', 'dr-file', at[1]!), el('span', 'dr-at', at[2]!));
    // Its own class, a flex line, so the task page's .mono, which a table cell also wears, keeps its layout.
    mono.classList.replace('mono', 'dr-where');
  }
  b.title = f.opens ? `Open ${f.place} in the task's checkout` : `${f.place}\n\n${f.off ?? ''}`.trim();
  return b;
}

/** What a row shows once opened: a criterion's evidence, or a finding's message whole, its kind, note and lines. */
function detail(r: DockReviewRow): HTMLElement {
  const f = r.finding;
  if (!f) return el('div', 'dr-detail', work(el('p', 'dr-evidence', r.evidence ?? 'The reviewer gave no evidence.'), 'transcript'));
  return el('div', 'dr-detail',
    work(el('p', 'dr-message', f.message), 'transcript'),
    f.kind ? el('p', 'muted small', f.kind) : null,
    rowPlace(r, false),
    f.note ? el('p', 'muted small', f.note) : null,
    f.excerpt ? excerpt(f.excerpt) : null);
}

/** One row: a toggle with its state and text on one line, the file and line at its right, and its detail once open. */
function row(run: string, r: DockReviewRow, redraw: () => void): HTMLElement {
  const key = openKey(run, r.key);
  const open = isOpen(key);
  const toggle = el('button', 'dr-toggle', icon(open ? 'chevron-down' : 'chevron-right'), status(r.look), work(el('span', 'dr-text', r.text), 'transcript')) as HTMLButtonElement;
  toggle.type = 'button';
  toggle.title = r.text;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.addEventListener('click', () => flip(key, redraw));
  const li = el('li', `dr-row tone-row-${r.look.tone}${open ? ' open' : ''}`, el('div', 'dr-line', toggle, rowPlace(r, true)), open ? detail(r) : null);
  li.dataset.row = r.key;
  return li;
}

/** The met criteria, folded into one row that opens to list them. */
function metRow(run: string, met: NonNullable<Extract<DockReview, { phase: 'done' }>['met']>, redraw: () => void): HTMLElement {
  const key = openKey(run, 'met');
  const open = isOpen(key);
  const toggle = el('button', 'dr-toggle', icon(open ? 'chevron-down' : 'chevron-right'), status(met.look)) as HTMLButtonElement;
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.addEventListener('click', () => flip(key, redraw));
  const li = el('li', `dr-row dr-met${open ? ' open' : ''}`, el('div', 'dr-line', toggle),
    open ? el('ul', 'dr-detail dr-met-list', ...met.items.map((t) => el('li', '', icon('check', 'blue'), work(el('span', '', t), 'transcript')))) : null);
  li.dataset.row = 'met';
  return li;
}

/** The summary in two lines, More opening the rest with the sentence for the client after it. */
function summary(run: string, r: Extract<DockReview, { phase: 'done' }>, redraw: () => void): HTMLElement {
  const key = openKey(run, 'summary');
  const open = isOpen(key);
  const text = work(el('p', `dr-summary${open ? '' : ' clamped'}`, r.summary), 'transcript');
  if (!open) text.style.setProperty('--lines', '2');
  const more = el('button', 'btn ghost small dr-more', open ? 'Less' : 'More') as HTMLButtonElement;
  more.type = 'button';
  more.setAttribute('aria-expanded', String(open));
  more.addEventListener('click', () => flip(key, redraw));
  const box = el('div', 'dr-summary-box', text, open && r.client ? el('p', 'dr-client', el('span', 'strong', 'For the client: '), work(el('span', '', r.client), 'transcript')) : null, more);
  // A summary that fits its two lines, with no client sentence, has nothing more to open: checked once it's on the page.
  if (!open && !r.client) requestAnimationFrame(() => { if (text.scrollHeight <= text.clientHeight + 2) more.remove(); });
  return box;
}

/** A finished review: the header line, the summary, the rows, then the met criteria. */
function done(run: string, r: Extract<DockReview, { phase: 'done' }>, redraw: () => void): HTMLElement {
  const head = el('div', 'dr-head', status(r.look), el('span', 'tcard-key dr-key', r.task), el('span', 'muted dr-count', r.count), el('span', 'spacer'), next(r.next));
  const at = Date.parse(r.at);
  head.title = `Reviewed by ${r.by}${Number.isFinite(at) ? `, ${new Date(at).toLocaleString()}` : ''}.${r.took ? ` It took ${r.took}.` : ''}`;
  const rows = [...r.rows.map((x) => row(run, x, redraw)), r.met ? metRow(run, r.met, redraw) : null].filter((x): x is HTMLElement => !!x);
  return el('div', 'dr', head, summary(run, r, redraw), rows.length ? el('ol', 'dr-rows', ...rows) : null);
}

/** A running review: one line, its task, its commit and the time so far, the spinner its quiet progress mark. */
function running(r: Extract<DockReview, { phase: 'running' }>): HTMLElement {
  const time = el('span', 'muted dr-clock', clock(Date.now() - r.startedAt));
  // Once the run ends, its verdict being read, the clock stops.
  if (r.live) { time.dataset.start = String(r.startedAt); tick(); }
  return el('div', 'dr dr-running', el('div', 'dr-head', status(r.look), el('span', 'tcard-key dr-key', r.task), r.sha ? el('span', 'muted mono dr-sha', r.sha) : null, time));
}

/**
 * The panel's body for a review run: the review, or the run's lines, on Show output and for a review with no
 * verdict, which says why above them.
 */
export function renderDockReview(run: string, r: DockReview, redraw: () => void): { above: HTMLElement | null; lines: boolean } {
  if (r.phase === 'unread') return { above: el('p', 'dr-why', icon(r.look.icon, r.look.tone), el('span', '', r.why)), lines: true };
  if (showsLines(run)) return { above: null, lines: true };
  const above = r.phase === 'running' ? running(r) : done(run, r, redraw);
  above.dataset.run = run;
  return { above, lines: false };
}
