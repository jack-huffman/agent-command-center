import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { Hub } from './hub.ts';
import { FinishedJobs } from './progress.ts';
import type { BoardInput } from './model/boards.ts';
import type { ConnectModel } from './model/connect.ts';
import { type FromWebview, isFromWebview, PAGE_COMMANDS } from './model/messages.ts';
import { HOME_SECTIONS, type HomeSection, type Ref, type ViewKind } from './model/shared.ts';
import type { IdentityCard } from './model/environments.ts';
import { homeModel } from './model/home.ts';
import { runCard, type RunInput } from './model/runs.ts';
import type { SlackCard } from './model/slack.ts';
import { WHERE_VIEWS, type WhereView } from './model/agents.ts';
import { THEME_SETTING, themeChoice, type ThemeChoice } from './model/settings.ts';
import type { Setup } from './setup.ts';

/** Commands the page may ask for, from every area that draws them (D-099). Anything else from a webview is ignored. */
const ALLOWED = new Set(PAGE_COMMANDS);

/** What the page needs from the rest of the extension. */
export interface BoardDeps {
  boards(root: string): BoardInput[];
  identity(root: string): IdentityCard | null;
  /** The unsent edit a task's page holds for an update, following the drafts it replaced (GH-46). */
  edited(root: string, id: string, replaces: string[]): string | null;
  runs(): RunInput[];
  /** The Connect page (GH-51): what it shows, and closing it with the tab. */
  connect: { model(): ConnectModel | null; close(): void };
  /** The Slack card (GH-58): what it shows, never the webhook. */
  slack?: { card(): SlackCard | null };
  /** Whether autopilot runs for a project's repo in this window, somewhere else, or not at all (D-064), so its merge queue moves (GH-73). */
  autopilot?(root: string): 'on' | 'elsewhere' | null;
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
  settings: ['acc.settings.refresh'],
};

/** The Command Center's theme, as Settings keeps it on this machine (GH-109). */
export const currentTheme = (): ThemeChoice => themeChoice(vscode.workspace.getConfiguration(THEME_SETTING.section).get(THEME_SETTING.key));

/**
 * Keeps one tab in the Command Center's theme (GH-109). On screen, the tab is told, and restyles without
 * reloading, so nothing you're typing or looking at is lost. Hidden, VSCode rebuilds it from its HTML when
 * it's shown again, so the HTML is written again with the new theme: at once, or, for a tab that was on
 * screen, as soon as it goes out of sight.
 */
export class TabTheme {
  private readonly panel: vscode.WebviewPanel;
  private readonly html: (theme: ThemeChoice) => string;
  /** The theme its HTML holds, and the one it should show. */
  private written: ThemeChoice;
  private wanted: ThemeChoice;

  constructor(panel: vscode.WebviewPanel, html: (theme: ThemeChoice) => string, theme: ThemeChoice = currentTheme()) {
    this.panel = panel;
    this.html = html;
    this.written = theme;
    this.wanted = theme;
    panel.webview.html = html(theme);
    panel.onDidChangeViewState((e) => { if (!e.webviewPanel.visible) this.catchUp(); });
  }

  get theme(): ThemeChoice {
    return this.wanted;
  }

  set(theme: ThemeChoice): void {
    this.wanted = theme;
    if (this.panel.visible) void this.panel.webview.postMessage({ type: 'theme', theme });
    else this.catchUp();
  }

  private catchUp(): void {
    if (this.written === this.wanted) return;
    this.written = this.wanted;
    this.panel.webview.html = this.html(this.wanted);
  }
}

/** A tab's HTML. Its theme goes on <html data-theme>, where the palettes key on it: anything but the three choices is vscode (GH-109). */
export function htmlFor(webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>, base: vscode.Uri, kind: 'home' | 'ticket' | 'agent', nonce: string, title = kind === 'ticket' ? 'Ticket' : kind === 'agent' ? 'Agent' : 'Command Center', theme: unknown = 'vscode'): string {
  const res = (p: string) => webview.asWebviewUri(vscode.Uri.joinPath(base, p)).toString();
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en" data-theme="${themeChoice(theme)}">
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
  /** Keeps the tab in the Command Center's theme (GH-109). */
  private tab: TabTheme | null = null;
  /** A part of the section to open with the next jump, such as the Agents settings. */
  private opening: string | null = null;
  private section: HomeSection = 'overview';
  /** What the Agents tab's Where column shows, remembered for the window (GH-83). */
  private whereView: WhereView = 'folder';
  private readonly ctx: vscode.ExtensionContext;
  private readonly hub: Hub;
  private readonly setup: Setup;
  private readonly resolve: (command: string, ref: Ref) => unknown;
  private readonly onVisible: (visible: boolean) => void;
  private readonly deps: BoardDeps;
  /** Jobs In progress saw end, kept a minute, by the extension's clock (D-092). */
  private readonly finished = new FinishedJobs();
  /** Each area's taker of the page's messages of a type (D-099). */
  private readonly takers = new Map<string, (m: never) => void>();

  constructor(ctx: vscode.ExtensionContext, hub: Hub, setup: Setup, resolve: (command: string, ref: Ref) => unknown, onVisible: (visible: boolean) => void, deps: BoardDeps) {
    this.ctx = ctx;
    this.hub = hub;
    this.setup = setup;
    this.resolve = resolve;
    this.onVisible = onVisible;
    this.deps = deps;
    this.section = ctx.workspaceState.get<HomeSection>('acc.home.section') ?? 'overview';
    const where = ctx.workspaceState.get<string>('acc.agents.where');
    if ((WHERE_VIEWS as readonly (string | undefined)[]).includes(where)) this.whereView = where as WhereView;
  }

  dispose(): void {
    this.panel?.dispose();
  }

  /**
   * Opens the page, or brings it forward, at a section: the one asked for, else where it was left. With
   * open, a part of the section that's closed until you open it opens too, such as the Agents settings, and
   * a part with a heading of that name is scrolled to, such as one of Settings' (settingsKey, GH-109).
   */
  show(section?: ViewKind | HomeSection, open?: string): void {
    if (section && (HOME_SECTIONS as readonly string[]).includes(section)) this.remember(section as HomeSection);
    this.opening = open ?? null;
    if (this.panel) {
      this.panel.reveal();
      this.post(true);
      return;
    }
    const base = vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel('acc.home', 'Command Center', vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [base] });
    const icon = (theme: 'light' | 'dark') => vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'media', `acc-${theme}.svg`);
    panel.iconPath = { light: icon('light'), dark: icon('dark') };
    this.tab = new TabTheme(panel, (theme) => htmlFor(panel.webview, base, 'home', randomBytes(16).toString('base64'), undefined, theme));
    panel.webview.onDidReceiveMessage((m: unknown) => this.receive(m));
    panel.onDidChangeViewState((e) => {
      this.onVisible(e.webviewPanel.visible);
      if (e.webviewPanel.visible) this.post();
    });
    panel.onDidDispose(() => {
      this.panel = null;
      this.tab = null;
      this.onVisible(false);
      // A Connect page closes with its tab: reopened, the Command Center shows its section.
      this.deps.connect.close();
    });
    this.panel = panel;
    this.onVisible(true);
  }

  /** Settings changed the theme (GH-109): the page restyles, and Settings shows the new choice. */
  retheme(theme: ThemeChoice): void {
    this.tab?.set(theme);
    this.post();
  }

  /** An area takes the page's messages of a type. Two areas can't both take one. */
  take<T extends FromWebview['type']>(type: T, fn: (m: Extract<FromWebview, { type: T }>) => void): void {
    if (this.takers.has(type)) throw new Error(`Two areas take the page's ${type} messages.`);
    this.takers.set(type, fn as (m: never) => void);
  }

  /** Tells the page how something it sent went. */
  reply(msg: Record<string, unknown>): void {
    void this.panel?.webview.postMessage(msg);
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
      edited: (root, id, replaces) => this.deps.edited(root, id, replaces), connect: this.deps.connect.model(), slack: this.deps.slack?.card() ?? null,
      whereView: this.whereView, theme: this.tab?.theme ?? currentTheme(),
      finished: this.finished, autopilot: (root) => this.deps.autopilot?.(root) ?? null, now: Date.now(),
    });
  }

  /** Just the output panel, as a command's output comes in: cheaper than the whole page, and keeps your typing. */
  postRuns(focus?: string): void {
    if (this.panel?.visible) void this.panel.webview.postMessage({ type: 'runs', runs: this.deps.runs().map((r) => runCard(r)), ...(focus ? { focus } : {}) });
  }

  /** Sends fresh data to the page. With jump, the page also moves to the section asked for, and opens the part show asked for. */
  post(jump = false): void {
    if (!this.panel?.visible) return;
    const open = jump ? this.opening : null;
    if (jump) this.opening = null;
    void this.panel.webview.postMessage({ type: 'state', model: this.model(), jump, ...(open ? { open } : {}) });
  }

  private receive(m: unknown): void {
    if (!isFromWebview(m)) return;
    if (m.type === 'ready') return this.post(true);
    if (m.type === 'nav') return this.remember(m.section);
    if (m.type === 'agents-where') {
      this.whereView = m.view;
      void this.ctx.workspaceState.update('acc.agents.where', m.view);
      return this.post();
    }
    if (m.type === 'refresh') {
      for (const c of REFRESH[this.section]) void vscode.commands.executeCommand(c);
      return;
    }
    if (m.type === 'open') {
      if (isWebLink(m.url)) void vscode.env.openExternal(vscode.Uri.parse(m.url));
      return;
    }
    // The rest are each area's, which takes them in its own module (D-099). None here takes update-edit,
    // which only a task's own page sends (D-066), agent-reply, only an agent's own page's (D-060), or
    // ticket-action, a ticket page's.
    const take = this.takers.get(m.type);
    if (take) return take(m as never);
    if (m.type !== 'run' && m.type !== 'toolbar') return;
    if (!ALLOWED.has(m.command)) return;
    if (m.type === 'toolbar') {
      if (m.arg !== undefined) { void vscode.commands.executeCommand(m.command, m.arg); return; }
      void vscode.commands.executeCommand(m.command, m.project ? { project: this.hub.project(m.project), kind: 'place', root: m.project, label: '', sessions: [] } : undefined);
      return;
    }
    void this.resolve(m.command, m.ref);
  }
}
