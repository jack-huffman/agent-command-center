// In progress on the Overview: every job under way, a group a task.

import type { ProgressAction, ProgressGroup, ProgressModel } from '../src/progress.ts';
import { el, icon, openable, status, titled } from './dom.ts';
import { api, memory, remember, state } from './state.ts';

/**
 * In progress (D-092): every job under way, grouped by task, busiest first, with the machine on top. Its
 * heading folds it to the heading, remembered for the tab. A job that ended stays a minute as a line that
 * fades; the fade starts as far in as the job is old, by the extension's clock, so a redraw never restarts it.
 */
export function renderInProgress(p: ProgressModel): HTMLElement {
  const open = memory().sections?.['in-progress'] ?? true;
  const toggle = el('button', 'progress-toggle', el('span', 'tool-chev', icon('chevron-right')), icon('pulse', p.count ? 'blue' : undefined), 'In progress', p.count ? el('span', 'count', String(p.count)) : null) as HTMLButtonElement;
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.title = open ? 'Fold In progress to its heading' : 'Show what\'s in progress';
  toggle.addEventListener('click', () => {
    remember((m) => { m.sections = { ...(m.sections ?? {}), 'in-progress': !open }; });
    if (state.last) state.draw(state.last);
  });
  const box = el('section', `in-progress${open ? ' open' : ''}`, el('h2', '', toggle));
  if (!open) return box;
  if (p.empty) {
    box.append(el('p', 'muted quiet', p.empty));
    return box;
  }
  if (p.machine.length) {
    box.append(el('div', 'machine-line', ...p.machine.map((c) => Object.assign(status(c.look), { title: c.tip }))));
  }
  if (!p.groups.length) box.append(el('p', 'muted quiet', 'No task here has anything under way.'));
  for (const g of p.groups) box.append(progressGroup(g));
  return box;
}

function progressGroup(g: ProgressGroup): HTMLElement {
  const key = el('span', 'tcard-key', g.id);
  const head = el('div', 'pg-head', el('div', 'pg-name', key, titled(el('span', 'pg-title', g.title), g.title), g.project ? el('span', 'chip', g.project) : null),
    el('div', 'pg-state', status(g.look), g.since ? el('span', 'muted small pg-since', icon('watch'), g.since) : null));
  if (g.ref) openable(key, { type: 'run', command: 'acc.task.show', ref: g.ref }).title = `Open ${g.id}'s page`;
  const box = el('div', 'progress-group', head);
  if (g.note) box.append(el('div', 'muted small pg-note', g.note));
  for (const j of g.jobs) {
    box.append(el('div', `pg-row tone-row-${j.look.tone}`, status(j.look),
      el('div', 'pg-text', el('div', '', el('span', 'strong', j.label), j.since ? el('span', 'muted small', ` · ${j.since}`) : null),
        j.detail ? Object.assign(el('div', 'muted small pg-detail', j.detail), { title: j.detail }) : null,
        j.meta ? el('div', 'muted small pg-meta', j.meta) : null),
      el('div', 'actions', ...j.actions.map(progressButton))));
  }
  for (const d of g.done) {
    const line = el('div', 'pg-done', status(d.look), el('span', 'pg-done-text', d.text));
    line.style.animationDelay = `-${d.age}s`;
    box.append(line);
  }
  return box;
}

/** A row's button. Each says what it does on hover; Stop goes through the extension, which asks first. */
function progressButton(a: ProgressAction): HTMLElement {
  const b = el('button', `btn small${a.command === 'acc.job.stop' ? ' stop' : ' ghost'}`, icon(a.icon), a.label) as HTMLButtonElement;
  b.type = 'button';
  b.title = a.tip;
  b.addEventListener('click', () => {
    if (a.question) return answerHere(a.question);
    if (a.arg !== undefined && a.command) return api.postMessage({ type: 'toolbar', command: a.command, arg: a.arg });
    if (a.command && a.ref) api.postMessage({ type: 'run', command: a.command, ref: a.ref });
  });
  return b;
}

/** Answer: its question's card, in Needs you on this page, brought into view with its first answer focused. */
export function answerHere(id: string): void {
  const card = [...document.querySelectorAll<HTMLElement>('.question')].find((q) => q.dataset.question === id);
  if (!card) return;
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 1600);
  card.querySelector<HTMLElement>('button, textarea, input')?.focus({ preventScroll: true });
}
