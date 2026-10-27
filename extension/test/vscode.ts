// A stand-in for the vscode API, so the built extension can be loaded and its commands run without a VSCode
// window: activate.test.ts checks what they do, and junk.test.ts that none of them throws on bad arguments
// (GH-106). It's strict: reading an API it doesn't have throws "fake vscode has no <name>", so a gap in the
// stand-in reads as one, never as a bug in the extension.
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { delimiter, join } from 'node:path';
import { standIn } from '../../packages/core/test/stand-in.ts';
import { tempDir } from '../../packages/core/test/support.ts';

const disposable = { dispose() {} };
const event = () => () => disposable;

/** Names any object may be asked for without being an API: module interop, promises, printing. */
const ALWAYS = new Set(['__esModule', 'default', 'then', 'toJSON', 'constructor', 'inspect', 'prototype', 'length', 'name']);

/** The object, with every plain object in it, refusing a name it doesn't have. */
export function strict<T extends object>(o: T, path = 'vscode'): T {
  return new Proxy(o, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver);
      if (typeof key === 'symbol' || ALWAYS.has(key)) return v;
      if (!Reflect.has(target, key)) throw new Error(`fake vscode has no ${path}.${key}`);
      return v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype ? strict(v as object, `${path}.${key}`) : v;
    },
  });
}

export function fakeVscode(folder: string) {
  const calls = {
    commands: new Map<string, (...a: unknown[]) => unknown>(), contexts: new Map<string, unknown>(), info: [] as string[], warn: [] as string[], error: [] as string[], terminal: [] as string[],
    /** Every command the extension ran, with what it passed. */
    executed: [] as [string, unknown[]][],
    /** Which of a warning's buttons is clicked, such as a modal's, when a test wants one to be. */
    warnPick: undefined as ((items: string[]) => string | undefined) | undefined,
    /** Every file watcher's pattern. */
    watched: [] as unknown[],
    /** What a quick pick answers, when a test wants it to. */
    pick: undefined as ((items: { value?: string }[]) => unknown) | undefined,
    /** How many prompts at the top of VSCode were shown: input boxes and quick picks. */
    prompts: 0,
    /** Every link opened outside VSCode. */
    opened: [] as string[],
    /** The account VSCode's GitHub sign-in comes back as, when a test wants one to; else the person closes it. */
    signsInAs: undefined as string | undefined,
    /** What was put on the clipboard (T-118). */
    copied: [] as string[],
  };
  type Item = { text: string; tooltip: string; command: unknown; name: string; shown: boolean; show(): void; hide(): void; dispose(): void };
  const item = (): Item => ({ text: '', tooltip: '', command: undefined, name: '', shown: false, show() { this.shown = true; }, hide() { this.shown = false; }, dispose() {} });
  /** Autopilot's switches (D-064), one a repo, apart from the setup item the test checks. */
  const autopilot: Item[] = [];
  const status = { text: '', tooltip: '', command: '', backgroundColor: undefined as unknown, name: '', shown: false, show() { this.shown = true; }, hide() { this.shown = false; }, dispose() {} };
  const trees = new Map<string, { getChildren(e?: unknown): unknown[]; getTreeItem(e: unknown): { label: string; description?: string } }>();
  /** Who listens for each tree view being shown or hidden, such as the launcher's (GH-149): a test fires them. */
  const treeShown = new Map<string, ((e: { visible: boolean }) => void)[]>();
  class EventEmitter { private ls: ((e: unknown) => void)[] = []; event = (l: (e: unknown) => void) => { this.ls.push(l); return disposable; }; fire(e?: unknown) { for (const l of this.ls) l(e); } dispose() {} }
  class TreeItem { label: string; collapsibleState: number; [k: string]: unknown; constructor(label: string, state = 0) { this.label = label; this.collapsibleState = state; } }
  class MarkdownString { value: string; supportThemeIcons = false; constructor(v = '') { this.value = v; } appendMarkdown(v: string) { this.value += v; return this; } }
  class Disposable { private f: () => void; constructor(f: () => void) { this.f = f; } dispose() { this.f(); } static from(...ds: { dispose(): unknown }[]) { return { dispose: () => ds.forEach((d) => d.dispose()) }; } }
  /**
   * Each editor tab: what it was sent, what it says back, and closing it. Hiding it tells its listeners, as
   * VSCode does when another tab covers it, and its HTML is what VSCode would rebuild it from.
   */
  type Tab = { viewType: string; title: string; column: unknown; revealed: number; html: string; htmlSets: number; posted: unknown[]; visible: boolean; receive?: (m: unknown) => void; close?: () => void; views: ((e: unknown) => void)[]; hide(): void };
  const panels: Tab[] = [];
  /** VSCode's settings, by full name, and who listens for a change (GH-109). */
  const settings = new Map<string, unknown>();
  const configListeners: ((e: { affectsConfiguration(s: string): boolean }) => void)[] = [];
  /** A quick pick built by hand: shown, it's dismissed at once, as by Escape. */
  const quickPick = () => {
    const hidden: (() => void)[] = [];
    return {
      title: '', placeholder: '', items: [] as unknown[], selectedItems: [] as unknown[], value: '', busy: false, canSelectMany: false,
      onDidChangeValue: () => disposable, onDidAccept: () => disposable,
      onDidHide: (l: () => void) => { hidden.push(l); return disposable; },
      show() { calls.prompts++; queueMicrotask(() => { for (const l of hidden) l(); }); },
      hide() { for (const l of hidden) l(); },
      dispose() {},
    };
  };
  const api = {
    EventEmitter, TreeItem, MarkdownString, Disposable,
    RelativePattern: class { base: unknown; pattern: string; constructor(base: unknown, pattern: string) { this.base = base; this.pattern = pattern; } },
    ViewColumn: { Active: -1, One: 1, Beside: -2 },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    ThemeIcon: class { id: string; constructor(id: string) { this.id = id; } },
    ThemeColor: class { id: string; constructor(id: string) { this.id = id; } },
    Uri: {
      file: (p: string) => ({ fsPath: p, toString: () => `file://${p}` }),
      parse: (p: string) => ({ fsPath: p, toString: () => p }),
      joinPath: (u: { fsPath: string }, ...parts: string[]) => ({ fsPath: join(u.fsPath, ...parts), toString: () => `file://${join(u.fsPath, ...parts)}` }),
    },
    window: {
      createOutputChannel: () => ({ info() {}, warn() {}, error() {}, show() {}, dispose() {}, appendLine() {}, trace() {}, debug() {} }),
      // The setup item is the one checked; GitHub and the tasks summary (D-044) are items of their own.
      createStatusBarItem: (id?: unknown) => {
        if (id === 'acc.github' || id === 'acc.summary') return { show() {}, hide() {}, dispose() {} };
        if (typeof id === 'string' && id.startsWith('acc.autopilot')) { const it = item(); autopilot.push(it); return it; }
        return status;
      },
      onDidChangeWindowState: () => disposable,
      state: { focused: true },
      withProgress: (_o: unknown, task: (p: unknown, t: unknown) => unknown) => task({ report() {} }, { isCancellationRequested: false, onCancellationRequested: () => disposable }),
      showInformationMessage: async (m: string) => { calls.info.push(m); return undefined; },
      showWarningMessage: async (m: string, ...rest: unknown[]) => { calls.warn.push(m); return calls.warnPick?.(rest.filter((x): x is string => typeof x === 'string')); },
      showErrorMessage: async (m: string) => { calls.error.push(m); return undefined; },
      showQuickPick: async (items: unknown) => { calls.prompts++; return calls.pick?.(await (items as Promise<{ value?: string }[]>)); },
      createQuickPick: quickPick,
      showOpenDialog: async () => { calls.prompts++; return undefined; },
      createTerminal: () => ({ show() {}, sendText: (t: string) => calls.terminal.push(t), dispose() {}, exitStatus: undefined }),
      onDidEndTerminalShellExecution: event(),
      onDidCloseTerminal: event(),
      onDidChangeActiveTextEditor: event(),
      activeTextEditor: undefined,
      terminals: [] as unknown[],
      createTreeView: (id: string, o: { treeDataProvider: never }) => {
        trees.set(id, o.treeDataProvider);
        const shown: ((e: { visible: boolean }) => void)[] = [];
        treeShown.set(id, shown);
        return { visible: false, onDidChangeVisibility: (l: (e: { visible: boolean }) => void) => { shown.push(l); return disposable; }, badge: undefined, dispose() {} };
      },
      showInputBox: async () => { calls.prompts++; return undefined; },
      createWebviewPanel: (viewType: string, title: string, column: unknown) => {
        const panel = {
          get visible() { return rec.visible; }, iconPath: undefined, title: '', reveal() { rec.revealed++; }, dispose() {},
          onDidChangeViewState: (l: (e: unknown) => void) => { rec.views.push(l); return disposable; }, onDidDispose: (l: () => void) => { rec.close = l; return disposable; },
          webview: {
            cspSource: 'vscode-resource:', asWebviewUri: (u: { toString(): string }) => u, options: {},
            set html(v: string) { rec.html = v; rec.htmlSets++; }, get html() { return rec.html; },
            postMessage: async (m: unknown) => { rec.posted.push(m); return true; },
            onDidReceiveMessage: (l: (m: unknown) => void) => { rec.receive = l; return disposable; },
          },
        };
        const rec: Tab = { viewType, title, column, revealed: 0, html: '', htmlSets: 0, posted: [], visible: true, views: [], hide() { rec.visible = false; for (const l of rec.views) l({ webviewPanel: panel }); } };
        panels.push(rec);
        return panel;
      },
      showTextDocument: async () => undefined,
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: folder }, name: 'repo', index: 0 }],
      getWorkspaceFolder: () => undefined,
      createFileSystemWatcher: (pattern: unknown) => { calls.watched.push(pattern); return { onDidChange: event(), onDidCreate: event(), onDidDelete: event(), dispose() {} }; },
      onDidChangeWorkspaceFolders: event(),
      openTextDocument: async () => ({}),
      getConfiguration: (section: string) => ({
        get: (key: string, fallback?: unknown) => settings.get(`${section}.${key}`) ?? fallback,
        update: async (key: string, value: unknown) => {
          settings.set(`${section}.${key}`, value);
          for (const l of configListeners) l({ affectsConfiguration: (s: string) => s === section || s === `${section}.${key}` });
        },
      }),
      onDidChangeConfiguration: (l: (typeof configListeners)[number]) => { configListeners.push(l); return disposable; },
    },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    commands: {
      registerCommand: (id: string, fn: (...a: unknown[]) => unknown) => { calls.commands.set(id, fn); return disposable; },
      executeCommand: async (id: string, ...args: unknown[]) => { calls.executed.push([id, args]); if (id === 'setContext') calls.contexts.set(args[0] as string, args[1]); return undefined; },
    },
    // No other extension is installed, and no account is signed in.
    extensions: { getExtension: () => undefined },
    // Asked to sign in, the person closes it, which VSCode reports by rejecting, or signs in as calls.signsInAs; asked quietly, there's none.
    authentication: {
      getSession: async (_p: string, scopes: string[], o?: { createIfNone?: boolean }) => {
        if (!o?.createIfNone) return undefined;
        if (calls.signsInAs === undefined) throw new Error('User did not consent to login.');
        return { id: 'session', accessToken: 'token', account: { id: calls.signsInAs, label: calls.signsInAs }, scopes };
      },
    },
    env: { uriScheme: 'vscode', openExternal: async (u: { toString(): string }) => { calls.opened.push(String(u)); return true; }, clipboard: { writeText: async (t: string) => { calls.copied.push(t); }, readText: async () => '' } },
    // VSCode's own version, as Report a problem attaches it (T-118).
    version: '1.105.1',
  };
  return { api: strict(api), calls, status, trees, treeShown, panels, autopilot, settings };
}

export function memento(initial: Record<string, unknown> = {}) {
  const m = new Map(Object.entries(initial));
  return { get: (k: string, fallback?: unknown) => m.get(k) ?? fallback, update: async (k: string, v: unknown) => { m.set(k, v); }, keys: () => [...m.keys()] };
}

/** Polls fn until it holds. Past ms it throws, naming what it waited for when given (T-51). */
export async function until(fn: () => boolean, ms = 20_000, what?: string): Promise<void> {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out after ${ms} ms${what ? ` waiting for ${what}` : ''}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** The tools a sandbox stands in for, each one a script on its PATH. */
export const SANDBOX_TOOLS = ['gh', 'claude', 'sf', 'code', 'open', 'osascript', 'caffeinate'] as const;

/**
 * A sandbox for the built extension, made by a test in place of the machine's own (T-70): a home with an
 * empty Claude config, acc's state folders, and a stand-in for each of SANDBOX_TOOLS, which runs
 * `tool(name, at)` (by default it fails at once). It points the process's environment at them and clears
 * ACC_ROLE and ACC_TASK; restore() gives the environment back as it was, dropping what was added.
 */
export function sandboxEnv(prefix: string, tool: (name: string, at: (...p: string[]) => string) => string = () => 'exit 1\n'): { at: (...p: string[]) => string; restore: () => void } {
  const sandbox = realpathSync(tempDir(prefix));
  const at = (...p: string[]) => join(sandbox, ...p);
  for (const d of ['home/.claude', 'state/questions', 'state/heavy', 'state/slack', 'bin']) mkdirSync(at(d), { recursive: true });
  writeFileSync(at('home', '.claude.json'), '{"projects":{}}\n');
  for (const name of SANDBOX_TOOLS) {
    standIn(at('bin', name), `#!/bin/sh\n${tool(name, at)}`);
  }
  const saved = { ...process.env };
  Object.assign(process.env, {
    HOME: at('home'), USERPROFILE: at('home'), CLAUDE_CONFIG_DIR: at('home', '.claude'), PATH: `${at('bin')}${delimiter}${process.env.PATH}`, NO_COLOR: '1',
    ACC_QUESTIONS_DIR: at('state', 'questions'), ACC_HEAVY_DIR: at('state', 'heavy'), ACC_MACHINE_FILE: at('state', 'machine.json'), ACC_REPOS_FILE: at('state', 'repos.json'),
    ACC_RUNTIME_FILE: at('state', 'runtime'), ACC_SLACK_DIR: at('state', 'slack'),
  });
  delete process.env.ACC_ROLE;
  delete process.env.ACC_TASK;
  const restore = (): void => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  };
  return { at, restore };
}

/**
 * Loads the built extension (its dist/extension.js, which each test names, so acc counts it near the
 * extension's modules) against the fake, and activates it on a context like VSCode's. stop() disposes what it
 * started, so its polls end, and gives require('vscode') back.
 */
export function activate(dist: string, fake: ReturnType<typeof fakeVscode>, globalState: Record<string, unknown> = {}) {
  const extDir = join(dist, '..', '..');
  const load = (Module as unknown as { _load: (r: string, ...a: unknown[]) => unknown })._load;
  (Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
    return request === 'vscode' ? fake.api : load.call(this, request, ...rest);
  };
  const prepends: [string, string][] = [];
  const secrets = new Map<string, string>();
  const secretsAsked = new Set<string>();
  const ctx = {
    subscriptions: [] as unknown[],
    asAbsolutePath: (p: string) => join(extDir, p),
    extensionUri: { fsPath: extDir, toString: () => `file://${extDir}` },
    extensionPath: extDir,
    globalState: memento(globalState),
    workspaceState: memento(),
    // Tracker sign-ins, none to start with, and the keys asked for; a change from another window is listened for (GH-79).
    secrets: {
      get: async (k: string) => { secretsAsked.add(k); return secrets.get(k); }, store: async (k: string, v: string) => { secrets.set(k, v); },
      delete: async (k: string) => { secrets.delete(k); }, onDidChange: () => ({ dispose: () => {} }),
    },
    environmentVariableCollection: { description: '', prepend: (k: string, v: string) => prepends.push([k, v]) },
  };
  const ext = createRequire(import.meta.url)(dist) as { activate(c: unknown): void; deactivate?(): unknown };
  ext.activate(ctx);
  return {
    ctx, prepends, secrets, secretsAsked,
    stop() {
      for (const s of ctx.subscriptions as { dispose?: () => void }[]) s.dispose?.();
      ext.deactivate?.();
      (Module as unknown as { _load: unknown })._load = load;
    },
  };
}
