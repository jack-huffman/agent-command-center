import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { formatFloors, type RatchetFloors, readRelaxed, relaxFloor } from '../src/ratchets.ts';
import { storedFloorsLowered, storedFloorSpec } from '../src/stored-floors.ts';
import { GENERIC_CONFIG, tempDir } from './support.ts';

const config = parseConfig({ ...GENERIC_CONFIG, gates: { commands: { screenshots: 'node extension/scripts/looked.ts' }, ratchets: { tests: { command: 'node scripts/count-tests.mjs', limit: 'floor', label: 'tests' } } } }).config!;
const held = (head: Record<string, unknown>, base: Record<string, unknown>, relaxed: RatchetFloors['relaxed'] = []): RatchetFloors => ({ head: head as never, base: base as never, relaxed, raise: false });

test('a stored floor is named for a check in gates.commands; any other name is no floor of its own (T-102)', () => {
  assert.deepEqual(storedFloorSpec(config, 'screenshots.a11y'), { command: 'node extension/scripts/looked.ts', limit: 'floor', label: 'screenshots.a11y' });
  assert.equal(storedFloorSpec(config, 'screnshots.a11y'), null, 'an edge case: a check that isn\'t there');
  assert.equal(storedFloorSpec(config, 'screenshots'), null, 'the check alone counts nothing');
  assert.equal(storedFloorSpec(config, 'tests'), null, 'a ratchet is its own spec');
});

test('a person relaxes a screenshots floor as they do the tests floor: the file says who and why, and acc keeps the record (T-102)', () => {
  const dir = tempDir('stored-relax-');
  const floors = join(dir, '.acc', 'floors.json');
  const records = join(dir, 'state', 'relaxed.jsonl');
  const now = () => new Date('2026-10-22T09:00:00Z');
  mkdirSync(join(dir, '.acc'), { recursive: true });
  writeFileSync(floors, formatFloors({ tests: { floor: 669 }, 'screenshots.a11y': { floor: 440596 } }));
  const relax = (ratchet: string, to: number) => relaxFloor(records, floors, dir, config, { ratchet, to, reason: 'the old Setup page went', by: 'human:jordan', now, task: 'T-7' });
  assert.throws(() => relax('screenshots.clipped', 100), /screenshots\.clipped has no floor in .* yet, so there's nothing to relax/, 'an edge case: a stored floor the file doesn\'t keep');
  assert.throws(() => relax('nope.a11y', 100), /No ratchet nope\.a11y\. This project's ratchets: tests, or a check's floor in \.acc\/floors\.json, such as screenshots\.<what>\./);
  assert.throws(() => relax('screenshots.a11y', 450000), /isn't below screenshots\.a11y's floor/);
  const r = relax('screenshots.a11y', 430000);
  assert.deepEqual([r.ratchet, r.limit, r.was, r.to, r.task], ['screenshots.a11y', 'floor', 440596, 430000, 'T-7']);
  assert.deepEqual(JSON.parse(readFileSync(floors, 'utf8')), { tests: { floor: 669 }, 'screenshots.a11y': { floor: 430000, relaxed: { by: 'human:jordan', reason: 'the old Setup page went', at: '2026-10-22T09:00:00.000Z', was: 440596 } } });
  assert.deepEqual(readRelaxed(records), [r]);
});

test('a branch that lowers a stored floor is caught, unless a person relaxed it to that number or a lower one (T-102)', () => {
  const base = { tests: { floor: 669 }, 'screenshots.a11y': { floor: 100 }, 'screenshots.raw': { floor: 10 } };
  assert.equal(storedFloorsLowered('screenshots', held(base, base)), null, 'at its base');
  assert.equal(storedFloorsLowered('screenshots', held({ ...base, 'screenshots.a11y': { floor: 120 } }, base)), null, 'raised');
  assert.equal(storedFloorsLowered('screenshots', held({ ...base, tests: { floor: 1 } }, base)), null, 'a ratchet is its own gate\'s');
  assert.equal(storedFloorsLowered('screenshots', held({}, {})), null, 'an edge case: no floors at all');
  const lowered = held({ ...base, 'screenshots.a11y': { floor: 90 }, 'screenshots.raw': { floor: 9 } }, base);
  assert.equal(storedFloorsLowered('screenshots', lowered), '.acc/floors.json lowers screenshots.a11y from 100 to 90, lowers screenshots.raw from 10 to 9, and no person relaxed it. Put it back: only a person relaxes a floor, with acc gate relax <name> --to <n> --reason "<why>".');
  const record = { ratchet: 'screenshots.a11y', limit: 'floor' as const, to: 90, was: 100, by: 'human:jordan', reason: 'r', at: 'a', task: 'T-7', root: '/x' };
  assert.equal(storedFloorsLowered('screenshots', held({ ...base, 'screenshots.a11y': { floor: 90 } }, base, [record])), null, 'relaxed to it');
  assert.match(storedFloorsLowered('screenshots', held({ ...base, 'screenshots.a11y': { floor: 80 } }, base, [record]))!, /lowers screenshots\.a11y from 100 to 80/, 'below the relax still fails');
});
