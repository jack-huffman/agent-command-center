/**
 * What each editor tab shows, as plain data. Built here from the hub's data, posted to the webview,
 * and rendered there with text only (no HTML from data). No vscode import, so it's testable.
 */
import { DISPLAY, type Task } from '../../packages/core/src/ledger.ts';
import type { GateStatus } from '../../packages/core/src/receipts.ts';
import { type Doc, fromMarkdown } from '../../packages/core/src/trackers/doc.ts';
import type { StatusCategory, Ticket } from '../../packages/core/src/trackers/types.ts';
import type { GithubIdentity } from '../../packages/core/src/github.ts';
import { STEPS } from '../../packages/core/src/onboarding/steps.ts';
import type { Environment } from '../../packages/core/src/config.ts';
import { agentLook, type AgentSession, type DoctorItem, ENV_ICON, groupTasks, isUnder, TASK_GROUPS, type TaskRow, type Tone } from './logic.ts';

export const VIEW_KINDS = ['tasks', 'agents', 'worktrees', 'environments', 'setup'] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

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

export interface ProjectLike {
  name: string;
  root: string;
  config: { github: { repo: string; account: string } | null; environments: Environment[]; profile: string };
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
}

// ---------------------------------------------------------------- tasks: the board

export interface Card {
  id: string;
  title: string;
  environment: string;
  waitingOn: string[];
  url: string | null;
  agent: Look | null;
  worktree: string | null;
  actions: Action[];
}

/** What a task's card offers, by where it is in its life. Dispatch comes first wherever it applies. */
export function cardActions(t: TaskRow, ref: Ref): Action[] {
  const a: Action[] = [];
  const canDispatch = t.display === 'ready' || t.state === 'rework';
  if (canDispatch) a.push({ command: 'acc.task.dispatch', label: t.state === 'rework' ? 'Re-dispatch' : 'Dispatch', icon: 'rocket', ref, primary: true });
  if (t.state === 'running' && t.run?.bgId) a.push({ command: 'acc.task.attach', label: 'Attach', icon: 'terminal', ref, primary: !canDispatch });
  if (t.run?.worktree && t.state !== 'todo') a.push({ command: 'acc.task.openWorktree', label: 'Worktree', icon: 'empty-window', ref });
  a.push({ command: 'acc.task.move', label: 'Move', icon: 'arrow-swap', ref, primary: !a.some((x) => x.primary) });
  if (t.state === 'running') a.push({ command: 'acc.task.abandon', label: 'Abandon', icon: 'debug-stop', ref, danger: true });
  else if (t.state === 'blocked') a.push({ command: 'acc.task.unblock', label: 'Unblock', icon: 'debug-restart', ref });
  else if (t.state !== 'done') a.push({ command: 'acc.task.block', label: 'Block', icon: 'circle-slash', ref });
  if ((t.state === 'done' || t.state === 'blocked' || t.state === 'todo') && t.run?.worktree) a.push({ command: 'acc.task.cleanup', label: 'Clean up', icon: 'trash', ref });
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
      const columns: Column[] = TASK_GROUPS.map((group) => {
        const d = DISPLAY[group];
        return {
          group, label: d.label, icon: d.icon, tone: d.tone,
          cards: (byGroup.get(group) ?? []).map((t) => ({
            id: t.id, title: t.title, environment: t.environment, waitingOn: t.deps, url: t.source.url,
            agent: t.agent ?? null, worktree: t.run?.worktree ?? null,
            actions: cardActions(t, { project: p.root, task: t.id }),
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
  kind: 'github' | 'jira' | 'azure';
  title: string;
  board: { source: string; title: string; url: string | null; notice: string | null; columns: { id: string; name: string; category: StatusCategory; statusIds: string[] }[]; cards: { key: string; title: string; url: string; status: { id: string; name: string }; type: string | null; assignees: { name: string }[]; labels: { name: string; color: string | null }[]; priority: string | null }[] } | null;
  error: string | null;
  connect: { command: string; label: string; arg: string } | null;
  loading: boolean;
  /** Who the board acts as: the GitHub account, the Jira email, the Microsoft account. */
  signedInAs?: string | null;
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
  /** The task acc keeps for this ticket, when there is one: where it is, and its next step. */
  acc: { look: Look; needsYou: boolean; action: Action | null } | null;
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
  kind: 'github' | 'jira' | 'azure';
  title: string;
  source: string | null;
  url: string | null;
  notice: string | null;
  error: string | null;
  connect: { command: string; label: string; arg: string } | null;
  loading: boolean;
  signedInAs: string | null;
  columns: TrackerColumn[];
}

/** The agent's side of a ticket: acc's own state, or what the agent is doing about it. */
function accLook(row: TaskRow): Look {
  if (row.agent && row.display === 'needs-you') return row.agent;
  const d = DISPLAY[row.display];
  return { label: d.label, icon: d.icon, tone: d.tone };
}

export function trackerBoard(b: BoardInput, rows: TaskRow[], root: string): TrackerBoard {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const columns: TrackerColumn[] = (b.board?.columns ?? []).map((c) => ({
    id: c.id, name: c.name, tone: CATEGORY_TONE[c.category], done: c.category === 'done',
    cards: (b.board?.cards ?? []).filter((card) => c.statusIds.includes(card.status.id)).map((card): TrackerCard => {
      const row = byId.get(card.key);
      const next = row ? cardActions(row, { project: root, task: row.id }).find((a) => a.primary && (a.command === 'acc.task.dispatch' || a.command === 'acc.task.attach')) ?? null : null;
      return {
        key: card.key, title: card.title, type: card.type, typeIcon: typeIcon(card.type), priority: card.priority, priorityIcon: priorityIcon(card.priority),
        labels: card.labels, assignees: card.assignees.map(chip), status: card.status.name,
        acc: row ? { look: accLook(row), needsYou: row.display === 'needs-you', action: next } : null,
      };
    }),
  }));
  return {
    index: b.index, kind: b.kind, title: b.board?.title ?? b.title, source: b.board?.source ?? null, url: b.board?.url ?? null,
    notice: b.board?.notice ?? null, error: b.error, connect: b.connect, loading: b.loading, signedInAs: b.signedInAs ?? null, columns,
  };
}

// ---------------------------------------------------------------- a ticket's page (D-026)

export interface TicketAcc {
  look: Look;
  environment: string;
  waitingOn: string[];
  blocker: string | null;
  agent: Look | null;
  worktree: string | null;
  branch: string | null;
  checks: { gate: string; status: GateStatus; summary: string }[];
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
  sourceKind: 'github' | 'jira' | 'azure' | 'acc';
  loading: boolean;
  error: string | null;
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
  /** What the page may change in the tracker. Nothing, for a task acc alone keeps. */
  can: { status: boolean; assign: boolean; labels: boolean; comment: boolean };
  acc: TicketAcc | null;
  /** A tracker ticket acc doesn't keep yet, which "Track in acc" adds to the ledger. */
  trackable: boolean;
  /** Who a comment or change is made as. */
  signedInAs: string | null;
}

export interface TicketInput {
  project: string;
  tracker: number | null;
  trackerTitle: string | null;
  trackerKind: 'github' | 'jira' | 'azure' | null;
  key: string;
  ticket: Ticket | null;
  loading: boolean;
  error: string | null;
  connect: TicketModel['connect'];
  row: TaskRow | null;
  task: Task | null;
  checks: TicketAcc['checks'];
  signedInAs?: string | null;
}

export function ticketModel(i: TicketInput): TicketModel {
  const t = i.ticket;
  const live = i.tracker !== null;
  const acc: TicketAcc | null = i.row && i.task ? {
    look: accLook(i.row), environment: i.task.environment, waitingOn: i.row.deps, blocker: i.task.blocker,
    agent: i.row.agent ?? null, worktree: i.task.run?.worktree ?? null, branch: i.task.run?.branch ?? null, checks: i.checks,
    history: i.task.history.map((h) => ({ at: h.at, from: h.from, to: h.to, by: h.by, reason: h.reason ?? null })).reverse(),
    actions: cardActions(i.row, { project: i.project, task: i.row.id }).filter((a) => a.command !== 'acc.task.show' && a.command !== 'acc.task.openTicket'),
  } : null;
  const own = !live && i.task;
  return {
    kind: 'ticket', project: i.project, tracker: i.tracker, key: t?.key ?? i.key,
    title: t?.title ?? i.task?.title ?? i.key, url: t?.url ?? i.task?.source.url ?? null,
    sourceLabel: i.trackerTitle ?? 'Task kept by acc', sourceKind: t?.kind ?? i.trackerKind ?? 'acc',
    loading: i.loading, error: i.error, connect: i.connect,
    type: t?.type ?? null, typeIcon: typeIcon(t?.type ?? null),
    status: t ? { name: t.status.name, tone: CATEGORY_TONE[t.status.category] } : acc ? { name: acc.look.label, tone: acc.look.tone } : null,
    assignees: (t?.assignees ?? []).map(chip), reporter: t?.reporter ? chip(t.reporter) : null,
    labels: t?.labels ?? (i.task?.labels ?? []).map((name) => ({ name, color: null })),
    priority: t?.priority ?? null, priorityIcon: priorityIcon(t?.priority ?? null),
    created: t?.created ?? i.task?.createdAt ?? null, updated: t?.updated ?? i.task?.updatedAt ?? null,
    body: t?.body ?? (own ? fromMarkdown(i.task!.brief) : { blocks: [] }),
    comments: (t?.comments ?? []).map((c) => ({ id: c.id, author: chip(c.author), created: c.created, body: c.body, url: c.url })),
    related: t?.related ?? (i.task?.deps ?? []).map((d) => ({ key: d, title: '', relation: 'depends on', url: null })),
    can: { status: !!t, assign: !!t, labels: !!t, comment: !!t },
    acc, trackable: !!t && !i.task, signedInAs: i.signedInAs ?? null,
  };
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

export interface AgentsModel {
  kind: 'agents';
  error: string | null;
  places: { label: string; root: string | null; agents: AgentRow[] }[];
}

export function agentsModel(hub: HubLike): AgentsModel {
  const rowFor = (s: AgentSession): AgentRow => {
    const look = agentLook(s);
    const p = hub.projectFor(s.cwd);
    const key = s.sessionId ?? s.id ?? `${s.pid ?? ''}:${s.startedAt}`;
    const where = p ? (isUnder(s.cwd, p.root) ? s.cwd.slice(p.root.length + 1) || 'main checkout' : s.cwd.split('/').pop() ?? s.cwd) : s.cwd;
    return { key, background: !!s.id, name: s.name ?? s.sessionId?.slice(0, 8) ?? 'session', look: { label: look.label, icon: look.icon, tone: look.tone }, needsYou: look.needsYou, kind: s.kind, where, startedAt: s.startedAt };
  };
  const sorted = [...hub.agents].sort((a, b) => Number(agentLook(b).needsYou) - Number(agentLook(a).needsYou) || b.startedAt - a.startedAt);
  const places = hub.projects.map((p) => ({ label: p.name, root: p.root as string | null, agents: sorted.filter((s) => hub.projectFor(s.cwd) === p).map(rowFor) }));
  const elsewhere = sorted.filter((s) => !hub.projectFor(s.cwd));
  if (elsewhere.length) places.push({ label: 'Elsewhere on this machine', root: null, agents: elsewhere.map(rowFor) });
  return { kind: 'agents', error: hub.agentsError, places };
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
}

/** Every promotion path from each environment that nothing promotes into, following every listed option. */
export function promotionPaths(envs: Pick<Environment, 'branch' | 'promotesTo'>[]): string[][] {
  const into = new Set(envs.flatMap((e) => e.promotesTo));
  const starts = envs.filter((e) => !into.has(e.branch) && e.promotesTo.length);
  const out: string[][] = [];
  const walk = (path: string[]) => {
    const last = envs.find((e) => e.branch === path[path.length - 1]);
    const next = (last?.promotesTo ?? []).filter((b) => !path.includes(b));
    if (!next.length) { out.push(path); return; }
    for (const b of next) walk([...path, b]);
  };
  for (const s of starts) walk([s.branch]);
  return out;
}

export function environmentsModel(hub: HubLike, identity: (root: string) => IdentityCard | null = () => null): EnvironmentsModel {
  return {
    kind: 'environments',
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
  detail: string;
  why: string;
  fix: string | null;
  actions: Action[];
}

export interface SetupModel {
  kind: 'setup';
  done: number;
  total: number;
  parts: { part: 'machine' | 'project'; label: string; todo: number; steps: SetupRow[] }[];
}

const STATUS: Record<string, Look> = {
  pass: { label: 'Pass', icon: 'pass', tone: 'blue' },
  fail: { label: 'Fail', icon: 'warning', tone: 'orange' },
  unknown: { label: 'Check by hand', icon: 'question', tone: 'orange' },
  skip: { label: 'Doesn\'t apply', icon: 'circle-slash', tone: 'neutral' },
  confirmed: { label: 'Done by hand', icon: 'pass', tone: 'blue' },
};

export function setupModel(items: DoctorItem[], confirmed: Set<string>): SetupModel {
  const visible = items.filter((i) => !STEPS.find((s) => s.id === i.id)?.planned);
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
    // A fix that's a VSCode command runs from Do it; only terminal commands are shown to copy.
    return { id: i.id, title: i.title, look: STATUS[status] ?? STATUS.skip!, detail: i.detail, why: step?.why ?? '', fix: step?.fix?.vscode ? null : i.fix ?? null, actions };
  });
  const parts = (['machine', 'project'] as const).map((part) => {
    const steps = rows(part);
    return { part, label: part === 'machine' ? 'This machine' : 'This project', todo: steps.filter((s) => s.look.tone === 'orange').length, steps };
  }).filter((p) => p.steps.length);
  const all = parts.flatMap((p) => p.steps);
  return { kind: 'setup', done: all.filter((s) => s.look.tone !== 'orange').length, total: all.length, parts };
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
  project: string;
  actions: Action[];
  /** A command that takes one argument, such as a tracker's sign-in. */
  extra?: { command: string; label: string; icon: string; arg: string };
  /** A section of the page to open, such as Setup. */
  go?: { section: HomeSection; label: string };
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
  attention: AttentionItem[];
  stats: StatTile[];
  ready: { project: string; id: string; title: string; environment: string; action: Action }[];
  activity: (ActivityItem & { project: string })[];
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
}

export interface HomeInput {
  hub: HubLike;
  section: HomeSection;
  boards: (root: string) => BoardInput[];
  identity: (root: string) => IdentityCard | null;
  setup: { items: DoctorItem[]; confirmed: Set<string> };
}

const LOOK = (label: string, icon: string, tone: Tone): Look => ({ label, icon, tone });

/**
 * Everything on one page (D-029). The Overview gathers what needs a person, from every project: agents
 * waiting on a prompt, blocked tasks, missing sign-ins, setup still to do, and work waiting for review.
 */
export function homeModel(i: HomeInput): HomeModel {
  const { hub } = i;
  const tasks = tasksModel(hub, i.boards);
  const agents = agentsModel(hub);
  const worktrees = worktreesModel(hub);
  const environments = environmentsModel(hub, i.identity);
  const setup = setupModel(i.setup.items, i.setup.confirmed);

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
        attention.push({ key: `t:${p.root}:${r.id}`, look: r.agent ?? LOOK('Needs you', 'bell-dot', 'orange'), title: `${r.id} ${r.title}`, detail: `${p.name} · its agent is waiting on you`, project: p.name, actions: [...acts.filter((a) => a.command === 'acc.task.attach'), details] });
      } else if (r.display === 'blocked') {
        attention.push({ key: `t:${p.root}:${r.id}`, look: LOOK('Blocked', 'circle-slash', 'orange'), title: `${r.id} ${r.title}`, detail: `${p.name} · blocked`, project: p.name, actions: [details] });
      } else if (r.display === 'review') {
        attention.push({ key: `t:${p.root}:${r.id}`, look: LOOK('Waiting for your review', 'eye', 'blue'), title: `${r.id} ${r.title}`, detail: `${p.name} · done by its agent`, project: p.name, actions: [details] });
      } else if (r.display === 'ready') {
        const d = acts.find((a) => a.command === 'acc.task.dispatch');
        if (d) ready.push({ project: p.name, id: r.id, title: r.title, environment: r.environment, action: d });
      }
    }
    for (const b of i.boards(p.root)) {
      if (b.error && b.connect) attention.push({ key: `b:${p.root}:${b.index}`, look: LOOK('Not signed in', 'plug', 'orange'), title: b.title, detail: `${p.name} · ${b.error}`, project: p.name, actions: [], extra: { command: b.connect.command, label: b.connect.label, icon: 'plug', arg: b.connect.arg } });
    }
  }
  for (const s of hub.agents) {
    const look = agentLook(s);
    if (!look.needsYou || (s.id && linked.has(s.id))) continue;
    const key = s.sessionId ?? s.id ?? `${s.pid ?? ''}:${s.startedAt}`;
    attention.push({
      key: `a:${key}`, look: { label: look.label, icon: look.icon, tone: look.tone }, title: s.name ?? 'Agent session', detail: hub.projectFor(s.cwd)?.name ?? s.cwd, project: hub.projectFor(s.cwd)?.name ?? '',
      actions: s.id ? [{ command: 'acc.agent.attach', label: 'Attach', icon: 'terminal', ref: { session: key }, primary: true }] : [],
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
  const working = hub.agents.filter((s) => (s.kind === 'background' ? s.state === 'working' : s.status === 'busy')).length;
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

  const activity = hub.projects.flatMap((p) => (hub.history?.(p.root) ?? []).map((h) => ({ ...h, project: p.name })))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  const projects = hub.projects.map((p) => ({ name: p.name, root: p.root, branch: p.branch, account: p.config.github?.account ?? null, trackers: i.boards(p.root).map((b) => b.title) }));

  const people = attention.filter((a) => a.look.tone === 'orange').length;
  const needsAgents = agents.places.reduce((n, pl) => n + pl.agents.filter((a) => a.needsYou).length, 0);
  const sessions = agents.places.reduce((n, pl) => n + pl.agents.length, 0);
  const taskAttention = rows.filter((r) => r.display === 'needs-you' || r.display === 'blocked').length;
  const nav: NavItem[] = [
    { section: 'overview', label: 'Overview', icon: 'home', count: people || null, attention: people > 0, hint: people ? `${people} thing${people === 1 ? '' : 's'} need you` : 'Nothing needs you' },
    { section: 'tasks', label: 'Tasks', icon: 'project', count: taskAttention || rows.length || null, attention: taskAttention > 0, hint: taskAttention ? `${taskAttention} need you` : `${rows.length} task${rows.length === 1 ? '' : 's'}` },
    { section: 'agents', label: 'Agents', icon: 'hubot', count: needsAgents || sessions || null, attention: needsAgents > 0, hint: needsAgents ? `${needsAgents} waiting on you` : `${sessions} session${sessions === 1 ? '' : 's'}` },
    { section: 'worktrees', label: 'Worktrees', icon: 'git-branch', count: linkedTrees || null, attention: false, hint: `${linkedTrees} task checkout${linkedTrees === 1 ? '' : 's'}` },
    { section: 'environments', label: 'Environments', icon: 'server-environment', count: null, attention: hub.projects.some((p) => !!i.identity(p.root)?.problem), hint: 'Branches, orgs and your GitHub account' },
    { section: 'setup', label: 'Setup', icon: 'checklist', count: todo || null, attention: failing > 0, hint: todo ? `${todo} to do` : 'All done' },
  ];
  return { kind: 'home', section: i.section, nav, overview: { projects, attention, stats, ready, activity }, tasks, agents, worktrees, environments, setup };
}

export type Model = TasksModel | AgentsModel | WorktreesModel | EnvironmentsModel | SetupModel | TicketModel | HomeModel;

/** Messages the webview sends. Everything else is ignored. */
export const TICKET_ACTIONS = ['comment', 'status', 'assign', 'labels', 'track', 'refresh'] as const;
export type TicketAction = (typeof TICKET_ACTIONS)[number];

export type FromWebview =
  | { type: 'ready' } | { type: 'refresh' }
  | { type: 'run'; command: string; ref: Ref }
  | { type: 'toolbar'; command: string; project?: string; arg?: string }
  /** Open a ticket's page. tracker is null for a task acc alone keeps. */
  | { type: 'ticket'; project: string; tracker: number | null; key: string }
  /** A card dropped on another column of a tracker board. */
  | { type: 'move'; project: string; tracker: number; key: string; to: string }
  | { type: 'ticket-action'; action: TicketAction; text?: string }
  /** A link in a ticket. Only web links are opened. */
  | { type: 'open'; url: string }
  /** The page moved to another section, so reopening it comes back there. */
  | { type: 'nav'; section: HomeSection };

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
    case 'ticket-action': return (TICKET_ACTIONS as readonly string[]).includes(x.action as string) && (x.text === undefined || (typeof x.text === 'string' && x.text.length <= 65_536));
    case 'open': return short(x.url, 4096) && /^(https?:|mailto:)/i.test(x.url as string);
    case 'nav': return (HOME_SECTIONS as readonly string[]).includes(x.section as string);
    default: return false;
  }
}
