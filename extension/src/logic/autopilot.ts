/**
 * Autopilot, hosted by the Command Center (D-064): what each step it took says, and its switch.
 * Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */

import { autopilotDoes, type AutopilotRecord, reworkedByAutopilot } from '../../../packages/core/src/autopilot.ts';
import type { AutopilotStepName } from '../../../packages/core/src/ledger.ts';
import { isTrackerKind } from '../../../packages/core/src/trackers/types.ts';
import { endSentence, type TaskNotice } from './notices.ts';
import { saidLine } from './shared.ts';
import { startedNotice } from './tasks.ts';

// ---------------------------------------------------------------- autopilot, hosted by the Command Center (D-064)

/** What a step autopilot couldn't take is called, as acc says it: "couldn't land GH-31", "couldn't send GH-31 back for its failing checks". */
const AUTOPILOT_VERB: Record<AutopilotStepName, [string, string]> = {
  review: ['review', ''], land: ['land', ''], dispatch: ['re-dispatch', ''], refresh: ['update', ' from its base'], resume: ['resume', ''], checks: ['send', ' back for its failing checks'], merge: ['merge', ''], start: ['start', ''], queue: ['take', ' through the merge queue'],
};

/** Why the merge queue sent a task back, in words: the files that conflict, or the checks that failed (GH-73). */
export function queueWhy(r: Pick<AutopilotRecord, 'conflicts' | 'checks'>): string {
  if (r.conflicts?.length) return `it conflicts with its base in ${r.conflicts.join(', ')}`;
  return `its full check failed${r.checks?.length ? `: ${r.checks.join(', ')}` : ''}`;
}

/** What autopilot needs to know about a task to tell its steps: who it's tracked in, and its moves. */
export interface AutopilotTask {
  id: string;
  source: { kind: string; key: string | null };
  history: { at: string; from: string | null; to: string; actor: string; by: string }[];
}

/**
 * One notice for each step autopilot took that a window hasn't told yet (D-064): what it reviewed,
 * landed, re-dispatched, merged in, sent back for failing checks (D-076) or from the merge queue (GH-73),
 * or merged (GH-67), and what it couldn't do, as a warning. A land for a task with a ticket says its update
 * is ready to review: autopilot posts nothing, a person does (D-066).
 */
export function autopilotNotices(steps: AutopilotRecord[], tasks: AutopilotTask[]): TaskNotice[] {
  const out: TaskNotice[] = [];
  for (const r of steps) {
    const t = tasks.find((x) => x.id === r.task);
    const say = (text: string, urgent: boolean, actions: [string, string][] = []) => out.push({ kind: 'autopilot', task: r.task, text, urgent, actions, step: r });
    if (r.outcome === 'failed') {
      const by: Record<AutopilotStepName, [string, string]> = {
        review: ['Review', 'acc.task.review'], land: ['Land', 'acc.task.land'], dispatch: ['Re-dispatch', 'acc.task.dispatch'], refresh: ['Open pull request', 'acc.task.openPr'], resume: ['Resume', 'acc.task.resume'], checks: ['Open pull request', 'acc.task.openPr'], merge: ['Open pull request', 'acc.task.openPr'], start: ['Dispatch anyway', 'acc.task.dispatchAnyway'], queue: ['Open pull request', 'acc.task.openPr'],
      };
      const [verb, rest] = AUTOPILOT_VERB[r.step];
      say(`Autopilot couldn't ${verb} ${r.task}${rest}: ${endSentence(r.reason || 'it didn\'t say why')}`, true, [by[r.step]]);
    } else if (r.step === 'merge') {
      // Merged on GitHub: acc sync moves it to done and drafts its update next (GH-67).
      say(`Autopilot merged ${r.pr ? `pull request #${r.pr.number}` : 'the pull request'} (${r.task}).`, false, [['Open pull request', 'acc.task.openPr']]);
    } else if (r.step === 'checks') {
      // Its pull request's checks failed on GitHub: back to its builder, which autopilot re-dispatches next (D-076).
      say(`Autopilot sent ${r.task} back to its builder: checks failed on GitHub${r.checks?.length ? `: ${r.checks.join(', ')}` : ''}.`, false, [['Open pull request', 'acc.task.openPr']]);
    } else if (r.step === 'queue') {
      // The merge queue found a conflict, or its full check failed: back to its builder, re-dispatched next (GH-73).
      say(`Autopilot sent ${r.task} back to its builder from the merge queue: ${queueWhy(r)}.`, false, [['Open', 'acc.task.show']]);
    } else if (r.step === 'review' && r.verdict === 'changes') {
      // Autopilot re-dispatches a review's rework once: a second one waits for a person. Its re-dispatch
      // after a send-back for failing checks isn't that one (D-076).
      const again = !!t && reworkedByAutopilot(t, r.at);
      const what = r.reason ? `: ${endSentence(r.reason)}` : '.';
      if (again) say(`Autopilot's review asked for changes on ${r.task} again${what} A second rework waits for you.`, true, [['Re-dispatch', 'acc.task.dispatch']]);
      else say(`Autopilot's review asked for changes on ${r.task}${what} Autopilot re-dispatches it next.`, false);
    } else if (r.step === 'review') say(`Autopilot reviewed ${r.task}: it passed. Autopilot lands it next.`, false);
    else if (r.step === 'land' && r.pr) {
      const pr: [string, string] = ['Open pull request', 'acc.task.openPr'];
      const ticket = !!t?.source.key && isTrackerKind(t.source.kind);
      const landed = r.pr.opened ? `Autopilot landed ${r.task}: pull request #${r.pr.number}` : `Autopilot updated pull request #${r.pr.number} (${r.task})`;
      if (ticket) say(`${landed}. Its update for the ticket is ready for you to review and post.`, false, [['Review the update', 'acc.task.show'], pr]);
      else say(r.pr.opened ? landed : `${landed}.`, false, [pr]);
    } else if (r.step === 'dispatch') say(r.cause === 'checks' ? `Autopilot re-dispatched ${r.task} for its failing checks.` : r.cause === 'queue' ? `Autopilot re-dispatched ${r.task} with what the merge queue found.` : `Autopilot re-dispatched ${r.task} with its review's changes.`, false, [['Watch', 'acc.task.watch']]);
    // A builder that stopped, carried on once (D-067): what it last said.
    else if (r.step === 'resume') say(`Autopilot resumed ${r.task}${r.reason ? `: ${endSentence(saidLine(r.reason))}` : '.'}`, false, [['Watch', 'acc.task.watch']]);
    // A task a person dispatched that waited for others' files (D-093).
    else if (r.step === 'start') say(startedNotice(`Autopilot started ${r.task}`, r), false, [['Watch', 'acc.task.watch']]);
    else if (r.step === 'refresh') {
      // The merge queue's own, at the task's turn: pushed next, and merged once GitHub's checks pass (GH-73).
      if (r.base && r.queue) say(`The merge queue merged ${r.base} into ${r.task}, and its full check passed. It merges once GitHub's checks pass.`, false, [['Open pull request', 'acc.task.openPr']]);
      else if (r.base) say(`Autopilot merged ${r.base} into ${r.task}, and its checks passed. It's reviewed next, then landed.`, false, [['Open pull request', 'acc.task.openPr']]);
      else say(`${r.pr ? `Pull request #${r.pr.number} (${r.task})` : r.task} no longer conflicts with its base: autopilot found nothing to merge.`, false);
    }
  }
  return out;
}

/**
 * D-044's notices that autopilot's own already told: "The review passed X" and "The review asked for
 * changes on X", for a task whose newest autopilot step is the review that said so, and its move to
 * rework when that step sent it back for failing checks (D-076) or from the merge queue (GH-73). Autopilot lands or re-dispatches it
 * next, so a Land or Re-dispatch button would only race it.
 */
export function withoutAutopilotEcho(news: TaskNotice[], log: AutopilotRecord[]): TaskNotice[] {
  const newest = new Map<string, AutopilotRecord>();
  for (const r of log) if ((newest.get(r.task)?.seq ?? -1) < r.seq) newest.set(r.task, r);
  return news.filter((n) => {
    const r = newest.get(n.task);
    if (!r || r.outcome !== 'done') return true;
    if (r.step === 'checks' || r.step === 'queue') return n.kind !== 'rework';
    if (r.step !== 'review') return true;
    return !((n.kind === 'passed' && r.verdict === 'pass') || (n.kind === 'rework' && r.verdict === 'changes'));
  });
}

/** Where a repo's autopilot is, as its status bar item shows it. */
export type AutopilotSwitch = 'on' | 'off' | 'elsewhere' | 'refused';

export interface AutopilotStatusInput {
  project: string;
  /** More than one repo has autopilot: each item names its project. */
  many: boolean;
  state: AutopilotSwitch;
  /** The process holding autopilot's lock, when it runs elsewhere. */
  pid?: number | null;
  /** Why it can't run here, in acc's words. */
  refusal?: string | null;
  /** The last line it printed, while it's on here. */
  last?: string | null;
  /** The repo turns auto-merge on (GH-67): what autopilot does then includes merging. */
  autoMerge?: boolean;
}

/**
 * The status bar's autopilot switch (D-064): an icon and the words "Autopilot: on" or "Autopilot: off",
 * with the project's name when there's more than one. The tooltip says what it does, whether it merges
 * pull requests (GH-67), and what a click does. Off until a person turns it on: the switch lasts until
 * VSCode closes.
 */
export function autopilotStatus(s: AutopilotStatusInput): { text: string; tooltip: string } {
  const AUTOPILOT_DOES = `it ${autopilotDoes(!!s.autoMerge)}`;
  const name = s.many ? ` · ${s.project}` : '';
  if (s.state === 'on') {
    return {
      text: `$(rocket) Autopilot: on${name}`,
      tooltip: [`Autopilot is on for ${s.project}: ${AUTOPILOT_DOES}`, s.last ? `Last: ${s.last}` : '', 'Click to turn it off until VSCode closes.'].filter(Boolean).join('\n\n'),
    };
  }
  if (s.state === 'elsewhere') {
    return {
      text: `$(rocket) Autopilot: on elsewhere${name}`,
      tooltip: `Autopilot is on for ${s.project} in another window or a terminal (pid ${s.pid ?? 'unknown'}): ${AUTOPILOT_DOES}\n\nStop it there to run it in this window.`,
    };
  }
  if (s.state === 'refused') return { text: `$(circle-slash) Autopilot: off${name}`, tooltip: `Autopilot can't run for ${s.project}: ${s.refusal ?? 'acc refused it.'}` };
  return { text: `$(debug-pause) Autopilot: off${name}`, tooltip: `Autopilot is off for ${s.project}. When it's on, ${AUTOPILOT_DOES}\n\nClick to turn it on until VSCode closes.` };
}
