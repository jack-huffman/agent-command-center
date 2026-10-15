// The Setup section: the checklist, with Do it on each step and its output.

import type { Action } from '../src/model/shared.ts';
import type { RunCard } from '../src/model/runs.ts';
import type { SetupModel, SetupRow, SetupStart } from '../src/model/setup.ts';
import { redrawDock } from './dock.ts';
import { actionButton, button, el, header, icon, plural, status, titled, toolbarButton, work } from './dom.ts';
import { api, memory, type PageArea, remember } from './state.ts';

/** A step's fix while it runs, or how it ended: one line, and a way to its output. */
function stepRun(r: RunCard | undefined, open: boolean): HTMLElement | null {
  // A failed run matters only while its step is still to do.
  if (!r || (!r.running && !(open && r.look.tone === 'orange'))) return null;
  const show = button('Show output', 'output', () => { remember((x) => { x.dock = { open: true, run: r.id }; }); redrawDock(); }, 'ghost small');
  return el('div', `step-run tone-row-${r.look.tone}`, status(r.look), titled(el('span', 'muted step-run-cmd', r.label), r.label), show);
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
    s.does ? el('p', 'muted small step-does', icon('wrench'), `Do it: ${s.does}.`) : null,
    fixLine(s),
    run,
    el('div', 'actions', ...s.actions.map(actionButton)));
}

/**
 * A step's command line (GH-168). One the page names as a process is folded away, shown on request for
 * someone who runs it by hand, and is work data: the line as the tool takes it. Advice with no process stays shown.
 */
function fixLine(s: SetupRow): HTMLElement | null {
  if (!s.fix) return null;
  if (!s.does) return el('pre', 'fix', s.fix);
  return el('details', 'fix-line', el('summary', 'muted small', 'Show the command'), work(el('pre', 'fix', s.fix), 'output'));
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

/**
 * A folder that isn't set up (GH-138): what kind of project it is, the first thing This project asks. Its
 * heading is where the Command Center's first open in the folder lands, once this machine is ready.
 */
function startCard(s: SetupStart): HTMLElement {
  const h = el('h3', 'start-question', icon('question'), s.question);
  h.dataset.part = s.part;
  h.tabIndex = -1;
  return el('div', 'setup-start', h, el('p', 'detail', s.detail), el('div', 'actions', ...s.actions.map(actionButton)));
}

export function renderSetup(m: SetupModel, live: RunCard[] = []): Node[] {
  const todo = m.total - m.done;
  const summary = m.total ? `${m.done} of ${m.total} steps done${todo ? `. ${plural(todo, 'step')} to do.` : m.start ? '.' : '. Everything is set up.'}` : 'Checking…';
  // The walkthroughs open only when asked for, from here or VSCode's Get Started page (GH-138).
  const out: Node[] = [header('Setup', m.start ? `${summary} This folder isn't set up yet.` : summary,
    toolbarButton('acc.openMachineWalkthrough', 'Machine walkthrough', 'device-desktop'),
    toolbarButton('acc.openProjectWalkthrough', 'Project walkthrough', 'repo'))];
  if (m.total) {
    const bar = el('div', 'progress');
    bar.setAttribute('role', 'progressbar');
    // Named, and read as the summary over it says it (T-59).
    bar.setAttribute('aria-label', 'Setup steps done');
    bar.setAttribute('aria-valuetext', `${m.done} of ${m.total}`);
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
    const start = part.part === 'project' && m.start ? startCard(m.start) : null;
    const count = part.todo ? `${part.todo} to do` : start ? 'not set up' : 'all done';
    const h = el('h2', '', icon(part.part === 'machine' ? 'device-desktop' : 'repo'), part.label, el('span', 'count', count));
    // The first open in a folder that isn't set up lands on the machine's while it has steps to do (GH-138).
    h.dataset.part = part.jump;
    h.tabIndex = -1;
    out.push(el('section', 'block', h, start, ...sections));
  }
  return out;
}

export const area: PageArea = {
  sections: { setup: { draw: (m) => renderSetup(m.setup, m.runs) } },
  views: { setup: (m) => renderSetup(m) },
  fallback: true,
};
