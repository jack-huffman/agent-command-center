import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { Answer } from '../../packages/core/src/questions.ts';
import type { Hub } from './hub.ts';
import type { AgentSession } from './logic/shared.ts';
import { agentModel } from './model/agent-page.ts';
import { answerOf } from './model/questions.ts';
import { isFromWebview } from './model/messages.ts';
import { nameOf, type Ref, sessionKey } from './model/shared.ts';
import { htmlFor, isWebLink, TabTheme } from './panels.ts';
import type { ThemeChoice } from './model/settings.ts';
import { claudeProjectsDir, emptyTranscript, foldTranscript, splitLines, type Transcript, transcriptDir } from './transcript.ts';

/** A first read takes at most this much of a transcript, from its end: a day-long session can be large. */
const FIRST_READ_BYTES = 16 * 1024 * 1024;
const TICK_MS = 1_000;

interface Page {
  panel: vscode.WebviewPanel;
  key: string;
  seen: AgentSession | null;
  file: string | null;
  offset: number;
  rest: string;
  transcript: Transcript;
  timer: NodeJS.Timeout | undefined;
  /** Shown once, so a session with no transcript yet still gets a page that says so. */
  shown: boolean;
  /** For a session Claude Code doesn't list: whether it's still working. */
  active?: () => boolean;
  /** A message sent from the page is being answered (D-060). */
  replying?: boolean;
  /** Keeps it in the Command Center's theme (GH-109). */
  theme: TabTheme;
}

/**
 * Each agent's activity as its own tab (D-030): its timeline, live while it works, and its waiting
 * question to answer in place. One tab per session; opening it again brings it forward.
 */
export class AgentPages implements vscode.Disposable {
  private readonly pages = new Map<string, Page>();
  private readonly ctx: vscode.ExtensionContext;
  private readonly hub: Hub;
  private readonly resolve: (command: string, ref: Ref) => unknown;
  private readonly answer: (id: string, a: Answer) => void;
  private readonly projectsDir: string;
  /** Sends a message to the session from its page (D-060): null once it's on its way, or why it couldn't be. */
  private readonly reply: ((s: AgentSession, text: string, done: () => void) => Promise<string | null>) | null;

  constructor(ctx: vscode.ExtensionContext, hub: Hub, resolve: (command: string, ref: Ref) => unknown, answer: (id: string, a: Answer) => void, reply: ((s: AgentSession, text: string, done: () => void) => Promise<string | null>) | null = null, projectsDir = claudeProjectsDir(process.env)) {
    this.ctx = ctx;
    this.hub = hub;
    this.resolve = resolve;
    this.answer = answer;
    this.reply = reply;
    this.projectsDir = projectsDir;
  }

  dispose(): void {
    for (const p of this.pages.values()) p.panel.dispose();
  }

  private session(key: string): AgentSession | null {
    return this.hub.agents.find((s) => sessionKey(s) === key || s.id === key || s.sessionId === key) ?? null;
  }

  /** Whether a session's page is on screen, so its question needs no notification. */
  showing(sessionId: string): boolean {
    for (const p of this.pages.values()) if (p.panel.visible && p.seen?.sessionId === sessionId) return true;
    return false;
  }

  /** `ended` stands in for a session Claude Code no longer lists, so its transcript can still be read. */
  open(key: string, ended?: AgentSession, active?: () => boolean): boolean {
    const s = this.session(key) ?? ended ?? null;
    const k = s ? sessionKey(s) : key;
    const existing = this.pages.get(k);
    if (existing) {
      existing.panel.reveal();
      return true;
    }
    if (!s) return false;
    const base = vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview');
    const name = nameOf(this.hub, s);
    const panel = vscode.window.createWebviewPanel('acc.agent', `${name} · activity`, vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [base], retainContextWhenHidden: false });
    const icon = (theme: 'light' | 'dark') => vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'media', `acc-${theme}.svg`);
    panel.iconPath = { light: icon('light'), dark: icon('dark') };
    const theme = new TabTheme(panel, (t) => htmlFor(panel.webview, base, 'agent', randomBytes(16).toString('base64'), `${name} · activity`, t));
    const page: Page = { panel, key: k, seen: s, file: null, offset: 0, rest: '', transcript: emptyTranscript(), timer: undefined, shown: false, active, theme };
    this.pages.set(k, page);
    panel.webview.onDidReceiveMessage((m: unknown) => this.receive(page, m));
    panel.onDidChangeViewState((e) => this.tick(page, e.webviewPanel.visible));
    panel.onDidDispose(() => {
      clearInterval(page.timer);
      this.pages.delete(k);
      this.hub.poll('agent-pages', 5_000, () => this.hub.loadAgents(), [...this.pages.values()].some((p) => p.panel.visible));
    });
    this.tick(page, true);
    return true;
  }

  /** Settings changed the theme (GH-109): every agent page restyles. */
  retheme(theme: ThemeChoice): void {
    for (const p of this.pages.values()) p.theme.set(theme);
  }

  /** Re-posts every open page: the agents or questions changed. */
  refresh(): void {
    for (const p of this.pages.values()) {
      const s = this.session(p.key);
      if (s) p.seen = s;
      this.post(p);
    }
  }

  /** Reads the transcript while the tab is on screen, once a second. Hidden tabs cost nothing. */
  private tick(page: Page, visible: boolean): void {
    clearInterval(page.timer);
    page.timer = undefined;
    // Its state (working, needs you) comes from claude agents, which the page polls only while it's open.
    this.hub.poll('agent-pages', 5_000, () => this.hub.loadAgents(), [...this.pages.values()].some((p) => p.panel.visible));
    if (!visible) return;
    if (this.read(page)) this.post(page);
    page.timer = setInterval(() => { if (this.read(page)) this.post(page); }, TICK_MS);
    page.timer.unref?.();
  }

  private find(s: AgentSession | null): string | null {
    const id = s?.sessionId;
    if (!s || !id) return null;
    const direct = join(transcriptDir(this.projectsDir, s.cwd), `${id}.jsonl`);
    if (existsSync(direct)) return direct;
    // A session that moved into a worktree may have kept its transcript where it started.
    try {
      for (const d of readdirSync(this.projectsDir)) {
        const f = join(this.projectsDir, d, `${id}.jsonl`);
        if (existsSync(f)) return f;
      }
    } catch {
      return null;
    }
    return null;
  }

  /** Reads what's new in the transcript. True when the page has something new to show. */
  private read(page: Page): boolean {
    const first = !page.shown;
    page.shown = true;
    page.file ??= this.find(page.seen);
    if (!page.file) return first;
    let size = 0;
    try {
      size = statSync(page.file).size;
    } catch {
      return first;
    }
    if (size < page.offset) { page.offset = 0; page.rest = ''; page.transcript = emptyTranscript(); } // rewritten
    if (size === page.offset) return first;
    let start = page.offset;
    let skipFirst = false;
    if (start === 0 && size > FIRST_READ_BYTES) { start = size - FIRST_READ_BYTES; skipFirst = true; }
    const length = size - start;
    const buf = Buffer.alloc(length);
    let fd: number | null = null;
    try {
      fd = openSync(page.file, 'r');
      readSync(fd, buf, 0, length, start);
    } catch {
      return false;
    } finally {
      if (fd !== null) closeSync(fd);
    }
    page.offset = size;
    const { lines, rest } = splitLines(page.rest, buf.toString('utf8'));
    page.rest = rest;
    foldTranscript(page.transcript, skipFirst ? lines.slice(1) : lines);
    return true;
  }

  private post(page: Page): void {
    if (!page.panel.visible) return;
    const t = page.transcript;
    const model = agentModel({ hub: this.hub, key: page.key, seen: page.seen, entries: t.entries, readable: !!page.file && t.used > 0, lastAt: t.lastAt, model: t.model, active: page.active?.() || page.replying, replying: page.replying });
    if (!this.reply) model.reply = null;
    void page.panel.webview.postMessage({ type: 'state', model });
  }

  private receive(page: Page, m: unknown): void {
    if (!isFromWebview(m)) return;
    if (m.type === 'ready') return this.post(page);
    if (m.type === 'refresh') { void this.hub.loadAgents(); return; }
    if (m.type === 'open') { if (isWebLink(m.url)) void vscode.env.openExternal(vscode.Uri.parse(m.url)); return; }
    if (m.type === 'answer') {
      this.answer(m.id, answerOf(m));
      return;
    }
    if (m.type === 'agent-reply' && this.reply && page.seen && !page.replying) {
      const s = page.seen;
      page.replying = true;
      this.post(page);
      // The page reads the transcript faster while it answers, and says so until it's done.
      const done = () => { page.replying = false; void this.hub.loadAgents(); this.post(page); };
      void this.reply(s, m.text, done).then((why) => {
        if (!why) return;
        page.replying = false;
        this.post(page);
        void vscode.window.showWarningMessage(`Couldn't send it: ${why}`);
      });
      return;
    }
    if (m.type === 'run' && /^acc\.(agent|task)\./.test(m.command)) void this.resolve(m.command, m.ref);
  }
}
