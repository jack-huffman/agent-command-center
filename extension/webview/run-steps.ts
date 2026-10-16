// A run of acc in the output panel as a list of steps (T-65): acc reports each step it takes, and the panel
// lists them under the header line, each with its icon and label. A step running has a quiet spinner; a
// failed one says why, and opens to the rows it printed. The run's output rows fold under the list in one
// row, "Show 42 lines". The steps come from the model (model/run-steps.ts).

import type { RunCard } from '../src/model/runs.ts';
import type { ShownStep } from '../src/model/run-steps.ts';
import type { ShownRow } from '../src/model/run-view.ts';
import { el, icon, plural, status, work } from './dom.ts';
import { memory, remember, state } from './state.ts';

/** Opens or closes a part of a run, kept by key, and draws the page again. */
function toggle(key: string, open: boolean): void {
  remember((m) => { m.opened = open ? m.opened.filter((k) => k !== key) : [...m.opened, key]; });
  if (state.last) state.draw(state.last);
}

/** A step's mark: a failed one's icon and label, any other's icon alone, its label read out and on hover. */
function stepMark(s: ShownStep): HTMLElement {
  if (s.state === 'failed') return status(s.look);
  const m = el('span', `dock-step-mark tone-${s.look.tone}`, icon(s.look.icon, s.look.tone));
  m.setAttribute('role', 'img');
  m.setAttribute('aria-label', s.look.label);
  m.title = s.look.label;
  return m;
}

/** One step: its mark and label, and what acc said of it. A failed one with rows opens to them, kept open by run. */
function stepRow(run: RunCard, s: ShownStep, rows: (r: ShownRow[]) => HTMLElement): HTMLElement {
  const note = s.note ? work(el('span', 'muted dock-step-note', s.note), 'output') : null;
  const label = el('span', 'dock-step-label', s.label);
  const li = el('li', `dock-step state-${s.state}${s.rows.length ? ' has-rows' : ''}`);
  li.title = `${s.label}: ${s.look.label}${s.note ? `. ${s.note}` : ''}`;
  if (!s.rows.length) {
    li.append(el('div', 'dock-step-head', stepMark(s), label), note ?? '');
    return li;
  }
  const key = `run-step:${run.id}:${s.id}`;
  const open = memory().opened.includes(key);
  // Named by what it shows, its state then its label, with a space between so they read as two words; open or not, aria-expanded says.
  const head = el('button', 'dock-step-toggle dock-step-head', icon(open ? 'chevron-down' : 'chevron-right'), stepMark(s), ' ', label) as HTMLButtonElement;
  head.type = 'button';
  head.title = `${open ? 'Hide' : 'Show'} its ${plural(s.rows.length, 'row')}`;
  head.setAttribute('aria-expanded', String(open));
  head.addEventListener('click', () => toggle(key, open));
  li.append(head, note ?? '', open ? rows(s.rows) : '');
  return li;
}

/**
 * The panel's body for a run of acc with steps: the list of steps, then its output rows folded in one row,
 * which opens to them. `rows` draws a list of rows; `output` is the run's own rows, drawn only when open.
 */
export function renderRunSteps(run: RunCard, steps: ShownStep[], rows: (r: ShownRow[]) => HTMLElement, output: () => HTMLElement): HTMLElement[] {
  const list = el('ol', 'dock-steps', ...steps.map((s) => stepRow(run, s, rows)));
  list.setAttribute('aria-label', `Steps of ${run.label}`);
  if (!run.lineCount) return [list];
  const key = `run-lines:${run.id}`;
  const open = memory().opened.includes(key);
  const words = `${open ? 'Hide' : 'Show'} ${plural(run.lineCount, 'line')}`;
  const fold = el('button', 'dock-output-fold', icon(open ? 'chevron-down' : 'chevron-right'), el('span', 'dock-output-fold-text', words)) as HTMLButtonElement;
  fold.type = 'button';
  fold.title = `${words} of output`;
  fold.setAttribute('aria-expanded', String(open));
  fold.addEventListener('click', () => toggle(key, open));
  return [list, fold, ...(open ? [output()] : [])];
}
