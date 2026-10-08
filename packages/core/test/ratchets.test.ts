// Ratchets (GH-99): a number that may only get better, held to a floor or a ceiling in .acc/floors.json.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig, type RatchetSpec } from '../src/config.ts';
import {
  carriesOver, formatFloors, judgeRatchet, mergeFloors, parseFloors, parseNumber, type RatchetFloors, ratchetLine, readFloors, readRatchet, readRelaxed, relaxFloor, withRaises,
} from '../src/ratchets.ts';
import { type Receipt, satisfies } from '../src/receipts.ts';
import { GENERIC_CONFIG, ok, tempDir } from './support.ts';

const TESTS: RatchetSpec = { command: 'node scripts/count-tests.mjs', limit: 'floor', label: 'tests' };
const VIOLATIONS: RatchetSpec = { command: 'sf code-analyzer run', limit: 'ceiling', label: 'violations' };
const held = (head: Record<string, unknown>, base: Record<string, unknown> = head, more: Partial<RatchetFloors> = {}): RatchetFloors =>
  ({ head: head as RatchetFloors['head'], base: base as RatchetFloors['base'], relaxed: [], raise: false, ...more });
const judge = (spec: RatchetSpec, value: number, floors: RatchetFloors, name = spec.label) => judgeRatchet(name, spec, value, floors, 'main');
const brief = (o: ReturnType<typeof judge>) => [o.status, o.summary];
const numbers = (o: ReturnType<typeof judge>) => o.details?.ratchet;

test('a floor: below it fails, at it passes, above it passes and says by how much', () => {
  const floors = held({ tests: { floor: 669 } });
  const below = judge(TESTS, 660, floors);
  assert.deepEqual(brief(below), ['fail', 'tests 660 is below its floor 669, by 9. Make it 669 or better. If this change has to make it worse, block and say why: only a person relaxes a floor.']);
  assert.deepEqual(numbers(below), { label: 'tests', limit: 'floor', value: 660, floor: 669, base: 669, diff: -9 });
  assert.equal(satisfies(below), false);
  assert.deepEqual(brief(judge(TESTS, 669, floors)), ['pass', 'tests 669, at its floor.']);
  const above = judge(TESTS, 674, floors);
  assert.deepEqual(brief(above), ['pass', 'tests 674 beats the floor 669 by 5.']);
  assert.deepEqual(numbers(above), { label: 'tests', limit: 'floor', value: 674, floor: 669, base: 669, diff: 5 }, 'nothing raised where acc may not raise it');
  assert.equal(satisfies(above), true);
});

test('a ceiling: above it fails, at it passes, below it passes, and the difference is negative', () => {
  const floors = held({ violations: { ceiling: 10 } });
  assert.deepEqual(brief(judge(VIOLATIONS, 12, floors)), ['fail', 'violations 12 is above its ceiling 10, by 2. Make it 10 or better. If this change has to make it worse, block and say why: only a person relaxes a ceiling.']);
  assert.deepEqual(brief(judge(VIOLATIONS, 10, floors)), ['pass', 'violations 10, at its ceiling.']);
  const fewer = judge(VIOLATIONS, 7, floors, 'violations');
  assert.deepEqual(brief(fewer), ['pass', 'violations 7 beats the ceiling 10 by 3.']);
  assert.equal((numbers(fewer) as { diff: number }).diff, -3);
  assert.deepEqual(brief(judge(VIOLATIONS, 7, { ...floors, raise: true })), ['pass', 'violations 7 beats the ceiling 10: raised it in .acc/floors.json. Commit that file, then run acc gate run again.']);
  assert.equal(judge(VIOLATIONS, 7, held({ violations: { floor: 10 } })).status, 'error', 'the file and the config disagree on which way it goes');
});

test('where acc may raise it, a better number is raised, and satisfies nothing until it\'s committed; the first number is the first floor', () => {
  const raised = judge(TESTS, 674, held({ tests: { floor: 669 } }, { tests: { floor: 669 } }, { raise: true }));
  assert.deepEqual(brief(raised), ['pass', 'tests 674 beats the floor 669: raised it in .acc/floors.json. Commit that file, then run acc gate run again.']);
  assert.deepEqual((numbers(raised) as { raised: unknown }).raised, { from: 669, to: 674 });
  assert.equal(satisfies(raised), false, 'acc done waits for the commit that records it');
  const at = judge(TESTS, 669, held({ tests: { floor: 669 } }, {}, { raise: true }));
  assert.deepEqual([at.status, (numbers(at) as { raised?: unknown }).raised, satisfies(at)], ['pass', undefined, true], 'at its floor: nothing to raise');

  const first = judge(TESTS, 674, held({}, {}, { raise: true }));
  assert.deepEqual(brief(first), ['pass', 'tests 674, the first floor: wrote it in .acc/floors.json. Commit that file, then run acc gate run again.']);
  assert.deepEqual(numbers(first), { label: 'tests', limit: 'floor', value: 674, floor: null, base: null, diff: null, raised: { from: null, to: 674 } });
  assert.deepEqual(brief(judge(TESTS, 674, held({}))), ['pass', 'tests 674. No floor yet.'], 'elsewhere it passes, and writes nothing');
});

test('a floor the branch made worse by hand fails, unless a person relaxed it to that number; one it dropped fails too', () => {
  const lowered = held({ tests: { floor: 640 } }, { tests: { floor: 669 } });
  assert.deepEqual(brief(judge(TESTS, 650, lowered)), ['fail', '.acc/floors.json lowers tests\'s floor to 640, from 669 on main, and no person relaxed it. Put it back to 669: only a person relaxes a floor, with acc gate relax.']);
  const record = { ratchet: 'tests', limit: 'floor' as const, to: 640, was: 669, by: 'human:jordan', reason: 'a slow suite moved out', at: '', root: '/r' };
  assert.equal(judge(TESTS, 650, { ...lowered, relaxed: [record] }).status, 'pass', 'a person relaxed it to 640');
  assert.equal(judge(TESTS, 650, { ...lowered, relaxed: [{ ...record, to: 645 }] }).status, 'fail', 'to another number: it doesn\'t count');
  assert.equal(judge(TESTS, 635, { ...lowered, relaxed: [record] }).status, 'fail', 'and the relaxed floor still holds');
  assert.match(judge(TESTS, 680, held({}, { tests: { floor: 669 } })).summary, /drops tests's floor, from 669 on main, and no person relaxed it/);
  // Raised on the branch: held to the branch's.
  assert.deepEqual(brief(judge(TESTS, 672, held({ tests: { floor: 674 } }, { tests: { floor: 669 } }))), ['fail', 'tests 672 is below its floor 674, by 2. Make it 674 or better. If this change has to make it worse, block and say why: only a person relaxes a floor.']);
  assert.deepEqual(numbers(judge(TESTS, 674, held({ tests: { floor: 674 } }, { tests: { floor: 669 } }))), { label: 'tests', limit: 'floor', value: 674, floor: 674, base: 669, diff: 5 }, 'the difference is from where the branch began');
});

test('the number is the last line, alone: anything else, or a command that failed, is an error, never a pass', () => {
  assert.equal(parseNumber('counting…\n674\n'), 674);
  assert.equal(parseNumber('\x1b[32m81.5\x1b[0m\n\n'), 81.5);
  assert.equal(parseNumber('-3\n'), -3);
  for (const t of ['', '\n\n', 'ℹ tests 674', '674 tests', '674\ndone', 'NaN', '1e3']) assert.equal(parseNumber(t), null, JSON.stringify(t));
  const floors = held({ tests: { floor: 669 } });
  assert.deepEqual(brief(readRatchet('tests', TESTS, ok('Counted no tests\n'), floors, 'main')), ['error', 'tests couldn\'t be measured: the command\'s last line isn\'t a number ("Counted no tests").']);
  assert.deepEqual(brief(readRatchet('tests', TESTS, ok(''), floors, 'main')), ['error', 'tests couldn\'t be measured: the command\'s last line isn\'t a number.']);
  assert.deepEqual(brief(readRatchet('tests', TESTS, { code: 1, stdout: '674\n', stderr: 'a file didn\'t load\n' }, floors, 'main')), ['error', 'tests couldn\'t be measured: a file didn\'t load.'], 'a number from a command that failed doesn\'t count');
  assert.equal(readRatchet('tests', TESTS, ok('674\n'), floors, 'main').status, 'pass');
});

test('the floors file: one entry a ratchet, a floor or a ceiling, read strictly and written in a stable order', () => {
  assert.deepEqual(parseFloors('{ "tests": { "floor": 669 }, "violations": { "ceiling": 3 } }'), { tests: { floor: 669 }, violations: { ceiling: 3 } });
  for (const bad of ['', '[]', '{ "tests": 669 }', '{ "tests": { "floor": "669" } }', '{ "tests": { "floor": 1, "ceiling": 2 } }', '{ "tests": { "floor": 1, "other": 2 } }', '{ "tests": { "floor": 1, "relaxed": "yes" } }']) {
    assert.equal(parseFloors(bad), null, bad);
  }
  assert.equal(formatFloors({ tests: { floor: 669 } }), '{\n  "tests": {\n    "floor": 669\n  }\n}\n');
  const relaxed = { by: 'human:jordan', reason: 'why', at: 'now', was: 669 };
  assert.deepEqual(Object.entries(withRaises({ a: { floor: 1 }, tests: { floor: 640, relaxed } }, [{ gate: 'tests', limit: 'floor', to: 674 }, { gate: 'z', limit: 'ceiling', to: 2 }])), [['a', { floor: 1 }], ['tests', { floor: 674 }], ['z', { ceiling: 2 }]], 'a raise keeps the order, drops the relaxing, and a new ratchet goes last');
  const dir = tempDir('floors-');
  assert.deepEqual(readFloors(join(dir, 'none.json')), {});
  writeFileSync(join(dir, 'bad.json'), '{ "tests": "lots" }');
  assert.throws(() => readFloors(join(dir, 'bad.json')), /isn't a list of floors/);
});

test('two branches that both raised floors merge to the better of each; one that a person relaxed is left for a person', () => {
  const f = (o: Record<string, unknown>) => formatFloors(o as never);
  const common = f({ tests: { floor: 669 }, violations: { ceiling: 10 } });
  assert.equal(mergeFloors(common, f({ tests: { floor: 672 }, violations: { ceiling: 10 } }), f({ tests: { floor: 674 }, violations: { ceiling: 10 } })), f({ tests: { floor: 674 }, violations: { ceiling: 10 } }), 'both raised one floor: the higher');
  assert.equal(mergeFloors(common, f({ tests: { floor: 669 }, violations: { ceiling: 6 } }), f({ tests: { floor: 669 }, violations: { ceiling: 8 } })), f({ tests: { floor: 669 }, violations: { ceiling: 6 } }), 'both tightened a ceiling: the lower');
  assert.equal(mergeFloors(common, f({ tests: { floor: 680 }, violations: { ceiling: 10 } }), f({ tests: { floor: 669 }, violations: { ceiling: 4 } })), f({ tests: { floor: 680 }, violations: { ceiling: 4 } }), 'different ratchets: both kept');
  assert.equal(mergeFloors('', f({ tests: { floor: 672 }, lint: { ceiling: 0 } }), f({ tests: { floor: 674 } })), f({ tests: { floor: 674 }, lint: { ceiling: 0 } }), 'a file both added: the base branch\'s ratchets first, then the branch\'s new one');
  const relaxed = { tests: { floor: 640, relaxed: { by: 'human:jordan', reason: 'why', at: 'now', was: 669 } }, violations: { ceiling: 10 } };
  assert.equal(mergeFloors(common, f({ tests: { floor: 674 }, violations: { ceiling: 10 } }), f(relaxed)), null, 'the base branch relaxed it: a person decides');
  assert.equal(mergeFloors(common, f(relaxed), f({ tests: { floor: 674 }, violations: { ceiling: 10 } })), null, 'the branch relaxed it: a person decides');
  assert.equal(mergeFloors(common, f({ tests: { floor: 674 } }), f({ tests: { floor: 672 }, violations: { ceiling: 10 } })), null, 'a side dropped one');
  assert.equal(mergeFloors(common, f({ tests: { ceiling: 674 }, violations: { ceiling: 10 } }), f({ tests: { floor: 672 }, violations: { ceiling: 10 } })), null, 'a side changed its kind');
  assert.equal(mergeFloors(common, '{ "tests": ', f({ tests: { floor: 672 } })), null, 'a side that isn\'t floors');
});

test('a person relaxes a floor in a checkout, with a reason: the file says who and why, and acc keeps a record', () => {
  const config = parseConfig({ ...GENERIC_CONFIG, gates: { ratchets: { tests: TESTS } } }).config!;
  const dir = tempDir('relax-');
  const floors = join(dir, '.acc', 'floors.json');
  const records = join(dir, 'state', 'relaxed.jsonl');
  const now = () => new Date('2026-10-07T09:00:00Z');
  const relax = (to: number, reason = 'the slow suite moved to its own job', ratchet = 'tests') => relaxFloor(records, floors, dir, config, { ratchet, to, reason, by: 'human:jordan', now, task: 'GH-5' });
  assert.throws(() => relax(640), /tests has no floor in .* yet, so there's nothing to relax/);
  mkdirSync(join(dir, '.acc'), { recursive: true });
  writeFileSync(floors, formatFloors({ tests: { floor: 669 } }));
  assert.throws(() => relax(640, '  '), /Say why it's relaxed/);
  assert.throws(() => relax(640, 'why', 'nope'), /No ratchet nope\. This project's ratchets: tests\./);
  assert.throws(() => relax(675), /675 isn't below tests's floor, 669, so it doesn't relax it/);
  assert.throws(() => relax(669), /isn't below/);
  assert.ok(!existsSync(records), 'nothing recorded for a refusal');

  const r = relax(640);
  assert.deepEqual(r, { ratchet: 'tests', limit: 'floor', to: 640, was: 669, by: 'human:jordan', reason: 'the slow suite moved to its own job', at: '2026-10-07T09:00:00.000Z', task: 'GH-5', root: dir });
  assert.deepEqual(JSON.parse(readFileSync(floors, 'utf8')), { tests: { floor: 640, relaxed: { by: 'human:jordan', reason: 'the slow suite moved to its own job', at: '2026-10-07T09:00:00.000Z', was: 669 } } });
  assert.deepEqual(readRelaxed(records), [r]);
});

test('a commit that only records the floors acc raised on its parent carries its parent\'s checks; anything else is checked afresh', () => {
  const receipt = (gate: string, ratchet?: Record<string, unknown>): Receipt => ({ gate, sha: 'p', env: 'main', status: 'pass', startedAt: '', finishedAt: '', durationMs: 0, summary: '', command: null, log: null, ...(ratchet ? { details: { ratchet } } : {}) });
  const parent = { tests: { floor: 669 }, violations: { ceiling: 10 } };
  const measured = { tests: receipt('tests', { label: 'tests', limit: 'floor', value: 674, floor: 669, base: 669, diff: 5, raised: { from: 669, to: 674 } }), typecheck: receipt('typecheck') };
  assert.equal(carriesOver(parent, { ...parent, tests: { floor: 674 } }, measured), true);
  assert.equal(carriesOver(parent, { ...parent, tests: { floor: 673 } }, measured), false, 'not the number measured');
  assert.equal(carriesOver(parent, { ...parent, violations: { ceiling: 9 } }, measured), false, 'a ratchet the parent didn\'t raise');
  assert.equal(carriesOver(parent, { tests: { floor: 674 } }, measured), false, 'an entry dropped');
  assert.equal(carriesOver(parent, parent, measured), false, 'nothing changed');
  assert.equal(carriesOver(parent, { ...parent, tests: { floor: 674, relaxed: { by: 'b', reason: 'r', at: 'a', was: 669 } } }, measured), false);
  const notRaised = { tests: receipt('tests', { label: 'tests', limit: 'floor', value: 674, floor: 669, base: 669, diff: 5 }) };
  assert.equal(carriesOver(parent, { ...parent, tests: { floor: 674 } }, notRaised), false, 'acc didn\'t raise it there');
});

test('pages show a ratchet from the environment\'s floor to this commit\'s number', () => {
  assert.equal(ratchetLine({ label: 'tests', value: 674, base: 669, diff: 5 }), 'tests 669 → 674 (+5)');
  assert.equal(ratchetLine({ label: 'violations', value: 7, base: 10, diff: -3 }), 'violations 10 → 7 (−3)');
  assert.equal(ratchetLine({ label: 'coverage', value: 81.25, base: 81.25, diff: 0 }), 'coverage 81.25 → 81.25 (±0)');
  assert.equal(ratchetLine({ label: 'tests', value: 674, base: null, diff: null }), 'tests 674 (first floor)');
});
