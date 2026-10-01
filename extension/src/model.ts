/**
 * What each editor tab shows, as plain data. Built here from the hub's data, posted to the webview,
 * and rendered there with text only (no HTML from data). No vscode import, so it's testable.
 */
import { DISPLAY } from '../../packages/core/src/ledger.ts';
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
}

// ---------------------------------------------------------------- tasks: the board

export interface Card {
  id: string;
  title: string;
  environment: string;
  waitingOn: string[];
  url: string | null;
  actions: Action[];
}

export interface Column extends Look {
  group: string;
  cards: Card[];
}

export interface TasksModel {
  kind: 'tasks';
  projects: { name: string; root: string; github: boolean; columns: Column[]; total: number }[];
}

export function tasksModel(hub: HubLike): TasksModel {
  return {
    kind: 'tasks',
    projects: hub.projects.map((p) => {
      const rows = hub.taskRows(p.root);
      const byGroup = new Map(groupTasks(rows).map((g) => [g.group, g.tasks]));
      const columns: Column[] = TASK_GROUPS.map((group) => {
        const d = DISPLAY[group];
        return {
          group, label: d.label, icon: d.icon, tone: d.tone,
          cards: (byGroup.get(group) ?? []).map((t) => {
            const ref: Ref = { project: p.root, task: t.id };
            const actions: Action[] = [{ command: 'acc.task.move', label: 'Move', icon: 'arrow-swap', ref, primary: true }];
            if (t.state === 'blocked') actions.push({ command: 'acc.task.unblock', label: 'Unblock', icon: 'debug-restart', ref });
            else if (t.state !== 'done') actions.push({ command: 'acc.task.block', label: 'Block', icon: 'circle-slash', ref });
            if (t.source.url) actions.push({ command: 'acc.task.openTicket', label: 'Ticket', icon: 'link-external', ref });
            actions.push({ command: 'acc.task.show', label: 'Details', icon: 'note', ref });
            return { id: t.id, title: t.title, environment: t.environment, waitingOn: t.deps, url: t.source.url, actions };
          }),
        };
      });
      return { name: p.name, root: p.root, github: !!p.config.github, columns, total: rows.length };
    }),
  };
}

// ---------------------------------------------------------------- agents

export interface AgentRow {
  key: string;
  name: string;
  look: Look;
  needsYou: boolean;
  kind: string;
  where: string;
  startedAt: number;
  actions: Action[];
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
    const ref: Ref = { session: key };
    const where = p ? (isUnder(s.cwd, p.root) ? s.cwd.slice(p.root.length + 1) || 'main checkout' : s.cwd.split('/').pop() ?? s.cwd) : s.cwd;
    const actions: Action[] = s.id
      ? [{ command: 'acc.agent.attach', label: 'Attach', icon: 'terminal', ref, primary: true }, { command: 'acc.agent.logs', label: 'Logs', icon: 'output', ref }, { command: 'acc.agent.stop', label: 'Stop', icon: 'debug-stop', ref, danger: true }]
      : [];
    actions.push({ command: 'acc.agent.openFolder', label: 'Folder', icon: 'folder-opened', ref });
    return { key, name: s.name ?? s.sessionId?.slice(0, 8) ?? 'session', look: { label: look.label, icon: look.icon, tone: look.tone }, needsYou: look.needsYou, kind: s.kind, where, startedAt: s.startedAt, actions };
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
  actions: Action[];
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
        const ref: Ref = { project: p.root, worktree: w.path };
        const state: Look = w.prunable ? { label: 'Missing on disk', icon: 'warning', tone: 'orange' }
          : w.changed < 0 ? { label: 'Status unknown', icon: 'question', tone: 'orange' }
            : w.changed > 0 ? { label: `${w.changed} changed`, icon: 'diff-modified', tone: 'orange' }
              : { label: 'Clean', icon: 'check', tone: 'blue' };
        const actions: Action[] = [
          { command: 'acc.worktree.open', label: 'Open', icon: 'empty-window', ref, primary: true },
          { command: 'acc.worktree.terminal', label: 'Terminal', icon: 'terminal', ref },
          { command: 'acc.worktree.reveal', label: 'Finder', icon: 'folder-opened', ref },
        ];
        if (!w.main) actions.push({ command: 'acc.worktree.remove', label: 'Remove', icon: 'trash', ref, danger: true });
        const place = w.main ? 'Main checkout' : w.path.replace(p.root.replace(/\/[^/]+$/, ''), '…');
        return { path: w.path, branch: w.branch ?? `detached at ${w.head.slice(0, 7)}`, place: w.locked ? `${place} · locked` : place, state, main: w.main, actions };
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
  projects: { name: string; root: string; github: string | null; envs: EnvCard[]; paths: string[][] }[];
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

export function environmentsModel(hub: HubLike): EnvironmentsModel {
  return {
    kind: 'environments',
    projects: hub.projects.map((p) => ({
      name: p.name, root: p.root,
      github: p.config.github ? `${p.config.github.repo} as ${p.config.github.account}` : null,
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
    if (open && (step?.fix?.command || step?.fix?.fromCheck)) actions.unshift({ command: 'acc.step.fix', label: 'Do it', icon: 'wrench', ref, primary: true });
    if (open && step?.fix?.setupPath) actions.push({ command: 'acc.step.openSetup', label: 'Open in Salesforce', icon: 'globe', ref });
    if (status === 'unknown') actions.push({ command: 'acc.step.confirm', label: 'I\'ve done this', icon: 'check', ref });
    if (step?.fix?.docs) actions.push({ command: 'acc.openGuide', label: 'Guide', icon: 'book', ref });
    return { id: i.id, title: i.title, look: STATUS[status] ?? STATUS.skip!, detail: i.detail, why: step?.why ?? '', fix: i.fix ?? null, actions };
  });
  const parts = (['machine', 'project'] as const).map((part) => {
    const steps = rows(part);
    return { part, label: part === 'machine' ? 'This machine' : 'This project', todo: steps.filter((s) => s.look.tone === 'orange').length, steps };
  }).filter((p) => p.steps.length);
  const all = parts.flatMap((p) => p.steps);
  return { kind: 'setup', done: all.filter((s) => s.look.tone !== 'orange').length, total: all.length, parts };
}

export type Model = TasksModel | AgentsModel | WorktreesModel | EnvironmentsModel | SetupModel;

/** Messages the webview sends. Everything else is ignored. */
export type FromWebview = { type: 'ready' } | { type: 'refresh' } | { type: 'run'; command: string; ref: Ref } | { type: 'toolbar'; command: string; project?: string };

export function isFromWebview(m: unknown): m is FromWebview {
  const x = m as { type?: unknown; command?: unknown };
  if (!x || typeof x.type !== 'string') return false;
  if (x.type === 'ready' || x.type === 'refresh') return true;
  return (x.type === 'run' || x.type === 'toolbar') && typeof x.command === 'string' && x.command.startsWith('acc.');
}
