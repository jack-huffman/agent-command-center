// What autopilot did, read back from the repo's events.

import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { AUTOPILOT_BY, AUTOPILOT_STEPS, type AutopilotStepName, type LedgerEvent, type ReworkCause } from './ledger.ts';
import type { FileShare } from './overlap.ts';

// ---------------------------------------------------------------- what it did, read back

/** Whether autopilot did it: as the orchestrator, or a reviewer's move made for it. */
export const byAutopilot = (by: string): boolean => by === AUTOPILOT_BY || by.endsWith(` for ${AUTOPILOT_BY}`);

/** A step autopilot took, as its ledger event tells it, so any window can show what it did (D-064). */
export interface AutopilotRecord {
  seq: number;
  at: string;
  task: string;
  step: AutopilotStepName;
  outcome: 'done' | 'failed';
  /** A review's verdict. */
  verdict?: 'pass' | 'changes';
  /** A land's pull request, and whether it opened it or updated one, or the pull request a merge merged. */
  pr?: { number: number; url: string; opened: boolean };
  /** A refresh: the base it merged in, or null when the conflict had gone and nothing was merged. */
  base?: string | null;
  /** Why it failed, what the review asked for, or what a builder it resumed last said. */
  reason?: string;
  /** The checks that failed on GitHub, when it sent the task back for them (D-076), or the gates of the merge queue's full check that failed (GH-73). */
  checks?: string[];
  /** The files the merge queue couldn't merge the base into, when it sent the task back for them (GH-73). */
  conflicts?: string[];
  /** A refresh the merge queue made at the task's turn, which it pushes once its full check passed, and merges after (GH-73). */
  queue?: true;
  /** What a re-dispatch was for: the checks it sent back for, the merge queue's send-back, or a review's changes. */
  cause?: ReworkCause;
  /** A held task's start (D-093): the tasks whose files it waited for, and those it shares files with when nothing else was ready. */
  waitedFor?: string[];
  shares?: FileShare[];
}

const obj = (v: unknown): Record<string, any> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * The step a ledger event records, when autopilot took it, or null. A review that passed, a land, a
 * refresh and a merge are task.updated; a review that asked for changes, a send-back and a re-dispatch are
 * moves; a failure is the failure written on the task. A re-dispatch's run record, a task's place in the
 * merge queue, and a person's steps are null.
 */
export function autopilotEvent(e: Pick<LedgerEvent, 'seq' | 'at' | 'type' | 'task' | 'by' | 'data'>): AutopilotRecord | null {
  if (!e || typeof e.by !== 'string' || !byAutopilot(e.by) || typeof e.task !== 'string') return null;
  const base = { seq: e.seq, at: e.at, task: e.task };
  const d = obj(e.data) ?? {};
  if (e.type === 'task.moved') {
    // Autopilot's own move to rework sends back failing checks (D-076), or what the merge queue found
    // (GH-73), as its event says; a review's is made for it.
    if (d.from === 'review' && d.to === 'rework' && e.by === AUTOPILOT_BY) {
      const reason = typeof d.reason === 'string' && d.reason ? { reason: d.reason } : {};
      if (d.kind === 'queue') {
        const conflicts = strs(d.conflicts);
        return { ...base, step: 'queue', outcome: 'done', checks: strs(d.checks), ...(conflicts.length ? { conflicts } : {}), ...reason };
      }
      return { ...base, step: 'checks', outcome: 'done', checks: strs(d.checks), ...reason };
    }
    if (d.from === 'review' && d.to === 'rework') {
      const reason = typeof d.reason === 'string' ? d.reason.replace(/^Review asked for changes:\s*/, '') : undefined;
      return { ...base, step: 'review', outcome: 'done', verdict: 'changes', ...(reason ? { reason } : {}) };
    }
    if (d.from === 'rework' && d.to === 'running') return { ...base, step: 'dispatch', outcome: 'done', ...(d.cause === 'checks' || d.cause === 'queue' || d.cause === 'review' ? { cause: d.cause } : {}) };
    // A held task it started (D-093).
    if (d.from === 'todo' && d.to === 'running') {
      const waitedFor = strs(obj(d.held)?.waitedFor);
      const shares = (Array.isArray(d.shares) ? d.shares : []).map(obj).filter((x): x is Record<string, any> => typeof x?.task === 'string').map((x) => ({ task: x.task as string, files: strs(x.files) }));
      return { ...base, step: 'start', outcome: 'done', ...(waitedFor.length ? { waitedFor } : {}), ...(shares.length ? { shares } : {}) };
    }
    return null;
  }
  if (e.type !== 'task.updated') return null;
  // A held task's start that failed is written on its hold (D-093).
  const startFailed = obj(obj(d.held)?.failed);
  if (startFailed) return { ...base, step: 'start', outcome: 'failed', reason: String(startFailed.reason ?? '') };
  const failed = obj(obj(d.autopilot)?.failed);
  if (failed && (AUTOPILOT_STEPS as readonly string[]).includes(failed.step)) {
    return { ...base, step: failed.step as AutopilotStepName, outcome: 'failed', reason: String(failed.reason ?? '') };
  }
  // A pull request it merged (GH-67): its own key, read before a bare pull request, which is a refresh's.
  const merged = obj(d.merged);
  const mergedPr = obj(merged?.pr);
  if (mergedPr && typeof mergedPr.number === 'number') return { ...base, step: 'merge', outcome: 'done', pr: { number: mergedPr.number, url: String(mergedPr.url ?? ''), opened: false } };
  const reviewed = obj(d.reviewed);
  if (reviewed?.verdict === 'pass') return { ...base, step: 'review', outcome: 'done', verdict: 'pass' };
  const pr = obj(d.pr);
  if (pr && typeof d.opened === 'boolean' && typeof pr.number === 'number') {
    return { ...base, step: 'land', outcome: 'done', pr: { number: pr.number, url: String(pr.url ?? ''), opened: d.opened } };
  }
  // A builder it resumed (D-067), with the last thing it said.
  const resumed = obj(d.resumed);
  if (resumed) return { ...base, step: 'resume', outcome: 'done', ...(typeof resumed.said === 'string' && resumed.said ? { reason: resumed.said } : {}) };
  const refreshed = obj(d.refreshed);
  if (refreshed) return { ...base, step: 'refresh', outcome: 'done', base: typeof refreshed.base === 'string' ? refreshed.base : null, ...(refreshed.queue === true ? { queue: true as const } : {}) };
  // A refresh that found the conflict gone marks the pull request so, and merges nothing (D-058).
  if (pr && typeof pr.number === 'number') return { ...base, step: 'refresh', outcome: 'done', base: null, pr: { number: pr.number, url: String(pr.url ?? ''), opened: false } };
  return null;
}

/** How much of a repo's events a first look reads, and how many of autopilot's steps a log keeps. */
const EVENTS_TAIL_BYTES = 256 * 1024;
const KEEP_STEPS = 300;

/** What has been read of a repo's events (events.jsonl, never trimmed), and the steps autopilot took in them. */
export interface AutopilotLog {
  /** The byte after the last whole line read. */
  offset: number;
  ino: number;
  /** Still to drop the half line the first read starts in. */
  fresh: boolean;
  /** Autopilot's steps, oldest first: the newest 300. */
  records: AutopilotRecord[];
}

/**
 * Reads what was added to a repo's events since the last look, keeping autopilot's steps (D-064). The
 * first look reads only the last 256 KB, so a long history costs nothing, and each look after reads
 * only what was added. A file that shrank or was replaced is read again from its tail. Undefined when
 * there's no file yet.
 */
export function readAutopilotLog(file: string, log?: AutopilotLog): AutopilotLog | undefined {
  let st;
  try {
    st = statSync(file);
  } catch {
    return undefined;
  }
  const s: AutopilotLog = !log || log.ino !== st.ino || st.size < log.offset
    ? { offset: Math.max(0, st.size - EVENTS_TAIL_BYTES), ino: st.ino, fresh: true, records: [] }
    : { ...log, records: [...log.records] };
  if (st.size === s.offset) return s;
  const buf = Buffer.alloc(st.size - s.offset);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buf, 0, buf.length, s.offset);
  } finally {
    closeSync(fd);
  }
  let from = 0;
  if (s.fresh && s.offset > 0) {
    const nl = buf.indexOf(10);
    if (nl < 0) return s;
    from = nl + 1;
  }
  // Only whole lines: one being written is read next time.
  const end = buf.lastIndexOf(10);
  if (end < from) return { ...s, offset: s.offset + from, fresh: false };
  for (const line of buf.subarray(from, end).toString('utf8').split('\n')) {
    try {
      const r = autopilotEvent(JSON.parse(line));
      if (r) s.records.push(r);
    } catch {
      // a line that isn't an event
    }
  }
  if (s.records.length > KEEP_STEPS) s.records.splice(0, s.records.length - KEEP_STEPS);
  return { ...s, offset: s.offset + end + 1, fresh: false };
}
