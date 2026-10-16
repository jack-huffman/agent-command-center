import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { NO_STEPS, NOTE_MAX, readSteps, STEP_STATES, type StepEvent, stepsFrom, stepsTo, STEPS_VAR } from '../src/steps.ts';
import { tempDir } from './support.ts';

const now = () => new Date('2026-10-16T12:00:00Z');
const AT = '2026-10-16T12:00:00.000Z';
const read = (file: string): StepEvent[] => readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as StepEvent);

test('each step event is one JSON line: started, done, skipped and failed, with its label and a short note, and the result last', () => {
  const file = join(tempDir('steps-'), 'steps.jsonl');
  const s = stepsTo(file, now);
  assert.equal(s.on, true);
  s.start('branch', 'Check the branch');
  s.done('branch', '3 files changed');
  s.skip('check', 'Check in Acme UAT', 'No org to check against');
  s.start('deploy', 'Deploy');
  s.fail('deploy', 'A: Bad');
  s.result(false, 'The deploy to Dev failed.');
  assert.deepEqual(read(file), [
    { kind: 'step', id: 'branch', label: 'Check the branch', state: 'started', at: AT },
    { kind: 'step', id: 'branch', label: 'Check the branch', state: 'done', note: '3 files changed', at: AT },
    { kind: 'step', id: 'check', label: 'Check in Acme UAT', state: 'skipped', note: 'No org to check against', at: AT },
    { kind: 'step', id: 'deploy', label: 'Deploy', state: 'started', at: AT },
    { kind: 'step', id: 'deploy', label: 'Deploy', state: 'failed', note: 'A: Bad', at: AT },
    { kind: 'result', ok: false, sentence: 'The deploy to Dev failed.', at: AT },
  ]);
  assert.deepEqual([...STEP_STATES], ['started', 'done', 'skipped', 'failed']);
  assert.deepEqual([s.used, s.ended], [true, true]);
  // Nothing comes after the result.
  s.start('late', 'Late');
  assert.equal(read(file).length, 6);
  // No temp file is left beside it: each write is renamed into place.
  assert.deepEqual(readdirSync(join(file, '..')), ['steps.jsonl']);
});

test('the result closes a step still open: done with a result that worked, failed with its sentence with one that didn\'t', () => {
  const ok = join(tempDir('steps-'), 'ok.jsonl');
  const a = stepsTo(ok, now);
  a.start('save', 'Save the analysis');
  a.result(true, 'T-1 is ready to build.');
  assert.deepEqual(read(ok).map((e) => (e.kind === 'step' ? [e.id, e.state, e.note] : ['result', e.ok, e.sentence])), [['save', 'started', undefined], ['save', 'done', undefined], ['result', true, 'T-1 is ready to build.']]);
  const bad = join(tempDir('steps-'), 'bad.jsonl');
  const b = stepsTo(bad, now);
  b.start('push', 'Push the branch');
  b.result(false, 'git push refused task/T-1: rejected');
  assert.deepEqual(read(bad).slice(1, 2), [{ kind: 'step', id: 'push', label: 'Push the branch', state: 'failed', note: 'git push refused task/T-1: rejected', at: AT }]);
});

test('step() wraps a step: done when it returns, failed with the error\'s message when it throws, which it throws on', () => {
  const file = join(tempDir('steps-'), 'steps.jsonl');
  const s = stepsTo(file, now);
  assert.equal(s.step('one', 'One', () => 7), 7);
  assert.throws(() => s.step('two', 'Two', () => { throw new Error('No commit "x" here.'); }), /No commit "x" here\./);
  assert.deepEqual(read(file).map((e) => (e.kind === 'step' ? `${e.id} ${e.state}${e.note ? `: ${e.note}` : ''}` : 'result')), ['one started', 'one done', 'two started', 'two failed: No commit "x" here.']);
});

test('a note is one line, cut to NOTE_MAX, and an empty note is left out', () => {
  const file = join(tempDir('steps-'), 'steps.jsonl');
  const s = stepsTo(file, now);
  s.start('a', 'A', '   ');
  s.fail('a', `first line\nsecond ${'x'.repeat(NOTE_MAX * 2)}`);
  const [first, second] = read(file);
  assert.equal(first?.kind === 'step' && first.note, undefined);
  const note = second?.kind === 'step' ? second.note! : '';
  assert.equal(note.length, NOTE_MAX);
  assert.ok(note.startsWith('first line second x') && note.endsWith('…'));
});

test('a write that fails never throws: the work goes on, and the next write that can lands whole', () => {
  const dir = join(tempDir('steps-'), 'gone');
  const file = join(dir, 'steps.jsonl');
  const s = stepsTo(file, now);
  assert.doesNotThrow(() => s.start('branch', 'Check the branch'));
  assert.equal(existsSync(file), false, 'its folder isn\'t there');
  mkdirSync(dir);
  s.done('branch');
  assert.deepEqual(read(file).map((e) => e.kind === 'step' && e.state), ['started', 'done'], 'the file is written whole each time, so the missed line is in it');
  // A file that's a folder now: still no throw.
  const blocked = join(tempDir('steps-'), 'blocked');
  mkdirSync(`${blocked}.tmp`);
  assert.doesNotThrow(() => stepsTo(blocked, now).result(true, 'Done.'));
});

test('without ACC_STEPS nothing is written, nothing counts as used, and NO_STEPS is the same', () => {
  const dir = tempDir('steps-');
  for (const s of [stepsFrom({}, now), stepsFrom({ [STEPS_VAR]: '  ' }, now), NO_STEPS]) {
    assert.equal(s.on, false);
    s.start('a', 'A');
    assert.equal(s.step('b', 'B', () => 'went'), 'went');
    s.result(true, 'Done.');
    assert.deepEqual([s.used, s.ended], [false, false]);
  }
  assert.deepEqual(readdirSync(dir), []);
  const file = join(dir, 'named.jsonl');
  const on = stepsFrom({ [STEPS_VAR]: file }, now);
  on.start('a', 'A');
  assert.equal(read(file).length, 1);
});

test('readSteps reads each event and skips a line that isn\'t one: junk, half a line, an unknown state', () => {
  const file = join(tempDir('steps-'), 'mixed.jsonl');
  writeFileSync(file, [
    JSON.stringify({ kind: 'step', id: 'a', label: 'A', state: 'started', at: AT }),
    'not json',
    '{"kind":"step","id":"b"',
    JSON.stringify({ kind: 'step', id: 'c', label: 'C', state: 'paused', at: AT }),
    JSON.stringify({ kind: 'result', ok: 'yes', sentence: 'x', at: AT }),
    JSON.stringify({ kind: 'result', ok: true, sentence: 'Done.', at: AT }),
    '',
  ].join('\n'));
  assert.deepEqual(readSteps(readFileSync(file, 'utf8')).map((e) => e.kind === 'step' ? e.id : e.sentence), ['a', 'Done.']);
  assert.deepEqual(readSteps(''), []);
});
