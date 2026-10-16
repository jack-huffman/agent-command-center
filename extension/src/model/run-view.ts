/**
 * A run in the output panel as a designed view (T-64): how each kind of row shows, how long it took, and the
 * result card it ends with. Plain data, posted to the webview. No vscode import, so it's testable.
 */

import { plural } from '../../../packages/core/src/text.ts';
import { exitWords, type RowKind, type RunRow } from '../logic/run-rows.ts';
import { durationWords } from './limits.ts';
import { type Look, LOOK } from './shared.ts';

// ---------------------------------------------------------------- a run in the output panel (T-64)

/** How each kind of row shows: a success in blue, a warning and an error in orange with their label, a note muted. */
export const ROW_LOOK: Record<RowKind, Look> = {
  success: LOOK('Success', 'pass', 'blue'),
  warning: LOOK('Warning', 'warning', 'orange'),
  error: LOOK('Error', 'error', 'orange'),
  progress: LOOK('Progress', 'loading', 'blue'),
  note: LOOK('Note', 'circle-small', 'neutral'),
};

/** A row as the panel draws it: with its kind's look, since the page holds no tables of its own for it. */
export interface ShownRow extends Omit<RunRow, 'group'> { look: Look; group?: ShownRow[] }

/** A row's look. Once a run has ended, a count of progress spins no more: done at its end, else a note. */
const lookOf = (r: RunRow, running: boolean): Look => (r.kind === 'progress' && !running ? (r.progress?.done === 1 ? ROW_LOOK.success : ROW_LOOK.note) : ROW_LOOK[r.kind]);

/** Rows with their looks, a folded row's own rows too. */
export const shownRows = (rows: RunRow[], running = true): ShownRow[] =>
  rows.map(({ group, ...r }) => ({ ...r, look: lookOf({ ...r }, running), ...(group ? { group: shownRows(group, running) } : {}) }));

/** How an ended run shows, in the panel's header line and its result card. */
export const RESULT_LOOK: Record<'done' | 'failed' | 'stopped', Look> = {
  done: LOOK('Done', 'pass', 'blue'),
  failed: LOOK('Failed', 'warning', 'orange'),
  stopped: LOOK('Stopped', 'debug-stop', 'neutral'),
};

/** How long a run took, in words: "under a second", "4 s", "2 min 5 s", then minutes and hours. */
export function tookWords(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  if (s < 1) return 'under a second';
  if (s < 60) return `${s} s`;
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`;
  return durationWords(ms);
}

/** The one next step a result card offers: the step the run was for, or the run again. */
export type RunNext = { kind: 'step'; label: string; icon: string; step: string } | { kind: 'rerun'; label: string; icon: string };

export interface RunResult {
  look: Look;
  /** What happened, in one sentence. */
  sentence: string;
  /** A failed run's last error row, when it printed one. */
  error: ShownRow | null;
  /** A failed run's exit code in words. */
  exit: string | null;
  /** Null for a run that lasts as long as the window, such as autopilot, which its own switch starts. */
  next: RunNext | null;
}

/** What an ended run's card says: how it ended, how long it took, and its next step. Null while it runs. */
export function runResult(r: { endedAt: number | null; startedAt: number; code: number | null; ok?: boolean; stopped: boolean; step: string | null; background?: boolean }, rows: ShownRow[]): RunResult | null {
  if (r.endedAt === null) return null;
  const took = tookWords(r.endedAt - r.startedAt);
  const next: RunNext | null = r.background ? null : r.step ? { kind: 'step', label: 'Open the step', icon: 'list-selection', step: r.step } : { kind: 'rerun', label: 'Run again', icon: 'debug-restart' };
  if (r.stopped) return { look: RESULT_LOOK.stopped, sentence: `It was stopped after ${took}.`, error: null, exit: null, next };
  if (r.ok ?? r.code === 0) {
    const warnings = rows.filter((x) => x.kind === 'warning').reduce((n, x) => n + x.count, 0);
    return { look: RESULT_LOOK.done, sentence: `It finished in ${took}${warnings ? `, with ${plural(warnings, 'warning')}` : ''}.`, error: null, exit: null, next };
  }
  return { look: RESULT_LOOK.failed, sentence: `It failed after ${took}.`, error: rows.findLast((x) => x.kind === 'error') ?? null, exit: exitWords(r.code), next };
}
