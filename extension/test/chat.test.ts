// Messaging an agent as Claude Code's chat (T-160): the shared parts in chat.ts, and both pages that message an
// agent, the plan's conversation and an agent's own page, drawn with them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { sampleAgent, sampleAgentChat } from '../scripts/fixtures/agent-page.ts';
import { sampleConversationLong } from '../scripts/fixtures/conversation.ts';
import { type PageElement, pageDom } from './page-dom.ts';

const page = pageDom();
const { chatCard, chatExchange, chatFoot, chatLog, chatReply, chatStatus, chatStep, chatSteps, chatYou, SEND_EMPTY, sendButton } = await import('../webview/chat.ts');
const { renderConversation } = await import('../webview/talk.ts');
const { renderAgent } = await import('../webview/agent-page.ts');

const NOW = Date.parse('2026-10-30T12:00:00Z');
const E = (x: unknown): PageElement => x as PageElement;
const box = (): HTMLTextAreaElement => Object.assign(page.document.createElement('textarea'), { value: '' }) as unknown as HTMLTextAreaElement;
const type = (b: HTMLTextAreaElement, text: string): void => { b.value = text; for (const f of E(b).listeners.get('input') ?? []) f({}); };
const press = (b: HTMLTextAreaElement, mods: { metaKey?: boolean; ctrlKey?: boolean }): void => { for (const f of E(b).listeners.get('keydown') ?? []) f({ key: 'Enter', ...mods, preventDefault: () => undefined }); };
const under = (nodes: unknown[]): PageElement => { const b = page.document.createElement('div'); b.append(...(nodes as PageElement[])); return b; };

test('the person\'s message is a box with no heading, its chip over its words, in a pin that sticks while its exchange is in view', () => {
  const you = E(chatYou('You (jordan)', 'About d1.a', 'Why that order?'));
  assert.ok(you.classList.contains('chat-pin'));
  assert.equal(you.getAttribute('aria-label'), 'You (jordan)', 'named for a screen reader, not on screen');
  const inner = you.all('chat-you')[0]!;
  assert.equal(inner.all('chat-chips')[0]!.textContent, 'About d1.a', 'the chip first');
  assert.equal(inner.textContent, 'About d1.aWhy that order?', 'no heading: only the chip and the words');
  assert.equal(E(chatYou('You', null, 'Hi')).all('chat-chips').length, 0, 'edge case: no chip, no row for it');
  const x = E(chatExchange(chatYou('You', null, 'Hi'), chatReply('', 'Hello')));
  assert.ok(x.classList.contains('chat-exchange') && !x.classList.contains('chat-no-you'));
  assert.ok(E(chatExchange(null, 'before any message')).classList.contains('chat-no-you'), 'edge case: what came before the first message');
  const css = readFileSync(join(import.meta.dirname, '../webview/chat.css'), 'utf8');
  assert.match(css, /\.chat-pin \{ position: sticky; top: 0;[^}]*background: var\(--vscode-editor-background\)/, 'it sticks, and hides what scrolls under it');
  assert.match(css, /\.chat-you \{[^}]*border: 1px solid[^}]*border-radius[^}]*background:/, 'rounded, bordered, a step from the page');
});

test('a reply runs the full width with no box; its steps hang on a line with a dot each, toned by how it went', () => {
  const r = E(chatReply('entry say', 'Done.'));
  assert.equal(r.className, 'chat-reply entry say');
  const steps = E(chatSteps(E(chatStep('running', 'entry tool', 'Run the tests')) as unknown as HTMLElement, page.document.createElement('div') as unknown as HTMLElement));
  assert.equal(steps.tagName, 'OL');
  assert.deepEqual(steps.children.map((c) => (c as PageElement).className), ['chat-step dot-running entry tool', 'chat-step'], 'a step as given, and anything else wrapped as one');
  assert.equal(E(chatStep('failed', '')).className, 'chat-step dot-failed', 'edge case: no class of its own');
  const css = readFileSync(join(import.meta.dirname, '../webview/chat.css'), 'utf8');
  assert.match(css, /\.chat-reply \{(?![^}]*(border|background))[^}]*\}/, 'no box, bar or background');
  assert.match(css, /\.chat-steps \{[^}]*border-left: 1px solid/, 'the thin line');
  assert.match(css, /\.chat-step::before \{[^}]*border-radius: 50%/, 'a dot for each step');
});

test('the status line says what the agent is doing; the foot holds it over the card, with space under it', () => {
  const s = E(chatStatus('sync~spin', 'blue', 'talk-waiting', 'Working…'));
  assert.equal(s.getAttribute('role'), 'status');
  assert.ok(s.classList.contains('chat-status') && s.classList.contains('talk-waiting'));
  assert.equal(s.textContent, 'Working…');
  assert.equal(E(chatStatus('circle-slash', undefined, '', 'Ended')).className, 'chat-status', 'edge case: no class of its own');
  const foot = E(chatFoot(s as unknown as HTMLElement, null));
  assert.equal(foot.children.length, 1, 'nothing for a part that is missing');
  const css = readFileSync(join(import.meta.dirname, '../webview/chat.css'), 'utf8');
  assert.match(css, /\.chat-foot \{[^}]*padding: \d+px 0 1\dpx/, 'space between the card and the bottom of the window');
  const log = E(chatLog('The conversation', 'x'));
  assert.deepEqual([log.getAttribute('role'), log.getAttribute('aria-label'), log.tabIndex], ['region', 'The conversation', 0], 'the chat scrolls by keyboard too');
});

test('Send sits in the card\'s row, off with its reason until there are words, and Ctrl or Cmd with Enter sends (edge cases: words taken away again, a reason of its own while typing, Enter alone)', () => {
  const b = box();
  const sent: string[] = [];
  const send = sendButton(b, { why: null, go: () => sent.push(b.value) });
  assert.deepEqual([send.disabled, send.title, send.getAttribute('aria-label')], [true, SEND_EMPTY, 'Send']);
  assert.equal(send.getAttribute('aria-description'), SEND_EMPTY, 'the reason, for a screen reader');
  type(b, 'Why?');
  assert.deepEqual([send.disabled, send.title, send.getAttribute('aria-description')], [false, '', null]);
  press(b, {});
  assert.deepEqual(sent, [], 'Enter alone starts a new line');
  press(b, { ctrlKey: true });
  press(b, { metaKey: true });
  E(send).click();
  assert.deepEqual(sent, ['Why?', 'Why?', 'Why?']);
  type(b, '  ');
  assert.deepEqual([send.disabled, send.title], [true, SEND_EMPTY], 'emptied again, the reason comes back');
  press(b, { ctrlKey: true });
  assert.equal(sent.length, 3, 'and nothing goes');
  const held = box();
  const off = sendButton(held, { why: 'Wait for it to reply', busy: true, primary: false, go: () => sent.push('no') });
  type(held, 'More');
  assert.deepEqual([off.disabled, off.title, off.getAttribute('aria-label')], [true, 'Wait for it to reply', 'Sending…'], 'its own reason holds while typing');
  assert.ok(!E(off).classList.contains('primary'), 'outlined when asked');
  const card = E(chatCard({ about: 'About s2', box: b, left: [page.document.createElement('button') as unknown as HTMLElement], send, after: ['why'] }));
  const row = card.all('chat-card-row')[0]!;
  assert.deepEqual(row.children.map((c) => (c as PageElement).className), ['', 'spacer', E(send).className], 'the page\'s controls on the left, Send on the right');
  assert.ok(E(b).classList.contains('chat-input'), 'the words, inside the card');
  assert.equal(card.textContent.startsWith('About s2'), true, 'what it is about over the words');
});

test('the plan conversation is drawn with the shared parts: exchanges with the person\'s message pinned, its buttons and Send in the card, the status line over it', () => {
  const m = sampleConversationLong(NOW);
  const s = E(renderConversation(m.project, { ...m.talk!, running: true, send: { disabled: 'Wait for the planning agent to reply' } }));
  const log = s.all('chat-log')[0]!;
  assert.ok(log, 'the chat scrolls');
  const xs = log.all('chat-exchange');
  assert.ok(xs.length >= 1);
  assert.equal(xs[xs.length - 1]!.all('chat-pin').length, 1, 'the latest exchange starts with the person\'s message');
  assert.ok(xs[xs.length - 1]!.all('talk-turn').some((t) => t.classList.contains('who-agent') && t.classList.contains('chat-reply')), 'and the agent\'s reply under it, full width');
  const foot = s.all('chat-foot')[0]!;
  assert.match(foot.all('chat-status')[0]!.textContent, /reading the code to reply/, 'the status line while it works');
  const row = foot.all('chat-card-row')[0]!;
  assert.deepEqual(row.all().filter((x) => x.tagName === 'BUTTON').map((x) => x.textContent || x.getAttribute('aria-label')), ['Make a new plan', 'Open in Claude Code', 'Send'], 'the conversation\'s own actions in the card\'s row, then Send');
  assert.equal(log.all('chat-card').length, 0, 'the card is under the chat, not in it');
});

test('an agent\'s page is drawn with the same parts: the person\'s message pinned, what it said under it, its steps on the line, the status line and the card', () => {
  const p = under(renderAgent(sampleAgentChat(NOW)));
  const log = p.all('chat-log')[0]!;
  const xs = log.all('chat-exchange');
  assert.equal(xs.length, 2, 'the instructions, then the person\'s message');
  assert.match(xs[1]!.all('chat-pin')[0]!.textContent, /every query in CaseRouting/);
  assert.ok(xs[1]!.all('chat-reply').length >= 2, 'what it said after, full width');
  const steps = xs[1]!.all('chat-step');
  assert.ok(steps.length >= 3 && steps.every((x) => /dot-(done|running|failed)/.test(x.className)), 'each step a dot');
  assert.ok(steps.some((x) => x.classList.contains('dot-running')), 'the running one blue');
  assert.ok(log.all('agent-asks').length === 1 && xs[1]!.all('agent-asks').length === 1, 'its question under its latest reply');
  const foot = p.all('chat-foot')[0]!;
  assert.equal(foot.all('chat-card').length, 1);
  assert.equal(foot.all('chat-send').length, 1, 'Send inside the card');
  const before = under(renderAgent(sampleAgent(NOW))).all('chat-exchange');
  assert.equal(before.length, 1, 'edge case: before the person wrote, one exchange, the instructions');
  const working = under(renderAgent({ ...sampleAgent(NOW), questions: [], look: { label: 'Working', icon: 'sync~spin', tone: 'blue' }, live: true }));
  assert.equal(working.all('chat-foot')[0]!.all('chat-status')[0]!.textContent, 'Working…', 'the status line while it works');
  const ended = under(renderAgent({ ...sampleAgent(NOW), questions: [], live: false, look: { label: 'Ended', icon: 'circle-slash', tone: 'neutral' } }));
  assert.match(ended.all('chat-status')[0]!.textContent, /The session has ended/, 'edge case: an ended session says so where the status line is');
});
