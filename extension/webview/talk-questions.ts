// The planning agent's questions, one at a time, under its reply (T-113), as Review plan steps through a plan's
// choices: "Question 1 of 3" and a dot for each, the question, its one line of why, its answers as radios with the
// suggestion first and marked Suggested, and Answer in my own words with a box. A number or Up and Down picks,
// Enter confirms and goes on, Back and Skip, and Escape puts the questions aside with what's picked kept. Nothing
// is sent until the last is confirmed or skipped: then every answer goes at once, as the person's next message.

import type { TalkAnswerIn, TicketQuestion, TicketTalk } from '../src/model/talk.ts';
import { button, el, icon, md, work } from './dom.ts';
import { memory, remember, state } from './state.ts';
import { pickByKey, stepProgress, stepRadio, type StepState, stepTag } from './stepper.ts';

/** The pick that's the person's own words. */
const OWN = 'own';

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
  /** As drawn: the picked answer's radio, its own words' box, and Confirm, which the box turns on as words come. */
  radio?: HTMLElement;
  box?: HTMLInputElement;
  go?: HTMLButtonElement;
}

/** The remembered keys, under the reply's: the question it's at; what's picked in one; its own words; one confirmed or skipped; the card put aside. */
export const questionsKey = (project: string, task: string, turn: string): string => `askq:${project}#${task.toUpperCase()}:${turn}`;
const atKey = (b: string): string => `${b}:at`;
const pickKey = (b: string, k: number): string => `${b}:pick:${k}`;
const ownKey = (b: string, k: number): string => `${b}:own:${k}`;
const doneKey = (b: string, k: number): string => `${b}:done:${k}`;
const skipKey = (b: string, k: number): string => `${b}:skip:${k}`;
const awayKey = (b: string): string => `${b}:away`;

/** What takes focus once the card is next drawn: the picked answer, its box, or Answer the questions. */
let focusNext: 'radio' | 'box' | 'back' | null = null;

const redraw = (): void => { if (state.last) state.draw(state.last); };
const has = (key: string): boolean => memory().opened.includes(key);

/** A question's picks, in order: its answers, at most `max` of them with the suggestion first, then Answer in my own words, always (D-205). */
export const picksOf = (q: TicketQuestion, max: number): string[] => [...q.options.slice(0, max).map((_, k) => `o${k}`), OWN];

/** What's picked in a question: what the person picked, else the first, the suggestion. */
function pickedIn(b: string, k: number, q: TicketQuestion, max: number): string {
  const picks = picksOf(q, max);
  const kept = memory().drafts[pickKey(b, k)];
  return kept && picks.includes(kept) ? kept : picks[0]!;
}

const ownWords = (b: string, k: number): string => (memory().drafts[ownKey(b, k)] ?? '').trim();

/** The question it's at: the one it remembers, while it has that many. */
function atOf(c: Card): number {
  const at = Number(memory().drafts[atKey(c.b)] ?? 0);
  return Number.isInteger(at) && at >= 0 && at < c.q.items.length ? at : 0;
}

/** Where a question stands, as its dot shows it. */
function stateOf(b: string, k: number, at: number): StepState {
  if (k === at) return 'current';
  if (has(doneKey(b, k))) return 'done';
  return has(skipKey(b, k)) ? 'skipped' : 'todo';
}

/** The answers, together: each confirmed one's pick or own words; a skipped one, or one not reached, is null. */
export function answersOf(b: string, q: NonNullable<TicketTalk['questions']>): TalkAnswerIn[] {
  return q.items.map((item, k) => {
    if (!has(doneKey(b, k))) return null;
    const pick = pickedIn(b, k, item, q.optionsMax);
    return pick === OWN ? { text: ownWords(b, k) } : { option: Number(pick.slice(1)) };
  });
}

/** Goes to a question, and puts focus on its picked answer. */
function goTo(c: Card, k: number): void {
  remember((x) => { x.drafts[atKey(c.b)] = String(k); });
  focusNext = 'radio';
  redraw();
}

/** Picks an answer; one in the person's own words puts the cursor in its box. */
function pick(c: Card, k: number, id: string, into: 'radio' | 'box' = 'radio'): void {
  remember((x) => { x.drafts[pickKey(c.b, k)] = id; });
  focusNext = into === 'box' && id === OWN ? 'box' : 'radio';
  redraw();
}

/** Why Confirm is off, or null: the answers on their way, a message that can't go now, or own words not typed yet. */
function confirmOff(c: Card, k: number): string | null {
  if (c.send.busy) return 'Wait for your answers to go';
  if (c.s.send?.disabled) return c.s.send.disabled;
  return pickedIn(c.b, k, c.q.items[k]!, c.q.optionsMax) === OWN && !ownWords(c.b, k) ? 'Type your answer first' : null;
}

/** Marks a question confirmed or skipped, then goes on; after the last, every answer goes at once. */
function settle(c: Card, k: number, as: 'done' | 'skip'): void {
  const [on, off] = as === 'done' ? [doneKey(c.b, k), skipKey(c.b, k)] : [skipKey(c.b, k), doneKey(c.b, k)];
  remember((x) => { x.opened = [...new Set([...x.opened, on])].filter((y) => y !== off); });
  if (k + 1 < c.q.items.length) return goTo(c, k + 1);
  c.send.go(c.q.turn, answersOf(c.b, c.q));
  redraw();
}

/** Confirm, or Enter: this question is answered; on to the next, or, after the last, every answer goes. */
function confirm(c: Card): void {
  const k = atOf(c);
  if (!confirmOff(c, k)) settle(c, k, 'done');
}

/** Skip: marked skipped, and on; skipping the last sends what was answered. */
function skip(c: Card): void {
  if (!c.send.busy && !c.s.send?.disabled) settle(c, atOf(c), 'skip');
}

/** Back: the question before. What's picked in each stays. */
function back(c: Card): void {
  const k = atOf(c);
  if (k > 0) goTo(c, k - 1);
}

/** Escape puts the questions aside, as one line with Answer the questions; Answer the questions brings them back where they were. */
function aside(c: Card, away: boolean): void {
  remember((x) => { x.opened = away ? [...new Set([...x.opened, awayKey(c.b)])] : x.opened.filter((y) => y !== awayKey(c.b)); });
  focusNext = away ? 'back' : 'radio';
  redraw();
}

/** After the answers went (talk-done): what was picked for them is forgotten. */
export function answersSent(project: string, task: string): void {
  const prefix = `askq:${project}#${task.toUpperCase()}:`;
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
      remember((x) => { x.drafts[ownKey(c.b, k)] = input.value; });
      // Confirm comes on once there are words, without a redraw that would take the cursor away.
      const off = confirmOff(c, k);
      if (c.go) { c.go.disabled = !!off; c.go.title = off ?? c.go.dataset.title ?? ''; }
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirm(c); } });
    c.box = input;
    row.append(el('div', 'rp-own', input));
  }
  return row;
}

/** Keys on the card: a number or Up and Down picks, Enter confirms and goes on, Escape puts the questions aside. */
function onKey(c: Card, e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  const k = atOf(c);
  const target = e.target as HTMLElement;
  const typing = !!target.closest?.('input, textarea');
  if (e.key === 'Escape') { e.preventDefault(); aside(c, true); return; }
  if (e.key === 'Enter') {
    // Enter on another button is that button's; on an answer, it confirms. A box's own Enter confirms.
    if (typing || (target.closest?.('button') && target.getAttribute('role') !== 'radio')) return;
    e.preventDefault();
    confirm(c);
    return;
  }
  if (!typing) pickByKey(e, picksOf(c.q.items[k]!, c.q.optionsMax), pickedIn(c.b, k, c.q.items[k]!, c.q.optionsMax), (id) => pick(c, k, id));
}

/**
 * The agent's questions under its reply (T-113): one at a time, or, put aside, one line with Answer the questions.
 * Null with none waiting.
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
  const item = q.items[at]!;
  const last = at === n - 1;
  const heading = el('h3', 'rp-q', md(item.question));
  heading.id = `talk-q-${q.turn}-${at}`;
  const on = pickedIn(c.b, at, item, q.optionsMax);
  const group = el('div', 'rp-options', ...picksOf(item, q.optionsMax).map((id, i) => answerRow(c, at, id, i + 1, id === on)));
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', heading.id);
  // The question, its why and its answers are the agent's words: work data, which the words check leaves alone.
  const step = work(el('div', 'rp-step', heading, item.why ? el('p', 'rp-why muted', md(item.why)) : null, group), 'agent-text');
  step.dataset.step = String(at);
  const off = confirmOff(c, at);
  const backB = button('Back', 'arrow-left', () => back(c), 'rp-back');
  backB.disabled = at === 0;
  if (backB.disabled) backB.title = 'This is the first question';
  const skipB = button(last ? 'Skip and send' : 'Skip', 'debug-step-over', () => skip(c), 'rp-skip');
  skipB.disabled = send.busy || !!s.send.disabled;
  skipB.title = last ? 'Skip this one, and send your answers' : 'Skip this one for now';
  const go = button(send.busy ? 'Sending…' : last ? 'Confirm and send' : 'Confirm', send.busy ? 'loading~spin' : last ? 'send' : 'check', () => confirm(c), 'primary rp-go');
  go.dataset.title = last ? 'Confirm, and send every answer as your next message (Enter)' : 'Confirm and go on (Enter)';
  go.disabled = !!off;
  go.title = off ?? go.dataset.title;
  c.go = go;
  const card = el('section', 'talk-card',
    stepProgress(`Question ${at + 1} of ${n}`, q.items.map((x, k) => ({ title: x.question, state: stateOf(c.b, k, at) })), (k) => goTo(c, k)),
    step,
    el('div', 'rp-foot-row talk-card-foot', backB, skipB, el('span', 'spacer'), go),
    el('p', 'muted small talk-card-note', last ? 'Your answers go together, as your next message.' : 'Nothing is sent until the last question.'),
    send.error ? el('div', 'aq-error', icon('warning'), el('span', '', `Your answers didn't go: ${send.error}`)) : null);
  card.setAttribute('aria-label', asked);
  card.addEventListener('keydown', (e) => onKey(c, e));
  if (focusNext) {
    const into = focusNext;
    focusNext = null;
    queueMicrotask(() => (into === 'box' ? c.box : c.radio)?.focus({ preventScroll: true }));
  }
  return card;
}
