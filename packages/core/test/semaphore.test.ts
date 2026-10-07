import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { heavySlots, MAX_HEAVY_SLOTS, setHeavySlots } from '../src/semaphore.ts';
import { tempDir } from './support.ts';

test('a machine runs one heavy check at once unless it says more: ACC_HEAVY_SLOTS, then machine.json, capped (D-080)', () => {
  const file = join(tempDir('acc-machine-'), 'machine.json');
  const env = { ACC_MACHINE_FILE: file };
  assert.equal(heavySlots(env), 1, 'nothing set: one');
  writeFileSync(file, JSON.stringify({ heavySlots: 2, other: 'kept' }));
  assert.equal(heavySlots(env), 2);
  assert.equal(heavySlots({ ...env, ACC_HEAVY_SLOTS: '3' }), 3, 'the environment wins');
  writeFileSync(file, JSON.stringify({ heavySlots: 50 }));
  assert.equal(heavySlots(env), MAX_HEAVY_SLOTS, 'capped');
  writeFileSync(file, '{ not json');
  assert.equal(heavySlots(env), 1, 'a file it can\'t read is one');
  writeFileSync(file, JSON.stringify({ heavySlots: 2, other: 'kept' }));
  assert.equal(setHeavySlots(4, env), 4);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { heavySlots: 4, other: 'kept' }, 'the rest of the file stays');
  for (const bad of [0, 2.5, 9, Number.NaN]) assert.throws(() => setHeavySlots(bad, env), /whole number from 1 to 8/, String(bad));
});
