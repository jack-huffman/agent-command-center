// Loads the built extension with a stand-in for the vscode API, so activation, commands and context
// keys are tested without a VSCode window. Run after npm run build.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Module, { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../src/logic.ts';
import { makeRepo } from '../../packages/core/test/support.ts';

const dist = fileURLToPath(new URL('../dist/extension.js', import.meta.url));
// The extension says it's listening for agents' questions (D-030); keep that out of the real ~/.acc.
process.env.ACC_QUESTIONS_DIR = mkdtempSync(join(tmpdir(), 'acc-questions-'));
// The extension runs acc as the person at VSCode, even when these tests run in a builder's session.
delete process.env.ACC_ROLE;
delete process.env.ACC_TASK;
const disposable = { dispose() {} };
const event = () => () => disposable;

function fakeVscode(folder: string) {
  const calls = {
    commands: new Map<string, (...a: unknown[]) => unknown>(), contexts: new Map<string, unknown>(), info: [] as string[], warn: [] as string[], terminal: [] as string[],
    /** What a quick pick answers, when a test wants it to. */
    pick: undefined as ((items: { value?: string }[]) => unknown) | undefined,
  };
  type Item = { text: string; tooltip: string; command: unknown; name: string; shown: boolean; show(): void; hide(): void; dispose(): void };
  const item = (): Item => ({ text: '', tooltip: '', command: undefined, name: '', shown: false, show() { this.shown = true; }, hide() { this.shown = false; }, dispose() {} });
  /** Autopilot's switches (D-064), one a repo, apart from the setup item the test checks. */
  const autopilot: Item[] = [];
  const status = { text: '', tooltip: '', command: '', backgroundColor: undefined as unknown, name: '', shown: false, show() { this.shown = true; }, hide() { this.shown = false; }, dispose() {} };
  const trees = new Map<string, { getChildren(e?: unknown): unknown[]; getTreeItem(e: unknown): { label: string; description?: string } }>();
  class EventEmitter { private ls: ((e: unknown) => void)[] = []; event = (l: (e: unknown) => void) => { this.ls.push(l); return disposable; }; fire(e?: unknown) { for (const l of this.ls) l(e); } dispose() {} }
  class TreeItem { label: string; collapsibleState: number; [k: string]: unknown; constructor(label: string, state = 0) { this.label = label; this.collapsibleState = state; } }
  class MarkdownString { value: string; supportThemeIcons = false; constructor(v = '') { this.value = v; } }
  const panels: { html: string; posted: unknown[]; receive?: (m: unknown) => void }[] = [];
  const api = {
    EventEmitter, TreeItem, MarkdownString,
    ViewColumn: { Active: -1 },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    ThemeIcon: class { id: string; constructor(id: string) { this.id = id; } },
    ThemeColor: class { id: string; constructor(id: string) { this.id = id; } },
    Uri: {
      file: (p: string) => ({ fsPath: p, toString: () => `file://${p}` }),
      parse: (p: string) => ({ fsPath: p }),
      joinPath: (u: { fsPath: string }, ...parts: string[]) => ({ fsPath: join(u.fsPath, ...parts), toString: () => `file://${join(u.fsPath, ...parts)}` }),
    },
    window: {
      createOutputChannel: () => ({ info() {}, warn() {}, error() {}, show() {}, dispose() {} }),
      // The setup item is the one checked; GitHub and the tasks summary (D-044) are items of their own.
      createStatusBarItem: (id?: unknown) => {
        if (id === 'acc.github' || id === 'acc.summary') return { show() {}, hide() {}, dispose() {} };
        if (typeof id === 'string' && id.startsWith('acc.autopilot')) { const it = item(); autopilot.push(it); return it; }
        return status;
      },
      onDidChangeWindowState: () => disposable,
      state: { focused: true },
      withProgress: (_o: unknown, task: (p: unknown, t: unknown) => unknown) => task({ report() {} }, { onCancellationRequested: () => disposable }),
      showInformationMessage: async (m: string) => { calls.info.push(m); return undefined; },
      showWarningMessage: async (m: string) => { calls.warn.push(m); return undefined; },
      showQuickPick: async (items: unknown) => calls.pick?.(await (items as Promise<{ value?: string }[]>)),
      createTerminal: () => ({ show() {}, sendText: (t: string) => calls.terminal.push(t), exitStatus: undefined }),
      onDidEndTerminalShellExecution: event(),
      onDidCloseTerminal: event(),
      onDidChangeActiveTextEditor: event(),
      activeTextEditor: undefined,
      createTreeView: (id: string, o: { treeDataProvider: never }) => { trees.set(id, o.treeDataProvider); return { visible: false, onDidChangeVisibility: event(), badge: undefined, dispose() {} }; },
      showInputBox: async () => undefined,
      createWebviewPanel: () => {
        const rec: { html: string; posted: unknown[]; receive?: (m: unknown) => void } = { html: '', posted: [] };
        panels.push(rec);
        return {
          visible: true, iconPath: undefined, reveal() {}, dispose() {},
          onDidChangeViewState: event(), onDidDispose: event(),
          webview: {
            cspSource: 'vscode-resource:', asWebviewUri: (u: { toString(): string }) => u,
            set html(v: string) { rec.html = v; }, get html() { return rec.html; },
            postMessage: async (m: unknown) => { rec.posted.push(m); return true; },
            onDidReceiveMessage: (l: (m: unknown) => void) => { rec.receive = l; return disposable; },
          },
        };
      },
      showTextDocument: async () => undefined,
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: folder }, name: 'repo', index: 0 }],
      getWorkspaceFolder: () => undefined,
      createFileSystemWatcher: () => ({ onDidChange: event(), onDidCreate: event(), onDidDelete: event(), dispose() {} }),
      onDidChangeWorkspaceFolders: event(),
      openTextDocument: async () => ({}),
    },
    commands: {
      registerCommand: (id: string, fn: (...a: unknown[]) => unknown) => { calls.commands.set(id, fn); return disposable; },
      executeCommand: async (id: string, ...args: unknown[]) => { if (id === 'setContext') calls.contexts.set(args[0] as string, args[1]); return undefined; },
    },
    env: { openExternal: async () => true, clipboard: { writeText: async () => {} } },
  };
  return { api, calls, status, trees, panels, autopilot };
}

function memento(initial: Record<string, unknown> = {}) {
  const m = new Map(Object.entries(initial));
  return { get: (k: string) => m.get(k), update: async (k: string, v: unknown) => { m.set(k, v); }, keys: () => [...m.keys()] };
}

async function until(fn: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('activation registers the commands, adds acc to PATH, and ticks the steps that pass', { timeout: 60_000 }, async () => {
  const repo = makeRepo({ '.acc/config.json': JSON.stringify({ schema: 1, project: 'Tool', environments: [{ name: 'main', default: true }], trackers: [{ kind: 'github' }] }), '.gitignore': '.claude/worktrees/\n' });
  // Claude Code state that trusts the repo, as accepting the prompt once leaves it (B12.trust).
  const claudeDir = mkdtempSync(join(tmpdir(), 'claude-state-'));
  writeFileSync(join(claudeDir, '.claude.json'), JSON.stringify({ projects: { [realpathSync(repo)]: { hasTrustDialogAccepted: true } } }));
  const savedClaudeDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = claudeDir;
  const { api, calls, status, trees, panels, autopilot } = fakeVscode(repo);
  const load = (Module as unknown as { _load: (r: string, ...a: unknown[]) => unknown })._load;
  (Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
    return request === 'vscode' ? api : load.call(this, request, ...rest);
  };
  const prepends: [string, string][] = [];
  const extDir = join(dist, '..', '..');
  const ctx = {
    subscriptions: [] as unknown[],
    asAbsolutePath: (p: string) => join(extDir, p),
    extensionUri: { fsPath: extDir, toString: () => `file://${extDir}` },
    // Fresh machine results, so the test doesn't call slow machine CLIs.
    globalState: memento({ 'acc.welcomed': true, 'acc.machineItems': { at: Date.now(), items: [{ id: 'A1.git', part: 'machine', title: 'git', status: 'pass', detail: 'git 2.54.0' }] } }),
    workspaceState: memento(),
    environmentVariableCollection: { description: '', prepend: (k: string, v: string) => prepends.push([k, v]) },
  };
  try {
    const ext = createRequire(import.meta.url)(dist) as { activate(c: unknown): void };
    ext.activate(ctx);
    for (const c of Object.values(COMMANDS)) assert.ok(calls.commands.has(c), `${c} registered`);
    assert.equal(prepends[0]?.[0], 'PATH');
    assert.match(prepends[0]![1], /extension\/dist\/bin:$/);

    // The full setup pass, not just an early single-step re-check (B14 re-checks as soon as projects load).
    await until(() => calls.contexts.get('acc.profile') === 'generic' && calls.contexts.has('acc.step.B0.config') && calls.contexts.has('acc.step.A1.git')).catch((e) => {
      throw new Error(`${e.message}. Contexts: ${JSON.stringify([...calls.contexts])}. Warnings: ${JSON.stringify(calls.warn)}. Info: ${JSON.stringify(calls.info)}`);
    });
    assert.equal(calls.contexts.get('acc.step.B0.config'), true);
    assert.equal(calls.contexts.get('acc.step.B0.repo'), true);
    assert.equal(calls.contexts.get('acc.step.A1.git'), true, 'reused machine results are applied');
    assert.equal(status.shown, true);
    assert.equal(status.text, '$(check) Setup done');

    // The sidebar is one launcher listing the page's sections (D-029).
    assert.deepEqual([...trees.keys()], ['acc.home']);
    await until(() => calls.contexts.get('acc.hasProject') === true);
    const launcher = trees.get('acc.home')!;
    assert.deepEqual((launcher.getChildren() as { section: string }[]).map((n) => n.section), ['overview', 'tasks', 'agents', 'worktrees', 'environments', 'setup']);
    const accBin = join(extDir, 'dist', 'bin', 'acc');
    const added = spawnSync(process.execPath, [accBin, 'add', 'Try the page'], { cwd: repo, encoding: 'utf8' });
    assert.equal(added.status, 0, added.stderr);
    await calls.commands.get('acc.tasks.refresh')!();

    // The page, opened at Tasks: a strict CSP, and every section's data arrives once it's ready.
    await calls.commands.get('acc.open.tasks')!();
    const tab = panels[0]!;
    assert.match(tab.html, /Content-Security-Policy" content="default-src 'none'; [^"]*script-src 'nonce-[A-Za-z0-9+/=]+'/);
    assert.doesNotMatch(tab.html, /unsafe-inline|unsafe-eval/);
    assert.match(tab.html, /<script nonce="[A-Za-z0-9+/=]+" src=/);
    assert.match(tab.html, /data-view="home"/);
    tab.receive!({ type: 'ready' });
    type Posted = { model: { kind: string; section: string; overview: { ready: { id: string }[] }; tasks: { projects: { root: string; columns: { group: string; cards: { id: string }[] }[] }[] }; environments: { projects: { envs: { name: string }[] }[] } } };
    const state = tab.posted.at(-1) as Posted;
    assert.deepEqual([state.model.kind, state.model.section], ['home', 'tasks']);
    assert.deepEqual(state.model.tasks.projects[0]!.columns.find((c) => c.group === 'ready')!.cards.map((c) => c.id), ['T-1']);
    assert.deepEqual(state.model.overview.ready.map((r) => r.id), ['T-1'], 'the Overview offers it to dispatch');
    assert.equal(state.model.environments.projects[0]!.envs[0]!.name, 'main');

    await calls.commands.get('acc.open.agents')!();
    assert.equal(panels.length, 1, 'one page: opening a section reveals it there');
    assert.equal((tab.posted.at(-1) as Posted).model.section, 'agents');
    tab.receive!({ type: 'run', command: 'workbench.action.quit', ref: {} });

    // Every answer sent from a page gets a reply, so it never stays on "Sending your answer…" (D-059).
    type Done = { type: string; action: string; ok: boolean; error?: string; task: string; question: string };
    const reply = async (page: (typeof panels)[number], project: string, task: string): Promise<Done> => {
      const from = page.posted.length;
      const done = () => page.posted.slice(from).find((x) => (x as Done).type === 'done') as Done | undefined;
      page.receive!({ type: 'analysis-answer', project, task, question: 'q1', text: 'Yes.' });
      await until(() => !!done());
      return done()!;
    };
    const root = state.model.tasks.projects[0]!.root;
    const away = await reply(tab, '/nowhere', 'T-1');
    assert.deepEqual([away.action, away.ok, away.task, away.question], ['analysis-answer', false, 'T-1', 'q1']);
    assert.match(away.error ?? '', /isn't open/, 'a project that isn\'t open says so');
    assert.match((await reply(tab, root, 'T-1')).error ?? '', /hasn't been analyzed/, 'acc\'s refusal comes back');
    tab.receive!({ type: 'ticket', project: root, tracker: null, key: 'T-1' });
    const page = panels[1]!;
    page.receive!({ type: 'ready' });
    assert.match((await reply(page, root, 'T-2')).error ?? '', /isn't for this task/, 'the task\'s page answers only its own questions');
    assert.match((await reply(page, root, 'T-1')).error ?? '', /hasn't been analyzed/);

    // Autopilot (D-064): a switch for the repo, hidden while its autonomy is manual, and off until clicked.
    assert.ok(calls.commands.has('acc.autopilot.toggle') && calls.commands.has('acc.autopilot.output'));
    assert.equal(autopilot.length, 1, 'one switch a repo');
    assert.equal(autopilot[0]!.shown, false, 'manual: no switch');
    const click = autopilot[0]!.command as { command: string; arguments: string[] };
    assert.equal(click.command, 'acc.autopilot.toggle');
    assert.match(click.arguments[0]!, /\/acc\/ledger\.json$/, 'the switch names its repo by its ledger');
    // Changing autonomy goes through acc, which writes the config; then the switch shows, off.
    calls.pick = (items) => items.find((i) => i.value === 'review');
    await calls.commands.get('acc.agents.autonomy')!(root);
    calls.pick = undefined;
    assert.equal(JSON.parse(readFileSync(join(repo, '.acc', 'config.json'), 'utf8')).autonomy, 'review');
    assert.match(calls.info.at(-1) ?? '', /^Autonomy is review\. Changed in \.acc\/config\.json: commit it to share it\./);
    assert.equal(autopilot[0]!.shown, true);
    // No "github" section, so it can't land anything: off, and its tooltip says why in acc's words.
    assert.equal(autopilot[0]!.text, '$(circle-slash) Autopilot: off');
    assert.match(autopilot[0]!.tooltip, /^Autopilot can't run for Tool: Autopilot lands reviewed work as pull requests on GitHub, and this project has no "github" section/);
    const warned = calls.warn.length;
    await calls.commands.get('acc.autopilot.toggle')!();
    assert.match(calls.warn[warned] ?? '', /no "github" section/, 'a click says why, and starts nothing');

    await calls.commands.get(COMMANDS.check)!('B0.repo');
    assert.match(calls.info.at(-1) ?? '', /^✓ Inside the project's repo: Repo at /);
  } finally {
    for (const s of ctx.subscriptions as { dispose?: () => void }[]) s.dispose?.();
    if (savedClaudeDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = savedClaudeDir;
    (Module as unknown as { _load: unknown })._load = load;
  }
});
