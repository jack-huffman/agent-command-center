// Record changes on a task's page (T-100): each change planned and recorded, with who and when and whether it
// was planned; "Add a change made by hand", which asks acc to keep it as the person's; and a promotion's
// steps, each with the commands that make it, Mark done, and Skip with a reason.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Task } from '../../packages/core/src/ledger.ts';
import { emptyOutside, type OutsideState } from '../../packages/core/src/outside-changes.ts';
import { parsePlannedRecords, type RecordChange } from '../../packages/core/src/records.ts';
import { PROCESSES } from '../src/logic/processes.ts';
import { area, RECORD_LOOK, recordArgs, RECORDS_DONE, type RecordsIn, stepArgs, ticketRecords } from '../src/model/record-changes.ts';
import { actOn, recordReply } from '../src/logic/record-changes.ts';
import { pageDom, type PageElement } from './page-dom.ts';

const rename: RecordChange = { object: 'Account', action: 'update', match: [{ field: 'Name', value: 'Acme Corp' }], fields: [{ field: 'Name', from: null, to: 'Acme Corporation' }] };
const region: RecordChange = { object: 'Region__c', action: 'create', match: [{ field: 'External_Id__c', value: 'EMEA-1' }], fields: [{ field: 'Name', from: null, to: 'EMEA' }] };
const at = '2026-10-22T10:00:00Z';

function outside(more: Partial<OutsideState> = {}): OutsideState {
  return {
    ...emptyOutside(),
    changes: [
      { id: 'c1', kind: 'record', detail: rename, why: 'The brand changed', planned: true, actor: 'builder', by: 'builder:ACME-7', at },
      { id: 'c2', kind: 'record', detail: { ...rename, match: [{ field: 'Name', value: 'Beta' }] }, why: 'Done in Setup', planned: false, actor: 'human', by: 'human:jordan', at },
    ],
    ...more,
  };
}
const input = (more: Partial<RecordsIn> = {}, task: Partial<Task> = {}): RecordsIn => ({
  task: { id: 'ACME-7', state: 'review', outside: outside(), promotions: [], ...task } as RecordsIn['task'],
  analysis: { recordChanges: parsePlannedRecords([{ ...rename, why: 'The brand changed' }, { ...region, why: 'The flow reads it' }, { ...rename, match: [{ field: 'Id', value: '001Dn00000AbCdE' }], why: 'w' }]) },
  profile: 'salesforce', environments: [{ branch: 'uat', name: 'UAT' }], ...more,
});

test('Record changes lists each recorded change, planned or not, then the plan\'s not made yet and one refused for its ID', () => {
  const r = ticketRecords(input())!;
  assert.deepEqual(r.rows.map((x) => [x.look.label, x.words, x.by]), [
    ['Made, planned', 'Account \'Acme Corp\': Name → \'Acme Corporation\'', 'builder:ACME-7'],
    ['Made, not in the plan', 'Account \'Beta\': Name → \'Acme Corporation\'', 'human:jordan'],
    ['Planned, not made yet', 'New Region__c External_Id__c \'EMEA-1\': Name → \'EMEA\'', null],
    ['Named by ID', 'Account Id \'001Dn00000AbCdE\': Name → \'Acme Corporation\'', null],
  ]);
  assert.match(r.rows[3]!.refused!, /different in every org/);
  assert.deepEqual([r.look, r.note, r.promotions], [RECORD_LOOK.kept, null, []]);
  assert.deepEqual(r.add, { label: 'Add a change made by hand', disabled: null });
});

test('edge case: a generic project has no section, and a Salesforce task with nothing yet says so', () => {
  assert.equal(ticketRecords(input({ profile: 'generic' })), null);
  const none = ticketRecords(input({ analysis: null }, { outside: undefined }))!;
  assert.deepEqual([none.look, none.rows], [RECORD_LOOK.none, []]);
  assert.match(none.note!, /No record changes yet/);
});

test('a promotion\'s steps show per environment with their commands, a step to do has Mark done and Skip, and the count left is said', () => {
  const steps = [
    { change: 'c1', env: 'uat', org: 'acme-uat', state: 'todo' as const, reason: null, by: null, at: null, added: at },
    { change: 'c2', env: 'uat', org: 'acme-uat', state: 'skipped' as const, reason: 'UAT has it', by: 'human:jordan', at, added: at },
  ];
  const r = ticketRecords(input({}, { state: 'done', outside: outside({ steps }), promotions: [{ from: 'dev', to: 'uat', pr: { number: 51, url: 'u' }, state: 'open', at }] }))!;
  assert.equal(r.look.label, '1 step to do');
  assert.equal(r.look.tone, 'orange');
  const [p] = r.promotions;
  assert.deepEqual([p!.name, p!.pr?.number, p!.left?.label], ['UAT', 51, '1 step not done']);
  assert.deepEqual(p!.steps.map((s) => [s.look.label, !!s.done, !!s.skip, s.reason]), [['To do', true, true, null], ['Skipped', false, false, 'UAT has it']]);
  assert.match(p!.steps[0]!.script.at(-1)!, /^sf data update record --target-org "acme-uat" --sobject Account --where "Name='Acme Corp'"/);
  const all = ticketRecords(input({}, { outside: outside({ steps: steps.map((s) => ({ ...s, state: 'done' as const })) }) }))!;
  assert.deepEqual([all.look, all.promotions[0]!.left], [RECORD_LOOK.kept, null], 'edge case: every step done leaves nothing to do');
});

test('the page\'s messages are checked: a change by hand needs an object, a key, and a why; a skip needs a reason', () => {
  const add = area.messages!['record-add']!;
  const ok = { project: '/r', task: 'ACME-7', object: 'Account', action: 'update', match: ['Name=Acme'], set: ['Name=B'], why: 'w' };
  assert.equal(add(ok), true);
  for (const bad of [{ object: ' ' }, { match: [] }, { match: ['no equals'] }, { why: '' }, { action: 'rename' }, { task: '../x' }]) assert.equal(add({ ...ok, ...bad }), false, JSON.stringify(bad));
  const step = area.messages!['record-step']!;
  assert.equal(step({ project: '/r', task: 'ACME-7', change: 'c1', env: 'uat', skip: null }), true);
  assert.equal(step({ project: '/r', task: 'ACME-7', change: 'c1', env: 'uat', skip: 'UAT has it' }), true);
  assert.equal(step({ project: '/r', task: 'ACME-7', change: 'c1', env: 'uat', skip: ' ' }), false, 'edge case: a skip with no reason');
  assert.equal(step({ project: '/r', task: 'ACME-7', change: 'x; rm', env: 'uat', skip: null }), false);
});

test('Add a change made by hand and a step\'s buttons ask acc as the person, and a refusal comes back whole', async () => {
  assert.deepEqual(recordArgs('ACME-7', { object: ' Account ', action: 'delete', match: ['Name=Acme'], set: [], why: ' gone ' }), ['change', 'record', 'ACME-7', '--object', 'Account', '--match', 'Name=Acme', '--delete', '--why', 'gone', '--json']);
  assert.deepEqual(stepArgs('ACME-7', 'c1', 'uat', null), ['change', 'step', 'ACME-7', 'c1', '--env', 'uat', '--done', '--json']);
  assert.deepEqual(stepArgs('ACME-7', 'c1', 'uat', ' UAT has it '), ['change', 'step', 'ACME-7', 'c1', '--env', 'uat', '--skip', 'UAT has it', '--json']);
  const calls: string[][] = [];
  const said = await actOn({ type: 'record-add', project: '/r', task: 'ACME-7', object: 'Account', action: 'update', match: ['Id=001Dn00000AbCdE'], set: ['Name=X'], why: 'w' }, async (args) => {
    calls.push(args);
    return { code: 1, stdout: JSON.stringify({ error: 'refused', message: 'That change can\'t be kept:\n- It names the record by its ID.' }), stderr: '' };
  });
  assert.deepEqual(said, { ok: false, error: 'That change can\'t be kept: It names the record by its ID.' });
  assert.equal(calls[0]![1], 'record');
  assert.deepEqual(recordReply({ code: 0, stdout: '{}', stderr: '' }), { ok: true });
  assert.deepEqual(await actOn({ type: 'record-step', project: '/r', task: 'ACME-7', change: 'c1', env: 'uat', skip: null }, async () => { throw new Error('acc didn\'t start'); }), { ok: false, error: 'The Command Center didn\'t start' }, 'edge case: acc fails to start');
});

test('the section draws on the page: Add opens the form, Save sends the change, and a step\'s Mark done and Skip send theirs', async () => {
  const page = pageDom();
  // The tab's memory, as VSCode keeps it, so the open form survives a redraw.
  let kept: unknown;
  (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { page.sent.push(m); }, getState: () => kept, setState: (s: unknown) => { kept = s; } });
  const { renderRecords, formOff, whoWords, FORM_KEY, SKIP_KEY } = await import('../webview/record-changes.ts');
  const { state } = await import('../webview/state.ts');
  const m = { project: '/r', key: 'ACME-7' } as never;
  const all = (e: PageElement): PageElement[] => [e, ...e.children.flatMap((c) => (typeof c === 'string' ? [] : all(c)))];
  const buttons = (e: PageElement) => all(e).filter((x) => x.tagName === 'BUTTON');
  const steps = [{ change: 'c1', env: 'uat', org: 'acme-uat', state: 'todo' as const, reason: null, by: null, at: null, added: at }];
  const r = ticketRecords(input({}, { state: 'done', outside: outside({ steps }) }))!;
  let drawn = 0;
  state.last = {} as never;
  state.draw = () => { drawn++; };
  const draw = () => renderRecords(m, r) as unknown as PageElement;
  let sec = draw();
  assert.match(sec.textContent, /Record changes.*1 step to do.*Made, planned.*By its builder.*Made, not in the plan.*By jordan.*Promoted to UAT.*sf data update record/s);
  assert.deepEqual(buttons(sec).map((b) => b.textContent), ['Mark done', 'Skip', 'Add a change made by hand']);
  // Add opens the form, kept in the tab's memory.
  buttons(sec).at(-1)!.click();
  assert.ok(drawn > 0);
  sec = draw();
  const save = buttons(sec).find((b) => b.textContent === 'Save the change')!;
  assert.equal(save.disabled, true, 'nothing typed yet');
  assert.equal(save.title, 'Name the object');
  const f = { object: 'Account', action: 'update' as const, match: ['Name=Acme Corp'], set: ['Name=Acme Corporation'], why: 'Done in Setup' };
  (kept as { drafts: Record<string, string> }).drafts[`${FORM_KEY}/r#ACME-7`] = JSON.stringify(f);
  sec = draw();
  buttons(sec).find((b) => b.textContent === 'Save the change')!.click();
  assert.deepEqual(page.sent.at(-1), { project: '/r', task: 'ACME-7', type: 'record-add', ...f });
  // acc's reply closes the form.
  const { area: pageArea } = await import('../webview/record-changes.ts');
  (pageArea.receive![RECORDS_DONE] as (m: unknown) => void)({ action: 'record-add', project: '/r', task: 'ACME-7', ok: true });
  assert.equal((kept as { drafts: Record<string, string> }).drafts[`${FORM_KEY}/r#ACME-7`], undefined);
  // Mark done sends the step; Skip opens its reason, and Skip it sends it.
  sec = draw();
  buttons(sec).find((b) => b.textContent === 'Mark done')!.click();
  assert.deepEqual(page.sent.at(-1), { project: '/r', task: 'ACME-7', type: 'record-step', change: 'c1', env: 'uat', skip: null });
  (pageArea.receive![RECORDS_DONE] as (m: unknown) => void)({ action: 'record-step', project: '/r', task: 'ACME-7', ok: false, error: 'No step for c1.' });
  sec = draw();
  assert.match(sec.textContent, /No step for c1\./, 'a refusal shows why');
  buttons(sec).find((b) => b.textContent === 'Skip')!.click();
  (kept as { drafts: Record<string, string> }).drafts[`${SKIP_KEY}/r#ACME-7`] = JSON.stringify({ step: 'uat:c1', reason: 'UAT has it' });
  sec = draw();
  buttons(sec).find((b) => b.textContent === 'Skip it')!.click();
  assert.deepEqual(page.sent.at(-1), { project: '/r', task: 'ACME-7', type: 'record-step', change: 'c1', env: 'uat', skip: 'UAT has it' });
  // Edge cases: what keeps Save off, and who a change reads as.
  assert.equal(formOff({ ...f, match: [] }), 'Say how to find the record');
  assert.equal(formOff({ ...f, why: ' ' }), 'Say why it was made');
  assert.equal(formOff({ ...f, set: [] }), 'Say what it set');
  assert.equal(formOff({ ...f, action: 'delete', set: [] }), null);
  assert.deepEqual([whoWords('builder:ACME-7'), whoWords('human:jordan')], ['its builder', 'jordan']);
});

test('the page draws Record changes under Verify, takes acc\'s reply by name, and the process words name each change command', () => {
  const source = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
  const page = source('../webview/task-page.ts');
  const at = page.indexOf('if (m.records) main.append(renderRecords(m, m.records));');
  assert.ok(at > page.indexOf('renderVerify(m, m.verify)') && at < page.indexOf('renderActivity(m)'), 'under Verify, over the Activity');
  assert.match(source('../webview/record-changes.ts'), new RegExp(`'${RECORDS_DONE}': done`));
  assert.match(source('../src/ticket.ts'), /case 'record-add': case 'record-step':/);
  const names = (acc: string) => PROCESSES.find((p) => p.acc.includes(acc))?.name;
  assert.deepEqual(['change record', 'change none', 'change step', 'change list'].map(names), ['Add a record change', 'Say no record changed', 'Mark a promotion\'s step', 'See its record changes']);
});
