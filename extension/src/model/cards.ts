/**
 * What a task's card says about it and offers, on the agent board, on its tracker's board and on its page.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { BUILDER_PLACE_LOOK, cloudOffered, cloudReason } from '../../../packages/core/src/cloud.ts';
import type { BuilderPlace, CloudAgents } from '../../../packages/core/src/config.ts';
import { analysisReady, analysisWait, filesUnknown, sharesLine, waitLine } from '../logic/tasks.ts';
import { questionsWord, saidLine, taskNames, type TaskRow } from '../logic/shared.ts';
import type { Action, Look, Ref } from './shared.ts';

/**
 * Whether a person can dispatch it from here: a task to do that waits on nothing, or one back for rework.
 * Where the project wants an analysis first, a task to do waits for one that's ready; acc keeps
 * --without-analysis for the command line (D-052). Nor does it go while its analysis is under way.
 */
export function canDispatch(t: Pick<TaskRow, 'state' | 'analysis' | 'analyzing' | 'analysisRequired'> & { deps?: string[] }): boolean {
  if (t.state === 'rework') return true;
  if (t.state !== 'todo' || t.deps?.length || t.analyzing) return false;
  return !t.analysisRequired || analysisReady(t);
}

/** What a task to do shows about its analysis (D-052): an icon and words, orange when it waits on a person. */
export function analysisLook(t: Pick<TaskRow, 'state' | 'analysis' | 'analyzing'>): Look | null {
  if (t.state !== 'todo') return null;
  if (t.analyzing) return { label: 'Analyzing', icon: 'sync~spin', tone: 'blue' };
  const wait = analysisWait(t);
  if (wait === 'split') return { label: 'Needs you: too big for one task', icon: 'split-horizontal', tone: 'orange' };
  if (wait === 'questions') return { label: `Needs you: ${questionsWord(t.analysis!.open.length)} from its analysis`, icon: 'question', tone: 'orange' };
  return t.analysis ? { label: 'Analyzed: ready to build', icon: 'pass', tone: 'blue' } : null;
}

export const AUTOPILOT_STEP: Record<NonNullable<TaskRow['autopilot']>['step'], string> = { review: 'review', land: 'land', dispatch: 're-dispatch', refresh: 'update from its base', resume: 'resume', checks: 'send it back for its failing checks', merge: 'merge it', start: 'start it', queue: 'take it through the merge queue' };

/** "Needs you: autopilot couldn't land", and with `why`, its reason after it (D-055). */
export function autopilotLook(t: Pick<TaskRow, 'autopilot'>, why = true): Look | null {
  if (!t.autopilot) return null;
  return { label: `Needs you: autopilot couldn't ${AUTOPILOT_STEP[t.autopilot.step]}${why ? `: ${t.autopilot.reason}` : ''}`, icon: 'bell', tone: 'orange' };
}

/** "Needs you: pull request #16 was closed without merging", for a task in review: autopilot won't replace it, so a person lands it again or not (D-063). */
export function closedPrLook(t: Pick<TaskRow, 'state' | 'pr'>): Look | null {
  if (t.state !== 'review' || t.pr?.state !== 'closed') return null;
  return { label: `Needs you: pull request #${t.pr.number} was closed without merging`, icon: 'git-pull-request-closed', tone: 'orange' };
}

/** Where a task's builder runs (GH-69), with an icon: This Mac, or Cloud. Null before it has run. */
export function placeLook(t: Pick<TaskRow, 'state' | 'run'>): Look | null {
  if (!t.run || t.state === 'todo') return null;
  const where: BuilderPlace = t.run.where === 'cloud' ? 'cloud' : 'local';
  return { ...BUILDER_PLACE_LOOK[where], tone: 'neutral' };
}

/** Why cloud builders aren't offered for a project (GH-69), or null when they are: from its config alone. */
export const cloudDisabled = (config: { github: { repo: string } | null; agents?: { cloud?: CloudAgents | null } | null } | null | undefined): string | null =>
  cloudReason(cloudOffered({ github: config?.github ?? null, agents: { cloud: config?.agents?.cloud ?? null } }));

/** How much of what a stopped agent last said a card shows; its task page shows all of it. */
export const CARD_SAID = 120;

/**
 * "Needs you: its agent stopped: API Error: Your computer went to sleep mid-response. …", for a running
 * task whose builder stopped before acc done or acc block (D-067). Clipped to `max` characters.
 */
export function stoppedLook(t: Pick<TaskRow, 'stopped'>, max = CARD_SAID): Look | null {
  if (!t.stopped) return null;
  const said = t.stopped.said ? (Number.isFinite(max) ? saidLine(t.stopped.said, max) : t.stopped.said.trim()) : null;
  return { label: `Needs you: its agent stopped${said ? `: ${said}` : ' before it finished or blocked'}`, icon: 'debug-disconnect', tone: 'orange' };
}

/**
 * What a task says about its files beside other tasks' (D-093). A task a person dispatched that waits for
 * them: a clock, in blue, naming each task and its files, short on a card and in full on its page, and the
 * Ready tasks that go first. Its start failed: the bell, in orange. One that shares them, to do or started
 * beside them: neutral. A Ready task with no analysis, or one naming no files: its files aren't known,
 * neutral. Else nothing.
 */
export function filesLook(t: Pick<TaskRow, 'state' | 'display' | 'files' | 'analyzing'>, full = false): Look | null {
  const f = t.files;
  if (!f) return null;
  if (t.state === 'todo' && f.held) {
    if (f.held.failed) return { label: `Needs you: ${f.held.byAutopilot ? 'autopilot couldn\'t start it' : 'its start failed'}: ${f.held.failed}`, icon: 'bell', tone: 'orange' };
    if (f.shares.length && f.first.length) return { label: waitLine(f.shares, full, f.first), icon: 'clock', tone: 'blue' };
    if (f.capped) return { label: `Waits for an agent: as many are running as ${f.capped === 'machine' ? 'this machine\'s total allows, across every repo' : 'the project allows'}`, icon: 'clock', tone: 'blue' };
    return { label: f.shares.length ? `Starting: nothing else is ready, so it shares files with ${taskNames(f.shares.map((s) => s.task))}` : 'Starting: the files it waited for are free', icon: 'clock', tone: 'blue' };
  }
  if (f.shares.length && t.state !== 'done') return { label: sharesLine(f.shares, full), icon: 'files', tone: 'neutral' };
  if (t.state === 'todo' && t.display === 'ready' && !f.known && !t.analyzing) return { label: filesUnknown(!!f.analyzed), icon: 'info', tone: 'neutral' };
  return null;
}

/**
 * What a task's card offers, by where it is in its life. The one next step comes first: before a build,
 * that's its analysis (D-052) while one runs, has questions or says to split it, or when the project wants
 * one and there's none; then Dispatch.
 */
export function cardActions(t: TaskRow, ref: Ref, config?: Parameters<typeof cloudDisabled>[0]): Action[] {
  const a: Action[] = [];
  const todo = t.state === 'todo';
  const inCloud = t.run?.where === 'cloud' && (t.state === 'running' || t.state === 'review' || t.state === 'blocked');
  const dispatchable = canDispatch(t);
  const wait = analysisWait(t);
  if (todo && t.analyzing) a.push({ command: 'acc.task.watchAnalysis', label: 'Watch the analysis', icon: 'pulse', ref, primary: true });
  // Its questions are answered on its page, where it shows them.
  else if (wait === 'questions') a.push({ command: 'acc.task.show', label: 'Answer', icon: 'question', ref, primary: true });
  else if (wait === 'split') a.push({ command: 'acc.task.show', label: 'See the split', icon: 'split-horizontal', ref, primary: true });
  // A task a person dispatched already waits for others' files (D-093): its next step is starting it anyway.
  const held = todo && !!t.files?.held;
  if (dispatchable) a.push(held ? { command: 'acc.task.dispatchAnyway', label: 'Dispatch anyway', icon: 'rocket', ref, primary: !a.some((x) => x.primary) } : { command: 'acc.task.dispatch', label: t.state === 'rework' ? 'Re-dispatch' : 'Dispatch', icon: 'rocket', ref, primary: !a.some((x) => x.primary) });
  // The same, with a model a person picks for this task (D-086): behind ⋯ on the card.
  if (dispatchable) a.push({ command: 'acc.task.dispatchWith', label: `${t.state === 'rework' ? 'Re-dispatch' : 'Dispatch'} with…`, icon: 'sparkle', ref });
  // And in the cloud (GH-69), where the project opted in; disabled with the reason where it didn't.
  if (dispatchable && config !== undefined) {
    const why = cloudDisabled(config);
    a.push({ command: 'acc.task.dispatchCloud', label: `${t.state === 'rework' ? 'Re-dispatch' : 'Dispatch'} to the cloud`, icon: 'cloud-upload', ref, ...(why ? { disabled: why } : {}) });
  }
  if (todo && !t.analyzing && !t.analysis) a.push({ command: 'acc.task.analyze', label: 'Analyze', icon: 'telescope', ref, primary: !!t.analysisRequired && !a.some((x) => x.primary) });
  // In review (D-032, D-033): watch the reviewer, review it, land it, or follow its pull request.
  if (t.state === 'review') {
    const open = t.pr?.state === 'open';
    if (t.reviewing) a.push({ command: 'acc.task.watchReview', label: 'Watch the review', icon: 'pulse', ref, primary: true });
    else if (open) a.push({ command: 'acc.task.openPr', label: `Pull request #${t.pr!.number}`, icon: 'git-pull-request', ref, primary: true });
    else if (t.review?.current && t.review.verdict === 'pass') a.push({ command: 'acc.task.land', label: 'Land', icon: 'git-pull-request-create', ref, primary: true });
    else a.push({ command: 'acc.task.review', label: t.review?.current ? 'Review again' : 'Review', icon: 'checklist', ref, primary: true });
    if (open && t.review?.current && t.review.verdict === 'pass' && !t.reviewing) a.push({ command: 'acc.task.land', label: 'Update pull request', icon: 'repo-push', ref });
  }
  // Its builder stopped before acc done or acc block (D-067): the next step is carrying it on.
  const stopped = t.state === 'running' && !!t.stopped && !t.resuming && !!t.run?.sessionId;
  if (stopped) a.push({ command: 'acc.task.resume', label: 'Resume', icon: 'debug-continue', ref, primary: true });
  // A cloud builder (GH-69): Watch opens its session on claude.ai, Send a message queues one there with
  // claude -p --cloud, Collect brings its branch in; Attach and Open in Claude Code can't reach it.
  if (inCloud) {
    a.push({ command: 'acc.task.watch', label: 'Watch', icon: 'pulse', ref, primary: !dispatchable && t.state === 'running' && !t.cloud?.wait });
    if (t.state === 'running') a.push({ command: 'acc.task.message', label: 'Send a message', icon: 'comment', ref });
    if (t.state === 'running') a.push({ command: 'acc.task.collect', label: 'Collect', icon: 'cloud-download', ref, primary: !!t.cloud?.wait || !!t.cloud?.finished });
    if (t.state === 'running') a.push({ command: 'acc.task.openInClaude', label: 'Open in Claude Code', icon: 'comment-discussion', ref, disabled: 'Its conversation runs on claude.ai, not on this Mac: Watch opens it there.' });
  }
  // Waiting in its own terminal, it's answered by attaching; anything else is seen on its page.
  const inTerminal = !stopped && t.display === 'needs-you' && !t.asking && !!t.run?.bgId;
  if (!inCloud && (t.state === 'running' || t.state === 'review' || t.state === 'blocked') && (t.run?.bgId || t.run?.sessionId)) a.push({ command: 'acc.task.watch', label: 'Watch', icon: 'pulse', ref, primary: !dispatchable && t.state === 'running' && !inTerminal && !stopped });
  // Its conversation in a Claude Code tab (D-040); the terminal is the fallback when that isn't installed.
  if (!inCloud && t.state === 'running' && (t.run?.bgId || t.run?.sessionId)) a.push({ command: 'acc.task.openInClaude', label: 'Open in Claude Code', icon: 'comment-discussion', ref, primary: inTerminal });
  if (t.run?.worktree && t.state !== 'todo') a.push({ command: 'acc.task.openWorktree', label: 'Worktree', icon: 'empty-window', ref });
  if (t.run?.worktree && t.state !== 'todo') a.push({ command: 'acc.task.openPacket', label: 'Instructions', icon: 'book', ref });
  // A finished task's next step is clearing its worktree away; otherwise Move is the fallback (D-062).
  const tidy = t.state === 'done' && !!t.run?.worktree;
  a.push({ command: 'acc.task.move', label: 'Move', icon: 'arrow-swap', ref, primary: !tidy && !a.some((x) => x.primary) });
  if (t.pr && t.pr.state !== 'open') a.push({ command: 'acc.task.openPr', label: `Pull request #${t.pr.number}`, icon: 'git-pull-request', ref });
  if (held) a.push({ command: 'acc.task.stopWaiting', label: 'Stop waiting', icon: 'debug-pause', ref });
  // A cloud builder can't be stopped from here (GH-69): Abandon sets the task aside and offers its page to archive it.
  if (t.state === 'running') a.push({ command: 'acc.task.abandon', label: inCloud ? 'Abandon (its session stays on claude.ai)' : 'Abandon', icon: 'debug-stop', ref, danger: true });
  else if (t.state === 'blocked') a.push({ command: 'acc.task.unblock', label: 'Unblock', icon: 'debug-restart', ref });
  else if (t.state !== 'done') a.push({ command: 'acc.task.block', label: 'Block', icon: 'circle-slash', ref });
  if ((t.state === 'done' || t.state === 'blocked' || t.state === 'todo') && t.run?.worktree) a.push({ command: 'acc.task.cleanup', label: 'Clean up', icon: 'trash', ref, primary: tidy && !a.some((x) => x.primary) });
  if (t.source.url) a.push({ command: 'acc.task.openTicket', label: 'Ticket', icon: 'link-external', ref });
  a.push({ command: 'acc.task.show', label: 'Details', icon: 'note', ref });
  return a;
}
