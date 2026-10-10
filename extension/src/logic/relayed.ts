/**
 * Where what acc recorded reaches a person, in the Command Center's words (GH-163). acc writes its reasons
 * with its own commands: a step autopilot couldn't take says "Run acc gate run in its worktree, or waive
 * them, then review.", and a builder blocks with "acc gate run errors on validate". The extension reads them
 * at three places, and each passes them through here on the way in: a task's row (deriveRows), autopilot's
 * log (the hub's autopilotLog) and a task's own record on its page. Every view built from them, a notice,
 * History, a card, the Overview, then shows the process, not the command line.
 *
 * Like the rest of logic/, no `vscode` import: the hub, the screenshot fixtures and node:test all call it.
 */

import type { AutopilotRecord } from '../../../packages/core/src/autopilot-log.ts';
import { inProcessWords } from './processes.ts';
import type { TaskRow } from './shared.ts';

/** A reason, a blocker or a line someone wrote, in process words; none stays none. */
export function reasonInWords(text: string): string;
export function reasonInWords(text: string | null | undefined): string | null;
export function reasonInWords(text: string | null | undefined): string | null {
  return text ? inProcessWords(text) : null;
}

/** Each record put in words once: the hub hands out the same steps on every look. */
const steps = new WeakMap<AutopilotRecord, AutopilotRecord>();

/**
 * A step autopilot took, with its reason in process words: why it failed, why it sent a task back, what
 * the review asked for, or what a builder it resumed last said. A step with no reason comes back as it was.
 */
export function stepInWords(r: AutopilotRecord): AutopilotRecord {
  if (!r.reason) return r;
  let out = steps.get(r);
  if (!out) {
    out = { ...r, reason: inProcessWords(r.reason) };
    steps.set(r, out);
  }
  return out;
}

/**
 * A task's row, with what acc and its agents wrote in it in process words: why autopilot couldn't take a
 * step, why a held task couldn't start, why the merge queue holds it, what its review said and what its
 * builder last said before it stopped. Everything else, its files and branch among them, is as it was.
 */
export function rowInWords(r: TaskRow): TaskRow {
  const f = r.files;
  return {
    ...r,
    ...(r.autopilot ? { autopilot: { ...r.autopilot, reason: inProcessWords(r.autopilot.reason) } } : {}),
    ...(f?.held?.failed ? { files: { ...f, held: { ...f.held, failed: inProcessWords(f.held.failed) } } } : {}),
    ...(r.queue?.why ? { queue: { ...r.queue, why: inProcessWords(r.queue.why) } } : {}),
    ...(r.review?.summary ? { review: { ...r.review, summary: inProcessWords(r.review.summary) } } : {}),
    ...(r.stopped?.said ? { stopped: { ...r.stopped, said: inProcessWords(r.stopped.said) } } : {}),
  };
}
