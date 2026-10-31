// The deploy sheet (T-138): Deploy to <environment> on a task's Changes tab opens it, in the page's modal
// (modal.ts), and the extension runs the check, which changes nothing. It says the step the check is on, then
// the destination and its org, the components (folded), the tests that run, and what's left to do by hand,
// with how many. A failed check says why per component and offers nothing to deploy. Its Deploy is on only
// after a check that passed, and for production or a protected org only once the org's name is typed. Only
// that click sends the person's yes. Cancel, Escape and the backdrop always close it. It's drawn from the
// page's model on every draw, so it shows what the extension keeps: checking, deploying, and how it went.
// Deploy opens it at the click, loading, until a model holds its sheet (T-162).

import type { TicketModel } from '../src/model/task-page.ts';
import type { DeploySheet } from '../src/model/ticket-deploy.ts';
import { button, el, icon, linkTo, plural, status, work } from './dom.ts';
import { Opening } from './loading.ts';
import { makeModal } from './modal.ts';
import { api, onSent, type PageArea } from './state.ts';

let parts: { dialog: HTMLDialogElement; title: HTMLElement; body: HTMLElement; cancel: HTMLButtonElement; go: HTMLButtonElement } | null = null;
/** The ticket and sheet on show, and the name typed for a protected org, kept across draws. */
let shown: { project: string; sheet: DeploySheet } | null = null;
let typed = '';
let componentsOpen = false;
/** The sheet the person closed, by task, environment and step: a draw before the extension lets go of it doesn't open it again. */
let dismissed: string | null = null;
const sheetKey = (s: DeploySheet): string => `${s.task}>${s.to}:${s.phase}`;
/** The sheet's wait, from Deploy's click until a model holds its sheet (T-162), by `<task>>to`, and the project it's for. */
const waiting = new Opening();
let waitingFor: { project: string; task: string; to: string } | null = null;

/** Why the sheet's Deploy is off, or null when it's on: a passed check, and the org's name typed where it's asked. */
export function goOff(s: DeploySheet, name: string): string | null {
  if (s.phase === 'failed') return 'The check failed: there\'s nothing to deploy';
  if (s.phase !== 'passed' || !s.checkId) return 'Wait for the check to pass';
  // What holds the tab's Deploy up holds this one too: a check of its own that failed since, a conflict.
  if (s.off) return s.off;
  if (s.confirm && name.trim() !== s.confirm && name.trim() !== s.org) return `Type ${s.confirm} to deploy to it`;
  return null;
}

/** The person's yes: sent only from the sheet's own Deploy, while it's on. */
function go(): void {
  if (!shown || !parts || goOff(shown.sheet, typed)) return;
  const s = shown.sheet;
  api.postMessage({ type: 'deploy-go', project: shown.project, task: s.task, to: s.to, checkId: s.checkId!, ...(s.confirm ? { typed: typed.trim() } : {}) });
}

/** Cancel, Escape or the backdrop: the extension lets go of what it kept; a deploy under way goes on, and the tab says how. */
function shut(): void {
  if (waitingFor && !shown) {
    // Closed while it loaded: the extension lets go, and the check's first sheet, if it comes, opens nothing.
    api.postMessage({ type: 'deploy-close', project: waitingFor.project, task: waitingFor.task });
    dismissed = `${waitingFor.task}>${waitingFor.to}:checking`;
    waitingFor = null;
    waiting.end();
    if (parts?.dialog.open) parts.dialog.close();
    return;
  }
  if (!shown) return;
  api.postMessage({ type: 'deploy-close', project: shown.project, task: shown.sheet.task });
  dismissed = sheetKey(shown.sheet);
  shown = null;
  if (parts?.dialog.open) parts.dialog.close();
}

/** A fact of the sheet: its name, then what it says. */
const fact = (name: string, ...value: (Node | string | null)[]): HTMLElement[] => [el('dt', '', name), el('dd', '', ...value)];

/** The sheet's body for where it is now. */
function body(s: DeploySheet): HTMLElement[] {
  const out: HTMLElement[] = [el('p', 'dsh-state', status(s.progress ? { ...s.look, label: s.progress } : s.look))];
  if (s.step) out.push(el('p', 'muted small dsh-step', s.step));
  if (s.phase === 'checking' || (s.phase === 'deploying' && !s.components)) return out;
  const facts: HTMLElement[] = [...fact('Destination', el('strong', '', s.toName), s.org ? el('span', 'muted', ` · ${s.org}`) : null)];
  if (s.components) {
    const fold = button(componentsOpen ? 'Hide them' : 'Show them', componentsOpen ? 'chevron-down' : 'chevron-right', () => { componentsOpen = !componentsOpen; draw(); }, 'ghost small dsh-fold');
    fold.setAttribute('aria-expanded', String(componentsOpen));
    facts.push(...fact('Components', el('span', '', plural(s.components.count, 'component')), s.components.count ? fold : null,
      componentsOpen ? el('ul', 'dsh-list', ...s.components.types.map((t) => el('li', '', el('strong', '', t.name), ' ', work(el('span', 'mono', t.members.join(', ')), 'files')))) : null));
  }
  if (s.tests) facts.push(...fact('Tests', s.tests));
  facts.push(...fact('By hand', s.byHand.length ? el('ul', 'dsh-list', ...s.byHand.map((b) => el('li', '', el('strong', '', `${b.label}: ${b.items.length}`), ' ', work(el('span', 'muted', b.items.join(', ')), 'files')))) : el('span', 'muted', 'Nothing')));
  out.push(el('dl', 'fields dsh-facts', ...facts));
  if (s.phase === 'failed') {
    out.push(el('div', 'notice attention why dsh-failed', icon('warning', 'orange'), el('div', 'why-text', el('strong', '', 'Nothing can deploy until the check passes.'),
      s.problems.length ? el('ul', 'dsh-list', ...s.problems.map((p) => work(el('li', '', p), 'output'))) : work(el('p', '', s.summary ?? ''), 'output'))));
  }
  if (s.phase === 'passed' && s.summary) out.push(work(el('p', 'muted small', s.summary), 'output'));
  if (s.phase === 'passed' && s.confirm) {
    const box = document.createElement('input');
    box.type = 'text';
    box.className = 'ts-box dsh-name';
    box.id = 'dsh-name';
    box.value = typed;
    box.spellcheck = false;
    box.addEventListener('input', () => { typed = box.value; foot(); });
    const label = el('label', 'ts-label', `${s.toName} is protected. Type ${s.confirm} to deploy to it.`);
    label.setAttribute('for', 'dsh-name');
    out.push(el('div', 'ts-field dsh-confirm', label, box));
  }
  if (s.result) {
    out.push(el('div', 'dsh-result', el('p', '', s.result.summary), s.result.pr ? linkTo(s.result.pr.url, `Pull request #${s.result.pr.number}`) : null,
      s.result.warning ? el('div', 'notice attention', icon('warning', 'orange'), el('span', '', s.result.warning)) : null,
      s.byHand.length ? el('p', 'muted small', 'The steps left to do by hand are on the Changes tab, each with Mark done and Skip.') : null));
  }
  if (s.phase === 'passed' && s.off) out.push(el('p', 'muted small dp-why', icon('info'), el('span', '', s.off)));
  if (s.error) out.push(el('div', 'notice attention', icon('warning', 'orange'), el('span', '', s.error)));
  return out;
}

/** Cancel's words, and Deploy: shown only once a check passed, on only when goOff says so. */
function foot(): void {
  if (!parts || !shown) return;
  const s = shown.sheet;
  const done = s.phase === 'deployed' || s.phase === 'error' || s.phase === 'failed';
  parts.cancel.replaceChildren(icon('close'), done ? 'Close' : 'Cancel');
  parts.go.hidden = s.phase !== 'passed';
  const why = goOff(s, typed);
  parts.go.disabled = !!why;
  parts.go.title = why ?? `Deploy to ${s.toName}`;
  parts.go.replaceChildren(icon('cloud-upload'), `Deploy to ${s.toName}`);
}

function draw(): void {
  if (!parts || !shown) return;
  const s = shown.sheet;
  parts.title.textContent = `Deploy ${s.task} to ${s.toName}`;
  parts.dialog.setAttribute('aria-label', parts.title.textContent);
  const focused = document.activeElement?.id === 'dsh-name';
  parts.body.replaceChildren(...body(s));
  foot();
  if (focused) parts.body.querySelector<HTMLElement>('#dsh-name')?.focus();
}

function make(): NonNullable<typeof parts> {
  const title = el('h2', 'ds-title');
  const m = makeModal('deploy-sheet', [title], shut);
  const cancel = button('Cancel', 'close', () => shut(), 'ds-cancel');
  const goButton = button('Deploy', 'cloud-upload', () => go(), 'primary ds-go dsh-go');
  m.dialog.append(el('div', 'ds-foot', cancel, goButton));
  m.dialog.addEventListener('close', () => { if (shown || waitingFor) shut(); });
  return { dialog: m.dialog, title, body: m.body, cancel, go: goButton };
}

/** Deploy was clicked: the sheet opens now, loading, until a model holds the sheet for that task and place. */
function waitFor(project: string, task: string, to: string): void {
  parts ??= make();
  shown = null;
  waitingFor = { project, task, to };
  dismissed = null;
  parts.title.textContent = `Deploy ${task} to ${to}`;
  parts.dialog.setAttribute('aria-label', parts.title.textContent);
  parts.cancel.replaceChildren(icon('close'), 'Cancel');
  parts.go.hidden = true;
  waiting.start(`${task}>${to}`, parts.body, `Starting the check for ${task}…`, 'The deploy check', [],
    () => api.postMessage({ type: 'deploy-check', project, task, to }));
  if (!parts.dialog.open) parts.dialog.showModal();
  parts.cancel.focus();
}

/** After each draw of a task's page: the sheet shows what the model says, opening or closing with it. */
function syncSheet(m: TicketModel): void {
  const s = m.deploy?.sheet ?? null;
  // While it loads, a model with no sheet, or another's, leaves it loading; the sheet it waits for ends the wait.
  if (waitingFor && (!s || !waiting.waits(`${s.task}>${s.to}`))) return;
  if (s && waitingFor) {
    waitingFor = null;
    waiting.end();
  }
  if (!s || sheetKey(s) === dismissed) {
    if (!s) dismissed = null;
    const was = shown;
    shown = null;
    if (was && parts?.dialog.open) parts.dialog.close();
    return;
  }
  dismissed = null;
  const fresh = !shown || shown.sheet.task !== s.task || shown.sheet.to !== s.to;
  if (fresh) { typed = ''; componentsOpen = false; }
  parts ??= make();
  shown = { project: m.project, sheet: s };
  draw();
  if (!parts.dialog.open) {
    parts.dialog.showModal();
    parts.cancel.focus();
  }
}

onSent((m) => { if (m.type === 'deploy-check' && typeof m.project === 'string' && typeof m.task === 'string' && typeof m.to === 'string') waitFor(m.project, m.task, m.to); });

export const area: PageArea = {
  after: (m) => { if (m.kind === 'ticket') syncSheet(m); },
};
