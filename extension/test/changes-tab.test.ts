// The Changes tab as the page draws it (T-138): its path line in words, Deploy that opens the sheet and never
// deploys, off with why; the steps left with Mark done and Skip; More closed, holding what moved; the tab's
// needs-you from the deploy, never the manifest; and the sheet's Deploy, on only after a passed check.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TicketModel } from '../src/model/task-page.ts';
import type { DeploySheet, TicketDeploy } from '../src/model/ticket-deploy.ts';
import { PATH_LOOK, SHEET_LOOK } from '../src/model/ticket-deploy.ts';
import { RECORD_LOOK, type TicketRecords } from '../src/model/record-changes.ts';
import { pageDom, type PageElement } from './page-dom.ts';

const deploy = (more: Partial<TicketDeploy> = {}): TicketDeploy => ({
  task: 'ACME-7',
  path: [{ name: 'Dev', look: PATH_LOOK.merged, at: null }, { name: 'QA', look: PATH_LOOK.deployed, at: '2026-10-28T08:00:00.000Z' }, { name: 'UAT', look: PATH_LOOK.next, at: null }],
  deploy: { label: 'Deploy to UAT', to: 'uat', disabled: null }, others: [], sheet: null, status: null, needs: null, ...more,
});
const records = (todo: number): TicketRecords => ({
  task: 'ACME-7', look: RECORD_LOOK.kept, note: null, add: { label: 'Add a change made by hand', disabled: null },
  rows: [{ look: RECORD_LOOK.made, words: 'Update Account Acme', why: 'w', by: null, at: null, refused: null }],
  promotions: [{ env: 'uat', name: 'UAT', pr: null, left: null, steps: [
    ...Array.from({ length: todo }, (_, i) => ({ change: `c${i + 1}`, env: 'uat', look: RECORD_LOOK.todo, words: `Step ${i + 1}`, script: [], reason: null, by: null, at: null, done: { label: 'Mark done', disabled: null }, skip: { label: 'Skip', disabled: null } })),
    { change: 'c9', env: 'uat', look: RECORD_LOOK.done, words: 'Made already', script: [], reason: null, by: 'human:jordan', at: '2026-10-28T08:00:00.000Z', done: null, skip: null },
  ] }],
});
const model = (more: Partial<TicketModel> = {}): TicketModel => ({ project: '/r', key: 'ACME-7', changes: null, records: null, deploy: deploy(), ...more } as TicketModel);
/**
 * The page's document, and one VSCode API for the whole file: the page's modules read it once as they load.
 * Its memory is kept, as VSCode keeps a webview's state, so an open fold stays as the page redraws; each
 * test's messages start empty.
 */
const sent: unknown[] = [];
let kept: unknown;
function setup(): { sent: unknown[] } {
  pageDom();
  sent.length = 0;
  (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (x: unknown) => sent.push(x), getState: () => kept, setState: (s: unknown) => { kept = s; } });
  return { sent };
}
const all = (e: PageElement): PageElement[] => [e, ...e.all()];
const buttons = (es: PageElement[]): PageElement[] => es.flatMap(all).filter((x) => x.tagName === 'BUTTON');

test('the path line says each environment in words with an icon, and Deploy opens the check, never a deploy (T-138)', async () => {
  const page = setup();
  const { renderDeploy } = await import('../webview/changes.ts');
  const drawn = renderDeploy(model(), deploy()) as unknown as PageElement;
  assert.match(drawn.textContent, /^Dev, merged·QA, deployed.*·UAT, nextDeploy to UAT$/);
  assert.equal(drawn.all('dp-stop').filter((s) => s.querySelector('.codicon')).length, 3, 'each stop has its icon');
  const go = buttons([drawn]).find((b) => b.textContent === 'Deploy to UAT')!;
  assert.ok(go.classList.contains('primary'), 'the tab\'s one primary button');
  go.click();
  assert.deepEqual(page.sent, [{ type: 'deploy-check', project: '/r', task: 'ACME-7', to: 'uat' }], 'it asks for the check; nothing deploys');
});

test('edge case: Deploy off says why, beside it and in its title, and sends nothing; the other next steps wait in a closed menu (T-138)', async () => {
  const page = setup();
  const { renderDeploy } = await import('../webview/changes.ts');
  const why = 'It depends on ACME-3, which isn\'t in UAT yet.';
  const drawn = renderDeploy(model(), deploy({ deploy: { label: 'Deploy to UAT', to: 'uat', disabled: why }, others: [{ label: 'Deploy to Hotfix', to: 'hotfix', disabled: null }] })) as unknown as PageElement;
  const go = buttons([drawn]).find((b) => b.textContent === 'Deploy to UAT')!;
  assert.deepEqual([go.disabled, go.title, go.getAttribute('aria-description')], [true, `Deploy to UAT: ${why}`, why]);
  assert.equal(drawn.querySelector('.dp-why')?.textContent, why);
  go.click();
  assert.deepEqual(page.sent, []);
  const menu = buttons([drawn]).find((b) => b.textContent === 'Other next steps')!;
  assert.equal(menu.getAttribute('aria-expanded'), 'false');
  assert.equal(drawn.querySelector('.dp-other'), null, 'closed: its steps aren\'t drawn');
  // Under way: the tab says what it's doing, with the pull request once there is one.
  const busy = renderDeploy(model(), deploy({ status: { look: SHEET_LOOK.deployed, words: 'Deployed ACME-7 to UAT.', pr: { number: 9, url: 'u' } } })) as unknown as PageElement;
  assert.match(busy.querySelector('.dp-status')!.textContent, /^Deployed ACME-7 to UAT\.Pull request #9$/);
});

test('the tab: the list, record changes in words, the deploy, the steps left with Mark done and Skip, and More closed holding what moved (T-138)', async () => {
  setup();
  const { renderChangesTab } = await import('../webview/changes.ts');
  const moved = Object.assign(document.createElement('section'), { className: 'moved-part' }) as unknown as HTMLElement;
  const out = renderChangesTab(model({ records: records(2) }), [moved]) as unknown as PageElement[];
  assert.deepEqual(out.map((e) => e.className), ['block chg chg-records', 'block dp', 'block chg dp-left', 'chg-more']);
  assert.match(out[0]!.textContent, /^Record changesMade, plannedUpdate Account Acme$/);
  const left = out[2]!;
  assert.match(left.textContent, /^Left to do by hand: 2 steps/);
  assert.deepEqual(buttons([left]).map((b) => b.textContent), ['Mark done', 'Skip', 'Mark done', 'Skip'], 'each step still to do, and none already made');
  const more = out[3]!;
  assert.deepEqual([buttons([more]).map((b) => [b.textContent, b.getAttribute('aria-expanded')]), more.all('moved-part').length], [[['More', 'false']], 0], 'closed: what moved waits a click away');
  buttons([more])[0]!.click();
  const open = renderChangesTab(model({ records: records(2) }), [moved]) as unknown as PageElement[];
  assert.equal(open.at(-1)!.all('moved-part').length, 1, 'opened, it holds what moved, and stays open as the page redraws');
  // Edge: nothing in it, no More; no deploy outside Salesforce.
  assert.deepEqual((renderChangesTab(model({ deploy: null }), []) as unknown as PageElement[]).map((e) => e.className), []);
});

test('the tab needs the person for a passed check or steps left, never for the manifest\'s or the field\'s state (T-138)', async () => {
  const { changesNeeds, taskTabs } = await import('../webview/tab-rules.ts');
  assert.equal(changesNeeds(model()), null);
  assert.equal(changesNeeds(model({ deploy: deploy({ needs: 'Check passed: deploy to UAT' }) })), 'Check passed: deploy to UAT');
  assert.equal(changesNeeds(model({ records: records(2) })), '2 steps to do by hand');
  const orange = { label: 'The org differs', icon: 'diff', tone: 'orange' as const };
  const tabs = taskTabs({ ...model(), comments: [], updates: [], analysis: null, criteria: null, acc: null, review: null, verify: null, manifest: { look: orange }, field: { look: orange } } as unknown as TicketModel);
  assert.deepEqual(tabs.find((t) => t.id === 'changes')?.needs, null, 'the manifest\'s state waits under More');
});

test('the sheet\'s Deploy is on only after a passed check, and for a protected org only once its name is typed (T-138)', async () => {
  setup();
  const { goOff } = await import('../webview/deploy-sheet.ts');
  const sheet = (more: Partial<DeploySheet> = {}): DeploySheet => ({
    task: 'ACME-7', to: 'uat', toName: 'UAT', org: 'acme-uat', phase: 'passed', look: SHEET_LOOK.passed, progress: null, components: { count: 3, types: [] }, tests: null,
    step: null, byHand: [], problems: [], summary: null, checkId: '0Af1', confirm: null, result: null, error: null, ...more,
  });
  assert.equal(goOff(sheet(), ''), null);
  assert.equal(goOff(sheet({ phase: 'checking', checkId: null }), ''), 'Wait for the check to pass');
  assert.equal(goOff(sheet({ phase: 'failed', checkId: null }), ''), 'The check failed: there\'s nothing to deploy');
  assert.equal(goOff(sheet({ phase: 'failed' }), ''), 'The check failed: there\'s nothing to deploy', 'even with an id, a failed check offers nothing');
  assert.equal(goOff(sheet({ confirm: 'Production' }), 'prod'), 'Type Production to deploy to it');
  assert.equal(goOff(sheet({ confirm: 'Production' }), ' Production '), null);
  assert.equal(goOff(sheet({ confirm: 'Production' }), 'acme-uat'), null, 'or its org\'s alias');
  assert.equal(goOff(sheet({ phase: 'deployed' }), ''), 'Wait for the check to pass', 'once deployed, no second yes');
});

test('edge case: the steps left draw only the steps given, each still to do with its two buttons, and none when given none (T-138)', async () => {
  setup();
  const { renderSteps } = await import('../webview/record-changes.ts');
  const r = records(1);
  const one = renderSteps(model(), r, r.promotions[0]!.steps.filter((s) => s.done)) as unknown as PageElement;
  assert.deepEqual(buttons([one]).map((b) => b.textContent), ['Mark done', 'Skip']);
  assert.equal((renderSteps(model(), r, []) as unknown as PageElement).all().length, 0);
});
