/**
 * What each editor tab shows, as plain data. Built here from the hub's data, posted to the webview,
 * and rendered there with text only (no HTML from data). No vscode import, so it's testable.
 */
import type { Analysis } from '../../packages/core/src/analyze.ts';
import { autopilotDoes, type AutopilotRecord, byAutopilot } from '../../packages/core/src/autopilot.ts';
import { DISPLAY, findRule, type State, type Task } from '../../packages/core/src/ledger.ts';
import type { GateStatus } from '../../packages/core/src/receipts.ts';
import { declaredKeys, DESCRIPTIONS, type Option, type TrackerDescription, type Values } from '../../packages/core/src/trackers/connect.ts';
import { type Doc, fromMarkdown } from '../../packages/core/src/trackers/doc.ts';
import { isTrackerKind, type StatusCategory, type Ticket, type TrackerKind, trackerName } from '../../packages/core/src/trackers/types.ts';
import type { GithubIdentity } from '../../packages/core/src/github.ts';
import { GROUP_TITLES, STEPS } from '../../packages/core/src/onboarding/steps.ts';
import { autoMergeOn, type Environment, type Tracker, trackerForKey } from '../../packages/core/src/config.ts';
import { promotionPaths } from '../../packages/core/src/promote.ts';
import type { Answer, HistoryRecord, Question } from '../../packages/core/src/questions.ts';
import { isOpenUpdate, stalePosting, type Update, UPDATE_ID, UPDATE_TEXT_MAX } from '../../packages/core/src/updates.ts';
import { agentLook, type AgentSession, type AnalysisAsk, analysisReady, analysisWait, BOARD_LANES, conflictLine, type DoctorItem, ENV_ICON, failedChecksLine, fileList, groupTasks, isUnder, prConflicts, questionsWord, type RunPrompt, saidLine, shortPath, TASK_GROUPS, type TaskRow, type Tone } from './logic.ts';
import { isSlackWebhook, SLACK_KINDS, type SlackCard, type SlackKind } from './slack.ts';
import type { Entry } from './transcript.ts';

export const VIEW_KINDS = ['tasks', 'agents', 'worktrees', 'environments', 'setup'] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];
export { promotionPaths };

export const VIEW_TITLES: Record<ViewKind, string> = {
  tasks: 'Tasks', agents: 'Agents', worktrees: 'Worktrees', environments: 'Environments', setup: 'Setup',
};

/** Identifies what an action applies to. The extension turns it back into the sidebar's node. */
export interface Ref {
  project?: string;
  task?: string;
  session?: string;
  worktree?: string;
  env?: string;
  step?: string;
}

export interface Action {
  command: string;
  label: string;
  icon: string;
  ref: Ref;
  primary?: boolean;
  danger?: boolean;
}

export interface Look {
  label: string;
  icon: string;
  tone: Tone;
}

/** What a kind of agent runs with, as the Agents section shows it (D-036). */
export interface ProfileLike {
  model: string | null;
  effort: string | null;
  fallbackModel: string | null;
  from: { model: string; effort: string; fallbackModel: string };
}

export interface ProjectLike {
  name: string;
  root: string;
  agents?: { builder: ProfileLike; reviewer: ProfileLike };
  /**
   * autonomy: what autopilot may do on its own (D-055), when the config says. autopilot.autoMerge: whether
   * it merges pull requests (GH-67). trackers: which owns a ticket's key (D-066).
   */
  config: { github: { repo: string; account: string } | null; environments: Environment[]; profile: string; autonomy?: string; autopilot?: { autoMerge?: boolean }; trackers?: Pick<Tracker, 'kind' | 'project' | 'prefix'>[] };
  branch: string | null;
  worktrees: { path: string; head: string; branch: string | null; main: boolean; changed: number; locked: boolean; prunable: boolean }[];
}

export interface HubLike {
  projects: ProjectLike[];
  agents: AgentSession[];
  agentsError: string | null;
  taskRows(root: string): TaskRow[];
  projectFor(path: string): ProjectLike | undefined;
  /** Every move every task made, for the Overview's activity. */
  history?(root: string): ActivityItem[];
  /** The steps autopilot took in a project's repo, oldest first, wherever it ran (D-064). */
  autopilotLog?(root: string): AutopilotRecord[];
  /** The updates acc drafted for a project's tickets, posted or not (D-066). */
  updates?(root: string): Update[];
  /** Agents' questions waiting in the Command Center (D-030). */
  questions?: Question[];
  /** How earlier questions ended (D-037). */
  answers?: HistoryRecord[];
  askingFor?(s: AgentSession): string | null;
}

/** The key a session goes by in refs: its session id, else its background id. */
export const sessionKey = (s: AgentSession): string => s.sessionId ?? s.id ?? `${s.pid ?? ''}:${s.startedAt}`;

// ---------------------------------------------------------------- tasks: the board

export interface Card {
  id: string;
  title: string;
  environment: string;
  waitingOn: string[];
  url: string | null;
  agent: Look | null;
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

const AUTOPILOT_STEP: Record<NonNullable<TaskRow['autopilot']>['step'], string> = { review: 'review', land: 'land', dispatch: 're-dispatch', refresh: 'update from its base', resume: 'resume', checks: 'send it back for its failing checks', merge: 'merge it' };

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
const CARD_SAID = 120;

/**
 * "Needs you: its agent stopped: API Error: Your computer went to sleep mid-response. …", for a running
 * task whose builder stopped before acc done or acc block (D-067). Clipped to `max` characters.
 */
export function stoppedLook(t: Pick<TaskRow, 'stopped'>, max = CARD_SAID): Look | null {
  if (!t.stopped) return null;
  const said = t.stopped.said ? (Number.isFinite(max) ? saidLine(t.stopped.said, max) : t.stopped.said.trim()) : null;
  return { label: `Needs you: its agent stopped${said ? `: ${said}` : ' before acc done or acc block'}`, icon: 'debug-disconnect', tone: 'orange' };
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
  if (dispatchable) a.push({ command: 'acc.task.dispatch', label: t.state === 'rework' ? 'Re-dispatch' : 'Dispatch', icon: 'rocket', ref, primary: !a.some((x) => x.primary) });
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
            agent: t.stopped ? null : t.agent ?? null, worktree: t.run?.worktree ?? null, conflicts: conflictLine(t), failedChecks: failedChecksLine(t), analysis: analysisLook(t), autopilot: autopilotLook(t), closedPr: closedPrLook(t),
            stopped: t.autopilot ? null : stoppedLook(t),
            actions: cardActions(t, { project: p.root, task: t.id }), drops: dropLanes(t),
          })),
        };
      });
      return { name: p.name, root: p.root, github: !!p.config.github, columns, total: rows.length, boards: boards(p.root).map((b) => trackerBoard(b, rows, p.root)) };
    }),
  };
}

// ---------------------------------------------------------------- tracker boards (D-026)

/** Blue while a ticket is moving; to-do and done stay neutral, so orange keeps meaning a person is needed. */
export const CATEGORY_TONE: Record<StatusCategory, Tone> = { todo: 'neutral', doing: 'blue', done: 'neutral' };

export interface PersonChip {
  name: string;
  initials: string;
}

export const initials = (name: string): string => name.replace(/[^\p{L}\p{N}\s.-]/gu, '').split(/[\s.-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const chip = (p: { name: string }): PersonChip => ({ name: p.name, initials: initials(p.name) });

/** A codicon for each kind of ticket, so a bug reads as a bug at a glance. */
export function typeIcon(type: string | null): string {
  const t = (type ?? '').toLowerCase();
  if (t.includes('bug') || t.includes('defect')) return 'bug';
  if (t.includes('epic')) return 'zap';
  if (t.includes('story')) return 'bookmark';
  if (t.includes('sub')) return 'list-tree';
  if (t.includes('task')) return 'tasklist';
  if (t.includes('improve') || t.includes('feature')) return 'lightbulb';
  if (t.includes('backlog item') || t.includes('requirement')) return 'bookmark';
  if (t.includes('test')) return 'beaker';
  return 'issues';
}

export function priorityIcon(priority: string | null): string | null {
  const p = (priority ?? '').toLowerCase();
  if (!p) return null;
  if (/highest|blocker|critical|urgent/.test(p)) return 'chevron-up';
  if (/high/.test(p)) return 'arrow-up';
  if (/lowest|trivial/.test(p)) return 'chevron-down';
  if (/low|minor/.test(p)) return 'arrow-down';
  return null; // medium, normal: the ordinary case needs no mark
}

/** What the extension knows about one tracker's board (see trackers.ts). */
export interface BoardInput {
  index: number;
  kind: TrackerKind;
  title: string;
  board: { source: string; title: string; url: string | null; notice: string | null; columns: { id: string; name: string; category: StatusCategory; statusIds: string[] }[]; cards: { key: string; title: string; url: string; status: { id: string; name: string }; type: string | null; assignees: { name: string }[]; labels: { name: string; color: string | null }[]; priority: string | null }[] } | null;
  error: string | null;
  connect: { command: string; label: string; arg: string } | null;
  loading: boolean;
  /** Who the board acts as: the GitHub account, the Jira email, the Microsoft account. */
  signedInAs?: string | null;
  /** Where its tickets come from (D-072), such as "Jira · ACME · epic ACME-3 Premium Support". */
  place?: string | null;
  /** Tasks whose tickets left the place after work on them started, each named (D-072). */
  left?: string[];
  /** Its cards being tracked, or whose last Track didn't go, by key (D-074). */
  tracking?: Record<string, { busy: boolean; error: string | null }>;
}

export interface TrackerCard {
  key: string;
  title: string;
  type: string | null;
  typeIcon: string;
  priority: string | null;
  priorityIcon: string | null;
  labels: { name: string; color: string | null }[];
  assignees: PersonChip[];
  status: string;
  /** The task acc keeps for this ticket, when there is one: where it is, its next step, why its pull request won't merge, and its checks that failed on GitHub. */
  acc: { look: Look; needsYou: boolean; action: Action | null; conflicts: string | null; failedChecks: string | null } | null;
  /**
   * Track, for a ticket acc doesn't keep yet (D-074): ready, on its way, or why the last try didn't go.
   * Null once acc keeps it, and in a done column, where there's nothing left to build.
   */
  track: { busy: boolean; error: string | null } | null;
}

export interface TrackerColumn {
  id: string;
  name: string;
  tone: Tone;
  done: boolean;
  cards: TrackerCard[];
}

export interface TrackerBoard {
  index: number;
  kind: TrackerKind;
  title: string;
  source: string | null;
  url: string | null;
  notice: string | null;
  error: string | null;
  connect: { command: string; label: string; arg: string } | null;
  loading: boolean;
  signedInAs: string | null;
  /** Where its tickets come from (D-072), drawn under its name. */
  place: string | null;
  /**
   * Tasks whose tickets left the place after work on them started (D-072). They're off this board, but
   * still on the agent board, for a person to finish or set aside.
   */
  left: string[];
  columns: TrackerColumn[];
}

/**
 * The agent's side of a ticket: acc's own state, or what the agent, or its analysis (D-052), is doing
 * about it. `full` is the task page's: a stopped agent's last words in full, not clipped as on a card.
 */
function accLook(row: TaskRow, full = false): Look {
  if (row.autopilot && row.display === 'needs-you') return autopilotLook(row)!;
  const closed = closedPrLook(row);
  if (closed) return closed;
  const stopped = stoppedLook(row, full ? Infinity : CARD_SAID);
  if (stopped) return stopped;
  if (row.agent && row.display === 'needs-you') return row.agent;
  const analysis = analysisLook(row);
  if (analysis && (row.display === 'needs-you' || row.analyzing)) return analysis;
  const d = DISPLAY[row.display];
  return { label: d.label, icon: d.icon, tone: d.tone };
}

/** The steps a tracker's card offers for its task: start it, its analysis (D-052), or watch its agent. */
const NEXT_STEPS = ['acc.task.dispatch', 'acc.task.analyze', 'acc.task.watchAnalysis', 'acc.task.show', 'acc.task.watch', 'acc.task.openInClaude', 'acc.task.resume'];

export function trackerBoard(b: BoardInput, rows: TaskRow[], root: string): TrackerBoard {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const columns: TrackerColumn[] = (b.board?.columns ?? []).map((c) => ({
    id: c.id, name: c.name, tone: CATEGORY_TONE[c.category], done: c.category === 'done',
    cards: (b.board?.cards ?? []).filter((card) => c.statusIds.includes(card.status.id)).map((card): TrackerCard => {
      const row = byId.get(card.key);
      const next = row ? cardActions(row, { project: root, task: row.id }).find((a) => a.primary && NEXT_STEPS.includes(a.command)) ?? null : null;
      const tracking = b.tracking?.[card.key];
      return {
        key: card.key, title: card.title, type: card.type, typeIcon: typeIcon(card.type), priority: card.priority, priorityIcon: priorityIcon(card.priority),
        labels: card.labels, assignees: card.assignees.map(chip), status: card.status.name,
        acc: row ? { look: accLook(row), needsYou: row.display === 'needs-you', action: next, conflicts: conflictLine(row), failedChecks: failedChecksLine(row) } : null,
        track: row || c.category === 'done' ? null : { busy: !!tracking?.busy, error: tracking?.error ?? null },
      };
    }),
  }));
  return {
    index: b.index, kind: b.kind, title: b.board?.title ?? b.title, source: b.board?.source ?? null, url: b.board?.url ?? null,
    notice: b.board?.notice ?? null, error: b.error, connect: b.connect, loading: b.loading, signedInAs: b.signedInAs ?? null,
    place: b.place ?? null, left: b.left ?? [], columns,
  };
}

// ---------------------------------------------------------------- a ticket's page (D-026)

export interface TicketAcc {
  look: Look;
  environment: string;
  waitingOn: string[];
  blocker: string | null;
  /** Every file its open pull request conflicts in with its base, in one line, or null (D-049). */
  conflicts: string | null;
  /** "Checks failed on GitHub: …", or null (D-076). Not `checks`: those are acc's own, on its commit. */
  failedChecks: string | null;
  agent: Look | null;
  worktree: string | null;
  branch: string | null;
  /** waived: a person set it aside on this commit (D-031). */
  checks: { gate: string; status: GateStatus; summary: string; waived?: boolean }[];
  history: { at: string; from: string | null; to: string; by: string; reason: string | null }[];
  actions: Action[];
}

export interface TicketModel {
  kind: 'ticket';
  project: string;
  tracker: number | null;
  key: string;
  title: string;
  url: string | null;
  sourceLabel: string;
  sourceKind: TrackerKind | 'acc';
  loading: boolean;
  error: string | null;
  /** Why the ticket isn't shown: it's outside the repo's place, and names it (D-072). */
  outside: string | null;
  connect: { command: string; label: string; arg: string } | null;
  type: string | null;
  typeIcon: string;
  status: { name: string; tone: Tone } | null;
  assignees: PersonChip[];
  reporter: PersonChip | null;
  labels: { name: string; color: string | null }[];
  priority: string | null;
  priorityIcon: string | null;
  created: string | null;
  updated: string | null;
  body: Doc;
  comments: { id: string; author: PersonChip; created: string; body: Doc; url: string | null }[];
  related: { key: string; title: string; relation: string; url: string | null }[];
  /**
   * What the page may change in the tracker. Nothing, for a task acc alone keeps. A ticket's status,
   * assignee and labels only when its tracker says "edits": true; comments always (D-066).
   */
  can: { status: boolean; assign: boolean; labels: boolean; comment: boolean };
  /** Updates acc drafted for its ticket, waiting for a person to read, edit and post (D-066). */
  updates: UpdateCard[];
  acc: TicketAcc | null;
  /** What its analysis found (D-052), gist first. Null for a ticket acc doesn't keep, or one past needing it. */
  analysis: TicketAnalysis | null;
  /** A tracker ticket acc doesn't keep yet, which "Track in acc" adds to the ledger. */
  trackable: boolean;
  /** It's being tracked now, from this page or its card (D-074). */
  tracking: boolean;
  /** Who a comment or change is made as. */
  signedInAs: string | null;
}

/** A task's analysis as its page shows it (D-052): the verdict and summary, its questions, then the rest folded. */
export interface TicketAnalysis {
  /** The task its answers are for. */
  task: string;
  look: Look;
  /** Why there isn't one yet, or what a running one is doing. */
  note: string | null;
  summary: string | null;
  size: string | null;
  at: string | null;
  /** Questions nobody has answered, to answer right there: only before the build. */
  open: AnalysisAsk[];
  /** Whether its questions can be sent to the client: its task has a ticket to post on (D-066). */
  canAsk: boolean;
  /** What a person decided, and, once it's built, what its builder assumed for the rest. */
  decided: { question: string; answer: string; assumed: boolean }[];
  /** The smaller tasks it suggests, when it's too big for one. */
  split: string[];
  goal: string | null;
  criteria: string[];
  assumptions: string[];
  outOfScope: string[];
  findings: { area: string; detail: string; source: string }[];
  plan: string[];
  refactors: { what: string; why: string }[];
  risks: string[];
  tests: string[];
  files: { path: string; change: string; why: string }[];
  actions: Action[];
}

export interface TicketInput {
  project: string;
  tracker: number | null;
  trackerTitle: string | null;
  trackerKind: TrackerKind | null;
  key: string;
  ticket: Ticket | null;
  loading: boolean;
  error: string | null;
  /** The ticket is outside the repo's place (D-072), and why. */
  outside?: string | null;
  connect: TicketModel['connect'];
  row: TaskRow | null;
  task: Task | null;
  checks: TicketAcc['checks'];
  signedInAs?: string | null;
  /** Its analysis, read whole (D-052). */
  analysis?: Analysis | null;
  /** Its tracker says "edits": true, so the page may change status, assignee and labels (D-066). */
  trackerEdits?: boolean;
  /** The project's ticket updates; the page shows its task's. */
  updates?: Update[];
  /** The project's boards, for who an update posts as, and the project's GitHub account. */
  boards?: BoardInput[];
  github?: string | null;
  /** It's being tracked now, from its page or its card (D-074). */
  tracking?: boolean;
  now?: number;
}

/**
 * The Analysis section of a task's page (D-052). A task to do shows it even with none yet, to start one;
 * a task past that shows the one it was built from, if it had one.
 */
export function ticketAnalysis(row: TaskRow, a: Analysis | null, ref: Ref, updates: Update[] = []): TicketAnalysis | null {
  const todo = row.state === 'todo';
  if (!a && !row.analyzing && !todo) return null;
  const open = todo ? withClient((a?.questions ?? []).filter((q) => !q.answer).map(({ id, question, why, suggested }) => ({ id, question, why, suggested })), row.id, updates) : [];
  const look: Look = row.analyzing ? { label: 'Analyzing', icon: 'sync~spin', tone: 'blue' }
    : !a ? { label: 'Not analyzed yet', icon: 'circle-large-outline', tone: 'neutral' }
      : !todo ? { label: 'Analyzed before the build', icon: 'pass', tone: 'blue' }
        : a.verdict === 'split' ? { label: 'Too big for one task', icon: 'split-horizontal', tone: 'orange' }
          : open.length ? { label: `${questionsWord(open.length)} for you`, icon: 'question', tone: 'orange' }
            : { label: 'Ready to build', icon: 'pass', tone: 'blue' };
  const note = row.analyzing ? 'An analyst is reading the ticket and the code. It changes nothing.'
    : a ? null
      : row.analysisRequired ? 'This project wants an analysis before a task is built: what it asks for, what\'s there now, and how to build it.'
        : 'An analyst can work out what it asks for, what\'s there now, and how to build it, before an agent builds it.';
  const actions: Action[] = [];
  if (row.analyzing) actions.push({ command: 'acc.task.watchAnalysis', label: 'Watch the analysis', icon: 'pulse', ref, primary: true });
  // acc analyzes before a build, or after one is set aside: never while it's being built, nor once it's done.
  else if (!a && todo) actions.push({ command: 'acc.task.analyze', label: 'Analyze', icon: 'telescope', ref, primary: !!row.analysisRequired });
  else if (a && row.state !== 'running' && row.state !== 'done') actions.push({ command: 'acc.task.analyze', label: 'Analyze again', icon: 'refresh', ref });
  const decided = (a?.questions ?? []).flatMap((q) => (q.answer ? [{ question: q.question, answer: q.answer.text, assumed: false }] : todo ? [] : [{ question: q.question, answer: q.suggested, assumed: true }]));
  return {
    task: row.id, look, note, summary: a?.summary ?? null, size: a?.approach.size ?? null, at: a?.at ?? null, open, canAsk: hasTicket(row.source.kind), decided, split: a?.verdict === 'split' ? a.split : [],
    goal: a?.requirements.goal || null, criteria: a?.requirements.criteria ?? [], assumptions: a?.requirements.assumptions ?? [], outOfScope: a?.requirements.outOfScope ?? [],
    findings: a?.findings ?? [], plan: a?.approach.plan ?? [], refactors: a?.approach.refactors ?? [], risks: a?.approach.risks ?? [], tests: a?.approach.tests ?? [], files: a?.approach.files ?? [],
    actions,
  };
}

export function ticketModel(i: TicketInput): TicketModel {
  const t = i.ticket;
  const live = i.tracker !== null;
  const acc: TicketAcc | null = i.row && i.task ? {
    look: accLook(i.row, true), environment: i.task.environment, waitingOn: i.row.deps, blocker: i.task.blocker, conflicts: conflictLine(i.row, true), failedChecks: failedChecksLine(i.row),
    agent: i.row.stopped ? null : i.row.agent ?? null, worktree: i.task.run?.worktree ?? null, branch: i.task.run?.branch ?? null, checks: i.checks,
    history: i.task.history.map((h) => ({ at: h.at, from: h.from, to: h.to, by: h.by, reason: h.reason ?? null })).reverse(),
    // Its analysis has its own section, with its own buttons.
    actions: cardActions(i.row, { project: i.project, task: i.row.id }).filter((a) => !['acc.task.show', 'acc.task.openTicket', 'acc.task.analyze', 'acc.task.watchAnalysis'].includes(a.command)),
  } : null;
  const own = !live && i.task;
  return {
    kind: 'ticket', project: i.project, tracker: i.tracker, key: t?.key ?? i.key,
    title: t?.title ?? i.task?.title ?? i.key, url: t?.url ?? i.task?.source.url ?? null,
    sourceLabel: i.trackerTitle ?? 'Task kept by acc', sourceKind: t?.kind ?? i.trackerKind ?? 'acc',
    loading: i.loading, error: i.error, outside: i.outside ?? null, connect: i.connect,
    type: t?.type ?? null, typeIcon: typeIcon(t?.type ?? null),
    status: t ? { name: t.status.name, tone: CATEGORY_TONE[t.status.category] } : acc ? { name: acc.look.label, tone: acc.look.tone } : null,
    assignees: (t?.assignees ?? []).map(chip), reporter: t?.reporter ? chip(t.reporter) : null,
    labels: t?.labels ?? (i.task?.labels ?? []).map((name) => ({ name, color: null })),
    priority: t?.priority ?? null, priorityIcon: priorityIcon(t?.priority ?? null),
    created: t?.created ?? i.task?.createdAt ?? null, updated: t?.updated ?? i.task?.updatedAt ?? null,
    body: t?.body ?? (own ? fromMarkdown(i.task!.brief) : { blocks: [] }),
    comments: (t?.comments ?? []).map((c) => ({ id: c.id, author: chip(c.author), created: c.created, body: c.body, url: c.url })),
    related: t?.related ?? (i.task?.deps ?? []).map((d) => ({ key: d, title: '', relation: 'depends on', url: null })),
    // A client's tracker is theirs: the page changes its fields only where the tracker opts in (D-066).
    can: { status: !!t && !!i.trackerEdits, assign: !!t && !!i.trackerEdits, labels: !!t && !!i.trackerEdits, comment: !!t },
    updates: i.task ? updateCards(i.project, (i.updates ?? []).filter((u) => u.task === i.task!.id), i.github ?? null, i.boards ?? [], () => i.tracker, i.now) : [],
    acc, analysis: i.row && i.task ? ticketAnalysis(i.row, i.analysis ?? null, { project: i.project, task: i.row.id }, i.updates ?? []) : null,
    trackable: !!t && !i.task, tracking: !!i.tracking, signedInAs: i.signedInAs ?? null,
  };
}

// ---------------------------------------------------------------- ticket updates (D-066)

/** An update acc drafted for a ticket, as the Overview and its task's page show it, for a person to read, edit and post. */
export interface UpdateCard {
  project: string;
  id: string;
  task: string;
  /** The ticket as its board names it: GH-41, ACME-12. */
  key: string;
  tracker: TrackerKind;
  /** What it's about, in words. */
  about: string;
  look: Look;
  text: string;
  state: 'draft' | 'posting';
  /** Claimed for posting over five minutes ago and never confirmed: it may have gone (D-051). */
  stale: boolean;
  createdAt: string;
  /** Who Post sends it as, or null when it can't be posted from here. */
  postAs: string | null;
  /** Why it can't be posted from here yet, such as "Sign in to Jira first." */
  blocked: string | null;
  /** The sign-in that would let it post. */
  signIn: { command: string; label: string; arg: string } | null;
  /** Why the last try didn't post. */
  failed: string | null;
  /** The drafts of the same news it replaced, newest first: an edit typed for one of them is its edit now. */
  replaces: string[];
  /** On the Overview, the edit its task's page holds, unsent: what Post there would send instead of acc's text. */
  edited: string | null;
}

/** Whether a task's source is a tracker's ticket, which can take updates. */
export const hasTicket = (kind: string): boolean => isTrackerKind(kind);

/** What an update is about, for the person posting it. */
export function updateAbout(u: Pick<Update, 'event' | 'env' | 'pr'>): string {
  switch (u.event) {
    case 'pr-opened': return u.pr ? `Pull request #${u.pr.number} is ready for review` : 'Ready for review';
    case 'pr-updated': return u.pr ? `Pull request #${u.pr.number} was updated` : 'Updated for review';
    case 'merged': return `Merged into ${u.env ?? 'its environment'}`;
    case 'promotion-opened': return u.pr ? `Promotion #${u.pr.number} to ${u.env ?? 'its next environment'} is ready` : `Ready to go to ${u.env ?? 'its next environment'}`;
    case 'promoted': return `Promoted to ${u.env ?? 'its next environment'}`;
    case 'deployed': return `Deployed to ${u.env ?? 'its environment'}`;
    case 'blocked': return 'Blocked on a question only the client can answer';
    case 'question': return 'A question from its analysis';
  }
}

/**
 * Who an update posts as, or why it can't be posted from here: GitHub as the repo's account (D-028), Jira
 * and Azure DevOps through this repo's sign-in (D-027). Without one, Post waits for it.
 */
export function updatePoster(tracker: UpdateCard['tracker'], index: number | null, root: string, github: string | null, boards: BoardInput[]): Pick<UpdateCard, 'postAs' | 'blocked' | 'signIn'> {
  if (tracker === 'github') return github ? { postAs: github, blocked: null, signIn: null } : { postAs: null, blocked: 'This project has no GitHub account in .acc/config.json to post as.', signIn: null };
  const name = trackerName(tracker);
  // The tracker that owns the ticket's key, not the first of its kind: a repo can have two Jira sites.
  const b = index === null ? undefined : boards.find((x) => x.index === index && x.kind === tracker);
  if (!b) return { postAs: null, blocked: `This repo has no ${name} tracker to post through.`, signIn: null };
  if (b.signedInAs) return { postAs: b.signedInAs, blocked: null, signIn: null };
  return { postAs: null, blocked: `Sign in to ${name} first.`, signIn: b.connect ?? { command: 'acc.trackers.signIn', label: `Sign in to ${name}`, arg: JSON.stringify({ root, index: b.index }) } };
}

/** The updates still waiting on a person, as cards: drafts, and any being posted. `trackerOf` finds the tracker that owns a key. */
export function updateCards(root: string, updates: Update[], github: string | null, boards: BoardInput[], trackerOf: (key: string) => number | null, now = Date.now()): UpdateCard[] {
  return updates.filter(isOpenUpdate).map((u) => {
    const stale = stalePosting(u, new Date(now));
    const look = stale ? LOOK('May have posted', 'warning', 'orange') : u.state === 'posting' ? LOOK('Posting', 'sync~spin', 'blue') : LOOK('Draft update', 'comment-draft', 'orange');
    return {
      project: root, id: u.id, task: u.task, key: u.tracker === 'github' ? u.task : u.key, tracker: u.tracker, about: updateAbout(u), look, text: u.text,
      state: u.state === 'posting' ? 'posting' : 'draft', stale, createdAt: u.createdAt, ...updatePoster(u.tracker, u.tracker === 'github' ? null : trackerOf(u.key), root, github, boards),
      failed: u.state === 'draft' ? u.failed?.reason ?? null : null, replaces: u.replaces ?? [], edited: null,
    };
  });
}

/** An analysis's questions, each saying whether it was drafted for the client, or posted (D-066). */
export function withClient(questions: AnalysisAsk[], task: string, updates: Update[]): AnalysisAsk[] {
  return questions.map((q) => {
    const u = updates.filter((x) => x.task === task && x.event === 'question' && x.question === q.id && x.state !== 'discarded').at(-1);
    return u ? { ...q, client: u.state === 'posted' ? 'posted' : 'drafted' } : q;
  });
}

// ---------------------------------------------------------------- the repo's GitHub identity (D-028)

/** How the repo's GitHub identity reads at a glance: what's wrong, if anything, in words (never colour alone). */
export interface IdentityLook {
  ok: boolean;
  problem: string | null;
  scopes: string[];
  /** GitHub Projects access, which a Project's board needs. */
  projects: boolean;
}

export function lookOf(id: GithubIdentity): IdentityLook {
  const scopes = id.accounts?.find((a) => a.login.toLowerCase() === id.account.toLowerCase())?.scopes ?? [];
  const problem = !id.accounts ? 'gh isn\'t installed'
    : !id.signedIn ? `gh isn't signed in as ${id.account}`
      : id.pushesAs && id.pushesAs.toLowerCase() !== id.account.toLowerCase() ? `git push would use ${id.pushesAs}`
        : null;
  return { ok: !problem, problem, scopes, projects: scopes.includes('project') || scopes.includes('read:project') };
}

export interface IdentityCard {
  account: string;
  initials: string;
  from: 'clone' | 'config';
  projectAccount: string;
  signedIn: boolean;
  scopes: string[];
  projects: boolean;
  problem: string | null;
  pushesAs: string | null;
  commit: string | null;
  profile: string;
  /** How many other accounts gh is logged in to, to switch to. */
  others: number;
}

// ---------------------------------------------------------------- agents

export interface AgentRow {
  key: string;
  /** Background sessions can be attached to, logged and stopped from here; interactive ones can't. */
  background: boolean;
  name: string;
  look: Look;
  needsYou: boolean;
  kind: string;
  where: string;
  startedAt: number;
}

export interface AgentSetting {
  role: 'builder' | 'reviewer';
  label: string;
  icon: string;
  /** Each part in words, with where it's set. */
  parts: { name: string; value: string; from: string }[];
}

/** What autopilot may do on its own in a project (D-055), as the Agents section shows it. */
export interface AutonomySetting {
  value: string;
  from: string;
  /** What that level means, in words. */
  meaning: string;
}

/** Whether autopilot merges pull requests in a project (GH-67), as the Agents section shows it. */
export interface AutoMergeSetting {
  value: 'on' | 'off';
  from: string;
  meaning: string;
  /** Whether a person can change it here: a Salesforce project never auto-merges. */
  settable: boolean;
}

export interface AgentsModel {
  kind: 'agents';
  error: string | null;
  places: { label: string; root: string | null; agents: AgentRow[] }[];
  /** Each project's agent settings, what autopilot may do there, whether it merges, and what its agents bill (D-036). */
  settings: { root: string; project: string; roles: AgentSetting[]; autonomy: AutonomySetting | null; autoMerge: AutoMergeSetting | null; billing: Look | null }[];
}

/** The project's autonomy, set in .acc/config.json and changed through acc (D-064). Review says whether autopilot merges (GH-67). */
export function autonomySetting(p: ProjectLike): AutonomySetting | null {
  const value = p.config.autonomy;
  const meaning: Record<string, string> = {
    manual: 'Nothing happens on its own.',
    review: `Autopilot ${autopilotDoes(autoMergeOn(p.config))}`,
    dispatch: 'Not built yet: autopilot refuses.',
    full: 'Not built yet: autopilot refuses.',
  };
  return value ? { value, from: 'project', meaning: meaning[value] ?? '' } : null;
}

/** Whether autopilot merges a reviewed, green pull request (GH-67), set in .acc/config.json and changed through acc. */
export function autoMergeSetting(p: ProjectLike): AutoMergeSetting | null {
  if (!p.config.autonomy) return null;
  if (p.config.profile === 'salesforce') return { value: 'off', from: 'project', meaning: 'A Salesforce project never auto-merges: a person merges every pull request.', settable: false };
  if (!autoMergeOn(p.config)) return { value: 'off', from: 'project', meaning: 'Autopilot never merges a pull request: a person merges each one.', settable: true };
  const kept = p.config.environments.filter((e) => e.protected).map((e) => e.name);
  const meaning = [
    'Autopilot merges a pull request once its review and checks passed, it\'s up to date with its base, GitHub says it can merge and nothing waits on you, one a pass.',
    kept.length ? `Never into ${kept.join(', ')}: protected.` : '',
    p.config.autonomy === 'review' ? '' : 'Autonomy is manual, so nothing merges on its own.',
  ].filter(Boolean).join(' ');
  return { value: 'on', from: 'project', meaning, settable: true };
}

const FROM_WORDS: Record<string, string> = { clone: 'this clone', project: 'project default', default: 'Claude Code\'s default' };

export function agentSettings(p: ProjectLike): AgentSetting[] {
  if (!p.agents) return [];
  const role = (r: 'builder' | 'reviewer'): AgentSetting => {
    const v = p.agents![r];
    return {
      role: r, label: r === 'builder' ? 'Builders' : 'Reviewers', icon: r === 'builder' ? 'tools' : 'checklist',
      parts: [
        { name: 'Model', value: v.model ?? 'default', from: FROM_WORDS[v.from.model] ?? v.from.model },
        { name: 'Effort', value: v.effort ?? 'default', from: FROM_WORDS[v.from.effort] ?? v.from.effort },
        ...(v.fallbackModel ? [{ name: 'Falls back to', value: v.fallbackModel, from: FROM_WORDS[v.from.fallbackModel] ?? v.from.fallbackModel }] : []),
      ],
    };
  };
  return [role('builder'), role('reviewer')];
}

/** What the billing check says, as a line in the Agents settings. Null until that check has run. */
export function billingLook(items: DoctorItem[]): Look | null {
  const i = items.find((x) => x.id === 'A1.claude-billing');
  if (!i || i.status === 'skip') return null;
  return i.status === 'pass' ? { label: 'Agents use your Claude subscription', icon: 'pass', tone: 'blue' } : { label: `Per-token billing: ${i.detail}`, icon: 'warning', tone: 'orange' };
}

export function agentsModel(hub: HubLike, setupItems: DoctorItem[] = []): AgentsModel {
  const lookOf = (s: AgentSession) => agentLook(s, hub.askingFor?.(s));
  const rowFor = (s: AgentSession): AgentRow => {
    const look = lookOf(s);
    const p = hub.projectFor(s.cwd);
    const key = sessionKey(s);
    const where = p ? (isUnder(s.cwd, p.root) ? s.cwd.slice(p.root.length + 1) || 'main checkout' : s.cwd.split('/').pop() ?? s.cwd) : s.cwd;
    return { key, background: !!s.id, name: s.name ?? s.sessionId?.slice(0, 8) ?? 'session', look: { label: look.label, icon: look.icon, tone: look.tone }, needsYou: look.needsYou, kind: s.kind, where, startedAt: s.startedAt };
  };
  const sorted = [...hub.agents].sort((a, b) => Number(lookOf(b).needsYou) - Number(lookOf(a).needsYou) || b.startedAt - a.startedAt);
  const places = hub.projects.map((p) => ({ label: p.name, root: p.root as string | null, agents: sorted.filter((s) => hub.projectFor(s.cwd) === p).map(rowFor) }));
  const elsewhere = sorted.filter((s) => !hub.projectFor(s.cwd));
  if (elsewhere.length) places.push({ label: 'Elsewhere on this machine', root: null, agents: elsewhere.map(rowFor) });
  const billing = billingLook(setupItems);
  const settings = hub.projects.filter((p) => p.agents).map((p) => ({ root: p.root, project: p.name, roles: agentSettings(p), autonomy: autonomySetting(p), autoMerge: autoMergeSetting(p), billing }));
  return { kind: 'agents', error: hub.agentsError, places, settings };
}

// ---------------------------------------------------------------- worktrees

export interface WorktreeRow {
  path: string;
  branch: string;
  place: string;
  state: Look;
  main: boolean;
}

export interface WorktreesModel {
  kind: 'worktrees';
  projects: { name: string; root: string; worktrees: WorktreeRow[] }[];
}

export function worktreesModel(hub: HubLike): WorktreesModel {
  return {
    kind: 'worktrees',
    projects: hub.projects.map((p) => ({
      name: p.name, root: p.root,
      worktrees: p.worktrees.map((w) => {
        const state: Look = w.prunable ? { label: 'Missing on disk', icon: 'warning', tone: 'orange' }
          : w.changed < 0 ? { label: 'Status unknown', icon: 'question', tone: 'orange' }
            : w.changed > 0 ? { label: `${w.changed} changed`, icon: 'diff-modified', tone: 'orange' }
              : { label: 'Clean', icon: 'check', tone: 'blue' };
        const place = w.main ? 'Main checkout' : w.path.replace(p.root.replace(/\/[^/]+$/, ''), '…');
        return { path: w.path, branch: w.branch ?? `detached at ${w.head.slice(0, 7)}`, place: w.locked ? `${place} · locked` : place, state, main: w.main };
      }),
    })),
  };
}

// ---------------------------------------------------------------- environments

export interface EnvCard {
  name: string;
  branch: string;
  type: string;
  icon: string;
  org: string | null;
  badges: string[];
  current: boolean;
  promotesTo: string[];
  actions: Action[];
}

export interface EnvironmentsModel {
  kind: 'environments';
  projects: { name: string; root: string; github: string | null; identity: IdentityCard | null; envs: EnvCard[]; paths: string[][] }[];
  /** acc's notices in Slack, for this machine (GH-58). Never the webhook: only its last four characters. */
  slack: SlackCard | null;
}

export function environmentsModel(hub: HubLike, identity: (root: string) => IdentityCard | null = () => null, slack: SlackCard | null = null): EnvironmentsModel {
  return {
    kind: 'environments',
    slack,
    projects: hub.projects.map((p) => ({
      name: p.name, root: p.root,
      github: p.config.github ? `${p.config.github.repo} as ${p.config.github.account}` : null,
      identity: identity(p.root),
      paths: promotionPaths(p.config.environments),
      envs: p.config.environments.map((e) => {
        const ref: Ref = { project: p.root, env: e.branch };
        const actions: Action[] = [];
        if (e.org) actions.push({ command: 'acc.env.openOrg', label: 'Open org', icon: 'globe', ref, primary: true });
        if (p.config.github) actions.push({ command: 'acc.env.openGithub', label: 'GitHub', icon: 'github', ref });
        if (p.branch !== e.branch) actions.push({ command: 'acc.env.compare', label: 'Compare', icon: 'diff', ref });
        // A person moves work between environments (D-034): a pull request onward, then a deploy after it merges.
        if (e.promotesTo.length && p.config.github) actions.push({ command: 'acc.env.promote', label: 'Promote…', icon: 'git-merge', ref });
        if (p.config.profile === 'salesforce' && e.org) actions.push({ command: 'acc.env.deploy', label: 'Deploy…', icon: 'cloud-upload', ref });
        const current = p.branch === e.branch;
        const badges = [e.default ? 'default' : '', e.protected ? 'protected' : '', current ? 'checked out' : ''].filter(Boolean);
        return { name: e.name, branch: e.branch, type: e.type, icon: ENV_ICON[e.type] ?? 'git-branch', org: e.org, badges, current, promotesTo: e.promotesTo, actions };
      }),
    })),
  };
}

// ---------------------------------------------------------------- setup

export interface SetupRow {
  id: string;
  title: string;
  look: Look;
  /** Passed, done by hand, or doesn't apply: shown muted, in one line. */
  done: boolean;
  detail: string;
  why: string;
  fix: string | null;
  actions: Action[];
}

/** Steps that set up one thing, such as the repo's GitHub account, in the order they're done. */
export interface SetupSection {
  key: string;
  title: string;
  todo: number;
  steps: SetupRow[];
}

export interface SetupModel {
  kind: 'setup';
  done: number;
  total: number;
  parts: { part: 'machine' | 'project'; label: string; todo: number; steps: SetupRow[]; sections: SetupSection[] }[];
}

const STATUS: Record<string, Look> = {
  pass: { label: 'Done', icon: 'pass', tone: 'blue' },
  fail: { label: 'To do', icon: 'warning', tone: 'orange' },
  unknown: { label: 'Check by hand', icon: 'question', tone: 'orange' },
  skip: { label: 'Doesn\'t apply', icon: 'circle-slash', tone: 'neutral' },
  confirmed: { label: 'Done by hand', icon: 'pass', tone: 'blue' },
};

/** A step's group: its own, or its id's prefix for a step this build doesn't know. */
const groupOf = (id: string): string => STEPS.find((s) => s.id === id)?.group ?? id.split('.')[0]!;

/**
 * Where a step comes in the order you'd set things up (D-047): the step list's order, whatever order the
 * checks finished in. A step this build doesn't know goes at the end of its group.
 */
function stepOrder(id: string): number {
  const i = STEPS.findIndex((s) => s.id === id);
  if (i >= 0) return i;
  const group = groupOf(id);
  const last = STEPS.reduce((n, s, k) => (s.group === group ? k : n), -1);
  return last >= 0 ? last + 0.5 : STEPS.length;
}

export function setupModel(items: DoctorItem[], confirmed: Set<string>): SetupModel {
  const visible = [...items].sort((a, b) => stepOrder(a.id) - stepOrder(b.id));
  const rows = (part: 'machine' | 'project') => visible.filter((i) => i.part === part).map((i): SetupRow => {
    const step = STEPS.find((s) => s.id === i.id);
    const status = confirmed.has(i.id) && i.status !== 'pass' ? 'confirmed' : i.status;
    const ref: Ref = { step: i.id };
    const actions: Action[] = [{ command: 'acc.step.check', label: 'Check', icon: 'refresh', ref }];
    const open = status === 'fail' || status === 'unknown';
    if (open && (step?.fix?.command || step?.fix?.fromCheck || step?.fix?.vscode)) actions.unshift({ command: 'acc.step.fix', label: 'Do it', icon: 'wrench', ref, primary: true });
    if (open && step?.fix?.setupPath) actions.push({ command: 'acc.step.openSetup', label: 'Open in Salesforce', icon: 'globe', ref });
    if (status === 'unknown') actions.push({ command: 'acc.step.confirm', label: 'I\'ve done this', icon: 'check', ref });
    if (step?.fix?.docs) actions.push({ command: 'acc.openGuide', label: 'Guide', icon: 'book', ref });
    const look = STATUS[status] ?? STATUS.skip!;
    // A fix that's a VSCode command runs from Do it; only terminal commands are shown to copy.
    return { id: i.id, title: i.title, look, done: look.tone !== 'orange', detail: i.detail, why: step?.why ?? '', fix: step?.fix?.vscode ? null : i.fix ?? null, actions };
  });
  /** Neighbouring steps that set up the same thing make one section. */
  const sectionsOf = (steps: SetupRow[]): SetupSection[] => {
    const out: SetupSection[] = [];
    for (const s of steps) {
      const group = groupOf(s.id);
      const title = GROUP_TITLES[group] ?? group;
      const prev = out[out.length - 1];
      if (prev && prev.title === title) prev.steps.push(s);
      else out.push({ key: group, title, todo: 0, steps: [s] });
    }
    for (const sec of out) sec.todo = sec.steps.filter((s) => !s.done).length;
    return out;
  };
  const parts = (['machine', 'project'] as const).map((part) => {
    const steps = rows(part);
    return { part, label: part === 'machine' ? 'This machine' : 'This project', todo: steps.filter((s) => !s.done).length, steps, sections: sectionsOf(steps) };
  }).filter((p) => p.steps.length);
  const all = parts.flatMap((p) => p.steps);
  return { kind: 'setup', done: all.filter((s) => s.done).length, total: all.length, parts };
}

const LOOK = (label: string, icon: string, tone: Tone): Look => ({ label, icon, tone });

// ---------------------------------------------------------------- agents' questions (D-030)

export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionCard {
  id: string;
  /** permission: allow or deny a tool. question: pick from the options it gives (AskUserQuestion). */
  kind: 'permission' | 'question';
  /** Who's asking: the task, else the session's name. */
  who: string;
  task: string | null;
  project: string | null;
  projectName: string | null;
  session: string;
  sessionId: string;
  askedAt: number;
  icon: string;
  /** What it wants, after its name: "wants to run a command". */
  title: string;
  /** The command, path or address it's about, shown as code. */
  code: string | null;
  detail: string | null;
  /** Set when Claude Code offered a rule to stop asking: allowing with it lasts this session. */
  always: string | null;
  /** Every answer Claude Code's own prompt would offer, in its order (D-038). Empty for a question with options. */
  choices: QuestionChoice[];
  questions: { question: string; header: string; multiSelect: boolean; options: QuestionOption[] }[];
}

/** One answer to a permission prompt, as a numbered choice on the card. */
export interface QuestionChoice {
  key: string;
  label: string;
  hint: string | null;
  icon: string;
  /** What's sent. A reason or an edited command, when the choice needs one, comes from the card. */
  answer: { decision: 'allow' | 'deny'; always?: boolean; scope?: 'session' | 'project'; mode?: 'auto' | 'acceptEdits' | 'default'; stop?: boolean };
  /** It needs words first: why not, what to plan instead, or the command as it should run. */
  needs?: 'reason' | 'feedback' | 'command';
  primary?: boolean;
}

/** What "always allow" would allow, in a few words, from the first rule Claude Code offered. */
export function alwaysWhat(suggestions: unknown[]): string | null {
  const s = suggestions[0] as { type?: string; rules?: { toolName?: string; ruleContent?: string }[]; mode?: string; directories?: string[] } | undefined;
  if (!s || typeof s !== 'object') return null;
  if (s.type === 'setMode' && s.mode === 'acceptEdits') return 'all edits';
  if (s.type === 'addDirectories') return `access to ${(s.directories?.[0] ?? 'this folder').split('/').pop()}`;
  if (s.type === 'addRules' && s.rules?.[0]?.toolName) {
    const r = s.rules[0];
    const what = r.ruleContent ? (r.ruleContent.length > 48 ? `${r.ruleContent.slice(0, 48)}…` : r.ruleContent) : r.toolName;
    return `\`${what}\``;
  }
  return 'this';
}

/** The choices for a permission prompt, as Claude Code's own prompt lists them, plus what the page adds. */
export function choicesFor(tool: string, suggestions: unknown[]): QuestionChoice[] {
  if (tool === 'AskUserQuestion') return [];
  const stop: QuestionChoice = { key: 'stop', label: 'No, and stop it', hint: 'Its turn ends here and it waits for you, as Esc does in its own prompt', icon: 'debug-stop', answer: { decision: 'deny', stop: true } };
  if (tool === 'ExitPlanMode') {
    return [
      { key: 'accept-edits', label: 'Yes, and auto-accept edits', hint: 'It starts on the plan, editing without asking each time', icon: 'check-all', answer: { decision: 'allow', mode: 'acceptEdits' }, primary: true },
      { key: 'manual-edits', label: 'Yes, and approve each edit', hint: 'It starts on the plan, and asks before each edit', icon: 'check', answer: { decision: 'allow', mode: 'default' } },
      { key: 'keep-planning', label: 'No, keep planning…', hint: 'Say what to change in the plan', icon: 'edit', answer: { decision: 'deny' }, needs: 'feedback' },
      stop,
    ];
  }
  const what = alwaysWhat(suggestions);
  return [
    { key: 'allow', label: 'Yes', hint: null, icon: 'check', answer: { decision: 'allow' }, primary: true },
    ...(what ? [
      { key: 'always-session', label: `Yes, and always allow ${what} in this session`, hint: 'It won\'t ask again for this until the session ends', icon: 'check-all', answer: { decision: 'allow' as const, always: true, scope: 'session' as const } },
      { key: 'always-project', label: `Yes, and always allow ${what} in this project`, hint: 'Saved to the project\'s Claude Code settings (.claude/settings.local.json), for every session', icon: 'repo', answer: { decision: 'allow' as const, always: true, scope: 'project' as const } },
    ] : []),
    { key: 'auto', label: 'Yes, and switch to auto mode', hint: 'For the rest of this session, Claude Code decides the safe ones itself and asks only about the rest', icon: 'sparkle', answer: { decision: 'allow', mode: 'auto' } },
    ...(tool === 'Bash' ? [{ key: 'edit', label: 'Edit the command, then allow…', hint: 'The agent is told to run your version, and it\'s allowed when it does', icon: 'edit', answer: { decision: 'allow' as const }, needs: 'command' as const }] : []),
    { key: 'deny', label: 'No, and tell it what to do instead…', hint: 'It reads your words and carries on', icon: 'close', answer: { decision: 'deny' }, needs: 'reason' },
    stop,
  ];
}

const text = (v: unknown, max = 4000): string | null => (typeof v === 'string' && v.trim() ? (v.length > max ? `${v.slice(0, max)}…` : v) : null);

/** A permission prompt in words: what the tool would do, and the command, file or address. */
export function describePermission(tool: string, input: Record<string, unknown>, cwd: string): { icon: string; title: string; code: string | null; detail: string | null } {
  const path = (p: unknown) => {
    const s = text(p, 1000);
    return s && s.startsWith(`${cwd}/`) ? s.slice(cwd.length + 1) : s;
  };
  switch (tool) {
    case 'Bash': return { icon: 'terminal', title: 'wants to run a command', code: text(input.command), detail: text(input.description, 300) };
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return { icon: 'edit', title: 'wants to edit a file', code: path(input.file_path ?? input.notebook_path), detail: null };
    case 'Write': return { icon: 'new-file', title: 'wants to write a file', code: path(input.file_path), detail: null };
    case 'Read': return { icon: 'file', title: 'wants to read a file', code: path(input.file_path), detail: null };
    case 'Grep': case 'Glob': return { icon: 'search', title: 'wants to search files', code: text(input.pattern), detail: text(input.path) ? `in ${path(input.path)}` : null };
    case 'WebFetch': return { icon: 'globe', title: 'wants to open a web page', code: text(input.url), detail: text(input.prompt, 300) };
    case 'WebSearch': return { icon: 'search', title: 'wants to search the web', code: text(input.query), detail: null };
    case 'ExitPlanMode': return { icon: 'list-ordered', title: 'has a plan for you to approve', code: null, detail: text(input.plan) };
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
      const json = JSON.stringify(input, null, 2);
      return { icon: mcp ? 'plug' : 'tools', title: mcp ? `wants to use ${mcp[1]!.replace(/_/g, ' ')}: ${mcp[2]!.replace(/_/g, ' ')}` : `wants to use ${tool}`, code: json && json !== '{}' ? text(json, 1500) : null, detail: null };
    }
  }
}

/** The words for "allow, and don't ask again", from the first rule Claude Code offered. */
export function alwaysLabel(suggestions: unknown[]): string | null {
  const s = suggestions[0] as { type?: string; rules?: { toolName?: string; ruleContent?: string }[]; mode?: string; directories?: string[] } | undefined;
  if (!s || typeof s !== 'object') return null;
  if (s.type === 'setMode' && s.mode === 'acceptEdits') return 'Allow all edits this session';
  if (s.type === 'addDirectories') return 'Allow this folder this session';
  if (s.type === 'addRules' && s.rules?.[0]?.toolName) {
    const r = s.rules[0];
    return r.ruleContent ? `Always allow ${r.ruleContent.length > 40 ? `${r.ruleContent.slice(0, 40)}…` : r.ruleContent} this session` : `Always allow ${r.toolName} this session`;
  }
  return 'Allow, and don\'t ask again this session';
}

function questionsOf(input: Record<string, unknown>): QuestionCard['questions'] {
  const qs = Array.isArray(input.questions) ? input.questions : [];
  return qs.slice(0, 6).flatMap((q: any) => {
    const question = text(q?.question, 1000);
    if (!question) return [];
    const options = (Array.isArray(q.options) ? q.options : []).slice(0, 8).flatMap((o: any) => (text(o?.label, 200) ? [{ label: o.label as string, description: text(o.description, 500) ?? '' }] : []));
    return [{ question, header: text(q.header, 40) ?? '', multiSelect: q.multiSelect === true, options }];
  });
}

/** Each waiting question, with who's asking: the task its agent works on, else the session. */
export function questionCards(hub: HubLike): QuestionCard[] {
  return (hub.questions ?? []).map((q): QuestionCard => {
    const session = hub.agents.find((s) => s.sessionId === q.sessionId);
    const project = hub.projectFor(q.cwd) ?? null;
    const row = project ? hub.taskRows(project.root).find((r) => r.run?.sessionId === q.sessionId || (!!session?.id && r.run?.bgId === session.id) || (!!r.run?.worktree && isUnder(q.cwd, r.run.worktree))) : undefined;
    const ask = q.tool === 'AskUserQuestion';
    const d = ask ? { icon: 'comment-discussion', title: 'has a question for you', code: null, detail: null } : describePermission(q.tool, q.input, q.cwd);
    return {
      id: q.id, kind: ask ? 'question' : 'permission', who: row?.id ?? session?.name ?? 'An agent', task: row?.id ?? null,
      project: project?.root ?? null, projectName: project?.name ?? null, session: session ? sessionKey(session) : q.sessionId, sessionId: q.sessionId, askedAt: q.at,
      ...d, always: ask ? null : alwaysLabel(q.suggestions), choices: choicesFor(q.tool, q.suggestions), questions: ask ? questionsOf(q.input) : [],
    };
  });
}

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
  if (r.step === 'dispatch') return { look: LOOK(r.cause === 'checks' ? 'Autopilot re-dispatched it for its failing checks' : 'Autopilot re-dispatched it for the review\'s changes', 'debug-restart', 'blue'), detail: null, url: null };
  // A builder that stopped, carried on once (D-067), with the last thing it said.
  if (r.step === 'resume') return { look: LOOK('Autopilot resumed it', 'debug-continue', 'blue'), detail: r.reason || null, url: null };
  // Merged where the repo turns auto-merge on (GH-67): acc sync moves it to done.
  if (r.step === 'merge') return { look: LOOK(r.pr ? `Autopilot merged pull request #${r.pr.number}` : 'Autopilot merged its pull request', 'git-merge', 'blue'), detail: 'acc sync moves it to done.', url: r.pr?.url || null };
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

// ---------------------------------------------------------------- an agent's page (D-030)

export type EntryView =
  /** Your decision on one of its questions (D-037), in the timeline where it happened. */
  | { k: 'decision'; id: string; at: string | null; decision: Decision }
  | { k: 'prompt'; id: string; at: string | null; body: Doc; instructions: boolean }
  | { k: 'say'; id: string; at: string | null; body: Doc }
  | { k: 'recap'; id: string; at: string | null; text: string }
  | Extract<Entry, { k: 'tool' }>;

export interface AgentModel {
  kind: 'agent';
  key: string;
  name: string;
  /** The task it works on, when it's a builder. */
  task: { id: string; title: string; project: string } | null;
  look: Look;
  /** False once Claude Code no longer lists the session. */
  live: boolean;
  background: boolean;
  where: string;
  startedAt: number | null;
  lastAt: string | null;
  model: string | null;
  entries: EntryView[];
  /** Earlier entries left off the page. */
  hidden: number;
  /** Whether a transcript was found and read. */
  readable: boolean;
  questions: QuestionCard[];
  actions: Action[];
  /** Whether you can write to it from its page (D-060), and what the box says. Null with nothing to resume. */
  reply: { can: boolean; hint: string } | null;
}

export interface AgentInput {
  hub: HubLike;
  key: string;
  /** The session as last seen, for a page whose session has since gone from `claude agents`. */
  seen: AgentSession | null;
  entries: Entry[];
  readable: boolean;
  lastAt: string | null;
  /** The model its latest answer came from, from the transcript. */
  model?: string | null;
  limit?: number;
  /** A session Claude Code doesn't list but that's still working, such as a review (D-032). */
  active?: boolean;
  /** A message you sent from its page is still being answered. */
  replying?: boolean;
}

export function agentModel(i: AgentInput): AgentModel {
  const { hub } = i;
  const live = hub.agents.find((s) => sessionKey(s) === i.key || s.id === i.key) ?? null;
  const s = live ?? i.seen;
  const project = s ? hub.projectFor(s.cwd) : undefined;
  const row = project && s ? hub.taskRows(project.root).find((r) => (s.sessionId && r.run?.sessionId === s.sessionId) || (s.id && r.run?.bgId === s.id) || (s.kind === 'background' && s.name === r.id)) : undefined;
  const look = s && live ? agentLook(s, hub.askingFor?.(s)) : i.active ? { label: 'Working', icon: 'sync~spin', tone: 'blue' as Tone, needsYou: false } : { label: 'Ended', icon: 'circle-slash', tone: 'neutral' as Tone, needsYou: false };
  const limit = i.limit ?? 400;
  const views = i.entries.slice(-limit).map((e): EntryView => (e.k === 'prompt' ? { k: 'prompt', id: e.id, at: e.at, body: fromMarkdown(e.text), instructions: e.instructions }
    : e.k === 'say' ? { k: 'say', id: e.id, at: e.at, body: fromMarkdown(e.text) } : e));
  // Each decision goes in after the last step before you made it, so the timeline reads as it happened.
  const decisions = (s?.sessionId ? (hub.answers ?? []).filter((h) => h.sessionId === s.sessionId) : []).map(decisionOf).sort((a, b) => a.at - b.at);
  const shown: EntryView[] = [];
  let next = 0;
  for (const v of views) {
    const t = v.at ? Date.parse(v.at) : NaN;
    while (next < decisions.length && Number.isFinite(t) && decisions[next]!.at <= t) { const d = decisions[next++]!; shown.push({ k: 'decision', id: `d:${d.id}`, at: new Date(d.at).toISOString(), decision: d }); }
    shown.push(v);
  }
  while (next < decisions.length) { const d = decisions[next++]!; shown.push({ k: 'decision', id: `d:${d.id}`, at: new Date(d.at).toISOString(), decision: d }); }
  const key = s ? sessionKey(s) : i.key;
  const ref: Ref = { session: key };
  const actions: Action[] = [];
  if (s?.sessionId) actions.push({ command: 'acc.agent.openInClaude', label: 'Open in Claude Code', icon: 'comment-discussion', ref });
  if (live?.id) actions.push({ command: 'acc.agent.attach', label: 'Attach in terminal', icon: 'terminal', ref });
  if (s) actions.push({ command: 'acc.agent.openFolder', label: 'Open its folder', icon: 'empty-window', ref });
  if (live?.id && live.pid) actions.push({ command: 'acc.agent.stop', label: 'Stop', icon: 'debug-stop', ref, danger: true });
  const where = !s ? '' : project ? (isUnder(s.cwd, project.root) ? s.cwd.slice(project.root.length + 1) || 'main checkout' : s.cwd.split('/').slice(-2).join('/')) : s.cwd;
  return {
    kind: 'agent', key, name: s?.name ?? row?.id ?? key.slice(0, 8), task: row && project ? { id: row.id, title: row.title, project: project.root } : null,
    look: { label: look.label, icon: look.icon, tone: look.tone }, live: !!live || !!i.active, background: !!s?.id, where, startedAt: s?.startedAt ?? null, lastAt: i.lastAt, model: i.model ?? null,
    entries: shown, hidden: Math.max(0, i.entries.length - views.length), readable: i.readable || decisions.length > 0,
    questions: s?.sessionId ? questionCards(hub).filter((q) => q.sessionId === s.sessionId) : [],
    actions,
    reply: s?.sessionId && (i.readable || !!live) ? replyState(live, questionCards(hub).some((q) => q.sessionId === s.sessionId), !!i.replying, !!i.active) : null,
  };
}

/**
 * Whether you can write to an agent from its page (D-060): not while it works, waits on a question, or is
 * open somewhere else, since one conversation can't run in two places. A background agent that's idle is
 * stopped first, and carries on from the page in its own folder.
 */
export function replyState(live: AgentSession | null, asking: boolean, replying: boolean, active: boolean): { can: boolean; hint: string } {
  if (replying || active) return { can: false, hint: 'It\'s answering. You can write again when it stops.' };
  if (asking) return { can: false, hint: 'Answer its question above first.' };
  if (live?.pid && live.kind !== 'background') return { can: false, hint: 'It\'s open in a terminal or a Claude Code tab. Write to it there.' };
  if (live?.pid && (live.state === 'working' || live.status === 'busy')) return { can: false, hint: 'It\'s working. You can write to it when it stops.' };
  if (live?.pid && live.id) return { can: true, hint: 'Sending stops its background session, and it carries on here, in its own folder.' };
  return { can: true, hint: 'It carries on in its own folder, with its own rules. ⌘Enter sends.' };
}

// ---------------------------------------------------------------- commands acc runs for you (D-030)

export interface RunCard {
  id: string;
  label: string;
  command: string;
  look: Look;
  running: boolean;
  startedAt: number;
  endedAt: number | null;
  /** The last lines of its output; the last one may still be being written. */
  lines: string[];
  /** Set when it's gone quiet asking for something. */
  prompt: RunPrompt | null;
  /** The setup step it's doing, so the step shows it's under way. */
  step: string | null;
  /** Lasts as long as the window, such as autopilot (D-064): the panel shows another first. */
  background?: boolean;
}

export interface RunInput {
  id: string;
  label: string;
  command: string;
  startedAt: number;
  endedAt: number | null;
  code: number | null;
  /** Whether it did its job, when its exit code alone doesn't say (see Runs). Otherwise exit 0 is done. */
  ok?: boolean;
  stopped: boolean;
  lines: string[];
  prompt: RunPrompt | null;
  step: string | null;
  /** Lasts as long as the window, such as autopilot (D-064): never the output panel's first pick. */
  background?: boolean;
}

export function runCard(r: RunInput, lines = 400): RunCard {
  const running = r.endedAt === null;
  const look: Look = running ? (r.prompt ? LOOK('Waiting for you', 'bell', 'orange') : LOOK('Running', 'sync~spin', 'blue'))
    : r.stopped ? LOOK('Stopped', 'debug-stop', 'neutral')
      : (r.ok ?? r.code === 0) ? LOOK('Done', 'pass', 'blue') : LOOK(`Failed (exit ${r.code ?? '?'})`, 'warning', 'orange');
  return { id: r.id, label: r.label, command: r.command, look, running, startedAt: r.startedAt, endedAt: r.endedAt, lines: r.lines.slice(-lines), prompt: running ? r.prompt : null, step: r.step, ...(r.background ? { background: true } : {}) };
}

// ---------------------------------------------------------------- connecting a tracker (GH-51)

/** One list on the Connect page, as the extension keeps it while the page is open. */
export interface ConnectPickerState {
  options: Option[];
  /** The values chosen. None is the whole project for a picker that has one. */
  selected: string[];
  state: 'waiting' | 'loading' | 'ready' | 'failed';
  error: string | null;
}

/**
 * The Connect page while it's open, as the extension keeps it. It never holds a token: a secret is typed
 * on the page, sent once to sign in, and kept only in VSCode's secret storage (D-027).
 */
export interface ConnectState {
  id: string;
  /** Goes up with every change, so the page knows its typing has been taken in. */
  rev: number;
  root: string | null;
  /** The projects to choose from, when it was opened with none named and there are several. */
  projects: { root: string; name: string }[];
  projectName: string;
  /** The project's own GitHub repo and account, which a GitHub tracker uses by default. */
  ownRepo: string | null;
  ghAccount: string | null;
  kind: string;
  /** The tracker being changed, by its place in the list, or null for a new one. */
  existing: { index: number; title: string } | null;
  /** The section to go back to. */
  from: HomeSection;
  host: string;
  hostError: string | null;
  method: string;
  /** What's typed in the sign-in's fields, secrets left out. */
  fields: Record<string, string>;
  fieldErrors: Record<string, string>;
  /** again: Sign in again was clicked, so the fields show though it's signed in. */
  signIn: { state: 'none' | 'testing' | 'ok' | 'failed'; who: string | null; error: string | null; again: boolean };
  pickers: Record<string, ConnectPickerState>;
  saving: boolean;
  saveError: string | null;
}

export interface ConnectField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'secret';
  /** Always empty for a secret. */
  value: string;
  placeholder: string;
  hint: string | null;
  error: string | null;
  /** Shown as text: an existing tracker's site, organization or repo isn't changed here. */
  fixed: boolean;
  help: { label: string; url: string } | null;
}

export interface ConnectPicker {
  key: string;
  label: string;
  multi: boolean;
  /** The whole project, listed first; chosen when nothing is. */
  whole: string | null;
  options: { value: string; label: string; detail: string | null }[];
  selected: string[];
  /** Loading, or why the list couldn't be read, beside it. Null when there's nothing to say. */
  look: Look | null;
  disabled: boolean;
  fixed: boolean;
  /** It needs a choice before Save. */
  required: boolean;
  /** Not drawn: its one choice is made already, so there's nothing to pick. */
  hidden: boolean;
  hint: string | null;
}

/** What the Connect page draws (GH-51). Every part comes from a tracker's description: the page has no tracker of its own. */
export interface ConnectModel {
  id: string;
  rev: number;
  title: string;
  summary: string;
  back: { section: HomeSection; label: string };
  /** A project to choose, when there are several and none was named. */
  projects: { root: string; name: string; on: boolean }[];
  /** The kinds to choose from; empty for an existing tracker. */
  kinds: { kind: string; name: string; icon: string; on: boolean }[];
  kind: string;
  name: string;
  icon: string;
  host: ConnectField;
  /** The ways to sign in, when there's more than one. */
  methods: { id: string; label: string; icon: string; on: boolean }[];
  method: { id: string; hint: string; test: string };
  fields: ConnectField[];
  signIn: { look: Look; editing: boolean; canTest: boolean };
  pickers: ConnectPicker[];
  save: { can: boolean; label: string; look: Look | null };
}

/** A fresh page for one kind of tracker, or for an existing one with its choices filled in. */
export function blankConnect(d: TrackerDescription, i: {
  id: string; root: string | null; projects?: ConnectState['projects']; projectName: string; ownRepo: string | null; ghAccount: string | null; from: HomeSection;
  gitEmail?: string | null; existing?: { index: number; title: string; host: string; values: Values } | null;
}): ConnectState {
  const method = d.methods[0]!;
  const fields = Object.fromEntries(d.methods.flatMap((m) => m.fields).filter((f) => f.type !== 'secret').map((f) => [f.key, f.prefill === 'git-email' ? i.gitEmail ?? '' : '']));
  const was = i.existing?.values ?? {};
  const pickers = Object.fromEntries(d.pickers.map((p) => {
    const v = was[p.key];
    return [p.key, { options: [], selected: Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : [], state: 'waiting', error: null } satisfies ConnectPickerState];
  }));
  return {
    id: i.id, rev: 0, root: i.root, projects: i.projects ?? [], projectName: i.projectName, ownRepo: i.ownRepo, ghAccount: i.ghAccount, kind: d.kind,
    existing: i.existing ? { index: i.existing.index, title: i.existing.title } : null, from: i.from,
    host: i.existing?.host ?? (d.host.prefill === 'github-repo' ? i.ownRepo ?? '' : ''), hostError: null,
    method: method.id, fields, fieldErrors: {}, signIn: { state: 'none', who: null, error: null, again: false }, pickers, saving: false, saveError: null,
  };
}

/** The values chosen so far, as a description's lists and toConfig read them. */
export function connectValues(s: ConnectState, d: TrackerDescription): Values {
  return Object.fromEntries(d.pickers.map((p) => {
    const sel = s.pickers[p.key]?.selected ?? [];
    return [p.key, p.multi ? (sel.length ? sel : null) : sel[0] ?? null];
  }));
}

const SECTION_WORD: Record<HomeSection, string> = { overview: 'Overview', ...VIEW_TITLES };

export function connectModel(s: ConnectState, list: TrackerDescription[] = DESCRIPTIONS): ConnectModel {
  const d = list.find((x) => x.kind === s.kind) ?? list[0]!;
  const method = d.methods.find((m) => m.id === s.method) ?? d.methods[0]!;
  const ok = s.signIn.state === 'ok';
  const editing = !ok || s.signIn.again;
  const values = connectValues(s, d);
  // What each list's choice is called, for words such as "Every group on Client work".
  const labels = Object.fromEntries(d.pickers.map((p) => {
    const ps = s.pickers[p.key];
    return [p.key, ps?.options.find((o) => o.value === ps.selected[0])?.label ?? null];
  }));
  const host: ConnectField = {
    key: d.host.key, label: d.host.label, type: 'text', value: s.host, placeholder: d.host.placeholder, hint: d.host.hint, error: s.hostError, fixed: !!s.existing, help: null,
  };
  const fields: ConnectField[] = method.fields.map((f) => {
    const url = f.help?.url(s.hostError ? '' : s.host) ?? null;
    return {
      key: f.key, label: f.label, type: f.type, value: f.type === 'secret' ? '' : s.fields[f.key] ?? '', placeholder: f.placeholder, hint: f.hint ?? null,
      error: s.fieldErrors[f.key] ?? null, fixed: false, help: f.help && url ? { label: f.help.label, url } : null,
    };
  });
  const testing = s.signIn.state === 'testing';
  const look: Look = testing ? LOOK(method.via === 'microsoft' ? 'Waiting for the Microsoft sign-in' : 'Testing the connection', 'sync~spin', 'blue')
    : ok ? LOOK(`Signed in as ${s.signIn.who}`, 'pass', 'blue')
      : s.signIn.state === 'failed' ? LOOK(s.signIn.error ?? 'Not signed in', 'warning', 'orange')
        : LOOK(method.via === 'gh' && s.ghAccount ? `Signs in as ${s.ghAccount}` : 'Not signed in yet', 'circle-large-outline', 'neutral');
  const pickers: ConnectPicker[] = d.pickers.map((p) => {
    const ps = s.pickers[p.key] ?? { options: [], selected: [], state: 'waiting', error: null };
    const fixed = !!s.existing && !!p.identifies;
    const whole = p.whole ? p.whole({ host: s.host, values, labels }) : null;
    const pickerLook = fixed ? null : ps.state === 'loading' ? LOOK('Loading', 'sync~spin', 'blue')
      : ps.state === 'failed' ? LOOK(`Couldn't list them: ${ps.error ?? 'no answer'}${whole ? ' You can take the whole project now, and narrow it later.' : p.fallback ? ` ${p.fallback}` : ''}`, 'warning', 'orange')
        : ps.state === 'ready' && !ps.options.length && !whole ? LOOK('None that this sign-in can see', 'warning', 'orange') : null;
    // Each option once, and a choice the list no longer has (an epic that's done) kept, so Save doesn't drop it.
    const options = ps.options.map((o) => ({ value: o.value, label: o.label, detail: o.detail ?? null }));
    for (const v of ps.selected) if (!options.some((o) => o.value === v)) options.unshift({ value: v, label: v, detail: ps.state === 'ready' && !fixed ? 'chosen before, not listed now' : null });
    return {
      key: p.key, label: p.label, multi: !!p.multi, whole, options, selected: ps.selected, look: pickerLook,
      // One whose list failed needn't hold Save when the tracker does without it (Jira's first board).
      disabled: !fixed && (!ok || ps.state === 'waiting' || ps.state === 'loading'), fixed, required: !p.whole && !p.multi && !(p.fallback && ps.state === 'failed'),
      // Shown once there's a choice to make, or to say why its list couldn't be read.
      hidden: !!p.hideSingle && ps.state !== 'failed' && options.length <= 1, hint: p.hint ?? null,
    };
  });
  const ready = pickers.every((p) => p.fixed || !p.required || p.selected.length) && pickers.every((p) => p.look?.icon !== 'sync~spin');
  const name = d.name;
  return {
    id: s.id, rev: s.rev,
    title: s.existing ? `Change ${s.existing.title}` : 'Connect a tracker',
    summary: s.root ? `For ${s.projectName}. acc writes it to that repo's .acc/config.json, and the sign-in stays in VSCode for this repo only.` : 'Choose the project to connect a tracker to.',
    back: { section: s.from, label: `Back to ${SECTION_WORD[s.from]}` },
    projects: s.existing || s.projects.length < 2 ? [] : s.projects.map((p) => ({ ...p, on: p.root === s.root })),
    kinds: s.existing ? [] : list.map((x) => ({ kind: x.kind, name: x.name, icon: x.icon, on: x.kind === d.kind })),
    kind: d.kind, name, icon: d.icon, host,
    methods: editing && d.methods.length > 1 ? d.methods.map((m) => ({ id: m.id, label: m.label, icon: m.icon, on: m.id === method.id })) : [],
    method: { id: method.id, hint: method.hint, test: method.test },
    fields: editing ? fields : [],
    // Not held back by an empty site: Test sends what's typed there, and says beside it what's wrong.
    signIn: { look, editing, canTest: !!s.root && !testing && !s.saving },
    pickers,
    save: {
      can: !!s.root && ok && ready && !s.saving, label: s.existing ? 'Save changes' : `Connect ${name}`,
      look: s.saving ? LOOK('Saving', 'sync~spin', 'blue') : s.saveError ? LOOK(s.saveError, 'warning', 'orange') : null,
    },
  };
}

// ---------------------------------------------------------------- the Command Center page

export const HOME_SECTIONS = ['overview', ...VIEW_KINDS] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];

export interface NavItem {
  section: HomeSection;
  label: string;
  icon: string;
  /** A number beside the label: what needs a person when attention is set, otherwise how many there are. */
  count: number | null;
  attention: boolean;
  hint: string;
}

export interface AttentionItem {
  key: string;
  look: Look;
  title: string;
  detail: string;
  /** More than the detail has room for, on hover: a conflict's files in full. */
  tip?: string;
  project: string;
  actions: Action[];
  /** A command that takes one argument, such as a tracker's sign-in. */
  extra?: { command: string; label: string; icon: string; arg: string };
  /** A section of the page to open, such as Setup. */
  go?: { section: HomeSection; label: string };
  /** A task's analysis's questions, answered right here (D-052), or sent to the client when it has a ticket (D-066). */
  analysis?: { project: string; task: string; questions: AnalysisAsk[]; canAsk?: boolean };
  /** An update for a ticket, to post or discard right here, or edit on its task's page (D-066). */
  update?: UpdateCard;
}

export interface StatTile {
  label: string;
  value: string;
  icon: string;
  tone: Tone;
  section: HomeSection;
  hint: string;
}

export interface ActivityItem {
  at: string;
  task: string;
  title: string;
  from: string | null;
  to: string;
  by: string;
}

export interface OverviewModel {
  projects: { name: string; root: string; branch: string | null; account: string | null; trackers: string[] }[];
  /** Agents' questions, answered right here. They come before everything else that needs you. */
  questions: QuestionCard[];
  attention: AttentionItem[];
  stats: StatTile[];
  ready: { project: string; id: string; title: string; environment: string; action: Action }[];
  /** Everything that happened, newest first (D-037). */
  history: HistoryItem[];
}

export interface HomeModel {
  kind: 'home';
  section: HomeSection;
  nav: NavItem[];
  overview: OverviewModel;
  tasks: TasksModel;
  agents: AgentsModel;
  worktrees: WorktreesModel;
  environments: EnvironmentsModel;
  setup: SetupModel;
  /** Commands acc ran for you, newest first, shown in the page's output panel. */
  runs: RunCard[];
  /** The Connect page, while it's open: it shows in place of the section, with Back to it (GH-51). */
  connect: ConnectModel | null;
}

export interface HomeInput {
  hub: HubLike;
  section: HomeSection;
  boards: (root: string) => BoardInput[];
  identity: (root: string) => IdentityCard | null;
  setup: { items: DoctorItem[]; confirmed: Set<string> };
  runs?: RunInput[];
  /** The edit a task's page holds for an update, unsent, following the drafts it replaced. */
  edited?: (root: string, id: string, replaces: string[]) => string | null;
  connect?: ConnectModel | null;
  /** The Slack card, for this machine (GH-58). */
  slack?: SlackCard | null;
}

/** How many things need a person: each question, and each orange item. The badge and the Overview agree. */
export const needsYouCount = (o: Pick<OverviewModel, 'questions' | 'attention'>): number => o.questions.length + o.attention.filter((a) => a.look.tone === 'orange').length;


/**
 * Everything on one page (D-029). The Overview gathers what needs a person, from every project: agents
 * waiting on a prompt, blocked tasks, missing sign-ins, setup still to do, and work waiting for review.
 */
export function homeModel(i: HomeInput): HomeModel {
  const { hub } = i;
  const tasks = tasksModel(hub, i.boards);
  const agents = agentsModel(hub, i.setup.items);
  const worktrees = worktreesModel(hub);
  const environments = environmentsModel(hub, i.identity, i.slack ?? null);
  const setup = setupModel(i.setup.items, i.setup.confirmed);
  const questions = questionCards(hub);
  const asked = new Set(questions.map((q) => q.sessionId));

  const attention: AttentionItem[] = [];
  const ready: OverviewModel['ready'] = [];
  const linked = new Set<string>();
  for (const p of hub.projects) {
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
    // Updates acc drafted for tickets (D-066): each waits for a person to read and post it, or discard it.
    for (const drafted of updateCards(p.root, hub.updates?.(p.root) ?? [], p.config.github?.account ?? null, i.boards(p.root), (key) => trackerForKey(p.config.trackers ?? [], key))) {
      // Edited on its task's page and not sent: the Overview shows that edit, and it's posted from there,
      // so Post here can't send acc's text instead.
      const edit = drafted.state === 'draft' || drafted.stale ? i.edited?.(p.root, drafted.id, drafted.replaces) ?? null : null;
      // One that may have posted already keeps saying so (D-051): that warning comes before the edit.
      const card = edit !== null && edit.trim() !== drafted.text.trim() ? { ...drafted, edited: edit, look: drafted.stale ? drafted.look : LOOK('Edited on the task page', 'edit', 'orange') } : drafted;
      attention.push({
        key: `u:${p.root}:${card.id}`, look: card.look, title: card.stale ? `Update for ${card.key} may have posted` : `Update ready for ${card.key}`,
        detail: `${p.name} · ${card.about}`, project: p.name,
        actions: [{ command: 'acc.task.show', label: 'Edit', icon: 'edit', ref: { project: p.root, task: card.task }, ...(card.edited !== null ? { primary: true } : {}) }],
        ...(card.signIn ? { extra: { command: card.signIn.command, label: card.signIn.label, icon: 'plug', arg: card.signIn.arg } } : {}),
        update: card,
      });
    }
    for (const b of i.boards(p.root)) {
      if (b.error && b.connect) attention.push({ key: `b:${p.root}:${b.index}`, look: LOOK('Not signed in', 'plug', 'orange'), title: b.title, detail: `${p.name} · ${b.error}`, project: p.name, actions: [], extra: { command: b.connect.command, label: b.connect.label, icon: 'plug', arg: b.connect.arg } });
    }
  }
  for (const s of hub.agents) {
    const look = agentLook(s);
    if (!look.needsYou || (s.id && linked.has(s.id)) || (s.sessionId && asked.has(s.sessionId))) continue;
    const key = sessionKey(s);
    attention.push({
      key: `a:${key}`, look: { label: look.label, icon: look.icon, tone: look.tone }, title: s.name ?? 'Agent session', detail: hub.projectFor(s.cwd)?.name ?? s.cwd, project: hub.projectFor(s.cwd)?.name ?? '',
      actions: [
        // Its conversation in Claude Code when its session id is known; attaching a terminal otherwise.
        ...(s.sessionId ? [{ command: 'acc.agent.openInClaude', label: 'Open in Claude Code', icon: 'comment-discussion', ref: { session: key }, primary: true }]
          : s.id ? [{ command: 'acc.agent.attach', label: 'Attach', icon: 'terminal', ref: { session: key }, primary: true }] : []),
        { command: 'acc.agent.watch', label: 'Watch', icon: 'pulse', ref: { session: key } },
      ],
    });
  }
  const todo = setup.total - setup.done;
  const failing = setup.parts.reduce((n, part) => n + part.steps.filter((s) => s.look.tone === 'orange').length, 0);
  if (todo > 0) attention.push({ key: 'setup', look: LOOK(`${todo} setup step${todo === 1 ? '' : 's'} to do`, 'checklist', failing ? 'orange' : 'neutral'), title: 'Setup', detail: setup.parts.flatMap((part) => part.steps).filter((s) => s.look.tone === 'orange').slice(0, 3).map((s) => s.title).join(' · ') || 'Some steps are left to confirm', project: '', actions: [], go: { section: 'setup', label: 'Open Setup' } });
  // People's work first, then the rest: orange before blue before neutral.
  const rank = (a: AttentionItem) => (a.look.tone === 'orange' ? 0 : a.look.tone === 'blue' ? 1 : 2);
  attention.sort((a, b) => rank(a) - rank(b));

  const rows = hub.projects.flatMap((p) => hub.taskRows(p.root));
  const onBoard = tasks.projects.reduce((n, p) => n + p.boards.reduce((k, b) => k + b.columns.reduce((c, col) => c + col.cards.length, 0), 0), 0);
  // An agent waiting on a question reads as busy to Claude Code, but it's waiting on you.
  const working = hub.agents.filter((s) => (s.kind === 'background' ? s.state === 'working' : s.status === 'busy') && !hub.askingFor?.(s)).length;
  const review = rows.filter((r) => r.display === 'review').length;
  const linkedTrees = hub.projects.reduce((n, p) => n + p.worktrees.filter((w) => !w.main).length, 0);
  const stats: StatTile[] = [
    tasks.projects.some((p) => p.boards.length)
      ? { label: 'On the board', value: String(onBoard), icon: 'project', tone: 'neutral', section: 'tasks', hint: 'Tickets on your trackers\' boards' }
      : { label: 'Tasks', value: String(rows.length), icon: 'tasklist', tone: 'neutral', section: 'tasks', hint: 'Tasks acc keeps' },
    { label: 'Ready', value: String(ready.length), icon: 'rocket', tone: ready.length ? 'blue' : 'neutral', section: 'tasks', hint: 'Tasks an agent can start now' },
    { label: 'Agents working', value: String(working), icon: 'hubot', tone: working ? 'blue' : 'neutral', section: 'agents', hint: 'Sessions busy right now' },
    { label: 'Waiting for review', value: String(review), icon: 'eye', tone: review ? 'blue' : 'neutral', section: 'tasks', hint: 'Finished by an agent, for you to check' },
    { label: 'Worktrees', value: String(linkedTrees), icon: 'git-branch', tone: 'neutral', section: 'worktrees', hint: 'Task checkouts beside the main one' },
    { label: 'Setup', value: `${setup.done}/${setup.total}`, icon: 'checklist', tone: failing ? 'orange' : 'neutral', section: 'setup', hint: failing ? `${failing} step${failing === 1 ? '' : 's'} failing` : 'Steps done' },
  ];

  const history = historyItems(hub, i.runs ?? []);
  const projects = hub.projects.map((p) => ({ name: p.name, root: p.root, branch: p.branch, account: p.config.github?.account ?? null, trackers: i.boards(p.root).map((b) => b.title) }));

  const people = needsYouCount({ questions, attention });
  const needsAgents = agents.places.reduce((n, pl) => n + pl.agents.filter((a) => a.needsYou).length, 0);
  const sessions = agents.places.reduce((n, pl) => n + pl.agents.length, 0);
  const taskAttention = rows.filter((r) => r.display === 'needs-you' || r.display === 'blocked').length;
  const nav: NavItem[] = [
    { section: 'overview', label: 'Overview', icon: 'home', count: people || null, attention: people > 0, hint: people ? `${people} thing${people === 1 ? '' : 's'} need you` : 'Nothing needs you' },
    { section: 'tasks', label: 'Tasks', icon: 'project', count: taskAttention || rows.length || null, attention: taskAttention > 0, hint: taskAttention ? `${taskAttention} need you` : `${rows.length} task${rows.length === 1 ? '' : 's'}` },
    { section: 'agents', label: 'Agents', icon: 'hubot', count: needsAgents || sessions || null, attention: needsAgents > 0, hint: needsAgents ? `${needsAgents} waiting on you` : `${sessions} session${sessions === 1 ? '' : 's'}` },
    { section: 'worktrees', label: 'Worktrees', icon: 'git-branch', count: linkedTrees || null, attention: false, hint: `${linkedTrees} task checkout${linkedTrees === 1 ? '' : 's'}` },
    // Slack paused because it refused a message needs you too (GH-58).
    { section: 'environments', label: 'Environments', icon: 'server-environment', count: null, attention: hub.projects.some((p) => !!i.identity(p.root)?.problem) || i.slack?.state === 'paused', hint: i.slack?.state === 'paused' ? 'Notices to Slack are paused' : 'Branches, orgs, your GitHub account and Slack' },
    { section: 'setup', label: 'Setup', icon: 'checklist', count: todo || null, attention: failing > 0, hint: todo ? `${todo} to do` : 'All done' },
  ];
  const runs = (i.runs ?? []).map((r) => runCard(r));
  return { kind: 'home', section: i.section, nav, overview: { projects, questions, attention, stats, ready, history }, tasks, agents, worktrees, environments, setup, runs, connect: i.connect ?? null };
}

export type Model = TasksModel | AgentsModel | WorktreesModel | EnvironmentsModel | SetupModel | TicketModel | HomeModel | AgentModel;

/** Messages the webview sends. Everything else is ignored. */
export const TICKET_ACTIONS = ['comment', 'status', 'assign', 'labels', 'track', 'refresh', 'waive'] as const;
export type TicketAction = (typeof TICKET_ACTIONS)[number];

/**
 * Why a ticket page refuses an action, or null. Status, assignee and labels change only where the
 * tracker says "edits": true, even when a page sends them anyway; comments always may (D-066).
 */
export function ticketActionRefusal(action: string, edits: boolean): string | null {
  if (edits || !['status', 'assign', 'labels'].includes(action)) return null;
  return 'This tracker\'s tickets are read-only here. Set "edits": true on it in .acc/config.json to change status, assignee and labels. On GitHub, acc sync then also closes a task\'s issue when its work merges.';
}

export type FromWebview =
  | { type: 'ready' } | { type: 'refresh' }
  | { type: 'run'; command: string; ref: Ref }
  | { type: 'toolbar'; command: string; project?: string; arg?: string }
  /** Open a ticket's page. tracker is null for a task acc alone keeps. */
  | { type: 'ticket'; project: string; tracker: number | null; key: string }
  /** A card dropped on another column of a tracker board. */
  | { type: 'move'; project: string; tracker: number; key: string; to: string }
  /** Track on a tracker board's card: acc keeps the ticket as a task (D-074). */
  | { type: 'track'; project: string; tracker: number; key: string }
  | { type: 'ticket-action'; action: TicketAction; text?: string }
  /** A link in a ticket. Only web links are opened. */
  | { type: 'open'; url: string }
  /** The page moved to another section, so reopening it comes back there. */
  | { type: 'nav'; section: HomeSection }
  /** A task's card dropped in another lane of the agent board (D-041). */
  | { type: 'move-task'; project: string; task: string; to: string }
  /** An answer to an agent's question or permission prompt (D-030). */
  | { type: 'answer'; id: string; decision: 'allow' | 'deny' | 'terminal'; always?: boolean; scope?: 'session' | 'project'; mode?: 'auto' | 'acceptEdits' | 'default'; command?: string; stop?: boolean; message?: string; answers?: Record<string, string> }
  /** Something for a command acc is running: typed input, stop, rerun in a terminal, or dismiss. */
  | { type: 'run-input'; run: string; text: string }
  | { type: 'agent-reply'; text: string }
  | { type: 'run-control'; run: string; action: RunControl }
  /** A person's answer to one of a task's analysis's questions (D-052). acc records it; the page never writes it. */
  | { type: 'analysis-answer'; project: string; task: string; question: string; text: string }
  /**
   * A person posts an update with the text they edited, or discards it, or sends one of an analysis's
   * questions to the client as a draft (D-066). acc records each; the page never writes them.
   */
  | { type: 'update-post'; project: string; id: string; text: string; again?: boolean }
  | { type: 'update-discard'; project: string; id: string }
  | { type: 'update-ask'; project: string; task: string; question: string }
  /** The task page's unsent edit of an update, or null once it's acc's text again, so the Overview won't post acc's. */
  | { type: 'update-edit'; project: string; id: string; text: string | null }
  /**
   * The Connect page (GH-51), each for the page that's open (session). A secret travels once, in
   * connect-test, and is never sent back.
   */
  | { type: 'connect-project'; session: string; root: string }
  | { type: 'connect-kind'; session: string; kind: string }
  | { type: 'connect-method'; session: string; method: string }
  | { type: 'connect-set'; session: string; field: string; value: string }
  | { type: 'connect-test'; session: string; host: string; fields: Record<string, string> }
  | { type: 'connect-again'; session: string }
  | { type: 'connect-pick'; session: string; key: string; value: string | string[] | null }
  | { type: 'connect-save'; session: string }
  | { type: 'connect-cancel'; session: string }
  /**
   * The Slack card (GH-58). A webhook travels once, in slack-connect, to VSCode's secret storage, and is
   * never sent back: the card shows only its last four characters.
   */
  | { type: 'slack-connect'; url: string }
  | { type: 'slack'; action: SlackAction }
  | { type: 'slack-kinds'; kinds: SlackKind[] };

export type ConnectMessage = Extract<FromWebview, { session: string }>;

const CONNECT = declaredKeys();
const connectValue = (v: unknown): boolean => v === null || (typeof v === 'string' && v.length <= 500) || (Array.isArray(v) && v.length <= 200 && v.every((x) => typeof x === 'string' && x.length <= 500));

/** The page's answer as the hook reads it, with only the fields its decision has. */
export function answerOf(m: Extract<FromWebview, { type: 'answer' }>): Answer {
  if (m.decision === 'allow') {
    return {
      decision: 'allow', ...(m.always ? { always: true, scope: m.scope === 'project' ? 'project' : 'session' } : {}), ...(m.mode ? { mode: m.mode } : {}),
      ...(m.command?.trim() ? { command: m.command.trim() } : {}), ...(m.answers ? { answers: m.answers } : {}),
    };
  }
  if (m.decision === 'deny') return { decision: 'deny', ...(m.message?.trim() ? { message: m.message.trim() } : {}), ...(m.stop ? { stop: true } : {}) };
  return { decision: 'terminal' };
}

/** What the Slack card's buttons ask for (GH-58). The card itself is drawn from a SlackCard. */
export type { SlackCard } from './slack.ts';
export const SLACK_ACTIONS = ['test', 'on', 'off', 'remove'] as const;
export type SlackAction = (typeof SLACK_ACTIONS)[number];

export const RUN_CONTROLS = ['stop', 'terminal', 'dismiss'] as const;
export type RunControl = (typeof RUN_CONTROLS)[number];

const KEY = /^[A-Z][A-Z0-9_]*-\d+$/i;
const short = (v: unknown, max = 500): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

export function isFromWebview(m: unknown): m is FromWebview {
  const x = m as Record<string, unknown> | null;
  if (!x || typeof x.type !== 'string') return false;
  switch (x.type) {
    case 'ready': case 'refresh': return true;
    case 'run': case 'toolbar': return typeof x.command === 'string' && x.command.startsWith('acc.') && (x.arg === undefined || short(x.arg));
    case 'ticket': return short(x.project, 4096) && short(x.key, 100) && KEY.test(x.key as string) && (x.tracker === null || Number.isInteger(x.tracker));
    case 'move': return short(x.project, 4096) && short(x.key, 100) && KEY.test(x.key as string) && Number.isInteger(x.tracker) && typeof x.to === 'string' && x.to.length <= 200;
    case 'track': return short(x.project, 4096) && short(x.key, 100) && KEY.test(x.key as string) && Number.isInteger(x.tracker);
    case 'ticket-action': return (TICKET_ACTIONS as readonly string[]).includes(x.action as string) && (x.text === undefined || (typeof x.text === 'string' && x.text.length <= 65_536));
    case 'open': return short(x.url, 4096) && /^(https?:|mailto:)/i.test(x.url as string);
    case 'nav': return (HOME_SECTIONS as readonly string[]).includes(x.section as string);
    case 'move-task': return short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string) && (TASK_GROUPS as readonly string[]).includes(x.to as string);
    case 'answer': {
      if (!short(x.id, 64) || !['allow', 'deny', 'terminal'].includes(x.decision as string)) return false;
      if (x.always !== undefined && typeof x.always !== 'boolean') return false;
      if (x.stop !== undefined && typeof x.stop !== 'boolean') return false;
      if (x.scope !== undefined && x.scope !== 'session' && x.scope !== 'project') return false;
      if (x.mode !== undefined && !['auto', 'acceptEdits', 'default'].includes(x.mode as string)) return false;
      if (x.command !== undefined && !(typeof x.command === 'string' && x.command.length <= 20_000)) return false;
      if (x.message !== undefined && !(typeof x.message === 'string' && x.message.length <= 4000)) return false;
      if (x.answers === undefined) return true;
      const a = x.answers as Record<string, unknown>;
      return !!a && typeof a === 'object' && !Array.isArray(a) && Object.keys(a).length <= 8 && Object.values(a).every((v) => typeof v === 'string' && v.length <= 4000);
    }
    case 'agent-reply': return typeof x.text === 'string' && x.text.trim().length > 0 && x.text.length <= 65_536;
    case 'run-input': return short(x.run, 64) && typeof x.text === 'string' && x.text.length <= 4096 && !/[\r\n]/.test(x.text as string);
    case 'run-control': return short(x.run, 64) && (RUN_CONTROLS as readonly string[]).includes(x.action as string);
    case 'analysis-answer': return short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string) && typeof x.question === 'string' && /^q\d{1,3}$/.test(x.question) && short(x.text, 4000) && !!(x.text as string).trim();
    case 'update-post': return short(x.project, 4096) && short(x.id, 120) && UPDATE_ID.test(x.id as string) && short(x.text, UPDATE_TEXT_MAX) && !!(x.text as string).trim() && (x.again === undefined || typeof x.again === 'boolean');
    case 'update-discard': return short(x.project, 4096) && short(x.id, 120) && UPDATE_ID.test(x.id as string);
    case 'update-edit': return short(x.project, 4096) && short(x.id, 120) && UPDATE_ID.test(x.id as string) && (x.text === null || (typeof x.text === 'string' && x.text.length <= UPDATE_TEXT_MAX));
    case 'update-ask': return short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string) && typeof x.question === 'string' && /^q\d{1,3}$/.test(x.question);
    case 'connect-project': return short(x.session, 64) && short(x.root, 4096);
    case 'connect-kind': return short(x.session, 64) && CONNECT.kinds.has(x.kind as string);
    case 'connect-method': return short(x.session, 64) && CONNECT.methods.has(x.method as string);
    case 'connect-set': return short(x.session, 64) && CONNECT.fields.has(x.field as string) && typeof x.value === 'string' && x.value.length <= 4096;
    case 'connect-test': {
      if (!short(x.session, 64) || typeof x.host !== 'string' || x.host.length > 4096) return false;
      const f = x.fields as Record<string, unknown> | null;
      return !!f && typeof f === 'object' && !Array.isArray(f) && Object.keys(f).length <= 8 && Object.entries(f).every(([k, v]) => CONNECT.fields.has(k) && typeof v === 'string' && v.length <= 4096);
    }
    case 'connect-pick': return short(x.session, 64) && CONNECT.pickers.has(x.key as string) && connectValue(x.value);
    case 'connect-again': case 'connect-save': case 'connect-cancel': return short(x.session, 64);
    case 'slack-connect': return typeof x.url === 'string' && isSlackWebhook(x.url.trim());
    case 'slack': return (SLACK_ACTIONS as readonly string[]).includes(x.action as string);
    case 'slack-kinds': return Array.isArray(x.kinds) && x.kinds.length <= SLACK_KINDS.length && x.kinds.every((k) => (SLACK_KINDS as readonly unknown[]).includes(k));
    default: return false;
  }
}
