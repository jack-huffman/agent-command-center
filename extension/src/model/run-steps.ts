/**
 * A run of acc in the output panel as a list of steps (T-65): each step's icon and label, a failed one's
 * note and its own rows, and the count of lines the output rows fold into. Plain data, posted to the
 * webview. No vscode import, so it's testable.
 */

import type { StepState } from '../../../packages/core/src/steps.ts';
import { runRows } from '../logic/run-rows.ts';
import { type RunSteps, stepLines } from '../logic/run-steps.ts';
import { type ShownRow, shownRows } from './run-view.ts';
import { type Look, LOOK } from './shared.ts';

// ---------------------------------------------------------------- a run of acc's steps (T-65)

/** How each step shows: a quiet spinner while it runs, then done in blue, skipped muted, failed in orange. */
export const STEP_LOOK: Record<StepState | 'stopped', Look> = {
  started: LOOK('Running', 'loading~spin', 'neutral'),
  done: LOOK('Done', 'pass', 'blue'),
  skipped: LOOK('Skipped', 'circle-slash', 'neutral'),
  failed: LOOK('Failed', 'warning', 'orange'),
  // One still running when its run ended: it never finished.
  stopped: LOOK('Didn\'t finish', 'debug-stop', 'neutral'),
};

export interface ShownStep {
  id: string;
  label: string;
  /** Its state; stopped is one still running when its run ended. */
  state: StepState | 'stopped';
  look: Look;
  /** What acc said about it: a failure's why, or what it found. */
  note: string | null;
  /** A failed step's own rows, which it opens to; empty for any other, or one that printed nothing. */
  rows: ShownRow[];
}

/**
 * A run's steps as the panel shows them. A step still running once its run ended didn't finish. Only a
 * failed step carries its rows: the rest of the output folds under the list.
 */
export function shownSteps(s: RunSteps, lines: readonly string[], base: number, running: boolean, root: string | null): ShownStep[] {
  return s.steps.map((step) => {
    const state = step.state === 'started' && !running ? 'stopped' : step.state;
    const rows = state === 'failed' ? shownRows(runRows(stepLines(step, lines, base), root).rows, running) : [];
    return { id: step.id, label: step.label, state, look: STEP_LOOK[state], note: step.note, rows };
  });
}

/** How many lines a run printed, blank ones aside: what "Show 42 lines" counts. */
export const lineCount = (lines: readonly string[]): number => lines.filter((l) => l.trim()).length;
