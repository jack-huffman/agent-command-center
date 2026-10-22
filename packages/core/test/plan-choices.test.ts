import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Analysis, readAnalysis, writeAnalysis } from '../src/analyze.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { run } from '../src/exec.ts';
import { mutate, readLedger, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { approvePlan, CHANGE_APPROVED, CHOICE_TEXT_MAX, choosePlan, sameChoice } from '../src/plan-choices.ts';
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
  assert.deepEqual(choosePlan(paths, id, 'd1', { option: 'b' }, 'human:me', now).plan.decisions![0]!.choice, { option: 'b', by: 'human:me', at: now().toISOString() });
  assert.equal(choosePlan(paths, id, '1', { option: 'field HISTORY' }, 'human:me', now).plan.decisions![0]!.choice?.option, 'a', 'by its name, and the choice by its number');
  const own = choosePlan(paths, id, 'D1', { text: '  A big object  ' }, 'human:you', now).plan;
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
  const changed = choosePlan(paths, id, 'd1', { option: 'b' }, 'human:me', now, true).plan;
  assert.equal(changed.approval, undefined);
  assert.deepEqual(changed.lapsed, approved.approval);
  // Approving again clears what lapsed.
  const again = approvePlan(paths, id, 'human:me', now);
  assert.equal(again.lapsed, undefined);
  assert.equal(again.approval?.version, 2);
});

/** The plan of setup(), its question answered, d1 chosen as `option`, and approved. */
function approved(option = 'a') {
  const s = setup();
  const a = readAnalysis(s.paths, s.id)!;
  a.questions[0]!.answer = { text: 'Yes', by: 'human:me', at: '' };
  writeAnalysis(s.paths, a);
  choosePlan(s.paths, s.id, 'd1', { option }, 'human:me', now);
  approvePlan(s.paths, s.id, 'human:me', now);
  return s;
}

test('on an approved plan, picking the option already chosen, by id or name, changes nothing and the approval holds', () => {
  const { paths, id } = approved();
  const seq = readLedger(paths.ledger).seq;
  const later = () => new Date('2026-10-23T00:00:00Z');
  for (const option of ['a', 'Field history']) {
    const r = choosePlan(paths, id, 'd1', { option }, 'human:other', later);
    assert.equal(r.changed, false, option);
    assert.deepEqual([r.plan.approval?.version, r.plan.lapsed, r.decision.choice?.by, r.decision.choice?.at], [1, undefined, 'human:me', now().toISOString()], 'who chose, and when, stay as they were');
  }
  assert.deepEqual(readAnalysis(paths, id)!.approval, { version: 1, by: 'human:me', at: now().toISOString() }, 'nothing written');
  assert.equal(readLedger(paths.ledger).seq, seq, 'nothing recorded');
  // The person's own words, written again the same, change nothing either: other words are a change.
  const s = setup();
  assert.equal(choosePlan(s.paths, s.id, 'd1', { text: 'A big object' }, 'human:me', now).changed, true);
  assert.equal(choosePlan(s.paths, s.id, 'd1', { text: ' A big object ' }, 'human:me', now).changed, false);
  assert.equal(choosePlan(s.paths, s.id, 'd1', { text: 'A bigger object' }, 'human:me', now).changed, true);
  assert.equal(choosePlan(s.paths, s.id, 'd1', { option: 'a' }, 'human:me', now).changed, true, 'an option after own words is a change');
});

test('a changed choice on an approved plan is refused without yes, saying why, and keeps the approval; with yes it undoes it', () => {
  const { paths, id } = approved();
  for (const pick of [{ option: 'b' }, { text: 'A big object' }]) {
    assert.throws(() => choosePlan(paths, id, 'd1', pick, 'human:me', now), (e: Error & { code?: string }) => e.code === 'refused' && e.message === `${CHANGE_APPROVED} To change it anyway, run it again with --yes.`, JSON.stringify(pick));
  }
  const kept = readAnalysis(paths, id)!;
  assert.deepEqual([kept.approval?.version, kept.decisions![0]!.choice?.option], [1, 'a'], 'refused: the approval and the choice are as they were');
  const r = choosePlan(paths, id, 'd1', { option: 'b' }, 'human:me', now, true);
  assert.deepEqual([r.changed, r.plan.approval, r.plan.lapsed?.version, r.decision.choice?.option], [true, undefined, 1, 'b']);
  // Once it isn't approved, a change needs no yes.
  assert.equal(choosePlan(paths, id, 'd1', { option: 'a' }, 'human:me', now).changed, true);
  assert.ok(sameChoice({ option: 'a', by: '', at: '' }, { option: 'a' }));
  assert.ok(!sameChoice(undefined, { option: 'a' }), 'nothing chosen yet');
  assert.ok(!sameChoice({ option: null, text: 'x', by: '', at: '' }, { option: null, text: 'y' }));
});
