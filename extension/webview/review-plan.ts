// Review plan (T-109): a plan's choices and questions one at a time, in a sheet over a task's page (modal.ts),
// as Claude Code asks its own questions. Each step is one choice or one question, its options a radio group:
// Up and Down move between them, a number picks one, Enter confirms and goes on, Escape closes and keeps what's
// picked. Back, Skip for now, and dots for the steps; the last step sums it up, with Approve this plan. A
// confirm sends what the page already sends (plan-choose, analysis-answer, update-ask), so acc records it as
// it does from the whole plan. Which step is open, and what's picked, is kept in the tab's memory.

import type { Model } from '../src/model/home.ts';
import type { PlanReview, ReviewChoice, ReviewQuestion, ReviewStep } from '../src/model/review-plan.ts';
import type { TicketPlan } from '../src/model/plan.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { button, el, focusedElement, icon, keepFocus, keptInput, md, status } from './dom.ts';
import { makeModal } from './modal.ts';
import { approveControls, chooseKey, OWN_MAX, optionPart, planPending, sendPlan } from './plan.ts';
import { memory, type PageArea, remember, state } from './state.ts';
import { openTalk } from './talk.ts';
import { answerKey, askKey, pending, sendAnswer, sendUpdate } from './updates.ts';

/** The step after the last: the summary. */
const SUMMARY = 'summary';

const base = (project: string, task: string): string => `review:${project}#${task}`;
/** The remembered keys: the sheet is open; the step it's at; a step skipped; what's picked in a step; an option's More about open; a change on an approved plan asking first. */
const openKey = (project: string, task: string): string => `${base(project, task)}:open`;
const atKey = (project: string, task: string): string => `${base(project, task)}:at`;
const skipKey = (project: string, task: string, step: string): string => `${base(project, task)}:skip:${step}`;
const pickKey = (project: string, task: string, step: string): string => `${base(project, task)}:pick:${step}`;
const moreKey = (project: string, task: string, step: string, option: string): string => `${base(project, task)}:more:${step}.${option}`;
const askingKey = (project: string, task: string, step: string): string => `${base(project, task)}:confirm:${step}`;

/** One option of a step, as its row draws it. */
interface StepOption { id: string; name: string; line: string; recommended?: boolean; chosen?: boolean; more?: ReviewChoice['options'][number] }

let modal: { dialog: HTMLDialogElement; body: HTMLElement; title: HTMLElement } | null = null;
/** The task the sheet shows, and the step it last drew, so a new step starts with focus on its option. */
let shown: { m: TicketModel; task: string; review: PlanReview } | null = null;
let drawnAt: string | null = null;
/** What had focus when it opened, which gets it back when it closes. */
let opener: HTMLElement | null = null;

const has = (key: string): boolean => memory().opened.includes(key);
const toggle = (key: string, on: boolean): void => remember((x) => { x.opened = on ? [...new Set([...x.opened, key])] : x.opened.filter((y) => y !== key); });

/** The step the sheet is at: the one it remembers, while the plan still has it; else the summary. */
function currentStep(project: string, task: string, r: PlanReview): string {
  const at = memory().drafts[atKey(project, task)];
  return at && (at === SUMMARY || r.steps.some((s) => s.id === at)) ? at : SUMMARY;
}

/** A step's choice or answer is on its way to acc. */
function sending(project: string, task: string, s: ReviewStep): boolean {
  return s.kind === 'choice' ? !!planPending.what(chooseKey(project, task, s.id)) : !!pending.what(answerKey(project, task, s.id)) || !!pending.what(askKey(project, task, s.id));
}

/** Where a step stands, as its dot and its summary line show it. */
function stepState(project: string, task: string, s: ReviewStep, at: string): 'current' | 'done' | 'skipped' | 'todo' {
  if (s.id === at) return 'current';
  if (s.done || sending(project, task, s)) return 'done';
  return has(skipKey(project, task, s.id)) ? 'skipped' : 'todo';
}

/** A step's options, in order: a choice's, the recommended one first, then Something else…; a question's suggestion, your own words, and, for the ticket's author, Ask on the ticket. */
export function picksOf(s: ReviewStep, canAsk: boolean): StepOption[] {
  if (s.kind === 'choice') {
    return [
      ...s.options.map((o) => ({ id: o.id, name: o.name, line: o.means, recommended: o.recommended, chosen: s.chosen?.option === o.id, more: o })),
      { id: 'own', name: 'Something else…', line: s.chosen?.option === null ? s.chosen.name : 'Your own option, in your words', chosen: s.chosen?.option === null },
    ];
  }
  return [
    ...(s.suggested.trim() ? [{ id: 'suggested', name: 'Use the suggestion', line: s.suggested, recommended: true }] : []),
    { id: 'mine', name: 'Answer in my own words', line: 'Type your answer' },
    ...(s.author && canAsk && !s.client ? [{ id: 'ask', name: 'Ask on the ticket', line: 'Draft it as a comment for the ticket. You edit and post it before it goes.' }] : []),
  ];
}

/** What's picked in a step: what the person picked, else what's chosen now, else the first option. */
function pickedIn(project: string, task: string, s: ReviewStep, picks: StepOption[]): string {
  const kept = memory().drafts[pickKey(project, task, s.id)];
  if (kept && picks.some((p) => p.id === kept)) return kept;
  return picks.find((p) => p.chosen)?.id ?? picks[0]?.id ?? '';
}

/** The words a pick of one's own sends: a choice's Something else…, or a question's own answer. */
const ownWords = (project: string, task: string, s: ReviewStep): string => (memory().drafts[s.kind === 'choice' ? chooseKey(project, task, s.id) : answerKey(project, task, s.id)] ?? '').trim();

/** Why Confirm is off in a step, or null: own words not typed yet, or what was sent still on its way. */
function confirmOff(project: string, task: string, s: ReviewStep, pick: string): string | null {
  if (sending(project, task, s)) return 'Wait for what you sent to be recorded';
  if (s.kind === 'question' && s.answer !== null) return null;
  if ((pick === 'own' || pick === 'mine') && !ownWords(project, task, s)) return s.kind === 'choice' ? 'Type your own option first' : 'Type your answer first';
  return null;
}

const redraw = (): void => { if (shown) draw(shown.m); };

/** Goes to a step, or the summary. */
export function goTo(id: string): void {
  if (!shown) return;
  const { m, task } = shown;
  remember((x) => { x.drafts[atKey(m.project, task)] = id; });
  redraw();
}

/** The step after this one, or the summary after the last. */
function next(r: PlanReview, id: string): string {
  const i = r.steps.findIndex((s) => s.id === id);
  return r.steps[i + 1]?.id ?? SUMMARY;
}

/** Picks an option in a step, and, for one in the person's own words, puts the cursor in its box. */
function pickOption(s: ReviewStep, id: string, focus: 'radio' | 'box' = 'radio'): void {
  if (!shown) return;
  const { m, task } = shown;
  remember((x) => { x.drafts[pickKey(m.project, task, s.id)] = id; x.opened = x.opened.filter((y) => y !== askingKey(m.project, task, s.id)); });
  redraw();
  const into = focus === 'box' && (id === 'own' || id === 'mine') ? modal?.body.querySelector<HTMLElement>('.rp-own input') : null;
  (into ?? modal?.body.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]'))?.focus({ preventScroll: true });
}

/**
 * Enter, or Confirm: sends the step's pick as the page does from the whole plan, and goes on to the next.
 * Nothing goes for what's already chosen or answered; on an approved plan, a change asks first (T-97).
 */
function confirm(yes = false): void {
  if (!shown) return;
  const { m, task, review } = shown;
  const plan = m.analysis?.planState ?? null;
  const at = currentStep(m.project, task, review);
  const s = review.steps.find((x) => x.id === at);
  if (!s) return;
  const picks = picksOf(s, review.canAsk);
  const pick = pickedIn(m.project, task, s, picks);
  if (confirmOff(m.project, task, s, pick)) return;
  if (s.kind === 'choice') {
    const text = ownWords(m.project, task, s);
    const same = pick === 'own' ? s.chosen?.option === null && s.chosen.name === text : s.chosen?.option === pick;
    if (!same) {
      if (plan?.changeAsk && !yes) { toggle(askingKey(m.project, task, s.id), true); redraw(); return; }
      sendPlan(chooseKey(m.project, task, s.id), 'choose', { type: 'plan-choose', project: m.project, task, decision: s.id, ...(pick === 'own' ? { text } : { option: pick }), ...(yes ? { yes: true } : {}) });
    }
  } else if (s.answer === null) {
    if (pick === 'ask') sendUpdate(askKey(m.project, task, s.id), 'ask', { type: 'update-ask', project: m.project, task, question: s.id });
    else sendAnswer(m.project, task, s.id, pick === 'mine' ? ownWords(m.project, task, s) : s.suggested);
  }
  remember((x) => { x.opened = x.opened.filter((y) => y !== skipKey(m.project, task, s.id) && y !== askingKey(m.project, task, s.id)); });
  goTo(next(review, s.id));
}

/** Skip for now: marks the step skipped, and goes on. Nothing is sent. */
function skip(): void {
  if (!shown) return;
  const { m, task, review } = shown;
  const at = currentStep(m.project, task, review);
  if (at === SUMMARY) return;
  toggle(skipKey(m.project, task, at), true);
  goTo(next(review, at));
}

/** Back: the step before, or the last step from the summary. What's picked in each stays. */
function back(): void {
  if (!shown) return;
  const { m, task, review } = shown;
  const at = currentStep(m.project, task, review);
  const i = at === SUMMARY ? review.steps.length : review.steps.findIndex((s) => s.id === at);
  if (i > 0) goTo(review.steps[i - 1]!.id);
}

/** One option's row: its radio, with its number, name, line and tags; More about this option; and its own words' box when picked. */
function optionRow(s: ReviewStep, p: StepOption, i: number, on: boolean): HTMLElement {
  const { m, task } = shown!;
  const radio = el('button', `rp-radio${on ? ' on' : ''}`,
    el('span', 'rp-num', String(i + 1)), icon(on ? 'circle-filled' : 'circle-large-outline', on ? 'blue' : undefined),
    el('span', 'rp-text', el('span', 'rp-name', p.name,
      // Recommended and chosen each carry an icon and words, never colour alone.
      p.recommended ? el('span', 'rp-tag rp-rec', icon('star-full'), 'Recommended') : null,
      p.chosen ? el('span', 'rp-tag rp-chosen', icon('pass-filled'), 'Chosen now') : null),
    p.line ? el('span', 'rp-line muted', md(p.line)) : null)) as HTMLButtonElement;
  radio.type = 'button';
  radio.setAttribute('role', 'radio');
  radio.setAttribute('aria-checked', String(on));
  radio.tabIndex = on ? 0 : -1;
  radio.dataset.pick = p.id;
  radio.addEventListener('click', () => pickOption(s, p.id, 'box'));
  const row = el('div', `rp-option${on ? ' on' : ''}`, radio);
  if (p.more) {
    const key = moreKey(m.project, task, s.id, p.id);
    const open = has(key);
    const more = button('More about this option', open ? 'chevron-down' : 'chevron-right', () => { toggle(key, !open); redraw(); }, 'ghost small rp-more');
    more.setAttribute('aria-expanded', String(open));
    more.setAttribute('aria-label', `More about this option: ${p.name}`);
    row.append(more);
    if (open) {
      const o = p.more;
      row.append(el('div', 'rp-details', el('span', 'chip po-effort', `Effort ${o.effort}`),
        optionPart('Pros', 'add', o.pros), optionPart('Cons', 'remove', o.cons), optionPart('Risks', 'warning', o.risks), optionPart('Files', 'file', o.touches, true)));
    }
  }
  if (on && (p.id === 'own' || p.id === 'mine')) {
    const key = s.kind === 'choice' ? chooseKey(m.project, task, s.id) : answerKey(m.project, task, s.id);
    const label = s.kind === 'choice' ? `Your own option for ${s.title}` : `Your answer to ${s.title}`;
    const input = keptInput(key, memory().drafts[key] ?? '', label, (v) => { remember((x) => { x.drafts[key] = v; }); foot(); }, () => confirm());
    input.maxLength = OWN_MAX;
    row.append(el('div', 'rp-own', input));
  }
  return row;
}

/** What acc said of the step: on its way, refused and why, or asked on the ticket. */
function stepNotes(s: ReviewStep): HTMLElement[] {
  const { m, task } = shown!;
  const out: HTMLElement[] = [];
  if (s.kind === 'choice') {
    const key = chooseKey(m.project, task, s.id);
    if (planPending.what(key)) out.push(el('div', 'q-sending muted', icon('sync~spin'), 'Recording your choice…'));
    const error = planPending.error(key);
    if (error) out.push(el('div', 'aq-error', icon('warning'), el('span', '', `Your choice wasn't recorded: ${error}`)));
    return out;
  }
  const key = answerKey(m.project, task, s.id);
  if (pending.what(key)) out.push(el('div', 'q-sending muted', icon('sync~spin'), 'Sending your answer…'));
  if (pending.what(askKey(m.project, task, s.id))) out.push(el('div', 'q-sending muted', icon('sync~spin'), 'Drafting it for the ticket…'));
  const error = pending.error(key) ?? pending.error(askKey(m.project, task, s.id));
  if (error) out.push(el('div', 'aq-error', icon('warning'), el('span', '', `It wasn't recorded: ${error}`)));
  if (s.client === 'drafted') out.push(el('div', 'aq-client muted', icon('comment-draft'), 'Drafted for the ticket: post it from the task\'s Activity'));
  if (s.client === 'posted') out.push(el('div', 'aq-client muted', icon('comment'), 'Asked on the ticket'));
  return out;
}

/** On an approved plan, a changed choice asks first (T-97): Change it sends it with a yes; Keep the approval sends nothing. */
function askFirst(plan: TicketPlan, s: ReviewChoice): HTMLElement {
  const { m, task } = shown!;
  const said = el('p', 'pc-text', plan.changeAsk ?? '');
  said.id = `rp-ask-${s.id}`;
  const keep = button('Keep the approval', 'verified', () => { toggle(askingKey(m.project, task, s.id), false); redraw(); modal?.body.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus(); });
  const box = el('div', 'plan-confirm notice attention', icon('warning', 'orange'),
    el('div', 'pc-body', said, el('div', 'actions pc-actions', keep, button('Change it', 'check', () => confirm(true), 'primary'))));
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-label', `Change ${s.title}?`);
  box.setAttribute('aria-describedby', said.id);
  queueMicrotask(() => keep.focus());
  return box;
}

/** One step: the question as its heading, why it matters, its options as a radio group, and Discuss. */
function stepView(s: ReviewStep): HTMLElement {
  const { m, task, review } = shown!;
  const plan = m.analysis?.planState ?? null;
  const heading = el('h3', 'rp-q', md(s.title));
  heading.id = `rp-q-${s.id}`;
  const who = s.kind === 'choice' ? el('span', 'rp-kind', icon('list-selection'), 'A choice')
    : s.author ? el('span', 'rp-kind', icon('person'), 'For the ticket\'s author') : el('span', 'rp-kind', icon('question'), 'A question for you');
  // Discuss (T-98): the sheet closes onto Talk it through, with this choice or question quoted.
  const discuss = m.talk?.send ? button('Discuss', 'comment-discussion', () => { shut(); openTalk(m.project, task, { ref: s.id, text: s.title }); }, 'ghost small rp-discuss') : null;
  if (discuss) { discuss.setAttribute('aria-label', `Discuss ${s.title}`); discuss.title = `Talk ${s.title} through with the planning agent`; }
  const view = el('div', 'rp-step', el('div', 'rp-head', who, el('span', 'spacer'), discuss), heading, s.why ? el('p', 'rp-why muted', md(s.why)) : null);
  view.dataset.step = s.id;
  if (s.kind === 'question' && s.answer !== null) {
    view.append(el('div', 'rp-answered', icon('pass-filled', 'blue'), el('span', '', el('strong', '', 'Answered: '), md(s.answer))));
    return view;
  }
  const picks = picksOf(s, review.canAsk);
  const on = pickedIn(m.project, task, s, picks);
  const group = el('div', 'rp-options', ...picks.map((p, i) => optionRow(s, p, i, p.id === on)));
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', heading.id);
  view.append(group);
  if (s.kind === 'choice' && s.because) view.append(el('div', 'pd-because small', icon('star-full'), el('span', '', el('strong', '', 'Why it\'s recommended: '), md(s.because))));
  if (s.kind === 'choice' && plan?.changeAsk && has(askingKey(m.project, task, s.id))) view.append(askFirst(plan, s));
  view.append(...stepNotes(s));
  return view;
}

/** One line of the summary: the step's name and what was chosen or answered, or that it was skipped; a click goes back to it. */
function summaryLine(s: ReviewStep, n: number): HTMLElement {
  const { m, task } = shown!;
  const st = stepState(m.project, task, s, SUMMARY);
  const value = s.kind === 'choice' ? s.chosen?.name ?? null : s.answer ?? (!s.author ? null : s.client === 'posted' ? 'Asked on the ticket' : s.client === 'drafted' ? 'Drafted for the ticket' : null);
  const what = value ?? (sending(m.project, task, s) ? 'On its way' : st === 'skipped' ? 'Skipped' : s.kind === 'choice' ? 'Not chosen yet' : 'Not answered yet');
  const look = value || sending(m.project, task, s) ? { icon: 'pass-filled', tone: 'blue' } : st === 'skipped' ? { icon: 'debug-step-over', tone: 'orange' } : { icon: 'circle-large-outline', tone: 'orange' };
  const b = el('button', `rp-sum-line ${st}`, el('span', 'rp-sum-n muted', String(n)), icon(look.icon, look.tone),
    el('span', 'rp-sum-text', el('span', 'rp-sum-title', md(s.title)), el('span', `rp-sum-value${value ? '' : ' muted'}`, value ? md(value) : what))) as HTMLButtonElement;
  b.type = 'button';
  b.setAttribute('aria-label', `${s.title}: ${what}. Go back to it`);
  b.addEventListener('click', () => goTo(s.id));
  return el('li', '', b);
}

/** The last step: each choice and answer in a line, then Approve this plan, off with why while something is left. */
function summaryView(): HTMLElement {
  const { m, task, review } = shown!;
  const plan = m.analysis?.planState ?? null;
  const heading = el('h3', 'rp-q', 'Your choices and answers');
  heading.id = 'rp-q-summary';
  const view = el('div', 'rp-step rp-summary', heading, el('ol', 'rp-sum', ...review.steps.map((s, i) => summaryLine(s, i + 1))));
  view.dataset.step = SUMMARY;
  if (plan?.approval) view.append(el('div', 'rp-approved', status(plan.look), el('span', 'muted small', ` by ${plan.approval.by}`)));
  else if (plan?.lapsed) view.append(el('p', 'muted small', `Plan ${plan.lapsed}: approve it again.`));
  return view;
}

/** "2 of 5", and a dot for each step, done, skipped or current, each a click away. */
function progress(r: PlanReview, at: string): HTMLElement {
  const { m, task } = shown!;
  const i = r.steps.findIndex((s) => s.id === at);
  const words = at === SUMMARY ? `${r.steps.filter((s) => s.done).length} of ${r.steps.length} done` : `${i + 1} of ${r.steps.length}`;
  const ICON = { current: 'circle-filled', done: 'pass-filled', skipped: 'debug-step-over', todo: 'circle-large-outline' };
  const WORD = { current: 'you are here', done: 'done', skipped: 'skipped', todo: 'to do' };
  const dots = el('ol', 'rp-dots', ...r.steps.map((s, k) => {
    const st = stepState(m.project, task, s, at);
    const d = el('button', `rp-dot ${st}`, icon(ICON[st], st === 'skipped' || st === 'todo' ? 'orange' : 'blue')) as HTMLButtonElement;
    d.type = 'button';
    d.title = `${k + 1}. ${s.title}: ${WORD[st]}`;
    d.setAttribute('aria-label', d.title);
    if (st === 'current') d.setAttribute('aria-current', 'step');
    d.addEventListener('click', () => goTo(s.id));
    return el('li', '', d);
  }));
  dots.setAttribute('aria-label', 'Steps');
  return el('div', 'rp-progress', el('span', 'rp-place', words), dots);
}

/** The foot: Back and Skip for now, then Confirm; on the summary, Close and Approve this plan. */
function foot(): void {
  if (!shown || !modal) return;
  const { m, task, review } = shown;
  const at = currentStep(m.project, task, review);
  const bar = modal.dialog.querySelector<HTMLElement>('.rp-foot');
  if (!bar) return;
  const keep = keepFocus();
  const backB = button('Back', 'arrow-left', back, 'rp-back');
  backB.disabled = review.steps[0]?.id === at;
  if (backB.disabled) backB.title = 'This is the first step';
  if (at === SUMMARY) {
    const plan = m.analysis?.planState ?? null;
    const approve = plan ? approveControls(m, task, plan, true) : [];
    const close = button('Close', 'close', () => shut(), 'rp-close');
    bar.replaceChildren(el('div', 'rp-foot-row', backB, el('span', 'spacer'), close, approve[0] ?? null), ...approve.slice(1));
  } else {
    const s = review.steps.find((x) => x.id === at)!;
    const off = confirmOff(m.project, task, s, pickedIn(m.project, task, s, picksOf(s, review.canAsk)));
    const skipB = button('Skip for now', 'debug-step-over', skip, 'rp-skip');
    const go = button(s.kind === 'question' && s.answer !== null ? 'Next' : 'Confirm', 'check', () => confirm(), 'primary rp-go');
    go.disabled = !!off;
    go.title = off ?? 'Confirm and go on (Enter)';
    bar.replaceChildren(el('div', 'rp-foot-row', backB, skipB, el('span', 'spacer'), go));
  }
  keep();
}

function make(): NonNullable<typeof modal> {
  const title = el('h2', 'rp-title');
  const close = button('Close', 'close', () => shut(), 'ghost task-modal-close');
  close.title = 'Close it, and keep what you picked (Escape)';
  const m = makeModal('review-plan', [title, close], shut);
  m.dialog.append(el('div', 'rp-foot'));
  m.dialog.addEventListener('keydown', onKey);
  m.dialog.addEventListener('close', () => { if (shown && !m.dialog.open) closed(); });
  return { ...m, title };
}

/** Up and Down move between a step's options, a number picks one, and Enter confirms and goes on. */
function onKey(e: KeyboardEvent): void {
  if (!shown || e.defaultPrevented) return;
  const { m, task, review } = shown;
  const at = currentStep(m.project, task, review);
  const s = review.steps.find((x) => x.id === at);
  const target = e.target as HTMLElement;
  const typing = !!target.closest?.('input, textarea');
  if (e.key === 'Enter') {
    // Enter on another button is that button's; on an option, in a box or on the sheet, it confirms.
    if (!typing && target.closest?.('button') && target.getAttribute('role') !== 'radio') return;
    if (typing) return; // its box's own Enter confirms
    if (!s) return;
    e.preventDefault();
    confirm();
    return;
  }
  if (!s || typing) return;
  const picks = s.kind === 'question' && s.answer !== null ? [] : picksOf(s, review.canAsk);
  if (!picks.length) return;
  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= picks.length) { e.preventDefault(); pickOption(s, picks[n - 1]!.id); return; }
  const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const i = picks.findIndex((p) => p.id === pickedIn(m.project, task, s, picks));
  pickOption(s, picks[(i + step + picks.length) % picks.length]!.id);
}

/** Draws the sheet from a task's page model, when its tab remembers it open; else closes it. */
export function draw(m: TicketModel): void {
  const r = m.analysis?.review ?? null;
  const task = m.analysis?.task ?? '';
  if (!r || !has(openKey(m.project, task))) { if (modal?.dialog.open && shown?.m.project === m.project && shown.task === task) shut(); return; }
  shown = { m, task, review: r };
  modal ??= make();
  const at = currentStep(m.project, task, r);
  const fresh = drawnAt !== at;
  const keep = keepFocus();
  modal.title.replaceChildren(r.title);
  modal.dialog.setAttribute('aria-label', r.title);
  const s = r.steps.find((x) => x.id === at);
  modal.body.replaceChildren(progress(r, at), s ? stepView(s) : summaryView());
  if (!modal.dialog.open) modal.dialog.showModal();
  foot();
  drawnAt = at;
  if (fresh) {
    // A new step: focus starts on its option, or, with none, on its main button.
    const first = modal.body.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ?? modal.dialog.querySelector<HTMLElement>('.rp-go, .rp-foot .btn.primary, .rp-close');
    first?.focus({ preventScroll: true });
  } else keep();
}

/** Review plan: opens the sheet at the first step not done yet, or the summary when every one is. */
function openReview(m: TicketModel, task: string, r: PlanReview): void {
  opener = focusedElement();
  const first = r.steps.find((s) => !s.done)?.id ?? SUMMARY;
  remember((x) => { x.opened = [...new Set([...x.opened, openKey(m.project, task)])]; x.drafts[atKey(m.project, task)] = first; });
  drawnAt = null;
  draw(m);
}

/** Review plan, the short plan section's main button while something's left, or the plan isn't approved. */
export function reviewButton(m: TicketModel, task: string, r: PlanReview): HTMLButtonElement {
  const left = r.steps.some((s) => !s.done) || !m.analysis?.planState?.approval;
  const b = button('Review plan', 'checklist', () => openReview(m, task, r), `rp-open${left ? ' primary' : ''}`);
  b.title = `Step through its choices and questions one at a time: ${r.left}`;
  return b;
}

/** Closes it, whichever way it was asked to: what's picked stays, and nothing is sent. */
export function shut(): void {
  if (!shown) return;
  toggle(openKey(shown.m.project, shown.task), false);
  if (modal?.dialog.open) modal.dialog.close();
  closed();
}

/** It closed: focus goes back to what opened it, or to Review plan, when that's on the page. */
function closed(): void {
  if (shown) toggle(openKey(shown.m.project, shown.task), false);
  shown = null;
  drawnAt = null;
  modal?.body.replaceChildren();
  const o = opener?.isConnected ? opener : document.querySelector<HTMLElement>('.rp-open');
  opener = null;
  o?.focus({ preventScroll: true });
}

export const area: PageArea = {
  // After every draw, the sheet draws again from the task's page: its tab's, or the one in the modal over the board.
  after(model: Model) {
    const m = model.kind === 'ticket' ? model : model.kind === 'home' ? state.modal : null;
    if (m) draw(m);
    else if (shown) shut();
  },
};
