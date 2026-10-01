import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { Hub } from './hub.ts';
import {
  agentsModel, environmentsModel, isFromWebview, type Model, type Ref, setupModel, tasksModel, VIEW_TITLES, type ViewKind, worktreesModel,
} from './model.ts';
import type { Setup } from './setup.ts';

/** Commands a tab may ask for. Anything else from a webview is ignored. */
const ALLOWED = new Set([
  'acc.task.add', 'acc.task.importGithub', 'acc.task.importJira', 'acc.task.show', 'acc.task.move', 'acc.task.block', 'acc.task.unblock', 'acc.task.openTicket',
  'acc.agent.new', 'acc.agent.attach', 'acc.agent.logs', 'acc.agent.stop', 'acc.agent.openFolder',
  'acc.worktree.open', 'acc.worktree.terminal', 'acc.worktree.reveal', 'acc.worktree.remove',
  'acc.env.openOrg', 'acc.env.openGithub', 'acc.env.compare',
  'acc.step.check', 'acc.step.fix', 'acc.step.openSetup', 'acc.step.confirm', 'acc.openGuide', 'acc.openProjectWalkthrough',
]);

export function htmlFor(webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>, base: vscode.Uri, kind: ViewKind, nonce: string): string {
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
<title>${VIEW_TITLES[kind]}</title>
</head>
<body data-view="${kind}">
<main id="app"><p class="muted">Loading ${VIEW_TITLES[kind].toLowerCase()}…</p></main>
<script nonce="${nonce}" src="${res('main.js')}"></script>
</body>
</html>`;
}

/**
 * The editor-tab versions of the sidebar views: one tab per view, revealed if already open. They show
 * the hub's data and run the sidebar's own commands, so the two never disagree.
 */
export class Panels implements vscode.Disposable {
  private readonly open = new Map<ViewKind, vscode.WebviewPanel>();
  private readonly ctx: vscode.ExtensionContext;
  private readonly hub: Hub;
  private readonly setup: Setup;
  private readonly resolve: (command: string, ref: Ref) => unknown;
  private readonly onVisible: (kind: ViewKind, visible: boolean) => void;

  constructor(ctx: vscode.ExtensionContext, hub: Hub, setup: Setup, resolve: (command: string, ref: Ref) => unknown, onVisible: (kind: ViewKind, visible: boolean) => void) {
    this.ctx = ctx;
    this.hub = hub;
    this.setup = setup;
    this.resolve = resolve;
    this.onVisible = onVisible;
  }

  dispose(): void {
    for (const p of this.open.values()) p.dispose();
  }

  show(kind: ViewKind): void {
    const existing = this.open.get(kind);
    if (existing) {
      existing.reveal();
      return;
    }
    const base = vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel(`acc.${kind}`, VIEW_TITLES[kind], vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [base],
    });
    panel.iconPath = vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'acc.svg');
    panel.webview.html = htmlFor(panel.webview, base, kind, randomBytes(16).toString('base64'));
    panel.webview.onDidReceiveMessage((m: unknown) => this.receive(kind, m));
    panel.onDidChangeViewState((e) => {
      this.onVisible(kind, e.webviewPanel.visible);
      if (e.webviewPanel.visible) this.post(kind);
    });
    panel.onDidDispose(() => {
      this.open.delete(kind);
      this.onVisible(kind, false);
    });
    this.open.set(kind, panel);
    this.onVisible(kind, true);
  }

  isOpen(kind: ViewKind): boolean {
    return this.open.has(kind);
  }

  model(kind: ViewKind): Model {
    switch (kind) {
      case 'tasks': return tasksModel(this.hub);
      case 'agents': return agentsModel(this.hub);
      case 'worktrees': return worktreesModel(this.hub);
      case 'environments': return environmentsModel(this.hub);
      case 'setup': return setupModel(this.setup.results(), this.setup.allConfirmed());
    }
  }

  /** Sends fresh data to one open tab, or all of them. */
  post(kind?: ViewKind): void {
    for (const [k, p] of this.open) {
      if (kind && k !== kind) continue;
      if (p.visible) void p.webview.postMessage({ type: 'state', model: this.model(k) });
    }
  }

  private receive(kind: ViewKind, m: unknown): void {
    if (!isFromWebview(m)) return;
    if (m.type === 'ready') return this.post(kind);
    if (m.type === 'refresh') {
      void vscode.commands.executeCommand(kind === 'setup' ? 'acc.setup.refresh' : `acc.${kind === 'environments' ? 'worktrees' : kind}.refresh`);
      return;
    }
    if (!ALLOWED.has(m.command)) return;
    if (m.type === 'toolbar') {
      void vscode.commands.executeCommand(m.command, m.project ? { project: this.hub.project(m.project), kind: 'place', root: m.project, label: '', sessions: [] } : undefined);
      return;
    }
    void this.resolve(m.command, m.ref);
  }
}
