// Loads the built extension with a stand-in for the vscode API, so activation, commands and context
// keys are tested without a VSCode window. Run after npm run build.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
// It records its runtime for acc's launcher (D-077); that goes here too, not in the real ~/.acc.
const RUNTIME_FILE = join(mkdtempSync(join(tmpdir(), 'acc-runtime-')), 'runtime');
process.env.ACC_RUNTIME_FILE = RUNTIME_FILE;
// And Slack's claims (GH-58), which it prunes at start.
process.env.ACC_SLACK_DIR = mkdtempSync(join(tmpdir(), 'acc-slack-'));
// The extension runs acc as the person at VSCode, even when these tests run in a builder's session.
delete process.env.ACC_ROLE;
delete process.env.ACC_TASK;
const disposable = { dispose() {} };
const event = () => () => disposable;

function fakeVscode(folder: string) {
  const calls = {
    commands: new Map<string, (...a: unknown[]) => unknown>(), contexts: new Map<string, unknown>(), info: [] as string[], warn: [] as string[], terminal: [] as string[],
    /** Every command the extension ran, with what it passed. */
    executed: [] as [string, unknown[]][],
    /** Every file watcher's pattern. */
    watched: [] as unknown[],
    /** What a quick pick answers, when a test wants it to. */
    pick: undefined as ((items: { value?: string }[]) => unknown) | undefined,
    /** How many prompts at the top of VSCode were shown: input boxes and quick picks. */
    prompts: 0,
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
  /** Each editor tab: what it was sent, what it says back, and closing it. */
  const panels: { html: string; posted: unknown[]; receive?: (m: unknown) => void; close?: () => void }[] = [];
  const api = {
    EventEmitter, TreeItem, MarkdownString,
    RelativePattern: class { base: unknown; pattern: string; constructor(base: unknown, pattern: string) { this.base = base; this.pattern = pattern; } },
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
      showQuickPick: async (items: unknown) => { calls.prompts++; return calls.pick?.(await (items as Promise<{ value?: string }[]>)); },
      createTerminal: () => ({ show() {}, sendText: (t: string) => calls.terminal.push(t), exitStatus: undefined }),
      onDidEndTerminalShellExecution: event(),
      onDidCloseTerminal: event(),
      onDidChangeActiveTextEditor: event(),
      activeTextEditor: undefined,
      createTreeView: (id: string, o: { treeDataProvider: never }) => { trees.set(id, o.treeDataProvider); return { visible: false, onDidChangeVisibility: event(), badge: undefined, dispose() {} }; },
      showInputBox: async () => { calls.prompts++; return undefined; },
      createWebviewPanel: () => {
        const rec: (typeof panels)[number] = { html: '', posted: [] };
        panels.push(rec);
        return {
          visible: true, iconPath: undefined, reveal() {}, dispose() {},
          onDidChangeViewState: event(), onDidDispose: (l: () => void) => { rec.close = l; return disposable; },
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
      createFileSystemWatcher: (pattern: unknown) => { calls.watched.push(pattern); return { onDidChange: event(), onDidCreate: event(), onDidDelete: event(), dispose() {} }; },
      onDidChangeWorkspaceFolders: event(),
      openTextDocument: async () => ({}),
    },
    commands: {
      registerCommand: (id: string, fn: (...a: unknown[]) => unknown) => { calls.commands.set(id, fn); return disposable; },
      executeCommand: async (id: string, ...args: unknown[]) => { calls.executed.push([id, args]); if (id === 'setContext') calls.contexts.set(args[0] as string, args[1]); return undefined; },
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
    // Fresh machine results for this folder's profile, so the test doesn't call slow machine CLIs.
    globalState: memento({ 'acc.welcomed': true, 'acc.machineItems': { at: Date.now(), profile: 'generic', items: [{ id: 'A1.git', part: 'machine', title: 'git', status: 'pass', detail: 'git 2.54.0' }] } }),
    workspaceState: memento(),
    environmentVariableCollection: { description: '', prepend: (k: string, v: string) => prepends.push([k, v]) },
  };
  try {
    const ext = createRequire(import.meta.url)(dist) as { activate(c: unknown): void };
    ext.activate(ctx);
    for (const c of Object.values(COMMANDS)) assert.ok(calls.commands.has(c), `${c} registered`);
    // Setup watches each folder's own root, never every file of those names below it, a builder's worktree's included.
    const setupWatch = calls.watched.find((p) => typeof p === 'object' && p !== null && String((p as { pattern: string }).pattern).includes('.acc/config.json')) as { base: { uri: { fsPath: string } }; pattern: string } | undefined;
    assert.ok(setupWatch, 'a watcher for the setup files');
    assert.ok(!setupWatch!.pattern.startsWith('**/'), 'only at the folder\'s root');
    assert.ok(!calls.watched.some((p) => typeof p === 'string' && p.includes('.acc/config.json')), 'no workspace-wide glob');
    assert.equal(prepends[0]?.[0], 'PATH');
    assert.match(prepends[0]![1], /extension\/dist\/bin:$/);
    assert.equal(readFileSync(RUNTIME_FILE, 'utf8'), `${process.execPath}\n`, 'acc\'s launcher can use this runtime where node isn\'t on PATH');

    // The full setup pass, not just an early single-step re-check (B14 re-checks as soon as projects load).
    await until(() => calls.contexts.get('acc.profile') === 'generic' && calls.contexts.has('acc.step.B0.config') && calls.contexts.has('acc.step.A1.git')).catch((e) => {
      throw new Error(`${e.message}. Contexts: ${JSON.stringify([...calls.contexts])}. Warnings: ${JSON.stringify(calls.warn)}. Info: ${JSON.stringify(calls.info)}`);
    });
    assert.equal(calls.contexts.get('acc.step.B0.config'), true);
    assert.equal(calls.contexts.get('acc.step.B0.repo'), true);
    assert.equal(calls.contexts.get('acc.step.A1.git'), true, 'reused machine results are applied');
    // Setup speaks through the one status bar item now (D-065): its own stays hidden.
    assert.equal(status.shown, false);

    // The sidebar is one launcher listing the page's sections (D-029).
    assert.deepEqual([...trees.keys()], ['acc.home']);
    await until(() => calls.contexts.get('acc.hasProject') === true);
    const launcher = trees.get('acc.home')!;
    assert.deepEqual((launcher.getChildren() as { section: string }[]).map((n) => n.section), ['overview', 'tasks', 'agents', 'worktrees', 'environments', 'setup']);
    // The extension runs the bundle itself; terminals get the launcher beside it.
    const accBin = join(extDir, 'dist', 'bin', 'acc.mjs');
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

    // So does every Post, Discard and Send to the client (D-066): acc's refusal, or why not, comes back.
    const updated = async (on: (typeof panels)[number], m: Record<string, unknown>): Promise<Done & { id?: string }> => {
      const from = on.posted.length;
      const done = () => on.posted.slice(from).find((x) => (x as Done).type === 'done') as (Done & { id?: string }) | undefined;
      on.receive!(m);
      await until(() => !!done());
      return done()!;
    };
    const gone = await updated(tab, { type: 'update-discard', project: '/nowhere', id: 'T-1.1' });
    assert.deepEqual([gone.action, gone.ok, gone.id], ['update-discard', false, 'T-1.1']);
    assert.match(gone.error ?? '', /isn't open/);
    assert.match((await updated(tab, { type: 'update-discard', project: root, id: 'T-1.1' })).error ?? '', /No update T-1\.1/);
    assert.match((await updated(tab, { type: 'update-post', project: root, id: 'T-1.1', text: 'Hello' })).error ?? '', /isn't there any more/);
    assert.match((await updated(tab, { type: 'update-ask', project: root, task: 'T-1', question: 'q1' })).error ?? '', /hasn't been analyzed/);
    assert.match((await updated(page, { type: 'update-post', project: root, id: 'T-2.1', text: 'Hello' })).error ?? '', /isn't for this task/, 'the task\'s page posts only its own updates');
    assert.match((await updated(page, { type: 'update-discard', project: root, id: 'T-1.1' })).error ?? '', /No update T-1\.1/);

    // An edit on the task's page is what the Overview shows, and the Overview's Post can't send acc's text
    // instead (GH-46). The drafts are acc's files, as acc sync leaves them.
    const store = join(repo, '.git', 'acc', 'updates');
    mkdirSync(store, { recursive: true });
    const said = 'The change was approved and merged into main.';
    const draft = (id: string, extra: Record<string, unknown> = {}) => writeFileSync(join(store, `${id}.json`), JSON.stringify({
      v: 1, id, task: id.slice(0, id.lastIndexOf('.')), tracker: 'github', key: `#${id.split('-')[1]!.split('.')[0]}`, url: null, event: 'merged', env: 'main', text: said, state: 'draft', createdAt: new Date().toISOString(), by: 'acc sync', ...extra,
    }));
    draft('T-1.1');
    draft('T-2.1');
    await calls.commands.get('acc.tasks.refresh')!();
    type Row = { look: { label: string; icon: string; tone: string }; actions: { label: string; primary?: boolean }[]; update?: { id: string; edited: string | null } };
    const rows = () => ((tab.posted.filter((x) => (x as Posted).model).at(-1) as { model: { overview: { attention: Row[] } } }).model.overview.attention.filter((a) => a.update));
    const look = (id: string) => { const r = rows().find((a) => a.update!.id === id); return r && [r.look.label, r.update!.edited, r.actions.map((a) => `${a.label}${a.primary ? '*' : ''}`).join(',')]; };
    await until(() => rows().length === 2);
    assert.deepEqual(look('T-1.1'), ['Draft update', null, 'Edit']);
    page.receive!({ type: 'update-edit', project: root, id: 'T-1.1', text: 'Merged into main: try it there.' });
    await until(() => look('T-1.1')?.[0] === 'Edited on the task page');
    assert.deepEqual(look('T-1.1'), ['Edited on the task page', 'Merged into main: try it there.', 'Edit*'], 'the edit, and Edit leads');
    // A row drawn before the edit arrived still offers Post: acc's text is refused, and nothing is posted.
    const refused = await updated(tab, { type: 'update-post', project: root, id: 'T-1.1', text: said });
    assert.deepEqual([refused.action, refused.ok, refused.id], ['update-post', false, 'T-1.1']);
    assert.match(refused.error ?? '', /edited on the task page, so post it from there/);
    assert.equal(JSON.parse(readFileSync(join(store, 'T-1.1.json'), 'utf8')).state, 'draft', 'nothing was claimed or posted');
    // The page edits only its own task's updates.
    page.receive!({ type: 'update-edit', project: root, id: 'T-2.1', text: 'Not this page\'s.' });
    assert.deepEqual(look('T-2.1'), ['Draft update', null, 'Edit']);

    // acc drafts the same news again while the page is hidden: the newer draft is still edited there.
    draft('T-1.2', { replaces: ['T-1.1'] });
    rmSync(join(store, 'T-1.1.json'));
    await calls.commands.get('acc.tasks.refresh')!();
    await until(() => !!look('T-1.2'));
    assert.deepEqual(look('T-1.2'), ['Edited on the task page', 'Merged into main: try it there.', 'Edit*'], 'found through the draft it replaced');
    // Back on screen, the page carries its edit to the newer draft; typed back to acc's text, it's gone.
    page.receive!({ type: 'update-edit', project: root, id: 'T-1.2', text: 'Merged into main: have a look.' });
    await until(() => look('T-1.2')?.[1] === 'Merged into main: have a look.');
    page.receive!({ type: 'update-edit', project: root, id: 'T-1.2', text: null });
    await until(() => look('T-1.2')?.[0] === 'Draft update');
    assert.deepEqual(look('T-1.2'), ['Draft update', null, 'Edit'], 'the replaced draft\'s edit went with it');
    // Closing the page drops its edit too (D-066).
    page.receive!({ type: 'update-edit', project: root, id: 'T-1.2', text: 'One more go.' });
    await until(() => look('T-1.2')?.[0] === 'Edited on the task page');
    page.close!();
    await until(() => look('T-1.2')?.[0] === 'Draft update');

    // Autopilot (D-064): a switch for the repo, hidden while its autonomy is manual, and off until clicked.
    assert.ok(calls.commands.has('acc.autopilot.toggle') && calls.commands.has('acc.autopilot.output'));
    // Its switch is in the one status bar item's menu (D-065), not an item of its own.
    assert.equal(autopilot.length, 0, 'autopilot makes no status bar item of its own');
    // Changing autonomy goes through acc, which writes the config.
    calls.pick = (items) => items.find((i) => i.value === 'review');
    await calls.commands.get('acc.agents.autonomy')!(root);
    calls.pick = undefined;
    assert.equal(JSON.parse(readFileSync(join(repo, '.acc', 'config.json'), 'utf8')).autonomy, 'review');
    assert.match(calls.info.at(-1) ?? '', /^Autonomy is review\. Changed in \.acc\/config\.json: commit it to share it\./);
    // No "github" section, so it can't land anything: the menu offers no switch for it.
    let offered: { label: string }[] = [];
    calls.pick = (items) => { offered = items as { label: string }[]; return undefined; };
    await calls.commands.get('acc.status.menu')!();
    calls.pick = undefined;
    assert.ok(offered.some((i) => /Open the Command Center/.test(i.label)), 'the menu opens the page');
    assert.ok(!offered.some((i) => /Turn autopilot/.test(i.label)), 'a repo whose autopilot can\'t run offers no switch');
    const warned = calls.warn.length;
    await calls.commands.get('acc.autopilot.toggle')!();
    assert.match(calls.warn[warned] ?? '', /no "github" section/, 'a click says why, and starts nothing');

    // The Jira button, on a repo with no Jira yet, connects one here with Jira chosen: never a file to edit.
    const ran = calls.executed.length;
    await calls.commands.get('acc.task.importJira')!();
    const connect = calls.executed.slice(ran).find(([id]) => id === 'acc.trackers.add');
    assert.ok(connect, 'it starts the guided connect');
    assert.deepEqual([(connect![1][0] as { kind: string }).kind, typeof (connect![1][0] as { root: string }).root], ['jira', 'string']);
    assert.ok(!calls.info.some((m) => /config\.json \("trackers"/.test(m)), 'no instructions to edit the config');

    // That connect is the Connect page in the Command Center, with Jira chosen: no prompt at the top of
    // VSCode (GH-51). So is Setup's Do it, with no argument, and a Sign in with no tracker to sign in to.
    const prompted = calls.prompts;
    type Connected = { model?: { connect: { id: string; kind: string; title: string; fields: { key: string; value: string }[] } | null } };
    const connectShown = () => (tab.posted.filter((x) => (x as Connected).model).at(-1) as Connected).model!.connect;
    for (const [command, arg] of [['acc.trackers.add', { root, kind: 'jira' }], ['acc.trackers.add', undefined], ['acc.trackers.signIn', undefined]] as const) {
      await calls.commands.get(command)!(arg);
      const c = connectShown();
      assert.deepEqual([c?.kind, c?.title], ['jira', 'Connect a tracker'], `${command} opens the page`);
      tab.receive!({ type: 'connect-cancel', session: c!.id });
      await until(() => connectShown() === null);
    }
    assert.equal(calls.prompts, prompted, 'no input box or quick pick');

    await calls.commands.get(COMMANDS.check)!('B0.repo');
    assert.match(calls.info.at(-1) ?? '', /^✓ Inside the project's repo: Repo at /);
  } finally {
    for (const s of ctx.subscriptions as { dispose?: () => void }[]) s.dispose?.();
    if (savedClaudeDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = savedClaudeDir;
    (Module as unknown as { _load: unknown })._load = load;
  }
});
