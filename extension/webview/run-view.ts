// A run in the output panel as rows (T-64), never a block of raw lines: each line of output is a success, a
// warning, an error, a count of progress or a note, in the page's own type. Its URLs are links and its file
// paths quiet chips, which open when they're in the folder it ran in. An ended run ends with a result card:
// what happened in one sentence, and one next step. The rows come from the model (logic/run-rows.ts).

import type { RowPart } from '../src/logic/run-rows.ts';
import type { RunCard } from '../src/model/runs.ts';
import type { RunResult, ShownRow } from '../src/model/run-view.ts';
import { el, icon, linkTo, plural, status, work } from './dom.ts';
import { api, go } from './state.ts';

/** A path's chip: a button that opens it, in the folder the run ran in, or a quiet label that says why it doesn't. */
function chip(run: string, p: Extract<RowPart, { path: string }>): HTMLElement {
  const text = `${p.path}${p.line ? `:${p.line}` : ''}`;
  if (!p.opens) {
    const off = el('span', 'dock-chip off', icon('file'), el('span', 'dock-chip-text', text));
    off.title = `${text}\n\nIt's outside the folder this ran in, so it doesn't open from here.`;
    return off;
  }
  const b = el('button', 'dock-chip', icon('file'), el('span', 'dock-chip-text', text)) as HTMLButtonElement;
  b.type = 'button';
  b.title = `Open ${p.opens}${p.line ? ` at line ${p.line}` : ''}`;
  // Its name holds the words it shows, as a screen reader's user hears and says them.
  b.setAttribute('aria-label', `Open ${text}`);
  const opens = p.opens;
  b.addEventListener('click', () => api.postMessage({ type: 'run-file', run, file: opens, ...(p.line ? { line: p.line } : {}) }));
  return b;
}

/** A row's words, URLs and paths. */
function words(run: string, parts: RowPart[]): HTMLElement {
  return work(el('span', 'dock-text', ...parts.map((p) => ('url' in p ? linkTo(p.url, p.url) : 'path' in p ? chip(run, p) : p.text))), 'output');
}

/** A row's mark: a warning's and an error's icon and label; any other's icon alone, its label read out and on hover. */
function mark(r: ShownRow): HTMLElement {
  if (r.kind === 'warning' || r.kind === 'error') return status(r.look);
  const m = el('span', `dock-mark tone-${r.look.tone}`, icon(r.look.icon, r.look.tone));
  m.setAttribute('role', 'img');
  m.setAttribute('aria-label', r.look.label);
  m.title = r.look.label;
  return m;
}

/** A count of progress as a thin bar, with how far it's got in per cent: the row's words say it as written. */
function meter(p: NonNullable<ShownRow['progress']>): HTMLElement {
  const fill = el('span', 'dock-meter-fill');
  fill.style.width = `${Math.round(p.done * 100)}%`;
  const bar = el('span', 'dock-meter', fill);
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', String(Math.round(p.done * 100)));
  bar.setAttribute('aria-label', `${p.label} along`);
  return el('span', 'dock-progress', bar, el('span', 'muted dock-meter-text', `${Math.round(p.done * 100)}%`));
}

/** One row: its mark, its words, and for a count of progress its bar; a line that came again says how often. */
function runRow(run: string, r: ShownRow): HTMLElement {
  const count = r.count > 1 ? el('span', 'dock-count', `×${r.count}`) : null;
  if (count) count.title = `This line came ${r.count} times in a row.`;
  const li = el('li', `dock-row kind-${r.kind}`, mark(r), words(run, r.parts), r.progress ? meter(r.progress) : null, count);
  li.title = r.text;
  return li;
}

/** The result card's one next step: the step the run was for, on Setup, or the run again. At 500 px its icon alone. */
function next(run: RunCard, n: NonNullable<RunResult['next']>): HTMLElement {
  const b = el('button', 'btn primary dock-next', icon(n.icon), el('span', 'dock-next-text', n.label)) as HTMLButtonElement;
  b.type = 'button';
  b.title = n.label;
  b.setAttribute('aria-label', n.label);
  b.addEventListener('click', () => {
    if (n.kind === 'rerun') { api.postMessage({ type: 'run-control', run: run.id, action: 'rerun' }); return; }
    go('setup');
    document.querySelector<HTMLElement>(`[data-step="${CSS.escape(n.step)}"]`)?.scrollIntoView({ block: 'center' });
  });
  return b;
}

/** How an ended run ended: its state and what happened, a failure's last error and its exit code in words, and its next step. */
function resultCard(run: RunCard, r: RunResult): HTMLElement {
  return el('div', `dock-result tone-row-${r.look.tone}`,
    el('div', 'dock-result-head', status(r.look), el('span', 'dock-result-text', r.sentence), el('span', 'spacer'), r.next ? next(run, r.next) : null),
    r.error ? el('ol', 'dock-rows', runRow(run.id, r.error)) : null,
    r.exit ? el('p', 'muted dock-exit', r.exit) : null);
}

/**
 * The panel's body for a run: its rows, which scroll under the header line, the newest last; the rows not
 * shown counted in one line above them; and once it ended, its result card. A review shows its rows on Show
 * output, with no card, since its review says how it went.
 */
export function renderRunRows(run: RunCard): HTMLElement {
  const rows = run.rows.length ? el('ol', 'dock-rows', ...run.rows.map((r) => runRow(run.id, r)))
    : el('p', 'muted', run.running ? 'Nothing yet. Its output shows here as it comes.' : 'It printed nothing.');
  const box = el('div', 'dock-body', rows, run.result ? resultCard(run, run.result) : null);
  box.dataset.run = run.id;
  box.tabIndex = 0;
  box.setAttribute('aria-label', `Output of ${run.label}`);
  box.setAttribute('aria-live', 'polite');
  const hidden = run.hidden ? el('p', 'muted dock-hidden', icon('fold-up'), `${plural(run.hidden, 'earlier row')} not shown. Copy log has all of it.`) : null;
  return el('div', 'dock-output', hidden, box);
}
