import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { addPromotionSteps, changeWords, markStep, openSteps, stepsLeftWords, stepsOf, stepsSection } from '../src/change-steps.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { run } from '../src/exec.ts';
import { mutate, readLedger, type Task, upsertTasks } from '../src/ledger.ts';
import { emptyOutside, noteCommand, outsideOf, recordNone, recordOutside, unmade, unrecorded, unrecordedProblems, WHY_MAX } from '../src/outside-changes.ts';
import { repoPaths } from '../src/paths.ts';
import { promotionBody } from '../src/promote.ts';
import { RECORD_ACTIONS, RECORD_KIND, recordKey, type RecordChange } from '../src/records.ts';
import { recordFromFlags, refuseUnrecorded } from '../../cli/src/commands/changes.ts';
import { noteRecordWrites, RECORD_WRITERS, recordWriters } from '../src/record-hooks.ts';
import { builderFor, preToolUseHook } from '../src/hooks.ts';
import { GENERIC_CONFIG, gitIn, makeRepo, SF_CONFIG } from './support.ts';

const MAIN = fileURLToPath(new URL('../../cli/src/main.ts', import.meta.url));
const rename: RecordChange = { object: 'Account', action: 'update', match: [{ field: 'Name', value: 'Acme Corp' }], fields: [{ field: 'Name', from: null, to: 'Acme Corporation' }] };
const builder = { actor: 'builder' as const, by: 'builder:T-1' };
const person = { actor: 'human' as const, by: 'human:jordan' };
const SF = { profile: 'salesforce', keys: [recordKey(rename)] };

/** A clock that moves a second each time it's read, so each change is after the one before. */
function clock() {
  let t = Date.parse('2026-10-22T10:00:00Z');
  return () => new Date((t += 1000));
}

/** A Salesforce repo with T-1 running in a real worktree, as acc dispatch leaves it. */
function repo(raw: Record<string, unknown> = SF_CONFIG) {
  const root = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(raw) }));
  const wt = join(root, '.claude', 'worktrees', 'T-1');
  gitIn(root, 'worktree', 'add', '-q', '-b', 'task/T-1-a', wt);
  const config = parseConfig(raw).config as Config;
  const paths = repoPaths(root, run);
  const now = clock();
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'Rename Acme' }, { source: { kind: 'manual', key: 'T-2' }, title: 'Other' }], 'human', 'human:test', emit, now);
    const t = l.tasks[0]!;
    t.state = 'running';
    t.run = { worktree: wt, branch: 'task/T-1-a', sessionId: 's' };
  });
  return { root, wt, paths, now, task: (id = 'T-1') => readLedger(paths.ledger).tasks.find((t) => t.id === id)! };
}

test('a builder\'s record change is kept with its task, with who, when, and whether the plan listed it', () => {
  const r = repo();
  const c = recordOutside(r.paths, r.now, 'T-1', RECORD_KIND, rename, 'The brand changed', builder, SF);
  assert.equal(c.id, 'c1');
  assert.equal(c.planned, true);
  const kept = outsideOf(r.task()).changes;
  assert.deepEqual(kept.map((x) => [x.id, x.by, x.kind, x.planned]), [['c1', 'builder:T-1', 'record', true]]);
  assert.ok(kept[0]!.at.startsWith('2026-10-22T10:00'));
  const hand = recordOutside(r.paths, r.now, 'T-1', RECORD_KIND, { ...rename, match: [{ field: 'Name', value: 'Beta' }] }, 'Done in Setup', person, SF);
  assert.deepEqual([hand.id, hand.planned, hand.actor], ['c2', false, 'human'], 'a person\'s change made by hand, not in the plan');
});

test('a record change is refused: named by ID, with no why, for a generic project, or by a builder for another task', () => {
  const r = repo();
  assert.throws(() => recordOutside(r.paths, r.now, 'T-1', RECORD_KIND, { ...rename, match: [{ field: 'Id', value: '001Dn00000AbCdE' }] }, 'w', builder, SF), /by its ID/);
  assert.throws(() => recordOutside(r.paths, r.now, 'T-1', RECORD_KIND, rename, '  ', builder, SF), /Say why/);
  assert.throws(() => recordOutside(r.paths, r.now, 'T-1', RECORD_KIND, rename, 'w', builder, { profile: 'generic', keys: [] }), /salesforce profile/);
  assert.throws(() => recordOutside(r.paths, r.now, 'T-2', RECORD_KIND, rename, 'w', builder, SF), /its own task only/);
  assert.throws(() => recordOutside(r.paths, r.now, 'T-9', RECORD_KIND, rename, 'w', person, SF), /No task T-9/);
  assert.equal(outsideOf(r.task()).changes.length, 0, 'nothing was kept');
});

test('edge case: a builder whose task isn\'t running any more can\'t record, but a person can', () => {
  const r = repo();
  mutate(r.paths, r.now, (l, emit) => { l.tasks[0]!.state = 'done'; emit({ type: 'task.moved', task: 'T-1', actor: 'human', by: 'test', data: {} }); });
  assert.throws(() => recordOutside(r.paths, r.now, 'T-1', RECORD_KIND, rename, 'w', builder, SF), /isn't running/);
  assert.equal(recordOutside(r.paths, r.now, 'T-1', RECORD_KIND, rename, 'w', person, SF).id, 'c1', 'a change stays with a done ticket');
});

test('acc done is refused after a noted command with no change recorded, and allowed after one', () => {
  const r = repo();
  assert.deepEqual(unrecordedProblems(r.task()), [], 'nothing noted, nothing to refuse');
  noteCommand(r.paths, r.now, 'T-1', 'sf data update record --sobject Account', 'record');
  assert.match(unrecordedProblems(r.task()).join(''), /1 command you ran can change records.*sf data update record.*acc change none/);
  recordOutside(r.paths, r.now, 'T-1', RECORD_KIND, rename, 'w', builder, SF);
  assert.deepEqual(unrecordedProblems(r.task()), []);
  noteCommand(r.paths, r.now, 'T-1', 'sf apex run --file x.apex', 'record');
  assert.equal(unrecorded(outsideOf(r.task())).length, 1, 'a command after the last recorded change holds it again');
});

test('acc change none is kept with why, and refused with no why or nothing noted', () => {
  const r = repo();
  assert.throws(() => recordNone(r.paths, r.now, 'T-1', 'it only read', builder), /noted no command/);
  noteCommand(r.paths, r.now, 'T-1', 'sf data import tree --plan p.json', 'record');
  assert.throws(() => recordNone(r.paths, r.now, 'T-1', ' ', builder), /none was made/);
  const n = recordNone(r.paths, r.now, 'T-1', 'The import failed: nothing was saved', builder);
  assert.equal(n.why, 'The import failed: nothing was saved');
  assert.deepEqual(unrecordedProblems(r.task()), [], 'saying none lets acc done go on');
  assert.equal(outsideOf(r.task()).none.length, 1);
});

test('edge case: a task from before T-100 has no changes outside git, and planned ones not recorded are listed', () => {
  assert.deepEqual(outsideOf({}), emptyOutside());
  const planned = [{ ...rename, why: 'w' }, { ...rename, match: [{ field: 'Name', value: 'Beta' }], why: 'w' }];
  const made = [{ id: 'c1', kind: 'record', detail: rename, why: 'w', planned: true, actor: 'builder' as const, by: 'b', at: 'a' }];
  assert.deepEqual(unmade(planned, made, RECORD_KIND).map((p) => p.match[0]!.value), ['Beta']);
});

test('promotion steps are kept per environment, added once, and marked done or skipped with a reason', () => {
  const r = repo();
  recordOutside(r.paths, r.now, 'T-1', RECORD_KIND, rename, 'The brand changed', builder, SF);
  mutate(r.paths, r.now, (l, emit) => {
    const t = l.tasks[0]!;
    emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'test', data: {} });
    assert.equal(addPromotionSteps(t, { branch: 'uat', org: 'Acme UAT' }, 'x').length, 1);
    assert.equal(addPromotionSteps(t, { branch: 'uat', org: 'Acme UAT' }, 'x').length, 0, 'a promotion made again adds nothing twice');
    assert.equal(addPromotionSteps(t, { branch: 'production', org: 'Acme Production' }, 'x').length, 1);
  });
  assert.equal(openSteps(r.task()).length, 2);
  assert.equal(stepsLeftWords(r.task(), 'uat'), '1 change outside git still to make in uat');
  const [uat] = stepsOf(r.task(), 'uat');
  assert.equal(uat!.words, 'Account \'Acme Corp\': Name → \'Acme Corporation\'');
  assert.match(uat!.script.at(-1)!, /--target-org Acme UAT --sobject Account --where/);
  markStep(r.paths, r.now, 'T-1', 'c1', 'uat', { done: true }, person);
  markStep(r.paths, r.now, 'T-1', 'c1', 'production', { skip: 'Production already has the new name' }, person);
  const steps = outsideOf(r.task()).steps;
  assert.deepEqual(steps.map((s) => [s.env, s.state, s.reason, s.by]), [['uat', 'done', null, 'human:jordan'], ['production', 'skipped', 'Production already has the new name', 'human:jordan']]);
  assert.equal(stepsLeftWords(r.task(), 'uat'), null);
});

test('edge case: a step is refused for a builder, with no reason to skip, or for an environment it wasn\'t promoted to', () => {
  const r = repo();
  assert.throws(() => markStep(r.paths, r.now, 'T-1', 'c1', 'uat', { done: true }, person), /hasn't been promoted/);
  recordOutside(r.paths, r.now, 'T-1', RECORD_KIND, rename, 'w', builder, SF);
  mutate(r.paths, r.now, (l, emit) => { addPromotionSteps(l.tasks[0]!, { branch: 'uat', org: null }, 'x'); emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'test', data: {} }); });
  assert.throws(() => markStep(r.paths, r.now, 'T-1', 'c1', 'uat', { done: true }, builder), /A person marks/);
  assert.throws(() => markStep(r.paths, r.now, 'T-1', 'c1', 'uat', { skip: ' ' }, person), /Say why/);
  assert.throws(() => markStep(r.paths, r.now, 'T-1', 'c1', 'production', { done: true }, person), /has steps in uat, not production/);
  assert.match(stepsOf(r.task(), 'uat')[0]!.script.at(-1)!, /--target-org <org>/, 'an environment with no org gets a placeholder');
});

test('a promotion\'s pull request lists the changes to make by hand, and says nothing when there are none', () => {
  const task = { id: 'T-1', outside: { ...emptyOutside(), changes: [{ id: 'c1', kind: 'record', detail: rename, why: 'The brand changed', planned: true, actor: 'builder' as const, by: 'b', at: 'a' }] } } as Pick<Task, 'id' | 'outside'>;
  const env = { branch: 'uat', name: 'UAT', org: 'Acme UAT' };
  addPromotionSteps(task as Task, env, 'x');
  const section = stepsSection([task], env);
  assert.match(section.join('\n'), /## Changes outside git to make by hand \(1\)[\s\S]*### T-1[\s\S]*Account 'Acme Corp'[\s\S]*sf data update record/);
  const plan = { from: { branch: 'dev', name: 'Dev' }, to: { branch: 'uat', name: 'UAT' }, skipped: [], files: ['a'], deleted: [], leftOut: [], fromSha: 'abcdef1', toSha: '1234567' } as never;
  assert.match(promotionBody(plan, null, section), /Changes outside git to make by hand/);
  assert.doesNotMatch(promotionBody(plan, null), /by hand/);
  assert.deepEqual(stepsSection([{ id: 'T-2', outside: undefined }], env), [], 'edge case: no task with changes, no section');
  assert.equal(changeWords({ id: 'c9', kind: 'mystery', detail: {}, why: '', planned: false, actor: 'human', by: '', at: '' }), 'A change of kind "mystery"');
});

test('each record-writing command is noted, and a read is not', () => {
  const writes = ['sf data create record --sobject Account --values "Name=A"', 'sf data update record -s Account -w "Name=A" -v "Name=B"', 'sf data delete record -s Account -w "Name=A"',
    'sf data upsert bulk --sobject Account --file a.csv --external-id Ext__c', 'sf data import tree --plan plan.json', 'sf apex run --file script.apex', 'sf sfdmu run --sourceusername csvfile', 'sfdx sfdmu:run --targetusername uat'];
  for (const w of writes) assert.equal(recordWriters(w).length, 1, w);
  assert.equal(RECORD_WRITERS.length, 8, 'every writer is tried');
  for (const read of ['sf data query --query "SELECT Id FROM Account"', 'sf apex run test --tests X', 'sf sobject describe -s Account', 'echo sf data create']) assert.deepEqual(recordWriters(read), [], read);
  assert.deepEqual(recordWriters('sf data query -q x && nice -n 15 sf data delete record -s A -w "N=1"'), ['sf data delete record -s A -w N=1'], 'edge case: a write after a read on one line, under nice');
});

test('the hook notes a builder\'s record write on its task, and nothing for a read, a refused command, or outside a builder\'s session or a Salesforce project', () => {
  const r = repo();
  const input = (command: string, tool = 'Bash') => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command } });
  const builderCtx = { cwd: r.wt, env: { ACC_ROLE: 'builder', ACC_TASK: 'T-1' }, run, now: r.now };
  const noted = () => outsideOf(r.task()).noted.map((n) => n.command);
  assert.equal(preToolUseHook(input('sf data query -q x'), builderCtx), null);
  assert.equal(preToolUseHook(input('sf data update record -s Account'), builderCtx), null, 'it runs: the hook only notes it');
  assert.equal(preToolUseHook(input('sf data update record', 'Edit'), builderCtx), null, 'only Bash');
  assert.ok(preToolUseHook(input('sf data delete record -s A && git push'), builderCtx), 'a refused line is denied');
  assert.equal(preToolUseHook(input('sf data update record'), { ...builderCtx, cwd: r.root, env: {} }), null, 'not a builder');
  assert.deepEqual(noted(), ['sf data update record -s Account'], 'only the write a builder ran');
  const b = builderFor(builderCtx)!;
  assert.deepEqual(noteRecordWrites(b, 'sf apex run --file a.apex', builderCtx), ['sf apex run --file a.apex']);
  const g = repo({ ...GENERIC_CONFIG });
  const gCtx = { cwd: g.wt, env: { ACC_ROLE: 'builder', ACC_TASK: 'T-1' }, run, now: g.now };
  assert.deepEqual(noteRecordWrites(builderFor(gCtx)!, 'sf data update record', gCtx), [], 'a generic project notes nothing');
});

/** acc, as a builder or a person runs it in the repo. */
function acc(cwd: string, args: string[], env: Record<string, string>, input?: string) {
  const r = spawnSync(process.execPath, ['--no-warnings', MAIN, ...args], { cwd, encoding: 'utf8', input, env: { ...process.env, ACC_ROLE: '', ACC_TASK: '', ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('acc change record, none and step, and acc done\'s refusal, from the command line', () => {
  const r = repo();
  const b = { ACC_ROLE: 'builder', ACC_TASK: 'T-1' };
  // The hook, as Claude Code runs it, notes the write and lets it run.
  const hook = acc(r.wt, ['hook', 'pre-tool-use'], b, JSON.stringify({ hook_event_name: 'PreToolUse', cwd: r.wt, tool_name: 'Bash', tool_input: { command: 'sf data update record -s Account' } }));
  assert.equal(hook.code, 0, hook.err);
  assert.equal(hook.out, '', 'the hook says nothing back');
  const done = acc(r.wt, ['done', '--landed', 'x', '--moved', 'none', '--open', 'none'], b);
  assert.notEqual(done.code, 0);
  assert.match(done.err, /can change records/);
  const byId = acc(r.wt, ['change', 'record', '--object', 'Account', '--match', 'Id=001Dn00000AbCdE', '--set', 'Name=X', '--why', 'w'], b);
  assert.notEqual(byId.code, 0);
  assert.match(byId.err, /by its ID/);
  const ok = acc(r.wt, ['change', 'record', '--object', 'Account', '--match', 'Name=Acme Corp', '--set', 'Name=Acme Corporation', '--why', 'The brand changed'], b);
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /kept c1, Account 'Acme Corp': Name → 'Acme Corporation'/);
  const after = acc(r.wt, ['done', '--landed', 'x', '--moved', 'none', '--open', 'none'], b);
  assert.doesNotMatch(after.err, /can change records/, 'acc done goes on to its other checks');
  assert.match(acc(r.wt, ['change', 'none', 'nothing ran'], b).err, /noted no command/);
  const step = acc(r.root, ['change', 'step', 'T-1', 'c1', '--env', 'uat', '--done'], b);
  assert.match(step.err, /A builder can't mark a promotion's step/);
  const list = acc(r.root, ['change', 'list', 'T-1', '--json'], {});
  assert.equal(JSON.parse(list.out).changes.length, 1);
});

test('edge case: a config file that can\'t be read notes nothing, and the hook still exits 0', () => {
  const r = repo();
  // The worktree has its own copy of the settings, and that's the one a builder's hook reads.
  writeFileSync(join(r.wt, '.acc', 'config.json'), '{');
  const ctx = { cwd: r.wt, env: { ACC_ROLE: 'builder', ACC_TASK: 'T-1' }, run, now: r.now };
  assert.deepEqual(noteRecordWrites({ task: r.task(), worktree: r.wt, root: r.wt }, 'sf data update record', ctx), []);
  assert.equal(preToolUseHook({ tool_name: 'Bash', tool_input: { command: 'sf data update record' } }, ctx), null);
});

test('edge case: the command line\'s flags make the change, and refuse a pair with no field or a create that deletes', () => {
  assert.deepEqual(recordFromFlags({ json: false, object: ' Account ', match: ['Name=Acme Corp'], set: 'Name=Acme Corporation' }), rename);
  assert.equal(recordFromFlags({ json: false, object: 'Region__c', match: ['External_Id__c=EMEA-1'], create: true }).action, 'create');
  assert.deepEqual(RECORD_ACTIONS, ['create', 'update', 'delete']);
  assert.throws(() => recordFromFlags({ json: false, object: 'Account', match: ['=x'] }), /has no field/);
  assert.throws(() => recordFromFlags({ json: false, object: 'Account', match: ['Name=x'], create: true, delete: true }), /not both/);
  assert.throws(() => recordFromFlags({ json: false, match: ['Name=x'] }), /Name the object/);
  const r = repo();
  assert.throws(() => recordOutside(r.paths, r.now, 'T-1', RECORD_KIND, rename, 'x'.repeat(WHY_MAX + 1), builder, SF), new RegExp(`at most ${WHY_MAX}`));
});

test('acc done\'s refusal reads the task in the project it runs in, and lets a task with nothing noted go on', () => {
  const r = repo();
  const was = process.cwd();
  try {
    process.chdir(r.wt);
    assert.doesNotThrow(() => refuseUnrecorded('T-1'));
    noteCommand(r.paths, r.now, 'T-1', 'sf apex run --file a.apex', 'record');
    assert.throws(() => refuseUnrecorded('t-1'), /Can't move T-1 to review:\n- 1 command you ran can change records/);
    assert.doesNotThrow(() => refuseUnrecorded('T-404'), 'edge case: a task acc doesn\'t know is left to acc done');
  } finally {
    process.chdir(was);
  }
});
