import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { Hub } from './hub.ts';
import { FinishedJobs } from './progress.ts';
import type { AboutFacts } from './model/about.ts';
import type { BoardInput } from './model/boards.ts';
import type { ConnectModel } from './model/connect.ts';
import { type FromWebview, isFromWebview, PAGE_COMMANDS } from './model/messages.ts';
import { HOME_SECTIONS, type HomeSection, type Ref, type ViewKind } from './model/shared.ts';
import type { IdentityCard } from './model/environments.ts';
import { homeModel } from './model/home.ts';
import { runCard, type RunInput } from './model/runs.ts';
import type { SlackCard } from './model/slack.ts';
import { WHERE_VIEWS, type WhereView } from './model/agents.ts';
import { type OpensOn, opensOnChoice, themeChoice, type ThemeChoice } from './model/settings.ts';
import { type Pace, paceChoice } from './logic/polls.ts';
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
  /** Settings' About (GH-114): what it knows, and Settings arrived at, which reads the versions again. */
  about?: { facts(): AboutFacts; arrive(): Promise<void> };
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
// Read by its literal name (THEME_SETTING's), so the settings check sees what reads it (D-103).
export const currentTheme = (): ThemeChoice => themeChoice(vscode.workspace.getConfiguration('agentCommandCenter').get('theme'));

/** How often the Command Center refreshes while it's on screen, kept on this machine (GH-113). Read by its literal name too. */
export const currentPace = (): Pace => paceChoice(vscode.workspace.getConfiguration('agentCommandCenter').get('refreshPace'));

/** Where this window keeps the section the Command Center opens on (GH-113), and the section it was left at. */
export const OPENS_ON_STATE = 'acc.home.opensOn';

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

  /**
   * The page says it's ready: a page that reloaded while on screen, such as from Developer: Reload Webviews,
   * came back from HTML in the old theme, so it's told the new one.
   */
  ready(): void {
    if (this.written !== this.wanted) void this.panel.webview.postMessage({ type: 'theme', theme: this.wanted });
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
  /** A part of the section to go to with the next jump, such as Settings' How agents run. */
  private opening: string | null = null;
  private section: HomeSection = 'overview';
  /** What the Agents tab's Where column shows, remembered for the window (GH-83). */
  private whereView: WhereView = 'folder';
  /** The section the Command Center opens on in this window: where it was left, or a named one (GH-113). */
  private opens: OpensOn = 'left';
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
    this.opens = opensOnChoice(ctx.workspaceState.get(OPENS_ON_STATE));
  }

  /** The section the Command Center opens on in this window (GH-113). */
  opensOn(): OpensOn {
    return this.opens;
  }

  /** Keeps the section it opens on, for this window only, in its workspaceState. */
  async setOpensOn(choice: OpensOn): Promise<void> {
    this.opens = choice;
    await this.ctx.workspaceState.update(OPENS_ON_STATE, choice);
    this.post();
  }

  /** What the Agents tab's Where column shows (GH-83), set from Agents' toggle or Settings (GH-113), for this window. */
  where(): WhereView {
    return this.whereView;
  }

  async setWhere(view: WhereView): Promise<void> {
    this.whereView = view;
    await this.ctx.workspaceState.update('acc.agents.where', view);
    this.post();
  }

  dispose(): void {
    this.panel?.dispose();
  }

  /**
   * Opens the page, or brings it forward, at a section: the one asked for, else where it was left. With
   * open, the part with a heading of that name is scrolled to and focused, such as one of Settings'
   * (settingsKey, GH-109).
   */
  /**
   * A person opening the Command Center, from the activity bar or acc.open.home: opened afresh with no
   * section asked for, it opens on the one Settings names for this window (GH-113). Anything else that shows
   * it, such as Connect a tracker or a run's output, goes where it was sent, through show().
   */
  open(section?: ViewKind | HomeSection): void {
    if (!section && !this.panel && this.opens !== 'left') this.remember(this.opens);
    this.show(section);
  }

  show(section?: ViewKind | HomeSection, open?: string): void {
    if (section && (HOME_SECTIONS as readonly string[]).includes(section)) this.remember(section as HomeSection);
    this.opening = open ?? null;
    if (this.panel) {
      this.panel.reveal();
      // About starts reading first, so the jump is the last thing posted, and says it's reading.
      this.arrived();
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
      if (!e.webviewPanel.visible) return;
      this.arrived();
      this.post();
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

  /** Settings is on screen: About reads the versions again, and looks for a release when one is due (GH-114). */
  private arrived(): void {
    if (this.section === 'settings') void this.deps.about?.arrive();
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
      whereView: this.whereView, theme: this.tab?.theme ?? currentTheme(), pace: currentPace(), opensOn: this.opens,
      finished: this.finished, autopilot: (root) => this.deps.autopilot?.(root) ?? null, now: Date.now(), about: this.deps.about?.facts() ?? null,
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
    if (m.type === 'ready') { this.tab?.ready(); this.arrived(); return this.post(true); }
    if (m.type === 'nav') {
      this.remember(m.section);
      // Settings' limits are read only while it shows (GH-111), so arriving there reads them, and About's versions (GH-114).
      if (m.section === 'settings') { this.arrived(); this.post(); }
      return;
    }
    if (m.type === 'agents-where') {
      void this.setWhere(m.view);
      return;
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
