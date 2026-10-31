// The ticket's Testing tab (T-161): once a builder's deploy to the ticket's development org passed, one line of where
// the work is, Open <environment>, and its builder's steps, numbered, a step that names one component with a link to
// its page; before that deploy, why the tab is empty. Open is off with why where the org isn't in the settings or
// this machine isn't logged in to it. The model, the open as the extension runs it, and the page's drawing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Config } from '../../packages/core/src/config.ts';
import type { TaskDeploy } from '../../packages/core/src/deploy-gate.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import { PRODUCTION_NOT_HERE } from '../../packages/core/src/sf-discovery.ts';
import { SETUP_HOME } from '../../packages/core/src/sf-org-pages.ts';
import { openPlan, orgNotHere, runOpen, type SfRun } from '../src/logic/org-open.ts';
import type { DoctorItem } from '../src/logic/setup.ts';
import type { TicketAcc, TicketModel } from '../src/model/task-page.ts';
import { area, BUILT_STATES, orgOff, passedDeploy, stepComponent, testComponents, testing, type Testing, testsWords } from '../src/model/testing.ts';
import { pageDom, type PageElement } from './page-dom.ts';

const D = 'force-app/main/default';
const ENVS = [
  { name: 'Dev', branch: 'dev', org: 'acme-dev', type: 'sandbox', promotesTo: ['qa'], default: true, protected: false },
  { name: 'QA', branch: 'qa', org: 'acme-qa', type: 'sandbox', promotesTo: [], default: false, protected: false },
] as unknown as Config['environments'];
const CONFIG = { profile: 'salesforce', environments: ENVS } as Pick<Config, 'profile' | 'environments'>;
const FIELD = `${D}/objects/Contact/fields/Job_Title__c.field-meta.xml`;
const FLOW = `${D}/flows/Contact_Job_History.flow-meta.xml`;
const deploy = (more: Partial<TaskDeploy> = {}): TaskDeploy => ({
  env: 'dev', org: 'acme-dev', sha: 'abc', at: '2026-10-30T10:00:00.000Z', jobId: '0Af', verified: 3, components: [],
  paths: [FIELD, FLOW, `${D}/classes/JobService.cls`, `${D}/classes/JobService.cls-meta.xml`, `${D}/objects/Contact/Contact.object-meta.xml`, 'manifest/notes.txt'],
  tests: { names: ['JobServiceTest'], outcome: 'pass', ran: 2, failed: 0, coverage: '91%' }, ...more,
} as TaskDeploy);
const STEPS = ['Open the Job_Title__c field and check its help text.', 'Open any record of that object and type a job title.', 'Open Contact_Job_History and check that it ran.'];
const task = (more: Partial<Task> = {}): Task => ({
  id: 'ACME-7', environment: 'dev', state: 'review', deploys: [deploy()],
  run: { branch: 'task/ACME-7', note: { landed: ['A'], moved: [], open: [], test: STEPS, at: '2026-10-30T11:00:00.000Z', by: 'builder:ACME-7', ended: 'review' } },
  ...more,
} as Task);

test('once its builder\'s deploy to its development org passed, the tab says where the work is, opens that org, and gives the steps in order (T-161)', () => {
  const t = testing(CONFIG, task())!;
  assert.deepEqual([t.env, t.name, t.org, t.built], ['dev', 'Dev', 'acme-dev', true]);
  const r = t.ready!;
  assert.deepEqual([r.at, r.tests, r.open], ['2026-10-30T10:00:00.000Z', 'tests passed, 91% coverage', { label: 'Open Dev', disabled: null }]);
  assert.deepEqual(r.steps.map((s) => s.text), STEPS);
  assert.deepEqual(r.steps.map((s) => s.link?.name ?? null), ['Contact.Job_Title__c', null, 'Contact_Job_History']);
  assert.deepEqual(r.steps[0]!.link, { name: 'Contact.Job_Title__c', where: 'Object Manager', path: FIELD });
  assert.equal(r.steps[2]!.link!.where, 'Flow Builder');
});

test('edge case: before its builder\'s deploy passed, the tab has nothing ready; outside Salesforce, or with no environment, there is no tab (T-161)', () => {
  assert.equal(testing({ ...CONFIG, profile: 'generic' }, task()), null);
  assert.equal(testing(CONFIG, task({ environment: 'gone' })), null, 'an environment the settings don\'t name');
  for (const deploys of [[], undefined, [deploy({ tests: { names: ['T'], outcome: 'fail', ran: 1, failed: 1, coverage: null } })], [deploy({ env: 'qa', org: 'acme-qa' })]]) {
    const t = testing(CONFIG, task({ deploys, state: 'running' }))!;
    assert.deepEqual([t.name, t.ready, t.built], ['Dev', null, false]);
  }
  // A person's deploy to the development org itself isn't the builder's: nothing ready from it (the !d.by guard).
  assert.equal(passedDeploy(task({ deploys: [deploy({ by: 'human:jordan' })] })), null);
  assert.equal(testing(CONFIG, task({ deploys: [deploy({ by: 'human:jordan' })] }))!.ready, null);
  // The latest of its builder's deploys counts: a later one that failed takes it away again.
  assert.equal(passedDeploy(task({ deploys: [deploy(), deploy({ at: '2026-10-30T12:00:00.000Z', tests: { names: [], outcome: 'fail', ran: 1, failed: 1, coverage: null } })] })), null);
  // A deploy with no tests to run (no Apex) passed, and says so.
  assert.ok(passedDeploy(task({ deploys: [deploy({ tests: null })] })));
  assert.equal(testing(CONFIG, task({ deploys: [deploy({ tests: null })] }))!.ready!.tests, 'no Apex tests ran');
});

test('edge case: the one line says the tests as they ran: with coverage, without it, and none (T-161)', () => {
  assert.equal(testsWords({ names: [], outcome: 'pass', ran: 1, failed: 0, coverage: '88%' }), 'tests passed, 88% coverage');
  assert.equal(testsWords({ names: [], outcome: 'pass', ran: 1, failed: 0, coverage: null }), 'tests passed');
  assert.equal(testsWords({ names: [], outcome: 'fail', ran: 1, failed: 1, coverage: null }), 'tests failed');
  assert.equal(testsWords(null), 'no Apex tests ran');
});

test('edge case: Open is off with why where the settings name no org, or the last Setup check says this machine isn\'t logged in to it (T-161)', () => {
  const none = testing({ ...CONFIG, environments: ENVS.map((e) => (e.branch === 'dev' ? { ...e, org: null } : e)) as Config['environments'] }, task())!;
  assert.equal(none.ready!.open.disabled, 'Dev has no org in the project\'s settings.');
  assert.equal(testing(CONFIG, task(), (b) => b === 'dev')!.ready!.open.disabled, 'This machine isn\'t logged in to acme-dev. Log in to it from Setup.');
  assert.equal(orgOff({ name: 'Dev', org: 'acme-dev' }, false), null);
});

test('edge case: a step links only the one component it names: none, two, a name inside a longer one, or one not deployed get no link (T-161)', () => {
  const cs = testComponents(deploy().paths);
  assert.deepEqual(cs.map((c) => c.name), ['Contact.Job_Title__c', 'Contact_Job_History', 'JobService', 'Contact', 'manifest/notes.txt'], 'a class and its -meta.xml are one component');
  assert.equal(stepComponent('Open a record and type a title.', cs), null, 'a step that names no component has no link');
  assert.equal(stepComponent('Open JobService and Contact_Job_History.', cs), null, 'two components: no link');
  assert.equal(stepComponent('Open Other_Flow and check it.', cs), null, 'a component it didn\'t deploy');
  assert.equal(stepComponent('Open JobServiceTest.', cs), null, 'a longer name isn\'t the class');
  assert.equal(stepComponent('Open JobService.', cs)?.name, 'JobService');
  assert.equal(stepComponent('Open Contact.Job_Title__c.', cs)?.name, 'Contact.Job_Title__c', 'the object inside the field\'s name isn\'t named on its own');
  assert.equal(stepComponent('Open the Contact object.', cs)?.name, 'Contact');
  assert.equal(stepComponent('Open Contact and its Job_Title__c field.', cs), null, 'the object and the field: two');
  assert.deepEqual(testComponents([]), []);
  assert.equal(stepComponent('Open JobService.', []), null);
});

test('edge case: no steps where the builder gave none, and the Agent panel links to the tab only once the build is done (T-161)', () => {
  assert.deepEqual(testing(CONFIG, task({ run: { branch: 'task/ACME-7' } }))!.ready!.steps, []);
  assert.deepEqual(BUILT_STATES, ['review', 'done']);
  assert.equal(testing(CONFIG, task({ state: 'running' }))!.built, false);
  assert.equal(testing(CONFIG, task({ state: 'done' }))!.built, true);
});

test('the page\'s message names the task, and a component by its path; anything else is refused (T-161)', () => {
  const ok = area.messages!['org-open']!;
  assert.equal(ok({ project: '/r', task: 'ACME-7' }), true);
  assert.equal(ok({ project: '/r', task: 'ACME-7', path: FLOW }), true);
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
  const flow = openPlan(CONFIG, task(), FLOW, () => false);
  assert.ok(flow.ok && flow.open?.kind === 'lookup' && flow.title === 'Open Contact_Job_History in Dev');
  const other = openPlan(CONFIG, task(), 'manifest/notes.txt', () => false);
  assert.ok(other.ok && other.open?.kind === 'page' && other.open.page === SETUP_HOME, 'a path with no known page opens Setup');
  assert.deepEqual(openPlan(CONFIG, task(), `${D}/classes/Other.cls`, () => false), { ok: false, why: `${D}/classes/Other.cls isn't one of the components ACME-7's builder deployed.` });
  assert.deepEqual(openPlan(CONFIG, task({ deploys: [] }), undefined, () => false), { ok: false, why: 'ACME-7 has no deploy by its builder to its environment that passed.' });
  assert.deepEqual(openPlan({ ...CONFIG, profile: 'generic' }, task(), undefined, () => false), { ok: false, why: 'ACME-7 has no deploy by its builder to its environment that passed.' }, 'edge case: no tab at all');
  assert.deepEqual(openPlan(CONFIG, task(), undefined, () => true), { ok: false, why: 'This machine isn\'t logged in to acme-dev. Log in to it from Setup.' });
});

/** A fake sf: each call's arguments, and its answers in turn. */
function fakeSf(...answers: SfRun[]): { calls: string[][]; sf: (args: string[]) => Promise<SfRun> } {
  const calls: string[][] = [];
  return { calls, sf: async (args) => { calls.push(args); return answers.shift() ?? { code: 0, stdout: '', stderr: '' }; } };
}

test('a component whose page needs its id asks the org for it, then opens its page; where the org has none, its list (T-161)', async () => {
  const plan = openPlan(CONFIG, task(), FLOW, () => false);
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
  const field = openPlan(CONFIG, task(), FIELD, () => false);
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

const page = pageDom();
const sent: unknown[] = [];
let kept: unknown;
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (x: unknown) => sent.push(x), getState: () => kept, setState: (s: unknown) => { kept = s; } });
const { renderTesting, testingLink, TESTING_ABOUT } = await import('../webview/testing.ts');
const all = (e: PageElement): PageElement[] => [e, ...e.all()];
const buttons = (e: PageElement): PageElement[] => all(e).filter((x) => x.tagName === 'BUTTON');
const shown = (more: Partial<Testing> = {}): Testing => ({ ...testing(CONFIG, task())!, ...more });

test('the tab draws one line of where the work is, one Open, and the numbered steps, a link only on a step that names one component (T-161)', () => {
  sent.length = 0;
  const drawn = renderTesting({ project: '/r' }, shown()) as unknown as PageElement;
  assert.match(drawn.all('test-where')[0]!.textContent, /^Deployed to Dev .*, tests passed, 91% coverage\.$/);
  const bs = buttons(drawn);
  assert.deepEqual(bs.map((b) => b.textContent), ['Open Dev', 'Open Contact.Job_Title__c', 'Open Contact_Job_History']);
  assert.ok(bs[0]!.classList.contains('primary'), 'one primary button');
  bs[0]!.click();
  assert.deepEqual(sent, [{ type: 'org-open', project: '/r', task: 'ACME-7' }]);
  const items = drawn.all('test-steps')[0]!.children as PageElement[];
  assert.equal(drawn.all('test-steps')[0]!.tagName, 'OL', 'numbered');
  assert.deepEqual(items.map((li) => li.all('test-link').length), [1, 0, 1], 'a step that names no component has no link');
  assert.equal(items[2]!.all('test-link')[0]!.getAttribute('aria-label'), 'Open Contact_Job_History in Flow Builder');
  items[2]!.all('test-link')[0]!.click();
  assert.deepEqual(sent[1], { type: 'org-open', project: '/r', task: 'ACME-7', path: FLOW });
  // Nothing else: no list of every component (the Changes tab lists the metadata).
  assert.equal(buttons(drawn).length, 3);
  assert.ok(!drawn.textContent.includes('JobService'), 'a component no step names isn\'t drawn');
});

test('edge case: off, Open and each step\'s link say why, beside it and in their titles, and send nothing; no steps says so (T-161)', () => {
  sent.length = 0;
  const why = 'This machine isn\'t logged in to acme-dev. Log in to it from Setup.';
  const off = shown();
  const drawn = renderTesting({ project: '/r' }, { ...off, ready: { ...off.ready!, open: { label: 'Open Dev', disabled: why } } }) as unknown as PageElement;
  const bs = buttons(drawn);
  assert.ok(bs.length === 3 && bs.every((b) => b.disabled), 'every Open is off');
  assert.deepEqual([bs[0]!.title, bs[0]!.getAttribute('aria-description')], [`Open Dev: ${why}`, why]);
  assert.equal(drawn.all('test-why')[0]!.textContent, why);
  for (const b of bs) b.click();
  assert.deepEqual(sent, []);
  const bare = renderTesting({ project: '/r' }, { ...off, ready: { ...off.ready!, steps: [] } }) as unknown as PageElement;
  assert.equal(bare.all('test-none')[0]!.textContent, 'Its builder gave no steps. Check its note.');
});

test('edge case: before the deploy passed, the tab says what it will hold and why it is empty, and how it differs from Verify (T-161)', () => {
  const drawn = renderTesting({ project: '/r' }, shown({ ready: null })) as unknown as PageElement;
  const text = drawn.all('test-empty')[0]!.textContent;
  assert.ok(text.startsWith('Nothing to test yet. Once its builder\'s deploy to Dev passes, this tab opens Dev and lists the steps'), text);
  assert.ok(text.endsWith(TESTING_ABOUT));
  assert.match(TESTING_ABOUT, /Testing is for trying the builder's work in its development org\. Verify is for checking a developer's pull request\./);
  assert.equal(buttons(drawn).length, 0);
  assert.equal(drawn.all('test-steps').length, 0);
});

test('the Changes tab has no component list, and the Agent panel\'s done state has one How to test it link that opens the Testing tab (T-161)', async () => {
  const { renderDeploy } = await import('../webview/changes.ts');
  const { renderAgentPanel } = await import('../webview/agent-panel.ts');
  const look = { label: 'Deployed', icon: 'pass', tone: 'blue' as const };
  const row = (name: string) => ({ name, branch: name.toLowerCase(), org: `acme-${name.toLowerCase()}`, look, at: null, by: null, detail: null, merged: null, next: null, busy: null, check: null, checkOff: null, checking: false });
  const m = { project: '/r', key: 'ACME-7', testing: shown() } as unknown as TicketModel;
  const tab = renderDeploy(m, { task: 'ACME-7', rows: [row('Dev'), row('QA')], pick: null, status: null, needs: null }) as unknown as PageElement;
  assert.ok(!buttons(tab).some((b) => /^Open /.test(b.textContent)), 'no Open on the Changes tab');
  const acc = { look: { label: 'In review', icon: 'eye', tone: 'blue' }, state: 'review', checks: [], actions: [], waitingOn: [], blocker: null, groups: [] } as unknown as TicketAcc;
  const panel = renderAgentPanel(m, acc, () => {}) as unknown as PageElement;
  const go = panel.all('test-go');
  assert.equal(go.length, 1);
  assert.equal(go[0]!.textContent, 'How to test it');
  assert.equal(panel.all('test-steps').length + panel.all('test-open').length, 0, 'the steps and Open are on the tab');
  let opened = 0;
  page.document.getElementById('task-tab-testing').addEventListener('click', () => { opened++; });
  go[0]!.click();
  assert.equal(opened, 1, 'it opens the Testing tab');
  assert.ok(testingLink().classList.contains('test-go-line'));
  // Edge: a build still under way, or one whose deploy hasn't passed, has no link.
  const busy = renderAgentPanel({ ...m, testing: shown({ built: false }) } as unknown as TicketModel, { ...acc, state: 'running' } as TicketAcc, () => {}) as unknown as PageElement;
  assert.equal(busy.all('test-go').length, 0);
  const before = renderAgentPanel({ ...m, testing: shown({ ready: null }) } as unknown as TicketModel, acc, () => {}) as unknown as PageElement;
  assert.equal(before.all('test-go').length, 0);
});

test('the Testing tab shows after Changes, counts its steps, and never needs the person (T-161)', async () => {
  const { taskTabs, NEEDS_FIRST } = await import('../webview/tab-rules.ts');
  const m = { comments: [], updates: [], analysis: null, talk: null, criteria: null, acc: null, changes: null, team: null, field: null, records: null, manifest: null, deploy: { needs: null }, review: null, verify: null, testing: shown() } as unknown as TicketModel;
  const tabs = taskTabs(m);
  assert.deepEqual(tabs.map((t) => t.id), ['ticket', 'changes', 'testing']);
  assert.deepEqual([tabs[2]!.count, tabs[2]!.needs], ['3', null]);
  assert.deepEqual([taskTabs({ ...m, testing: shown({ ready: null }) } as TicketModel)[2]!.count], [null], 'edge case: before the deploy, no count');
  assert.equal(NEEDS_FIRST.at(-1), 'testing');
});
