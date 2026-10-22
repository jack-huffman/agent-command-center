// A task's plan on its page (T-97): each design choice as option cards to choose from, its own option in
// words, what changed in this version and the versions before, Approve this plan, and Build it.

import type { PlanOption } from '../../packages/core/src/analyze.ts';
import type { TicketDecision, TicketPlan, TicketVersion } from '../src/model/plan.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { button, type Child, el, icon, keptInput, md, status, when, work } from './dom.ts';
import { Pending } from './pending.ts';
import { api, memory, type PageArea, remember, state } from './state.ts';

/** The longest own option a page sends, as acc takes it. */
const OWN_MAX = 4000;

/** Choices and approvals on their way to acc, and why the last one didn't go. */
export const planPending = new Pending<'choose' | 'approve'>();
export const chooseKey = (project: string, task: string, decision: string): string => `plan:${project}#${task}:${decision}`;
export const approveKey = (project: string, task: string): string => `plan:${project}#${task}:approve`;
/** The remembered key of a choice whose "Something else…" box is open. */
const ownKey = (key: string): string => `${key}:own`;

function send(key: string, what: 'choose' | 'approve', msg: Record<string, unknown>): void {
  if (!planPending.start(key, what)) return;
  api.postMessage(msg);
  if (state.last) state.draw(state.last);
}

/** A labelled list on an option's card: its pros, cons, risks or what it touches. Nothing when it's empty. */
function part(label: string, iconName: string, items: string[], files = false): HTMLElement | null {
  if (!items.length) return null;
  return el('div', 'po-part', el('div', 'po-label muted', icon(iconName), label),
    el('ul', 'po-list', ...items.map((x) => el('li', '', files ? work(el('span', 'mono', x), 'files') : md(x)))));
}

/** One option as a card: its name, effort, whether it's recommended or chosen, what it means, its pros, cons, risks and files, and Choose this. */
function optionCard(m: TicketModel, task: string, plan: TicketPlan, d: TicketDecision, o: PlanOption): HTMLElement {
  const chosen = d.choice?.option === o.id;
  const recommended = d.recommended === o.id;
  const key = chooseKey(m.project, task, d.id);
  const card = el('div', `plan-option${chosen ? ' chosen' : ''}${recommended ? ' recommended' : ''}`,
    el('div', 'po-head', el('span', 'po-letter', o.id), el('strong', 'po-name', o.name)),
    el('div', 'po-tags',
      el('span', 'chip po-effort', `Effort ${o.effort}`),
      // Recommended and chosen each carry an icon and words, never colour alone.
      recommended ? el('span', 'po-tag po-rec', icon('star-full'), 'Recommended') : null,
      chosen ? el('span', 'po-tag po-chosen', icon('pass-filled'), 'Chosen') : null),
    o.means ? el('div', 'po-means', md(o.means)) : null,
    part('Pros', 'add', o.pros), part('Cons', 'remove', o.cons), part('Risks', 'warning', o.risks), part('Touches', 'file', o.touches, true));
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', `${d.title}: ${o.name}${recommended ? ', recommended' : ''}${chosen ? ', chosen' : ''}`);
  if (plan.canChoose && !chosen) {
    const busy = !!planPending.what(key);
    const b = button('Choose this', 'check', () => send(key, 'choose', { type: 'plan-choose', project: m.project, task, decision: d.id, option: o.id }), recommended && !d.choice ? 'primary small' : 'small');
    b.setAttribute('aria-label', `Choose this: ${o.name}, for ${d.title}`);
    if (busy) { b.disabled = true; b.title = 'Wait for the choice on its way'; }
    card.append(el('div', 'po-actions', b));
  }
  return card;
}

/** "Something else…": the person's own option, in words, kept as they type. */
function ownOption(m: TicketModel, task: string, d: TicketDecision): HTMLElement {
  const key = chooseKey(m.project, task, d.id);
  const open = memory().opened.includes(ownKey(key));
  const toggle = () => remember((x) => { x.opened = open ? x.opened.filter((y) => y !== ownKey(key)) : [...new Set([...x.opened, ownKey(key)])]; });
  if (!open) {
    const b = button('Something else…', 'edit', () => { toggle(); if (state.last) state.draw(state.last); }, 'ghost small');
    b.setAttribute('aria-label', `Something else… for ${d.title}`);
    return el('div', 'plan-own', b);
  }
  const draft = memory().drafts[key] ?? '';
  const choose = () => {
    if (!input.value.trim()) return;
    send(key, 'choose', { type: 'plan-choose', project: m.project, task, decision: d.id, text: input.value.trim() });
  };
  const go = button('Choose', 'check', choose, 'primary small');
  go.disabled = !draft.trim() || !!planPending.what(key);
  const input = keptInput(key, draft, `Your own option for ${d.title}`, (v) => { remember((x) => { x.drafts[key] = v; }); go.disabled = !v.trim(); }, choose);
  input.maxLength = OWN_MAX;
  const cancel = button('Cancel', 'close', () => { toggle(); if (state.last) state.draw(state.last); }, 'ghost small');
  return el('div', 'plan-own open', input, go, cancel);
}

/** One design choice: what it decides, its options side by side, the recommendation and why, and what was chosen. */
function decisionGroup(m: TicketModel, task: string, plan: TicketPlan, d: TicketDecision): HTMLElement {
  const key = chooseKey(m.project, task, d.id);
  const rec = d.options.find((o) => o.id === d.recommended);
  const own = d.choice && d.choice.option === null;
  const g = el('div', `plan-decision${d.choice ? ' made' : ''}`,
    el('div', 'pd-head', el('span', 'aq-id', d.id), el('strong', 'pd-title', d.title),
      d.choice ? status({ label: 'Chosen', icon: 'pass-filled', tone: 'blue' }) : plan.canChoose ? status({ label: 'Choose one', icon: 'list-selection', tone: 'orange' }) : status({ label: 'Not chosen', icon: 'circle-large-outline', tone: 'neutral' })),
    d.why ? el('div', 'muted small pd-why', md(d.why)) : null,
    el('div', `plan-options n${d.options.length}`, ...d.options.map((o) => optionCard(m, task, plan, d, o))),
    rec && d.because ? el('div', 'pd-because small', icon('star-full'), el('span', '', el('strong', '', `Why ${rec.name}: `), md(d.because))) : null);
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', `Choice ${d.id}: ${d.title}`);
  if (own) g.append(el('div', 'pd-own', icon('pass-filled'), el('span', '', el('strong', '', 'Something else: '), md(d.choice!.name))));
  if (d.choice) g.append(el('div', 'pd-by muted small', `Chosen by ${d.choice.by} `, when(d.choice.at)));
  const error = planPending.error(key);
  if (error) g.append(el('div', 'aq-error', icon('warning'), el('span', '', `Your choice wasn't recorded: ${error}`)));
  if (planPending.what(key)) g.append(el('div', 'q-sending muted', icon('sync~spin'), 'Recording your choice…'));
  else if (plan.canChoose) g.append(ownOption(m, task, d));
  return g;
}

/** An earlier version, folded: when it was made, its approval, what changed in it and its choices. */
function earlierVersion(v: TicketVersion): HTMLElement {
  return el('li', 'plan-version',
    el('div', 'pv-head', el('strong', '', `v${v.version}`), ' ', when(v.at), v.approved ? el('span', 'pv-approved', ' ', icon('verified-filled'), `Approved by ${v.approved.by}`) : el('span', 'muted', ' · not approved')),
    v.summary ? el('div', 'muted small', md(v.summary)) : null,
    v.changes.length ? el('div', 'small', el('span', 'strong', `What changed in v${v.version}: `), v.changes.join('; ')) : null,
    v.choices.length ? el('ul', 'an-list', ...v.choices.map((c) => el('li', '', el('strong', '', `${c.title}: `), c.chosen ?? el('span', 'muted', 'not chosen')))) : null);
}

/** The earlier versions, a click away, under their count. Opened or closed, it stays so as the page redraws. */
function earlierFold(key: string, earlier: TicketVersion[]): HTMLElement | null {
  if (!earlier.length) return null;
  const d = el('details', 'an-fold plan-earlier') as HTMLDetailsElement;
  d.open = memory().opened.includes(key);
  d.addEventListener('toggle', () => remember((x) => { x.opened = d.open ? [...new Set([...x.opened, key])] : x.opened.filter((y) => y !== key); }));
  d.append(el('summary', '', el('span', 'tool-chev', icon('chevron-right')), el('span', '', 'Earlier versions'), el('span', 'count', String(earlier.length))),
    el('ol', 'an-list plan-versions', ...earlier.map(earlierVersion)));
  return d;
}

/** The head of the plan: its version and approval, why an approval lapsed, and what changed in this version. */
export function planHead(plan: TicketPlan): HTMLElement {
  const head = el('div', 'plan-head',
    el('div', 'ph-line', status(plan.look), plan.approval ? el('span', 'muted small', `by ${plan.approval.by} `, when(plan.approval.at)) : null));
  if (plan.changes.length && plan.version > 1) {
    head.append(el('div', 'plan-changes', el('div', 'strong', icon('history'), ` What changed in v${plan.version}`), el('ul', 'an-list', ...plan.changes.map((c) => el('li', '', md(c))))));
  }
  return head;
}

/** Each design choice, as a group of option cards. */
export function planDecisions(m: TicketModel, task: string, plan: TicketPlan): HTMLElement | null {
  if (!plan.decisions.length) return null;
  return el('div', 'plan-decisions', ...plan.decisions.map((d) => decisionGroup(m, task, plan, d)));
}

/** Approve this plan and Build it, each off with why while it can't be used; then the earlier versions. */
export function planActions(m: TicketModel, task: string, plan: TicketPlan): Child[] {
  const key = approveKey(m.project, task);
  const buttons: HTMLElement[] = [];
  const whys: Child[] = [];
  if (plan.approve) {
    const busy = !!planPending.what(key);
    const b = button(busy ? 'Approving…' : 'Approve this plan', busy ? 'loading~spin' : 'verified', () => send(key, 'approve', { type: 'plan-approve', project: m.project, task }), plan.approve.disabled ? '' : 'primary');
    const why = plan.approve.disabled ?? (busy ? 'Wait for the approval on its way' : null);
    b.disabled = !!why;
    if (why) { b.title = why; b.setAttribute('aria-description', why); }
    buttons.push(b);
  }
  if (plan.build) {
    const a = plan.build;
    const b = button(a.label, a.icon, () => api.postMessage({ type: 'run', command: a.command, ref: a.ref }), a.primary && !plan.approve ? 'primary' : '');
    if (a.disabled) { b.disabled = true; b.title = a.disabled; b.setAttribute('aria-description', a.disabled); whys.push(el('div', 'plan-why muted small', icon('info'), el('span', '', `Build it is off: ${a.disabled}`))); }
    buttons.push(b);
  }
  const error = planPending.error(key);
  return [
    buttons.length ? el('div', 'actions plan-actions', ...buttons) : null,
    ...whys,
    error ? el('div', 'aq-error', icon('warning'), el('span', '', `The plan wasn't approved: ${error}`)) : null,
    earlierFold(`plan:${m.project}#${task}:earlier`, plan.earlier),
  ];
}

/** acc recorded a choice or an approval, or refused it: the page redraws with what acc did, or says why not. */
function done(msg: { action?: string; project?: string; task?: string; decision?: string; ok?: boolean; error?: string }): void {
  const key = msg.action === 'plan-approve' ? approveKey(msg.project ?? '', msg.task ?? '') : chooseKey(msg.project ?? '', msg.task ?? '', msg.decision ?? '');
  if (!planPending.what(key)) return;
  planPending.settle(key, msg.ok ? null : msg.error?.trim() || 'It didn\'t go, and the Command Center didn\'t say why.');
  // A choice made in its own words clears them, and closes its box.
  if (msg.ok && msg.action === 'plan-choose') remember((x) => { delete x.drafts[key]; x.opened = x.opened.filter((y) => y !== ownKey(key)); });
  if (state.last) state.draw(state.last);
}

export const area: PageArea = {
  receive: { 'plan-done': done },
};
