// The planning agent's progress (T-131), in the conversation's panel and the task page's plan section: how long it
// has worked, what it does now, its last few steps, and how long since it moved. The extension tells it about once a
// second; each block on the page is drawn again in place, so the box being typed in and the page's scroll stay put.
// What the agent wrote, a path or a search, is work data.

import type { PlanProgress, StepLine } from '../src/model/plan-progress.ts';
import { button, el, icon, status, work } from './dom.ts';
import { api, type PageArea } from './state.ts';

/** The newest progress each task was told, by project and task: a redraw of the page draws it, not the model's older one. */
const told = new Map<string, PlanProgress>();
const keyOf = (project: string, task: string): string => `${project}#${task.toUpperCase()}`;

function step(s: StepLine, now: boolean): HTMLElement {
  return el('li', now ? 'pp-step pp-now' : 'pp-step muted', icon(s.icon),
    el('span', 'pp-words', s.words, s.data ? ' ' : null, s.data ? work(el('code', 'pp-data', s.data), 'transcript') : null),
    el('span', 'pp-ago small muted', s.ago));
}

/** The block's contents: its state and time, the step now and the ones before, then a stall's line and buttons. */
function contents(project: string, task: string, p: PlanProgress): Node[] {
  const head = el('div', 'pp-head', status(p.look), el('span', 'pp-heading', p.heading), el('span', 'pp-elapsed muted small', p.elapsed));
  const facts = [p.last, p.typical].filter((x): x is string => !!x);
  const out: Node[] = [head, el('ol', 'pp-steps', step(p.now, true), ...p.earlier.map((s) => step(s, false)))];
  if (facts.length) out.push(el('p', 'pp-facts muted small', facts.join(' · ')));
  if (p.stalled) {
    const buttons: HTMLElement[] = [];
    if (p.stalled.watch) buttons.push(button('Watch its session', 'pulse', () => api.postMessage({ type: 'plan-watch', project, task }), 'small'));
    if (p.stalled.stop) buttons.push(button('Stop', 'debug-stop', () => api.postMessage({ type: 'plan-stop', project, task }), 'small'));
    out.push(el('div', 'pp-stalled', icon('warning', 'orange'), el('span', '', p.stalled.words), ...buttons));
  }
  return out;
}

/**
 * The task's progress block, drawn from the newest it was told, or the model's; null with neither. A model with
 * none forgets what was told, so a job that ended doesn't come back on the next.
 */
export function planProgressBlock(project: string, task: string, p: PlanProgress | null): HTMLElement | null {
  const k = keyOf(project, task);
  if (!p) { told.delete(k); return null; }
  const shown = told.get(k) ?? p;
  const box = el('div', `pp tone-edge-${shown.look.tone}`, ...contents(project, task, shown));
  box.dataset.progress = k;
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', `The planning agent: ${shown.look.label}`);
  return box;
}

/** The extension's progress for a task: each of its blocks on the page is drawn again in place. */
function receive(msg: { project?: string; task?: string; progress?: PlanProgress }): void {
  if (!msg.project || !msg.task || !msg.progress) return;
  const k = keyOf(msg.project, msg.task);
  told.set(k, msg.progress);
  for (const box of document.querySelectorAll<HTMLElement>('.pp')) {
    if (box.dataset.progress !== k) continue;
    box.className = `pp tone-edge-${msg.progress.look.tone}`;
    box.setAttribute('aria-label', `The planning agent: ${msg.progress.look.label}`);
    box.replaceChildren(...contents(msg.project, msg.task, msg.progress));
  }
}

export const area: PageArea = {
  receive: { 'plan-progress': receive },
};
