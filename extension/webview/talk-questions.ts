// The planning agent's questions, one at a time, under its reply (T-113), as Review plan steps through a plan's
// choices: "Question 1 of 3" and a dot for each, the question, its one line of why, its answers as radios with the
// suggestion first and marked Suggested, and Answer in my own words with a box. An answer counts the moment it's
// picked (T-130): a click, a number, Up and Down, or words typed in the box. Back, Skip, Next question and the dots
// only move, and never lose an answer; Next question also counts the suggestion shown picked. After the last comes
// the review: each question with its answer or "Not answered", each with Change, and Send answers to the planning
// agent, the only control that sends. Escape puts the questions aside with every answer kept.

import type { TalkAnswerIn, TicketQuestion, TicketTalk } from '../src/model/talk.ts';
import { button, el, icon, md, peekKey, work } from './dom.ts';
import { memory, remember, state } from './state.ts';
import { pickByKey, stepProgress, stepRadio, type StepState, stepTag } from './stepper.ts';

/** The pick that's the person's own words. */
const OWN = 'own';

/** The step after the last question: every answer, and Send. */
const REVIEW = 'review';

/** How the card's answers go, from talk.ts: whether a message is on its way, why the last didn't go, and the send. */
export interface AnswerSend {
  busy: boolean;
  error: string | null;
  go(turn: string, answers: TalkAnswerIn[]): void;
}

/** One draw of the card: its task's conversation, the key its memory is kept under, and how its answers go. */
interface Card {
  s: TicketTalk;
  q: NonNullable<TicketTalk['questions']>;
  b: string;
  send: AnswerSend;
  /** As drawn: the picked answer's radio, its own words' box, Skip, which the box's words turn off, and Send. */
  radio?: HTMLElement;
  box?: HTMLInputElement;
  skipB?: HTMLButtonElement;
  sendB?: HTMLButtonElement;
}

/** The remembered keys, under the reply's: the question it's at, or the review; what's picked in one; its own words; one skipped; the card put aside. */
export const questionsKey = (project: string, task: string, turn: string): string => `askq:${peekKey(project, task)}:${turn}`;
const atKey = (b: string): string => `${b}:at`;
const pickKey = (b: string, k: number): string => `${b}:pick:${k}`;
const ownKey = (b: string, k: number): string => `${b}:own:${k}`;
const skipKey = (b: string, k: number): string => `${b}:skip:${k}`;
const awayKey = (b: string): string => `${b}:away`;

/** What takes focus once the card is next drawn: the picked answer, its box, Answer the questions, or Send. */
let focusNext: 'radio' | 'box' | 'back' | 'send' | null = null;

const redraw = (): void => { if (state.last) state.draw(state.last); };
const has = (key: string): boolean => memory().opened.includes(key);

/** A question's picks, in order: its answers, at most `max` of them with the suggestion first, then Answer in my own words, always (D-205). */
export const picksOf = (q: TicketQuestion, max: number): string[] => [...q.options.slice(0, max).map((_, k) => `o${k}`), OWN];

/** What's shown picked in a question: what the person picked, else the first, the suggestion, which counts only once picked or passed with Next question. */
function pickedIn(b: string, k: number, q: TicketQuestion, max: number): string {
  const picks = picksOf(q, max);
  const kept = memory().drafts[pickKey(b, k)];
  return kept && picks.includes(kept) ? kept : picks[0]!;
}

const ownWords = (b: string, k: number): string => (memory().drafts[ownKey(b, k)] ?? '').trim();

/** A question's answer as it counts: the answer the person picked, or their own words once typed; else null, the planning agent's to decide. */
function answerOf(b: string, k: number, q: TicketQuestion, max: number): TalkAnswerIn {
  const kept = memory().drafts[pickKey(b, k)];
  if (!kept || !picksOf(q, max).includes(kept)) return null;
  if (kept !== OWN) return { option: Number(kept.slice(1)) };
  const text = ownWords(b, k);
  return text ? { text } : null;
}

/** The question it's at, or the review: the one it remembers, while it has that many. */
function atOf(c: Card): number | typeof REVIEW {
  const kept = memory().drafts[atKey(c.b)];
  if (kept === REVIEW) return REVIEW;
  const at = Number(kept ?? 0);
  return Number.isInteger(at) && at >= 0 && at < c.q.items.length ? at : 0;
}

/** Where a question stands, as its dot shows it; one answered is answered, even if it was skipped before. */
function stateOf(b: string, k: number, q: NonNullable<TicketTalk['questions']>): Exclude<StepState, 'current'> {
  if (answerOf(b, k, q.items[k]!, q.optionsMax)) return 'done';
  return has(skipKey(b, k)) ? 'skipped' : 'todo';
}

/** A dot's state in words, for its name ("Question 2: answered"). */
const STATE_WORD: Record<Exclude<StepState, 'current'>, string> = { done: 'answered', skipped: 'skipped', todo: 'not answered yet' };

/** The answers, together: each one that counts, as its pick or own words; one skipped, or never answered, is null. */
export function answersOf(b: string, q: NonNullable<TicketTalk['questions']>): TalkAnswerIn[] {
  return q.items.map((item, k) => answerOf(b, k, item, q.optionsMax));
}

/** Goes to a question, or the review, and puts focus on its picked answer, or on Send. Nothing is recorded. */
function goTo(c: Card, k: number | typeof REVIEW): void {
  remember((x) => { x.drafts[atKey(c.b)] = String(k); });
  focusNext = k === REVIEW ? 'send' : 'radio';
  redraw();
}

/** Picks an answer, and it counts at once; one in the person's own words puts the cursor in its box. */
function pick(c: Card, k: number, id: string, into: 'radio' | 'box' = 'radio'): void {
  remember((x) => {
    x.drafts[pickKey(c.b, k)] = id;
    x.opened = x.opened.filter((y) => y !== skipKey(c.b, k));
  });
  focusNext = into === 'box' && id === OWN ? 'box' : 'radio';
  redraw();
}

/** Where moving on from a question goes: the next, or the review after the last. */
const after = (c: Card, k: number): number | typeof REVIEW => (k + 1 < c.q.items.length ? k + 1 : REVIEW);

/** Next question, or Enter: the suggestion shown picked counts, if nothing else was picked; then on. Nothing is sent. */
function next(c: Card): void {
  const at = atOf(c);
  if (at === REVIEW) return;
  const shown = pickedIn(c.b, at, c.q.items[at]!, c.q.optionsMax);
  if (!memory().drafts[pickKey(c.b, at)] && shown !== OWN) pick(c, at, shown);
  goTo(c, after(c, at));
}

/** Why Skip is off, or null: a question answered keeps its answer, so only Next question goes on from it. */
function skipOff(c: Card, k: number): string | null {
  return answerOf(c.b, k, c.q.items[k]!, c.q.optionsMax) ? 'You answered this one. Next question keeps your answer.' : null;
}

/** Skip: a question not answered is marked skipped, the planning agent's to decide, and on. Nothing is sent. */
function skip(c: Card): void {
  const at = atOf(c);
  if (at === REVIEW || skipOff(c, at)) return;
  remember((x) => { x.opened = [...new Set([...x.opened, skipKey(c.b, at)])]; });
  goTo(c, after(c, at));
}

/** Back: the question before, or the last from the review. Every answer stays. */
function back(c: Card): void {
  const at = atOf(c);
  if (at === REVIEW) goTo(c, c.q.items.length - 1);
  else if (at > 0) goTo(c, at - 1);
}

/** Why Send is off, or null: the answers on their way, or a message that can't go now. */
function sendOff(c: Card): string | null {
  if (c.send.busy) return 'Wait for your answers to go';
  return c.s.send?.disabled ?? null;
}

/** Send answers to the planning agent: the only way the answers go, every one at once, as one message. */
function sendAll(c: Card): void {
  if (sendOff(c)) return;
  c.send.go(c.q.turn, answersOf(c.b, c.q));
  redraw();
}

/** Escape puts the questions aside, as one line with Answer the questions; Answer the questions brings them back where they were. */
function aside(c: Card, away: boolean): void {
  remember((x) => { x.opened = away ? [...new Set([...x.opened, awayKey(c.b)])] : x.opened.filter((y) => y !== awayKey(c.b)); });
  focusNext = away ? 'back' : 'radio';
  redraw();
}

/** After the answers went (talk-done): what was picked for them is forgotten. */
export function answersSent(project: string, task: string): void {
  const prefix = `askq:${peekKey(project, task)}:`;
  remember((x) => {
    for (const k of Object.keys(x.drafts)) if (k.startsWith(prefix)) delete x.drafts[k];
    x.opened = x.opened.filter((y) => !y.startsWith(prefix));
  });
}

/** One answer's row: its radio, and, for the person's own words, its box once picked. */
function answerRow(c: Card, k: number, id: string, n: number, on: boolean): HTMLElement {
  const q = c.q.items[k]!;
  const o = id === OWN ? null : q.options[Number(id.slice(1))]!;
  const radio = stepRadio({
    n, name: o ? o.label : 'Answer in my own words', line: o ? undefined : 'Type your answer', on, pick: id, click: () => pick(c, k, id, 'box'),
    tags: [o?.suggested ? stepTag('rp-rec', 'star-full', 'Suggested') : null],
  });
  const row = el('div', `rp-option${on ? ' on' : ''}`, radio);
  if (on) c.radio = radio;
  if (on && id === OWN) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text-input';
    input.maxLength = c.q.answerMax;
    input.value = memory().drafts[ownKey(c.b, k)] ?? '';
    input.placeholder = 'Your answer';
    input.dataset.keep = ownKey(c.b, k);
    input.setAttribute('aria-label', `Your answer to: ${q.question}`);
    input.addEventListener('input', () => {
      // Words typed count at once, as a pick does: own words is picked, and the question no longer skipped.
      remember((x) => {
        x.drafts[ownKey(c.b, k)] = input.value;
        x.drafts[pickKey(c.b, k)] = OWN;
        x.opened = x.opened.filter((y) => y !== skipKey(c.b, k));
      });
      // Skip goes off once there are words, without a redraw that would take the cursor away.
      const off = skipOff(c, k);
      if (c.skipB) { c.skipB.disabled = !!off; c.skipB.title = off ?? c.skipB.dataset.title ?? ''; }
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); next(c); } });
    c.box = input;
    row.append(el('div', 'rp-own', input));
  }
  return row;
}

/** Keys on the card: a number or Up and Down picks, Enter goes on as Next question does, Escape puts the questions aside. */
function onKey(c: Card, e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  const k = atOf(c);
  const target = e.target as HTMLElement;
  const typing = !!target.closest?.('input, textarea');
  if (e.key === 'Escape') { e.preventDefault(); aside(c, true); return; }
  if (e.key === 'Enter') {
    // Enter on another button is that button's, so on the review only Send, with focus, sends; on an answer it
    // goes on, and on the review it does nothing. A box's own Enter goes on.
    if (typing || (target.closest?.('button') && target.getAttribute('role') !== 'radio')) return;
    e.preventDefault();
    next(c);
    return;
  }
  if (!typing && k !== REVIEW) pickByKey(e, picksOf(c.q.items[k]!, c.q.optionsMax), pickedIn(c.b, k, c.q.items[k]!, c.q.optionsMax), (id) => pick(c, k, id));
}

/** One question's step: the question, its why, and its answers as radios. */
function questionStep(c: Card, at: number): HTMLElement {
  const item = c.q.items[at]!;
  const heading = el('h3', 'rp-q', md(item.question));
  heading.id = `talk-q-${c.q.turn}-${at}`;
  const on = pickedIn(c.b, at, item, c.q.optionsMax);
  const group = el('div', 'rp-options', ...picksOf(item, c.q.optionsMax).map((id, i) => answerRow(c, at, id, i + 1, id === on)));
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', heading.id);
  // The question, its why and its answers are the agent's words: work data, which the words check leaves alone.
  const step = work(el('div', 'rp-step', heading, item.why ? el('p', 'rp-why muted', md(item.why)) : null, group), 'agent-text');
  step.dataset.step = String(at);
  return step;
}

/** What an answer reads as on the review: its answer's words, or the person's own. */
const answerWords = (item: TicketQuestion, a: NonNullable<TalkAnswerIn>): string => ('text' in a ? a.text : item.options[a.option]!.label);

/** The review: every question with its answer, or Not answered in orange, each with Change to go back to it. */
function reviewStep(c: Card): HTMLElement {
  const heading = el('h3', 'rp-q', 'Your answers');
  heading.id = `talk-q-${c.q.turn}-${REVIEW}`;
  const rows = c.q.items.map((item, k) => {
    const a = answerOf(c.b, k, item, c.q.optionsMax);
    const change = button('Change', 'edit', () => goTo(c, k), 'small talk-review-change');
    change.setAttribute('aria-label', `Change your answer to question ${k + 1}`);
    // The question and the answer picked from the agent's are its words: work data, as on the question's step.
    return el('li', `talk-review-row${a ? '' : ' none'}`,
      icon(a ? 'pass-filled' : 'circle-large-outline', a ? 'blue' : 'orange'),
      el('span', 'talk-review-text',
        work(el('span', 'talk-review-q', md(item.question)), 'agent-text'),
        a ? work(el('span', 'talk-review-a', md(answerWords(item, a))), 'agent-text') : el('span', 'talk-review-a tone-orange', 'Not answered: the planning agent decides')),
      change);
  });
  const list = el('ol', 'talk-review', ...rows);
  list.setAttribute('aria-labelledby', heading.id);
  // Not an rp-step: the review shows at once, without the questions' fade, so the screenshot run measures its Change buttons.
  const step = el('div', 'talk-review-step', heading, list);
  step.dataset.step = REVIEW;
  return step;
}

/** The foot under a question: Back, Skip, and Next question, which on the last is Review answers. */
function questionFoot(c: Card, at: number, backB: HTMLButtonElement): HTMLElement {
  const skipB = button('Skip', 'debug-step-over', () => skip(c), 'rp-skip');
  skipB.dataset.title = 'Leave this one to the planning agent, and go on';
  const off = skipOff(c, at);
  skipB.disabled = !!off;
  skipB.title = off ?? skipB.dataset.title;
  c.skipB = skipB;
  const last = at === c.q.items.length - 1;
  const go = button(last ? 'Review answers' : 'Next question', 'arrow-right', () => next(c), 'primary rp-go');
  go.title = last ? 'See every answer before they go (Enter)' : 'Go on to the next question (Enter)';
  return el('div', 'rp-foot-row talk-card-foot', backB, skipB, el('span', 'spacer'), go);
}

/** The foot under the review: Back, and Send answers to the planning agent, off with why while it can't go. */
function reviewFoot(c: Card, backB: HTMLButtonElement): HTMLElement {
  const sendB = button(c.send.busy ? 'Sending…' : 'Send answers to the planning agent', c.send.busy ? 'loading~spin' : 'send', () => sendAll(c), 'primary rp-go');
  const off = sendOff(c);
  sendB.disabled = !!off;
  sendB.title = off ?? 'Send every answer, as one message';
  c.sendB = sendB;
  return el('div', 'rp-foot-row talk-card-foot', backB, el('span', 'spacer'), sendB);
}

/**
 * The agent's questions under its reply (T-113): one at a time, then the review (T-130), or, put aside, one line
 * with Answer the questions. Null with none waiting.
 */
export function questionCard(project: string, s: TicketTalk, send: AnswerSend): HTMLElement | null {
  const q = s.questions;
  if (!q || !s.send) return null;
  const c: Card = { s, q, b: questionsKey(project, s.task, q.turn), send };
  const n = q.items.length;
  const asked = n === 1 ? 'A question from the planning agent' : `${n} questions from the planning agent`;
  if (has(awayKey(c.b)) && !send.busy) {
    const again = button(n === 1 ? 'Answer it' : 'Answer the questions', 'comment-discussion', () => aside(c, false), 'small talk-card-back');
    if (focusNext === 'back') { focusNext = null; queueMicrotask(() => again.focus()); }
    const line = el('div', 'talk-card-aside', icon('question'), el('span', '', asked), again);
    line.setAttribute('role', 'group');
    line.setAttribute('aria-label', asked);
    return line;
  }
  const at = atOf(c);
  const dots = q.items.map((x, k) => ({ title: x.question, state: k === at ? 'current' as const : stateOf(c.b, k, q) }));
  const name = (k: number): string => `Question ${k + 1}: ${k === at ? 'on show, ' : ''}${STATE_WORD[stateOf(c.b, k, q)]}`;
  const backB = button('Back', 'arrow-left', () => back(c), 'rp-back');
  backB.disabled = at === 0;
  if (backB.disabled) backB.title = 'This is the first question';
  const card = el('section', 'talk-card',
    stepProgress(at === REVIEW ? 'Review your answers' : `Question ${at + 1} of ${n}`, dots, (k) => goTo(c, k), name),
    at === REVIEW ? reviewStep(c) : questionStep(c, at),
    at === REVIEW ? reviewFoot(c, backB) : questionFoot(c, at, backB),
    el('p', 'muted small talk-card-note', at === REVIEW ? 'This sends all your answers to the planning agent as one message.' : 'Your answers are kept as you pick them. Nothing is sent until you review them.'),
    send.error ? el('div', 'aq-error', icon('warning'), el('span', '', `Your answers didn't go: ${send.error}`)) : null);
  card.setAttribute('aria-label', asked);
  card.addEventListener('keydown', (e) => onKey(c, e));
  if (focusNext) {
    const into = focusNext;
    focusNext = null;
    queueMicrotask(() => (into === 'box' ? c.box : into === 'send' ? c.sendB : c.radio)?.focus({ preventScroll: true }));
  }
  return card;
}
