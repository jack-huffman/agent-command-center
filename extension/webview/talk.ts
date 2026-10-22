// A plan's conversation with its planning agent (T-98, T-111). It is drawn in its own panel, beside the task's
// page: each turn with who and when, what a message is about quoted, each change a reply proposes with Use
// this, and what a Claude Code session recorded; before there is a plan, its question first, the agent's
// questions, and Draft the plan or Skip to the plan. The task's page shows one line of it, with Open
// conversation; Discuss on any part of the plan opens the panel with that part quoted. Each button asks the
// extension, and shows it's on its way until the extension says how it went.

import type { TicketProposal, TicketTalk, TicketTurn } from '../src/model/talk.ts';
import { actionButton, button, el, icon, md, status, when, work } from './dom.ts';
import { Pending } from './pending.ts';
import { api, memory, type PageArea, remember, state } from './state.ts';

/** The longest message a page sends, as acc takes it. */
const TALK_MAX = 4000;

/** Messages, Use this and Open in Claude Code on their way to acc, and why the last one didn't go. */
export const talkPending = new Pending<'send' | 'use' | 'claude'>();
const base = (project: string, task: string): string => `talk:${project}#${task.toUpperCase()}`;
export const sendKey = (project: string, task: string): string => `${base(project, task)}:send`;
export const useKey = (project: string, task: string, turn: string, proposal: string): string => `${base(project, task)}:${turn}.${proposal}`;
const claudeKey = (project: string, task: string): string => `${base(project, task)}:claude`;
/** The remembered key holding what the next message is about: its reference, a line, then its words. */
const aboutKey = (project: string, task: string): string => `${base(project, task)}:about`;
/** The remembered key of a Use this that waits for the person's yes, on an approved plan. */
const confirmKey = (key: string): string => `${key}:confirm`;

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

/** One change a reply proposes: what it would record and why, then Use this, or who used it. */
function proposal(project: string, s: TicketTalk, t: TicketTurn, p: TicketProposal): HTMLElement {
  const key = useKey(project, s.task, t.id, p.id);
  const box = el('div', `talk-proposal${p.used ? ' used' : ''}`,
    el('div', 'tp-line', icon(p.used ? 'pass-filled' : 'lightbulb'), el('span', 'tp-words', el('strong', '', 'Proposes: '), md(p.words)), p.from ? el('span', 'chip talk-v', `from v${p.from}`) : null),
    p.why ? el('div', 'muted small tp-why', md(p.why)) : null);
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', `Proposal: ${p.words}${p.used ? ', used' : ''}`);
  if (p.used) {
    box.append(el('div', 'tp-used small', status({ label: 'Used', icon: 'pass-filled', tone: 'blue' }), el('span', 'muted', `by ${p.used.by} `), when(p.used.at)));
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
    box.append(el('div', 'tp-actions', b, again, p.use.disabled ? el('span', 'muted small', p.use.disabled) : null));
    if (memory().opened.includes(confirmKey(key)) && p.ask && !busy) box.append(confirmUse(project, s, t, p, key));
  }
  const error = talkPending.error(key);
  if (error) box.append(el('div', 'aq-error', icon('warning'), el('span', '', `It wasn't recorded: ${error}`)));
  return box;
}

/** The agent's answer before the plan (T-111): what it's unsure of, and its questions, numbered. */
function opening(t: TicketTurn): HTMLElement[] {
  return [
    t.unsure.length ? el('div', 'talk-unsure', el('div', 'strong small', 'Not sure yet'), work(el('ul', 'an-list', ...t.unsure.map((u) => el('li', '', md(u)))), 'agent-text')) : null,
    t.asks.length ? el('div', 'talk-asks', el('div', 'strong small', t.asks.length === 1 ? 'A question for you' : 'Questions for you'), work(el('ol', 'an-list', ...t.asks.map((q) => el('li', '', md(q)))), 'agent-text')) : null,
  ].filter((x): x is HTMLElement => !!x);
}

/** One turn: who and when, what it's about, the words, and what it proposed, asked or recorded. */
function turn(project: string, s: TicketTalk, t: TicketTurn): HTMLElement {
  const li = el('li', `talk-turn who-${t.who}`,
    el('div', 'talk-who', icon(t.icon), el('strong', '', t.name), t.by && t.who !== 'you' ? el('span', 'muted', `opened by ${t.by}`) : null, when(t.at), el('span', 'chip talk-v', t.before ? 'Before the plan' : `v${t.version}`),
      t.open ? status({ label: 'Open now', icon: 'circle-filled', tone: 'blue' }) : null),
    t.about ? quote(t.about.kind, t.about.ref, t.about.text) : null,
    t.who === 'agent' ? work(el('div', 'talk-text', md(t.text)), 'agent-text') : el('div', 'talk-text', md(t.text)));
  li.setAttribute('aria-label', `${t.name}${t.by && t.who === 'you' ? ` (${t.by})` : ''}`);
  if (t.failed) li.append(el('div', 'aq-error', icon('warning'), el('span', '', `No reply: ${t.failed}`)));
  if (t.who === 'agent') li.append(...opening(t));
  if (t.proposals.length) li.append(el('div', 'talk-proposals', ...t.proposals.map((p) => proposal(project, s, t, p))));
  if (t.who === 'claude-code') {
    li.append(t.recorded.length
      ? el('div', 'talk-recorded', el('div', 'strong small', 'It recorded'), el('ul', 'an-list', ...t.recorded.map((r) => el('li', '', md(r)))))
      : el('div', 'muted small', t.open ? 'Nothing recorded yet.' : 'It recorded nothing.'));
  } else if (t.who === 'plan' && t.recorded.length) {
    li.append(el('div', 'talk-recorded', el('div', 'strong small', 'What changed'), el('ul', 'an-list', ...t.recorded.map((r) => el('li', '', md(r))))));
  }
  return li;
}

/** The message box: what it's about, with a way to take that off, the words, and Send. */
function composer(project: string, s: TicketTalk): HTMLElement {
  const key = sendKey(project, s.task);
  const about = aboutOf(project, s.task);
  const busy = !!talkPending.what(key);
  const draft = memory().drafts[key] ?? '';
  const box = document.createElement('textarea');
  box.className = 'text-input talk-box';
  box.rows = 3;
  box.maxLength = TALK_MAX;
  box.value = draft;
  box.dataset.keep = key;
  box.placeholder = s.stage === 'opening' ? 'What you want to do, and what you\'re thinking' : 'Ask why, push back, or suggest another way';
  box.setAttribute('aria-label', 'Your message to the planning agent');
  const why = s.send?.disabled ?? (busy ? 'Wait for your message to go' : null);
  const go = () => {
    const text = box.value.trim();
    if (!text || why || !talkPending.start(key, 'send')) return;
    api.postMessage({ type: 'talk-send', project, task: s.task, text, ...(about ? { about: about.ref } : {}) });
    redraw();
  };
  const send = button(busy ? 'Sending…' : 'Send', busy ? 'loading~spin' : 'send', go, s.draft?.disabled === null ? '' : 'primary');
  send.disabled = !draft.trim() || !!why;
  if (why) { send.title = why; send.setAttribute('aria-description', why); }
  box.addEventListener('input', () => { remember((x) => { x.drafts[key] = box.value; }); send.disabled = !box.value.trim() || !!why; });
  // Ctrl or Cmd with Enter sends; Enter alone starts a new line.
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } });
  if (focusBox) { focusBox = false; queueMicrotask(() => box.focus()); }
  const off = about ? button('', 'close', () => { remember((x) => { delete x.drafts[aboutKey(project, s.task)]; }); redraw(); }, 'ghost small icon-only') : null;
  if (off) { off.setAttribute('aria-label', 'Not about this any more'); off.title = 'Not about this any more'; }
  const error = talkPending.error(key);
  return el('div', 'talk-compose',
    about ? el('div', 'talk-about', el('span', 'muted small', 'About'), quote(kindOf(about.ref), about.ref, about.text), off) : null,
    box,
    error ? el('div', 'aq-error', icon('warning'), el('span', '', `Your message didn't go: ${error}`)) : null,
    el('div', 'actions talk-actions', send, why && s.send?.disabled ? el('span', 'muted small', why) : null));
}

/** Draft the plan and Skip to the plan (T-111), before there is one: each off with why while it can't go. */
function planButtons(project: string, s: TicketTalk): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (s.draft) {
    const b = button('Draft the plan', 'lightbulb', () => api.postMessage({ type: 'conversation-draft', project, task: s.task }), s.draft.disabled ? '' : 'primary');
    b.disabled = !!s.draft.disabled;
    b.title = s.draft.disabled ?? 'The planning agent investigates and drafts the plan, from the ticket and this conversation';
    if (s.draft.disabled) b.setAttribute('aria-description', s.draft.disabled);
    out.push(b);
  }
  if (s.skip) {
    const b = button('Skip to the plan', 'debug-step-over', () => api.postMessage({ type: 'conversation-draft', project, task: s.task, skip: true }));
    b.disabled = !!s.skip.disabled;
    b.title = s.skip.disabled ?? 'Make the plan from the ticket alone, without this conversation';
    if (s.skip.disabled) b.setAttribute('aria-description', s.skip.disabled);
    out.push(b);
  }
  return out;
}

/**
 * The conversation, in its panel (T-111): what it does, or before the plan its question; each turn; the agent
 * working, or the plan being made; the message box; then Draft the plan and Skip to the plan, or Make a new
 * plan and Open in Claude Code.
 */
export function renderConversation(project: string, s: TicketTalk): HTMLElement {
  const sec = el('section', `talk tone-edge-${s.look.tone}`);
  sec.id = 'talk';
  sec.setAttribute('aria-label', `${s.stage === 'opening' ? 'Before the plan' : 'Talk it through'}: ${s.look.label}`);
  if (s.ask) sec.append(el('h2', 'talk-ask', icon('comment-discussion'), el('span', '', s.ask)));
  sec.append(el('p', 'muted an-note', s.note));
  if (s.turns.length) sec.append(el('ol', 'talk-turns', ...s.turns.map((t) => turn(project, s, t))));
  if (s.running) sec.append(el('div', 'talk-waiting muted', icon('sync~spin'), s.stage === 'opening' ? 'The planning agent is reading the ticket to reply. Its steps show in the output panel.' : 'The planning agent is reading the code to reply. Its steps show in the output panel.'));
  if (s.making) sec.append(el('div', 'talk-waiting muted', icon('sync~spin'), s.making.words));
  if (s.send) sec.append(composer(project, s));
  const ck = claudeKey(project, s.task);
  const buttons: HTMLElement[] = planButtons(project, s);
  if (s.newPlan) buttons.push(actionButton(s.newPlan));
  if (s.claude) {
    const busy = !!talkPending.what(ck);
    const b = button(busy ? 'Opening…' : 'Open in Claude Code', busy ? 'loading~spin' : 'terminal', () => {
      if (!talkPending.start(ck, 'claude')) return;
      api.postMessage({ type: 'talk-claude', project, task: s.task });
      redraw();
    });
    const why = s.claude.disabled ?? (busy ? 'Wait for it to open' : null);
    b.disabled = !!why;
    b.title = why ?? 'A longer session in Claude Code, in plan mode: it reads, and records to the plan only what you agree to';
    if (why) b.setAttribute('aria-description', why);
    buttons.push(b);
  }
  if (buttons.length) sec.append(el('div', 'actions an-actions talk-more', ...buttons));
  const why = s.draft?.disabled && !s.making && !s.running ? s.draft.disabled : null;
  if (why) sec.append(el('div', 'plan-why muted small', icon('info'), el('span', '', `Draft the plan is off: ${why}`)));
  const error = talkPending.error(ck);
  if (error) sec.append(el('div', 'aq-error', icon('warning'), el('span', '', `Claude Code didn't open: ${error}`)));
  return sec;
}

/** How Send, Use this or Open in Claude Code went: done clears what was sent; a refusal shows why. */
function done(msg: { action?: string; project?: string; task?: string; turn?: string; proposal?: string; ok?: boolean; error?: string }): void {
  const project = msg.project ?? '';
  const task = msg.task ?? '';
  const key = msg.action === 'talk-send' ? sendKey(project, task) : msg.action === 'talk-use' ? useKey(project, task, msg.turn ?? '', msg.proposal ?? '') : claudeKey(project, task);
  if (!talkPending.what(key)) return;
  talkPending.settle(key, msg.ok ? null : msg.error?.trim() || 'It didn\'t go, and the Command Center didn\'t say why.');
  // A message that went clears its words and what it was about.
  if (msg.ok && msg.action === 'talk-send') remember((x) => { delete x.drafts[key]; delete x.drafts[aboutKey(project, task)]; });
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
