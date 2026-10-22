// What a pull request changes under .acc/ that a person merges (T-102): a floors file that only raises
// floors goes through; anything else there, or a floors file that lowers, drops or relaxes one, doesn't.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { accChangesFor, floorsOnlyRise } from '../src/acc-changes.ts';
import { run } from '../src/exec.ts';
import { formatFloors } from '../src/ratchets.ts';
import { gitIn, makeRepo } from './support.ts';

const relaxed = { by: 'human:jordan', reason: 'a page went', at: '2026-10-22T09:00:00.000Z', was: 10 };

test('floors only rise when each is kept, of its kind, at its number or better, with no new relax on it', () => {
  const base = { tests: { floor: 10 }, violations: { ceiling: 5 } };
  assert.equal(floorsOnlyRise(base, base), true, 'unchanged');
  assert.equal(floorsOnlyRise(base, { tests: { floor: 12 }, violations: { ceiling: 3 }, 'screenshots.a11y': { floor: 40 } }), true, 'raised, lowered for a ceiling, and a new one');
  assert.equal(floorsOnlyRise(base, { tests: { floor: 9 }, violations: { ceiling: 5 } }), false, 'a floor lowered');
  assert.equal(floorsOnlyRise(base, { tests: { floor: 10 }, violations: { ceiling: 6 } }), false, 'a ceiling raised');
  assert.equal(floorsOnlyRise(base, { tests: { floor: 10 } }), false, 'one dropped');
  assert.equal(floorsOnlyRise(base, { tests: { ceiling: 10 }, violations: { ceiling: 5 } }), false, 'one changed its kind');
  assert.equal(floorsOnlyRise(base, { ...base, 'screenshots.a11y': { floor: 8, relaxed } }), false, 'an edge case: a new floor a person relaxed');
  assert.equal(floorsOnlyRise({ tests: { floor: 8, relaxed } }, { tests: { floor: 9 } }), true, 'a relaxed floor raised again drops the relax');
  assert.equal(floorsOnlyRise({}, {}), true, 'an edge case: no floors either side');
});

test('a branch\'s .acc/ changes leave out a floors file that only rose, and keep it when it lowered one or can\'t be read', () => {
  const dir = makeRepo({ '.acc/floors.json': formatFloors({ tests: { floor: 10 } }), 'a.txt': 'a\n' });
  const on = (branch: string, files: Record<string, string>) => {
    gitIn(dir, 'checkout', '-q', '-b', branch, 'main');
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    gitIn(dir, 'add', '-A');
    gitIn(dir, 'commit', '-q', '-m', branch);
    return accChangesFor(run, dir, 'main', branch);
  };
  assert.deepEqual(on('raised', { '.acc/floors.json': formatFloors({ tests: { floor: 12 } }) }), []);
  assert.deepEqual(on('also-rules', { '.acc/floors.json': formatFloors({ tests: { floor: 12 } }), '.acc/rules.md': 'Be kind.\n' }), ['.acc/rules.md']);
  assert.deepEqual(on('lowered', { '.acc/floors.json': formatFloors({ tests: { floor: 9 } }) }), ['.acc/floors.json']);
  assert.deepEqual(on('broken', { '.acc/floors.json': '{ "tests": ' }), ['.acc/floors.json'], 'an edge case: a file that isn\'t floors is a person\'s');
  assert.deepEqual(on('elsewhere', { 'a.txt': 'b\n' }), [], 'nothing under .acc/');
  assert.equal(accChangesFor(run, dir, 'main', 'no-such-branch'), null, 'an edge case: git can\'t list them');
});
