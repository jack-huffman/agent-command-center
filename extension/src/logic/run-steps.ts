/**
 * The steps acc reports for a run in the output panel (T-65): acc writes each step event to the file
 * ACC_STEPS names, and the extension reads it as it grows. Each step keeps where in the output it began and
 * ended, so a failed one opens to its own rows. Like the rest of logic/, no `vscode` import, so it can be
 * tested with node:test.
 */

import { basename } from 'node:path';
import type { StepEvent, StepState } from '../../../packages/core/src/steps.ts';
import { reasonInWords } from './relayed.ts';

// ---------------------------------------------------------------- acc's steps for a run (T-65)

export interface RunStep {
  id: string;
  /** In process words, as acc labels it. */
  label: string;
  state: StepState;
  /** What acc said about it, in process words: a failure's why, or what it found. */
  note: string | null;
  /** The output's line, counted from the run's first, that was being written when it began; and when it ended. */
  from: number;
  to: number | null;
}

export interface RunSteps {
  /** How many of the file's events have been read. */
  seen: number;
  steps: RunStep[];
  /** The run's result, from acc's last event: whether it worked, in one sentence. */
  result: { ok: boolean; sentence: string } | null;
}

/** A run of acc before its first step arrives. */
export const NO_RUN_STEPS: RunSteps = { seen: 0, steps: [], result: null };

/**
 * The file's events read so far, with those not seen before applied at `line`: the output's line that was
 * being written when they were read. A step's start opens it at that line, its end closes it there. acc's
 * words, a note or the result's sentence, are put in process words on the way in (D-132).
 */
export function applySteps(prev: RunSteps, events: readonly StepEvent[], line: number): RunSteps {
  if (events.length <= prev.seen) return prev;
  const steps = prev.steps.map((s) => ({ ...s }));
  let result = prev.result;
  for (const e of events.slice(prev.seen)) {
    if (e.kind === 'result') { result = { ok: e.ok, sentence: reasonInWords(e.sentence) }; continue; }
    const note = reasonInWords(e.note ?? null);
    const s = steps.find((x) => x.id === e.id);
    if (e.state === 'started') {
      if (s) Object.assign(s, { state: 'started', label: e.label, from: line, to: null, ...(note ? { note } : {}) });
      else steps.push({ id: e.id, label: e.label, state: 'started', note, from: line, to: null });
    } else if (s) Object.assign(s, { state: e.state, label: e.label, to: line, ...(note ? { note } : {}) });
    else steps.push({ id: e.id, label: e.label, state: e.state, note, from: line, to: line });
  }
  return { seen: events.length, steps, result };
}

/** A step's own lines: from where it began to where it ended, or to the end while it runs. `base` is the line lines[0] is. */
export function stepLines(step: Pick<RunStep, 'from' | 'to'>, lines: readonly string[], base: number): string[] {
  const from = Math.max(0, step.from - base);
  const to = step.to === null ? lines.length : Math.max(0, step.to - base + 1);
  return lines.slice(from, to);
}

/** Settings for a command's environment at the start of its line: `NAME=value `. */
const SETTINGS = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+)*/;
/** A word of a command line, bare or in single quotes as the extension writes a path with spaces. */
const WORD = /^(?:'([^']*)'|(\S+))\s*/;

/**
 * Whether a command line runs acc, so its steps are listened for: `acc …`, a path to acc, or the
 * extension's own acc, a program running a path to acc.mjs (`'…/Code Helper' '…/dist/bin/acc.mjs' …`).
 */
export function runsAcc(command: string): boolean {
  let rest = command.trim().replace(SETTINGS, '');
  for (let i = 0; i < 2 && rest; i++) {
    const m = WORD.exec(rest);
    if (!m) return false;
    const w = basename(m[1] ?? m[2] ?? '');
    // acc itself first; after a program, only the script it runs.
    if (w === 'acc.mjs' || (i === 0 && w === 'acc')) return true;
    rest = rest.slice(m[0].length);
  }
  return false;
}
