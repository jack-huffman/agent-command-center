/**
 * History on the Overview (D-037): your answers, every task's moves, autopilot's steps and the commands acc ran.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { type AutopilotRecord, byAutopilot } from '../../../packages/core/src/autopilot-log.ts';
import type { HistoryRecord } from '../../../packages/core/src/questions.ts';
import { isUnder, taskNames } from '../logic/shared.ts';
import { queueWhy } from '../logic/autopilot.ts';
import { describePermission, questionsOf } from './questions.ts';
import { runCard, type RunInput } from './runs.ts';
import { type HubLike, type Look, LOOK, sessionKey } from './shared.ts';
import { AUTOPILOT_STEP } from './cards.ts';

// ---------------------------------------------------------------- what happened to each question (D-037)

/** A question that has ended, in words: what was asked, and what you decided. */
export interface Decision {
  id: string;
  at: number;
  askedAt: number;
  sessionId: string;
  icon: string;
  /** What it asked for, after its name: "wanted to run a command". */
  asked: string;
  code: string | null;
  /** What happened, with an icon and words. Blue for your yes and your answers; neutral otherwise. */
  look: Look;
  /** Your answers, or your reason for saying no. */
  detail: string | null;
}

const PAST: Record<string, string> = { 'wants to': 'wanted to', 'has a plan for you to approve': 'had a plan for you to approve', 'has a question for you': 'asked you' };

export function decisionOf(h: HistoryRecord): Decision {
  const ask = h.tool === 'AskUserQuestion';
  const d = ask ? { icon: 'comment-discussion', title: 'asked you', code: null as string | null, detail: null } : describePermission(h.tool, h.input, h.cwd);
  const asked = Object.entries(PAST).reduce((t, [now, then]) => t.replace(now, then), d.title);
  const questions = ask ? questionsOf(h.input).map((q) => q.question) : [];
  const answers = h.answers ? Object.entries(h.answers).map(([q, a]) => `${q} → ${a}`).join('\n') : null;
  const look: Record<string, Look> = {
    allowed: LOOK('You allowed it', 'pass', 'blue'),
    'allowed-for-session': LOOK('You allowed it for the session', 'check-all', 'blue'),
    'allowed-for-project': LOOK('You always allow it in this project', 'repo', 'blue'),
    'allowed-edited': LOOK('You edited the command, and allowed it', 'edit', 'blue'),
    'allowed-auto-mode': LOOK('You allowed it, and switched it to auto mode', 'sparkle', 'blue'),
    'allowed-accept-edits': LOOK('You approved the plan, with edits accepted', 'check-all', 'blue'),
    'denied-stopped': LOOK('You said no, and stopped it', 'debug-stop', 'neutral'),
    denied: ask ? LOOK('You let it decide', 'sparkle', 'neutral') : LOOK('You said no', 'circle-slash', 'neutral'),
    answered: LOOK('You answered', 'comment', 'blue'),
    terminal: LOOK('Handed to its own terminal', 'terminal', 'neutral'),
    'no-window': LOOK('Asked in its own terminal: no Command Center was open for its folder', 'terminal', 'neutral'),
    'window-closed': LOOK('The Command Center closed, so it asked in its terminal', 'terminal', 'neutral'),
    'timed-out': LOOK('No answer within the hour, so it asked in its terminal', 'clock', 'neutral'),
    stopped: LOOK('Answered in its own terminal, or the session stopped', 'debug-stop', 'neutral'),
  };
  return {
    id: h.id, at: h.endedAt, askedAt: h.askedAt, sessionId: h.sessionId, icon: d.icon, asked: ask && questions.length ? `asked: ${questions.join(' · ')}` : asked,
    code: d.code, look: look[h.outcome] ?? LOOK(h.outcome, 'question', 'neutral'),
    detail: answers ?? (h.command ? `Ran instead: ${h.command}` : h.message ? `"${h.message}"` : null),
  };
}

export type HistoryItem =
  | { kind: 'move'; at: string; project: string; task: string; title: string; from: string | null; to: string; by: string }
  /** A step autopilot took (D-064), with what it did in words, and its pull request's link. */
  | { kind: 'autopilot'; at: string; project: string; task: string; title: string; look: Look; detail: string | null; url: string | null }
  | { kind: 'answer'; at: string; project: string; who: string; session: string; decision: Decision }
  | { kind: 'run'; at: string; label: string; command: string; look: Look; lines: string[] };

/** What a step autopilot took looks like in History (D-064): an icon for the step, and what it did. */
export function autopilotStepLook(r: AutopilotRecord): { look: Look; detail: string | null; url: string | null } {
  if (r.outcome === 'failed') return { look: LOOK(`Autopilot couldn't ${AUTOPILOT_STEP[r.step]}`, 'warning', 'orange'), detail: r.reason || null, url: null };
  if (r.step === 'review') {
    return r.verdict === 'changes'
      ? { look: LOOK('Autopilot\'s review asked for changes', 'request-changes', 'neutral'), detail: r.reason || null, url: null }
      : { look: LOOK('Autopilot reviewed it: passed', 'pass', 'blue'), detail: null, url: null };
  }
  if (r.step === 'land' && r.pr) return { look: LOOK(r.pr.opened ? `Autopilot landed it: pull request #${r.pr.number}` : `Autopilot updated pull request #${r.pr.number}`, 'git-pull-request', 'blue'), detail: null, url: r.pr.url || null };
  // Its pull request's checks failed on GitHub: back to its builder, and re-dispatched for them (D-076).
  if (r.step === 'checks') return { look: LOOK('Autopilot sent it back: checks failed on GitHub', 'github-action', 'neutral'), detail: r.checks?.length ? r.checks.join(', ') : r.reason || null, url: null };
  // The merge queue found a conflict with its base, or its full check failed: back to its builder (GH-73).
  if (r.step === 'queue') return { look: LOOK('Autopilot sent it back from the merge queue', 'git-merge', 'neutral'), detail: `${queueWhy(r).replace(/^./, (c) => c.toUpperCase())}.`, url: null };
  if (r.step === 'dispatch') return { look: LOOK(r.cause === 'checks' ? 'Autopilot re-dispatched it for its failing checks' : r.cause === 'queue' ? 'Autopilot re-dispatched it with what the merge queue found' : 'Autopilot re-dispatched it for the review\'s changes', 'debug-restart', 'blue'), detail: null, url: null };
  // A builder that stopped, carried on once (D-067), with the last thing it said.
  if (r.step === 'resume') return { look: LOOK('Autopilot resumed it', 'debug-continue', 'blue'), detail: r.reason || null, url: null };
  // A task a person dispatched, started once the files it waited for were free, or nothing else was ready (D-093).
  if (r.step === 'start') {
    return r.shares?.length
      ? { look: LOOK(`Autopilot started it: nothing else was ready, so it shares files with ${taskNames(r.shares.map((s) => s.task))}`, 'rocket', 'blue'), detail: r.shares.map((s) => `${s.task}: ${s.files.join(', ')}`).join('; '), url: null }
      : { look: LOOK(`Autopilot started it${r.waitedFor?.length ? `: ${taskNames(r.waitedFor)}'s files are free` : ''}`, 'rocket', 'blue'), detail: null, url: null };
  }
  // Merged where the repo turns auto-merge on (GH-67): acc sync moves it to done.
  if (r.step === 'merge') return { look: LOOK(r.pr ? `Autopilot merged pull request #${r.pr.number}` : 'Autopilot merged its pull request', 'git-merge', 'blue'), detail: 'acc sync moves it to done.', url: r.pr?.url || null };
  // The merge queue's own, at its turn: it carries its review, is pushed, and merges once GitHub's checks pass (GH-73).
  if (r.base && r.queue) return { look: LOOK(`The merge queue merged ${r.base} into it`, 'git-merge', 'blue'), detail: 'Its full check passed on the merge. It merges once GitHub\'s checks pass.', url: null };
  if (r.base) return { look: LOOK(`Autopilot merged ${r.base} into it`, 'git-merge', 'blue'), detail: 'Its checks passed on the merge. It\'s reviewed next, then landed.', url: null };
  return { look: LOOK('Autopilot found it no longer conflicts', 'git-merge', 'blue'), detail: null, url: r.pr?.url || null };
}

/** Everything that happened, newest first: your answers, task moves, autopilot's steps and the commands acc ran. */
export function historyItems(hub: HubLike, runs: RunInput[] = [], limit = 300): HistoryItem[] {
  // Autopilot's steps, once each though two projects share a repo's ledger.
  const steps: Extract<HistoryItem, { kind: 'autopilot' }>[] = [];
  const seen = new Set<string>();
  for (const p of hub.projects) {
    for (const r of hub.autopilotLog?.(p.root) ?? []) {
      const key = `${p.name}|${r.task}|${r.seq}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const title = hub.taskRows(p.root).find((t) => t.id === r.task)?.title ?? '';
      steps.push({ kind: 'autopilot', at: r.at, project: p.name, task: r.task, title, ...autopilotStepLook(r) });
    }
  }
  // A move autopilot made is told by its step, so it isn't listed twice.
  const told = (project: string, h: { at: string; task: string; by: string }) => byAutopilot(h.by)
    && steps.some((s) => s.project === project && s.task === h.task && Math.abs(Date.parse(s.at) - Date.parse(h.at)) < 5_000);
  const moves: HistoryItem[] = hub.projects.flatMap((p) => (hub.history?.(p.root) ?? []).filter((h) => !told(p.name, h))
    .map((h) => ({ kind: 'move' as const, at: h.at, project: p.name, task: h.task, title: h.title, from: h.from, to: h.to, by: h.by })));
  const answers: HistoryItem[] = (hub.answers ?? []).map((h) => {
    const project = hub.projectFor(h.cwd);
    const session = hub.agents.find((s) => s.sessionId === h.sessionId);
    const row = project ? hub.taskRows(project.root).find((r) => r.run?.sessionId === h.sessionId || (!!r.run?.worktree && isUnder(h.cwd, r.run.worktree))) : undefined;
    return { kind: 'answer' as const, at: new Date(h.endedAt).toISOString(), project: project?.name ?? '', who: row?.id ?? session?.name ?? 'An agent', session: session ? sessionKey(session) : h.sessionId, decision: decisionOf(h) };
  });
  const done: HistoryItem[] = runs.filter((r) => r.endedAt !== null).map((r) => {
    const c = runCard(r, 30);
    return { kind: 'run' as const, at: new Date(r.endedAt!).toISOString(), label: r.label, command: r.command, look: c.look, lines: c.lines };
  });
  return [...moves, ...steps, ...answers, ...done].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
