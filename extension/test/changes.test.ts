// A task's changes on its page (T-99): Planned changes before there's work, Changes once its branch has
// changed something, with the plan a click away, each change outside the plan and each planned one not made
// marked, the changes kept with a task after it merges, and a task that merged before they were kept.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { TaskDeploy } from '../../packages/core/src/deploy-gate.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import { CHANGE_LOOK, changeSets, type ChangesIn, DEPLOY_LOOK, type TicketChanges, ticketChanges, ticketDeploys } from '../src/model/changes.ts';
import { ticketModel } from '../src/model/task-page.ts';
import { pageDom, type PageElement } from './page-dom.ts';

const task = (more: Partial<Task> = {}): ChangesIn['task'] => ({ id: 'T-1', state: 'todo', ...more });
const input = (more: Partial<ChangesIn> = {}): ChangesIn => ({ task: task(), profile: 'generic', planned: ['src/a.ts', 'src/b.ts', 'docs/x.md'], live: null, ...more });

/** Each set as "head: item [mark], item", for reading a whole list at once. */
const shown = (c: TicketChanges, which: 'changed' | 'planned'): string[] =>
  c[which].flatMap((g) => g.sets.map((s) => `${g.title} ${s.head}: ${s.items.map((i) => `${i.name}${i.look ? ` [${i.look.label}]` : ''}`).join(', ')}`));

test('before there\'s work, the section is Planned changes: the plan\'s files by folder, with no counts and no marks (T-99)', () => {
  const c = ticketChanges(input())!;
  assert.deepEqual([c.title, c.counts, c.note, c.keptAt, c.changed], ['Planned changes', null, null, null, []]);
  assert.deepEqual(shown(c, 'planned'), ['Files docs: x.md', 'Files src: a.ts, b.ts']);
  // Dispatched, with a branch that hasn't changed anything yet: still the plan.
  assert.equal(ticketChanges(input({ task: task({ state: 'running' }), live: [] }))!.title, 'Planned changes');
});

test('once its branch changes something, the section is Changes, with "Planned" and "Changed" counts and each mark (T-99)', () => {
  const c = ticketChanges(input({ task: task({ state: 'running' }), live: ['src/a.ts', 'src/c.ts', 'docs/x.md'] }))!;
  assert.deepEqual([c.title, c.counts], ['Changes', { planned: 3, changed: 3 }]);
  assert.deepEqual(shown(c, 'changed'), ['Files docs: x.md', 'Files src: a.ts, b.ts [Planned, not changed], c.ts [Not in the plan]']);
  assert.deepEqual(shown(c, 'planned'), ['Files docs: x.md', 'Files src: a.ts, b.ts'], 'the plan, a click away');
  assert.deepEqual(CHANGE_LOOK, {
    unplanned: { label: 'Not in the plan', icon: 'diff-added', tone: 'orange' },
    unmade: { label: 'Planned, not changed', icon: 'circle-slash', tone: 'orange' },
  });
});

test('edge case: with no plan the work shows unmarked and Planned has no count; with nothing planned or changed there\'s no section (T-99)', () => {
  const c = ticketChanges(input({ planned: null, task: task({ state: 'review' }), live: ['a.ts'] }))!;
  assert.deepEqual([c.title, c.counts, shown(c, 'changed'), c.planned], ['Changes', { planned: null, changed: 1 }, ['Files The top folder: a.ts'], []]);
  assert.equal(ticketChanges(input({ planned: null })), null, 'no plan, no work');
  assert.equal(ticketChanges(input({ planned: null, task: task({ state: 'running' }), live: [] })), null, 'a branch with nothing on it yet');
});

test('after it merges, the changes kept with the task show, when they were kept, and no live read is needed (T-99)', () => {
  const changes = { at: '2026-10-22T12:00:00.000Z', paths: ['src/a.ts', 'src/c.ts'] };
  const c = ticketChanges(input({ task: task({ state: 'done', changes }), live: null }))!;
  assert.deepEqual([c.title, c.counts, c.keptAt], ['Changes', { planned: 3, changed: 2 }, changes.at]);
  assert.deepEqual(shown(c, 'changed'), ['Files docs: x.md [Planned, not changed]', 'Files src: a.ts, b.ts [Planned, not changed], c.ts [Not in the plan]']);
  // In flight, the branch's own changes win over what a land kept.
  const flying = ticketChanges(input({ task: task({ state: 'review', changes }), live: ['src/b.ts'] }))!;
  assert.deepEqual([flying.keptAt, flying.counts?.changed], [null, 1]);
  // Its branch gone before it merged: what the land kept.
  assert.equal(ticketChanges(input({ task: task({ state: 'review', changes }), live: [] }))!.keptAt, changes.at);
});

test('edge case: a task that merged before changes were kept says so plainly, and still shows its plan (T-99)', () => {
  const c = ticketChanges(input({ task: task({ state: 'done' }) }))!;
  assert.deepEqual([c.title, c.counts, c.changed, c.note], ['Changes', null, [], 'It merged before changes were kept with a task, so there\'s no record of what it changed. Its plan named these.']);
  assert.equal(shown(c, 'planned').length, 2);
  const bare = ticketChanges(input({ planned: null, task: task({ state: 'done', changes: { at: 'x', paths: [] } }) }))!;
  assert.deepEqual([bare.note, bare.planned], ['It merged before changes were kept with a task, so there\'s no record of what it changed.', []], 'an empty record is none');
});

test('in a Salesforce project each path is the component it is part of, by type, each with its paths; a path it doesn\'t know shows as itself, last (T-99)', () => {
  const D = 'force-app/main/default';
  const sets = changeSets([
    { path: `${D}/classes/JobHistoryService.cls`, mark: 'planned' },
    { path: `${D}/classes/JobHistoryService.cls-meta.xml`, mark: 'unplanned' },
    { path: `${D}/objects/Contact/fields/Job_Title__c.field-meta.xml`, mark: 'planned' },
    { path: `${D}/flows/Contact_Job_History.flow-meta.xml`, mark: 'unmade' },
    { path: 'scripts/apex/seed.apex', mark: 'unplanned' },
  ], 'salesforce');
  assert.deepEqual(sets.map((s) => [s.head, s.items.map((i) => [i.name, i.paths.length, i.look?.label ?? null])]), [
    ['Apex Class', [['JobHistoryService', 2, null]]],
    ['Custom Field', [['Contact.Job_Title__c', 1, null]]],
    ['Flow', [['Contact_Job_History', 1, 'Planned, not changed']]],
    ['Other files', [['scripts/apex/seed.apex', 1, 'Not in the plan']]],
  ], 'a class and its -meta.xml are one component, in the plan when either is');
  assert.equal(ticketChanges(input({ profile: 'salesforce', planned: [`${D}/classes/A.cls`] }))!.planned[0]!.title, 'Metadata');
});

test('the ticket\'s model carries the section for a task, and none without one (T-99)', () => {
  const changes = ticketChanges(input());
  const base = { project: '/r', tracker: null, trackerTitle: null, trackerKind: null, key: 'T-1', ticket: null, loading: false, error: null, connect: null, checks: [], changes };
  assert.equal(ticketModel({ ...base, row: null, task: null }).changes, null);
  const t = { id: 'T-1', title: 'x', brief: '', source: { kind: 'manual', key: null, url: null }, environment: 'main', deps: [], labels: [], state: 'todo', blocker: null, run: null, pr: null, history: [], createdAt: '', updatedAt: '' } as Task;
  assert.equal(ticketModel({ ...base, row: null, task: t }).changes, changes);
});

const all = (e: PageElement): PageElement[] => [e, ...e.all()];
const buttons = (e: PageElement): PageElement[] => all(e).filter((x) => x.tagName === 'BUTTON');

test('the page draws Planned changes, then Changes with its counts as buttons; Planned shows the plan and Changed shows the work (T-99)', async () => {
  const page = pageDom();
  // The page's memory, kept as VSCode keeps a webview's state, so a choice stays as the page redraws.
  let kept: unknown;
  (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (x: unknown) => page.sent.push(x), getState: () => kept, setState: (s: unknown) => { kept = s; } });
  const { renderChanges } = await import('../webview/changes.ts');
  const m = { project: '/r', key: 'T-1' } as never;
  const planned = renderChanges(m, ticketChanges(input())!) as unknown as PageElement;
  assert.match(planned.textContent, /^Planned changesFilesdocs1x\.mdsrc2a\.tsb\.ts$/);
  assert.deepEqual(buttons(planned), [], 'no counts before there\'s work');
  const c = ticketChanges(input({ task: task({ state: 'running' }), live: ['src/a.ts', 'src/c.ts'] }))!;
  const work = renderChanges(m, c) as unknown as PageElement;
  assert.deepEqual(buttons(work).map((b) => [b.textContent, b.getAttribute('aria-pressed')]), [['Planned: 3', 'false'], ['Changed: 2', 'true']]);
  assert.match(work.textContent, /Not in the plan/);
  assert.match(work.textContent, /Planned, not changed/);
  const name = work.all('chg-name').find((x) => x.textContent === 'c.ts')!;
  assert.deepEqual([name.title, name.dataset.work], ['src/c.ts', 'files'], 'its path in its title, as work data');
  buttons(work)[0]!.click();
  const plan = renderChanges(m, c) as unknown as PageElement;
  assert.deepEqual(buttons(plan).map((b) => b.getAttribute('aria-pressed')), ['true', 'false'], 'the plan shows, and stays shown as the page redraws');
  assert.doesNotMatch(plan.textContent, /Not in the plan/);
  buttons(plan)[1]!.click();
  assert.match((renderChanges(m, c) as unknown as PageElement).textContent, /Not in the plan/, 'back to the work');
});

test('the page draws the kept changes after a merge with when they were kept, and the no-record line, and sits apart from the plan (T-99)', async () => {
  pageDom();
  const { renderChanges } = await import('../webview/changes.ts');
  const m = { project: '/r', key: 'T-2' } as never;
  const kept = renderChanges(m, ticketChanges(input({ task: task({ id: 'T-2', state: 'done', changes: { at: '2026-10-22T12:00:00.000Z', paths: ['src/a.ts'] } }) }))!) as unknown as PageElement;
  assert.match(kept.textContent, /Kept with the task .*, so they stay after its branch is gone\./);
  const none = renderChanges(m, ticketChanges(input({ task: task({ id: 'T-2', state: 'done' }) }))!) as unknown as PageElement;
  assert.match(none.textContent, /^ChangesIt merged before changes were kept with a task, so there's no record of what it changed\. Its plan named these\.Files/);
  const page = readFileSync(new URL('../webview/task-page.ts', import.meta.url), 'utf8');
  const at = page.indexOf('if (m.changes) main.append(renderChanges(m, m.changes));');
  assert.ok(at > page.indexOf('renderVerify(m, m.verify)') && at < page.indexOf('renderActivity(m)'), 'in the main column, under Verify, over the Activity');
  assert.doesNotMatch(readFileSync(new URL('../webview/analysis.ts', import.meta.url), 'utf8'), /'Files'/, 'the plan\'s own Files list is gone: this section says it');
});

test('the screenshot run draws Planned changes, Changes with one outside the plan, and a merged task\'s kept changes (T-99)', async () => {
  const { sampleModel } = await import('../scripts/screenshot.ts');
  const marks = (c: TicketChanges | null) => c?.changed.flatMap((g) => g.sets.flatMap((s) => s.items.flatMap((i) => (i.look ? [i.look.label] : [])))) ?? [];
  const pages = { 'ticket-planned': ['ACME-35', 'Planned changes', null, false, []], 'ticket-changes': ['ACME-12', 'Changes', { planned: 4, changed: 5 }, false, ['Not in the plan', 'Not in the plan', 'Planned, not changed']], 'ticket-kept': ['ACME-20', 'Changes', { planned: 5, changed: 6 }, true, ['Not in the plan']] } as const;
  for (const [kind, want] of Object.entries(pages)) {
    const m = sampleModel(kind as keyof typeof pages) as ReturnType<typeof ticketModel>;
    assert.deepEqual([m.key, m.changes?.title, m.changes?.counts, !!m.changes?.keptAt, marks(m.changes)], want, kind);
  }
  assert.deepEqual(sampleModel('ticket-changes').changes?.deployed.map((d) => d.org), ['Acme Dev'], 'the in-flight page draws the builder\'s deploy (D-T-115)');
});

test('a task\'s deploys show under Changes as the latest to each org with what the tests found; none when it hasn\'t deployed, and none from an empty list (D-T-115)', () => {
  const deploy = (org: string, at: string, tests: TaskDeploy['tests']): TaskDeploy => ({ env: 'dev', org, sha: 'a', at, jobId: '0Af', paths: ['x'], components: ['Apex Class: A', 'Custom Field: B.C__c'], verified: 2, tests });
  const deploys = [deploy('Acme Dev', '2026-10-23T10:00:00.000Z', null), deploy('Acme Dev', '2026-10-23T11:00:00.000Z', { names: ['ATest'], outcome: 'pass', ran: 2, failed: 0, coverage: '91%' })];
  const c = ticketChanges(input({ task: task({ state: 'running', deploys }), live: ['src/a.ts'] }))!;
  assert.deepEqual(c.deployed, [{ org: 'Acme Dev', at: '2026-10-23T11:00:00.000Z', look: { label: 'Deployed to Acme Dev', icon: 'cloud-upload', tone: 'blue' }, words: '2 components, 2 listed in the org · 2 tests passed in the org, 91% coverage' }], 'the look rides on the data, so the page needs no model import');
  assert.deepEqual(ticketDeploys([deploy('Acme Dev', '2026-10-23T10:00:00.000Z', { names: ['ATest'], outcome: 'fail', ran: 2, failed: 1, coverage: '40%' })])[0]!.words, '2 components, 2 listed in the org · 1 test of 2 failed in the org');
  assert.deepEqual(ticketChanges(input({ task: task({ state: 'running' }), live: ['src/a.ts'] }))!.deployed, []);
  assert.deepEqual(ticketChanges(input({ task: task({ state: 'running', deploys: [] }), live: ['src/a.ts'] }))!.deployed, []);
  assert.deepEqual(ticketChanges(input({ task: task({ state: 'todo', deploys }) }))!.deployed.length, 1, 'a plan-only section carries them too');
  assert.deepEqual(DEPLOY_LOOK.deployed, { label: 'Deployed to', icon: 'cloud-upload', tone: 'blue' });
});

test('the page draws "Deployed to <org>" under Changes, with when and what the tests found, and nothing when the task hasn\'t deployed (D-T-115)', async () => {
  pageDom();
  const { renderChanges } = await import('../webview/changes.ts');
  const m = { project: '/r', key: 'T-1' } as never;
  const deploys: TaskDeploy[] = [{ env: 'dev', org: 'Acme Dev', sha: 'a', at: '2026-10-23T11:00:00.000Z', jobId: '0Af', paths: ['src/a.ts'], components: ['Apex Class: A'], verified: 1, tests: { names: ['ATest'], outcome: 'pass', ran: 2, failed: 0, coverage: '91%' } }];
  const drawn = renderChanges(m, ticketChanges(input({ task: task({ state: 'running', deploys }), live: ['src/a.ts'] }))!) as unknown as PageElement;
  const line = drawn.querySelector('.chg-deploy') as PageElement | null;
  assert.ok(line, 'a deploy line');
  assert.match(line!.textContent, /^Deployed to Acme Dev.*1 component, 1 listed in the org · 2 tests passed in the org, 91% coverage$/);
  assert.ok(line!.querySelector('.codicon-cloud-upload'), 'with its icon');
  const none = renderChanges(m, ticketChanges(input({ task: task({ state: 'running' }), live: ['src/a.ts'] }))!) as unknown as PageElement;
  assert.equal(none.querySelector('.chg-deploy'), null);
});
