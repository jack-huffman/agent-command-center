// A plan's conversation with its planning agent (T-98, T-111). It is drawn in its own panel, beside the task's
// page: each turn, what a message is about quoted, each change a reply proposes with Use
// this, and what a Claude Code session recorded; before there is a plan, its question first, and Draft the plan
// or Skip to the plan. The agent's questions are asked one at a time under its reply (T-113, talk-questions.ts),
// and less shows at once: a long reply folds with Show more, the turns before the latest exchange fold under
// "Earlier in this conversation", and a proposal is one line whose Why opens its reasons. The task's page shows
// one line of it, with Open conversation; Discuss on any part of the plan opens the panel with that part quoted.
// Each button asks the extension, and shows it's on its way until the extension says how it went. It is laid out
// as Claude Code's chat (T-160, chat.ts): the person's message boxed and kept on top, replies full width, and the
// message box as a card under the chat.

import type { TicketProposal, TicketTalk, TicketTurn } from '../src/model/talk.ts';
import { chatCard, chatExchange, chatFoot, chatLog, chatReply, chatStatus, chatYou, sendButton } from './chat.ts';
import { actionButton, button, el, icon, md, peekKey, status, when, work } from './dom.ts';
import { Pending } from './pending.ts';
import { planProgressBlock } from './plan-progress.ts';
import { api, memory, type PageArea, remember, state } from './state.ts';
import { answersSent, questionCard } from './talk-questions.ts';

/** The longest message a page sends, as acc takes it. */
const TALK_MAX = 4000;

/** Messages, Use this and Open in Claude Code on their way to acc, and why the last one didn't go. */
export const talkPending = new Pending<'send' | 'use' | 'claude'>();
const base = (project: string, task: string): string => `talk:${peekKey(project, task)}`;
export const sendKey = (project: string, task: string): string => `${base(project, task)}:send`;
export const useKey = (project: string, task: string, turn: string, proposal: string): string => `${base(project, task)}:${turn}.${proposal}`;
const claudeKey = (project: string, task: string): string => `${base(project, task)}:claude`;
/** The remembered key holding what the next message is about: its reference, a line, then its words. */
const aboutKey = (project: string, task: string): string => `${base(project, task)}:about`;
/** The remembered key of a Use this that waits for the person's yes, on an approved plan. */
const confirmKey = (key: string): string => `${key}:confirm`;
/** The remembered keys of what's unfolded (T-113): the earlier turns, a long reply's Show more, and a proposal's Why. */
export const earlierKey = (project: string, task: string): string => `${base(project, task)}:earlier`;
const moreKey = (project: string, task: string, turn: string): string => `${base(project, task)}:more:${turn}`;
const whyKey = (key: string): string => `${key}:why`;
const isOpen = (key: string): boolean => memory().opened.includes(key);
const flip = (key: string): void => { remember((x) => { x.opened = isOpen(key) ? x.opened.filter((y) => y !== key) : [...x.opened, key]; }); redraw(); };

/** The message box takes focus once the page next draws it: after Discuss, or Ask again. */
let focusBox = false;

const redraw = (): void => { if (state.last) state.draw(state.last); };

/** The message box takes focus when it's next drawn: the panel's first draw (T-111). */
export function focusTalk(): void {
  focusBox = true;
}

/**
 * Opens the task's conversation in its own panel (T-111), beside the page, with a part of the plan quoted when
 * `about` names one: the panel puts it over its box, and the cursor in it.
 */
export function openTalk(project: string, task: string, about?: { ref: string; text: string }): void {
  api.postMessage({ type: 'conversation-open', project, task, ...(about ? { about } : {}) });
}

/**
 * Discuss on a choice, an option, a step, a risk or a question (T-98): opens the conversation with it quoted.
 * Its name says what it's about, for a screen reader.
 */
export function discussButton(project: string, task: string, ref: string, text: string, what: string): HTMLButtonElement {
  const b = button('Discuss', 'comment-discussion', () => openTalk(project, task, { ref, text }), 'ghost small talk-discuss');
  b.setAttribute('aria-label', `Discuss ${what}`);
  b.title = `Talk ${what} through with the planning agent`;
  return b;
}

/**
 * The task page's one line of its conversation (T-111): "Conversation · 12 messages · 5 min ago", and Open
 * conversation. The conversation itself is drawn only in its panel.
 */
export function conversationLine(project: string, s: TicketTalk): HTMLElement | null {
  if (!s.line) return null;
  const open = button('Open conversation', 'comment-discussion', () => openTalk(project, s.task), 'small');
  open.title = 'The whole conversation with the planning agent, in its own panel beside this page';
  const line = el('div', 'convo-line', icon('comment-discussion'), el('span', 'convo-words', s.line.words), el('span', 'muted', '·'), when(s.line.at), open);
  line.setAttribute('role', 'group');
  line.setAttribute('aria-label', s.line.words);
  return line;
}

/** What the next message is about, or null. */
function aboutOf(project: string, task: string): { ref: string; text: string } | null {
  const v = memory().drafts[aboutKey(project, task)];
  if (!v) return null;
  const [ref, ...text] = v.split('\n');
  return ref ? { ref, text: text.join('\n') } : null;
}

const KIND_WORDS: Record<string, string> = { choice: 'Choice', option: 'Option', step: 'Step', risk: 'Risk', question: 'Question' };

/** What a reference names, as acc's quoteOf reads it: d1.a an option, d1 a choice, s2 a step, r1 a risk, q1 a question. */
export const kindOf = (ref: string): string => (ref.includes('.') ? 'option' : ({ d: 'choice', s: 'step', r: 'risk', q: 'question' } as Record<string, string>)[ref[0] ?? ''] ?? 'about');

/** What a message is about, quoted under who said it. */
const quote = (kind: string, ref: string, text: string): HTMLElement =>
  el('blockquote', 'talk-quote', icon('quote'), el('span', '', el('strong', '', `${KIND_WORDS[kind] ?? 'About'} ${ref}: `), md(text)));

/**
 * Using a proposal on an approved plan asks first, in acc's words: Change it sends it with a yes; Keep the
 * approval, or Escape, sends nothing and gives focus back to Use this.
 */
function confirmUse(project: string, s: TicketTalk, t: TicketTurn, p: TicketProposal, key: string): HTMLElement {
  const keep = () => { remember((x) => { x.opened = x.opened.filter((y) => y !== confirmKey(key)); }); focusUse = key; redraw(); };
  const change = () => { remember((x) => { x.opened = x.opened.filter((y) => y !== confirmKey(key)); }); use(project, s, t, p, true); };
  const said = el('p', 'pc-text', p.ask ?? '');
  said.id = `tc-${t.id}-${p.id}`;
  const no = button('Keep the approval', 'verified', keep);
  queueMicrotask(() => { if (focusUse === `${key}:keep`) { focusUse = null; no.focus(); } });
  const box = el('div', 'plan-confirm notice attention', icon('warning', 'orange'),
    el('div', 'pc-body', said, el('div', 'actions pc-actions', no, button('Change it', 'check', change, 'primary'))));
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-label', `Use this: ${p.words}?`);
  box.setAttribute('aria-describedby', said.id);
  box.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; e.preventDefault(); e.stopPropagation(); keep(); });
  return box;
}

/** The control that takes focus once drawn: a dialog's Keep the approval (`<key>:keep`), or the Use this that asked. */
let focusUse: string | null = null;

function use(project: string, s: TicketTalk, t: TicketTurn, p: TicketProposal, yes = false): void {
  const key = useKey(project, s.task, t.id, p.id);
  if (p.ask && !yes) {
    remember((x) => { x.opened = [...new Set([...x.opened, confirmKey(key)])]; });
    focusUse = `${key}:keep`;
    return redraw();
  }
  if (!talkPending.start(key, 'use')) return;
  api.postMessage({ type: 'talk-use', project, task: s.task, turn: t.id, proposal: p.id, ...(yes ? { yes: true } : {}) });
  redraw();
}

/** Ask again about a proposal from an older version: the message box takes it, in words, to send or change. */
function askAgain(project: string, task: string, p: TicketProposal): void {
  remember((x) => { x.drafts[sendKey(project, task)] = `You proposed this on v${p.from}. Does it still hold for the plan now? ${p.words}`; });
  focusBox = true;
  redraw();
}

/**
 * One change a reply proposes, as one line (T-113): what it would record, Why, which opens its reasons, then Use
 * this, or who used it.
 */
function proposal(project: string, s: TicketTalk, t: TicketTurn, p: TicketProposal): HTMLElement {
  const key = useKey(project, s.task, t.id, p.id);
  const open = isOpen(whyKey(key));
  const why = p.why ? button('Why', open ? 'chevron-down' : 'chevron-right', () => flip(whyKey(key)), 'ghost small tp-why-toggle') : null;
  if (why) { why.setAttribute('aria-expanded', String(open)); why.setAttribute('aria-label', `Why: ${p.words}`); }
  const line = el('div', 'tp-line', icon(p.used ? 'pass-filled' : 'lightbulb'), el('span', 'tp-words', el('strong', '', 'Proposes: '), md(p.words)), p.from ? el('span', 'chip talk-v', `from v${p.from}`) : null, el('span', 'tp-actions', why));
  const box = el('div', `talk-proposal${p.used ? ' used' : ''}`, line, open && p.why ? el('div', 'muted small tp-why', md(p.why)) : null);
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', `Proposal: ${p.words}${p.used ? ', used' : ''}`);
  const actions = line.querySelector<HTMLElement>('.tp-actions')!;
  if (p.used) {
    actions.append(el('span', 'tp-used small', status({ label: 'Used', icon: 'pass-filled', tone: 'blue' }), el('span', 'muted', `by ${p.used.by} `), when(p.used.at)));
  } else if (p.use) {
    const busy = !!talkPending.what(key);
    const b = button(busy ? 'Recording…' : 'Use this', busy ? 'loading~spin' : 'check', () => use(project, s, t, p), 'small');
    b.setAttribute('aria-label', `Use this: ${p.words}`);
    const why = p.use.disabled ?? (busy ? 'Wait for it to be recorded' : null);
    b.disabled = !!why;
    if (why) { b.title = why; b.setAttribute('aria-description', why); }
    if (focusUse === key) { focusUse = null; queueMicrotask(() => b.focus()); }
    // A proposal from an older version can't be used: Ask again puts it in the message box, to ask about the plan now.
    const again = p.from ? button('Ask again', 'comment-discussion', () => askAgain(project, s.task, p), 'small') : null;
    if (again) again.setAttribute('aria-label', `Ask again: ${p.words}`);
    actions.append(b, again ?? '');
    if (p.use.disabled) box.append(el('div', 'muted small tp-off', p.use.disabled));
    if (memory().opened.includes(confirmKey(key)) && p.ask && !busy) box.append(confirmUse(project, s, t, p, key));
  }
  const error = talkPending.error(key);
  if (error) box.append(el('div', 'aq-error', icon('warning'), el('span', '', `It wasn't recorded: ${error}`)));
  return box;
}

/** A turn's words; long ones fold to about eight lines, with Show more (T-113). */
function words(project: string, s: TicketTalk, t: TicketTurn): HTMLElement[] {
  const key = moreKey(project, s.task, t.id);
  const folded = t.long && !isOpen(key);
  const text = el('div', `talk-text${folded ? ' talk-folded' : ''}`, md(t.text));
  if (!t.long) return [t.who === 'agent' ? work(text, 'agent-text') : text];
  text.id = `talk-text-${t.id}`;
  const more = button(folded ? 'Show more' : 'Show less', folded ? 'chevron-down' : 'chevron-up', () => flip(key), 'ghost small talk-more-text');
  more.setAttribute('aria-expanded', String(!folded));
  more.setAttribute('aria-controls', text.id);
  return [t.who === 'agent' ? work(text, 'agent-text') : text, more];
}

/**
 * One turn (T-160): the person's words in a box with no heading, what they're about as a chip over them; the
 * planning agent's across the full width, then what it proposed; Claude Code's session and a new version of the
 * plan with who and when on a line, then what they recorded.
 */
function turn(project: string, s: TicketTalk, t: TicketTurn): HTMLElement {
  const version = el('span', 'chip talk-v', t.before ? 'Before the plan' : `v${t.version}`);
  if (t.who === 'you') {
    const failed = t.failed ? el('div', 'aq-error', icon('warning'), el('span', '', `No reply: ${t.failed}`)) : null;
    const you = chatYou(`${t.name}${t.by ? ` (${t.by})` : ''}`, t.about ? quote(t.about.kind, t.about.ref, t.about.text) : null, ...words(project, s, t), failed);
    you.classList.add('talk-turn', 'who-you');
    return you;
  }
  const reply = chatReply(`talk-turn who-${t.who}`);
  reply.setAttribute('role', 'group');
  reply.setAttribute('aria-label', t.name);
  if (t.who === 'agent') reply.append(t.about ? quote(t.about.kind, t.about.ref, t.about.text) : '', ...words(project, s, t), el('div', 'chat-meta', when(t.at), version));
  else {
    reply.append(el('div', 'talk-who', icon(t.icon), el('strong', '', t.name), t.by ? el('span', 'muted', `opened by ${t.by}`) : null, when(t.at), version,
      t.open ? status({ label: 'Open now', icon: 'circle-filled', tone: 'blue' }) : null), ...(t.text ? words(project, s, t) : []));
  }
  if (t.proposals.length) reply.append(el('div', 'talk-proposals', ...t.proposals.map((p) => proposal(project, s, t, p))));
  if (t.who === 'claude-code') {
    reply.append(t.recorded.length
      ? el('div', 'talk-recorded', el('div', 'strong small', 'It recorded'), el('ul', 'an-list', ...t.recorded.map((r) => el('li', '', md(r)))))
      : el('div', 'muted small', t.open ? 'Nothing recorded yet.' : 'It recorded nothing.'));
  } else if (t.who === 'plan' && t.recorded.length) {
    reply.append(el('div', 'talk-recorded', el('div', 'strong small', 'What changed'), el('ul', 'an-list', ...t.recorded.map((r) => el('li', '', md(r))))));
  }
  return reply;
}

/** The turns as exchanges (T-160): each of the person's messages starts one, and what came after it follows. */
function exchanges(project: string, s: TicketTalk, turns: TicketTurn[]): HTMLElement[] {
  const out: { you: HTMLElement | null; rest: HTMLElement[] }[] = [];
  for (const t of turns) {
    if (t.who === 'you' || !out.length) out.push({ you: null, rest: [] });
    const x = out[out.length - 1]!;
    if (t.who === 'you') x.you = turn(project, s, t); else x.rest.push(turn(project, s, t));
  }
  return out.map((x) => chatExchange(x.you, ...x.rest));
}

/**
 * The message box as a card (T-160): what it's about as a chip, with a way to take that off, the words, then the
 * row: the conversation's own buttons on the left, and Send.
 */
function composer(project: string, s: TicketTalk, left: HTMLElement[]): HTMLElement {
  const key = sendKey(project, s.task);
  const about = aboutOf(project, s.task);
  const busy = !!talkPending.what(key);
  const box = document.createElement('textarea');
  box.className = 'text-input talk-box';
  box.rows = 2;
  box.maxLength = TALK_MAX;
  box.value = memory().drafts[key] ?? '';
  box.dataset.keep = key;
  box.placeholder = s.stage === 'opening' ? 'What you want to do, and what you\'re thinking' : 'Ask why, push back, or suggest another way';
  box.setAttribute('aria-label', 'Your message to the planning agent');
  box.addEventListener('input', () => { remember((x) => { x.drafts[key] = box.value; }); });
  const why = s.send?.disabled ?? (busy ? 'Wait for your message to go' : null);
  const go = () => {
    const text = box.value.trim();
    if (!text || why || !talkPending.start(key, 'send')) return;
    api.postMessage({ type: 'talk-send', project, task: s.task, text, ...(about ? { about: about.ref } : {}) });
    redraw();
  };
  // Send is outlined while Draft the plan is the step to take, so only one is primary.
  const send = sendButton(box, { why, busy, primary: s.draft?.disabled !== null, go });
  if (focusBox) { focusBox = false; queueMicrotask(() => box.focus()); }
  const off = about ? button('', 'close', () => { remember((x) => { delete x.drafts[aboutKey(project, s.task)]; }); redraw(); }, 'ghost small icon-only') : null;
  if (off) { off.setAttribute('aria-label', 'Not about this any more'); off.title = 'Not about this any more'; }
  const error = talkPending.error(key);
  return el('div', 'talk-compose', chatCard({
    about: about ? el('div', 'talk-about', quote(kindOf(about.ref), about.ref, about.text), off) : null,
    box,
    left,
    send,
    after: [
      error ? el('div', 'aq-error', icon('warning'), el('span', '', `Your message didn't go: ${error}`)) : null,
      why && s.send?.disabled ? el('div', 'muted small talk-why', why) : null,
    ],
  }));
}

/** Draft the plan and Skip to the plan (T-111), before there is one: each off with why while it can't go. */
function planButtons(project: string, s: TicketTalk): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (s.draft) {
    const b = button('Draft the plan', 'lightbulb', () => api.postMessage({ type: 'conversation-draft', project, task: s.task }), s.draft.disabled ? 'small' : 'primary small');
    b.disabled = !!s.draft.disabled;
    b.title = s.draft.disabled ?? 'The planning agent investigates and drafts the plan, from the ticket and this conversation';
    if (s.draft.disabled) b.setAttribute('aria-description', s.draft.disabled);
    out.push(b);
  }
  if (s.skip) {
    const b = button('Skip to the plan', 'debug-step-over', () => api.postMessage({ type: 'conversation-draft', project, task: s.task, skip: true }), 'small');
    b.disabled = !!s.skip.disabled;
    b.title = s.skip.disabled ?? 'Make the plan from the ticket alone, without this conversation';
    if (s.skip.disabled) b.setAttribute('aria-description', s.skip.disabled);
    out.push(b);
  }
  return out;
}

/**
 * The conversation, in its panel (T-111), as Claude Code's chat (T-160). The chat scrolls: what it does, or
 * before the plan its question; each exchange; the agent's questions under its reply; what it is doing. Under
 * the chat: a status line while the agent works or a plan is made, then the message card, whose row holds Draft
 * the plan and Skip to the plan, or Make a new plan and Open in Claude Code, and Send.
 */
export function renderConversation(project: string, s: TicketTalk): HTMLElement {
  const sec = el('section', `talk tone-edge-${s.look.tone}`);
  sec.id = 'talk';
  sec.setAttribute('aria-label', `${s.stage === 'opening' ? 'Before the plan' : 'Talk it through'}: ${s.look.label}`);
  const log = chatLog('The conversation');
  // No icon of its own: the panel's title carries the conversation's (T-129).
  if (s.ask) log.append(el('h2', 'talk-ask', el('span', '', s.ask)));
  log.append(el('p', 'muted an-note', s.note));
  // The turns before the latest exchange fold under one line (T-113), until the person opens them.
  const ek = earlierKey(project, s.task);
  const all = !s.earlier || isOpen(ek);
  if (s.earlier) {
    const fold = button(`Earlier in this conversation (${s.earlier} message${s.earlier === 1 ? '' : 's'})`, all ? 'chevron-down' : 'chevron-right', () => flip(ek), 'ghost small talk-earlier');
    fold.setAttribute('aria-expanded', String(all));
    log.append(fold);
  }
  const shown = all ? s.turns : s.turns.slice(s.earlier);
  const groups = exchanges(project, s, shown);
  if (groups.length) log.append(el('div', 'talk-turns', ...groups));
  // The agent's questions and what it is doing go under its latest reply, inside the last exchange.
  const latest = groups[groups.length - 1] ?? log;
  const key = sendKey(project, s.task);
  const card = questionCard(project, s, {
    busy: !!talkPending.what(key), error: talkPending.error(key) ?? null,
    go: (turnId, answers) => {
      if (!talkPending.start(key, 'send')) return;
      api.postMessage({ type: 'talk-answers', project, task: s.task, turn: turnId, answers });
    },
  });
  if (card) latest.append(card);
  // What the planning agent is doing (T-131), once the Command Center has read it.
  const progress = planProgressBlock(project, s.task, s.progress);
  if (progress) latest.append(progress);
  // The status line, while a reply or a plan is on its way.
  const working = s.running ? (s.stage === 'opening' ? 'The planning agent is reading the ticket to reply. Its steps show in the output panel.' : 'The planning agent is reading the code to reply. Its steps show in the output panel.')
    : s.making ? s.making.words : null;
  const ck = claudeKey(project, s.task);
  const buttons: HTMLElement[] = planButtons(project, s);
  if (s.newPlan) { const b = actionButton(s.newPlan); b.classList.add('small'); buttons.push(b); }
  if (s.claude) {
    const busy = !!talkPending.what(ck);
    const b = button(busy ? 'Opening…' : 'Open in Claude Code', busy ? 'loading~spin' : 'terminal', () => {
      if (!talkPending.start(ck, 'claude')) return;
      api.postMessage({ type: 'talk-claude', project, task: s.task });
      redraw();
    }, 'small');
    const why = s.claude.disabled ?? (busy ? 'Wait for it to open' : null);
    b.disabled = !!why;
    b.title = why ?? 'A longer session in Claude Code, in plan mode: it reads, and records to the plan only what you agree to';
    if (why) b.setAttribute('aria-description', why);
    buttons.push(b);
  }
  const why = s.draft?.disabled && !s.making && !s.running ? s.draft.disabled : null;
  const error = talkPending.error(ck);
  const foot = chatFoot(
    working ? chatStatus('sync~spin', undefined, 'talk-waiting', working) : null,
    s.send ? composer(project, s, buttons) : buttons.length ? el('div', 'actions an-actions talk-more', ...buttons) : null,
    why ? el('div', 'plan-why muted small', icon('info'), el('span', '', `Draft the plan is off: ${why}`)) : null,
    error ? el('div', 'aq-error', icon('warning'), el('span', '', `Claude Code didn't open: ${error}`)) : null);
  sec.append(log, foot);
  return sec;
}

/** How Send, Use this or Open in Claude Code went: done clears what was sent; a refusal shows why. */
function done(msg: { action?: string; project?: string; task?: string; turn?: string; proposal?: string; ok?: boolean; error?: string }): void {
  const project = msg.project ?? '';
  const task = msg.task ?? '';
  const key = msg.action === 'talk-send' || msg.action === 'talk-answers' ? sendKey(project, task) : msg.action === 'talk-use' ? useKey(project, task, msg.turn ?? '', msg.proposal ?? '') : claudeKey(project, task);
  if (!talkPending.what(key)) return;
  talkPending.settle(key, msg.ok ? null : msg.error?.trim() || 'It didn\'t go, and the Command Center didn\'t say why.');
  // A message that went clears its words and what it was about.
  if (msg.ok && msg.action === 'talk-send') remember((x) => { delete x.drafts[key]; delete x.drafts[aboutKey(project, task)]; });
  // Answers that went forget what was picked for them; ones that didn't keep it, to send again.
  if (msg.ok && msg.action === 'talk-answers') answersSent(project, task);
  redraw();
}

/** Discuss on the task's page quoted a part of the plan (T-111): the panel puts it over the box, with the cursor in it. */
function quoted(msg: { project?: string; task?: string; ref?: string; text?: string }): void {
  if (!msg.project || !msg.task || !msg.ref) return;
  const key = aboutKey(msg.project, msg.task);
  remember((x) => { x.drafts[key] = `${msg.ref}\n${msg.text ?? ''}`; });
  focusBox = true;
  redraw();
}

export const area: PageArea = {
  receive: { 'talk-done': done, 'conversation-quote': quoted },
};
