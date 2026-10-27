// The Windows smoke run's judgment of a doctor run (D-T-123): acc ran, printed the machine's steps, and each
// step it needs passed. A step for a tool the runner lacks may fail; acc not running at all may not.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { smokeProblem, stepsFor, toolsFor } from '../windows-smoke.ts';

const steps = (...s: [string, string][]) => JSON.stringify(s.map(([id, status]) => ({ id, status, detail: `${id} detail` })));

test('a doctor run that passes each needed step passes, even with another step failing', () => {
  const out = steps(['A1.git', 'pass'], ['A1.node', 'pass'], ['A1.gh', 'pass'], ['A1.sf', 'pass'], ['A1.claude', 'fail']);
  assert.equal(smokeProblem(1, out, '', stepsFor(true)), null);
  assert.deepEqual(stepsFor(true), ['A1.git', 'A1.node', 'A1.gh', 'A1.sf']);
  assert.deepEqual(toolsFor(false), ['git', 'node', 'npm', 'gh'], 'npm, a .cmd shim on Windows, always');
  assert.deepEqual(toolsFor(true).at(-1), 'sf');
});

test('edge case: acc not running, printing no steps, or a needed step failing or missing is a problem with why', () => {
  assert.match(smokeProblem(127, '', 'sh: acc: not found', stepsFor(false))!, /^exited 127: sh: acc: not found/);
  assert.match(smokeProblem(1, 'x acc needs Node 20 or later', '', stepsFor(false))!, /^printed no steps/);
  assert.equal(smokeProblem(0, '[]', '', stepsFor(false)), 'printed no steps');
  assert.equal(smokeProblem(1, steps(['A1.git', 'pass'], ['A1.node', 'pass'], ['A1.gh', 'fail']), '', stepsFor(false)), 'A1.gh didn\'t pass: fail, A1.gh detail');
  assert.equal(smokeProblem(0, steps(['A1.git', 'pass'], ['A1.node', 'pass'], ['A1.gh', 'pass']), '', stepsFor(true)), 'A1.sf didn\'t pass: it wasn\'t there');
});
