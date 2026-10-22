// A plan's conversation in its own panel (T-111): a Command Center tab titled "<key> · Plan conversation", opened
// beside the task's page, or as a tab of its own when that page is narrow. It stays open as the person moves
// around the ticket. Its model is the task page's conversation, so the two agree; each button asks the same
// actions the page's did, and every redraw of the task's pages redraws it too.
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { ExtensionArea } from './area.ts';
import type { Hub } from './hub.ts';
import { conversationPlace } from './logic/conversation.ts';
import { conversationModel, conversationTitle, type ConversationQuote } from './model/conversation.ts';
import { isFromWebview } from './model/messages.ts';
import type { Ref } from './model/shared.ts';
import type { ThemeChoice } from './model/settings.ts';
import { htmlFor, TabTheme } from './panels.ts';
import type { TicketPanels } from './ticket.ts';

/** What a task's page and the Tasks area ask of the conversation's panel. */
export interface ConversationActions {
  /** Opens the task's conversation, or brings it forward, with a part of the plan quoted when `about` names one. */
  open(root: string, key: string, opts?: { about?: ConversationQuote; width?: number | null }): void;
  /** Redraws each open panel, or a project's. */
  refresh(root?: string): void;
  /** Settings changed the theme (GH-109). */
  retheme(theme: ThemeChoice): void;
}

interface Panel {
  panel: vscode.WebviewPanel;
  theme: TabTheme;
  root: string;
  key: string;
  /** A quote to send once the page is ready, so the box opens with it. */
  about: ConversationQuote | null;
}

/** The commands the panel's own buttons run: Make a new plan. */
const ALLOWED = new Set(['acc.task.analyze']);

export class ConversationPanels implements ConversationActions, vscode.Disposable {
  private readonly open_ = new Map<string, Panel>();
  private readonly uri: vscode.Uri;
  private readonly hub: Hub;
  private readonly tickets: TicketPanels;
  private readonly resolve: (command: string, ref: Ref) => unknown;

  constructor(uri: vscode.Uri, hub: Hub, tickets: TicketPanels, resolve: (command: string, ref: Ref) => unknown) {
    this.uri = uri;
    this.hub = hub;
    this.tickets = tickets;
    this.resolve = resolve;
  }

  dispose(): void {
    for (const p of this.open_.values()) p.panel.dispose();
  }

  open(root: string, raw: string, opts: { about?: ConversationQuote; width?: number | null } = {}): void {
    if (!this.hub.project(root)) return;
    const key = raw.toUpperCase();
    const id = `${root}#${key}`;
    // Always beside the ticket's page (T-112): from the board's modal, or with no page open, the page opens first.
    // A width the modal gave is read before the modal closes.
    const width = opts.width ?? this.tickets.widthOf(root, key);
    this.tickets.ensureTab(root, key);
    const existing = this.open_.get(id);
    if (existing) {
      existing.about = opts.about ?? null;
      existing.panel.reveal(existing.panel.viewColumn);
      this.post(existing);
      this.quote(existing);
      return;
    }
    // Beside the task's page, in the editor group next to it; on a narrow page, a tab of its own in its place.
    const place = conversationPlace(width);
    const base = vscode.Uri.joinPath(this.uri, 'dist', 'webview');
    const title = conversationTitle(key);
    const panel = vscode.window.createWebviewPanel('acc.conversation', title, place === 'tab' ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [base] });
    const icon = (t: 'light' | 'dark') => vscode.Uri.joinPath(this.uri, 'dist', 'media', `acc-${t}.svg`);
    panel.iconPath = { light: icon('light'), dark: icon('dark') };
    const theme = new TabTheme(panel, (t) => htmlFor(panel.webview, base, 'conversation', randomBytes(16).toString('base64'), title, t));
    const p: Panel = { panel, theme, root, key, about: opts.about ?? null };
    this.open_.set(id, p);
    panel.onDidDispose(() => this.open_.delete(id));
    panel.onDidChangeViewState((e) => { if (e.webviewPanel.visible) this.post(p); });
    panel.webview.onDidReceiveMessage((m: unknown) => void this.receive(p, m));
  }

  refresh(root?: string): void {
    for (const p of this.open_.values()) if (!root || p.root === root) this.post(p);
  }

  retheme(theme: ThemeChoice): void {
    for (const p of this.open_.values()) p.theme.set(theme);
  }

  private post(p: Panel): void {
    if (!p.panel.visible) return;
    const task = this.hub.ledger(p.root)?.tasks.find((t) => t.id === p.key);
    const model = conversationModel({ project: p.root, key: p.key, taskTitle: task?.title ?? '', talk: this.tickets.talkModel(p.root, p.key) });
    void p.panel.webview.postMessage({ type: 'state', model });
  }

  /** The part of the plan Discuss quoted, once: the page puts it over the box and the cursor in it. */
  private quote(p: Panel): void {
    if (!p.about) return;
    void p.panel.webview.postMessage({ type: 'conversation-quote', project: p.root, task: p.key, ...p.about });
    p.about = null;
  }

  private async receive(p: Panel, m: unknown): Promise<void> {
    if (!isFromWebview(m)) return;
    const say = (msg: Record<string, unknown>) => void p.panel.webview.postMessage(msg);
    const mine = (project: string, task: string) => project === p.root && task.toUpperCase() === p.key;
    switch (m.type) {
      case 'ready':
        p.theme.ready();
        this.post(p);
        this.quote(p);
        return;
      // The same actions the task page's conversation had (T-98); the page and this panel redraw after each.
      case 'talk-send': case 'talk-use': case 'talk-claude':
        if (mine(m.project, m.task)) await this.tickets.talk?.act(m, say);
        return;
      // Draft the plan, or Skip to the plan: the Tasks area makes it, once at a time.
      case 'conversation-draft':
        if (mine(m.project, m.task)) this.tickets.draftPlan?.(p.root, p.key, m.skip === true);
        return;
      // Make a new plan, as the plan section's.
      case 'run':
        if (ALLOWED.has(m.command) && mine(m.ref.project ?? '', m.ref.task ?? '')) await this.resolve(m.command, m.ref);
        return;
      default: return;
    }
  }
}

export const area: ExtensionArea = {
  // The modal over the Tasks board sends its Open conversation and width to the Command Center's page, which hands
  // them to the task's page as its own (task-modal.ts's modalTakes).
  register({ hub, tickets, resolve, subscribe }) {
    const panels = new ConversationPanels(tickets.extensionUri, hub, tickets, resolve);
    tickets.conversation = panels;
    subscribe(panels);
  },
};
