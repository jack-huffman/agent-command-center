/**
 * What a task's card says about it and offers, on the agent board, on its tracker's board and on its page.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { BUILDER_PLACE_LOOK, cloudOffered, cloudReason } from '../../../packages/core/src/cloud.ts';
import type { BuilderPlace, CloudAgents } from '../../../packages/core/src/config.ts';
import { editRefusal } from '../../../packages/core/src/edit.ts';
import { againRefusal } from '../../../packages/core/src/again.ts';
import { DISPATCH_AGAIN, MISSING_WORDS, UNSEEN_WORDS } from '../../../packages/core/src/started.ts';
import type { State } from '../../../packages/core/src/ledger.ts';
import { analysisReady, analysisWait, filesUnknown, sharesLine, waitLine } from '../logic/tasks.ts';
import { questionsWord, saidLine, taskNames, type TaskRow } from '../logic/shared.ts';
import { choicesWord, forYou } from '../logic/plan.ts';
import type { Action, Look, Ref } from './shared.ts';
import { WORDS } from '../../webview/plain-words.ts';

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
export function analysisLook(t: Pick<TaskRow, 'state' | 'analysis' | 'analyzing'> & { analysisRequired?: boolean }): Look | null {
  if (t.state !== 'todo') return null;
  if (t.analyzing) return { label: 'Making a plan', icon: 'sync~spin', tone: 'blue' };
  const wait = analysisWait(t);
  if (wait === 'split') return { label: 'Needs you: too big for one task', icon: 'split-horizontal', tone: 'orange' };
  if (wait === 'questions') return { label: `Needs you: ${questionsWord(forYou(t.analysis!.open).length)} from its plan`, icon: 'question', tone: 'orange' };
  // Its plan's choices, then its approval (T-97).
  if (wait === 'choices') return { label: `Needs you: ${choicesWord(t.analysis!.choices!)} to make in its plan`, icon: 'list-selection', tone: 'orange' };
  if (wait === 'approve') return { label: 'Needs you: approve its plan', icon: 'verified', tone: 'orange' };
  if (t.analysis?.approved) return { label: 'Plan approved: ready to build', icon: 'verified-filled', tone: 'blue' };
  return t.analysis ? { label: 'Planned: ready to build', icon: 'pass', tone: 'blue' } : null;
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

/**
 * A task's review in the cloud, on its card and on In progress (T-86): reviewing while its verdict is
 * awaited, needs you once it's quiet for too long or its verdict couldn't be read. Null for a review here.
 */
export function cloudReviewLook(t: Pick<TaskRow, 'cloudReview'>): Look | null {
  const c = t.cloudReview;
  if (!c) return null;
  if (c.wait) return { label: `Needs you: ${c.wait}`, icon: 'bell', tone: 'orange' };
  if (c.failed) return null;
  return { label: 'Reviewing in the cloud', icon: 'cloud', tone: 'blue' };
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
 * Why a task needs you when its builder didn't start, or acc can't see its builder (T-92): the line and the
 * way on, in orange, with a plug for one that never started and a shut eye for one acc can't see. Else null.
 */
export function unseenLook(t: Pick<TaskRow, 'state' | 'unseen' | 'notStarted'>): Look | null {
  if (t.notStarted && (t.state === 'todo' || t.state === 'rework')) return { label: `Needs you: ${t.notStarted.reason}. ${DISPATCH_AGAIN} starts a new builder with the same model, effort and place.`, icon: 'plug', tone: 'orange' };
  if (t.unseen && t.state === 'running') return { label: `Needs you: ${UNSEEN_WORDS[t.unseen].line}. ${UNSEEN_WORDS[t.unseen].wayOn}`, icon: 'eye-closed', tone: 'orange' };
  return null;
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
 * A task's actions in the one order its card, its page and the palette show them (D-168): the next step,
 * then Move, then Block or Unblock, then the rest as they came.
 */
export function actionOrder(actions: Action[]): Action[] {
  const lead = [actions.find((x) => x.primary), actions.find((x) => x.command === 'acc.task.move'), actions.find((x) => x.command === 'acc.task.block' || x.command === 'acc.task.unblock')]
    .filter((x, i, l): x is Action => !!x && l.indexOf(x) === i);
  return [...lead, ...actions.filter((x) => !lead.includes(x))];
}

/**
 * What a task's card offers, by where it is in its life, in actionOrder. The one next step comes first:
 * before a build, that's its analysis (D-052) while one runs, has questions or says to split it, or when
 * the project wants one and there's none; then Dispatch.
 */
export function cardActions(t: TaskRow, ref: Ref): Action[] {
  return actionOrder(offered(t, ref));
}

/** What a task offers, as each step of its life adds it. */
function offered(t: TaskRow, ref: Ref): Action[] {
  const a: Action[] = [];
  const todo = t.state === 'todo';
  const inCloud = t.run?.where === 'cloud' && (t.state === 'running' || t.state === 'review' || t.state === 'blocked');
  const dispatchable = canDispatch(t);
  const wait = analysisWait(t);
  if (todo && t.analyzing) a.push({ command: 'acc.task.watchAnalysis', label: 'Watch the plan being made', icon: 'pulse', ref, primary: true });
  // Its questions are answered on its page, where it shows them.
  else if (wait === 'questions') a.push({ command: 'acc.task.show', label: 'Answer', icon: 'question', ref, primary: true });
  else if (wait === 'split') a.push({ command: 'acc.task.show', label: 'See the split', icon: 'split-horizontal', ref, primary: true });
  // Its choices are made, and its plan approved, on its page (T-97).
  else if (wait === 'choices' || wait === 'approve') a.push({ command: 'acc.task.show', label: 'See the plan', icon: 'checklist', ref, primary: true });
  // Its builder didn't start, or acc can't see it (T-92): Dispatch again leads where it didn't start or has gone
  // quiet; where Claude Code only doesn't answer, the builder may still be at work, so it's behind ⋯.
  const notStarted = !!t.notStarted && (todo || t.state === 'rework');
  const unseen = t.state === 'running' ? t.unseen ?? null : null;
  // No claude to start one with (T-93): nothing to click.
  if (notStarted || (unseen && unseen !== 'missing')) a.push({ command: 'acc.task.dispatchAgain', label: DISPATCH_AGAIN, icon: 'debug-restart', ref, primary: (notStarted || unseen === 'quiet') && !a.some((x) => x.primary) });
  // A task a person dispatched already waits for others' files (D-093): its next step is starting it anyway.
  const held = todo && !!t.files?.held;
  // Its sheet asks for the model, the effort and where it runs (D-168), so there's one Build it.
  if (dispatchable) a.push(held ? { command: 'acc.task.dispatchAnyway', label: `${WORDS.buildIt} anyway`, icon: 'rocket', ref, primary: !a.some((x) => x.primary) } : { command: 'acc.task.dispatch', label: t.state === 'rework' ? `${WORDS.buildIt} again` : WORDS.buildIt, icon: 'rocket', ref, primary: !a.some((x) => x.primary) });
  if (todo && !t.analyzing && !t.analysis) a.push({ command: 'acc.task.analyze', label: WORDS.makePlan, icon: 'lightbulb', ref, primary: !!t.analysisRequired && !a.some((x) => x.primary) });
  // In review (D-032, D-033): watch the reviewer, review it, land it, or follow its pull request.
  if (t.state === 'review') {
    const open = t.pr?.state === 'open';
    // A cloud review that needs you (T-86): the way on is a review on this Mac, whatever the project's setting.
    if (t.cloudReview?.wait) a.push({ command: 'acc.task.reviewLocal', label: 'Review on this Mac', icon: 'checklist', ref, primary: true });
    if (t.reviewing) a.push({ command: 'acc.task.watchReview', label: 'Watch the review', icon: 'pulse', ref, primary: !a.some((x) => x.primary) });
    else if (t.cloudReview?.wait) { /* a quiet or failed cloud review: Review on this Mac leads, above */ }
    else if (open) a.push({ command: 'acc.task.openPr', label: `Pull request #${t.pr!.number}`, icon: 'git-pull-request', ref, primary: true });
    else if (t.review?.current && t.review.verdict === 'pass') a.push({ command: 'acc.task.land', label: WORDS.openPullRequest, icon: 'git-pull-request-create', ref, primary: true });
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
  // Its agent waits on a question in the Command Center (D-030): Answer opens it in Needs you, as the Agents
  // tab's does, and Watch goes behind ⋯ (T-39).
  const answer = !inCloud && !stopped && !!t.asking && !!t.question;
  if (answer) a.push({ command: 'acc.task.show', label: 'Answer', icon: 'bell', ref, primary: true, question: t.question! });
  // Waiting in its own terminal, it's answered by attaching; anything else is seen on its page.
  const inTerminal = !stopped && !unseen && t.display === 'needs-you' && !t.asking && !!t.run?.bgId;
  if (!inCloud && (t.state === 'running' || t.state === 'review' || t.state === 'blocked') && (t.run?.bgId || t.run?.sessionId)) a.push({ command: 'acc.task.watch', label: 'Watch', icon: 'pulse', ref, primary: !dispatchable && t.state === 'running' && !inTerminal && !stopped && !answer && !unseen });
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
  // Edit opens the task sheet (T-74); off with why while its builder runs or once it's done.
  const noEdit = editRefusal({ state: t.state as State });
  a.push({ command: 'acc.task.edit', label: 'Edit', icon: 'edit', ref, ...(noEdit ? { disabled: noEdit } : {}) });
  if (t.source.url) a.push({ command: 'acc.task.openTicket', label: 'Ticket', icon: 'link-external', ref });
  a.push({ command: 'acc.task.show', label: 'Details', icon: 'note', ref });
  return a;
}

/**
 * Why Dispatch again is off for a task (T-93), or null where it's on: its builder didn't start, or acc can't
 * see it. A running builder acc can see, or one with no claude to start another, is never stopped by it.
 */
export function dispatchAgainOff(t: Pick<TaskRow, 'id' | 'state' | 'notStarted' | 'unseen'>): string | null {
  if (t.notStarted && (t.state === 'todo' || t.state === 'rework')) return null;
  if (t.state === 'running' && (t.unseen === 'unanswered' || t.unseen === 'quiet')) return null;
  if (t.state === 'running' && t.unseen === 'missing') return MISSING_WORDS;
  return againRefusal(t.id);
}
