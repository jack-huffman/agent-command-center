// The Changes tab as the page draws it (T-138, T-158): a row for each environment with its state in words and
// an icon, when it was read and Check again, a partly deployed row that opens on what differs; one Deploy…, which
// asks where and starts the agent there, never a direct deploy, off with why; the steps left with Mark done and
// Skip; More closed, holding what moved; and the tab's needs-you from the deploy, never the manifest.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TicketModel } from '../src/model/task-page.ts';
import type { EnvRow, TicketDeploy } from '../src/model/ticket-deploy.ts';
import { BUSY_LOOK, NEXT_LOOK, WHERE_LOOK } from '../src/model/ticket-deploy.ts';
import { RECORD_LOOK, type TicketRecords } from '../src/model/record-changes.ts';
import { pageDom, type PageElement } from './page-dom.ts';

const AT = '2026-10-28T08:00:00.000Z';
const row = (name: string, more: Partial<EnvRow> = {}): EnvRow => ({
  name, branch: name.toLowerCase(), org: `acme-${name.toLowerCase()}`, look: WHERE_LOOK.deployed, at: AT, detail: null, differs: [], notes: [], readAt: AT, merged: null, next: null, busy: null, reading: false, ...more,
});
const deploy = (more: Partial<TicketDeploy> = {}): TicketDeploy => ({
  task: 'ACME-7',
  rows: [
    row('Dev', { merged: { look: { label: 'Merged', icon: 'git-merge', tone: 'blue' }, words: 'Merged into dev' } }), row('QA'),
    row('UAT', { look: WHERE_LOOK.partly, at: null, detail: '2 components differ', differs: ['Apex Class: Helper', 'Flow: Route'], next: NEXT_LOOK }),
    row('Production', { look: WHERE_LOOK.unknown, at: null, detail: 'This machine has no access to Production.', readAt: null }),
  ],
  pick: { label: 'Deploy…', disabled: null, choices: [
    { to: 'uat', name: 'UAT', org: 'acme-uat', then: 'An agent deploys it', disabled: null },
    { to: 'production', name: 'Production', org: 'acme-prod', then: 'An agent deploys it after you type Production\'s name', disabled: null },
  ] },
  status: null, needs: null, ...more,
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

test('a row for each environment in path order, each with its state as an icon and a label, and when it was read; one is next (T-158)', async () => {
  setup();
  const { renderDeploy } = await import('../webview/changes.ts');
  const drawn = renderDeploy(model(), deploy()) as unknown as PageElement;
  const rows = drawn.all('dp-row');
  assert.deepEqual(rows.map((r) => r.dataset.env), ['dev', 'qa', 'uat', 'production']);
  assert.deepEqual(rows.map((r) => r.all('dp-state')[0]!.textContent.replace(/\d.*$/, '')), ['Deployed', 'Deployed', 'Partly deployed', 'Can\'t tell']);
  assert.equal(rows.filter((r) => r.all('dp-state')[0]!.querySelector('.codicon')).length, 4, 'each state has its icon');
  assert.deepEqual(rows.map((r) => r.all('dp-read')[0]!.textContent.replace(/Check again$/, '').replace(/^Read .*/, 'Read')), ['Read', 'Read', 'Read', 'Not read yet']);
  assert.deepEqual(rows.map((r) => /Next/.test(r.all('dp-row-head')[0]!.textContent)), [false, false, true, false], 'one environment is next');
  assert.equal(rows[0]!.all('dp-merged')[0]?.textContent, 'Merged into dev', 'the development environment says it is merged');
  assert.equal(rows[3]!.all('dp-detail')[0]?.textContent, 'This machine has no access to Production.', 'can\'t tell, and why');
});

test('a partly deployed row opens on the components that differ, and stays open as the page redraws (T-158)', async () => {
  setup();
  const { renderDeploy } = await import('../webview/changes.ts');
  const uat = (): PageElement => (renderDeploy(model(), deploy()) as unknown as PageElement).all('dp-row')[2]!;
  const fold = buttons([uat()]).find((b) => b.textContent === '2 components differ')!;
  assert.equal(fold.getAttribute('aria-expanded'), 'false');
  assert.equal(uat().all('dp-differs').length, 0, 'closed to start');
  fold.click();
  assert.deepEqual(uat().all('dp-differs')[0]!.all('chg-name').map((x) => x.textContent), ['Apex Class: Helper', 'Flow: Route']);
  // Edge: a deployed row has nothing to open.
  assert.equal(buttons([(renderDeploy(model(), deploy()) as unknown as PageElement).all('dp-row')[1]!]).filter((b) => b.classList.contains('dp-differs-btn')).length, 0);
});

test('Check again reads its own row\'s environment alone; while that row reads, its button waits and sends nothing, and the others stay on (T-158)', async () => {
  const page = setup();
  const { renderDeploy } = await import('../webview/changes.ts');
  const again = (d: TicketDeploy): PageElement[] => buttons([renderDeploy(model(), d) as unknown as PageElement]).filter((b) => b.classList.contains('dp-again'));
  again(deploy())[1]!.click();
  assert.deepEqual(page.sent, [{ type: 'where-check', project: '/r', task: 'ACME-7', env: 'qa' }], 'QA\'s button reads QA');
  page.sent.length = 0;
  const reading = deploy();
  reading.rows[1] = { ...reading.rows[1]!, reading: true };
  const busy = again(reading);
  assert.deepEqual(busy.map((b) => [b.textContent, b.disabled]), [['Check again', false], ['Checking…', true], ['Check again', false], ['Check again', false]], 'edge case: a read of one row under way');
  busy[1]!.click();
  assert.deepEqual(page.sent, []);
});

test('Deploy… is the one primary button: it asks where, each choice says what happens next, and the pick starts the agent, never a direct deploy (T-158)', async () => {
  const page = setup();
  const { renderDeploy } = await import('../webview/changes.ts');
  const draw = (): PageElement => renderDeploy(model(), deploy()) as unknown as PageElement;
  const go = buttons([draw()]).find((b) => b.classList.contains('dp-go'))!;
  assert.deepEqual([go.textContent, go.classList.contains('primary'), go.getAttribute('aria-expanded')], ['Deploy…', true, 'false']);
  assert.equal(buttons([draw()]).filter((b) => b.classList.contains('primary')).length, 1, 'the one primary button');
  assert.ok(!buttons([draw()]).some((b) => /^Deploy to |^Deploy with an agent$|^Other next steps$/.test(b.textContent)), 'no direct deploy, no second agent button, no other next steps');
  go.click();
  assert.deepEqual(page.sent, [], 'opening the pick sends nothing');
  const open = draw();
  const choices = open.all('dp-choice');
  assert.deepEqual(choices.map((c) => c.all('dp-then')[0]!.textContent), ['An agent deploys it', 'An agent deploys it after you type Production\'s name']);
  assert.equal(open.all('dp-pick')[0]!.getAttribute('aria-label'), 'Where to deploy');
  choices[1]!.click();
  assert.deepEqual(page.sent, [{ type: 'deploy-guide', project: '/r', task: 'ACME-7', to: 'production' }], 'the pick starts the agent there, and nothing else');
  assert.equal(draw().all('dp-pick').length, 0, 'the pick closes');
});

test('edge case: Deploy… off says why, beside it and in its title, and opens nothing; a choice off says why in it and sends nothing (T-158)', async () => {
  const page = setup();
  const { renderDeploy } = await import('../webview/changes.ts');
  const why = 'The validate check failed: fix it, or accept it anyway, first.';
  const off = deploy({ pick: { ...deploy().pick!, disabled: why } });
  const drawn = renderDeploy(model(), off) as unknown as PageElement;
  const go = buttons([drawn]).find((b) => b.classList.contains('dp-go'))!;
  assert.deepEqual([go.disabled, go.title.endsWith(why), go.getAttribute('aria-description')], [true, true, why]);
  assert.equal(drawn.querySelector('.dp-why')?.textContent, why);
  go.click();
  assert.equal((renderDeploy(model(), off) as unknown as PageElement).all('dp-pick').length, 0);
  // One choice off: the pick opens, and that choice says why in it.
  const one = deploy({ pick: { ...deploy().pick!, choices: [{ to: 'uat', name: 'UAT', org: 'acme-uat', then: 'An agent deploys it', disabled: 'It depends on ACME-3, which isn\'t in UAT yet.' }] } });
  buttons([renderDeploy(model(), one) as unknown as PageElement]).find((b) => b.classList.contains('dp-go'))!.click();
  const choice = (renderDeploy(model(), one) as unknown as PageElement).all('dp-choice')[0]!;
  assert.deepEqual([choice.disabled, choice.all('dp-then')[0]!.textContent], [true, 'It depends on ACME-3, which isn\'t in UAT yet.']);
  choice.click();
  assert.deepEqual(page.sent, []);
  // Under way: the row and the tab say what the agent is on.
  const busy = renderDeploy(model(), deploy({ rows: [row('UAT', { busy: BUSY_LOOK })], status: { look: BUSY_LOOK, words: 'An agent is deploying ACME-7 to UAT.' } })) as unknown as PageElement;
  assert.deepEqual([busy.querySelector('.dp-status')!.textContent, busy.querySelector('.dp-busy')!.textContent], ['An agent is deploying ACME-7 to UAT.', 'An agent is deploying it']);
});

test('the tab: the list, record changes in words, the deploy, the steps left with Mark done and Skip, and More closed holding what moved (T-138)', async () => {
  setup();
  const { renderChangesTab } = await import('../webview/changes.ts');
  const moved = Object.assign(document.createElement('section'), { className: 'moved-part' }) as unknown as HTMLElement;
  const out = renderChangesTab(model({ records: records(2) }), [moved]) as unknown as PageElement[];
  assert.deepEqual(out.map((e) => e.className), ['block dp', 'block chg chg-records', 'block chg dp-left', 'chg-more']);
  assert.match(out[1]!.textContent, /^Record changesMade, plannedUpdate Account Acme$/);
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

test('the tab needs the person for the steps left, never for the manifest\'s or the field\'s state (T-138, T-158)', async () => {
  const { changesNeeds, taskTabs } = await import('../webview/tab-rules.ts');
  assert.equal(changesNeeds(model()), null);
  assert.equal(changesNeeds(model({ records: records(2), deploy: deploy({ needs: '2 steps to do by hand' }) })), '2 steps to do by hand', 'the steps left, as the model counts them');
  assert.equal(changesNeeds(model({ records: records(2), deploy: null })), null, 'outside Salesforce there\'s no deploy to wait on');
  const orange = { label: 'The org differs', icon: 'diff', tone: 'orange' as const };
  const tabs = taskTabs({ ...model(), comments: [], updates: [], analysis: null, criteria: null, acc: null, review: null, verify: null, manifest: { look: orange }, field: { look: orange } } as unknown as TicketModel);
  assert.deepEqual(tabs.find((t) => t.id === 'changes')?.needs, null, 'the manifest\'s state waits under More');
});

test('edge case: the steps left draw only the steps given, each still to do with its two buttons, and none when given none (T-138)', async () => {
  setup();
  const { renderSteps } = await import('../webview/record-changes.ts');
  const r = records(1);
  const one = renderSteps(model(), r, r.promotions[0]!.steps.filter((s) => s.done)) as unknown as PageElement;
  assert.deepEqual(buttons([one]).map((b) => b.textContent), ['Mark done', 'Skip']);
  assert.equal((renderSteps(model(), r, []) as unknown as PageElement).all().length, 0);
});
