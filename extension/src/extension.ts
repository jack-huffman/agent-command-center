import { delimiter, dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { Hub } from './hub.ts';
import type { Answer } from '../../packages/core/src/questions.ts';
import { AgentPages } from './activity.ts';
import { COMMANDS, isWebviewMenuContext, WALKTHROUGHS } from './logic.ts';
import { type NavItem, needsYouCount, type Ref, sessionKey, VIEW_KINDS, type ViewKind } from './model.ts';
import { Panels } from './panels.ts';
import { Questions, sessionSettings } from './questions.ts';
import { Runs } from './runs.ts';
import { accRunner } from './run.ts';
import { openWalkthrough, Setup } from './setup.ts';
import { Sidebar } from './sidebar.ts';
import { RepoIdentity } from './identity.ts';
import { TicketPanels } from './ticket.ts';
import { Trackers } from './trackers.ts';

/** Step commands get a step id from walkthrough buttons, or a Setup view item from menus. */
const stepId = (a: unknown): string => (typeof a === 'string' ? a : (a as { item?: { id: string } })?.item?.id ?? '');

export function activate(context: vscode.ExtensionContext): void {
  const setup = new Setup(context);
  const hub = new Hub();
  const trackers = new Trackers(context.secrets, hub, setup.log);
  context.subscriptions.push(setup, hub, trackers);

  // Every VSCode terminal gets the acc command (D-012), with no separate install.
  const accScript = context.asAbsolutePath(join('dist', 'bin', 'acc'));
  context.environmentVariableCollection.description = 'Adds the acc command from Agent Command Center.';
  context.environmentVariableCollection.prepend('PATH', dirname(accScript) + delimiter);

  const reg = (id: string, fn: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // Commands acc runs for you show their output in the page (D-030). Only a command that needs a
  // keyboard of its own still opens a terminal.
  const terminals = new Map<string, vscode.Terminal>();
  const inTerminal = (command: string, cwd: string) => {
    let t = terminals.get(cwd);
    if (!t || t.exitStatus) { t = vscode.window.createTerminal({ name: 'acc', cwd, iconPath: new vscode.ThemeIcon('terminal') }); terminals.set(cwd, t); }
    t.show();
    t.sendText(command, true);
  };
  const runs = new Runs(setup.log, inTerminal, dirname(accScript));
  setup.useRuns(runs);
  context.subscriptions.push(runs);
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
  const identity = new RepoIdentity(hub, accRunner(accScript), () => setup.githubSignIn(null), () => {
    for (const id of ['A2.gh-login', 'B2.account', 'B2.credentials']) void setup.recheck(id);
  });
  context.subscriptions.push(identity);
  reg('acc.github.signIn', async () => { await setup.githubSignIn(); await identity.refresh(undefined, true); });
  reg('acc.github.switch', (arg?: unknown) => identity.switch(arg));
  reg('acc.sf.login', () => setup.sfLogin());

  // Poll only while the page is on screen, so VSCode stays light (the author's machine stutters under load).
  const POLLS: Record<string, { everyMs: number; fn: () => Promise<void> }> = {
    tasks: { everyMs: 3_000, fn: () => hub.loadTasks() },
    agents: { everyMs: 5_000, fn: () => hub.loadAgents() },
    worktrees: { everyMs: 15_000, fn: () => hub.loadWorktrees() },
    // Tracker boards are network calls, so they refresh slowly, and at once after any move.
    boards: { everyMs: 120_000, fn: () => trackers.loadBoards() },
  };
  const pagePolls = (on: boolean) => { for (const [key, p] of Object.entries(POLLS)) hub.poll(key, p.everyMs, p.fn, on); };

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
  const tickets = new TicketPanels(context, hub, trackers, resolve, accRunner(accScript));

  // Agents' questions and activity (D-030). Answering "in the terminal" hands the question back to
  // Claude Code's own prompt, and attaches to it.
  let questions: Questions | null = null;
  const answer = (id: string, a: Answer) => {
    const q = hub.questions.find((x) => x.id === id);
    if (!questions?.answer(id, a) || a.decision !== 'terminal' || !q) return;
    const s = hub.agents.find((x) => x.sessionId === q.sessionId);
    if (s) setTimeout(() => void resolve('acc.agent.attach', { session: sessionKey(s) }), 400);
  };
  const pages = new AgentPages(context, hub, resolve, answer);
  context.subscriptions.push(pages);
  new Sidebar(hub, accRunner(accScript), setup.log, (root, key) => tickets.show(root, undefined, key), {
    run: (command, cwd, label) => void runs.start(command, { cwd, label }),
    watch: (key, ended) => pages.open(key, ended),
    sessionSettings: sessionSettings(accScript),
  }).register(regNode);
  const panels = new Panels(context, hub, setup, resolve, (visible) => pagePolls(visible), {
    boards: (root) => trackers.boardStates(root),
    identity: (root) => identity.card(root),
    openTicket: (root, tracker, key) => tickets.show(root, tracker, key),
    move: async (root, tracker, key, to) => {
      const p = hub.project(root);
      if (!p) return;
      try {
        if (await trackers.move(p, tracker, key, to)) await trackers.loadBoards(root);
        else panels.post(); // put the card back where it was
      } catch (e) {
        void vscode.window.showErrorMessage(`Couldn't move ${key}: ${(e as Error).message}`);
        panels.post();
      }
    },
    answer,
    runs: () => runs.views(),
    runInput: (id, text) => void runs.input(id, text),
    runControl: (id, action) => runs.control(id, action),
  });
  context.subscriptions.push(panels, tickets);
  questions = new Questions(hub, setup.log,
    (card) => { if (!pages.open(card.session)) panels.show('overview'); },
    (card) => (panels.visible() && panels.current() === 'overview') || pages.showing(card.sessionId));
  context.subscriptions.push(questions);

  runs.onDidChange(({ structural }) => (structural ? changed() : panels.postRuns()));
  const showRun = (id?: string) => { panels.show(); setTimeout(() => panels.postRuns(id ?? runs.views()[0]?.id), 300); };
  reg('acc.runs.show', () => showRun());
  runs.onDidEvent(({ kind, run }) => {
    if (panels.visible()) { if (kind !== 'end') panels.postRuns(run.id); return; }
    // Off screen, a run speaks up only when it needs you or went wrong.
    if (kind === 'ask') void vscode.window.showWarningMessage(`${run.label} is asking: ${run.prompt?.text ?? 'for an answer'}`, 'Answer').then((p) => p && showRun(run.id));
    if (kind === 'end' && run.code !== 0 && !run.stopped) void vscode.window.showWarningMessage(`${run.label} failed (exit ${run.code ?? '?'}).`, 'Show output').then((p) => p && showRun(run.id));
  });
  // ------------------------------------------------------------ the launcher (D-029)
  // The activity bar icon opens the page. Its one view lists the sections, for anyone who keeps the sidebar.
  const launcher = new HomeLauncher(() => panels.model().nav);
  const launcherView = vscode.window.createTreeView('acc.home', { treeDataProvider: launcher });
  context.subscriptions.push(launcherView, launcher);
  context.subscriptions.push(launcherView.onDidChangeVisibility((e) => {
    if (!e.visible) return;
    panels.show();
    if (vscode.workspace.getConfiguration('agentCommandCenter').get<boolean>('openFromActivityBar', true)) void vscode.commands.executeCommand('workbench.action.closeSidebar');
  }));
  /** Everything the page shows changed: redraw it, and the launcher's counts and badge. */
  const changed = () => {
    panels.post();
    launcher.refresh();
    const n = needsYouCount(panels.model().overview);
    launcherView.badge = n ? { value: n, tooltip: `${n} thing${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} you` } : undefined;
  };
  trackers.onDidChange(changed);
  identity.onDidChange(changed);
  reg('acc.trackers.add', async () => { await trackers.add(); await setup.recheck('B14.tickets'); });
  reg('acc.trackers.signIn', async (arg?: unknown) => { if (await trackers.signIn(arg)) tickets.refresh(); await setup.recheck('B14.tickets'); });
  reg('acc.trackers.signOut', async (arg?: unknown) => { await trackers.signOut(arg); await setup.recheck('B14.tickets'); });
  // B14: acc doctor sees the config; only the extension can see this repo's sign-ins.
  setup.setOverlay(async (items, cwd) => {
    const p = hub.project(cwd) ?? hub.projectFor(cwd);
    if (!p) return items;
    const missing = await trackers.missingSignIns(p);
    return items.map((i) => (i.id === 'B14.tickets' && i.status === 'pass' && missing.length
      ? { ...i, status: 'fail', detail: `${i.detail} This repo isn't signed in to ${missing.join(' or ')} yet.`, fix: 'acc.trackers.signIn' }
      : i));
  });
  reg('acc.trackers.refresh', () => trackers.loadBoards());
  reg('acc.open.home', (section?: unknown) => panels.show(typeof section === 'string' ? (section as ViewKind) : undefined));
  for (const kind of VIEW_KINDS) reg(`acc.open.${kind}`, () => panels.show(kind));

  hub.onDidChange((part) => {
    if (part === 'projects') { void trackers.loadBoards(); void setup.recheck('B14.tickets'); void identity.refresh(); }
    if (part === 'projects' || part === 'worktrees') questions?.rootsChanged();
    if (part === 'tasks' || part === 'agents') tickets.refresh();
    if (part === 'agents') pages.refresh();
    changed();
  });
  setup.onDidChange(changed);

  context.subscriptions.push(
    vscode.window.onDidEndTerminalShellExecution((e) => setup.onShellEnd(e)),
    vscode.window.onDidCloseTerminal((t) => setup.onTerminalClosed(t)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { setup.refreshSoon('folders changed', 200); void hub.loadProjects(); }),
    vscode.window.onDidChangeActiveTextEditor(() => { setup.renderStatusIfFolderChanged(); identity.render(); }),
    // Coming back to VSCode is when an account may have changed elsewhere, such as gh in a terminal.
    vscode.window.onDidChangeWindowState((s) => { if (s.focused) void identity.refresh(); }),
  );
  const configWatch = vscode.workspace.createFileSystemWatcher('**/.acc/config.json');
  const reload = () => void hub.loadProjects();
  configWatch.onDidChange(reload);
  configWatch.onDidCreate(reload);
  configWatch.onDidDelete(reload);
  context.subscriptions.push(configWatch);
  setup.watch();

  void hub.loadProjects().then(() => { questions?.start(); return hub.loadAgents(); });
  void setup.refresh('startup', { reuseMachine: true }).then(() => setup.maybeOpenWalkthroughs());
}

/** The sidebar's one view: the page's sections, each opening it there, with what needs you beside it. */
class HomeLauncher implements vscode.TreeDataProvider<NavItem>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly nav: () => NavItem[];

  constructor(nav: () => NavItem[]) {
    this.nav = nav;
  }

  dispose(): void {
    this.emitter.dispose();
  }

  refresh(): void {
    this.emitter.fire();
  }

  getChildren(): NavItem[] {
    return this.nav();
  }

  getTreeItem(n: NavItem): vscode.TreeItem {
    const item = new vscode.TreeItem(n.label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(n.icon, n.attention ? new vscode.ThemeColor('charts.orange') : undefined);
    item.description = n.attention ? `${n.count ?? ''} · ${n.hint}`.replace(/^ · /, '') : n.hint;
    item.tooltip = `${n.label}: ${n.hint}`;
    item.command = { command: 'acc.open.home', title: `Open ${n.label}`, arguments: [n.section] };
    return item;
  }
}

export function deactivate(): void {}
