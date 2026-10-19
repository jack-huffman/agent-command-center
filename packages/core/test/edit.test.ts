// Editing a task (T-74): each field, each state that allows or refuses it, the record of who edited it, a
// tracker task's read-only fields, intake keeping the notes, and the notes in the builder's and reviewer's text.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { EDIT_FIELD_WORDS, EDIT_FIELDS, EDITABLE_STATES, editChanges, editRefusal, editTask, type TaskEdit, TRACKER_OWNED, trackerFields, trackerOwns } from '../src/edit.ts';
import { emptyLedger, environmentProblem, type Ledger, type LedgerEvent, STATES, type Task, taskDeps, upsertTasks } from '../src/ledger.ts';
import { notesSection, renderPacket } from '../src/packet.ts';
import { editedSection, reviewPrompt } from '../src/review.ts';
import { SF_CONFIG } from './support.ts';

const config = parseConfig(JSON.parse(JSON.stringify(SF_CONFIG))).config!;
const clock = () => new Date('2026-10-19T12:00:00Z');
const dev = config.environments.find((e) => e.default)!;
const uat = config.environments.find((e) => e.name === 'UAT')!;
const prod = config.environments.find((e) => e.name === 'Production')!;

function ledger(): Ledger {
  const l = emptyLedger();
  upsertTasks(l, config, [
    { source: { kind: 'manual', key: 'T-1' }, title: 'Add a thing', brief: 'Old brief', labels: ['a'] },
    { source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.example/browse/ACME-7' }, title: 'From Jira', brief: 'Jira text', labels: ['j'] },
  ], 'human', 'human:test', () => {}, clock);
  return l;
}

function edit(l: Ledger, id: string, e: TaskEdit, actor: 'human' | 'builder' | 'reviewer' | 'orchestrator' = 'human') {
  const events: Omit<LedgerEvent, 'seq' | 'at'>[] = [];
  const r = editTask(l, config, id, e, actor, `${actor}:pat`, (x) => events.push(x), clock);
  return { ...r, events };
}

test('each field a person edits changes, and the fields left out stay as they are', () => {
  const cases: [TaskEdit, Partial<Task>][] = [
    [{ title: '  New title ' }, { title: 'New title' }],
    [{ brief: '## Goal\n\nDo it.' }, { brief: '## Goal\n\nDo it.' }],
    [{ deps: ['acme-3', ' T-2 ', ''] }, { deps: ['ACME-3', 'T-2'] }],
    [{ environment: uat.branch }, { environment: uat.branch }],
    [{ labels: ['ui', 'ui', ' x '] }, { labels: ['ui', 'x'] }],
    [{ notes: 'Use the fixture in test/x.' }, { notes: 'Use the fixture in test/x.' }],
  ];
  let checked = 0;
  for (const [e, want] of cases) {
    const l = ledger();
    const before = structuredClone(l.tasks[0]!);
    const { task, changed, events } = edit(l, 'T-1', e);
    const field = Object.keys(e)[0] as keyof Task;
    assert.deepEqual(task[field], want[field], field);
    assert.deepEqual(changed, [field === 'environment' ? 'environment' : field]);
    for (const other of ['title', 'brief', 'deps', 'environment', 'labels', 'state', 'source'] as const) if (other !== field) assert.deepEqual(task[other], before[other], `${field} left ${other}`);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, 'task.updated');
    assert.deepEqual(events[0]!.data, { [field]: want[field] });
    checked++;
  }
  assert.equal(checked, EDIT_FIELDS.length);
});

test('an edit is recorded with who made it and which fields, and one that changes nothing records nothing (edge: same values)', () => {
  const l = ledger();
  const r = edit(l, 'T-1', { title: 'Better', notes: 'n' });
  assert.deepEqual(r.task.edits, [{ at: '2026-10-19T12:00:00.000Z', actor: 'human', by: 'human:pat', fields: ['title', 'notes'] }]);
  assert.equal(r.task.history.length, 1, 'an edit is no move');
  const same = edit(l, 'T-1', { title: 'Better', brief: 'Old brief', labels: ['a'], environment: dev.branch, notes: ' n ' });
  assert.deepEqual(same.changed, []);
  assert.equal(same.events.length, 0);
  assert.equal(same.task.edits!.length, 1);
});

test('an edit is allowed in todo, blocked, rework and review, and refused while running or done, each with its reason', () => {
  let checked = 0;
  for (const state of STATES) {
    const l = ledger();
    l.tasks[0]!.state = state;
    if (EDITABLE_STATES.includes(state)) {
      assert.equal(editRefusal({ state }), null);
      assert.deepEqual(edit(l, 'T-1', { brief: 'new' }).changed, ['brief'], state);
    } else {
      const why = editRefusal({ state })!;
      assert.match(why, state === 'running' ? /builder is working from the brief/ : /done/);
      assert.throws(() => edit(l, 'T-1', { brief: 'new' }), (e: Error & { code?: string }) => e.code === 'refused' && e.message.includes(why), state);
      assert.equal(l.tasks[0]!.brief, 'Old brief');
    }
    checked++;
  }
  assert.equal(checked, STATES.length);
  assert.deepEqual([...EDITABLE_STATES], ['todo', 'blocked', 'rework', 'review']);
});

test('an edit takes acc add\'s checks: an empty title, an unknown or protected environment, a task depending on itself (edge: bad values)', () => {
  const l = ledger();
  assert.throws(() => edit(l, 'T-1', { title: '   ' }), /needs a title/);
  assert.throws(() => edit(l, 'T-1', { environment: 'nowhere' }), /isn't in the config/);
  assert.equal(environmentProblem(config, 'nowhere'), 'environment "nowhere" isn\'t in the config.');
  assert.equal(prod.protected, true);
  assert.throws(() => edit(l, 'T-1', { environment: prod.branch }), /protected/);
  assert.equal(environmentProblem(config, dev.branch), null);
  assert.throws(() => edit(l, 'T-1', { deps: ['t-1'] }), /depend on itself/);
  assert.throws(() => edit(l, 'T-9', { title: 'x' }), /No task T-9/);
  assert.deepEqual(taskDeps(['#4', 'acme-1'], 'github'), ['GH-4', 'ACME-1']);
  assert.equal(l.tasks[0]!.title, 'Add a thing', 'nothing changed');
  assert.deepEqual(editChanges(l.tasks[0]!, config, {}), {});
});

test('a builder or reviewer can\'t edit a task: only a person does', () => {
  for (const actor of ['builder', 'reviewer'] as const) assert.throws(() => edit(ledger(), 'T-1', { notes: 'x' }, actor), /Only a person/);
  assert.deepEqual(edit(ledger(), 'T-1', { notes: 'x' }, 'orchestrator').changed, ['notes']);
});

test('a tracker task\'s title, description, dependencies and labels are read-only; its environment and notes are a person\'s', () => {
  const l = ledger();
  const jira = l.tasks[1]!;
  assert.deepEqual(trackerFields(jira), TRACKER_OWNED);
  assert.deepEqual(trackerFields(l.tasks[0]!), []);
  assert.equal(trackerOwns(l.tasks[0]!), null);
  assert.match(trackerOwns(jira)!, /Jira ticket owns its title, description/);
  let checked = 0;
  for (const f of TRACKER_OWNED) {
    const e: TaskEdit = f === 'deps' || f === 'labels' ? { [f]: ['NEW-1'] } : { [f]: 'changed' };
    assert.throws(() => edit(l, 'ACME-7', e), (err: Error) => err.message.includes(EDIT_FIELD_WORDS[f]) && err.message.includes('Jira ticket owns'), f);
    checked++;
  }
  assert.equal(checked, 4);
  // The same values as now aren't a change, so a sheet that sends every field still saves the rest.
  const r = edit(l, 'ACME-7', { title: 'From Jira', brief: 'Jira text', labels: ['j'], deps: [], environment: uat.branch, notes: 'Mind the UAT data.' });
  assert.deepEqual(r.changed, ['environment', 'notes']);
});

test('intake refreshes a tracker task\'s text and keeps its notes and environment', () => {
  const l = ledger();
  edit(l, 'ACME-7', { notes: 'Ask before touching the flow.', environment: uat.branch });
  const r = upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.example/browse/ACME-7' }, title: 'From Jira, renamed', brief: 'New Jira text' }], 'sync', 'sync:jira', () => {}, clock);
  assert.deepEqual(r.updated, ['ACME-7']);
  const t = l.tasks[1]!;
  assert.equal(t.title, 'From Jira, renamed');
  assert.equal(t.notes, 'Ask before touching the flow.');
  assert.equal(t.environment, uat.branch);
});

test('the builder\'s instructions show the notes under their own heading, and leave the heading out when there are none', () => {
  const l = ledger();
  const packet = () => renderPacket({ task: l.tasks[0]!, config, env: dev, worktree: '/w', branch: 'b', rules: null, environmentSpecific: [] });
  assert.ok(!packet().includes('## Notes for the builder'));
  assert.deepEqual(notesSection({ notes: '   ' }), [], 'edge: blank notes are none');
  edit(l, 'T-1', { notes: 'Keep the old API working.' });
  const p = packet();
  const at = p.indexOf('## Notes for the builder');
  assert.ok(at > p.indexOf('Old brief') && at < p.indexOf('## Where you are'), 'after the task, before where you are');
  assert.ok(p.slice(at).startsWith('## Notes for the builder\n\nKeep the old API working.\n'));
});

test('the reviewer reads the notes, and the brief as a person edited it after the builder started', () => {
  const l = ledger();
  const t = l.tasks[0]!;
  t.state = 'review';
  t.run = { startedAt: '2026-10-19T11:00:00.000Z' };
  const prompt = () => reviewPrompt({ task: t, config, envName: dev.name, envBranch: dev.branch, sha: 'abcdef1234', packet: '# packet', diff: '', stat: '', checks: [], rules: null }).prompt;
  assert.ok(!prompt().includes('## Notes for the builder'));
  assert.ok(!prompt().includes('edited it since'));
  edit(l, 'T-1', { brief: 'The new brief.', notes: 'Watch the cache.' });
  const p = prompt();
  assert.ok(p.includes('## Notes for the builder\n\nWatch the cache.'));
  assert.ok(p.includes('## The task as a person edited it since'));
  assert.ok(p.includes('The new brief.'));
  // An edit before the builder started is in its packet already (edge: an older edit).
  assert.deepEqual(editedSection({ ...t, run: { startedAt: '2026-10-19T13:00:00.000Z' } }), []);
});
