// Environments: every promotion path.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { envTypeWords, inPromotionOrder } from '../src/logic/environments.ts';
import { environmentsModel, promotionPaths } from '../src/model/environments.ts';
import { envs, hub, pageSource } from './support.ts';

test('environments draw every promotion path, including skipping QA (D-018)', () => {
  assert.deepEqual(promotionPaths(envs), [['devbox', 'sandbox', 'production'], ['devbox', 'production']]);
  const m = environmentsModel(hub()).projects[0]!;
  const devbox = m.envs.find((e) => e.branch === 'devbox')!;
  assert.deepEqual(devbox.badges, ['default', 'checked out']);
  assert.ok(!devbox.actions.some((a) => a.label === 'Compare'), 'no comparing a branch with itself');
  assert.deepEqual(m.envs.find((e) => e.branch === 'production')!.badges, ['protected']);
});

test('environment cards run in promotion order, dev to production, and say their type in plain words (T-44)', () => {
  const m = environmentsModel(hub()).projects[0]!;
  assert.deepEqual(m.envs.map((e) => e.branch), ['devbox', 'sandbox', 'production']);
  assert.deepEqual(m.envs.map((e) => e.typeWords), ['Developer sandbox', 'Partial copy sandbox', 'Production']);
  assert.equal(envTypeWords('developer_pro'), 'Developer Pro sandbox');
  assert.equal(envTypeWords('none'), 'Branch');
  assert.equal(envTypeWords('odd_kind'), 'odd kind', 'an unknown type still reads');
});

test('promotion order keeps the config order for ties and for environments on no path, and survives a loop (edge case)', () => {
  const e = (branch: string, promotesTo: string[] = []) => ({ branch, promotesTo });
  assert.deepEqual(inPromotionOrder([e('prod'), e('qa', ['prod']), e('dev', ['qa'])]).map((x) => x.branch), ['dev', 'qa', 'prod']);
  assert.deepEqual(inPromotionOrder([e('b', ['prod']), e('a', ['prod']), e('prod')]).map((x) => x.branch), ['b', 'a', 'prod']);
  assert.deepEqual(inPromotionOrder([e('solo'), e('dev', ['prod']), e('prod')]).map((x) => x.branch), ['dev', 'prod', 'solo']);
  assert.deepEqual(inPromotionOrder([e('x', ['y']), e('y', ['x'])]).map((x) => x.branch), ['x', 'y'], 'a loop keeps the config order');
  assert.deepEqual(inPromotionOrder([]), []);
});

test('a card whose environment promotes nowhere draws no Promotes to row (T-44)', () => {
  const src = pageSource('environments.ts');
  assert.ok(src.includes("...(e.promotesTo.length ? [el('dt', '', 'Promotes to'), el('dd', 'mono', e.promotesTo.join(', '))] : [])"));
  assert.deepEqual(environmentsModel(hub()).projects[0]!.envs.find((x) => x.branch === 'production')!.promotesTo, []);
});
