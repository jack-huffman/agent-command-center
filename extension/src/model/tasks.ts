/**
 * The Tasks section's agent board (D-041): its lanes and cards, and what a task's card says about it.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { DISPLAY, findRule, type State } from '../../../packages/core/src/ledger.ts';
import { analysisReady, analysisWait, conflictLine, failedChecksLine, filesUnknown, groupTasks, sharesLine, waitLine } from '../logic/tasks.ts';
import { BOARD_LANES, fileList, prConflicts, questionsWord, saidLine, shortPath, TASK_GROUPS, taskNames, type TaskRow } from '../logic/shared.ts';
import { type BoardInput, trackerBoard, type TrackerBoard } from './boards.ts';
import { type Action, type HubLike, KEY, type Look, LOOK, type ModelArea, type Ref, short } from './shared.ts';
import { hasTicket, withClient } from './updates.ts';
import { autoMergeOn } from '../../../packages/core/src/config.ts';

// ---------------------------------------------------------------- tasks: the board

export interface Card {
  id: string;
  title: string;
  environment: string;
  waitingOn: string[];
  url: string | null;
  agent: Look | null;
  /** The model its agent runs with, shown beside its state (D-086). */
  model: string | null;
  /** What its builder is called (D-087), shown when its agent line is hovered. Older runs have none. */
  agentName: string | null;
  worktree: string | null;
  /** "Conflicts with dev: …" when its open pull request won't merge into its base (D-049). */
  conflicts: string | null;
  /** "Checks failed on GitHub: …" in review, or in rework after autopilot sent it back for them (D-076). */
  failedChecks: string | null;
  /** Where its analysis is, for a task to do (D-052): under way, waiting on you, or ready to build from. */
  analysis: Look | null;
  /** What autopilot couldn't do for it, and why (D-055). */
  autopilot: Look | null;
  /** Its pull request someone closed without merging, which autopilot won't replace (D-063). */
  closedPr: Look | null;
  /** Its builder stopped before acc done or acc block, with the last thing it said, clipped (D-067). */
  stopped: Look | null;
  /** Its files beside other tasks' (D-093): it waits for them, its start failed, it shares them, or a Ready task's aren't known. */
  files: Look | null;
  actions: Action[];
  /** The lanes it can be dropped in: the moves a person may make from where it is (D-041). */
  drops: string[];
}

/** The state a lane stands for when a card is dropped in it. Running means dispatching it. */
const LANE_STATE: Record<string, State | 'dispatch' | null> = { 'needs-you': null, ready: 'todo', todo: 'todo', running: 'dispatch', review: 'review', rework: 'rework', blocked: 'blocked', done: 'done' };

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

/** How much of what a stopped agent last said a card shows; its task page shows all of it. */
export const CARD_SAID = 120;

/**
 * "Needs you: its agent stopped: API Error: Your computer went to sleep mid-response. …", for a running
 * task whose builder stopped before acc done or acc block (D-067). Clipped to `max` characters.
 */
export function stoppedLook(t: Pick<TaskRow, 'stopped'>, max = CARD_SAID): Look | null {
  if (!t.stopped) return null;
  const said = t.stopped.said ? (Number.isFinite(max) ? saidLine(t.stopped.said, max) : t.stopped.said.trim()) : null;
  return { label: `Needs you: its agent stopped${said ? `: ${said}` : ' before acc done or acc block'}`, icon: 'debug-disconnect', tone: 'orange' };
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
    if (f.capped) return { label: 'Waits for an agent: as many are running as the project allows', icon: 'clock', tone: 'blue' };
    return { label: f.shares.length ? `Starting: nothing else is ready, so it shares files with ${taskNames(f.shares.map((s) => s.task))}` : 'Starting: the files it waited for are free', icon: 'clock', tone: 'blue' };
  }
  if (f.shares.length && t.state !== 'done') return { label: sharesLine(f.shares, full), icon: 'files', tone: 'neutral' };
  if (t.state === 'todo' && t.display === 'ready' && !f.known && !t.analyzing) return { label: filesUnknown(!!f.analyzed), icon: 'info', tone: 'neutral' };
  return null;
}

/** The lanes a task can be dropped in by a person, by acc's own move rules. Whether it then goes is acc's call. */
export function dropLanes(t: Pick<TaskRow, 'state' | 'display' | 'analysis' | 'analyzing' | 'analysisRequired'> & { deps?: string[] }): string[] {
  // Back to to-do shows as Ready when nothing it waits on is unfinished: one lane, the one it lands in.
  const todoLane = t.deps?.length ? 'todo' : 'ready';
  return BOARD_LANES.filter((g) => {
    const to = LANE_STATE[g];
    if (!to || g === t.display) return false;
    if (to === 'todo' && g !== todoLane) return false;
    if (to === 'dispatch') return canDispatch(t);
    if (to === t.state) return false;
    return !!findRule(t.state as State, to)?.actors.includes('human');
  });
}

/** What dropping a task in a lane does: the state to move it to, or dispatch. */
export const laneMove = (lane: string): State | 'dispatch' | null => LANE_STATE[lane] ?? null;

/**
 * What a task's card offers, by where it is in its life. The one next step comes first: before a build,
 * that's its analysis (D-052) while one runs, has questions or says to split it, or when the project wants
 * one and there's none; then Dispatch.
 */
export function cardActions(t: TaskRow, ref: Ref): Action[] {
  const a: Action[] = [];
  const todo = t.state === 'todo';
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
  // Waiting in its own terminal, it's answered by attaching; anything else is seen on its page.
  const inTerminal = !stopped && t.display === 'needs-you' && !t.asking && !!t.run?.bgId;
  if ((t.state === 'running' || t.state === 'review' || t.state === 'blocked') && (t.run?.bgId || t.run?.sessionId)) a.push({ command: 'acc.task.watch', label: 'Watch', icon: 'pulse', ref, primary: !dispatchable && t.state === 'running' && !inTerminal && !stopped });
  // Its conversation in a Claude Code tab (D-040); the terminal is the fallback when that isn't installed.
  if (t.state === 'running' && (t.run?.bgId || t.run?.sessionId)) a.push({ command: 'acc.task.openInClaude', label: 'Open in Claude Code', icon: 'comment-discussion', ref, primary: inTerminal });
  if (t.run?.worktree && t.state !== 'todo') a.push({ command: 'acc.task.openWorktree', label: 'Worktree', icon: 'empty-window', ref });
  if (t.run?.worktree && t.state !== 'todo') a.push({ command: 'acc.task.openPacket', label: 'Instructions', icon: 'book', ref });
  // A finished task's next step is clearing its worktree away; otherwise Move is the fallback (D-062).
  const tidy = t.state === 'done' && !!t.run?.worktree;
  a.push({ command: 'acc.task.move', label: 'Move', icon: 'arrow-swap', ref, primary: !tidy && !a.some((x) => x.primary) });
  if (t.pr && t.pr.state !== 'open') a.push({ command: 'acc.task.openPr', label: `Pull request #${t.pr.number}`, icon: 'git-pull-request', ref });
  if (held) a.push({ command: 'acc.task.stopWaiting', label: 'Stop waiting', icon: 'debug-pause', ref });
  if (t.state === 'running') a.push({ command: 'acc.task.abandon', label: 'Abandon', icon: 'debug-stop', ref, danger: true });
  else if (t.state === 'blocked') a.push({ command: 'acc.task.unblock', label: 'Unblock', icon: 'debug-restart', ref });
  else if (t.state !== 'done') a.push({ command: 'acc.task.block', label: 'Block', icon: 'circle-slash', ref });
  if ((t.state === 'done' || t.state === 'blocked' || t.state === 'todo') && t.run?.worktree) a.push({ command: 'acc.task.cleanup', label: 'Clean up', icon: 'trash', ref, primary: tidy && !a.some((x) => x.primary) });
  if (t.source.url) a.push({ command: 'acc.task.openTicket', label: 'Ticket', icon: 'link-external', ref });
  a.push({ command: 'acc.task.show', label: 'Details', icon: 'note', ref });
  return a;
}

export interface Column extends Look {
  group: string;
  cards: Card[];
}

export interface TasksModel {
  kind: 'tasks';
  projects: { name: string; root: string; github: boolean; columns: Column[]; total: number; boards: TrackerBoard[] }[];
}

export function tasksModel(hub: HubLike, boards: (root: string) => BoardInput[] = () => []): TasksModel {
  return {
    kind: 'tasks',
    projects: hub.projects.map((p) => {
      const rows = hub.taskRows(p.root);
      const byGroup = new Map(groupTasks(rows).map((g) => [g.group, g.tasks]));
      const columns: Column[] = BOARD_LANES.map((group) => {
        const d = DISPLAY[group];
        return {
          group, label: d.label, icon: d.icon, tone: d.tone,
          cards: (byGroup.get(group) ?? []).map((t) => ({
            id: t.id, title: t.title, environment: t.environment, waitingOn: t.deps, url: t.source.url,
            // A stopped builder's line says it all: its old session's own state would only repeat it.
            agent: t.stopped ? null : t.agent ?? null, model: t.stopped || !t.agent ? null : t.model ?? null, agentName: t.run?.name ?? null, worktree: t.run?.worktree ?? null, conflicts: conflictLine(t), failedChecks: failedChecksLine(t), analysis: analysisLook(t), autopilot: autopilotLook(t), closedPr: closedPrLook(t),
            stopped: t.autopilot ? null : stoppedLook(t), files: filesLook(t),
            actions: cardActions(t, { project: p.root, task: t.id }), drops: dropLanes(t),
          })),
        };
      });
      return { name: p.name, root: p.root, github: !!p.config.github, columns, total: rows.length, boards: boards(p.root).map((b) => trackerBoard(b, rows, p.root)) };
    }),
  };
}

export type Message =
  /** A task's card dropped in another lane of the agent board (D-041). */
  | { type: 'move-task'; project: string; task: string; to: string };

export const area: ModelArea = {
  home: {
    order: 10,
    attention(c, p) {
      const { hub, questions, attention, ready, linked } = c;
      for (const r of hub.taskRows(p.root)) {
        const ref: Ref = { project: p.root, task: r.id };
        const acts = cardActions(r, ref);
        const details: Action = { command: 'acc.task.show', label: 'Open', icon: 'go-to-file', ref };
        if (r.run?.bgId) linked.add(r.run.bgId);
        if (r.display === 'needs-you') {
          // Its question is shown on its own, to answer in place.
          if (questions.some((q) => q.task === r.id && q.project === p.root)) continue;
          // Its analysis waits on you (D-052): its questions, to answer here, or a split to look at on its page.
          const wait = analysisWait(r);
          if (wait) {
            const n = r.analysis!.split.length;
            const detail = wait === 'questions' ? `${p.name} · answer here, and its builder gets your answers` : `${p.name} · its analysis suggests ${n ? `${n} smaller tasks` : 'smaller tasks'}, on its page`;
            attention.push({ key: `t:${p.root}:${r.id}`, look: analysisLook(r)!, title: `${r.id} ${r.title}`, detail, project: p.name, actions: [details], ...(wait === 'questions' ? { analysis: { project: p.root, task: r.id, questions: withClient(r.analysis!.open, r.id, hub.updates?.(p.root) ?? []), canAsk: hasTicket(r.source.kind) } } : {}) });
            continue;
          }
          // A step autopilot couldn't take (D-055): why, and the same step to take by hand.
          if (r.autopilot) {
            const byHand = acts.find((a) => a.primary && ['acc.task.review', 'acc.task.land', 'acc.task.dispatch', 'acc.task.openPr', 'acc.task.resume'].includes(a.command));
            attention.push({ key: `t:${p.root}:${r.id}`, look: autopilotLook(r, false)!, title: `${r.id} ${r.title}`, detail: `${p.name} · ${r.autopilot.reason.replace(/([^.!?])$/, '$1.')} Do it by hand, or a new commit lets autopilot try again.`, project: p.name, actions: [...(byHand ? [byHand] : []), details] });
            continue;
          }
          // A task a person dispatched couldn't start on its own once its wait was over (D-093): why, and Dispatch anyway.
          if (r.state === 'todo' && r.files?.held?.failed) {
            const anyway = acts.find((a) => a.command === 'acc.task.dispatchAnyway');
            attention.push({ key: `t:${p.root}:${r.id}`, look: LOOK(r.files.held.byAutopilot ? 'Needs you: autopilot couldn\'t start it' : 'Needs you: its start failed', 'bell', 'orange'), title: `${r.id} ${r.title}`, detail: `${p.name} · ${r.files.held.failed.replace(/([^.!?])$/, '$1.')} Dispatch it anyway, or stop it waiting.`, project: p.name, actions: [...(anyway ? [anyway] : []), details] });
            continue;
          }
          // Its builder stopped before acc done or acc block (D-067): what it last said, and Resume.
          if (r.stopped) {
            const resume = acts.find((a) => a.command === 'acc.task.resume');
            const watch = acts.find((a) => a.command === 'acc.task.watch');
            const said = r.stopped.said ? saidLine(r.stopped.said, 140) : 'its turn ended before acc done or acc block';
            attention.push({ key: `t:${p.root}:${r.id}`, look: LOOK('Its agent stopped', 'debug-disconnect', 'orange'), title: `${r.id} ${r.title}`, detail: `${p.name} · ${said}`, ...(r.stopped.said ? { tip: r.stopped.said } : {}), project: p.name, actions: [...(resume ? [resume] : []), ...(watch ? [{ ...watch, primary: false }] : []), details] });
            continue;
          }
          // Its pull request was closed (D-063): autopilot won't replace it, so a person lands it again, or reopens it first.
          if (closedPrLook(r)) {
            const next = acts.find((a) => a.primary && ['acc.task.land', 'acc.task.review', 'acc.task.watchReview'].includes(a.command));
            const link = acts.find((a) => a.command === 'acc.task.openPr');
            attention.push({ key: `t:${p.root}:${r.id}`, look: LOOK('Pull request closed', 'git-pull-request-closed', 'orange'), title: `${r.id} ${r.title}`, detail: `${p.name} · pull request #${r.pr!.number} was closed without merging. Land it to open a new one, or reopen it on GitHub and land to update it.`, project: p.name, actions: [...(next ? [next] : []), ...(link ? [link] : []), details] });
            continue;
          }
          const watch = acts.find((a) => a.command === 'acc.task.watch');
          const attach = acts.find((a) => a.command === 'acc.task.openInClaude');
          // A pull request that needs you says why: its checks, a person's requested changes, or a conflict.
          // Conflicting files go by folder and name, as on the cards; in full on hover and on the task's page.
          const pr = r.state === 'review' && r.pr?.state === 'open' ? r.pr : null;
          if (pr) {
            const files = prConflicts(r);
            const why = [
              pr.changesRequested ? 'a reviewer asked for changes on GitHub' : '',
              pr.ci === 'failing' ? `its checks are failing${r.checks?.length ? `: ${r.checks.join(', ')}` : ''}` : '',
              files.length ? `it conflicts with ${r.environment} in ${fileList(files.map(shortPath))}` : '',
            ].filter(Boolean).join(', and ');
            const label = pr.changesRequested ? 'Changes requested' : pr.ci === 'failing' ? 'Checks failing' : 'Conflicts';
            attention.push({ key: `t:${p.root}:${r.id}`, look: LOOK(label, 'git-pull-request', 'orange'), title: `${r.id} ${r.title}`, detail: `${p.name} · pull request #${pr.number}: ${why}`, ...(files.length ? { tip: files.join('\n') } : {}), project: p.name, actions: [...acts.filter((a) => a.command === 'acc.task.openPr').map((a) => ({ ...a, primary: true })), details] });
            continue;
          }
          attention.push({ key: `t:${p.root}:${r.id}`, look: r.agent ?? LOOK('Needs you', 'bell-dot', 'orange'), title: `${r.id} ${r.title}`, detail: `${p.name} · its agent is waiting on you in its terminal`, project: p.name, actions: [...(attach ? [{ ...attach, primary: true }] : []), ...(watch ? [{ ...watch, primary: false }] : []), details] });
        } else if (r.display === 'blocked') {
          attention.push({ key: `t:${p.root}:${r.id}`, look: LOOK('Blocked', 'circle-slash', 'orange'), title: `${r.id} ${r.title}`, detail: `${p.name} · blocked`, project: p.name, actions: [details] });
        } else if (r.display === 'review' && r.queue && autoMergeOn(p.config)) {
          // In the merge queue, nothing waits on you: the Merge queue panel shows it, with what it waits on (GH-73).
          continue;
        } else if (r.display === 'review') {
          // Where it is on the way to a pull request, and the one next step.
          const next = acts.find((a) => a.primary && ['acc.task.review', 'acc.task.land', 'acc.task.openPr', 'acc.task.watchReview'].includes(a.command));
          const where = r.reviewing ? 'its reviewer is reading it' : r.pr?.state === 'open' ? `pull request #${r.pr.number} is open${r.pr.ci === 'pending' ? ', checks running' : r.pr.ci === 'passing' ? ', checks passing' : ''}`
            : r.review?.current ? (r.review.verdict === 'pass' ? 'reviewed: ready to land' : 'review asked for changes') : 'done by its agent, not reviewed yet';
          attention.push({ key: `t:${p.root}:${r.id}`, look: LOOK(r.pr?.state === 'open' ? 'Pull request open' : 'Waiting for review', r.pr?.state === 'open' ? 'git-pull-request' : 'eye', 'blue'), title: `${r.id} ${r.title}`, detail: `${p.name} · ${where}`, project: p.name, actions: [...(next ? [next] : []), details] });
        } else if (r.display === 'ready') {
          // Its next step: Dispatch, or its analysis first where the project wants one (D-052).
          const next = acts.find((a) => a.primary && ['acc.task.dispatch', 'acc.task.analyze', 'acc.task.watchAnalysis'].includes(a.command));
          if (next) ready.push({ project: p.name, id: r.id, title: r.title, environment: r.environment, action: next });
        }
      }
    },
    stats({ tasks, rows, ready }) {
    const onBoard = tasks.projects.reduce((n, p) => n + p.boards.reduce((k, b) => k + b.columns.reduce((c, col) => c + col.cards.length, 0), 0), 0);
    // One in the merge queue isn't for you to check: the queue merges it (GH-73).
    const review = rows.filter((r) => r.display === 'review' && !r.queue).length;
      return [
        { order: 10, tile: tasks.projects.some((p) => p.boards.length)
          ? { label: 'On the board', value: String(onBoard), icon: 'project', tone: 'neutral', section: 'tasks', hint: 'Tickets on your trackers\' boards' }
          : { label: 'Tasks', value: String(rows.length), icon: 'tasklist', tone: 'neutral', section: 'tasks', hint: 'Tasks acc keeps' } },
      { order: 20, tile: { label: 'Ready', value: String(ready.length), icon: 'rocket', tone: ready.length ? 'blue' : 'neutral', section: 'tasks', hint: 'Tasks an agent can start now' } },
      { order: 40, tile: { label: 'Waiting for review', value: String(review), icon: 'eye', tone: review ? 'blue' : 'neutral', section: 'tasks', hint: 'Finished by an agent, for you to check' } },
      ];
    },
    nav({ rows }) {
    const taskAttention = rows.filter((r) => r.display === 'needs-you' || r.display === 'blocked').length;
      return { section: 'tasks', label: 'Tasks', icon: 'project', count: taskAttention || rows.length || null, attention: taskAttention > 0, hint: taskAttention ? `${taskAttention} need you` : `${rows.length} task${rows.length === 1 ? '' : 's'}` };
    },
  },
  messages: {
    'move-task': (x) => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string) && (TASK_GROUPS as readonly string[]).includes(x.to as string),
  },
};
