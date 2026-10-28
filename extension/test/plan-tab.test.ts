// A calmer Plan tab (T-136): a made choice is one line with Compare the options, each fact said once, one top
// line and one row of actions, and named sections that fold on their own, the ones that wait on the person open.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TicketModel } from '../src/model/task-page.ts';
import { sampleTicket } from '../scripts/fixtures/task-page.ts';
import { sampleTalkTicket } from '../scripts/fixtures/talk.ts';
import { type PageElement, pageDom } from './page-dom.ts';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const page = pageDom();
let kept: unknown;
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { page.sent.push(m); }, getState: () => kept, setState: (s: unknown) => { kept = s; } });
const { renderAnalysis, questionWaits } = await import('../webview/analysis.ts');
const { choiceWaits, chooseKey, compareKey, planDecisions } = await import('../webview/plan.ts');
const { state } = await import('../webview/state.ts');

const buttons = (e: PageElement, label: string): PageElement[] => e.all().filter((x) => x.tagName === 'BUTTON' && x.textContent === label);
const draw = (m: TicketModel): PageElement => renderAnalysis(m, m.analysis!) as unknown as PageElement;
const said = (e: PageElement, words: RegExp): number => (e.textContent.match(words) ?? []).length;
/** Each section by its id: its name and count as its summary says them, and whether it's open. */
const sections = (e: PageElement) => e.all('an-sec').map((s) => ({ id: s.dataset.part, name: s.all('an-sec-name')[0]!.textContent, count: Number(s.all('count')[0]!.textContent), open: (s as unknown as { open: boolean }).open }));

test('a made choice is one line, the option chosen and who chose it, its cards drawn only once compared; Chosen is said once either way', () => {
  kept = undefined;
  const m = sampleTicket(NOW, 'ACME-21');
  const p = m.analysis!.planState!;
  const groups = () => (planDecisions(m, 'ACME-21', p) as unknown as PageElement).all('plan-decision');
  const [made, open] = groups();
  assert.equal(made!.all('plan-option').length, 0, 'no cards');
  assert.equal(made!.all('pd-line').length, 1);
  assert.match(made!.textContent, /^d1Where the contact roles are madeaIn LeadConversionHandlerChosen by jordan/);
  assert.equal(said(made!, /Chosen/g), 1);
  assert.equal(open!.all('plan-option').length, 3, 'a choice still open shows its cards side by side');
  assert.equal(said(open!, /Chosen/g), 0);
  const compare = buttons(made!, 'Compare the 2 options')[0]!;
  assert.equal(compare.getAttribute('aria-expanded'), 'false');
  compare.click();
  const compared = groups()[0]!;
  assert.equal(compared.all('plan-option').length, 2, 'compared, its cards show');
  assert.equal(said(compared, /Chosen/g), 1, 'still said once, on the card chosen');
  assert.equal(compared.all('pd-line').length, 0);
  const hide = buttons(compared, 'Hide the options')[0]!;
  assert.equal(hide.getAttribute('aria-expanded'), 'true');
  hide.click();
  assert.equal(groups()[0]!.all('plan-option').length, 0, 'and Hide the options folds it back');
});

test('edge case: a made choice in its own words is a line too, and one waiting for a yes on an approved plan shows in full', () => {
  kept = undefined;
  const m = sampleTicket(NOW, 'ACME-21', false, null, null, 'changed');
  const own = (planDecisions(m, 'ACME-21', m.analysis!.planState!) as unknown as PageElement).all('plan-decision')[0]!;
  assert.match(own.all('pd-line')[0]!.textContent, /Something else: In LeadConversionHandler, and only for leads from the web form/);
  assert.equal(said(own, /Chosen/g), 1);
  // Approved, Choose this on another option asks first: the choice shows in full, with the question.
  const approved = sampleTicket(NOW, 'ACME-21', false, null, null, 'approved');
  const key = chooseKey(approved.project, 'ACME-21', 'd2');
  kept = { opened: [`${key}:confirm:b`] };
  const asked = (planDecisions(approved, 'ACME-21', approved.analysis!.planState!) as unknown as PageElement).all('plan-decision')[1]!;
  assert.equal(asked.all('plan-option').length, 3);
  assert.equal(asked.all('plan-confirm').length, 1);
  assert.equal(said(asked, /Chosen/g), 1);
  assert.equal(choiceWaits(approved, 'ACME-21', approved.analysis!.planState!, approved.analysis!.planState!.decisions[1]!), true, 'it waits on the person');
  // Edge case: a choice with no options to compare offers no Compare.
  kept = undefined;
  const bare = { ...approved.analysis!.planState!, decisions: [{ ...approved.analysis!.planState!.decisions[0]!, options: [] }] };
  assert.equal(buttons(planDecisions(approved, 'ACME-21', bare) as unknown as PageElement, 'Compare the 0 options').length, 0);
  assert.equal((planDecisions(approved, 'ACME-21', bare) as unknown as PageElement).all('pd-compare').length, 0);
});

test('the approval appears once and Chosen once a choice, the plan\'s state is its heading, and there is one top line and one row', () => {
  kept = undefined;
  const approved = draw(sampleTicket(NOW, 'ACME-21', false, null, null, 'approved'));
  assert.equal(said(approved, /Plan v2 approved/g), 1);
  assert.equal(said(approved, /by jordan/g) - said(approved, /Chosen by jordan/g), 1, 'who approved it, once');
  // Its earlier v1 says it was "not approved": another version's state, in More.
  assert.equal(said(approved, /(?<!not )approved/gi), 1, 'and no other word of it');
  assert.equal(said(approved, /Chosen/g), 2, 'two choices made, Chosen once each');
  assert.equal(approved.all('an-top').length, 1);
  const headings = approved.all().filter((x) => x.tagName === 'H2').map((h) => h.textContent);
  assert.deepEqual(headings, ['Plan v2 approved'], 'no Plan heading: the tab says it');
  assert.equal(approved.all('plan-actions').length, 1);
  // With a conversation, its line and Open conversation are in the same row, after the plan's own buttons.
  const talked = sampleTalkTicket(NOW, true);
  const row = draw(talked).all('plan-actions');
  assert.equal(row.length, 1);
  assert.equal(row[0]!.all('convo-line').length, 1);
  const labels = row[0]!.all().filter((x) => x.tagName === 'BUTTON').map((b) => b.textContent);
  assert.ok(labels.indexOf('Open conversation') > labels.indexOf('Build it') && labels.indexOf('Build it') >= 0, labels.join(', '));
  assert.equal(draw(talked).all('an-actions').length, 0);
});

test('the whole plan is named sections with their counts, nothing lost: each choice, question, step, criterion, risk, test and the rest', () => {
  kept = undefined;
  const m = sampleTicket(NOW, 'ACME-21', false, null, null, 'changed');
  const a = m.analysis!;
  const e = draw(m);
  assert.deepEqual(sections(e).map((s) => [s.id, s.name, s.count]), [
    ['choices', 'Choices', 2], ['questions', 'Questions', 1], ['approach', 'The approach', 3], ['criteria', 'Acceptance criteria', 3], ['risks', 'Risks and tests', 4],
    ['more', 'More', a.assumptions.length + a.outOfScope.length + a.findings.length + a.wording!.findings.length + a.planState!.earlier.length + a.refactors.length + a.decided.length],
  ]);
  assert.equal(e.all('an-whole').length, 0, 'no The whole plan');
  const more = e.all('an-sec').find((s) => s.dataset.part === 'more')!;
  assert.deepEqual(more.all('an-part-name').map((n) => n.textContent.replace(/\d+$/, '')), ['Assumptions', 'Out of scope', 'What\'s there now', 'How the requirements read', 'Earlier versions', 'Refactors first', 'Decided']);
  assert.equal(more.all('status').length, 1, 'the wording\'s state beside More\'s count');
  // Everything the plan holds is still drawn somewhere.
  for (const [cls, n] of [['plan-decision', 2], ['aq', 1], ['plan-version', 2], ['an-discussable', 0]] as const) assert.ok(e.all(cls).length >= n, cls);
  assert.match(e.textContent, /What changed in v3/, 'what changed shows above the sections');
  // Edge case: a section with nothing in it isn't drawn.
  const none = draw({ ...m, analysis: { ...a, open: [], risks: [], tests: [] } });
  assert.deepEqual(sections(none).map((s) => s.id), ['choices', 'approach', 'criteria', 'more']);
});

test('Choices and Questions open by themselves while something in them waits on the person; the rest start closed, and what the person opens or closes stays so', () => {
  kept = undefined;
  const open = (m: TicketModel) => Object.fromEntries(sections(draw(m)).map((s) => [s.id, s.open]));
  const first = sampleTicket(NOW, 'ACME-21');
  assert.deepEqual(open(first), { choices: true, questions: true, approach: false, criteria: false, risks: false, more: false });
  // Approved, both choices made: Choices starts closed; the question for the author not yet asked still waits.
  const approved = sampleTicket(NOW, 'ACME-21', false, null, null, 'approved');
  assert.deepEqual([open(approved).choices, open(approved).questions], [false, true]);
  // Edge case: a question for the author already sent to the client waits on nobody here.
  assert.equal(questionWaits({ canAsk: true, open: [{ id: 'q2', question: '?', why: '', suggested: '', askOf: 'author', client: 'posted' }] }), false);
  assert.equal(questionWaits({ canAsk: true, open: [{ id: 'q2', question: '?', why: '', suggested: '', askOf: 'author' }] }), true, 'not sent yet: it waits on the person to ask');
  assert.equal(questionWaits({ canAsk: false, open: [] }), false, 'edge case: none open');
  // Closed by the person, a waiting section stays closed; opened, a closed one stays open.
  const key = `an:${first.project}#ACME-21:sec:`;
  kept = { opened: [`${key}choices:shut`, `${key}more`] };
  assert.deepEqual([open(first).choices, open(first).more], [false, true]);
  // The toggle remembers it: closing Choices marks it shut, opening More remembers it open.
  kept = undefined;
  const e = draw(first);
  const fire = (id: string, to: boolean) => {
    const s = e.all('an-sec').find((x) => x.dataset.part === id)! as PageElement & { open: boolean };
    s.open = to;
    for (const f of s.listeners.get('toggle') ?? []) f({});
  };
  fire('choices', false);
  fire('more', true);
  assert.deepEqual((kept as { opened: string[] }).opened.filter((k) => k.startsWith(key)).sort(), [`${key}choices:shut`, `${key}more`]);
  assert.ok(compareKey(chooseKey(first.project, 'ACME-21', 'd1')).endsWith(':d1:compare'));
});

test('edge case: The approach with what other tasks build on and no steps counts them, never 0', () => {
  kept = undefined;
  const m = sampleTicket(NOW, 'ACME-21', false, null, null, 'shapes');
  const s = m.analysis!.planState!.shapes!;
  const n = s.shapes.length + (s.split ? 1 : 0);
  assert.ok(n > 0, 'the fixture has shapes');
  const approach = (x: TicketModel) => sections(draw(x)).find((y) => y.id === 'approach');
  assert.equal(approach(m)!.count, m.analysis!.plan.length + n, 'its steps and its shapes');
  assert.equal(approach({ ...m, analysis: { ...m.analysis!, plan: [] } })!.count, n, 'shapes alone');
});

test('opening Risks and files on one card opens it on every card of that choice, and the toggle a draw fires draws nothing', () => {
  kept = undefined;
  const m = sampleTicket(NOW, 'ACME-21');
  const p = m.analysis!.planState!;
  let draws = 0;
  state.last = m as never;
  state.draw = () => { draws++; };
  const folds = () => (planDecisions(m, 'ACME-21', p) as unknown as PageElement).all('plan-decision')[1]!.all('po-more') as (PageElement & { open: boolean })[];
  const fire = (d: PageElement) => { for (const f of d.listeners.get('toggle') ?? []) f({}); };
  const first = folds();
  assert.equal(first.length, 2, 'the two cards with risks or files');
  assert.ok(first.every((d) => !d.open), 'closed at first');
  // Edge case: the toggle a draw fires, with the fold as remembered, draws nothing.
  fire(first[1]!);
  assert.equal(draws, 0);
  first[0]!.open = true;
  fire(first[0]!);
  assert.equal(draws, 1, 'opened by the person: drawn again');
  const again = folds();
  assert.ok(again.every((d) => d.open), 'open on every card of the choice');
  fire(again[1]!);
  assert.equal(draws, 1, 'drawn open, its toggle draws nothing');
  assert.equal((planDecisions(m, 'ACME-21', p) as unknown as PageElement).all('plan-decision')[0]!.all('po-more').length, 0, 'the made choice\'s line has no cards to open');
  state.last = null;
});

test('with a conversation, the row holds Open conversation and no Talk it through; without one, Talk it through', () => {
  kept = undefined;
  const labels = (m: TicketModel) => draw(m).all('plan-actions')[0]!.all().filter((x) => x.tagName === 'BUTTON').map((b) => b.textContent);
  const talked = labels(sampleTalkTicket(NOW, true));
  assert.equal(talked.filter((l) => l === 'Open conversation').length, 1);
  assert.equal(talked.includes('Talk it through'), false, talked.join(', '));
  // Edge case: a plan that can be talked through before any conversation keeps Talk it through.
  const fresh = sampleTalkTicket(NOW, true);
  const none = labels({ ...fresh, talk: { ...fresh.talk!, line: null } });
  assert.deepEqual([none.includes('Talk it through'), none.includes('Open conversation')], [true, false], none.join(', '));
});
