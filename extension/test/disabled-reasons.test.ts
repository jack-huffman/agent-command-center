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
  const make = page.document.createElement.bind(page.document);
  page.document.createElement = (tag: string): PageElement => { const e = make(tag); if (tag === 'option') Object.defineProperty(e, 'textContent', { value: '', writable: true }); return e; };
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
  rulePending.settle(ruleKey(rule), null);
});
