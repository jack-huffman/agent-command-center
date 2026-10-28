// How long a project's plans take (T-131): each recorded as it ends, the newest kept, and the typical time once
// there are a few.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PLAN_TIMES_KEPT, PLAN_TIMES_MIN, planTimes, recordPlanTime, typicalPlanMs } from '../src/plan-times.ts';
import { tempDir } from './support.ts';

const fresh = () => ({ analyses: join(tempDir(), 'analyses') });
const at = '2026-10-27T12:00:00Z';

test('durations are recorded oldest first, written whole, and only the last PLAN_TIMES_KEPT kept', () => {
  const paths = fresh();
  for (let i = 1; i <= PLAN_TIMES_KEPT + 3; i++) recordPlanTime(paths, { task: `ACME-${i}`, ms: i * 1000, at });
  const kept = planTimes(paths);
  assert.equal(kept.length, PLAN_TIMES_KEPT);
  assert.deepEqual([kept[0]!.task, kept.at(-1)!.task], ['ACME-4', `ACME-${PLAN_TIMES_KEPT + 3}`], 'the oldest drop out');
  assert.match(readFileSync(join(paths.analyses, 'plan-times.json'), 'utf8'), /^\[/);
});

test('edge cases: no file is no durations; a file that isn\'t a list, or holds a bad row, reads what it can; a zero duration isn\'t recorded', () => {
  const paths = fresh();
  assert.deepEqual(planTimes(paths), [], 'before the first plan');
  recordPlanTime(paths, { task: 'ACME-1', ms: 0, at });
  assert.deepEqual(planTimes(paths), [], 'a plan that took no time is no measure');
  mkdirSync(paths.analyses, { recursive: true });
  writeFileSync(join(paths.analyses, 'plan-times.json'), '{"not":"a list"}');
  assert.deepEqual(planTimes(paths), []);
  writeFileSync(join(paths.analyses, 'plan-times.json'), JSON.stringify([{ task: 'ACME-1', ms: 'soon', at }, { task: 'ACME-2', ms: 5000, at }, null]));
  assert.deepEqual(planTimes(paths).map((t) => t.task), ['ACME-2']);
  writeFileSync(join(paths.analyses, 'plan-times.json'), 'not json');
  assert.deepEqual(planTimes(paths), []);
});

test('the typical time is the middle duration, once there are PLAN_TIMES_MIN; fewer is none', () => {
  const ms = (...xs: number[]) => xs.map((x) => ({ ms: x }));
  assert.equal(PLAN_TIMES_MIN, 3);
  assert.equal(typicalPlanMs([]), null, 'none recorded');
  assert.equal(typicalPlanMs(ms(60_000, 120_000)), null, 'two is a guess');
  assert.equal(typicalPlanMs(ms(300_000, 60_000, 240_000)), 240_000, 'the middle, not the mean: one slow plan doesn\'t pull it');
  assert.equal(typicalPlanMs(ms(60_000, 120_000, 180_000, 240_000)), 150_000, 'an even count takes the two middles\' mean');
});
