// A run of acc's steps (T-65), as the extension reads them and the panel shows them: each event applied at
// the output's line, a step's own lines, which command lines run acc, and how each step and the result show.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StepEvent } from '../../packages/core/src/steps.ts';
import { applySteps, NO_RUN_STEPS, runsAcc, stepLines } from '../src/logic/run-steps.ts';
import { lineCount, shownSteps, STEP_LOOK } from '../src/model/run-steps.ts';
import { runResult } from '../src/model/run-view.ts';
import { runCard } from '../src/model/runs.ts';
import { pageSource } from './support.ts';

const step = (id: string, state: 'started' | 'done' | 'skipped' | 'failed', note?: string): StepEvent => ({ kind: 'step', id, label: `Label ${id}`, state, ...(note ? { note } : {}), at: 't' });
const result = (ok: boolean, sentence: string): StepEvent => ({ kind: 'result', ok, sentence, at: 't' });

test('applySteps applies only the events not seen before, each at the line it was read at; edge case: nothing new returns the same steps', () => {
  const one = applySteps(NO_RUN_STEPS, [step('a', 'started')], 0);
  assert.deepEqual(one, { seen: 1, steps: [{ id: 'a', label: 'Label a', state: 'started', note: null, from: 0, to: null }], result: null });
  assert.equal(applySteps(one, [step('a', 'started')], 9), one, 'the same events again change nothing');
  const two = applySteps(one, [step('a', 'started'), step('a', 'done'), step('b', 'started')], 3);
  assert.deepEqual(two.steps.map((s) => [s.id, s.state, s.from, s.to]), [['a', 'done', 0, 3], ['b', 'started', 3, null]]);
  const end = applySteps(two, [step('a', 'started'), step('a', 'done'), step('b', 'started'), step('c', 'skipped', 'No org'), step('b', 'failed', 'Run acc gate run first.'), result(false, 'Run acc gate run, then try again.')], 5);
  assert.deepEqual(end.steps.map((s) => [s.id, s.state, s.note]), [['a', 'done', null], ['b', 'failed', 'Run the checks first.'], ['c', 'skipped', 'No org']]);
  assert.deepEqual(end.result, { ok: false, sentence: 'Run the checks, then try again.' }, 'acc\'s words reach the person as processes (D-132)');
  assert.deepEqual(NO_RUN_STEPS, { seen: 0, steps: [], result: null });
});

test('a step ended without a start, as a skip is, begins and ends at one line; one started again opens again', () => {
  const s = applySteps(NO_RUN_STEPS, [step('x', 'done'), step('y', 'started'), step('y', 'done'), step('y', 'started')], 4);
  assert.deepEqual(s.steps.map((x) => [x.id, x.state, x.from, x.to]), [['x', 'done', 4, 4], ['y', 'started', 4, null]]);
});

test('stepLines takes a step\'s own lines, where lines[0] is `base` in the whole output; edge cases: one still running, one before the lines kept', () => {
  const lines = ['l10', 'l11', 'l12', 'l13'];
  assert.deepEqual(stepLines({ from: 11, to: 12 }, lines, 10), ['l11', 'l12']);
  assert.deepEqual(stepLines({ from: 12, to: null }, lines, 10), ['l12', 'l13']);
  assert.deepEqual(stepLines({ from: 2, to: 5 }, lines, 10), [], 'its lines were let go');
});

test('runsAcc: acc by name or path, or the extension\'s own acc.mjs after a program; never another command, or acc only named later', () => {
  for (const c of ['acc deploy dev', '/usr/local/bin/acc promote dev', 'NO_COLOR=1 acc land T-1', `ELECTRON_RUN_AS_NODE=1 '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin)' '/Users/a/ext/dist/bin/acc.mjs' deploy dev`, 'node /x/acc.mjs analyze T-1']) {
    assert.equal(runsAcc(c), true, c);
  }
  for (const c of ['sf org login web', 'echo acc', 'npm run acc', 'git commit -m "acc deploy"', '', 'accounts list']) assert.equal(runsAcc(c), false, c);
});

test('shownSteps: each state\'s look, a step still running when its run ended didn\'t finish, and only a failed step carries its rows', () => {
  const s = applySteps(NO_RUN_STEPS, [step('a', 'started'), step('a', 'done'), step('b', 'skipped'), step('c', 'started'), step('c', 'failed', 'Bad'), step('d', 'started')], 0);
  // Give c its line: begun at 1, ended at 2.
  const steps = { ...s, steps: s.steps.map((x) => (x.id === 'c' ? { ...x, from: 1, to: 2 } : x)) };
  const lines = ['fetching', 'Error: B.cls: Invalid type', 'deploying', ''];
  const running = shownSteps(steps, lines, 0, true, null);
  assert.deepEqual(running.map((x) => x.look), [STEP_LOOK.done, STEP_LOOK.skipped, STEP_LOOK.failed, STEP_LOOK.started]);
  assert.deepEqual(running[2]!.rows.map((r) => [r.kind, r.text]), [['error', 'B.cls: Invalid type'], ['note', 'deploying']]);
  assert.deepEqual(running.filter((x) => x.rows.length).map((x) => x.id), ['c']);
  assert.equal(shownSteps(steps, lines, 0, false, null)[3]!.look, STEP_LOOK.stopped);
  for (const look of Object.values(STEP_LOOK)) assert.ok(look.label && look.icon, 'each state has an icon and a label');
  assert.notEqual(STEP_LOOK.failed.tone, 'red');
  assert.equal(lineCount(lines), 3, 'blank lines aren\'t counted');
  assert.equal(lineCount([]), 0);
});

test('runResult takes acc\'s own result when it wrote one: its sentence, how long it took, and whether it worked; edge case: a stopped run is stopped whatever acc said', () => {
  const r = { endedAt: 4_000, startedAt: 0, code: 1, stopped: false, step: null };
  const failed = runResult(r, [], { ok: false, sentence: 'Validation against UAT didn\'t pass.' })!;
  assert.deepEqual([failed.look.label, failed.sentence, failed.exit], ['Failed', 'Validation against UAT didn\'t pass. It took 4 s.', 'It reported an error (exit code 1).']);
  // analyze exits 1 with questions, and that's an analysis made (D-052).
  const asked = runResult(r, [], { ok: true, sentence: 'T-1\'s analysis has 2 questions for you.' })!;
  assert.deepEqual([asked.look.label, asked.exit], ['Done', null]);
  assert.equal(runResult({ ...r, stopped: true }, [], { ok: true, sentence: 'x' })!.look.label, 'Stopped');
  assert.equal(runResult({ ...r, endedAt: null }, [], { ok: true, sentence: 'x' }), null, 'none while it runs');
});

test('runCard lists a run\'s steps and counts its lines; a run of acc with no step yet, or another command, has no list', () => {
  const base = { id: 'r', label: 'Deploy Dev', command: 'acc deploy dev', startedAt: 0, endedAt: 2_000, code: 0, stopped: false, lines: ['a', 'b', ''], prompt: null, step: null, cwd: '/w' };
  const steps = applySteps(NO_RUN_STEPS, [step('a', 'started'), step('a', 'done'), result(true, 'Deployed 1 file(s).')], 0);
  const c = runCard({ ...base, steps, base: 0 });
  assert.deepEqual([c.steps?.map((s) => s.label), c.lineCount, c.result?.sentence], [['Label a'], 2, 'Deployed 1 file(s). It took 2 s.']);
  assert.equal(runCard({ ...base, steps: NO_RUN_STEPS, base: 0 }).steps, null);
  assert.equal(runCard(base).steps, null);
  assert.equal(runCard(base).result?.sentence, 'It finished in 2 s.', 'without steps, the card is T-64\'s');
});

test('the panel lists a run\'s steps with renderRunSteps only when it has some, its rows folded under them; without steps, never', () => {
  const view = pageSource('run-view.ts');
  assert.match(view, /import \{ renderRunSteps \} from '\.\/run-steps\.ts';/);
  assert.match(view, /const body = run\.steps \? renderRunSteps\(run, run\.steps, /, 'only a run that reported steps');
  assert.equal([...view.matchAll(/renderRunSteps\(/g)].length, 1);
  const steps = pageSource('run-steps.ts');
  assert.match(steps, /if \(!run\.lineCount\) return \[list\];/, 'no fold for a run that printed nothing');
  assert.match(steps, /return \[list, fold, \.\.\.\(open \? \[output\(\)\] : \[\]\)\];/, 'its rows drawn only once the fold is open');
});
