// The Setup section: the checklist, with Do it on each step and its output.

import type { Action } from '../src/model/shared.ts';
import type { RunCard } from '../src/model/runs.ts';
import type { SetupModel, SetupRow } from '../src/model/setup.ts';
import { redrawDock } from './dock.ts';
import { actionButton, button, el, header, icon, plural, status, titled, toolbarButton } from './dom.ts';
import { api, memory, type PageArea, remember } from './state.ts';

/** A step's fix while it runs, or how it ended: one line, and a way to its output. */
function stepRun(r: RunCard | undefined, open: boolean): HTMLElement | null {
  // A failed run matters only while its step is still to do.
  if (!r || (!r.running && !(open && r.look.tone === 'orange'))) return null;
  const show = button('Show output', 'output', () => { remember((x) => { x.dock = { open: true, run: r.id }; }); redrawDock(); }, 'ghost small');
  return el('div', `step-run tone-row-${r.look.tone}`, status(r.look), titled(el('span', 'muted mono step-run-cmd', r.command), r.command), show);
}

/**
 * One setup step. To do: what's wrong, in a sentence, and what to do about it. Done: one muted line, with
 * Check again on hover. The step's id stays out of sight; why it matters is the title's tooltip.
 */
function setupStep(s: SetupRow, live: RunCard[]): HTMLElement {
  const title = el('span', 'strong', s.title);
  if (s.why) title.title = s.why;
  const run = stepRun(live.find((r) => r.step === s.id), !s.done);
  if (s.done) {
    const again = s.actions.find((a) => a.command === 'acc.step.check');
    return el('li', 'step done', status(s.look), title, titled(el('span', 'muted step-line', s.detail), s.detail), run, again ? iconButton(again) : null);
  }
  return el('li', 'step attention',
    el('div', 'step-head', status(s.look), title),
    el('p', 'detail', s.detail),
    s.fix ? el('pre', 'fix', s.fix) : null,
    run,
    el('div', 'actions', ...s.actions.map(actionButton)));
}

/** An action as a small icon button, named for screen readers and on hover. */
function iconButton(a: Action): HTMLElement {
  const b = el('button', 'icon-btn', icon(a.icon)) as HTMLButtonElement;
  b.type = 'button';
  b.title = `${a.label} again`;
  b.setAttribute('aria-label', `${a.label} again`);
  b.addEventListener('click', () => api.postMessage({ type: 'run', command: a.command, ref: a.ref }));
  return b;
}

export function renderSetup(m: SetupModel, live: RunCard[] = []): Node[] {
  const todo = m.total - m.done;
  const out: Node[] = [header('Setup', m.total ? `${m.done} of ${m.total} steps done${todo ? `. ${plural(todo, 'step')} to do.` : '. Everything is set up.'}` : 'Checking…',
    toolbarButton('acc.openProjectWalkthrough', 'Walkthrough', 'checklist'))];
  if (m.total) {
    const bar = el('div', 'progress');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuenow', String(m.done));
    bar.setAttribute('aria-valuemax', String(m.total));
    const fill = el('div', 'progress-fill');
    fill.style.width = `${Math.round((m.done / m.total) * 100)}%`;
    bar.append(fill);
    out.push(bar);
  }
  // In the order you'd set things up, a section for each thing being set up (D-047). Done steps sit muted
  // in one line; a section with nothing left to do folds away, unless you open it.
  const opened = memory().sections ?? {};
  for (const part of m.parts) {
    const sections = part.sections.map((sec) => {
      const key = `${part.part}:${sec.key}`;
      const d = el('details', `setup-section${sec.todo ? '' : ' all-done'}`) as HTMLDetailsElement;
      d.open = opened[key] ?? sec.todo > 0;
      d.addEventListener('toggle', () => remember((x) => { x.sections = { ...(x.sections ?? {}), [key]: d.open }; }));
      const count = sec.todo ? el('span', 'count tone-orange', `${sec.todo} to do`) : el('span', 'count done-count', icon('check'), sec.steps.length === 1 ? 'Done' : `All ${sec.steps.length} done`);
      d.append(el('summary', '', el('span', 'tool-chev', icon('chevron-right')), el('span', 'setup-section-title', sec.title), count),
        el('ul', 'steps', ...sec.steps.map((s) => setupStep(s, live))));
      return d;
    });
    out.push(el('section', 'block', el('h2', '', icon(part.part === 'machine' ? 'device-desktop' : 'repo'), part.label, el('span', 'count', part.todo ? `${part.todo} to do` : 'all done')), ...sections));
  }
  return out;
}

export const area: PageArea = {
  sections: { setup: { draw: (m) => renderSetup(m.setup, m.runs) } },
  views: { setup: (m) => renderSetup(m) },
  fallback: true,
};
