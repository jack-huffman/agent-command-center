// Verify the developer's work on a task's page (T-84): the pull request acc found, or the ones to choose
// from, each check, each criterion met or not, the findings, and Open the QA comment, which goes to the
// comment's draft in the Activity below, to edit and post. Verify and Clear ask the extension, and show
// they're on their way until it says how they went; a refusal shows why, beside the buttons.

import type { TicketModel } from '../src/model/task-page.ts';
import type { TicketVerify, VerifyButton } from '../src/model/verify.ts';
import { button, el, icon, linkTo, status, when, work } from './dom.ts';
import { api, type PageArea, state } from './state.ts';

type Ask = 'verify-run' | 'verify-clear';

/** What's on its way, by project and task, and why the last one didn't go. */
const asked = new Map<string, Ask>();
const failed = new Map<string, string>();
const keyOf = (project: string, task: string): string => `${project}#${task.toUpperCase()}`;

function ask(m: TicketModel, v: TicketVerify, type: Ask, pr?: number): void {
  const key = keyOf(m.project, v.task);
  if (asked.has(key)) return;
  asked.set(key, type);
  failed.delete(key);
  api.postMessage({ type, project: m.project, task: v.task, ...(pr ? { pr } : {}) });
  if (state.last) state.draw(state.last);
}

/** A button of the section: off with why, or while another of its buttons is on its way. */
function action(m: TicketModel, v: TicketVerify, b: VerifyButton, type: Ask, iconName: string, cls: string, pr?: number): HTMLButtonElement {
  const busy = asked.get(keyOf(m.project, v.task));
  const label = busy === type && !pr ? (type === 'verify-run' ? 'Verifying…' : 'Clearing…') : b.label;
  const x = button(label, busy === type && !pr ? 'loading~spin' : iconName, () => ask(m, v, type, pr), cls);
  const why = b.disabled ?? (busy ? 'Wait for the one on its way' : null);
  x.disabled = !!why;
  if (why) x.title = why;
  return x;
}

/**
 * Open the QA comment: the draft's card in the Activity, scrolled to and its text ready to edit. False when
 * the card isn't on the page. `root` is the page, or what a test hands it.
 */
export function openComment(id: string, root: Pick<ParentNode, 'querySelectorAll'> = document): boolean {
  const card = [...root.querySelectorAll<HTMLElement>('[data-update]')].find((d) => d.dataset.update === id);
  if (!card) return false;
  card.scrollIntoView({ block: 'center' });
  card.querySelector<HTMLTextAreaElement>('textarea')?.focus();
  return true;
}

/** One row of a list: its state's icon and label, its words, and a muted line under them. */
const row = (look: TicketVerify['checks'][number]['look'], main: HTMLElement, sub: HTMLElement | null): HTMLElement =>
  el('li', 'vf-row', status(look), el('div', 'vf-text', main, sub));

/** The section: its state, the pull request, the checks, criteria and findings, and its buttons. */
export function renderVerify(m: TicketModel, v: TicketVerify): HTMLElement {
  const key = keyOf(m.project, v.task);
  const sec = el('section', `analysis verify tone-edge-${v.look.tone}`,
    el('div', 'an-head', el('h2', '', 'Verify the developer\'s work'), status(v.look), v.wording ? status(v.wording) : null, el('span', 'spacer'), v.at ? when(v.at) : null));
  sec.setAttribute('aria-label', `Verify the developer's work: ${v.look.label}`);
  if (v.note) sec.append(el('p', 'muted an-note', v.note));
  if (v.pr) {
    sec.append(el('p', 'vf-pr', icon('git-pull-request'), linkTo(v.pr.url, `Pull request #${v.pr.number}`), work(el('span', 'muted', v.pr.words.replace(/^#\d+ /, '')), 'branch'), el('span', 'muted', 'at'), work(el('span', 'mono', v.pr.sha), 'branch')));
  }
  if (v.summary) sec.append(work(el('p', 'an-summary', v.summary), 'agent-text'));
  if (v.choice?.length) {
    sec.append(el('ul', 'vf-list vf-choice', ...v.choice.map((c) => el('li', 'vf-row',
      icon('git-pull-request'),
      el('div', 'vf-text', linkTo(c.url, `#${c.number}`), work(el('span', 'vf-sub', c.words.replace(/^#\d+ /, '')), 'branch')),
      action(m, v, { label: 'Verify this one', disabled: v.verify.disabled }, 'verify-run', 'check', 'small', c.number)))));
  }
  if (v.checks.length) {
    sec.append(el('h3', 'vf-h', 'Checks'), el('ul', 'vf-list', ...v.checks.map((c) => row(c.look, work(el('span', 'mono', c.gate), 'output'), work(el('span', 'muted vf-sub', c.summary), 'output')))));
  }
  if (v.criteria.length) {
    sec.append(el('h3', 'vf-h', 'Acceptance criteria'), el('ul', 'vf-list', ...v.criteria.map((c) => row(c.look, work(el('span', '', c.text), 'agent-text'), c.evidence ? work(el('span', 'muted vf-sub', c.evidence), 'agent-text') : null))));
  }
  if (v.findings.length) {
    sec.append(el('h3', 'vf-h', 'Findings'), el('ul', 'vf-list', ...v.findings.map((f) => row(f.look, work(el('span', '', f.message), 'agent-text'), f.place ? work(el('span', 'muted mono vf-sub', f.place), 'files') : null))));
  }
  const error = failed.get(key);
  if (error) sec.append(el('div', 'notice attention', icon('warning', 'orange'), el('span', '', error)));
  const comment = v.comment;
  // The person's next step once there is a verification: the QA comment, to edit and post. Before one, Verify.
  const primary = (first: boolean): string => (first ? 'primary' : '');
  const open = comment ? button(comment.label, 'comment-draft', () => {
    if (comment.update && openComment(comment.update)) return;
    failed.set(key, 'The QA comment\'s draft isn\'t on this page. Look in the update drafts.');
    if (state.last) state.draw(state.last);
  }, primary(true)) : null;
  if (open && comment?.disabled) {
    open.disabled = true;
    open.title = comment.disabled;
  }
  sec.append(el('div', 'actions an-actions',
    open,
    action(m, v, v.verify, 'verify-run', v.pr ? 'refresh' : 'checklist', primary(!comment)),
    v.clear ? action(m, v, v.clear, 'verify-clear', 'trash', 'ghost') : null));
  return sec;
}

/** How a button went: done redraws with what acc did; a refusal shows why, to try again. */
function done(msg: { action?: string; project?: string; task?: string; ok?: boolean; error?: string }): void {
  const key = keyOf(msg.project ?? '', msg.task ?? '');
  if (!asked.has(key)) return;
  asked.delete(key);
  if (msg.ok) failed.delete(key);
  else failed.set(key, msg.error?.trim() || 'It didn\'t go, and acc didn\'t say why.');
  if (state.last) state.draw(state.last);
}

export const area: PageArea = {
  receive: { 'verify-done': done },
};
