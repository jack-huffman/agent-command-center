// Loads the built extension with a stand-in for the vscode API, so activation, commands and context
// keys are tested without a VSCode window. Run after npm run build.
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../src/logic.ts';
import { makeRepo } from '../../packages/core/test/support.ts';

const dist = fileURLToPath(new URL('../dist/extension.js', import.meta.url));
const disposable = { dispose() {} };
const event = () => () => disposable;

function fakeVscode(folder: string) {
  const calls = { commands: new Map<string, (...a: unknown[]) => unknown>(), contexts: new Map<string, unknown>(), info: [] as string[], warn: [] as string[], terminal: [] as string[] };
  const status = { text: '', tooltip: '', command: '', backgroundColor: undefined as unknown, name: '', shown: false, show() { this.shown = true; }, hide() { this.shown = false; }, dispose() {} };
  const api = {
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    ThemeIcon: class { id: string; constructor(id: string) { this.id = id; } },
    ThemeColor: class { id: string; constructor(id: string) { this.id = id; } },
    Uri: { file: (p: string) => ({ fsPath: p }), parse: (p: string) => ({ fsPath: p }) },
    window: {
      createOutputChannel: () => ({ info() {}, warn() {}, error() {}, show() {}, dispose() {} }),
      createStatusBarItem: () => status,
      withProgress: (_o: unknown, task: (p: unknown, t: unknown) => unknown) => task({ report() {} }, { onCancellationRequested: () => disposable }),
      showInformationMessage: async (m: string) => { calls.info.push(m); return undefined; },
      showWarningMessage: async (m: string) => { calls.warn.push(m); return undefined; },
      showQuickPick: async () => undefined,
      createTerminal: () => ({ show() {}, sendText: (t: string) => calls.terminal.push(t), exitStatus: undefined }),
      onDidEndTerminalShellExecution: event(),
      onDidCloseTerminal: event(),
      onDidChangeActiveTextEditor: event(),
      activeTextEditor: undefined,
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: folder }, name: 'repo', index: 0 }],
      getWorkspaceFolder: () => undefined,
      createFileSystemWatcher: () => ({ onDidChange: event(), onDidCreate: event(), onDidDelete: event(), dispose() {} }),
      onDidChangeWorkspaceFolders: event(),
    },
    commands: {
      registerCommand: (id: string, fn: (...a: unknown[]) => unknown) => { calls.commands.set(id, fn); return disposable; },
      executeCommand: async (id: string, ...args: unknown[]) => { if (id === 'setContext') calls.contexts.set(args[0] as string, args[1]); return undefined; },
    },
    env: { openExternal: async () => true },
  };
  return { api, calls, status };
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

test('activation registers the commands, adds acc to PATH, and ticks the steps that pass', async () => {
  const repo = makeRepo({ '.acc/config.json': JSON.stringify({ schema: 1, project: 'Tool', environments: [{ name: 'main', default: true }] }) });
  const { api, calls, status } = fakeVscode(repo);
  const load = (Module as unknown as { _load: (r: string, ...a: unknown[]) => unknown })._load;
  (Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
    return request === 'vscode' ? api : load.call(this, request, ...rest);
  };
  const prepends: [string, string][] = [];
  const extDir = join(dist, '..', '..');
  const ctx = {
    subscriptions: [] as unknown[],
    asAbsolutePath: (p: string) => join(extDir, p),
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

    await until(() => calls.contexts.get('acc.profile') === 'generic').catch((e) => {
      throw new Error(`${e.message}. Contexts: ${JSON.stringify([...calls.contexts])}. Warnings: ${JSON.stringify(calls.warn)}. Info: ${JSON.stringify(calls.info)}`);
    });
    assert.equal(calls.contexts.get('acc.step.B0.config'), true);
    assert.equal(calls.contexts.get('acc.step.B0.repo'), true);
    assert.equal(calls.contexts.get('acc.step.A1.git'), true, 'reused machine results are applied');
    assert.equal(status.shown, true);
    assert.equal(status.text, '$(check) Setup done');

    await calls.commands.get(COMMANDS.check)!('B0.repo');
    assert.match(calls.info.at(-1) ?? '', /^✓ Inside the project's repo: Repo at /);
  } finally {
    (Module as unknown as { _load: unknown })._load = load;
  }
});
