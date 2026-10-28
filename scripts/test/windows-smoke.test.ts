// The Windows smoke run's judgment of a doctor run (D-209): acc ran, printed the machine's steps, and each
// step it needs passed. A step for a tool the runner lacks may fail; acc not running at all may not.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STEPS } from '../../packages/core/src/onboarding/steps.ts';
import { machineStepCount, smokeProblem, stepsFor, toolsFor } from '../windows-smoke.ts';

const steps = (...s: [string, string][]) => JSON.stringify(s.map(([id, status]) => ({ id, status, detail: `${id} detail` })));
/** The machine steps a doctor run checks, each passing but those named. */
const machine = (failing: string[] = []) => STEPS.filter((s) => s.part === 'machine').map((s) => [s.id, failing.includes(s.id) ? 'fail' : 'pass'] as [string, string]);

test('a doctor run that passes each needed step passes, even with another step failing', () => {
  const out = steps(...machine(['A1.claude', 'A1.winget']));
  assert.equal(smokeProblem(1, out, '', stepsFor(true, 'win32')), null);
  assert.deepEqual(stepsFor(true, 'darwin'), ['A1.git', 'A1.node', 'A1.npm', 'A1.gh', 'A1.sf']);
  assert.deepEqual(stepsFor(false, 'win32'), ['A1.git', 'A1.sh', 'A1.node', 'A1.npm', 'A1.gh'], 'Windows needs Git for Windows\' sh (T-133)');
  assert.deepEqual(toolsFor(false), ['git', 'node', 'npm', 'gh'], 'npm, a .cmd shim on Windows, always');
  assert.deepEqual(toolsFor(true).at(-1), 'sf');
});

test('edge case: acc not running, printing no steps, or a needed step failing or missing is a problem with why', () => {
  assert.match(smokeProblem(127, '', 'sh: acc: not found', stepsFor(false))!, /^exited 127: sh: acc: not found/);
  assert.match(smokeProblem(1, 'x acc needs Node 20 or later', '', stepsFor(false))!, /^printed no steps/);
  assert.equal(smokeProblem(0, '[]', '', stepsFor(false)), 'printed no steps');
  assert.equal(smokeProblem(1, steps(...machine(['A1.gh'])), '', stepsFor(false, 'darwin')), 'A1.gh didn\'t pass: fail, A1.gh detail');
  assert.equal(smokeProblem(1, steps(...machine(['A1.sh'])), '', stepsFor(false, 'win32')), 'A1.sh didn\'t pass: fail, A1.sh detail');
});

test('edge case: the smoke run counts the machine steps Check this machine ran, and fails on too few (T-133)', () => {
  assert.equal(machineStepCount(), STEPS.filter((s) => s.part === 'machine').length);
  assert.ok(machineStepCount() >= 15, `${machineStepCount()} machine steps`);
  const short = steps(['A1.git', 'pass'], ['A1.node', 'pass'], ['A1.gh', 'pass']);
  assert.equal(smokeProblem(0, short, '', stepsFor(false, 'darwin')), `checked 3 machine steps, not ${machineStepCount()}`);
  assert.equal(smokeProblem(0, steps(...machine().filter(([id]) => id !== 'A1.sf')), '', stepsFor(true, 'darwin'), machineStepCount() - 1), 'A1.sf didn\'t pass: it wasn\'t there');
});
