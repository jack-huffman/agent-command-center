import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EFFORTS, parseConfig } from '../src/config.ts';
import { builderEffort, checkModelEffort, EFFORT_SOURCE, MODEL_EFFORTS, modelEfforts } from '../src/efforts.ts';
import { GENERIC_CONFIG } from './support.ts';

test('acc\'s list of each model\'s levels says where it came from and when, and each level is one Claude Code takes (D-???)', () => {
  assert.match(EFFORT_SOURCE.url, /^https:\/\/platform\.claude\.com\/docs\/en\/build-with-claude\/effort$/);
  assert.match(EFFORT_SOURCE.read, /^\d{4}-\d{2}-\d{2}$/);
  const models = Object.entries(MODEL_EFFORTS);
  assert.ok(models.length >= 10, `the list has ${models.length} models`);
  for (const [name, m] of models) {
    assert.ok(m.levels.every((l) => (EFFORTS as readonly string[]).includes(l)), name);
    assert.deepEqual([...m.levels], EFFORTS.filter((l) => m.levels.includes(l)), `${name}'s levels are in order`);
    assert.ok(m.default === null ? m.levels.length === 0 : m.levels.includes(m.default), `${name}'s default is one of its levels`);
  }
});

test('each model acc offers takes the levels the guide gives it, and its default (D-???)', () => {
  // Opus 5.5 and Haiku 5.5 default to medium; the others to high.
  assert.deepEqual(modelEfforts('claude-opus-5-5'), { levels: EFFORTS, default: 'medium' });
  assert.deepEqual(modelEfforts('claude-haiku-5-5'), { levels: EFFORTS, default: 'medium' });
  assert.equal(modelEfforts('claude-fable-5-1')?.default, 'high');
  assert.equal(modelEfforts('claude-sonnet-5-5')?.default, 'high');
  // Not every model that takes max takes xhigh.
  assert.deepEqual(modelEfforts('claude-opus-4-6')?.levels, ['low', 'medium', 'high', 'max']);
  // A date or a context suffix is the same model; an alias isn't known.
  assert.deepEqual(modelEfforts('claude-haiku-4-5-20251001'), { levels: [], default: null });
  assert.equal(modelEfforts('claude-opus-5-5[1m]')?.default, 'medium');
  assert.equal(modelEfforts('opus'), null);
  assert.equal(modelEfforts('claude-opus-5'), MODEL_EFFORTS['claude-opus-5'], 'not mistaken for claude-opus-5-5');
});

test('a level the model doesn\'t take is refused; one it takes, none, or an unknown model passes (D-???)', () => {
  assert.throws(() => checkModelEffort('claude-sonnet-4-6', 'xhigh'), /claude-sonnet-4-6 doesn't take effort xhigh\. It takes low, medium, high, max\. \(acc's list of each model's levels is from https:\/\/platform\.claude\.com\/docs\/en\/build-with-claude\/effort, read \d{4}-\d{2}-\d{2}\.\)/);
  assert.throws(() => checkModelEffort('claude-haiku-4-5-20251001', 'low'), /takes no effort level/);
  assert.doesNotThrow(() => checkModelEffort('claude-opus-5-5', 'xhigh'));
  assert.doesNotThrow(() => checkModelEffort('claude-haiku-4-5-20251001', null));
  assert.doesNotThrow(() => checkModelEffort('sonnet', 'xhigh'));
});

test('a task\'s builder effort: picked now, else picked before, else the builder\'s own (D-???)', () => {
  const config = parseConfig({ ...GENERIC_CONFIG, agents: { builder: { effort: 'low' } } }).config!;
  assert.deepEqual(builderEffort({ run: null }, config), { effort: 'low', picked: false });
  assert.deepEqual(builderEffort({ run: { effort: 'high' } }, config), { effort: 'low', picked: false }, 'only started with it');
  assert.deepEqual(builderEffort({ run: { effort: 'high', effortPicked: true } }, config), { effort: 'high', picked: true });
  assert.deepEqual(builderEffort({ run: { effort: 'high', effortPicked: true } }, config, 'max'), { effort: 'max', picked: true });
  assert.deepEqual(builderEffort({ run: null }, parseConfig(GENERIC_CONFIG).config!), { effort: null, picked: false }, 'none: Claude Code\'s default');
});
