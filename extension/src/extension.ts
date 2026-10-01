import { delimiter, dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { Hub } from './hub.ts';
import { COMMANDS, WALKTHROUGHS } from './logic.ts';
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
  new Sidebar(hub, accRunner(accScript), setup.log).register(reg);

  hub.onDidChange((part) => {
    if (part === 'projects') { tasks.refresh(); envs.refresh(); worktrees.refresh(); agents.refresh(); }
    if (part === 'tasks') tasks.refresh();
    if (part === 'agents') { agents.refresh(); views.agents.badge = agentBadge(hub); }
    if (part === 'worktrees') { worktrees.refresh(); envs.refresh(); agents.refresh(); }
  });
  setup.onDidChange(() => steps.set(setup.results(), setup.allConfirmed()));

  // Poll only what's on screen, so VSCode stays light (the author's machine stutters under load).
  const follow = (view: vscode.TreeView<unknown>, key: string, everyMs: number, fn: () => Promise<void>) => {
    hub.poll(key, everyMs, fn, view.visible);
    context.subscriptions.push(view.onDidChangeVisibility((e) => hub.poll(key, everyMs, fn, e.visible)));
  };
  follow(views.tasks, 'tasks', 3_000, () => hub.loadTasks());
  follow(views.agents, 'agents', 5_000, () => hub.loadAgents());
  follow(views.worktrees, 'worktrees', 15_000, () => hub.loadWorktrees());
  follow(views.environments, 'environments', 15_000, () => hub.loadWorktrees());

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
