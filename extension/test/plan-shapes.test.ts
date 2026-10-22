// A plan's suggested shape-first split on the task's page (T-104): the shapes other tasks build on, the
// suggestion with why, and Split into these tasks, which goes to acc and which a person may ignore.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planSplitArgs } from '../src/logic/plan.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { modalTakes } from '../src/model/task-modal.ts';
import { ticketPlan, ticketShapes } from '../src/model/plan.ts';
import { samplePlan, sampleAnalyses } from '../scripts/fixtures/analysis.ts';
import { sampleTicket } from '../scripts/fixtures/task-page.ts';
import { type PageElement, pageDom } from './page-dom.ts';

const NOW = Date.parse('2026-10-22T12:00:00Z');

const page = pageDom();
let kept: unknown;
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { page.sent.push(m); }, getState: () => kept, setState: (s: unknown) => { kept = s; } });
const { planShapes, planPending, splitKey, area } = await import('../webview/plan.ts');

const buttons = (e: PageElement, label: string): PageElement[] => e.all().filter((x) => x.tagName === 'BUTTON' && x.textContent === label);

test('the page shows the shapes other tasks build on, then the suggested first task and the rest, with why', () => {
  const m = sampleTicket(NOW, 'ACME-21', false, null, null, 'shapes');
  const shapes = m.analysis!.planState!.shapes!;
  assert.equal(shapes.shapes[0]!.name, 'The contact role record');
  assert.equal(shapes.split!.go!.disabled, null);
  const drawn = planShapes(m, 'ACME-21', m.analysis!.planState!) as unknown as PageElement;
  const text = drawn.textContent;
  assert.match(text, /Other tasks build on this/);
  assert.match(text, /The contact role record.*schema.*ACME-23 and ACME-24 read and write it\./);
  assert.match(text, /Used by ACME-23, ACME-24/);
  assert.match(text, /Suggested: a small first task for the shape/);
  assert.match(text, /Both tasks need only the record/);
  assert.match(text, /The contact role record and its tests.*First: the shape and its tests/);
  assert.match(text, /Add contact roles when a lead converts.*Then: waits for the first/);
  assert.match(text, /Or ignore this: the plan builds as it is\./);
  assert.equal(drawn.all('ps-first').length + drawn.all('ps-rest').length, 2, 'each task says where it comes in, in words');
});

test('Split into these tasks sends the split, waits for acc, and says why when acc refused it', () => {
  const m = sampleTicket(NOW, 'ACME-21', false, null, null, 'shapes');
  const p = m.analysis!.planState!;
  page.sent.length = 0;
  buttons(planShapes(m, 'ACME-21', p) as unknown as PageElement, 'Split into these tasks')[0]!.click();
  assert.deepEqual(page.sent, [{ type: 'plan-split', project: m.project, task: 'ACME-21' }]);
  assert.equal(planPending.what(splitKey(m.project, 'ACME-21')), 'split');
  const waiting = planShapes(m, 'ACME-21', p) as unknown as PageElement;
  assert.equal(buttons(waiting, 'Splitting…')[0]!.disabled, true, 'a second click waits for the first');
  (area.receive!['plan-done'] as (m: unknown) => void)({ action: 'plan-split', project: m.project, task: 'ACME-21', ok: false, error: 'ACME-21 is already split into T-1 and T-2.' });
  assert.match((planShapes(m, 'ACME-21', p) as unknown as PageElement).textContent, /The task wasn't split: ACME-21 is already split into T-1 and T-2\./);
  assert.equal(buttons(planShapes(m, 'ACME-21', p) as unknown as PageElement, 'Split into these tasks').length, 1, 'it can be tried again');
});

test('a plan with no shared shape shows nothing, and a split already made names its tasks instead of offering it', () => {
  const none = sampleTicket(NOW, 'ACME-21');
  assert.equal(none.analysis!.planState!.shapes, null);
  assert.equal(planShapes(none, 'ACME-21', none.analysis!.planState!), null, 'edge case: nothing is drawn');
  const a = samplePlan(NOW, 'shapes');
  const made = { ...a, shapeSplit: { ...a.shapeSplit!, made: { first: 'T-1', rest: 'T-2', by: 'human:jordan', at: '' } } };
  const m = sampleTicket(NOW, 'ACME-21', false, null, null, 'shapes');
  const p = { ...m.analysis!.planState!, shapes: ticketShapes(made, true) };
  const drawn = planShapes(m, 'ACME-21', p) as unknown as PageElement;
  assert.match(drawn.textContent, /Split into T-1 and T-2\. T-2 starts once T-1 merges\./);
  assert.equal(buttons(drawn, 'Split into these tasks').length, 0);
});

test('the split is offered only before the build, and only a plan with a suggestion has one', () => {
  const a = samplePlan(NOW, 'shapes');
  assert.equal(ticketShapes(a, true)!.split!.go!.disabled, null);
  assert.equal(ticketShapes(a, false)!.split!.go, null, 'past the build there is nothing to split');
  assert.equal(ticketShapes(sampleAnalyses(NOW)['ACME-21']!, true), null, 'no shape, no suggestion');
  const onlyShapes = { ...a, shapeSplit: undefined };
  assert.equal(ticketShapes(onlyShapes, true)!.split, null, 'a shared shape with no split suggested');
  const row = { id: 'ACME-21', title: 'T', state: 'todo' as const, display: 'ready' as const, environment: 'dev', deps: [], source: { kind: 'jira' as const, url: null } };
  assert.ok(ticketPlan(row, a, { project: '/r', task: 'ACME-21' })!.shapes);
});

test('acc\'s arguments for the split, and the page\'s message, are checked like the plan\'s others', () => {
  assert.deepEqual(planSplitArgs('ACME-21'), ['plan', 'split', 'ACME-21', '--json']);
  assert.ok(isFromWebview({ type: 'plan-split', project: '/r', task: 'ACME-21' }));
  assert.ok(!isFromWebview({ type: 'plan-split', project: '/r' }), 'a split without its task is refused');
  assert.ok(!isFromWebview({ type: 'plan-split', project: '/r', task: 'not a task' }));
  // The modal over the Tasks board takes it for its own task only.
  const o = { project: '/r', key: 'ACME-21' } as never;
  assert.equal(modalTakes(o, { type: 'plan-split', project: '/r', task: 'ACME-21' } as never, new Set()), true);
  assert.equal(modalTakes(o, { type: 'plan-split', project: '/r', task: 'ACME-22' } as never, new Set()), false);
});
