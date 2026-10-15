// A task's review on its page (T-53): the verdict, then each finding with its file and line, and the lines
// of the change around it. The extension reads the lines; the page only draws them, and a click on a file
// and line asks the extension to open it there.

import type { Excerpt, ExcerptLine } from '../src/logic/review-excerpts.ts';
import type { ReviewFinding, TicketReview } from '../src/model/task-page.ts';
import { button, el, icon, status, when, work } from './dom.ts';
import { api } from './state.ts';

/** An added or removed line's mark, named for a screen reader; an unchanged line's is blank. */
function sign(mark: ExcerptLine['mark']): HTMLElement {
  const s = el('span', 'rv-sign', mark === 'add' ? '+' : mark === 'del' ? '−' : ' ');
  if (mark === 'same') s.setAttribute('aria-hidden', 'true');
  else {
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', mark === 'add' ? 'added' : 'removed');
  }
  return s;
}

/** The lines around a finding: each with its number, its mark and its text, the finding's own line marked. */
function excerpt(x: Excerpt): HTMLElement {
  const lines = x.lines.map((l) => el('div', `rv-l${l.mark === 'same' ? '' : ` rv-${l.mark}`}${l.at ? ' rv-at' : ''}`, el('span', 'rv-n', l.n === null ? '' : String(l.n)), sign(l.mark), el('span', 'rv-t', l.text)));
  return work(el('div', 'rv-excerpt', ...lines), 'files');
}

/** A finding's file and line: a link that opens it in the task's checkout, or off, with why. */
function place(f: ReviewFinding): HTMLElement | null {
  if (!f.place) return null;
  const b = el('button', 'rv-place', icon('go-to-file'), work(el('span', 'mono', f.place), 'files')) as HTMLButtonElement;
  b.type = 'button';
  if (f.opens) {
    const opens = f.opens;
    b.title = `Open ${f.place} in the task's checkout`;
    b.addEventListener('click', () => api.postMessage({ type: 'review-file', ...opens }));
  } else {
    b.disabled = true;
    b.title = f.off ?? '';
  }
  return b;
}

function finding(f: ReviewFinding): HTMLElement {
  return el('li', 'rv-finding',
    el('div', 'rv-top', status(f.look), f.kind ? el('span', 'muted small rv-kind', f.kind) : null),
    work(el('div', 'rv-message', f.message), 'transcript'),
    place(f),
    f.note ? el('p', 'muted small rv-note', f.note) : null,
    f.excerpt ? excerpt(f.excerpt) : null);
}

/** The Review block under the Agent panel: the verdict and its count, the summary, who and when, then each finding. */
export function renderReview(r: TicketReview): HTMLElement {
  const open = r.open;
  return el('section', `side-panel side-review${r.look.tone === 'orange' ? ' attention' : ''}`, el('h2', '', icon('checklist'), 'Review'),
    el('div', 'rv-head', status(r.look), el('span', 'muted small', r.count)),
    work(el('p', 'rv-summary', r.summary), 'transcript'),
    el('p', 'muted small', `By ${r.by}, `, when(r.at)),
    r.stale ? el('p', 'muted small', icon('history'), ' ', r.stale) : null,
    r.gone ? el('p', 'muted small', icon('warning'), ' ', r.gone) : null,
    r.findings.length ? el('ol', 'rv-list', ...r.findings.map(finding)) : null,
    open ? el('div', 'actions', button('Open the review', 'comment-discussion', () => api.postMessage({ type: 'rule-open-review', ...open }), 'ghost')) : null);
}
