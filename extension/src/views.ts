import { basename, dirname, relative } from 'node:path';
import * as vscode from 'vscode';
import type { Environment } from '../../packages/core/src/config.ts';
import { DISPLAY } from '../../packages/core/src/ledger.ts';
import { STEPS } from '../../packages/core/src/onboarding/steps.ts';
import type { Hub, Project, WorktreeInfo } from './hub.ts';
import {
  agentLook, type AgentSession, type DoctorItem, ENV_ICON, groupTasks, isUnder, type TaskGroup, type TaskRow, type Tone, TONE_COLOR,
} from './logic.ts';

const icon = (id: string, tone: Tone = 'neutral') => new vscode.ThemeIcon(id, TONE_COLOR[tone] ? new vscode.ThemeColor(TONE_COLOR[tone]!) : undefined);
const md = (text: string) => {
  const m = new vscode.MarkdownString(text);
  m.supportThemeIcons = true;
  return m;
};

abstract class Provider<T> implements vscode.TreeDataProvider<T> {
  protected readonly emitter = new vscode.EventEmitter<T | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  refresh(): void {
    this.emitter.fire();
  }
  abstract getTreeItem(e: T): vscode.TreeItem;
  abstract getChildren(e?: T): T[];
}

// ---------------------------------------------------------------- Tasks

export type TaskNode =
  | { kind: 'project'; project: Project }
  | { kind: 'group'; project: Project; group: TaskGroup; tasks: TaskRow[] }
  | { kind: 'task'; project: Project; task: TaskRow };

export class TasksProvider extends Provider<TaskNode> {
  private readonly hub: Hub;
  constructor(hub: Hub) {
    super();
    this.hub = hub;
  }

  getChildren(e?: TaskNode): TaskNode[] {
    const groups = (project: Project): TaskNode[] =>
      groupTasks(this.hub.taskRows(project.root)).map((g) => ({ kind: 'group', project, group: g.group, tasks: g.tasks }));
    if (!e) {
      const withTasks = this.hub.projects.filter((p) => this.hub.taskRows(p.root).length);
      if (this.hub.projects.length === 1) return withTasks.length ? groups(this.hub.projects[0]!) : [];
      return withTasks.map((project) => ({ kind: 'project', project }));
    }
    if (e.kind === 'project') return groups(e.project);
    if (e.kind === 'group') return e.tasks.map((task) => ({ kind: 'task', project: e.project, task }));
    return [];
  }

  getTreeItem(e: TaskNode): vscode.TreeItem {
    if (e.kind === 'project') {
      const item = new vscode.TreeItem(e.project.name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = icon('repo');
      item.description = `${this.hub.taskRows(e.project.root).length} tasks`;
      return item;
    }
    if (e.kind === 'group') {
      const d = DISPLAY[e.group];
      const open = e.group !== 'done';
      const item = new vscode.TreeItem(`${d.label} (${e.tasks.length})`, open ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = icon(d.icon, d.tone);
      item.id = `${e.project.root}#${e.group}`;
      return item;
    }
    const t = e.task;
    const d = DISPLAY[t.display];
    const item = new vscode.TreeItem(`${t.id}  ${t.title}`, vscode.TreeItemCollapsibleState.None);
    item.id = `${e.project.root}#task#${t.id}`;
    item.iconPath = icon(d.icon, d.tone);
    item.description = [d.label, t.environment, t.deps.length ? `waiting on ${t.deps.join(', ')}` : ''].filter(Boolean).join(' · ');
    item.tooltip = md([`**${t.id}**: ${t.title}`, '', `${d.label} · environment \`${t.environment}\``, t.deps.length ? `Waiting on ${t.deps.join(', ')}` : '', t.source.url ? `[Open the ticket](${t.source.url})` : ''].filter(Boolean).join('\n\n'));
    item.contextValue = ['task', `task-${t.state}`, t.source.url ? 'hasUrl' : ''].filter(Boolean).join(' ');
    item.command = { command: 'acc.task.show', title: 'Show task', arguments: [e] };
    return item;
  }
}

// ---------------------------------------------------------------- Agents

export type AgentNode =
  | { kind: 'place'; label: string; root: string | null; sessions: AgentSession[] }
  | { kind: 'agent'; session: AgentSession; project: Project | undefined };

export class AgentsProvider extends Provider<AgentNode> {
  private readonly hub: Hub;
  constructor(hub: Hub) {
    super();
    this.hub = hub;
  }

  getChildren(e?: AgentNode): AgentNode[] {
    const sessions = [...this.hub.agents].sort((a, b) => Number(agentLook(b).needsYou) - Number(agentLook(a).needsYou) || b.startedAt - a.startedAt);
    if (!e) {
      if (!sessions.length) return [];
      const places: AgentNode[] = this.hub.projects.map((p) => ({ kind: 'place', label: p.name, root: p.root, sessions: sessions.filter((s) => this.hub.projectFor(s.cwd) === p) }));
      const elsewhere = sessions.filter((s) => !this.hub.projectFor(s.cwd));
      if (elsewhere.length) places.push({ kind: 'place', label: 'Elsewhere on this machine', root: null, sessions: elsewhere });
      return places.filter((p) => p.kind === 'place' && (p.sessions.length || p.root));
    }
    if (e.kind === 'place') return e.sessions.map((session) => ({ kind: 'agent', session, project: this.hub.projectFor(session.cwd) }));
    return [];
  }

  getTreeItem(e: AgentNode): vscode.TreeItem {
    if (e.kind === 'place') {
      const needs = e.sessions.filter((s) => agentLook(s).needsYou).length;
      const item = new vscode.TreeItem(e.label, e.root ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = icon(e.root ? 'repo' : 'device-desktop');
      item.description = e.sessions.length ? `${e.sessions.length} session${e.sessions.length === 1 ? '' : 's'}${needs ? ` · ${needs} need${needs === 1 ? 's' : ''} you` : ''}` : 'no sessions';
      item.contextValue = e.root ? 'agentPlace' : 'agentElsewhere';
      return item;
    }
    const s = e.session;
    const look = agentLook(s);
    const where = e.project ? (isUnder(s.cwd, e.project.root) ? relative(e.project.root, s.cwd) || 'main checkout' : basename(s.cwd)) : s.cwd.replace(process.env.HOME ?? '', '~');
    const item = new vscode.TreeItem(s.name ?? s.sessionId?.slice(0, 8) ?? 'session', vscode.TreeItemCollapsibleState.None);
    item.id = `agent#${s.sessionId ?? s.id ?? s.pid ?? s.startedAt}`;
    item.iconPath = icon(look.icon, look.tone);
    item.description = `${look.label} · ${s.kind} · ${where}`;
    item.tooltip = md([`**${s.name ?? 'Session'}**: ${look.label}`, `Kind: ${s.kind}`, `Folder: \`${s.cwd}\``, s.sessionId ? `Session: \`${s.sessionId}\`` : '', `Started: ${new Date(s.startedAt).toLocaleString()}`].filter(Boolean).join('\n\n'));
    item.contextValue = ['agent', s.kind === 'background' && s.id ? 'agentBackground' : 'agentInteractive'].join(' ');
    return item;
  }
}

// ---------------------------------------------------------------- Worktrees

export type WorktreeNode = { kind: 'project'; project: Project } | { kind: 'worktree'; project: Project; worktree: WorktreeInfo };

export class WorktreesProvider extends Provider<WorktreeNode> {
  private readonly hub: Hub;
  constructor(hub: Hub) {
    super();
    this.hub = hub;
  }

  getChildren(e?: WorktreeNode): WorktreeNode[] {
    if (!e) {
      if (this.hub.projects.length === 1) return this.hub.projects[0]!.worktrees.map((worktree) => ({ kind: 'worktree', project: this.hub.projects[0]!, worktree }));
      return this.hub.projects.map((project) => ({ kind: 'project', project }));
    }
    if (e.kind === 'project') return e.project.worktrees.map((worktree) => ({ kind: 'worktree', project: e.project, worktree }));
    return [];
  }

  getTreeItem(e: WorktreeNode): vscode.TreeItem {
    if (e.kind === 'project') {
      const item = new vscode.TreeItem(e.project.name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = icon('repo');
      item.description = `${e.project.worktrees.length} checkout${e.project.worktrees.length === 1 ? '' : 's'}`;
      return item;
    }
    const w = e.worktree;
    const dirty = w.changed > 0;
    const label = w.branch ?? `detached at ${w.head.slice(0, 7)}`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.id = `worktree#${w.path}`;
    item.iconPath = icon(w.main ? 'repo' : 'git-branch', dirty ? 'orange' : 'neutral');
    const place = w.main ? 'main checkout' : relative(dirname(e.project.root), w.path);
    const state = w.prunable ? 'missing on disk' : w.changed < 0 ? 'status unknown' : dirty ? `${w.changed} changed` : 'clean';
    item.description = `${place} · ${state}${w.locked ? ' · locked' : ''}`;
    item.tooltip = md([`**${label}**`, `\`${w.path}\``, `HEAD ${w.head.slice(0, 12)}`, state].join('\n\n'));
    item.contextValue = ['worktree', w.main ? 'worktreeMain' : 'worktreeLinked'].join(' ');
    return item;
  }
}

// ---------------------------------------------------------------- Environments

export type EnvNode = { kind: 'project'; project: Project } | { kind: 'env'; project: Project; env: Environment };

export class EnvironmentsProvider extends Provider<EnvNode> {
  private readonly hub: Hub;
  constructor(hub: Hub) {
    super();
    this.hub = hub;
  }

  getChildren(e?: EnvNode): EnvNode[] {
    const envs = (project: Project): EnvNode[] => project.config.environments.map((env) => ({ kind: 'env', project, env }));
    if (!e) return this.hub.projects.length === 1 ? envs(this.hub.projects[0]!) : this.hub.projects.map((project) => ({ kind: 'project', project }));
    return e.kind === 'project' ? envs(e.project) : [];
  }

  getTreeItem(e: EnvNode): vscode.TreeItem {
    if (e.kind === 'project') {
      const item = new vscode.TreeItem(e.project.name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = icon('repo');
      item.description = [e.project.config.profile, e.project.config.github ? `${e.project.config.github.repo} as ${e.project.config.github.account}` : ''].filter(Boolean).join(' · ');
      return item;
    }
    const env = e.env;
    const current = e.project.branch === env.branch;
    const item = new vscode.TreeItem(env.name, vscode.TreeItemCollapsibleState.None);
    item.id = `env#${e.project.root}#${env.branch}`;
    item.iconPath = icon(ENV_ICON[env.type] ?? 'git-branch', current ? 'blue' : 'neutral');
    item.description = [env.branch, env.org ?? (env.type === 'none' ? '' : 'no org alias'), env.default ? 'default' : '', env.protected ? 'protected' : '', current ? 'checked out' : ''].filter(Boolean).join(' · ');
    item.tooltip = md([
      `**${env.name}**: ${env.type === 'none' ? 'branch' : env.type}`,
      `Branch \`${env.branch}\`${env.org ? ` · org \`${env.org}\`` : ''}`,
      env.protected ? 'Protected: changes arrive only by promotion.' : '',
      env.promotesTo.length ? `Promotes to: ${env.promotesTo.map((b) => `\`${b}\``).join(', ')}` : '',
    ].filter(Boolean).join('\n\n'));
    item.contextValue = ['env', env.org ? 'envWithOrg' : '', e.project.config.github ? 'envOnGithub' : '', current ? '' : 'envNotCurrent'].filter(Boolean).join(' ');
    return item;
  }
}

// ---------------------------------------------------------------- Setup

export type SetupNode = { kind: 'part'; part: 'machine' | 'project'; items: DoctorItem[] } | { kind: 'step'; item: DoctorItem };

const STATUS_LOOK: Record<string, { label: string; icon: string; tone: Tone }> = {
  pass: { label: '✓ pass', icon: 'pass', tone: 'blue' },
  fail: { label: '✗ fail', icon: 'warning', tone: 'orange' },
  unknown: { label: '? check by hand', icon: 'question', tone: 'orange' },
  skip: { label: '– skip', icon: 'circle-slash', tone: 'neutral' },
};

export class SetupProvider extends Provider<SetupNode> {
  private items: DoctorItem[] = [];
  private confirmed = new Set<string>();

  set(items: DoctorItem[], confirmed: Set<string>): void {
    this.items = items;
    this.confirmed = confirmed;
    this.refresh();
  }

  getChildren(e?: SetupNode): SetupNode[] {
    if (!e) {
      return (['machine', 'project'] as const)
        .map((part): SetupNode => ({ kind: 'part', part, items: this.items.filter((i) => i.part === part && !STEPS.find((s) => s.id === i.id)?.planned) }))
        .filter((n) => n.kind === 'part' && n.items.length);
    }
    return e.kind === 'part' ? e.items.map((item) => ({ kind: 'step', item })) : [];
  }

  getTreeItem(e: SetupNode): vscode.TreeItem {
    if (e.kind === 'part') {
      const todo = e.items.filter((i) => (i.status === 'fail' || i.status === 'unknown') && !this.confirmed.has(i.id)).length;
      const item = new vscode.TreeItem(e.part === 'machine' ? 'This machine' : 'This project', todo ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = icon(e.part === 'machine' ? 'device-desktop' : 'repo', todo ? 'orange' : 'neutral');
      item.description = todo ? `${todo} to do` : 'all done';
      return item;
    }
    const it = e.item;
    const status = this.confirmed.has(it.id) && it.status !== 'pass' ? 'pass' : it.status;
    const look = STATUS_LOOK[status] ?? STATUS_LOOK.skip!;
    const step = STEPS.find((s) => s.id === it.id);
    const item = new vscode.TreeItem(it.title, vscode.TreeItemCollapsibleState.None);
    item.id = `setup#${it.id}`;
    item.iconPath = icon(look.icon, look.tone);
    item.description = `${look.label} · ${it.id}`;
    item.tooltip = md([`**${it.title}**: ${look.label}`, it.detail, step ? `*Why:* ${step.why}` : '', it.fix ? `Fix: \`${it.fix}\`` : ''].filter(Boolean).join('\n\n'));
    item.contextValue = ['step', step?.fix?.command || step?.fix?.fromCheck ? 'stepFixable' : '', step?.fix?.setupPath ? 'stepSetup' : '', step?.fix?.docs ? 'stepDocs' : ''].filter(Boolean).join(' ');
    item.command = { command: 'acc.step.check', title: 'Check', arguments: [it.id] };
    return item;
  }
}
