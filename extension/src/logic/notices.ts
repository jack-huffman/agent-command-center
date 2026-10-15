/**
 * What changed, said once: a task's notices and their buttons.
 * Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */

import type { AutopilotRecord } from '../../../packages/core/src/autopilot-log.ts';
import { builderName } from './agents.ts';
import { fileList, prConflicts, questionsWord, saidLine, type TaskRow } from './shared.ts';

// ---------------------------------------------------------------- what changed, said once (D-044)

export const endSentence = (text: string): string => text.trim().replace(/([^.!?…])$/, '$1.');

export const NOTICE_KINDS = ['waiting', 'stopped', 'review', 'passed', 'rework', 'blocked', 'ci-failed', 'changes', 'conflicts', 'merged', 'analysis-ready', 'analysis-questions', 'analysis-split', 'analysis-back', 'autopilot'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/**
 * What a burst's summary calls each kind, for one and for more (D-???). Kinds with the same words count
 * together: "2 need you" holds a builder waiting on its prompt and a blocked task.
 */
export const NOTICE_WORDS: Record<NoticeKind, [one: string, many: string]> = {
  waiting: ['needs you', 'need you'],
  stopped: ['builder stopped', 'builders stopped'],
  review: ['ready for review', 'ready for review'],
  passed: ['review passed', 'reviews passed'],
  rework: ['sent back for changes', 'sent back for changes'],
  blocked: ['needs you', 'need you'],
  'ci-failed': ['pull request failed its checks', 'pull requests failed their checks'],
  changes: ['pull request with changes asked for', 'pull requests with changes asked for'],
  conflicts: ['pull request conflicts', 'pull requests conflict'],
  merged: ['merged', 'merged'],
  'analysis-ready': ['analysis ready', 'analyses ready'],
  'analysis-questions': ['analysis with questions for you', 'analyses with questions for you'],
  'analysis-split': ['too big for one task', 'too big for one task'],
  'analysis-back': ['analysis back', 'analyses back'],
  autopilot: ['autopilot step', 'autopilot steps'],
};

export interface TaskNotice {
  kind: NoticeKind;
  task: string;
  text: string;
  /** Needs a person: shown as a warning. The rest are news. */
  urgent: boolean;
  /** Its own buttons, before Show, for a notice whose buttons depend on more than its kind. */
  actions?: [label: string, command: string][];
  /** The autopilot step it tells, for an autopilot notice: Slack keys and words it from this (GH-58). */
  step?: AutopilotRecord;
}

/**
 * What a person would want to hear about, from how a project's tasks looked before and after a reload:
 * a builder finished, a review passed or asked for changes, an agent waits on its own prompt, a pull
 * request's checks failed, it conflicts with its base, it merged, or its analysis came back (D-052): ready,
 * with questions for you, or too big for one task. Only a task to do waits on its analysis: analyzed again
 * in review, rework or blocked, it's news, and its questions are answered with acc (D-059). A task seen
 * for the first time says nothing, so opening VSCode doesn't replay the board. A question waiting in the
 * Command Center has its own notice (D-030).
 */
export function taskNotices(before: TaskRow[], after: TaskRow[]): TaskNotice[] {
  const was = new Map(before.map((t) => [t.id, t]));
  const out: TaskNotice[] = [];
  for (const t of after) {
    const p = was.get(t.id);
    if (!p) continue;
    const say = (kind: NoticeKind, text: string, urgent: boolean) => out.push({ kind, task: t.id, text, urgent });
    const moved = p.state !== t.state;
    if (moved && p.state === 'running' && t.state === 'review') say('review', `${t.id} is ready for review: ${t.title}`, false);
    // Autopilot sent it back for its failing checks (D-076), or a review asked for changes.
    else if (moved && t.state === 'rework' && t.checks?.length) say('rework', `Checks failed on GitHub for ${t.id}: ${t.checks.join(', ')}. It went back to its builder.`, true);
    else if (moved && t.state === 'rework') say('rework', `The review asked for changes on ${t.id}${t.review?.summary ? `: ${t.review.summary}` : '.'}`, true);
    else if (moved && t.state === 'blocked') say('blocked', `${t.id} is blocked: ${t.title}`, true);
    // Its builder stopped before acc done or acc block (D-067): what it last said, and Resume.
    // A notice about the agent names it (D-087).
    if (t.stopped && !p.stopped && t.state === 'running') out.push({ kind: 'stopped', task: t.id, text: stoppedNotice(builderName(t), t.stopped.said), urgent: true, actions: [['Resume', 'acc.task.resume']] });
    else if (t.display === 'needs-you' && p.display !== 'needs-you' && t.state === 'running' && !t.asking && !t.stopped && !t.autopilot) say('waiting', `${builderName(t)} is waiting for you in its own prompt.`, true);
    const passed = (r: TaskRow) => r.state === 'review' && r.review?.verdict === 'pass' && r.review.current && !r.pr;
    if (passed(t) && !passed(p)) say('passed', `The review passed ${t.id}. It's ready to land.`, false);
    const pr = t.pr;
    if (pr?.state === 'open' && pr.ci === 'failing' && p.pr?.ci !== 'failing') say('ci-failed', `Checks failed on pull request #${pr.number} (${t.id}).`, true);
    if (pr?.state === 'open' && pr.changesRequested && !p.pr?.changesRequested) say('changes', `A reviewer asked for changes on pull request #${pr.number} (${t.id}).`, true);
    // Said when it starts to conflict, not again as the files change.
    if (pr && prConflicts(t).length && !prConflicts(p).length) say('conflicts', `Pull request #${pr.number} (${t.id}) conflicts with ${t.environment} in ${fileList(prConflicts(t))}.`, true);
    if (pr?.state === 'merged' && p.pr?.state !== 'merged') say('merged', `Pull request #${pr.number} merged. ${t.id} is done.`, false);
    // A new analysis, not an answer to one of its questions: an answer keeps its time (D-052).
    const a = t.analysis;
    if (a && a.at !== p.analysis?.at) {
      if (t.state !== 'todo') say('analysis-back', `${t.id}'s analysis is back.${a.open.length ? ` Its ${questionsWord(a.open.length)} can be answered on its page.` : ''}`, false);
      else if (a.verdict === 'split') say('analysis-split', `${t.id}'s analysis says it's too big for one task.`, true);
      else if (a.open.length) say('analysis-questions', `${t.id}'s analysis has ${questionsWord(a.open.length)} for you.`, true);
      else say('analysis-ready', `${t.id}'s analysis is ready.`, false);
    }
  }
  return out;
}

/** "Acme · GH-41 Ticket updates · builder stopped: API Error: Your computer went to sleep mid-response. …" (D-067, D-087). */
export const stoppedNotice = (agent: string, said: string | null): string =>
  said ? `${agent} stopped: ${endSentence(saidLine(said))}` : `${agent} stopped before it finished or blocked.`;

/** The buttons a notice offers, as [label, command] pairs. The task's page is always the last. */
export function noticeActions(n: TaskNotice): [label: string, command: string][] {
  // Every notice can open its task, once: an action that already does, such as Review the update, is it.
  if (n.actions) return n.actions.some(([, c]) => c === 'acc.task.show') ? n.actions : [...n.actions, ['Show', 'acc.task.show']];
  const first: Partial<Record<NoticeKind, [string, string]>> = {
    waiting: ['Open in Claude Code', 'acc.task.openInClaude'],
    stopped: ['Resume', 'acc.task.resume'],
    review: ['Review', 'acc.task.review'],
    passed: ['Land', 'acc.task.land'],
    rework: ['Re-dispatch', 'acc.task.dispatch'],
    'ci-failed': ['Open pull request', 'acc.task.openPr'],
    changes: ['Open pull request', 'acc.task.openPr'],
    conflicts: ['Open pull request', 'acc.task.openPr'],
    'analysis-ready': ['Dispatch', 'acc.task.dispatch'],
    // Its questions are answered on its page, so Answer is the page.
    'analysis-questions': ['Answer', 'acc.task.show'],
  };
  const a = first[n.kind];
  if (a?.[1] === 'acc.task.show') return [a];
  return [...(a ? [a] : []), ['Show', 'acc.task.show']];
}

// ---------------------------------------------------------------- a burst said as one (D-???)

/** More notices than this in one reload show as one summary. */
export const BURST_AT = 3;

/** What the summary's Show runs: the Command Center's Overview. */
export const OVERVIEW_COMMAND = 'acc.open.home';

/** A notice from one project, as a reload found it. */
export interface ProjectNotice { root: string; notice: TaskNotice }

/** One notification to show: a task's buttons run against its task; with no task, Show opens the Overview. */
export interface Said {
  text: string;
  urgent: boolean;
  actions: [label: string, command: string][];
  /** The task its buttons act on, or null for the Overview. */
  task: { root: string; task: string } | null;
}

/**
 * Every notice of one reload, from every project, as the notifications to show (D-044, D-???). Up to
 * BURST_AT, each is its own. More is a burst, after a person was away: one summary that counts them by
 * kind, the kinds that need you first, urgent if any is. A burst about one task keeps that task's buttons
 * (those of its newest notice); any other opens the Overview.
 */
export function noticeBurst(all: ProjectNotice[]): Said[] {
  const one = ({ root, notice: n }: ProjectNotice): Said => ({ text: n.text, urgent: n.urgent, actions: noticeActions(n), task: { root, task: n.task } });
  if (all.length <= BURST_AT) return all.map(one);
  const counts = new Map<string, { words: [string, string]; n: number; urgent: boolean; at: number }>();
  for (const { notice: n } of all) {
    const words = NOTICE_WORDS[n.kind];
    const c = counts.get(words[1]) ?? { words, n: 0, urgent: false, at: NOTICE_KINDS.indexOf(n.kind) };
    counts.set(words[1], { ...c, n: c.n + 1, urgent: c.urgent || n.urgent });
  }
  const parts = [...counts.values()].sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.at - b.at).map((c) => `${c.n} ${c.words[c.n === 1 ? 0 : 1]}`);
  const urgent = all.some(({ notice: n }) => n.urgent);
  const first = all[0]!;
  const sameTask = all.every((p) => p.root === first.root && p.notice.task === first.notice.task);
  if (sameTask) return [{ text: `Since you last looked, ${first.notice.task}: ${parts.join(', ')}.`, urgent, actions: noticeActions(all.at(-1)!.notice), task: { root: first.root, task: first.notice.task } }];
  return [{ text: `Since you last looked: ${parts.join(', ')}.`, urgent, actions: [['Show', OVERVIEW_COMMAND]], task: null }];
}
