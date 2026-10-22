/**
 * A review in the output panel (T-63): the run knows the task it reviews, and once it ends, the verdict it
 * wrote. The panel shows a running review as one calm line, and a finished one as a header line, its
 * summary, one row for each criterion not met and each finding, and the met criteria folded into one row.
 * Plain data, with no vscode import, so it's testable.
 */

import type { Criterion, Verdict } from '../../../packages/core/src/review.ts';
import { plural } from '../../../packages/core/src/text.ts';
import type { Excerpt } from '../logic/review-excerpts.ts';
import { durationWords } from './limits.ts';
import { REVIEW_LOOK, type ReviewFinding, ticketReview } from './task-page.ts';
import type { Action, Look } from './shared.ts';
import { WORDS } from '../../webview/plain-words.ts';

/** What the extension read of a review run's verdict once the run ended: the verdict and its findings' lines, or why there is none. */
export type VerdictRead =
  | { ok: true; verdict: Verdict; checkout: boolean; excerpts: (Excerpt | null)[] }
  | { ok: false; why: string };

/** A run that is a review: its project and task, the commit it started on, and, once it ended, its verdict. */
export interface ReviewRun {
  project: string;
  task: string;
  /** The task's branch head as the review started, or null when the extension didn't know it. */
  sha: string | null;
  /** Not set until the run ended and the extension read its verdict. */
  read?: VerdictRead;
}

/** How a criterion shows: one met in blue, one not met in orange. */
export const CRITERION_LOOK: Record<'met' | 'unmet', Look> = {
  met: { label: 'Met', icon: 'check', tone: 'blue' },
  unmet: { label: 'Not met', icon: 'circle-slash', tone: 'orange' },
};

/** How a review run shows before its verdict: under way, its verdict being read, or no verdict to show. */
export const REVIEW_RUN_LOOK: Record<'running' | 'reading' | 'unread', Look> = {
  running: { label: 'Reviewing', icon: 'loading~spin', tone: 'blue' },
  reading: { label: 'Reading its verdict', icon: 'loading~spin', tone: 'blue' },
  unread: { label: 'No verdict', icon: 'warning', tone: 'orange' },
};

/** One row under the summary: a criterion not met, or a finding. A click opens it in place. */
export interface DockReviewRow {
  /** What the tab remembers it opened by, unique in its review. */
  key: string;
  look: Look;
  /** Its text on one line: the criterion, or the finding's message. */
  text: string;
  /** A criterion's evidence, shown when it opens. */
  evidence: string | null;
  /** A finding as the task page shows it: its file and line, its note and lines, shown when it opens. */
  finding: ReviewFinding | null;
}

export type DockReview =
  /** Under way, or ended with its verdict still being read: one line, "Reviewing T-1", its commit and the time so far, which runs while it's live. */
  | { phase: 'running'; project: string; task: string; look: Look; sha: string | null; startedAt: number; live: boolean }
  /** Ended with no verdict to show: the run's lines, and why. */
  | { phase: 'unread'; project: string; task: string; look: Look; why: string }
  | {
    phase: 'done';
    project: string;
    task: string;
    look: Look;
    /** "5 of 6 criteria, 2 findings". */
    count: string;
    /** Who reviewed it, when and how long it took, for the header line's hover. */
    by: string;
    at: string;
    took: string | null;
    summary: string;
    /** The sentence for the client, after the summary once it opens. Null for a verdict with none. */
    client: string | null;
    /** Each criterion not met, then each finding, must-fix first. */
    rows: DockReviewRow[];
    /** The criteria met, folded into one row whose label says how many, such as "5 criteria met"; null with none. */
    met: { look: Look; items: string[] } | null;
    /** The next step: Land a pass, or send changes asked back to the builder. */
    next: Action;
  };

/** The next step after a verdict, as the header line's one primary button. */
export function reviewNext(project: string, task: string, verdict: Verdict['verdict']): Action {
  const ref = { project, task };
  return verdict === 'pass'
    ? { command: 'acc.task.land', label: WORDS.openPullRequest, icon: 'git-pull-request-create', ref, primary: true }
    : { command: 'acc.task.dispatch', label: 'Send back to the builder', icon: 'reply', ref, primary: true };
}

/** "5 of 6 criteria, 2 findings"; with no criteria, the findings alone. */
export function reviewCount(criteria: readonly Pick<Criterion, 'met'>[], findings: number): string {
  const found = findings ? plural(findings, 'finding') : 'no findings';
  if (!criteria.length) return findings ? found : 'No findings';
  return `${criteria.filter((c) => c.met).length} of ${plural(criteria.length, 'criterion', 'criteria')}, ${found}`;
}

/** Whether what was read is a verdict at all: the fields the panel draws, of the right kinds. */
function isVerdict(v: unknown): v is Verdict {
  const x = v as Partial<Verdict> | null;
  return !!x && typeof x === 'object' && (x.verdict === 'pass' || x.verdict === 'changes') && typeof x.task === 'string' && typeof x.sha === 'string' && typeof x.summary === 'string'
    && typeof x.at === 'string' && Array.isArray(x.criteria) && Array.isArray(x.findings);
}

/**
 * A review run's verdict from its file's text, or why there's none to show: the run wrote none, as a review
 * that was refused or failed (no file, or the newest is an older review's, from before the run started), or
 * the file can't be read as a verdict.
 */
export function verdictFrom(text: string | null, startedAt: number): { verdict: Verdict } | { why: string } {
  if (text === null) return { why: 'The review wrote no verdict. Its output says why.' };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { why: 'Its verdict file isn\'t JSON, so it can\'t be shown. Its output is below.' };
  }
  if (!isVerdict(v)) return { why: 'Its verdict file doesn\'t hold a verdict, so it can\'t be shown. Its output is below.' };
  // A verdict is written as the review ends, so one from before the run is another review's.
  const at = Date.parse(v.at);
  if (Number.isFinite(at) && at < startedAt) return { why: 'The review wrote no verdict. Its output says why.' };
  return { verdict: v };
}

/**
 * A review run kept from before a reload. One whose verdict was still being read when the window closed is
 * read no more, so it says why it shows none rather than reading for ever.
 */
export function keptReview(r: ReviewRun, stopped: boolean): ReviewRun {
  return r.read || stopped ? r : { ...r, read: { ok: false, why: 'The window closed before its verdict was read. Its output is below.' } };
}

/** The run as the model reads it: when it started and ended, whether it was stopped, and the review it is. */
export interface ReviewRunIn { startedAt: number; endedAt: number | null; stopped: boolean; review: ReviewRun }

/**
 * A review run as the output panel shows it. Running, or ended and its verdict not read yet: one line.
 * Stopped, or ended with no verdict that can be read: the run's lines, and why. Otherwise the verdict.
 */
export function dockReview(r: ReviewRunIn): DockReview {
  const { project, task, sha, read } = r.review;
  if (r.endedAt === null || (!r.stopped && !read)) {
    const look = r.endedAt === null ? REVIEW_RUN_LOOK.running : REVIEW_RUN_LOOK.reading;
    return { phase: 'running', project, task, look, sha: sha ? sha.slice(0, 7) : null, startedAt: r.startedAt, live: r.endedAt === null };
  }
  if (r.stopped) return { phase: 'unread', project, task, look: REVIEW_RUN_LOOK.unread, why: 'It was stopped before it gave a verdict.' };
  if (!read!.ok) return { phase: 'unread', project, task, look: REVIEW_RUN_LOOK.unread, why: read!.why };
  const v = read!.verdict;
  // The task page's findings, must-fix first, each with its file and line, note and lines (T-53).
  const findings = ticketReview(project, 'review', { verdict: v, current: true, checkout: read!.checkout, excerpts: read!.excerpts })!.findings;
  const unmet = v.criteria.map((c, i) => ({ c, i })).filter(({ c }) => !c.met);
  const met = v.criteria.filter((c) => c.met);
  return {
    phase: 'done', project, task, look: REVIEW_LOOK[v.verdict], count: reviewCount(v.criteria, v.findings.length),
    by: v.name ?? 'The reviewer', at: v.at, took: typeof v.durationMs === 'number' && v.durationMs > 0 ? durationWords(v.durationMs) : null, summary: v.summary, client: v.client?.trim() || null,
    rows: [
      ...unmet.map(({ c, i }): DockReviewRow => ({ key: `c${i}`, look: CRITERION_LOOK.unmet, text: c.text, evidence: c.evidence?.trim() || null, finding: null })),
      ...findings.map((f, i): DockReviewRow => ({ key: `f${i}`, look: f.look, text: f.message, evidence: null, finding: f })),
    ],
    met: met.length ? { look: { ...CRITERION_LOOK.met, label: `${plural(met.length, 'criterion', 'criteria')} met` }, items: met.map((c) => c.text) } : null,
    next: reviewNext(project, task, v.verdict),
  };
}
