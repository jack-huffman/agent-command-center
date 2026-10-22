// A task's plan in the Command Center (T-97): the option cards, choosing, Something else…, Ask on the
// ticket, the versions, Approve this plan, and Build it's off states with their reasons.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Analysis } from '../../packages/core/src/analyze.ts';
import { buildOff, choicesWord, forYou, planApproveArgs, planChooseArgs } from '../src/logic/plan.ts';
import type { AnalysisAsk, TaskRow } from '../src/logic/shared.ts';
import { analysisWait, rowAnalysis } from '../src/logic/tasks.ts';
import { analysisLook, cardActions } from '../src/model/cards.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { approveOff, byName, ticketPlan } from '../src/model/plan.ts';
import { modalTakes } from '../src/model/task-modal.ts';
import { samplePlan, sampleAnalyses } from '../scripts/fixtures/analysis.ts';
import { sampleTicket } from '../scripts/fixtures/task-page.ts';
import { type PageElement, pageDom } from './page-dom.ts';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const ask = (id: string, askOf: AnalysisAsk['askOf'] = 'you'): AnalysisAsk => ({ id, question: `${id}?`, why: '', suggested: '', askOf });
const todo = (more: Partial<TaskRow> = {}): TaskRow => ({ id: 'ACME-21', title: 'T', state: 'todo', display: 'ready', environment: 'dev', deps: [], source: { kind: 'jira', url: null }, analysisRequired: true, ...more });
const plan = (more: Partial<NonNullable<TaskRow['analysis']>> = {}): TaskRow['analysis'] => ({ verdict: 'ready', at: 't', open: [], split: [], choices: 0, approved: false, version: 1, ...more });

test('Build it is off with the reason that\'s missing, and on once the plan is approved or none is wanted', () => {
  assert.equal(buildOff(todo({ analysis: null })), 'Make a plan first: this project wants one before a build.');
  assert.equal(buildOff(todo({ analysis: plan(), analyzing: { sessionId: 's' } })), 'Its plan is being made.');
  assert.equal(buildOff(todo({ analysis: plan({ verdict: 'split' }) })), 'Its plan says it\'s too big for one task: split it first.');
  assert.equal(buildOff(todo({ analysis: plan({ open: [ask('q1'), ask('q2', 'author')], choices: 2 }) })), 'First answer 1 question for you, make 2 choices and approve this plan.');
  assert.equal(buildOff(todo({ analysis: plan({ open: [ask('q2', 'author')], choices: 1 }) })), 'First make 1 choice and approve this plan.', 'a question for the author holds nothing');
  assert.equal(buildOff(todo({ analysis: plan() })), 'First approve this plan.');
  assert.equal(buildOff(todo({ analysis: plan() }), 'v3 is new since v2 was approved'), 'Plan v3 is new since v2 was approved. First approve this plan again.');
  assert.equal(buildOff(todo({ analysis: plan({ approved: true }) })), null);
  assert.equal(buildOff(todo({ deps: ['ACME-1'], analysis: plan({ approved: true }) })), 'It waits for ACME-1.');
  // Where no plan is wanted, nothing about the plan holds it; a task in rework already had its plan; nor is anything else waiting to be built.
  assert.equal(buildOff(todo({ analysisRequired: false, analysis: plan({ choices: 2 }) })), null);
  assert.equal(buildOff(todo({ analysisRequired: false, analysis: null })), null);
  assert.equal(buildOff(todo({ state: 'rework', analysis: plan() })), null);
  assert.equal(buildOff(todo({ state: 'done' })), 'It isn\'t waiting to be built.');
});

test('only your questions count, choices read in words, and acc\'s arguments keep words that start with - as words', () => {
  assert.deepEqual(forYou([ask('q1'), ask('q2', 'author'), { ...ask('q3'), askOf: undefined }]).map((q) => q.id), ['q1', 'q3']);
  assert.deepEqual(forYou([]), [], 'none open');
  assert.deepEqual([choicesWord(1), choicesWord(2)], ['1 choice', '2 choices']);
  assert.deepEqual(planChooseArgs('ACME-21', 'd1', { option: 'b' }), ['plan', 'choose', 'ACME-21', 'd1', 'b', '--json']);
  assert.deepEqual(planChooseArgs('ACME-21', 'd1', { text: '--not a flag' }), ['plan', 'choose', 'ACME-21', 'd1', '--text=--not a flag', '--json']);
  assert.deepEqual(planApproveArgs('ACME-21'), ['plan', 'approve', 'ACME-21', '--json']);
  assert.equal(byName('human:jordan'), 'jordan');
});

test('the plan\'s model: its choices, its approval or why it lapsed, Approve\'s and Build it\'s reasons, and earlier versions newest first', () => {
  const v1 = sampleAnalyses(NOW)['ACME-21']!;
  const p = ticketPlan(todo({ analysis: rowAnalysis(v1) }), v1, { project: '/r', task: 'ACME-21' })!;
  assert.deepEqual([p.version, p.look.label, p.look.tone, p.canChoose], [1, 'Plan v1: not approved yet', 'orange', true]);
  assert.deepEqual(p.decisions.map((d) => [d.id, d.recommended, d.choice?.name ?? null]), [['d1', 'a', 'In LeadConversionHandler'], ['d2', 'a', null]]);
  assert.equal(p.approve!.disabled, 'First answer the question for you and make the choice.');
  assert.deepEqual([p.build!.label, p.build!.disabled], ['Build it', 'First answer 1 question for you, make 1 choice and approve this plan.']);
  const approved = samplePlan(NOW, 'approved');
  const a = ticketPlan(todo({ analysis: rowAnalysis(approved) }), approved, { project: '/r', task: 'ACME-21' })!;
  assert.deepEqual([a.look.label, a.approval?.by, a.approve, a.build!.disabled, a.build!.primary], ['Plan v2 approved', 'jordan', null, undefined, true]);
  assert.deepEqual(a.changes.length, 2);
  assert.deepEqual(a.earlier.map((e) => [e.version, !!e.approved]), [[1, false]]);
  const changed = samplePlan(NOW, 'changed');
  const c = ticketPlan(todo({ analysis: rowAnalysis(changed) }), changed, { project: '/r', task: 'ACME-21' })!;
  assert.deepEqual([c.look.label, c.lapsed], ['Approve again: v3 is new since v2 was approved', 'v3 is new since v2 was approved']);
  assert.equal(c.build!.disabled, 'Plan v3 is new since v2 was approved. First make 1 choice and approve this plan again.');
  assert.deepEqual(c.earlier.map((e) => [e.version, e.approved?.by ?? null]), [[2, 'jordan'], [1, null]], 'newest first');
  assert.deepEqual(c.decisions[0]!.choice, { option: null, name: 'In LeadConversionHandler, and only for leads from the web form', by: 'jordan', at: changed.decisions![0]!.choice!.at });
  // After the build: nothing to choose, approve or build; what was chosen still shows.
  const built = ticketPlan(todo({ state: 'running', analysis: rowAnalysis(approved) }), approved, { project: '/r', task: 'ACME-21' })!;
  assert.deepEqual([built.canChoose, built.approve, built.build], [false, null, null]);
  // No analysis, no plan; a split can't be approved.
  assert.equal(ticketPlan(todo(), null, { project: '/r', task: 'ACME-21' }), null);
  assert.equal(approveOff({ ...v1, verdict: 'split' } as Analysis), 'Its plan says it\'s too big for one task: split it rather than approve it.');
  assert.equal(approveOff({ ...v1, questions: [], decisions: [] } as Analysis), null);
});

test('the page sends a choice as an option or its own words, never both or neither, and an approval; the modal takes its own task\'s', () => {
  const base = { project: '/r', task: 'ACME-21' };
  assert.ok(isFromWebview({ type: 'plan-choose', ...base, decision: 'd1', option: 'b' }));
  assert.ok(isFromWebview({ type: 'plan-choose', ...base, decision: 'd2', text: 'My way' }));
  assert.ok(!isFromWebview({ type: 'plan-choose', ...base, decision: 'd1', option: 'b', text: 'x' }), 'both');
  assert.ok(!isFromWebview({ type: 'plan-choose', ...base, decision: 'd1' }), 'neither');
  assert.ok(!isFromWebview({ type: 'plan-choose', ...base, decision: 'd1', text: '   ' }), 'empty words');
  assert.ok(!isFromWebview({ type: 'plan-choose', ...base, decision: 'd1', text: 'x'.repeat(4001) }), 'too long');
  assert.ok(!isFromWebview({ type: 'plan-choose', ...base, decision: '../d1', option: 'b' }), 'an unknown choice id');
  assert.ok(!isFromWebview({ type: 'plan-choose', ...base, decision: 'd1', option: 'bb' }), 'an unknown option id');
  assert.ok(isFromWebview({ type: 'plan-approve', ...base }));
  assert.ok(!isFromWebview({ type: 'plan-approve', project: '/r', task: '../x' }));
  const o = { project: '/r', key: 'ACME-21' };
  assert.equal(modalTakes(o, { type: 'plan-approve', ...base }, new Set()), true);
  assert.equal(modalTakes(o, { type: 'plan-choose', project: '/r', task: 'ACME-9', decision: 'd1', option: 'a' }, new Set()), false, 'not another task\'s');
});

test('a card says what its plan waits on: your questions, its choices, an approval, or nothing once approved', () => {
  const look = (a: TaskRow['analysis'], required = true) => analysisLook({ ...todo({ analysis: a, analysisRequired: required }) })?.label ?? null;
  assert.equal(look(plan({ open: [ask('q1'), ask('q2', 'author')] })), 'Needs you: 1 question from its plan');
  assert.equal(look(plan({ open: [ask('q2', 'author')], choices: 2 })), 'Needs you: 2 choices to make in its plan');
  assert.equal(look(plan()), 'Needs you: approve its plan');
  assert.equal(look(plan({ approved: true })), 'Plan approved: ready to build');
  assert.equal(look(plan(), false), 'Planned: ready to build', 'no approval waited for where no plan is required');
  assert.deepEqual([analysisWait(todo({ analysis: plan({ choices: 1 }) })), analysisWait(todo({ analysis: plan() })), analysisWait(todo({ analysis: plan({ approved: true }) }))], ['choices', 'approve', null]);
  assert.equal(cardActions(todo({ display: 'needs-you', analysis: plan({ choices: 1 }) }), {})[0]!.label, 'See the plan');
});

// ---------------------------------------------------------------- the page itself

const page = pageDom();
// The page's memory (an open box, its words) kept between draws, as VSCode keeps a webview's state.
let kept: unknown;
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { page.sent.push(m); }, getState: () => kept, setState: (s: unknown) => { kept = s; } });
const { planActions, planDecisions, planHead, planPending, chooseKey, approveKey, area } = await import('../webview/plan.ts');
const { analysisQuestion } = await import('../webview/analysis.ts');

const buttons = (e: PageElement, label: string): PageElement[] => e.all().filter((x) => x.tagName === 'BUTTON' && x.textContent === label);
const box = (children: unknown[]): PageElement => { const d = page.document.createElement('div'); d.append(...(children.filter(Boolean) as PageElement[])); return d; };

test('each choice draws as option cards: recommended and chosen carry an icon and words, and Choose this sends the choice', () => {
  const m = sampleTicket(NOW, 'ACME-21');
  const p = m.analysis!.planState!;
  const d = planDecisions(m, 'ACME-21', p) as unknown as PageElement;
  const groups = d.all('plan-decision');
  assert.equal(groups.length, 2);
  const cards = groups[0]!.all('plan-option');
  assert.deepEqual(cards.map((c) => c.className), ['plan-option chosen recommended', 'plan-option']);
  assert.match(cards[0]!.all('po-rec')[0]!.textContent, /Recommended/);
  assert.match(cards[0]!.all('po-chosen')[0]!.textContent, /Chosen/);
  assert.equal(buttons(cards[0]!, 'Choose this').length, 0, 'the chosen one has no Choose this');
  assert.deepEqual(cards[1]!.all('po-label').map((x) => x.textContent), ['Pros', 'Cons', 'Risks', 'Touches']);
  page.sent.length = 0;
  buttons(cards[1]!, 'Choose this')[0]!.click();
  assert.deepEqual(page.sent, [{ type: 'plan-choose', project: m.project, task: 'ACME-21', decision: 'd1', option: 'b' }]);
  // While it's on its way, the choice says so, and a second click sends nothing.
  const again = planDecisions(m, 'ACME-21', p) as unknown as PageElement;
  assert.match(again.all('plan-decision')[0]!.textContent, /Recording your choice…/);
  // A refusal comes back saying why, to try again.
  (area.receive!['plan-done'] as (m: unknown) => void)({ action: 'plan-choose', project: m.project, task: 'ACME-21', decision: 'd1', ok: false, error: 'd1 has no option z.' });
  assert.equal(planPending.error(chooseKey(m.project, 'ACME-21', 'd1')), 'd1 has no option z.');
  assert.match((planDecisions(m, 'ACME-21', p) as unknown as PageElement).textContent, /Your choice wasn't recorded: d1 has no option z\./);
  // After the build, nothing to choose.
  const built = planDecisions(m, 'ACME-21', { ...p, canChoose: false }) as unknown as PageElement;
  assert.equal(buttons(built, 'Choose this').length + buttons(built, 'Something else…').length, 0);
  assert.equal(planDecisions(m, 'ACME-21', { ...p, decisions: [] }), null, 'a plan with no choices draws none');
});

test('Something else… opens a box for the person\'s own option, and Choose sends their words', () => {
  const m = sampleTicket(NOW, 'ACME-21');
  const p = m.analysis!.planState!;
  const d = planDecisions(m, 'ACME-21', p) as unknown as PageElement;
  const own = d.all('plan-decision')[1]!;
  buttons(own, 'Something else…')[0]!.click();
  const open = (planDecisions(m, 'ACME-21', p) as unknown as PageElement).all('plan-decision')[1]!;
  const input = open.all('text-input')[0]!;
  assert.ok(input, 'the box is open');
  const choose = buttons(open, 'Choose')[0]!;
  assert.equal(choose.disabled, true, 'nothing typed: nothing to choose');
  (input as unknown as { value: string }).value = 'Backfill only open opportunities';
  for (const f of input.listeners.get('input') ?? []) f({});
  assert.equal(choose.disabled, false);
  page.sent.length = 0;
  choose.click();
  assert.deepEqual(page.sent, [{ type: 'plan-choose', project: m.project, task: 'ACME-21', decision: 'd2', text: 'Backfill only open opportunities' }]);
  (area.receive!['plan-done'] as (m: unknown) => void)({ action: 'plan-choose', project: m.project, task: 'ACME-21', decision: 'd2', ok: true });
  assert.equal(planPending.what(chooseKey(m.project, 'ACME-21', 'd2')), undefined, 'recorded');
  assert.ok(!(planDecisions(m, 'ACME-21', p) as unknown as PageElement).all('plan-decision')[1]!.all('text-input').length, 'and its box closes');
});

test('a question for the ticket\'s author says so and has Ask on the ticket; one for you has neither', () => {
  const m = sampleTicket(NOW, 'ACME-21');
  const [mine, theirs] = m.analysis!.open.filter((q) => q.id !== 'q3');
  const author = analysisQuestion(m.project, 'ACME-21', { ...theirs!, client: undefined }, true) as unknown as PageElement;
  assert.match(author.textContent, /For the ticket's author/);
  assert.equal(buttons(author, 'Ask on the ticket').length, 1);
  const you = analysisQuestion(m.project, 'ACME-21', { ...mine!, client: undefined }, true) as unknown as PageElement;
  assert.equal(buttons(you, 'Ask on the ticket').length, 0);
  assert.doesNotMatch(you.textContent, /For the ticket's author/);
  // Without a ticket to post on, not even the author's.
  assert.equal(buttons(analysisQuestion(m.project, 'ACME-21', { ...theirs!, client: undefined }, false) as unknown as PageElement, 'Ask on the ticket').length, 0);
});

test('Approve this plan is off with why until it can be approved, then sends the approval; Build it says why it\'s off', () => {
  const m = sampleTicket(NOW, 'ACME-21');
  const p = m.analysis!.planState!;
  const actions = box(planActions(m, 'ACME-21', p));
  const approve = buttons(actions, 'Approve this plan')[0]!;
  assert.equal(approve.disabled, true);
  assert.equal(approve.title, 'First answer the question for you and make the choice.');
  const build = buttons(actions, 'Build it')[0]!;
  assert.equal(build.disabled, true);
  assert.match(actions.all('plan-why')[0]!.textContent, /^Build it is off: First answer 1 question for you, make 1 choice and approve this plan\.$/);
  // Ready to approve: it sends, and waits for acc.
  const ready = box(planActions(m, 'ACME-21', { ...p, approve: { disabled: null } }));
  page.sent.length = 0;
  buttons(ready, 'Approve this plan')[0]!.click();
  assert.deepEqual(page.sent, [{ type: 'plan-approve', project: m.project, task: 'ACME-21' }]);
  assert.equal(buttons(box(planActions(m, 'ACME-21', { ...p, approve: { disabled: null } })), 'Approving…')[0]!.disabled, true);
  (area.receive!['plan-done'] as (m: unknown) => void)({ action: 'plan-approve', project: m.project, task: 'ACME-21', ok: false, error: 'not ready' });
  assert.equal(planPending.error(approveKey(m.project, 'ACME-21')), 'not ready');
  assert.match(box(planActions(m, 'ACME-21', p)).textContent, /The plan wasn't approved: not ready/);
  // Approved: no Approve, Build it on, and it sends the dispatch.
  const approved = sampleTicket(NOW, 'ACME-21', false, null, null, 'approved');
  const on = box(planActions(approved, 'ACME-21', approved.analysis!.planState!));
  assert.equal(buttons(on, 'Approve this plan').length, 0);
  page.sent.length = 0;
  buttons(on, 'Build it')[0]!.click();
  assert.deepEqual(page.sent, [{ type: 'run', command: 'acc.task.dispatch', ref: { project: approved.project, task: 'ACME-21' } }]);
  assert.equal(on.all('plan-why').length, 0, 'no reason when it\'s on');
});

test('the head says the version, its approval or why it lapsed, and what changed; earlier versions are a click away', () => {
  const changed = sampleTicket(NOW, 'ACME-21', false, null, null, 'changed');
  const p = changed.analysis!.planState!;
  const head = planHead(p) as unknown as PageElement;
  assert.match(head.textContent, /Approve again: v3 is new since v2 was approved/);
  assert.match(head.all('plan-changes')[0]!.textContent, /What changed in v3New choice: Where a role's contact comes from/);
  const fold = box(planActions(changed, 'ACME-21', p)).all('plan-earlier')[0]!;
  assert.match(fold.textContent, /Earlier versions2/);
  assert.deepEqual(fold.all('plan-version').map((v) => v.textContent.slice(0, 2)), ['v2', 'v1']);
  assert.match(fold.all('plan-version')[0]!.textContent, /Approved by jordan/);
  // The first version has nothing that changed, and nothing before it.
  const first = sampleTicket(NOW, 'ACME-21').analysis!.planState!;
  assert.equal((planHead(first) as unknown as PageElement).all('plan-changes').length, 0);
  assert.equal(box(planActions(sampleTicket(NOW, 'ACME-21'), 'ACME-21', first)).all('plan-earlier').length, 0);
});
