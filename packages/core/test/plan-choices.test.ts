import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Analysis, readAnalysis, writeAnalysis } from '../src/analyze.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { run } from '../src/exec.ts';
import { mutate, readLedger, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { approvePlan, CHOICE_TEXT_MAX, choosePlan } from '../src/plan-choices.ts';
import { GENERIC_CONFIG, makeRepo } from './support.ts';

const now = () => new Date('2026-10-22T12:00:00Z');

const option = (id: string, name: string) => ({ id, name, means: '', pros: [], cons: [], effort: 'S' as const, risks: [], touches: [] });

/** A repo with one task and its plan: one question for you, one choice of two options. */
function setup(extra: Partial<Analysis> = {}) {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  const config = parseConfig(GENERIC_CONFIG).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'manual' }, title: 'Track stage history', brief: '' }], 'human', 'human:test', emit, now);
  });
  const id = readLedger(paths.ledger).tasks[0]!.id;
  writeAnalysis(paths, {
    v: 1, task: id, env: 'main', base: 'x', verdict: 'questions', summary: 'S', requirements: { goal: '', criteria: [], assumptions: [], outOfScope: [] },
    questions: [{ id: 'q1', question: 'Closed deals too?', why: '', suggested: 'Yes', askOf: 'you' }],
    decisions: [{ id: 'd1', title: 'Where history is kept', why: '', options: [option('a', 'Field history'), option('b', 'Custom object')], recommended: 'a', because: '' }],
    findings: [], approach: { plan: [], files: [], refactors: [], risks: [], tests: [], size: 'S' }, split: [], orgs: [], sessionId: 's', at: '', durationMs: 0, costUsd: null, ...extra,
  });
  return { paths, id };
}

test('a choice is made by option id or name, or in a person\'s own words, with who and when, and kept with the plan', () => {
  const { paths, id } = setup();
  assert.deepEqual(choosePlan(paths, id, 'd1', { option: 'b' }, 'human:me', now).decisions![0]!.choice, { option: 'b', by: 'human:me', at: now().toISOString() });
  assert.equal(choosePlan(paths, id, '1', { option: 'field HISTORY' }, 'human:me', now).decisions![0]!.choice?.option, 'a', 'by its name, and the choice by its number');
  const own = choosePlan(paths, id, 'D1', { text: '  A big object  ' }, 'human:you', now);
  assert.deepEqual(own.decisions![0]!.choice, { option: null, text: 'A big object', by: 'human:you', at: now().toISOString() });
  assert.deepEqual(readAnalysis(paths, id)!.decisions![0]!.choice, own.decisions![0]!.choice);
  const events = readLedger(paths.ledger);
  assert.ok(events.tasks[0], 'the task is still there');
});

test('a choice is refused for an unknown choice or option, both or neither given, empty or too long words, and no plan', () => {
  const { paths, id } = setup();
  assert.throws(() => choosePlan(paths, id, 'd9', { option: 'a' }, 'human:me', now), /has no choice d9\. It has: d1\./);
  assert.throws(() => choosePlan(paths, id, 'd1', { option: 'z' }, 'human:me', now), /d1 has no option z\. It has: a \(Field history\), b \(Custom object\)\./);
  assert.throws(() => choosePlan(paths, id, 'd1', {}, 'human:me', now), /has no option \(none given\)/);
  assert.throws(() => choosePlan(paths, id, 'd1', { option: 'a', text: 'x' }, 'human:me', now), /not both/);
  assert.throws(() => choosePlan(paths, id, 'd1', { text: '   ' }, 'human:me', now), /Give your own option in words/);
  assert.throws(() => choosePlan(paths, id, 'd1', { text: 'x'.repeat(CHOICE_TEXT_MAX + 1) }, 'human:me', now), /longer than 4000/);
  assert.throws(() => choosePlan(paths, 'T-99', 'd1', { option: 'a' }, 'human:me', now), /T-99 has no plan yet/);
  assert.throws(() => approvePlan(paths, 'T-99', 'human:me', now), /T-99 has no plan yet/);
  assert.equal(readAnalysis(paths, id)!.decisions![0]!.choice, undefined, 'nothing refused was kept');
});

test('approval is refused while a question or a choice is open, pins the version once made, and a later choice undoes it', () => {
  const { paths, id } = setup({ version: 2 });
  assert.throws(() => approvePlan(paths, id, 'human:me', now), /isn't ready to approve: answer q1, and choose d1 first\./);
  const a = readAnalysis(paths, id)!;
  a.questions[0]!.answer = { text: 'Yes', by: 'human:me', at: '' };
  writeAnalysis(paths, a);
  choosePlan(paths, id, 'd1', { option: 'a' }, 'human:me', now);
  const approved = approvePlan(paths, id, 'human:me', now);
  assert.deepEqual(approved.approval, { version: 2, by: 'human:me', at: now().toISOString() });
  // Approved again, it stays as it was: the first approval holds.
  assert.deepEqual(approvePlan(paths, id, 'human:other', () => new Date('2026-10-23T00:00:00Z')).approval, approved.approval);
  const changed = choosePlan(paths, id, 'd1', { option: 'b' }, 'human:me', now);
  assert.equal(changed.approval, undefined);
  assert.deepEqual(changed.lapsed, approved.approval);
  // Approving again clears what lapsed.
  const again = approvePlan(paths, id, 'human:me', now);
  assert.equal(again.lapsed, undefined);
  assert.equal(again.approval?.version, 2);
});
