// A task's plan on its page (T-97): each design choice as option cards to choose from, its own option in
// words, what changed in this version and the versions before, Approve this plan, and Build it.

import type { PlanOption } from '../../packages/core/src/analyze.ts';
import type { TicketDecision, TicketPlan, TicketVersion } from '../src/model/plan.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { button, type Child, el, icon, keptInput, md, status, when, work } from './dom.ts';
import { Pending } from './pending.ts';
import { api, memory, type PageArea, remember, state } from './state.ts';
import { discussButton, openTalk } from './talk.ts';

/** The longest own option a page sends, as acc takes it: a copy of CHOICE_TEXT_MAX in the core, on purpose, as the page imports no values from outside it (D-121). */
export const OWN_MAX = 4000;

/** Choices and approvals on their way to acc, and why the last one didn't go. */
export const planPending = new Pending<'choose' | 'approve' | 'split'>();
export const chooseKey = (project: string, task: string, decision: string): string => `plan:${project}#${task}:${decision}`;
export const approveKey = (project: string, task: string): string => `plan:${project}#${task}:approve`;
export const splitKey = (project: string, task: string): string => `plan:${project}#${task}:split`;
/** The remembered key of a choice whose "Something else…" box is open. */
const ownKey = (key: string): string => `${key}:own`;
/** The remembered key of a made choice whose options are open to compare (T-136). */
export const compareKey = (key: string): string => `${key}:compare`;
/** The remembered key of a choice whose cards show their risks and files (T-136): one for all its cards, so they line up. */
const moreKey = (key: string): string => `${key}:more`;
/** Opens or closes what `k` names, as the tab remembers it, and draws the page again. */
function flip(k: string): void {
  remember((x) => { x.opened = x.opened.includes(k) ? x.opened.filter((y) => y !== k) : [...new Set([...x.opened, k])]; });
  if (state.last) state.draw(state.last);
}
/** The remembered key of a change that waits for the person's yes, on an approved plan: its pick, an option's id or "own". */
const confirmKey = (key: string, pick: string): string => `${key}:confirm:${pick}`;
/** The pick a choice's change waits on, or null. */
const asking = (key: string): string | null => memory().opened.find((x) => x.startsWith(confirmKey(key, '')))?.slice(confirmKey(key, '').length) ?? null;
/** Forgets what a choice's change waited on. */
const unask = (key: string): void => remember((x) => { x.opened = x.opened.filter((y) => !y.startsWith(confirmKey(key, ''))); });

/** The control that takes focus once the page next draws it: the dialog's Keep the approval, or the Choose that asked. */
let focusNext: string | null = null;
/** Gives `b` focus once the draw that made it has put it on the page, when it's the one focusNext names. */
function focusOnceDrawn(b: HTMLElement, id: string): void {
  if (focusNext !== id) return;
  focusNext = null;
  queueMicrotask(() => b.focus());
}

/** Sends a choice, an approval or a split to acc, unless one for the same key is already on its way. */
export function sendPlan(key: string, what: 'choose' | 'approve' | 'split', msg: Record<string, unknown>): void {
  if (!planPending.start(key, what)) return;
  api.postMessage(msg);
  if (state.last) state.draw(state.last);
}

/**
 * A person's pick: sent at once, or, where it changes a choice on an approved plan, asked about first
 * (T-97), with focus on Keep the approval. The same own words go at once: acc changes nothing for them.
 */
function pick(m: TicketModel, task: string, plan: TicketPlan, d: TicketDecision, p: { option: string } | { text: string }): void {
  const key = chooseKey(m.project, task, d.id);
  const same = 'option' in p ? d.choice?.option === p.option : d.choice?.option === null && d.choice.name === p.text;
  if (!plan.changeAsk || same) return sendPlan(key, 'choose', { type: 'plan-choose', project: m.project, task, decision: d.id, ...p });
  unask(key);
  remember((x) => { x.opened = [...x.opened, confirmKey(key, 'option' in p ? p.option : 'own')]; });
  focusNext = confirmKey(key, 'keep');
  if (state.last) state.draw(state.last);
}

/**
 * What a change to a choice on an approved plan asks first (T-97): it undoes the approval. Change it sends the
 * pick with a yes; Keep the approval, or Escape, sends nothing, and focus goes back to what asked. Nothing
 * shows once the plan isn't approved, or for an option a newer plan no longer has.
 */
function confirmChange(m: TicketModel, task: string, plan: TicketPlan, d: TicketDecision, pickId: string): HTMLElement | null {
  const key = chooseKey(m.project, task, d.id);
  const option = d.options.find((o) => o.id === pickId);
  const text = (memory().drafts[key] ?? '').trim();
  if (!plan.changeAsk || !plan.canChoose || (!option && (pickId !== 'own' || !text))) return null;
  const keep = () => {
    unask(key);
    focusNext = confirmKey(key, pickId);
    if (state.last) state.draw(state.last);
  };
  const change = () => { unask(key); sendPlan(key, 'choose', { type: 'plan-choose', project: m.project, task, decision: d.id, ...(option ? { option: option.id } : { text }), yes: true }); };
  const said = el('p', 'pc-text', plan.changeAsk);
  said.id = `pc-${d.id}`;
  const no = button('Keep the approval', 'verified', keep);
  focusOnceDrawn(no, confirmKey(key, 'keep'));
  const box = el('div', 'plan-confirm notice attention', icon('warning', 'orange'),
    el('div', 'pc-body', said, el('div', 'muted small pc-to', `Your change: ${option ? option.name : text}${d.choice ? `, instead of ${d.choice.name}` : ''}`),
      el('div', 'actions pc-actions', no, button('Change it', 'check', change, 'primary'))));
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-label', `Change ${d.title}?`);
  box.setAttribute('aria-describedby', said.id);
  box.dataset.confirm = key;
  // Escape keeps the approval here, and leaves a modal around it open.
  box.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; e.preventDefault(); e.stopPropagation(); keep(); });
  return box;
}

/** A labelled list on an option's card: its pros, cons, risks or what it touches. Nothing when it's empty. */
export function optionPart(label: string, iconName: string, items: string[], files = false): HTMLElement | null {
  if (!items.length) return null;
  return el('div', 'po-part', el('div', 'po-label muted', icon(iconName), label),
    el('ul', 'po-list', ...items.map((x) => el('li', '', files ? work(el('span', 'mono', x), 'files') : md(x)))));
}

/**
 * An option's risks and the files it touches, folded under their names (T-136), so its pros and cons read first.
 * One key opens them on every card of the choice, so the cards stay level. Nothing when it has neither.
 */
function optionMore(key: string, o: PlanOption): HTMLElement | null {
  const parts = [optionPart('Risks', 'warning', o.risks), optionPart('Touches', 'file', o.touches, true)].filter((x): x is HTMLElement => !!x);
  if (!parts.length) return null;
  const k = moreKey(key);
  const d = el('details', 'po-more') as HTMLDetailsElement;
  d.open = memory().opened.includes(k);
  // Drawn again only when it changed, so the toggle a draw itself fires draws nothing.
  d.addEventListener('toggle', () => { if (d.open !== memory().opened.includes(k)) flip(k); });
  const name = o.risks.length && o.touches.length ? 'Risks and files' : o.risks.length ? 'Risks' : 'Files it touches';
  d.append(el('summary', 'muted small', el('span', 'tool-chev', icon('chevron-right')), el('span', '', name), el('span', 'count', String(o.risks.length + o.touches.length))), ...parts);
  return d;
}

/** One option as a card: its name, effort, whether it's recommended or chosen, what it means, its pros and cons, its risks and files folded, and Choose this. */
function optionCard(m: TicketModel, task: string, plan: TicketPlan, d: TicketDecision, o: PlanOption): HTMLElement {
  const chosen = d.choice?.option === o.id;
  const recommended = d.recommended === o.id;
  const key = chooseKey(m.project, task, d.id);
  const card = el('div', `plan-option${chosen ? ' chosen' : ''}${recommended ? ' recommended' : ''}`,
    el('div', 'po-head', el('span', 'po-letter', o.id), el('strong', 'po-name', o.name)),
    el('div', 'po-tags',
      el('span', 'chip po-effort', `Effort ${o.effort}`),
      // Recommended and chosen each carry an icon and words, never colour alone. Chosen is said here once, with who and when (T-136).
      recommended ? el('span', 'po-tag po-rec', icon('star-full'), 'Recommended') : null,
      chosen && d.choice ? el('span', 'po-tag po-chosen', icon('pass-filled'), `Chosen by ${d.choice.by}`, when(d.choice.at)) : null),
    o.means ? el('div', 'po-means', md(o.means)) : null,
    optionPart('Pros', 'add', o.pros), optionPart('Cons', 'remove', o.cons), optionMore(key, o));
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', `${d.title}: ${o.name}${recommended ? ', recommended' : ''}${chosen ? ', chosen' : ''}`);
  // Discuss (T-98): talk this option through with the planning agent, quoted.
  const discuss = m.talk?.send ? discussButton(m.project, task, `${d.id}.${o.id}`, `${d.title}: ${o.name}`, `${o.name}, for ${d.title}`) : null;
  if (discuss && (!plan.canChoose || chosen)) card.append(el('div', 'po-actions', discuss));
  if (plan.canChoose && !chosen) {
    const busy = !!planPending.what(key);
    const b = button('Choose this', 'check', () => pick(m, task, plan, d, { option: o.id }), recommended && !d.choice ? 'primary small' : 'small');
    b.setAttribute('aria-label', `Choose this: ${o.name}, for ${d.title}`);
    focusOnceDrawn(b, confirmKey(key, o.id));
    if (busy) { b.disabled = true; b.title = 'Wait for the choice on its way'; }
    card.append(el('div', 'po-actions', b, discuss));
  }
  return card;
}

/** "Something else…": the person's own option, in words, kept as they type. */
function ownOption(m: TicketModel, task: string, plan: TicketPlan, d: TicketDecision): HTMLElement {
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
    pick(m, task, plan, d, { text: input.value.trim() });
  };
  const go = button('Choose', 'check', choose, 'primary small');
  const ready = (v: string) => { go.disabled = !v.trim() || !!planPending.what(key); go.title = go.disabled ? (v.trim() ? 'Wait for the choice on its way' : 'Type your own option first') : ''; };
  ready(draft);
  focusOnceDrawn(go, confirmKey(key, 'own'));
  const input = keptInput(key, draft, `Your own option for ${d.title}`, (v) => { remember((x) => { x.drafts[key] = v; }); ready(v); }, choose);
  input.maxLength = OWN_MAX;
  const cancel = button('Cancel', 'close', () => { toggle(); if (state.last) state.draw(state.last); }, 'ghost small');
  return el('div', 'plan-own open', input, go, cancel);
}

/** "Compare the 3 options" on a made choice, or "Hide the options" while they show (T-136); remembered per choice, as folds are. */
function compareButton(key: string, d: TicketDecision, shown: boolean): HTMLElement | null {
  const n = d.options.length;
  if (!n) return null;
  const b = button(shown ? 'Hide the options' : n === 1 ? 'See the option' : `Compare the ${n} options`, shown ? 'chevron-up' : 'chevron-down', () => flip(compareKey(key)), 'ghost small pd-compare');
  b.setAttribute('aria-expanded', String(shown));
  b.setAttribute('aria-label', `${b.textContent} for ${d.title}`);
  return b;
}

/**
 * A made choice in one line (T-136): its id and title, then the option chosen, who chose it and when, and
 * Compare the options. The one place it says Chosen.
 */
function madeLine(m: TicketModel, task: string, key: string, d: TicketDecision, choice: NonNullable<TicketDecision['choice']>): HTMLElement {
  const option = d.options.find((o) => o.id === choice.option);
  const picked = el('span', 'pd-picked', icon('arrow-right'), option ? el('span', 'po-letter', option.id) : null,
    option ? el('strong', '', option.name) : el('span', '', el('span', 'muted', 'Something else: '), el('strong', '', md(choice.name))));
  const by = el('span', 'muted small pd-by', icon('pass-filled', 'blue'), `Chosen by ${choice.by}`, when(choice.at));
  return el('div', 'pd-line', el('span', 'aq-id', d.id), el('span', 'pd-title', d.title), picked, by, el('span', 'spacer'),
    compareButton(key, d, false), m.talk?.send ? discussButton(m.project, task, d.id, d.title, `the choice ${d.title}`) : null);
}

/**
 * One design choice. A made one is a line (T-136), its cards drawn only while compared, while its own words
 * are being typed, or while a change to it waits for a yes. Else: what it decides, its options side by side,
 * the recommendation and why, and Something else….
 */
function decisionGroup(m: TicketModel, task: string, plan: TicketPlan, d: TicketDecision): HTMLElement {
  const key = chooseKey(m.project, task, d.id);
  const opened = memory().opened;
  // A change on an approved plan waits here for the person's yes, under what's chosen now.
  const asked = asking(key);
  const confirm = asked && !planPending.what(key) ? confirmChange(m, task, plan, d, asked) : null;
  const compared = opened.includes(compareKey(key));
  const full = !d.choice || compared || opened.includes(ownKey(key)) || !!confirm;
  const g = el('div', `plan-decision${d.choice ? ' made' : ''}${full ? '' : ' line'}`);
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', `Choice ${d.id}: ${d.title}`);
  if (d.choice && !full) g.append(madeLine(m, task, key, d, d.choice));
  else {
    const rec = d.options.find((o) => o.id === d.recommended);
    const own = d.choice && d.choice.option === null;
    g.append(...[
      el('div', 'pd-head', el('span', 'aq-id', d.id), el('strong', 'pd-title', d.title),
        d.choice ? null : plan.canChoose ? status({ label: 'Choose one', icon: 'list-selection', tone: 'orange' }) : status({ label: 'Not chosen', icon: 'circle-large-outline', tone: 'neutral' }),
        el('span', 'spacer'), d.choice && compared ? compareButton(key, d, true) : null,
        m.talk?.send ? discussButton(m.project, task, d.id, d.title, `the choice ${d.title}`) : null),
      d.why ? el('div', 'muted small pd-why', md(d.why)) : null,
      el('div', `plan-options n${d.options.length}`, ...d.options.map((o) => optionCard(m, task, plan, d, o))),
      rec && d.because ? el('div', 'pd-because small', icon('star-full'), el('span', '', el('strong', '', `Why ${rec.name}: `), md(d.because))) : null].filter((x): x is HTMLElement => !!x));
    if (own) g.append(el('div', 'pd-own', icon('pass-filled'), el('span', '', el('strong', '', 'Something else: '), md(d.choice!.name), el('span', 'muted small', ` Chosen by ${d.choice!.by} `), when(d.choice!.at))));
    if (confirm) g.append(confirm);
  }
  const error = planPending.error(key);
  if (error) g.append(el('div', 'aq-error', icon('warning'), el('span', '', `Your choice wasn't recorded: ${error}`)));
  if (planPending.what(key)) g.append(el('div', 'q-sending muted', icon('sync~spin'), 'Recording your choice…'));
  else if (plan.canChoose && full) g.append(ownOption(m, task, plan, d));
  return g;
}

/** Whether a choice waits on the person (T-136): one still to make, or a change to one that waits for a yes. */
export function choiceWaits(m: TicketModel, task: string, plan: TicketPlan, d: TicketDecision): boolean {
  return (plan.canChoose && !d.choice) || !!asking(chooseKey(m.project, task, d.id));
}

/** An earlier version, folded: when it was made, its approval, what changed in it and its choices. */
function earlierVersion(v: TicketVersion): HTMLElement {
  return el('li', 'plan-version',
    el('div', 'pv-head', el('strong', '', `v${v.version}`), ' ', when(v.at), v.approved ? el('span', 'pv-approved', ' ', icon('verified-filled'), `Approved by ${v.approved.by}`) : el('span', 'muted', ' · not approved')),
    v.summary ? el('div', 'muted small', md(v.summary)) : null,
    v.changes.length ? el('div', 'small', el('span', 'strong', `What changed in v${v.version}: `), v.changes.join('; ')) : null,
    v.choices.length ? el('ul', 'an-list', ...v.choices.map((c) => el('li', '', el('strong', '', `${c.title}: `), c.chosen ?? el('span', 'muted', 'not chosen')))) : null);
}

/** The earlier versions under their name and count, a part of the plan's More (T-136). */
function earlierPart(earlier: TicketVersion[]): HTMLElement | null {
  if (!earlier.length) return null;
  return el('div', 'an-part plan-earlier', el('div', 'an-part-name', 'Earlier versions', el('span', 'count', String(earlier.length))),
    el('ol', 'an-list plan-versions', ...earlier.map(earlierVersion)));
}

/**
 * What changed in this version, and the person's notes on the plan. Its version and approval are the plan's top
 * line (T-136), said there once. Null when there's neither.
 */
export function planChanges(plan: TicketPlan): HTMLElement | null {
  const head = el('div', 'plan-head');
  if (plan.changes.length && plan.version > 1) {
    head.append(el('div', 'plan-changes', el('div', 'strong', icon('history'), ` What changed in v${plan.version}`), el('ul', 'an-list', ...plan.changes.map((c) => el('li', '', md(c))))));
  }
  // The person's notes on the plan (T-98), from the conversation or Claude Code: the builder is given them.
  if (plan.notes.length) {
    head.append(el('div', 'plan-notes', el('div', 'strong', icon('note'), ' Your notes on this plan'),
      el('ul', 'an-list', ...plan.notes.map((n) => el('li', '', md(n.text), el('span', 'muted small', ` ${n.by} `), when(n.at))))));
  }
  return head.childElementCount ? head : null;
}

/**
 * What other tasks build on, and the split the plan suggests (T-104): each shape with why, then a small first
 * task for just the shape and the rest, and Split into these tasks. A person may ignore it: nothing is made
 * until they click, and the plan is approved and built as it is without.
 */
export function planShapes(m: TicketModel, task: string, plan: TicketPlan): HTMLElement | null {
  const s = plan.shapes;
  if (!s) return null;
  const box = el('div', 'plan-shapes', el('div', 'strong', icon('versions'), ' Other tasks build on this'),
    s.shapes.length ? el('ul', 'an-list ps-list', ...s.shapes.map((x) => el('li', '', el('strong', '', x.name), el('span', 'chip ps-kind', x.kind), ' ', md(x.why),
      x.files.length ? el('div', 'muted small ps-files', 'Held in ', ...x.files.flatMap((f, i) => [i ? ', ' : '', work(el('code', '', f), 'files')])) : null,
      x.users.length ? el('div', 'muted small', `Used by ${x.users.join(', ')}`) : null))) : null);
  const split = s.split;
  if (!split) return box;
  const key = splitKey(m.project, task);
  const busy = !!planPending.what(key);
  const error = planPending.error(key);
  box.append(el('div', 'ps-split',
    el('div', 'strong', icon('split-horizontal'), ' Suggested: a small first task for the shape'),
    split.why ? el('p', 'muted small ps-why', md(split.why)) : null,
    el('ol', 'an-list ps-tasks',
      el('li', '', el('strong', '', split.first.title), el('span', 'chip ps-first', 'First: the shape and its tests'), split.first.brief ? el('div', 'muted small', md(split.first.brief)) : null),
      el('li', '', el('strong', '', split.rest.title), el('span', 'chip ps-rest', 'Then: waits for the first'), split.rest.brief ? el('div', 'muted small', md(split.rest.brief)) : null)),
    split.made ? el('div', 'muted small', icon('pass-filled'), el('span', '', `Split into ${split.made.first} and ${split.made.rest}. ${split.made.rest} starts once ${split.made.first} merges.`)) : null));
  if (split.go) {
    const b = button(busy ? 'Splitting…' : 'Split into these tasks', busy ? 'loading~spin' : 'split-horizontal', () => sendPlan(key, 'split', { type: 'plan-split', project: m.project, task }));
    if (busy) { b.disabled = true; b.title = 'Wait for the split on its way'; }
    box.append(el('div', 'actions ps-actions', b, el('span', 'muted small', 'Or ignore this: the plan builds as it is.')));
  }
  if (error) box.append(el('div', 'aq-error', icon('warning'), el('span', '', `The task wasn't split: ${error}`)));
  return box;
}

/** Each design choice, as a group of option cards. */
export function planDecisions(m: TicketModel, task: string, plan: TicketPlan): HTMLElement | null {
  if (!plan.decisions.length) return null;
  return el('div', 'plan-decisions', ...plan.decisions.map((d) => decisionGroup(m, task, plan, d)));
}

/**
 * Approve this plan, off with why while it can't be: the reason in its title and, with `say`, in a line under
 * it; and why acc refused the last approval. Nothing once it's approved or past the build.
 */
export function approveControls(m: TicketModel, task: string, plan: TicketPlan, say = false): HTMLElement[] {
  if (!plan.approve) return [];
  const key = approveKey(m.project, task);
  const busy = !!planPending.what(key);
  const b = button(busy ? 'Approving…' : 'Approve this plan', busy ? 'loading~spin' : 'verified', () => { if (!b.disabled) sendPlan(key, 'approve', { type: 'plan-approve', project: m.project, task }); }, plan.approve.disabled ? '' : 'primary');
  const why = plan.approve.disabled ?? (busy ? 'Wait for the approval on its way' : null);
  b.disabled = !!why;
  if (why) { b.title = why; b.setAttribute('aria-description', why); }
  const error = planPending.error(key);
  return [
    b,
    ...(say && plan.approve.disabled ? [el('div', 'plan-why muted small', icon('info'), el('span', '', `Approve is off: ${plan.approve.disabled}`))] : []),
    ...(error ? [el('div', 'aq-error', icon('warning'), el('span', '', `The plan wasn't approved: ${error}`))] : []),
  ];
}

/**
 * The plan's one row of buttons: `lead` first, when given (Review plan, T-109), then Approve this plan where
 * there's no lead to approve it from, Build it, Talk it through, and `more` after them (T-136: the
 * conversation's line and Make a new plan); each off with why, under the row, while it can't be used.
 */
export function planActions(m: TicketModel, task: string, plan: TicketPlan, lead: HTMLElement | null = null, more: HTMLElement[] = []): Child[] {
  const buttons: HTMLElement[] = lead ? [lead] : [];
  const whys: Child[] = [];
  const approve = lead ? [] : approveControls(m, task, plan);
  if (approve[0]) buttons.push(approve[0]);
  if (plan.build) {
    const a = plan.build;
    const b = button(a.label, a.icon, () => api.postMessage({ type: 'run', command: a.command, ref: a.ref }), a.primary && !plan.approve && !lead?.classList.contains('primary') ? 'primary' : '');
    if (a.disabled) { b.disabled = true; b.title = a.disabled; b.setAttribute('aria-description', a.disabled); whys.push(el('div', 'plan-why muted small', icon('info'), el('span', '', `Build it is off: ${a.disabled}`))); }
    buttons.push(b);
  }
  // Talk it through (T-98): opens the conversation beside the plan, and puts the cursor in its box.
  if (m.talk?.send) buttons.push(button('Talk it through', 'comment-discussion', () => openTalk(m.project, task)));
  buttons.push(...more);
  return [
    buttons.length ? el('div', 'actions plan-actions', ...buttons) : null,
    ...whys,
    ...approve.slice(1),
  ];
}

/** The earlier versions of the plan, under their name and count, in the plan's More (T-136). */
export const planEarlier = (plan: TicketPlan): HTMLElement | null => earlierPart(plan.earlier);

/** acc recorded a choice or an approval, or refused it: the page redraws with what acc did, or says why not. */
function done(msg: { action?: string; project?: string; task?: string; decision?: string; ok?: boolean; error?: string }): void {
  const key = msg.action === 'plan-approve' ? approveKey(msg.project ?? '', msg.task ?? '') : msg.action === 'plan-split' ? splitKey(msg.project ?? '', msg.task ?? '') : chooseKey(msg.project ?? '', msg.task ?? '', msg.decision ?? '');
  if (!planPending.what(key)) return;
  planPending.settle(key, msg.ok ? null : msg.error?.trim() || 'It didn\'t go, and the Command Center didn\'t say why.');
  // A choice made in its own words clears them, and closes its box.
  if (msg.ok && msg.action === 'plan-choose') remember((x) => { delete x.drafts[key]; x.opened = x.opened.filter((y) => y !== ownKey(key)); });
  if (state.last) state.draw(state.last);
}

export const area: PageArea = {
  receive: { 'plan-done': done },
};
