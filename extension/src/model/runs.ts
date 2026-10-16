/**
 * Commands acc runs for you, in the page's output panel.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import type { RunPrompt } from '../logic/runs.ts';
import { type DockReview, dockReview, type ReviewRun } from './dock-review.ts';
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
  /** The last lines of its output; the last one may still be being written. */
  lines: string[];
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
    : r.stopped ? LOOK('Stopped', 'debug-stop', 'neutral')
      : (r.ok ?? r.code === 0) ? LOOK('Done', 'pass', 'blue') : LOOK(`Failed (exit ${r.code ?? '?'})`, 'warning', 'orange');
  const review = r.review ? dockReview({ startedAt: r.startedAt, endedAt: r.endedAt, stopped: r.stopped, review: r.review }) : null;
  // A review with its verdict wears the verdict's look: acc review exits 1 when it asks for changes, which isn't a failure.
  return {
    id: r.id, label: r.label, command: r.command, look: review?.phase === 'done' ? review.look : look, running, startedAt: r.startedAt, endedAt: r.endedAt, lines: r.lines.slice(-lines),
    prompt: running ? r.prompt : null, step: r.step, ...(r.background ? { background: true } : {}), ...(review ? { review } : {}),
  };
}

export const RUN_CONTROLS = ['stop', 'terminal', 'dismiss'] as const;
export type RunControl = (typeof RUN_CONTROLS)[number];

export type Message =
  /** Something for a command acc is running: typed input, stop, rerun in a terminal, or dismiss. */
  | { type: 'run-input'; run: string; text: string }
  | { type: 'run-control'; run: string; action: RunControl };

export const area: ModelArea = {
  messages: {
    'run-input': (x) => short(x.run, 64) && typeof x.text === 'string' && x.text.length <= 4096 && !/[\r\n]/.test(x.text as string),
    'run-control': (x) => short(x.run, 64) && (RUN_CONTROLS as readonly string[]).includes(x.action as string),
  },
};
