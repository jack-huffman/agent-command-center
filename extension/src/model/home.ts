/**
 * The Command Center page: every section on one page, with what each area adds to it.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { autoMergeOn, trackerForKey } from '../../../packages/core/src/config.ts';
import { agentLook } from '../logic/agents.ts';
import { analysisWait } from '../logic/tasks.ts';
import type { DoctorItem } from '../logic/setup.ts';
import { fileList, prConflicts, saidLine, shortPath, type TaskRow } from '../logic/shared.ts';
import { type FinishedJobs, inProgress } from '../progress.ts';
import type { SlackCard } from '../slack.ts';
import type { AgentModel } from './agent-page.ts';
import { agentsModel, type AgentsModel, sessionFolders, type WhereView } from './agents.ts';
import type { BoardInput } from './boards.ts';
import type { ConnectModel } from './connect.ts';
import { environmentsModel, type EnvironmentsModel, type IdentityCard } from './environments.ts';
import { historyItems } from './history.ts';
import { type AttentionItem, mergeQueues, needsYouCount, type OverviewModel, queueLook, type QueuePanel, type StatTile } from './overview.ts';
import { type QuestionCard, questionCards } from './questions.ts';
import { runCard, type RunCard, type RunInput } from './runs.ts';
import { setupModel, type SetupModel } from './setup.ts';
import { type Action, type HomeSection, type HubLike, LOOK, nameOf, type ProjectLike, type Ref, sessionKey } from './shared.ts';
import type { TicketModel } from './task-page.ts';
import { analysisLook, autopilotLook, cardActions, closedPrLook } from './cards.ts';
import { tasksModel, type TasksModel } from './tasks.ts';
import { hasTicket, updateCards, withClient } from './updates.ts';
import { worktreesModel, type WorktreesModel } from './worktrees.ts';
import { AREAS } from './areas.ts';

// ---------------------------------------------------------------- the Command Center page

export interface NavItem {
  section: HomeSection;
  label: string;
  icon: string;
  /** A number beside the label: what needs a person when attention is set, otherwise how many there are. */
  count: number | null;
  attention: boolean;
  hint: string;
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
  /** What the Agents tab's Where column shows (GH-83). Folder unless said. */
  whereView?: WhereView;
  /** In progress's memory of jobs that ended, kept a minute (D-092). */
  finished?: FinishedJobs;
  /**
   * Whether autopilot runs for a project's repo in this window, somewhere else, or not at all (D-064). Not
   * at all, its merge queue doesn't move, and says so (GH-73).
   */
  autopilot?: (root: string) => 'on' | 'elsewhere' | null;
  /** The extension's clock, for In progress's times. */
  now?: number;
}

/** What homeModel has worked out, for each area's part of the page. Areas add to attention and ready as they go. */
export interface HomeContext {
  i: HomeInput;
  hub: HubLike;
  tasks: TasksModel;
  agents: AgentsModel;
  worktrees: WorktreesModel;
  environments: EnvironmentsModel;
  setup: SetupModel;
  questions: QuestionCard[];
  /** The sessions whose question shows on its own, to answer in place. */
  asked: Set<string>;
  /** The background sessions tasks run in: each shows on its task, not again as an agent. */
  linked: Set<string>;
  /** Every task, in every project. */
  rows: TaskRow[];
  attention: AttentionItem[];
  ready: OverviewModel['ready'];
}

/**
 * What an area adds to the Command Center page (D-099), in its module's `area`. Areas take their turns by
 * order: under Needs you, each project's items area by area, then the items that aren't a project's; the
 * Overview's stat tiles by each tile's own order; and the rail's items.
 */
export interface HomeArea {
  order: number;
  /** What it adds under Needs you for one project, in its turn, before the next project's. */
  attention?(c: HomeContext, p: ProjectLike): void;
  /** What it adds under Needs you once every project's items are in. */
  after?(c: HomeContext): void;
  /** Its stat tiles on the Overview, each with its place among every area's. */
  stats?(c: HomeContext): { order: number; tile: StatTile }[];
  /** Its section's item in the rail. */
  nav?(c: HomeContext): NavItem;
}

/**
 * Everything on one page (D-029). The Overview gathers what needs a person, from every project: agents
 * waiting on a prompt, blocked tasks, missing sign-ins, setup still to do, and work waiting for review.
 */
export function homeModel(i: HomeInput): HomeModel {
  const { hub } = i;
  const tasks = tasksModel(hub, i.boards);
  const agents = agentsModel(hub, i.setup.items, i.whereView ?? 'folder');
  const worktrees = worktreesModel(hub);
  const environments = environmentsModel(hub, i.identity, i.slack ?? null);
  const setup = setupModel(i.setup.items, i.setup.confirmed);
  const questions = questionCards(hub);
  const asked = new Set(questions.map((q) => q.sessionId));
  const c: HomeContext = { i, hub, tasks, agents, worktrees, environments, setup, questions, asked, linked: new Set(), rows: hub.projects.flatMap((p) => hub.taskRows(p.root)), attention: [], ready: [] };
  // Each area in its turn: what needs you in each project, then what needs you once.
  const parts = AREAS.flatMap((a) => (a.home ? [a.home] : [])).sort((a, b) => a.order - b.order);
  for (const p of hub.projects) for (const a of parts) a.attention?.(c, p);
  for (const a of parts) a.after?.(c);
  const { attention, ready } = c;
  // People's work first, then the rest: orange before blue before neutral.
  const rank = (a: AttentionItem) => (a.look.tone === 'orange' ? 0 : a.look.tone === 'blue' ? 1 : 2);
  attention.sort((a, b) => rank(a) - rank(b));
  const stats = parts.flatMap((a) => a.stats?.(c) ?? []).sort((a, b) => a.order - b.order).map((s) => s.tile);

  const history = historyItems(hub, i.runs ?? []);
  const projects = hub.projects.map((p) => ({ name: p.name, root: p.root, branch: p.branch, account: p.config.github?.account ?? null, trackers: i.boards(p.root).map((b) => b.title) }));
  const queue = mergeQueues(hub, i.autopilot);
  const nav = parts.flatMap((a) => (a.nav ? [a.nav(c)] : []));
  const runs = (i.runs ?? []).map((r) => runCard(r));
  // What's under way, below Needs you. It never changes the badge, which counts only what needs you.
  const progress = inProgress({ hub, runs: i.runs, finished: i.finished, autopilot: i.autopilot, now: i.now });
  return { kind: 'home', section: i.section, nav, overview: { projects, questions, attention, stats, ready, queue, history, inProgress: progress }, tasks, agents, worktrees, environments, setup, runs, connect: i.connect ?? null };
}

export type Model = TasksModel | AgentsModel | WorktreesModel | EnvironmentsModel | SetupModel | TicketModel | HomeModel | AgentModel;
