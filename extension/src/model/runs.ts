/**
 * Commands acc runs for you, in the page's output panel.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { runRows } from '../logic/run-rows.ts';
import type { RunPrompt } from '../logic/runs.ts';
import { type DockReview, dockReview, type ReviewRun } from './dock-review.ts';
import { RESULT_LOOK, runResult, type RunResult, type ShownRow, shownRows, tookWords } from './run-view.ts';
import { type Look, LOOK, type ModelArea, short } from './shared.ts';

// ---------------------------------------------------------------- commands acc runs for you (D-030)

export interface RunCard {
  id: string;
  label: string;
  command: string;
  look: Look;
  running: boolean;
  startedAt: number;
  endedAt: number | null;
  /** The last lines of its output; the last one may still be being written. History shows them. */
  lines: string[];
  /** Its output as rows, as the panel shows it (T-64): the last MAX_ROWS of them. */
  rows: ShownRow[];
  /** How many rows came before those, which the panel counts in one line. */
  hidden: number;
  /** How long it took, once it ended; null while it runs, when the panel's clock says it. */
  took: string | null;
  /** How it ended, for the card at the end of its rows; null while it runs, and for a review, which says its own. */
  result: RunResult | null;
  /** Where it ran, for its Details. */
  cwd: string | null;
  /** Set when it's gone quiet asking for something. */
  prompt: RunPrompt | null;
  /** The setup step it's doing, so the step shows it's under way. */
  step: string | null;
  /** Lasts as long as the window, such as autopilot (D-064): the panel shows another first. */
  background?: boolean;
  /** A review of a task (T-63): the panel shows it in place of its lines, and its lines on Show output. */
  review?: DockReview;
}

export interface RunInput {
  id: string;
  label: string;
  command: string;
  startedAt: number;
  endedAt: number | null;
  code: number | null;
  /** Whether it did its job, when its exit code alone doesn't say (see Runs). Otherwise exit 0 is done. */
  ok?: boolean;
  stopped: boolean;
  lines: string[];
  prompt: RunPrompt | null;
  step: string | null;
  /** Lasts as long as the window, such as autopilot (D-064): never the output panel's first pick. */
  background?: boolean;
  /** Where it runs, so In progress puts it on its project (D-092). */
  cwd?: string;
  /** A review of a task (T-63), and, once it ended, the verdict it wrote. */
  review?: ReviewRun;
}

export function runCard(r: RunInput, lines = 400): RunCard {
  const running = r.endedAt === null;
  const look: Look = running ? (r.prompt ? LOOK('Waiting for you', 'bell', 'orange') : LOOK('Running', 'sync~spin', 'blue'))
    : r.stopped ? RESULT_LOOK.stopped : (r.ok ?? r.code === 0) ? RESULT_LOOK.done : RESULT_LOOK.failed;
  const review = r.review ? dockReview({ startedAt: r.startedAt, endedAt: r.endedAt, stopped: r.stopped, review: r.review }) : null;
  // Rows from every line it kept, so the count of those not shown is the whole output's.
  const read = runRows(r.lines, r.cwd ?? null);
  // The question it's waiting on shows once, as the panel's question, not again as its last row.
  const asking = running && r.prompt && read.rows.at(-1)?.text === r.prompt.text.trim();
  const rows = shownRows(asking ? read.rows.slice(0, -1) : read.rows, running);
  // A review with its verdict wears the verdict's look: acc review exits 1 when it asks for changes, which isn't a failure.
  return {
    id: r.id, label: r.label, command: r.command, look: review?.phase === 'done' ? review.look : look, running, startedAt: r.startedAt, endedAt: r.endedAt, lines: r.lines.slice(-lines),
    rows, hidden: read.hidden, took: r.endedAt === null ? null : tookWords(r.endedAt - r.startedAt), result: review ? null : runResult(r, rows), cwd: r.cwd ?? null,
    prompt: running ? r.prompt : null, step: r.step, ...(r.background ? { background: true } : {}), ...(review ? { review } : {}),
  };
}

/** Copy copies the whole output it kept, and rerun starts it again in the panel (T-64). */
export const RUN_CONTROLS = ['stop', 'terminal', 'dismiss', 'copy', 'rerun'] as const;
export type RunControl = (typeof RUN_CONTROLS)[number];

export type Message =
  /** Something for a command acc is running: typed input, stop, rerun in a terminal, or dismiss. */
  | { type: 'run-input'; run: string; text: string }
  | { type: 'run-control'; run: string; action: RunControl }
  /** A file path in its output, in the folder it ran in, to open (T-64). */
  | { type: 'run-file'; run: string; file: string; line?: number };

export const area: ModelArea = {
  messages: {
    'run-input': (x) => short(x.run, 64) && typeof x.text === 'string' && x.text.length <= 4096 && !/[\r\n]/.test(x.text as string),
    'run-control': (x) => short(x.run, 64) && (RUN_CONTROLS as readonly string[]).includes(x.action as string),
    // A path in the run's folder, as the page found it: relative, never climbing out of it.
    'run-file': (x) => short(x.run, 64) && short(x.file, 1024) && !x.file.startsWith('/') && !x.file.split('/').includes('..')
      && (x.line === undefined || (Number.isInteger(x.line) && (x.line as number) > 0)),
  },
};
