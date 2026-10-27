// The reasons a disabled button gives (T-121): each is set while the button is off and cleared once it is on.
// Drawn under Node in the page's small document (test/page-dom.ts); the look itself is the screenshot run's disabled check.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QuestionCard } from '../src/model/questions.ts';
import type { RuleCard } from '../src/model/rules.ts';
import { type PageElement, pageDom } from './page-dom.ts';

const page = pageDom();
let kept: unknown;
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { page.sent.push(m); }, getState: () => kept, setState: (s: unknown) => { kept = s; } });
(globalThis as Record<string, unknown>).HTMLTextAreaElement = class {};
(globalThis as Record<string, unknown>).HTMLButtonElement = class {};
const { sampleTicket } = await import('../scripts/fixtures/task-page.ts');
const { analysisQuestion } = await import('../webview/analysis.ts');
const { planDecisions, planPending, chooseKey } = await import('../webview/plan.ts');
const { questionCard } = await import('../webview/questions.ts');
const { ruleDetail, pending: rulePending } = await import('../webview/rules.ts');
const { ruleKey } = await import('../webview/pending.ts');

const buttons = (e: PageElement, label: string): PageElement[] => e.all().filter((x) => x.tagName === 'BUTTON' && x.textContent === label);
const type = (b: PageElement, text: string): void => { (b as unknown as { value: string }).value = text; for (const f of b.listeners.get('input') ?? []) f({}); };
const NOW = Date.parse('2026-05-01T12:00:00Z');

test('Answer says to type an answer while the box is empty, and says nothing once there is one (edge case: a box cleared again)', () => {
  kept = undefined;
  const m = sampleTicket(NOW, 'ACME-21');
  const q = m.analysis!.open.find((x) => x.id !== 'q3')!;
  const card = analysisQuestion(m.project, 'ACME-21', { ...q, client: undefined }) as unknown as PageElement;
  const answer = buttons(card, 'Answer')[0]!;
  const input = card.all('text-input')[0]!;
  assert.deepEqual([answer.disabled, answer.title], [true, 'Type an answer first']);
  type(input, 'Yes');
  assert.deepEqual([answer.disabled, answer.title], [false, '']);
  type(input, '  ');
  assert.deepEqual([answer.disabled, answer.title], [true, 'Type an answer first'], 'cleared again, the reason comes back');
});

test('Choose gives its reason: type your own option first, then wait while a choice is on its way (edge case: a choice already on its way)', () => {
  kept = undefined;
  const m = sampleTicket(NOW, 'ACME-21');
  const p = m.analysis!.planState!;
  buttons((planDecisions(m, 'ACME-21', p) as unknown as PageElement).all('plan-decision')[1]!, 'Something else…')[0]!.click();
  const open = (planDecisions(m, 'ACME-21', p) as unknown as PageElement).all('plan-decision')[1]!;
  const choose = buttons(open, 'Choose')[0]!;
  const input = open.all('text-input')[0]!;
  assert.deepEqual([choose.disabled, choose.title], [true, 'Type your own option first']);
  type(input, 'Backfill only open opportunities');
  assert.deepEqual([choose.disabled, choose.title], [false, '']);
  // A choice goes out from elsewhere while the box is open: typing more keeps Choose off, with that reason.
  const key = chooseKey(m.project, 'ACME-21', 'd2');
  assert.ok(planPending.start(key, 'choose'));
  type(input, 'Backfill only open opportunities, newest first');
  assert.deepEqual([choose.disabled, choose.title], [true, 'Wait for the choice on its way']);
  planPending.settle(key, null);
  type(input, 'Backfill');
  assert.deepEqual([choose.disabled, choose.title], [false, ''], 'once it is recorded, Choose is on again');
});

const question = (): QuestionCard => ({
  id: 'q-1', kind: 'question', who: 'ACME-1', task: 'ACME-1', project: '/r', projectName: 'r', session: 's', sessionId: 's', askedAt: 0, icon: 'comment-discussion', title: 'has a question for you', code: null, detail: null, always: null, choices: [],
  questions: [{ question: 'Which one?', header: 'Pick', multiSelect: false, options: [{ label: 'A', description: '' }, { label: 'B', description: '' }] }],
});

test('Send answers says to answer every question while one is open, and clears once each has an answer (edge case: the state before the first answer)', () => {
  kept = undefined;
  const card = questionCard(question(), { watch: false }) as unknown as PageElement;
  const send = card.all('q-send')[0]!;
  assert.deepEqual([send.disabled, send.title], [true, 'Answer every question first']);
  const own = card.all('text-input')[0]!;
  type(own, 'Neither');
  assert.deepEqual([send.disabled, send.title], [false, '']);
  type(own, '');
  assert.deepEqual([send.disabled, send.title], [true, 'Answer every question first'], 'cleared again, the reason comes back');
  // A pick kept from before starts On, with no reason.
  kept = { answers: { 'q-1': { picks: { 0: ['A'] }, other: {}, denying: false, reason: '', sent: false } } };
  const picked = (questionCard(question(), { watch: false }) as unknown as PageElement).all('q-send')[0]!;
  assert.deepEqual([picked.disabled, picked.title], [false, '']);
});

const rule = { project: '/r', id: 'r-1', kind: 'rule', by: 'rule', head: 'H', line: 'A line.', title: 'A title', check: 'none', written: null, again: null, findings: 1, tasks: 1, must: 0, sources: [] } as unknown as RuleCard;

test('a rule\'s Confirm says to give a title and a line while one is empty, and says it is being sent while it is (edge case: a send on its way)', () => {
  kept = { opened: [`${ruleKey(rule)}:draft`] };
  // The page's small document has no settable textContent, which the check's <option>s set.
  const had = Object.hasOwn(page.document, 'createElement');
  const original = page.document.createElement;
  const make = original.bind(page.document);
  page.document.createElement = (tag: string): PageElement => { const e = make(tag); if (tag === 'option') Object.defineProperty(e, 'textContent', { value: '', writable: true }); return e; };
  try {
    const draw = (): PageElement => ruleDetail(rule) as unknown as PageElement;
    const fresh = draw();
    const confirm = buttons(fresh, 'Confirm')[0]!;
    assert.deepEqual([confirm.disabled, confirm.title], [false, '']);
    const title = fresh.all().find((x) => x.getAttribute('id') === `rule-${rule.id}-title`) ?? fresh.all().find((x) => (x as unknown as { id: string }).id === `rule-${rule.id}-title`)!;
    type(title, '');
    assert.deepEqual([confirm.disabled, confirm.title], [true, 'Give the rule a title and a line first']);
    type(title, 'Back again');
    assert.deepEqual([confirm.disabled, confirm.title], [false, '']);
    assert.ok(rulePending.start(ruleKey(rule), 'accept'));
    const sending = buttons(draw(), 'Confirm')[0]!;
    assert.deepEqual([sending.disabled, sending.title], [true, 'Wait for it to be sent']);
  } finally {
    rulePending.settle(ruleKey(rule), null);
    if (had) page.document.createElement = original; else delete (page.document as Partial<typeof page.document>).createElement;
  }
});

// ---------------------------------------------------------------- the conversation's Send, the agent reply's Send, Comment (T-121)

const { sampleTalkTicket } = await import('../scripts/fixtures/talk.ts');
const { sampleAgent } = await import('../scripts/fixtures/agent-page.ts');
const { renderConversation } = await import('../webview/talk.ts');
const { renderAgent } = await import('../webview/agent-page.ts');
const { renderTicket } = await import('../webview/task-page.ts');
const { onDone: updatesDone, COMMENT_EMPTY } = await import('../webview/updates.ts');
const { state } = await import('../webview/state.ts');
const { judgeDisabled, REASON_BESIDE, DISABLED_LOOK } = await import('../scripts/geometry.ts');

const under = (nodes: unknown[]): PageElement => { const box = page.document.createElement('div'); box.append(...(nodes as PageElement[])); return box; };
const sendState = (b: PageElement): [boolean, string] => [b.disabled, b.title];

test('the conversation Send says to type a message first while the box is empty, clears once there is one, and comes back when it is emptied (edge case: a box cleared again)', () => {
  kept = { opened: [], drafts: {} };
  const m = sampleTalkTicket(NOW);
  const s = renderConversation(m.project, { ...m.talk!, running: false, send: { disabled: null } }) as unknown as PageElement;
  const send = buttons(s, 'Send')[0]!;
  const box = s.all('talk-box')[0]!;
  assert.deepEqual(sendState(send), [true, 'Type a message first']);
  type(box, 'Why that order?');
  assert.deepEqual(sendState(send), [false, '']);
  type(box, '   ');
  assert.deepEqual(sendState(send), [true, 'Type a message first'], 'emptied again, the reason comes back');
});

test('the conversation Send keeps the reason it was given while typing, and does not swap it for the empty-box one (edge case: a message already on its way)', () => {
  kept = { opened: [], drafts: {} };
  const m = sampleTalkTicket(NOW);
  const s = renderConversation(m.project, { ...m.talk!, running: false, send: { disabled: 'Wait for the planning agent to reply' } }) as unknown as PageElement;
  const send = buttons(s, 'Send')[0]!;
  const box = s.all('talk-box')[0]!;
  assert.deepEqual(sendState(send), [true, 'Wait for the planning agent to reply']);
  type(box, 'A message');
  assert.deepEqual(sendState(send), [true, 'Wait for the planning agent to reply'], 'typing keeps the reason');
  type(box, '');
  assert.deepEqual(sendState(send), [true, 'Wait for the planning agent to reply'], 'so does emptying the box');
});

test('the agent reply Send gives its hint as the reason when it cannot reply, and none when it can (edge case: an agent that is still answering)', () => {
  kept = undefined;
  const agent = sampleAgent(NOW);
  const draw = (reply: { can: boolean; hint: string }): PageElement => under(renderAgent({ ...agent, reply }));
  const off = buttons(draw({ can: false, hint: 'It\'s answering. You can write again when it stops.' }), 'Send')[0]!;
  assert.deepEqual(sendState(off), [true, 'It\'s answering. You can write again when it stops.']);
  const on = buttons(draw({ can: true, hint: 'Sent to its own session.' }), 'Send')[0]!;
  assert.deepEqual(sendState(on), [false, '']);
});

test('Comment says it is posting once pressed, and its reset says to write a comment when the box is empty or nothing when it has words (edge case: a post that failed)', () => {
  kept = { opened: [], drafts: {} };
  (globalThis as Record<string, unknown>).navigator ??= { platform: 'test' };
  const m = sampleTicket(NOW, 'ACME-21');
  const drawn = under(renderTicket({ ...m, can: { ...m.can, comment: true } }));
  const composer = drawn.all('composer')[0]!;
  const box = composer.all('comment-box')[0]!;
  const send = buttons(composer, 'Comment')[0]!;
  assert.deepEqual(sendState(send), [true, COMMENT_EMPTY]);
  type(box, 'Looks right');
  assert.deepEqual(sendState(send), [false, '']);
  send.click();
  assert.deepEqual(sendState(send), [true, 'Your comment is posting']);
  // The page's small document has no selector search: hand the reset the composer it would find.
  const doc = page.document as unknown as Record<string, unknown>;
  const had = Object.hasOwn(doc, 'querySelector');
  const search = doc.querySelector;
  const last = state.last;
  doc.querySelector = (sel: string) => (sel === '.composer .comment-box' ? box : sel === '.composer .btn.primary' ? send : null);
  try {
    // A refusal keeps the words, so Comment is on again with no reason.
    updatesDone({ action: 'comment', ok: false, error: 'No access' });
    assert.deepEqual(sendState(send), [false, '']);
    // A post that went clears the box, so Comment is off again, saying to write one.
    state.last = { ...m, kind: 'ticket' } as unknown as typeof state.last;
    updatesDone({ action: 'comment', ok: true });
    assert.deepEqual(sendState(send), [true, COMMENT_EMPTY]);
  } finally {
    state.last = last;
    if (had) doc.querySelector = search; else delete doc.querySelector;
  }
});

test('a disabled button named in the list of reasons beside its text passes without a title, and one not named still fails (edge case: a button that gives its reason in the text beside it)', () => {
  const drawn = (text: string) => [{ what: 'page', text, opacity: 0.45, cursor: DISABLED_LOOK.cursor, why: false }];
  assert.equal(judgeDisabled(drawn('Made-up button')).length, 1, 'no title and not named');
  REASON_BESIDE['Made-up button'] = 'its reason is in the line beside it';
  try {
    assert.deepEqual(judgeDisabled(drawn('Made-up button')), [], 'named, so it passes');
    assert.equal(judgeDisabled(drawn('Another button')).length, 1, 'a different button is still judged');
  } finally { delete REASON_BESIDE['Made-up button']; }
});
