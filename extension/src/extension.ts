import { delimiter, dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { Hub } from './hub.ts';
import { COMMANDS, isWebviewMenuContext, WALKTHROUGHS } from './logic.ts';
import { type Ref, VIEW_KINDS, type ViewKind } from './model.ts';
import { Panels } from './panels.ts';
import { accRunner } from './run.ts';
import { openWalkthrough, Setup } from './setup.ts';
import { Sidebar } from './sidebar.ts';
import { AgentsProvider, EnvironmentsProvider, SetupProvider, TasksProvider, WorktreesProvider } from './views.ts';

/** Step commands get a step id from walkthrough buttons, or a Setup view item from menus. */
const stepId = (a: unknown): string => (typeof a === 'string' ? a : (a as { item?: { id: string } })?.item?.id ?? '');

export function activate(context: vscode.ExtensionContext): void {
  const setup = new Setup(context);
  const hub = new Hub();
  context.subscriptions.push(setup, hub);

  // Every VSCode terminal gets the acc command (D-012), with no separate install.
  const accScript = context.asAbsolutePath(join('dist', 'bin', 'acc'));
  context.environmentVariableCollection.description = 'Adds the acc command from Agent Command Center.';
  context.environmentVariableCollection.prepend('PATH', dirname(accScript) + delimiter);

  const reg = (id: string, fn: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg(COMMANDS.check, (a: unknown) => setup.check(stepId(a)));
  reg(COMMANDS.fix, (a: unknown) => setup.fix(stepId(a)));
  reg(COMMANDS.openSetup, (a: unknown) => setup.openSetup(stepId(a)));
  reg(COMMANDS.confirm, (a: unknown) => setup.confirm(stepId(a)));
  reg(COMMANDS.guide, (a?: unknown) => setup.openGuide(a ? stepId(a) || undefined : undefined));
  reg(COMMANDS.doctor, () => setup.doctorInTerminal());
  reg(COMMANDS.machine, () => openWalkthrough(WALKTHROUGHS.machine.id));
  reg(COMMANDS.project, () => openWalkthrough(WALKTHROUGHS.project.id));
  reg(COMMANDS.chooseFolder, () => setup.chooseFolder());
  reg('acc.setup.refresh', () => setup.refresh('refresh clicked'));

  // ------------------------------------------------------------ the sidebar
  const tasks = new TasksProvider(hub);
  const agents = new AgentsProvider(hub);
  const worktrees = new WorktreesProvider(hub);
  const envs = new EnvironmentsProvider(hub);
  const steps = new SetupProvider();
  const views = {
    tasks: vscode.window.createTreeView('acc.tasks', { treeDataProvider: tasks, showCollapseAll: true }),
    agents: vscode.window.createTreeView('acc.agents', { treeDataProvider: agents }),
    worktrees: vscode.window.createTreeView('acc.worktrees', { treeDataProvider: worktrees }),
    environments: vscode.window.createTreeView('acc.environments', { treeDataProvider: envs }),
    setup: vscode.window.createTreeView('acc.setup', { treeDataProvider: steps }),
  };
  context.subscriptions.push(...Object.values(views));


  // Poll only what's on screen, sidebar or tab, so VSCode stays light (the author's machine stutters under load).
  const POLLS: Record<string, { everyMs: number; fn: () => Promise<void> }> = {
    tasks: { everyMs: 3_000, fn: () => hub.loadTasks() },
    agents: { everyMs: 5_000, fn: () => hub.loadAgents() },
    worktrees: { everyMs: 15_000, fn: () => hub.loadWorktrees() },
  };
  const pollKey: Record<ViewKind, string | null> = { tasks: 'tasks', agents: 'agents', worktrees: 'worktrees', environments: 'worktrees', setup: null };
  const watching = new Map<string, Set<string>>();
  const want = (kind: ViewKind, source: 'tree' | 'tab', on: boolean) => {
    const key = pollKey[kind];
    if (!key) return;
    const who = watching.get(key) ?? new Set<string>();
    const id = `${source}:${kind}`;
    const before = who.size > 0;
    if (on) who.add(id); else who.delete(id);
    watching.set(key, who);
    if (before !== who.size > 0) hub.poll(key, POLLS[key]!.everyMs, POLLS[key]!.fn, who.size > 0);
  };
  for (const kind of VIEW_KINDS) {
    const view = views[kind];
    want(kind, 'tree', view.visible);
    context.subscriptions.push(view.onDidChangeVisibility((e) => want(kind, 'tree', e.visible)));
  }

  // ------------------------------------------------------------ the same views as editor tabs
  /** Turns a tab's Ref back into the sidebar's node, so every command works the same from either place. */
  const nodeFor = (ref: Ref): unknown => {
    const project = ref.project ? hub.project(ref.project) : undefined;
    if (ref.step) return ref.step;
    if (ref.task) {
      const task = project && hub.taskRows(project.root).find((t) => t.id === ref.task);
      return task ? { kind: 'task', project, task } : undefined;
    }
    if (ref.session) {
      const session = hub.agents.find((a) => (a.sessionId ?? a.id ?? `${a.pid ?? ''}:${a.startedAt}`) === ref.session);
      return session ? { kind: 'agent', session, project: hub.projectFor(session.cwd) } : undefined;
    }
    if (ref.worktree) {
      const worktree = project?.worktrees.find((w) => w.path === ref.worktree);
      return worktree ? { kind: 'worktree', project, worktree } : undefined;
    }
    if (ref.env) {
      const env = project?.config.environments.find((e) => e.branch === ref.env);
      return env ? { kind: 'env', project, env } : undefined;
    }
    return undefined;
  };
  const resolve = (command: string, ref: Ref): unknown => {
    const arg = nodeFor(ref);
    return arg === undefined ? undefined : vscode.commands.executeCommand(command, arg);
  };
  // Commands run from a tab's native context menu get the row's data-vscode-context; turn it into the node.
  const regNode = (id: string, fn: (...args: any[]) => unknown) => reg(id, (a: unknown, ...rest: unknown[]) => fn(isWebviewMenuContext(a) ? nodeFor(a.accRef as Ref) : a, ...rest));
  new Sidebar(hub, accRunner(accScript), setup.log).register(regNode);
  const panels = new Panels(context, hub, setup, resolve, (kind, visible) => want(kind, 'tab', visible));
  context.subscriptions.push(panels);
  for (const kind of VIEW_KINDS) reg(`acc.open.${kind}`, () => panels.show(kind));

  hub.onDidChange((part) => {
    if (part === 'projects') { tasks.refresh(); envs.refresh(); worktrees.refresh(); agents.refresh(); panels.post(); }
    if (part === 'tasks') { tasks.refresh(); panels.post('tasks'); }
    if (part === 'agents') { agents.refresh(); views.agents.badge = agentBadge(hub); panels.post('agents'); }
    if (part === 'worktrees') { worktrees.refresh(); envs.refresh(); agents.refresh(); panels.post('worktrees'); panels.post('environments'); panels.post('agents'); }
  });
  setup.onDidChange(() => { steps.set(setup.results(), setup.allConfirmed()); panels.post('setup'); });

  context.subscriptions.push(
    vscode.window.onDidEndTerminalShellExecution((e) => setup.onShellEnd(e)),
    vscode.window.onDidCloseTerminal((t) => setup.onTerminalClosed(t)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { setup.refreshSoon('folders changed', 200); void hub.loadProjects(); }),
    vscode.window.onDidChangeActiveTextEditor(() => setup.renderStatusIfFolderChanged()),
  );
  const configWatch = vscode.workspace.createFileSystemWatcher('**/.acc/config.json');
  const reload = () => void hub.loadProjects();
  configWatch.onDidChange(reload);
  configWatch.onDidCreate(reload);
  configWatch.onDidDelete(reload);
  context.subscriptions.push(configWatch);
  setup.watch();

  void hub.loadProjects().then(() => hub.loadAgents());
  void setup.refresh('startup', { reuseMachine: true }).then(() => setup.maybeOpenWalkthroughs());
}

/** The Agents view's activity-bar badge: sessions that need a person. */
function agentBadge(hub: Hub): vscode.ViewBadge | undefined {
  const n = hub.agents.filter((s) => s.state === 'blocked' || s.status === 'waiting' || s.state === 'failed').length;
  return n ? { value: n, tooltip: `${n} agent${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} you` } : undefined;
}

export function deactivate(): void {}
