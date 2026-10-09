import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EFFORTS } from '../../packages/core/src/config.ts';
import { FROM_WORDS, MODEL_CHOICES } from '../src/logic/agents.ts';
import { dispatchEffortArgs, dispatchEffortItems, EFFORT_WORDS, effortShown } from '../src/logic/efforts.ts';

const builder = (effort: string | null, from: string) => ({ effort, from: { effort: from } });
const labels = (items: { label: string; description: string }[]) => items.map((i) => `${i.label} · ${i.description}`);

test('Re-dispatch with… offers each level the model takes with its words, the one it runs with anyway first, and says which is the model\'s default (D-???)', () => {
  assert.deepEqual(Object.keys(EFFORT_WORDS), [...EFFORTS], 'every level has its words');
  // Nothing set: Claude Code's default, which on Opus 5.5 is medium.
  const none = dispatchEffortItems({}, builder(null, 'default'), 'claude-opus-5-5');
  assert.deepEqual(labels(none), [
    `medium · ${FROM_WORDS.default} · the model's default`,
    `low · ${EFFORT_WORDS.low}`, `high · ${EFFORT_WORDS.high}`, `xhigh · ${EFFORT_WORDS.xhigh}`, `max · ${EFFORT_WORDS.max}`,
  ]);
  assert.deepEqual(none.map((i) => i.value), [null, 'low', 'high', 'xhigh', 'max'], 'the first names none, so the default stays Claude Code\'s');
  // Set for this clone, in FROM_WORDS' words, as the model's choice says it.
  const clone = dispatchEffortItems({}, builder('xhigh', 'clone'), 'claude-opus-5-5');
  assert.deepEqual(labels(clone), [
    'xhigh · this clone', `low · ${EFFORT_WORDS.low}`, `medium · ${EFFORT_WORDS.medium} · the model's default`, `high · ${EFFORT_WORDS.high}`, `max · ${EFFORT_WORDS.max}`,
  ]);
  assert.equal(dispatchEffortItems({}, builder('high', 'project'), 'claude-sonnet-5-5')[0]!.description, 'project default · the model\'s default');
  // Picked for the task earlier: what a re-dispatch would run with.
  const kept = dispatchEffortItems({ run: { effort: 'max', effortPicked: true } }, builder('low', 'clone'), 'claude-fable-5-1');
  assert.deepEqual([kept[0]!.label, kept[0]!.description], ['max', 'picked for this task']);
  assert.equal(dispatchEffortItems({ run: { effort: 'max' } }, builder('low', 'clone'), 'claude-fable-5-1')[0]!.label, 'low', 'one only started with it follows the settings');
});

test('Re-dispatch with… offers only the levels the model takes: all for one acc doesn\'t know, none for one that takes none (D-???)', () => {
  // Opus 4.6 takes max but not xhigh, so the task's xhigh isn't offered, and nothing is put first.
  const older = dispatchEffortItems({ run: { effort: 'xhigh', effortPicked: true } }, builder(null, 'default'), 'claude-opus-4-6');
  assert.deepEqual(older.map((i) => i.label), ['low', 'medium', 'high', 'max']);
  assert.equal(older[2]!.description, `${EFFORT_WORDS.high} · the model's default`);
  assert.deepEqual(dispatchEffortItems({}, builder(null, 'default'), 'claude-haiku-4-5-20251001'), [], 'the step is skipped');
  const alias = dispatchEffortItems({}, builder(null, 'default'), 'opus');
  assert.deepEqual(labels(alias).slice(0, 1), [`Default · ${FROM_WORDS.default}`]);
  assert.deepEqual(alias.slice(1).map((i) => i.value), [...EFFORTS], 'no default to mark');
  // Each model acc offers takes some level.
  for (const m of MODEL_CHOICES) assert.ok(dispatchEffortItems({}, builder(null, 'default'), m.name).length >= 5, m.name);
});

test('Re-dispatch with… keeps an effort for the task only when it\'s one the settings wouldn\'t give it (D-???)', () => {
  assert.deepEqual(dispatchEffortArgs({}, builder(null, 'default'), null), [], 'none named: the model\'s default');
  assert.deepEqual(dispatchEffortArgs({}, builder('xhigh', 'clone'), 'xhigh'), [], 'the effort it runs with anyway: it keeps following the settings');
  assert.deepEqual(dispatchEffortArgs({ run: { effort: 'xhigh' } }, builder('xhigh', 'clone'), 'xhigh'), [], 'started with it, but never picked');
  assert.deepEqual(dispatchEffortArgs({}, builder(null, 'default'), 'high'), ['--effort', 'high']);
  assert.deepEqual(dispatchEffortArgs({ run: { effort: 'max', effortPicked: true } }, builder('max', 'project'), 'max'), ['--effort', 'max'], 'a pick made before is kept');
});

test('a builder\'s effort shows beside its model only when one was named and isn\'t the model\'s default (D-???)', () => {
  assert.equal(effortShown('claude-opus-5-5', 'xhigh'), 'xhigh');
  assert.equal(effortShown('claude-opus-5-5', 'medium'), null, 'Opus 5.5\'s default');
  assert.equal(effortShown('claude-sonnet-5-5', 'high'), null, 'Sonnet 5.5\'s default');
  assert.equal(effortShown('claude-sonnet-5-5', 'medium'), 'medium');
  assert.equal(effortShown('opus', 'high'), 'high', 'an alias has no known default');
  assert.equal(effortShown('claude-opus-5-5', undefined), null);
});
