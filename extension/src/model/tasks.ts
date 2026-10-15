/**
 * The Tasks section's agent board: its lanes and cards, and what needs you about a task.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { DISPLAY, findRule, type State } from '../../../packages/core/src/ledger.ts';
import { analysisWait, conflictLine, failedChecksLine, groupTasks } from '../logic/tasks.ts';
import { BOARD_LANES, fileList, prConflicts, saidLine, shortPath, TASK_GROUPS, type TaskRow } from '../logic/shared.ts';
import { type BoardInput, trackerBoard, type TrackerBoard } from './boards.ts';
import { type Action, type HubLike, KEY, type Look, LOOK, type ModelArea, type Ref, short } from './shared.ts';
import { hasTicket, withClient } from './updates.ts';
import { autoMergeOn } from '../../../packages/core/src/config.ts';
import { analysisLook, autopilotLook, canDispatch, cardActions, closedPrLook, filesLook, placeLook, stoppedLook } from './cards.ts';

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
  /** Where its builder runs (GH-69): This Mac or Cloud, with an icon. Null before it has run. */
  place: Look | null;
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
            stopped: t.autopilot ? null : stoppedLook(t), files: filesLook(t), place: placeLook(t),
            actions: cardActions(t, { project: p.root, task: t.id }, p.config), drops: dropLanes(t),
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
  commands: [
    'acc.task.dispatch', 'acc.task.dispatchWith', 'acc.task.dispatchCloud', 'acc.task.message', 'acc.task.collect', 'acc.task.dispatchAnyway', 'acc.task.stopWaiting', 'acc.task.attach', 'acc.task.openWorktree', 'acc.task.abandon', 'acc.task.cleanup',
    'acc.task.add', 'acc.task.importGithub', 'acc.task.importJira', 'acc.task.show', 'acc.task.move', 'acc.task.block', 'acc.task.unblock', 'acc.task.openTicket',
    'acc.task.watch', 'acc.task.resume', 'acc.task.openInClaude', 'acc.task.review', 'acc.task.watchReview', 'acc.task.land', 'acc.task.openPr',
    'acc.task.analyze', 'acc.task.watchAnalysis',
  ],
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
            const said = r.stopped.said ? saidLine(r.stopped.said, 140) : 'its turn ended before it finished or blocked';
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
    nav({ rows }) {
    const taskAttention = rows.filter((r) => r.display === 'needs-you' || r.display === 'blocked').length;
      return { section: 'tasks', label: 'Tasks', icon: 'project', count: taskAttention || rows.length || null, attention: taskAttention > 0, hint: taskAttention ? `${taskAttention} need you` : `${rows.length} task${rows.length === 1 ? '' : 's'}` };
    },
  },
  messages: {
    'move-task': (x) => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string) && (TASK_GROUPS as readonly string[]).includes(x.to as string),
  },
};
