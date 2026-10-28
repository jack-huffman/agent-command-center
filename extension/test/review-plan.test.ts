// Review plan (T-109): the short plan section and its counts, the steps in order with questions for you first,
// each kind of step's options with Recommended first, More about this option, Something else… and own words,
// Ask on the ticket, Back, Skip for now and the dots, the summary and Approve's off state, Discuss handing the
// item to Talk it through, and each confirm sending the message the whole plan already sends.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Analysis } from '../../packages/core/src/analyze.ts';
import type { TaskRow } from '../src/logic/shared.ts';
import { rowAnalysis } from '../src/logic/tasks.ts';
import { planReview, reviewSteps, stepDone } from '../src/model/review-plan.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { samplePlan, sampleAnalyses } from '../scripts/fixtures/analysis.ts';
import { sampleTicket } from '../scripts/fixtures/task-page.ts';
import { sampleTalkTicket } from '../scripts/fixtures/talk.ts';
import { type PageElement, pageDom } from './page-dom.ts';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const todo = (more: Partial<TaskRow> = {}): TaskRow => ({ id: 'ACME-21', title: 'T', state: 'todo', display: 'ready', environment: 'dev', deps: [], source: { kind: 'jira', url: null }, analysisRequired: true, ...more });
const review = (a: Analysis, state = 'todo') => planReview(todo({ state, analysis: rowAnalysis(a) }), a, [], a.version ?? 1, true);

test('the steps go questions for you first, then the choices, then the questions for the ticket\'s author, each with the recommended option first', () => {
  const a = sampleAnalyses(NOW)['ACME-21']!;
  const r = review(a)!;
  assert.deepEqual(r.steps.map((s) => [s.id, s.kind, s.done]), [['q1', 'question', false], ['q3', 'question', true], ['d1', 'choice', true], ['d2', 'choice', false], ['q2', 'question', false]]);
  assert.equal(r.title, 'Review plan v1');
  assert.equal(r.left, '1 choice and 2 questions to review');
  // A choice whose recommended option isn't its first still shows it first.
  const flipped = { ...a, decisions: a.decisions!.map((d) => (d.id === 'd2' ? { ...d, recommended: 'c' } : d)) };
  const d2 = reviewSteps(flipped, []).find((s) => s.id === 'd2')!;
  assert.ok(d2.kind === 'choice');
  assert.deepEqual(d2.options.map((o) => [o.id, o.recommended]), [['c', true], ['a', false], ['b', false]]);
  // A question for the author is done once it's asked on the ticket; one for you isn't.
  const q2 = reviewSteps(a, [{ id: 'q2', question: '', why: '', suggested: '', askOf: 'author', client: 'drafted' }, { id: 'q1', question: '', why: '', suggested: '', client: 'drafted' }]);
  assert.deepEqual(q2.map((s) => [s.id, s.done]), [['q1', false], ['q3', true], ['d1', true], ['d2', false], ['q2', true]]);
  assert.equal(stepDone({ kind: 'choice', id: 'd9', title: '', why: '', options: [], because: '', chosen: null }), false);
});

test('what\'s left reads in words: choices and questions to review, ready to approve, or approved', () => {
  const approved = samplePlan(NOW, 'approved');
  const done = { ...approved, questions: approved.questions.map((q) => ({ ...q, answer: q.answer ?? { text: 'Decision Maker', by: 'jordan', at: '' } })) };
  assert.equal(review(done)!.left, 'Approved v2');
  assert.equal(review({ ...done, approval: undefined })!.left, 'Ready to approve');
  assert.equal(review(approved)!.left, '1 question to review', 'the author\'s question is still to review');
  assert.equal(review(samplePlan(NOW, 'changed'))!.left, '1 choice and 1 question to review');
});

test('edge case: nothing to review with no plan, a plan that says to split, a build under way, or a plan with no choices or questions', () => {
  const a = sampleAnalyses(NOW)['ACME-21']!;
  assert.equal(planReview(todo(), null, [], 1, true), null);
  assert.equal(review({ ...a, verdict: 'split' }), null);
  assert.equal(review(a, 'running'), null);
  assert.equal(review({ ...a, questions: [], decisions: [] }), null);
  // The page's model carries it.
  assert.deepEqual(sampleTicket(NOW, 'ACME-21').analysis!.review!.steps.map((s) => s.id), ['q1', 'q3', 'd1', 'd2', 'q2']);
  assert.equal(sampleTicket(NOW, 'ACME-12').analysis?.review ?? null, null, 'past the build');
});

// ---------------------------------------------------------------- the page itself

const page = pageDom();
let kept: unknown;
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { page.sent.push(m); }, getState: () => kept, setState: (s: unknown) => { kept = s; } });
// The page's modal is a <dialog>: here one that opens and closes, as the browser's does.
const doc = page.document as unknown as { createElement(tag: string): PageElement; querySelector(s: string): PageElement | null; body: PageElement };
const made = doc.createElement.bind(doc);
doc.createElement = (tag: string) => {
  const e = made(tag) as PageElement & { open?: boolean; showModal?: () => void; close?: () => void };
  if (tag === 'dialog') { e.open = false; e.showModal = () => { e.open = true; }; e.close = () => { e.open = false; }; }
  return e;
};
doc.querySelector = (s: string) => doc.body.querySelector(s);
const { renderAnalysis } = await import('../webview/analysis.ts');
const rp = await import('../webview/review-plan.ts');
const { area: planArea, approveControls, optionPart, OWN_MAX, planPending, chooseKey, sendPlan } = await import('../webview/plan.ts');
const { sendAnswer, pending, answerKey } = await import('../webview/updates.ts');

const buttons = (e: PageElement, label: string): PageElement[] => e.all().filter((x) => x.tagName === 'BUTTON' && x.textContent === label);
const sheet = (): PageElement & { open: boolean } => doc.body.children.filter((c): c is PageElement => typeof c !== 'string' && c.tagName === 'DIALOG').at(-1) as PageElement & { open: boolean };
const step = (): string => sheet().all('rp-step')[0]?.dataset.step ?? '';
const radios = (): PageElement[] => sheet().all('rp-radio');
const picked = (): string => radios().find((r) => r.getAttribute('aria-checked') === 'true')?.dataset.pick ?? '';
const foot = (label: string): PageElement => buttons(sheet(), label)[0]!;
const typeInto = (box: PageElement, text: string): void => { (box as unknown as { value: string }).value = text; for (const f of box.listeners.get('input') ?? []) f({}); };
/** A fresh tab, and the sheet opened on ACME-21 from its plan section's Review plan. */
function open(m: TicketModel = sampleTalkTicket(NOW)): TicketModel {
  kept = undefined;
  // What an earlier test sent is never recorded here: it's forgotten, as a page that left it forgets it.
  pending.forget(new Set());
  planPending.forget(new Set());
  page.sent.length = 0;
  rp.shut();
  buttons(renderAnalysis(m, m.analysis!) as unknown as PageElement, 'Review plan')[0]!.click();
  return m;
}

test('the plan\'s top line says its version and what\'s left in words, and its one row has Review plan first; the rest is in its sections (T-136)', () => {
  kept = undefined;
  const m = sampleTicket(NOW, 'ACME-21');
  const sec = renderAnalysis(m, m.analysis!) as unknown as PageElement;
  const top = sec.all('an-top')[0]!;
  assert.equal(top.all().find((x) => x.tagName === 'H2')!.textContent, 'Plan v1: not approved yet', 'its heading is its state: the tab says Plan');
  assert.equal(top.all('plan-left')[0]!.textContent, '1 choice and 2 questions to review');
  const actions = sec.all('plan-actions');
  assert.equal(actions.length, 1, 'one row');
  assert.deepEqual(actions[0]!.all().filter((x) => x.tagName === 'BUTTON').map((b) => b.textContent), ['Review plan', 'Build it', 'Make a new plan']);
  assert.ok(buttons(actions[0]!, 'Review plan')[0]!.classList.contains('primary'), 'Review plan is the main button');
  assert.equal(buttons(sec, 'Approve this plan').length, 0, 'Approve is in the review\'s summary');
  assert.equal(sec.all('an-actions').length, 0, 'no second row');
  // Approved with nothing left, Build it leads, Review plan is a plain button, and the top line says the approval once.
  const approved = sampleTicket(NOW, 'ACME-21', false, null, null, 'approved');
  const a = approved.analysis!;
  const allDone = { ...a, review: { ...a.review!, left: 'Approved v2', steps: a.review!.steps.map((s) => ({ ...s, done: true })) } };
  const b = renderAnalysis(approved, allDone) as unknown as PageElement;
  assert.equal(b.all('plan-left').length, 0, 'edge case: nothing left, so "Approved v2" isn\'t said beside "Plan v2 approved"');
  assert.match(b.all('an-top')[0]!.textContent, /Ready to build/, 'the analysis\'s state shows instead');
  assert.equal(buttons(b, 'Review plan')[0]!.classList.contains('primary'), false);
  assert.ok(buttons(b, 'Build it')[0]!.classList.contains('primary'));
});

test('Review plan opens a dialog at the first step not done, its options a radio group under its question; Confirm sends the suggestion and goes on', () => {
  const m = open();
  const d = sheet();
  assert.equal(d.open, true);
  assert.equal(d.getAttribute('aria-label'), 'Review plan v1');
  assert.equal(step(), 'q1');
  const group = d.all('rp-options')[0]!;
  assert.equal(group.getAttribute('role'), 'radiogroup');
  assert.equal(group.getAttribute('aria-labelledby'), 'rp-q-q1');
  assert.deepEqual(radios().map((r) => r.dataset.pick), ['suggested', 'mine'], 'a question for you: its suggestion and your own words');
  assert.equal(picked(), 'suggested', 'the first option is picked');
  assert.match(radios()[0]!.textContent, /Recommended/);
  assert.equal(d.all('rp-place')[0]!.textContent, '1 of 5');
  assert.deepEqual(page.sent, [], 'nothing is sent by opening it');
  foot('Confirm').click();
  assert.deepEqual(page.sent, [{ type: 'analysis-answer', project: m.project, task: 'ACME-21', question: 'q1', text: 'Only the primary contact, as Decision Maker.' }]);
  assert.equal(step(), 'q3', 'and it goes on');
  assert.match(sheet().textContent, /Answered: Influencer/);
  assert.equal(foot('Next').disabled, false, 'an answered question has Next, and sends nothing');
  page.sent.length = 0;
  foot('Next').click();
  assert.deepEqual([page.sent, step()], [[], 'd1']);
});

test('a choice: its options with the recommended first and marked, More about this option opens its pros, cons, effort, risks and files, then Something else…', () => {
  open();
  rp.shut();
  kept = { opened: ['review:/Users/me/code/acme-service#ACME-21:open'], drafts: { 'review:/Users/me/code/acme-service#ACME-21:at': 'd2' } };
  rp.draw(sampleTalkTicket(NOW));
  assert.equal(step(), 'd2');
  assert.deepEqual(radios().map((r) => r.dataset.pick), ['a', 'b', 'c', 'own']);
  assert.match(radios()[0]!.textContent, /^1From now onRecommended/);
  assert.equal(radios()[3]!.textContent, '4Something else…Your own option, in your words');
  const more = buttons(sheet(), 'More about this option');
  assert.equal(more.length, 3, 'one for each option, none for Something else…');
  assert.equal(more[1]!.getAttribute('aria-expanded'), 'false');
  more[1]!.click();
  const details = sheet().all('rp-details');
  assert.equal(details.length, 1);
  assert.match(details[0]!.textContent, /^Effort L/);
  assert.deepEqual(details[0]!.all('po-label').map((x) => x.textContent), ['Pros', 'Cons', 'Risks', 'Files']);
  assert.match(details[0]!.textContent, /classes\/ContactRoleBackfill\.cls/);
  assert.equal(buttons(sheet(), 'More about this option')[1]!.getAttribute('aria-expanded'), 'true');
  assert.equal(buttons(sheet(), 'More about this option')[1]!.getAttribute('aria-label'), 'More about this option: Backfill too');
  assert.equal(picked(), 'a', 'opening it picks nothing');
});

test('Something else… and own words open a box: Confirm is off until words are typed, then sends them as the whole plan does', () => {
  const m = open();
  rp.shut();
  kept = { opened: ['review:/Users/me/code/acme-service#ACME-21:open'], drafts: { 'review:/Users/me/code/acme-service#ACME-21:at': 'd2' } };
  rp.draw(m);
  radios()[3]!.click();
  assert.equal(picked(), 'own');
  const box = sheet().all('text-input')[0]!;
  assert.equal(box.getAttribute('aria-label'), 'Your own option for Which converted leads get roles');
  assert.equal((box as unknown as { maxLength: number }).maxLength, OWN_MAX);
  assert.equal(foot('Confirm').disabled, true);
  assert.equal(foot('Confirm').title, 'Type your own option first');
  typeInto(box, 'Backfill only last year');
  assert.equal(foot('Confirm').disabled, false);
  page.sent.length = 0;
  foot('Confirm').click();
  assert.deepEqual(page.sent, [{ type: 'plan-choose', project: m.project, task: 'ACME-21', decision: 'd2', text: 'Backfill only last year' }]);
  assert.equal(step(), 'q2');
  (planArea.receive!['plan-done'] as (x: unknown) => void)({ action: 'plan-choose', project: m.project, task: 'ACME-21', decision: 'd2', ok: true });
  // A question's own words.
  rp.goTo('q1');
  radios()[1]!.click();
  assert.equal(foot('Confirm').title, 'Type your answer first');
  typeInto(sheet().all('text-input')[0]!, 'Only the primary contact');
  page.sent.length = 0;
  foot('Confirm').click();
  assert.deepEqual(page.sent, [{ type: 'analysis-answer', project: m.project, task: 'ACME-21', question: 'q1', text: 'Only the primary contact' }]);
});

test('a question for the ticket\'s author has Ask on the ticket, which drafts the comment instead of answering', () => {
  const m = open();
  rp.goTo('q2');
  assert.deepEqual(radios().map((r) => r.dataset.pick), ['suggested', 'mine', 'ask']);
  assert.match(sheet().textContent, /For the ticket's author/);
  page.sent.length = 0;
  radios()[2]!.click();
  foot('Confirm').click();
  assert.deepEqual(page.sent, [{ type: 'update-ask', project: m.project, task: 'ACME-21', question: 'q2' }]);
  assert.equal(step(), 'summary', 'the last step goes on to the summary');
  // Without a ticket to post on, it isn't offered.
  assert.deepEqual(rp.picksOf(m.analysis!.review!.steps.find((s) => s.id === 'q2')!, false).map((p) => p.id), ['suggested', 'mine']);
});

test('Back keeps what was picked, Skip for now sends nothing, and the dots say done, skipped and where you are', () => {
  open();
  assert.equal(foot('Back').disabled, true, 'nothing before the first step');
  foot('Skip for now').click();
  assert.deepEqual([page.sent, step()], [[], 'q3']);
  foot('Next').click();
  radios()[1]!.click();
  assert.equal(picked(), 'b');
  foot('Back').click();
  assert.equal(step(), 'q3');
  foot('Next').click();
  assert.equal(picked(), 'b', 'Back kept the pick, and nothing was sent');
  assert.deepEqual(page.sent, []);
  const dots = sheet().all('rp-dot');
  assert.deepEqual(dots.map((x) => x.className.split(' ')[1]), ['skipped', 'done', 'current', 'todo', 'todo']);
  // Only a skipped step is orange; a done one is blue with a check; the current one and those not yet seen are plain.
  const tone = (x: PageElement) => /tone-(\w+)/.exec(x.all('codicon')[0]!.className)?.[1] ?? 'plain';
  assert.deepEqual(dots.map(tone), ['orange', 'blue', 'plain', 'plain', 'plain']);
  assert.match(dots[1]!.all('codicon')[0]!.className, /codicon-pass-filled/);
  assert.equal(dots[0]!.getAttribute('aria-label'), '1. Should every converted contact get a role on the new opportunity, or only the lead\'s primary contact?: skipped');
  assert.equal(dots[2]!.getAttribute('aria-current'), 'step');
  assert.equal(sheet().all('rp-place')[0]!.textContent, '3 of 5');
  dots[3]!.click();
  assert.equal(step(), 'd2', 'a dot goes to its step');
});

test('the summary: a line each, skipped ones marked, each a click back to its step; Approve is off with why while something is left, and sends once nothing is', () => {
  const m = open();
  rp.goTo('d2');
  foot('Skip for now').click();
  foot('Skip for now').click();
  assert.equal(step(), 'summary');
  const lines = sheet().all('rp-sum-line');
  assert.deepEqual(lines.map((l) => l.all('rp-sum-value')[0]!.textContent), ['Not answered yet', 'Influencer', 'In LeadConversionHandler', 'Skipped', 'Skipped']);
  assert.equal(sheet().all('rp-place')[0]!.textContent, '2 of 5 done');
  const approve = foot('Approve this plan');
  assert.equal(approve.disabled, true);
  assert.equal(approve.title, 'First answer the question for you and make the choice.');
  assert.match(sheet().all('plan-why')[0]!.textContent, /^Approve is off: First answer the question for you and make the choice\.$/);
  lines[3]!.click();
  assert.equal(step(), 'd2', 'a line goes back to its step');
  // Everything for you done: Approve is on, and sends the approval.
  const p = m.analysis!.planState!;
  const ready = { ...m, analysis: { ...m.analysis!, planState: { ...p, approve: { disabled: null } } } };
  rp.goTo('summary');
  rp.draw(ready);
  page.sent.length = 0;
  foot('Approve this plan').click();
  assert.deepEqual(page.sent, [{ type: 'plan-approve', project: m.project, task: 'ACME-21' }]);
  assert.ok(buttons(sheet(), 'Close').length >= 1);
});

test('Discuss closes the sheet and opens the conversation\'s panel (T-111), with the choice or question quoted', () => {
  const m = open();
  rp.goTo('d2');
  page.sent.length = 0;
  buttons(sheet(), 'Discuss')[0]!.click();
  assert.equal(sheet().open, false, 'the sheet closes');
  assert.deepEqual(page.sent, [{ type: 'conversation-open', project: '/Users/me/code/acme-service', task: 'ACME-21', about: { ref: 'd2', text: 'Which converted leads get roles' } }]);
  const memory = kept as { opened: string[]; drafts: Record<string, string> };
  assert.equal(memory.opened.includes('review:/Users/me/code/acme-service#ACME-21:open'), false);
  // With no conversation to talk in, there's no Discuss.
  open(sampleTicket(NOW, 'ACME-21'));
  assert.equal(buttons(sheet(), 'Discuss').length, 0);
  void m;
});

test('edge case: a choice already chosen sends nothing again; on an approved plan a change asks first, Keep the approval sends nothing and Change it sends with its yes', async () => {
  open();
  rp.goTo('d1');
  assert.equal(picked(), 'a', 'what\'s chosen is picked');
  const current = () => radios().filter((r) => r.all('rp-chosen').length).map((r) => [r.dataset.pick, r.all('rp-chosen')[0]!.textContent]);
  assert.deepEqual(current(), [['a', 'Your current choice']], 'the plan\'s choice is marked on its own radio');
  radios()[1]!.click();
  assert.deepEqual(current(), [], 'with another option picked, the mark goes, so it never sits beside a different radio');
  radios()[0]!.click();
  assert.deepEqual(current(), [['a', 'Your current choice']], 'and comes back when it is picked again');
  foot('Confirm').click();
  assert.deepEqual([page.sent, step()], [[], 'd2']);
  const m = open(sampleTicket(NOW, 'ACME-21', false, null, null, 'approved'));
  rp.goTo('d2');
  radios()[1]!.click();
  foot('Confirm').click();
  assert.deepEqual(page.sent, [], 'asked first');
  assert.equal(step(), 'd2');
  const ask = sheet().all('plan-confirm')[0]!;
  assert.equal(ask.getAttribute('role'), 'alertdialog');
  buttons(ask, 'Keep the approval')[0]!.click();
  assert.deepEqual([page.sent, sheet().all('plan-confirm').length], [[], 0]);
  foot('Confirm').click();
  buttons(sheet().all('plan-confirm')[0]!, 'Change it')[0]!.click();
  assert.deepEqual(page.sent, [{ type: 'plan-choose', project: m.project, task: 'ACME-21', decision: 'd2', option: 'b', yes: true }]);
  assert.equal(planPending.what(chooseKey(m.project, 'ACME-21', 'd2')), 'choose');
  (planArea.receive!['plan-done'] as (x: unknown) => void)({ action: 'plan-choose', project: m.project, task: 'ACME-21', decision: 'd2', ok: true });
});

test('edge case: closing keeps what was picked, opening again starts at the first step not done, and a step that left the plan falls back to the summary', () => {
  const m = open();
  rp.goTo('d2');
  radios()[2]!.click();
  rp.shut();
  assert.equal(sheet().open, false);
  buttons(renderAnalysis(m, m.analysis!) as unknown as PageElement, 'Review plan')[0]!.click();
  assert.equal(step(), 'q1', 'it opens at the first step not done');
  rp.goTo('d2');
  assert.equal(picked(), 'c', 'the pick was kept');
  // A newer plan without that step: the sheet shows the summary.
  const fewer = { ...m, analysis: { ...m.analysis!, review: { ...m.analysis!.review!, steps: m.analysis!.review!.steps.filter((s) => s.id !== 'd2') } } };
  rp.draw(fewer);
  assert.equal(step(), 'summary');
  // A model with nothing to review closes it.
  rp.draw({ ...m, analysis: { ...m.analysis!, review: null } });
  assert.equal(sheet().open, false);
});

test('the helpers the sheet shares with the whole plan: an answer, a choice and Approve each go once, and an option\'s parts skip what\'s empty', () => {
  const m = sampleTicket(NOW, 'ACME-21');
  page.sent.length = 0;
  sendAnswer(m.project, 'ACME-21', 'q9', '  ');
  assert.deepEqual(page.sent, [], 'edge case: empty words send nothing');
  sendAnswer(m.project, 'ACME-21', 'q9', ' Yes ');
  sendAnswer(m.project, 'ACME-21', 'q9', 'Again');
  assert.deepEqual(page.sent, [{ type: 'analysis-answer', project: m.project, task: 'ACME-21', question: 'q9', text: 'Yes' }], 'once, while it\'s on its way');
  assert.equal(pending.what(answerKey(m.project, 'ACME-21', 'q9')), 'answer');
  page.sent.length = 0;
  sendPlan(chooseKey(m.project, 'ACME-21', 'd9'), 'choose', { type: 'plan-choose', decision: 'd9' });
  sendPlan(chooseKey(m.project, 'ACME-21', 'd9'), 'choose', { type: 'plan-choose', decision: 'd9' });
  assert.equal(page.sent.length, 1);
  assert.equal(optionPart('Risks', 'warning', []), null);
  assert.match((optionPart('Files', 'file', ['a.cls'], true) as unknown as PageElement).textContent, /Filesa\.cls/);
  const p = m.analysis!.planState!;
  assert.deepEqual(approveControls(m, 'ACME-21', { ...p, approve: null }), [], 'approved: nothing');
  const [b, why] = approveControls(m, 'ACME-21', p, true) as unknown as PageElement[];
  assert.deepEqual([b!.disabled, why!.textContent], [true, 'Approve is off: First answer the question for you and make the choice.']);
  assert.equal(approveControls(m, 'ACME-21', p).length, 1, 'without say, the reason is in its title only');
  // Review plan's button says what's left in its title.
  assert.equal(rp.reviewButton(m, 'ACME-21', m.analysis!.review!).title, 'Step through its choices and questions one at a time: 1 choice and 2 questions to review');
});
