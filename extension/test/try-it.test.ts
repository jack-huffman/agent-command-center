// Try it in the org (T-161): once a builder's deploy to the ticket's development org passed, the ticket opens that
// org, each component at its own page, and shows how to test it; off with why where the org isn't in the settings
// or this machine isn't logged in to it. The model, the open as the extension runs it, and the page's drawing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Config } from '../../packages/core/src/config.ts';
import type { TaskDeploy } from '../../packages/core/src/deploy-gate.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import { PRODUCTION_NOT_HERE } from '../../packages/core/src/sf-discovery.ts';
import { openPlan, orgNotHere, runOpen, type SfRun } from '../src/logic/org-open.ts';
import type { DoctorItem } from '../src/logic/setup.ts';
import type { TicketAcc, TicketModel } from '../src/model/task-page.ts';
import { area, BUILT_STATES, orgOff, passedDeploy, tryComponents, tryIt, type TryIt } from '../src/model/try-it.ts';
import { pageDom, type PageElement } from './page-dom.ts';

const D = 'force-app/main/default';
const ENVS = [
  { name: 'Dev', branch: 'dev', org: 'acme-dev', type: 'sandbox', promotesTo: ['qa'], default: true, protected: false },
  { name: 'QA', branch: 'qa', org: 'acme-qa', type: 'sandbox', promotesTo: [], default: false, protected: false },
] as unknown as Config['environments'];
const CONFIG = { profile: 'salesforce', environments: ENVS } as Pick<Config, 'profile' | 'environments'>;
const deploy = (more: Partial<TaskDeploy> = {}): TaskDeploy => ({
  env: 'dev', org: 'acme-dev', sha: 'abc', at: '2026-10-30T10:00:00.000Z', jobId: '0Af', verified: 3, components: [],
  paths: [`${D}/objects/Contact/fields/Job_Title__c.field-meta.xml`, `${D}/flows/Contact_Job_History.flow-meta.xml`, `${D}/classes/JobService.cls`, `${D}/classes/JobService.cls-meta.xml`, 'manifest/notes.txt'],
  tests: { names: ['JobServiceTest'], outcome: 'pass', ran: 2, failed: 0, coverage: '91%' }, ...more,
} as TaskDeploy);
const task = (more: Partial<Task> = {}): Task => ({
  id: 'ACME-7', environment: 'dev', state: 'review', deploys: [deploy()],
  run: { branch: 'task/ACME-7', note: { landed: ['A'], moved: [], open: [], test: ['Open a Contact.', 'The Job Title field shows.'], at: '2026-10-30T11:00:00.000Z', by: 'builder:ACME-7', ended: 'review' } },
  ...more,
} as Task);

test('once its builder\'s deploy to its development org passed, the ticket opens that org, lists each component once with where it opens, and shows how to test it (T-161)', () => {
  const t = tryIt(CONFIG, task())!;
  assert.deepEqual([t.env, t.name, t.org, t.at, t.open, t.built], ['dev', 'Dev', 'acme-dev', '2026-10-30T10:00:00.000Z', { label: 'Open Dev', disabled: null }, true]);
  assert.deepEqual(t.components.map((c) => [c.label, c.name, c.where]), [
    ['Custom Field', 'Contact.Job_Title__c', 'Object Manager'],
    ['Flow', 'Contact_Job_History', 'Flow Builder'],
    ['Apex Class', 'JobService', 'its Setup page'],
    ['File', 'manifest/notes.txt', 'Setup'],
  ], 'a class and its -meta.xml are one component; a path the profile can\'t name opens Setup');
  assert.deepEqual(t.howTo, ['Open a Contact.', 'The Job Title field shows.']);
});

test('edge case: no Try it outside Salesforce, before a deploy, after one whose tests failed, or for a person\'s deploy elsewhere (T-161)', () => {
  assert.equal(tryIt({ ...CONFIG, profile: 'generic' }, task()), null);
  assert.equal(tryIt(CONFIG, task({ deploys: [] })), null);
  assert.equal(tryIt(CONFIG, task({ deploys: undefined })), null);
  assert.equal(tryIt(CONFIG, task({ deploys: [deploy({ tests: { names: ['T'], outcome: 'fail', ran: 1, failed: 1, coverage: null } })] })), null);
  assert.equal(tryIt(CONFIG, task({ deploys: [deploy({ env: 'qa', org: 'acme-qa', by: 'human:jordan' })] })), null);
  // The latest of its builder's deploys counts: a later one that failed takes Try it away again.
  assert.equal(passedDeploy(task({ deploys: [deploy(), deploy({ at: '2026-10-30T12:00:00.000Z', tests: { names: [], outcome: 'fail', ran: 1, failed: 1, coverage: null } })] })), null);
  // A deploy with no tests to run (no Apex) passed.
  assert.ok(passedDeploy(task({ deploys: [deploy({ tests: null })] })));
});

test('edge case: Open is off with why where the settings name no org, or the last Setup check says this machine isn\'t logged in to it (T-161)', () => {
  const none = tryIt({ ...CONFIG, environments: ENVS.map((e) => (e.branch === 'dev' ? { ...e, org: null } : e)) as Config['environments'] }, task())!;
  assert.equal(none.open.disabled, 'Dev has no org in the project\'s settings.');
  assert.equal(tryIt(CONFIG, task(), (b) => b === 'dev')!.open.disabled, 'This machine isn\'t logged in to acme-dev. Log in to it from Setup.');
  assert.equal(orgOff({ name: 'Dev', org: 'acme-dev' }, false), null);
});

test('edge case: no How to test it where the builder gave none, and the Agent panel offers it only once the build is done (T-161)', () => {
  assert.deepEqual(tryIt(CONFIG, task({ run: { branch: 'task/ACME-7' } }))!.howTo, []);
  assert.deepEqual(BUILT_STATES, ['review', 'done']);
  assert.equal(tryIt(CONFIG, task({ state: 'running' }))!.built, false);
  assert.equal(tryIt(CONFIG, task({ state: 'done' }))!.built, true);
  assert.deepEqual(tryComponents([]), []);
});

test('the page\'s message names the task, and a component by its path; anything else is refused (T-161)', () => {
  const ok = area.messages!['org-open']!;
  assert.equal(ok({ project: '/r', task: 'ACME-7' }), true);
  assert.equal(ok({ project: '/r', task: 'ACME-7', path: `${D}/flows/X.flow-meta.xml` }), true);
  assert.equal(ok({ project: '/r', task: 'not a key' }), false);
  assert.equal(ok({ project: '/r', task: 'ACME-7', path: '' }), false);
  assert.equal(ok({ project: '/r', task: 'ACME-7', path: 7 }), false);
});

// ---------------------------------------------------------------- the open, as the extension runs it

const B6 = (detail: string): DoctorItem => ({ id: 'B6.org-match', detail } as DoctorItem);

test('edge case: this machine isn\'t logged in to an org where the last Setup check, in this project, said so; before that check, it isn\'t known (T-161)', () => {
  const notHere = orgNotHere([B6('"acme-dev" isn\'t logged in (No authorization found). "acme-qa" is the "uat" sandbox.')], '/r/sub', () => ({ root: '/r' }));
  assert.equal(notHere('/r', { branch: 'dev', org: 'acme-dev' }), true);
  assert.equal(notHere('/r', { branch: 'qa', org: 'acme-qa' }), false, 'a wrong org is logged in');
  assert.equal(notHere('/other', { branch: 'dev', org: 'acme-dev' }), false, 'another project\'s check says nothing of this one');
  assert.equal(orgNotHere([], '/r', () => ({ root: '/r' }))('/r', { branch: 'dev', org: 'acme-dev' }), false, 'no check yet');
  assert.equal(orgNotHere([B6(`main: ${PRODUCTION_NOT_HERE}`)], '/r', () => ({ root: '/r' }))('/r', { branch: 'main', org: null }), true, 'Production by its branch');
});

test('an open is checked against the ticket now: the org\'s home, or a component the builder deployed; anything else is refused with why (T-161)', () => {
  const home = openPlan(CONFIG, task(), undefined, () => false);
  assert.deepEqual(home, { ok: true, org: 'acme-dev', title: 'Open Dev', open: null });
  const flow = openPlan(CONFIG, task(), `${D}/flows/Contact_Job_History.flow-meta.xml`, () => false);
  assert.ok(flow.ok && flow.open?.kind === 'lookup' && flow.title === 'Open Contact_Job_History in Dev');
  const other = openPlan(CONFIG, task(), 'manifest/notes.txt', () => false);
  assert.ok(other.ok && other.open?.kind === 'page' && other.open.page === '/lightning/setup/SetupOneHome/home', 'a path with no known page opens Setup');
  assert.deepEqual(openPlan(CONFIG, task(), `${D}/classes/Other.cls`, () => false), { ok: false, why: `${D}/classes/Other.cls isn't one of the components ACME-7's builder deployed.` });
  assert.deepEqual(openPlan(CONFIG, task({ deploys: [] }), undefined, () => false), { ok: false, why: 'ACME-7 has no deploy by its builder to its environment that passed.' });
  assert.deepEqual(openPlan(CONFIG, task(), undefined, () => true), { ok: false, why: 'This machine isn\'t logged in to acme-dev. Log in to it from Setup.' });
});

/** A fake sf: each call's arguments, and its answers in turn. */
function fakeSf(...answers: SfRun[]): { calls: string[][]; sf: (args: string[]) => Promise<SfRun> } {
  const calls: string[][] = [];
  return { calls, sf: async (args) => { calls.push(args); return answers.shift() ?? { code: 0, stdout: '', stderr: '' }; } };
}

test('a component whose page needs its id asks the org for it, then opens its page; where the org has none, its list (T-161)', async () => {
  const plan = openPlan(CONFIG, task(), `${D}/flows/Contact_Job_History.flow-meta.xml`, () => false);
  assert.ok(plan.ok);
  const found = fakeSf({ code: 0, stdout: JSON.stringify({ result: { records: [{ Id: '300000000000001AAA' }] } }), stderr: '' });
  assert.equal(await runOpen(found.sf, plan), null);
  assert.equal(found.calls.length, 2);
  assert.deepEqual(found.calls[0]!.slice(0, 3), ['data', 'query', '--use-tooling-api']);
  assert.deepEqual(found.calls[1], ['org', 'open', '--target-org', 'acme-dev', '--path', '/builder_platform_interaction/flowBuilder.app?flowDefId=300000000000001AAA']);
  const none = fakeSf({ code: 0, stdout: JSON.stringify({ result: { records: [] } }), stderr: '' });
  assert.equal(await runOpen(none.sf, plan), null);
  assert.deepEqual(none.calls[1], ['org', 'open', '--target-org', 'acme-dev', '--path', '/lightning/setup/Flows/home'], 'edge case: no id found');
  // A field's page needs no id: one call.
  const field = openPlan(CONFIG, task(), `${D}/objects/Contact/fields/Job_Title__c.field-meta.xml`, () => false);
  assert.ok(field.ok);
  const one = fakeSf();
  await runOpen(one.sf, field);
  assert.deepEqual(one.calls, [['org', 'open', '--target-org', 'acme-dev', '--path', '/lightning/setup/ObjectManager/Contact/FieldsAndRelationships/view']]);
  // The org's home: no page.
  const home = fakeSf();
  await runOpen(home.sf, openPlan(CONFIG, task(), undefined, () => false) as Extract<ReturnType<typeof openPlan>, { ok: true }>);
  assert.deepEqual(home.calls, [['org', 'open', '--target-org', 'acme-dev']]);
});

test('edge case: an open that fails says so, with what sf said (T-161)', async () => {
  const failed = fakeSf({ code: 1, stdout: '', stderr: '\nNo authorization information found for acme-dev.\n' });
  assert.equal(await runOpen(failed.sf, openPlan(CONFIG, task(), undefined, () => false) as Extract<ReturnType<typeof openPlan>, { ok: true }>), 'acme-dev didn\'t open: No authorization information found for acme-dev.');
  const silent = fakeSf({ code: 2, stdout: '', stderr: '' });
  assert.equal(await runOpen(silent.sf, openPlan(CONFIG, task(), undefined, () => false) as Extract<ReturnType<typeof openPlan>, { ok: true }>), 'acme-dev didn\'t open: sf exited with 2');
});

// ---------------------------------------------------------------- the page

const sent: unknown[] = [];
let kept: unknown;
function setup(): void {
  pageDom();
  sent.length = 0;
  (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (x: unknown) => sent.push(x), getState: () => kept, setState: (s: unknown) => { kept = s; } });
}
const all = (e: PageElement): PageElement[] => [e, ...e.all()];
const buttons = (e: PageElement): PageElement[] => all(e).filter((x) => x.tagName === 'BUTTON');
const shown = (more: Partial<TryIt> = {}): TryIt => ({ ...tryIt(CONFIG, task())!, ...more });

test('the page draws Open, How to test it as numbered steps, and an Open for each component that sends its path (T-161)', async () => {
  setup();
  const { renderTryIt } = await import('../webview/try-it.ts');
  const drawn = renderTryIt({ project: '/r' }, shown()) as unknown as PageElement;
  const bs = buttons(drawn);
  assert.equal(bs[0]!.textContent, 'Open Dev');
  bs[0]!.click();
  assert.deepEqual(sent, [{ type: 'org-open', project: '/r', task: 'ACME-7' }]);
  assert.deepEqual(drawn.all('try-steps')[0]!.children.map((c) => (c as PageElement).textContent), ['Open a Contact.', 'The Job Title field shows.']);
  const comps = drawn.all('try-comp-open');
  assert.equal(comps.length, 4);
  assert.equal(comps[1]!.getAttribute('aria-label'), 'Open Contact_Job_History in Flow Builder');
  comps[1]!.click();
  assert.deepEqual(sent[1], { type: 'org-open', project: '/r', task: 'ACME-7', path: `${D}/flows/Contact_Job_History.flow-meta.xml` });
});

test('edge case: off, Open and each component say why, beside it and in their titles, and send nothing; no steps says so (T-161)', async () => {
  setup();
  const { renderTryIt } = await import('../webview/try-it.ts');
  const why = 'This machine isn\'t logged in to acme-dev. Log in to it from Setup.';
  const drawn = renderTryIt({ project: '/r' }, shown({ open: { label: 'Open Dev', disabled: why }, howTo: [] })) as unknown as PageElement;
  const bs = buttons(drawn);
  assert.ok(bs.every((b) => b.disabled), 'every Open is off');
  assert.deepEqual([bs[0]!.title, bs[0]!.getAttribute('aria-description')], [`Open Dev: ${why}`, why]);
  assert.equal(drawn.all('try-why')[0]!.textContent, why);
  for (const b of bs) b.click();
  assert.deepEqual(sent, []);
  assert.equal(drawn.all('try-none')[0]!.textContent, 'Its builder gave no steps. Check its note.');
});

test('the Changes tab draws Try it on the development environment\'s row alone, and the Agent panel draws it, without the components, once the build is done (T-161)', async () => {
  setup();
  const { renderDeploy } = await import('../webview/changes.ts');
  const { renderAgentPanel } = await import('../webview/agent-panel.ts');
  const look = { label: 'Deployed', icon: 'pass', tone: 'blue' as const };
  const row = (name: string) => ({ name, branch: name.toLowerCase(), org: `acme-${name.toLowerCase()}`, look, at: null, detail: null, differs: [], notes: [], readAt: null, merged: null, next: null, busy: null, reading: false });
  const m = { project: '/r', key: 'ACME-7', tryIt: shown() } as unknown as TicketModel;
  const tab = renderDeploy(m, { task: 'ACME-7', rows: [row('Dev'), row('QA')], pick: null, status: null, needs: null }) as unknown as PageElement;
  assert.deepEqual(tab.all('dp-row').map((r) => r.all('try').length), [1, 0]);
  const acc = { look: { label: 'In review', icon: 'eye', tone: 'blue' }, state: 'review', checks: [], actions: [], waitingOn: [], blocker: null } as unknown as TicketAcc;
  const panel = renderAgentPanel(m, acc, () => {}) as unknown as PageElement;
  assert.equal(panel.all('try').length, 1);
  assert.equal(panel.all('try-comps').length, 0, 'the components are on the Changes tab');
  assert.equal(panel.all('try-steps').length, 1);
  // Edge: a build still under way has no Try it in the panel.
  const busy = renderAgentPanel({ ...m, tryIt: shown({ built: false }) } as unknown as TicketModel, { ...acc, state: 'running' } as TicketAcc, () => {}) as unknown as PageElement;
  assert.equal(busy.all('try').length, 0);
});
