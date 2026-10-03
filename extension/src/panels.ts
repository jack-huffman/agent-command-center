import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { Answer } from '../../packages/core/src/questions.ts';
import type { Hub } from './hub.ts';
import { answerOf, type BoardInput, HOME_SECTIONS, type HomeSection, homeModel, type IdentityCard, isFromWebview, type Ref, type RunControl, type RunInput, runCard, type ViewKind } from './model.ts';
import type { Setup } from './setup.ts';

/** Commands the page may ask for. Anything else from a webview is ignored. */
const ALLOWED = new Set([
  'acc.task.dispatch', 'acc.task.attach', 'acc.task.openWorktree', 'acc.task.abandon', 'acc.task.cleanup',
  'acc.task.add', 'acc.task.importGithub', 'acc.task.importJira', 'acc.task.show', 'acc.task.move', 'acc.task.block', 'acc.task.unblock', 'acc.task.openTicket',
  'acc.agent.new', 'acc.agent.attach', 'acc.agent.logs', 'acc.agent.stop', 'acc.agent.openFolder', 'acc.agent.watch', 'acc.task.watch', 'acc.agent.openInClaude', 'acc.task.openInClaude', 'acc.task.review', 'acc.task.watchReview', 'acc.task.land', 'acc.task.openPr',
  'acc.worktree.open', 'acc.worktree.terminal', 'acc.worktree.reveal', 'acc.worktree.remove',
  'acc.env.openOrg', 'acc.env.openGithub', 'acc.env.compare', 'acc.env.promote', 'acc.env.deploy',
  'acc.step.check', 'acc.step.fix', 'acc.step.openSetup', 'acc.step.confirm', 'acc.openGuide', 'acc.openProjectWalkthrough',
  'acc.trackers.signIn', 'acc.trackers.refresh', 'acc.trackers.add', 'acc.github.switch', 'acc.github.signIn', 'acc.agents.configure',
]);

/** What the page needs from the rest of the extension, and what its cards ask for. */
export interface BoardDeps {
  boards(root: string): BoardInput[];
  identity(root: string): IdentityCard | null;
  openTicket(project: string, tracker: number | null, key: string): void;
  move(project: string, tracker: number, key: string, to: string): Promise<void>;
  /** A task's card dropped in a lane of the agent board (D-041). */
  moveTask(project: string, task: string, lane: string): Promise<void>;
  /** Agents' questions (D-030) and the commands acc is running. */
  answer(id: string, a: Answer): void;
  runs(): RunInput[];
  runInput(id: string, text: string): void;
  runControl(id: string, action: RunControl): void;
}

export const isWebLink = (url: string): boolean => /^(https?:|mailto:)/i.test(url);

/** The refresh behind each section's Refresh button. */
const REFRESH: Record<HomeSection, string[]> = {
  overview: ['acc.tasks.refresh', 'acc.agents.refresh', 'acc.trackers.refresh'],
  tasks: ['acc.tasks.refresh', 'acc.trackers.refresh'],
  agents: ['acc.agents.refresh'],
  worktrees: ['acc.worktrees.refresh'],
  environments: ['acc.worktrees.refresh'],
  setup: ['acc.setup.refresh'],
};

export function htmlFor(webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>, base: vscode.Uri, kind: 'home' | 'ticket' | 'agent', nonce: string, title = kind === 'ticket' ? 'Ticket' : kind === 'agent' ? 'Agent' : 'Command Center'): string {
  const res = (p: string) => webview.asWebviewUri(vscode.Uri.joinPath(base, p)).toString();
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${res('codicons/codicon.css')}">
<link rel="stylesheet" href="${res('styles.css')}">
<title>${title.replace(/[<>&]/g, '')}</title>
</head>
<body data-view="${kind}" data-logo-dark="${res('acc-dark.svg')}" data-logo-light="${res('acc-light.svg')}">
<main id="app"><p class="muted">Loading…</p></main>
<script nonce="${nonce}" src="${res('main.js')}"></script>
</body>
</html>`;
}

/**
 * The Command Center: one editor tab with every section of the extension, Overview first (D-029). It
 * shows the hub's data and runs the same commands the rest of the extension does.
 */
export class Panels implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;
  private section: HomeSection = 'overview';
  private readonly ctx: vscode.ExtensionContext;
  private readonly hub: Hub;
  private readonly setup: Setup;
  private readonly resolve: (command: string, ref: Ref) => unknown;
  private readonly onVisible: (visible: boolean) => void;
  private readonly deps: BoardDeps;

  constructor(ctx: vscode.ExtensionContext, hub: Hub, setup: Setup, resolve: (command: string, ref: Ref) => unknown, onVisible: (visible: boolean) => void, deps: BoardDeps) {
    this.ctx = ctx;
    this.hub = hub;
    this.setup = setup;
    this.resolve = resolve;
    this.onVisible = onVisible;
    this.deps = deps;
    this.section = ctx.workspaceState.get<HomeSection>('acc.home.section') ?? 'overview';
  }

  dispose(): void {
    this.panel?.dispose();
  }

  /** Opens the page, or brings it forward, at a section: the one asked for, else where it was left. */
  show(section?: ViewKind | HomeSection): void {
    if (section && (HOME_SECTIONS as readonly string[]).includes(section)) this.remember(section as HomeSection);
    if (this.panel) {
      this.panel.reveal();
      this.post(true);
      return;
    }
    const base = vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel('acc.home', 'Command Center', vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [base] });
    const icon = (theme: 'light' | 'dark') => vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'media', `acc-${theme}.svg`);
    panel.iconPath = { light: icon('light'), dark: icon('dark') };
    panel.webview.html = htmlFor(panel.webview, base, 'home', randomBytes(16).toString('base64'));
    panel.webview.onDidReceiveMessage((m: unknown) => this.receive(m));
    panel.onDidChangeViewState((e) => {
      this.onVisible(e.webviewPanel.visible);
      if (e.webviewPanel.visible) this.post();
    });
    panel.onDidDispose(() => {
      this.panel = null;
      this.onVisible(false);
    });
    this.panel = panel;
    this.onVisible(true);
  }

  isOpen(): boolean {
    return !!this.panel;
  }

  /** On screen right now, so what it shows needs no notification. */
  visible(): boolean {
    return !!this.panel?.visible && vscode.window.state.focused;
  }

  current(): HomeSection {
    return this.section;
  }

  private remember(section: HomeSection): void {
    this.section = section;
    void this.ctx.workspaceState.update('acc.home.section', section);
  }

  model() {
    return homeModel({
      hub: this.hub, section: this.section, boards: (r) => this.deps.boards(r), identity: (r) => this.deps.identity(r),
      setup: { items: this.setup.results(), confirmed: this.setup.allConfirmed() }, runs: this.deps.runs(),
    });
  }

  /** Just the output panel, as a command's output comes in: cheaper than the whole page, and keeps your typing. */
  postRuns(focus?: string): void {
    if (this.panel?.visible) void this.panel.webview.postMessage({ type: 'runs', runs: this.deps.runs().map((r) => runCard(r)), ...(focus ? { focus } : {}) });
  }

  /** Sends fresh data to the page. With jump, the page also moves to the section asked for. */
  post(jump = false): void {
    if (this.panel?.visible) void this.panel.webview.postMessage({ type: 'state', model: this.model(), jump });
  }

  private receive(m: unknown): void {
    if (!isFromWebview(m)) return;
    if (m.type === 'ready') return this.post(true);
    if (m.type === 'nav') return this.remember(m.section);
    if (m.type === 'refresh') {
      for (const c of REFRESH[this.section]) void vscode.commands.executeCommand(c);
      return;
    }
    if (m.type === 'ticket') {
      if (this.hub.project(m.project)) this.deps.openTicket(m.project, m.tracker, m.key);
      return;
    }
    if (m.type === 'move') {
      if (this.hub.project(m.project)) void this.deps.move(m.project, m.tracker, m.key, m.to);
      return;
    }
    if (m.type === 'open') {
      if (isWebLink(m.url)) void vscode.env.openExternal(vscode.Uri.parse(m.url));
      return;
    }
    if (m.type === 'ticket-action') return;
    if (m.type === 'move-task') {
      if (this.hub.project(m.project)) void this.deps.moveTask(m.project, m.task, m.to);
      return;
    }
    if (m.type === 'answer') {
      this.deps.answer(m.id, answerOf(m));
      return;
    }
    if (m.type === 'run-input') return this.deps.runInput(m.run, m.text);
    if (m.type === 'run-control') return this.deps.runControl(m.run, m.action);
    if (!ALLOWED.has(m.command)) return;
    if (m.type === 'toolbar') {
      if (m.arg !== undefined) { void vscode.commands.executeCommand(m.command, m.arg); return; }
      void vscode.commands.executeCommand(m.command, m.project ? { project: this.hub.project(m.project), kind: 'place', root: m.project, label: '', sessions: [] } : undefined);
      return;
    }
    void this.resolve(m.command, m.ref);
  }
}
