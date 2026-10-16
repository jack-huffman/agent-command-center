/**
 * Runs of acc in the output panel as a list of steps (T-65): a deploy in progress, a promotion that failed at
 * its check in the org, and a dispatch that finished. Each is what acc's steps file and output would hold.
 */
import type { RunStep, RunSteps } from '../../src/logic/run-steps.ts';
import type { RunInput } from '../../src/model/runs.ts';
import { MIN, ROOT } from './shared.ts';

export type StepSample = 'steps-running' | 'steps-failed' | 'steps-done';

/** Each sample's run id, which the panel opens on. */
export const STEP_SAMPLE_ID: Record<StepSample, string> = { 'steps-running': 'r-deploy-steps', 'steps-failed': 'r-promote-steps', 'steps-done': 'r-dispatch-steps' };

/** The step a sample opens, to show its own rows: the promotion's failed check. */
export const STEP_SAMPLE_OPEN: Partial<Record<StepSample, string>> = { 'steps-failed': 'check' };

const s = (id: string, label: string, state: RunStep['state'], from: number, to: number | null, note: string | null = null): RunStep => ({ id, label, state, note, from, to });
const ran = (steps: RunStep[], result: RunSteps['result'] = null): RunSteps => ({ seen: steps.length * 2, steps, result });

/** A run of acc in the output panel, with its steps. */
export function sampleStepRun(now: number, kind: StepSample): RunInput {
  const base = { id: STEP_SAMPLE_ID[kind], stopped: false, prompt: null, cwd: ROOT, step: null, base: 0 } as const;
  if (kind === 'steps-running') {
    return {
      ...base, label: 'Deploy Dev', command: 'acc deploy dev', startedAt: now - 3 * MIN - 8_000, endedAt: null, code: null,
      lines: ['Waiting for another heavy check or deploy on this machine to finish…', ''],
      steps: ran([
        s('branch', 'Check the branch', 'done', 0, 0),
        s('changes', 'Work out what changed', 'done', 0, 0, '3 file(s) to deploy'),
        s('ready', 'Check it can go to Dev', 'done', 0, 0),
        s('checkout', 'Check out dev at 4e1c2a9', 'done', 0, 0),
        s('deploy', 'Deploy to Dev', 'started', 0, null, '3 file(s), with the org\'s local tests'),
      ]),
    };
  }
  if (kind === 'steps-failed') {
    return {
      ...base, label: 'Promote Dev → UAT', command: 'acc promote dev --to uat', startedAt: now - 12 * MIN, endedAt: now - 12 * MIN + 4 * MIN + 31_000, code: 1,
      lines: [
        'Building promote/dev-to-uat-20261016-0912 from uat',
        'Validating against UAT (Acme UAT). Nothing is saved to the org.',
        'Error: WelcomeEmailServiceTest.sendsOnSignup: System.AssertException: Assertion Failed: Expected: 1, Actual: 0',
        '',
      ],
      steps: ran([
        s('branches', 'Check the branches', 'done', 0, 0),
        s('changes', 'Work out what changed', 'done', 0, 0),
        s('ready', 'Check it can open a pull request', 'done', 0, 0),
        s('build', 'Build the promotion branch', 'done', 0, 1),
        s('check', 'Check in Acme UAT', 'failed', 1, 3, 'Validation failed: 1 of 214 tests failed. WelcomeEmailServiceTest.sendsOnSignup: Assertion Failed: Expected: 1, Actual: 0'),
      ], { ok: false, sentence: 'Validation against UAT didn\'t pass, so no pull request was opened.' }),
    };
  }
  return {
    ...base, label: 'Dispatch ACME-12', command: 'acc dispatch ACME-12 --json', startedAt: now - 6 * MIN, endedAt: now - 6 * MIN + 14_000, code: 0, ok: true,
    lines: [''],
    steps: ran([
      s('task', 'Check the task', 'done', 0, 0),
      s('files', 'Check the files in flight', 'skipped', 0, 0, 'Its analysis names no files'),
      s('worktree', 'Make the worktree', 'done', 0, 0, 'ACME-12'),
      s('setup', 'Set up the worktree', 'done', 0, 0),
      s('packet', 'Write the builder\'s instructions', 'done', 0, 0),
      s('start', 'Start the builder', 'done', 0, 0, 'Background session bg4'),
      s('record', 'Record the run', 'done', 0, 0),
    ], { ok: true, sentence: 'ACME-12 is running in the background.' }),
  };
}
