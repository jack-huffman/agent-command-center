// Messaging an agent, laid out as Claude Code's chat (T-160). The plan's conversation (talk.ts) and an agent's
// page (agent-page.ts) share these parts. The chat scrolls in its own box under the page's head. Each exchange
// is the person's message, in a box that sticks to the top of the chat while its reply scrolls under it, then
// the reply across the full width, its steps on a thin line with a dot each, each step one line until it's
// opened. Under the chat, out of its way: a status line while the agent works, then the message box as a card,
// its row of controls and Send inside it.

import { button, type Child, el, icon } from './dom.ts';

/** Send's reason while the box is empty. */
export const SEND_EMPTY = 'Type a message first';

/** The chat itself: what scrolls. It takes focus, so a keyboard scrolls it too. */
export function chatLog(label: string, ...children: Child[]): HTMLElement {
  const log = el('div', 'chat-log', ...children);
  log.tabIndex = 0;
  log.setAttribute('role', 'region');
  log.setAttribute('aria-label', label);
  return log;
}

/**
 * One exchange: the person's message, if there is one, then what came back. Its message sticks to the top of the
 * chat only while the exchange is in view, so the next one the person sent takes its place as it scrolls up.
 */
export function chatExchange(you: HTMLElement | null, ...reply: Child[]): HTMLElement {
  return el('div', `chat-exchange${you ? '' : ' chat-no-you'}`, you, ...reply);
}

/**
 * The person's message: a box with no heading, what it's about as a chip over the words. The pin around it is
 * the page's own colour, so the reply scrolling under it never shows through.
 */
export function chatYou(label: string, chip: Child, ...body: Child[]): HTMLElement {
  const box = el('div', 'chat-you', chip ? el('div', 'chat-chips', chip) : null, ...body);
  const pin = el('div', 'chat-pin', box);
  pin.setAttribute('role', 'group');
  pin.setAttribute('aria-label', label);
  return pin;
}

/** What came back: the full width, with no box, bar or background. */
export function chatReply(cls: string, ...body: Child[]): HTMLElement {
  return el('div', `chat-reply ${cls}`.trim(), ...body);
}

/** A reply's steps: a thin line at the left, a dot on it for each. */
export function chatSteps(...steps: HTMLElement[]): HTMLElement {
  return el('ol', 'chat-steps', ...steps.map((s) => (s.tagName === 'LI' ? s : el('li', 'chat-step', s))));
}

/** The dot's tone: a running step is blue, a failed one orange, the rest the line's own. */
export type StepTone = 'done' | 'running' | 'failed';

/** One step on the line, with its dot. */
export function chatStep(tone: StepTone, cls: string, ...body: Child[]): HTMLElement {
  return el('li', `chat-step dot-${tone} ${cls}`.trim(), ...body);
}

/** The line under the chat while the agent works, or says why it stopped: an icon and its words. */
export function chatStatus(iconName: string, tone: string | undefined, cls: string, ...words: Child[]): HTMLElement {
  const s = el('div', `chat-status ${cls}`.trim(), icon(iconName, tone), el('span', 'chat-status-words', ...words));
  s.setAttribute('role', 'status');
  return s;
}

/** Under the chat: the status line, the message card, and what goes with them. It never covers the chat. */
export function chatFoot(...children: Child[]): HTMLElement {
  return el('div', 'chat-foot', ...children);
}

/**
 * The message box as a card: what the message is about over the words, then one row of small controls, the
 * page's own on the left and Send on the right, inside the card.
 */
export function chatCard(o: { about?: Child; box: HTMLTextAreaElement; left?: Child[]; send: HTMLButtonElement; after?: Child[] }): HTMLElement {
  o.box.classList.add('chat-input');
  return el('div', 'chat-card', o.about ?? null, o.box, el('div', 'chat-card-row', ...(o.left ?? []), el('span', 'spacer'), o.send), ...(o.after ?? []));
}

/**
 * Send: a small filled square with an arrow, off with its reason until the box has words, and off with `why`
 * while a message can't go. Ctrl or Cmd with Enter in the box sends; Enter alone starts a new line.
 */
export function sendButton(box: HTMLTextAreaElement, o: { why: string | null; busy?: boolean; primary?: boolean; go: () => void }): HTMLButtonElement {
  const b = button('', o.busy ? 'loading~spin' : 'arrow-up', () => { if (!b.disabled) o.go(); }, `${o.primary === false ? '' : 'primary '}icon-only chat-send`);
  b.setAttribute('aria-label', o.busy ? 'Sending…' : 'Send');
  const set = (): void => {
    b.disabled = !box.value.trim() || !!o.why;
    b.title = o.why ?? (b.disabled ? SEND_EMPTY : '');
    if (b.disabled) b.setAttribute('aria-description', b.title); else b.removeAttribute('aria-description');
  };
  set();
  box.addEventListener('input', set);
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!b.disabled) o.go(); } });
  return b;
}
