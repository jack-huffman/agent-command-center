import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { type Config, parseConfig } from '../../packages/core/src/config.ts';
import { STEPS } from '../../packages/core/src/onboarding/steps.ts';
import type { Step } from '../../packages/core/src/onboarding/types.ts';
import {
  COMMANDS, contextKey, type DoctorItem, EXTENSION_ID, type EnvLike, hasPlaceholder, initCommand, isComplete, productionOrgs,
  setupOrgChoices, sfOpenCommand, statusText, summarize, WALKTHROUGHS,
} from './logic.ts';
import { type RunResult, runFile } from './run.ts';

const TERMINAL_NAME = 'acc setup';
/** Machine checks change rarely and call slow CLIs, so startup reuses results this fresh. */
const MACHINE_FRESH_MS = 12 * 60 * 60 * 1000;
const CONFIRMED = { machine: 'acc.confirmed.machine', project: 'acc.confirmed.project' } as const;

export class Setup implements vscode.Disposable {
  readonly log = vscode.window.createOutputChannel('Agent Command Center', { log: true });
  private readonly status = vscode.window.createStatusBarItem('acc.setup', vscode.StatusBarAlignment.Left, 0);
  private readonly items = new Map<string, DoctorItem>();
  private readonly disposables: vscode.Disposable[] = [];
  private terminal: vscode.Terminal | undefined;
  private pendingCheck: string | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private readonly accScript: string;
  private readonly guide: string;
  private readonly ctx: vscode.ExtensionContext;
  private lastFolder: string | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires when check results or confirmations change, for the Setup view. */
  readonly onDidChange = this.changed.event;

  constructor(ctx: vscode.ExtensionContext) {
    this.ctx = ctx;
    this.accScript = ctx.asAbsolutePath(join('dist', 'bin', 'acc'));
    this.guide = ctx.asAbsolutePath(join('dist', 'ONBOARDING.md'));
    this.status.name = 'Agent Command Center setup';
    this.status.command = COMMANDS.project;
    this.disposables.push(this.log, this.status, this.changed);
    this.lastFolder = this.folder()?.uri.fsPath;
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    for (const d of this.disposables) d.dispose();
  }

  // ------------------------------------------------------------ folder and config

  folder(): vscode.WorkspaceFolder | undefined {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const chosen = this.ctx.workspaceState.get<string>('acc.folder');
    const byChoice = folders.find((f) => f.uri.fsPath === chosen);
    if (byChoice) return byChoice;
    const active = vscode.window.activeTextEditor?.document.uri;
    return (active && vscode.workspace.getWorkspaceFolder(active)) || folders[0];
  }

  private cwd(): string {
    return this.folder()?.uri.fsPath ?? homedir();
  }

  /** Project checks only run where they mean something: a configured repo or a Salesforce project. */
  private isProject(): boolean {
    const f = this.folder();
    if (!f) return false;
    return existsSync(join(f.uri.fsPath, '.acc', 'config.json')) || existsSync(join(f.uri.fsPath, 'sfdx-project.json'));
  }

  /** The project config, read through core's parser so defaults (like profile = generic) match acc exactly. */
  private config(): Config | null {
    const f = this.folder();
    if (!f) return null;
    const file = join(f.uri.fsPath, '.acc', 'config.json');
    try {
      return existsSync(file) ? parseConfig(JSON.parse(readFileSync(file, 'utf8'))).config : null;
    } catch {
      return null;
    }
  }

  private confirmed(part: 'machine' | 'project'): Set<string> {
    const store = part === 'machine' ? this.ctx.globalState : this.ctx.workspaceState;
    return new Set(store.get<string[]>(CONFIRMED[part]) ?? []);
  }

  allConfirmed(): Set<string> {
    return new Set([...this.confirmed('machine'), ...this.confirmed('project')]);
  }

  // ------------------------------------------------------------ running acc

  /** The bundled CLI, run by VSCode's own Node runtime, so it works even before Node is on PATH. */
  private acc(args: string[], token?: vscode.CancellationToken): Promise<RunResult> {
    return runFile(process.execPath, [this.accScript, ...args], this.cwd(), { ...process.env, ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' }, token);
  }

  private async doctor(args: string[], token?: vscode.CancellationToken): Promise<DoctorItem[]> {
    const r = await this.acc(['doctor', '--json', ...args], token);
    try {
      const items = JSON.parse(r.stdout) as DoctorItem[];
      if (!Array.isArray(items)) throw new Error('not a list');
      return items;
    } catch {
      this.log.error(`acc doctor didn't return results (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
      return [];
    }
  }

  /** Adds what only the extension can see, such as whether this repo is signed in to its tracker. */
  private overlay: ((items: DoctorItem[], cwd: string) => Promise<DoctorItem[]>) | null = null;

  setOverlay(fn: (items: DoctorItem[], cwd: string) => Promise<DoctorItem[]>): void {
    this.overlay = fn;
  }

  /** Re-runs one step quietly, for instance after a sign-in changed. */
  async recheck(id: string): Promise<void> {
    const items = await this.doctor(['--step', id]);
    if (items.length) await this.apply(items);
  }

  private async apply(raw: DoctorItem[]): Promise<void> {
    const items = this.overlay ? await this.overlay(raw, this.cwd()).catch(() => raw) : raw;
    const confirmed = this.allConfirmed();
    for (const it of items) {
      this.items.set(it.id, it);
      await vscode.commands.executeCommand('setContext', contextKey(it.id), isComplete(it.status, confirmed.has(it.id)));
    }
    const profile = this.config()?.profile ?? 'none';
    await vscode.commands.executeCommand('setContext', 'acc.profile', profile);
    this.renderStatus();
    this.changed.fire();
  }

  /** The latest result for every step, for the Setup view. */
  results(): DoctorItem[] {
    return [...this.items.values()];
  }

  private renderStatus(): void {
    const all = [...this.items.values()];
    const shown = this.isProject() ? all : all.filter((i) => i.part === 'machine');
    const sum = summarize(shown, this.allConfirmed());
    const s = statusText(sum);
    this.status.text = s.text;
    this.status.tooltip = s.tooltip;
    this.status.command = this.isProject() ? COMMANDS.project : COMMANDS.machine;
    this.status.backgroundColor = s.attention ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    // Outside a project, stay out of the way unless this machine needs something.
    if (this.isProject() || sum.failing.length + sum.byHand.length > 0) this.status.show();
    else this.status.hide();
  }

  /** Re-runs every check. Calls made while one is running wait for it instead of starting another. */
  refresh(reason: string, opts: { reuseMachine?: boolean } = {}): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Checking setup' }, async () => {
          const started = Date.now();
          const cached = this.ctx.globalState.get<{ at: number; items: DoctorItem[] }>('acc.machineItems');
          const reuse = opts.reuseMachine && cached && Date.now() - cached.at < MACHINE_FRESH_MS;
          const items: DoctorItem[] = reuse ? [...cached.items] : await this.doctor(['--part', 'machine']);
          if (!reuse) await this.ctx.globalState.update('acc.machineItems', { at: Date.now(), items });
          if (this.isProject()) items.push(...(await this.doctor(['--part', 'project'])));
          await this.apply(items);
          const fails = items.filter((i) => i.status === 'fail');
          this.log.info(`Checked ${items.length} steps (${reason}${reuse ? ', machine results reused' : ''}) in ${((Date.now() - started) / 1000).toFixed(1)} s: ${fails.length} failing.`);
          for (const f of fails) this.log.warn(`${f.id} ${f.title}: ${f.detail}`);
        });
      } finally {
        this.running = undefined;
      }
    })();
    return this.running;
  }

  refreshSoon(reason: string, ms = 1500): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(reason), ms);
  }

  // ------------------------------------------------------------ terminal

  private runInTerminal(command: string, checkAfter?: string): void {
    if (!this.terminal || this.terminal.exitStatus) {
      this.terminal = vscode.window.createTerminal({ name: TERMINAL_NAME, cwd: this.cwd(), iconPath: new vscode.ThemeIcon('checklist') });
    }
    this.terminal.show();
    const fillIn = hasPlaceholder(command);
    this.terminal.sendText(command, !fillIn);
    this.pendingCheck = checkAfter;
    this.log.info(`${fillIn ? 'Typed' : 'Ran'} in terminal: ${command}`);
    if (fillIn) void vscode.window.showInformationMessage('Fill in the <…> parts in the terminal, then press Enter. The step re-checks itself when the command finishes.');
  }

  onShellEnd(e: vscode.TerminalShellExecutionEndEvent): void {
    if (e.terminal !== this.terminal || !this.pendingCheck) return;
    const id = this.pendingCheck;
    this.pendingCheck = undefined;
    void this.check(id, true).then(() => this.refreshSoon('after a setup command'));
  }

  onTerminalClosed(t: vscode.Terminal): void {
    if (t === this.terminal) this.terminal = undefined;
  }

  // ------------------------------------------------------------ step commands

  private step(id: string): Step {
    const s = STEPS.find((x) => x.id === id);
    if (!s) throw new Error(`Unknown step ${id}`);
    return s;
  }

  async check(id: string, quietIfPassing = false): Promise<DoctorItem | undefined> {
    const step = this.step(id);
    const [item] = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Checking: ${step.title}`, cancellable: true },
      (_p, token) => this.doctor(['--step', id], token),
    );
    if (!item) return undefined;
    await this.apply([item]);
    const confirmed = this.allConfirmed().has(id);
    if (isComplete(item.status, confirmed)) {
      if (!quietIfPassing) void vscode.window.showInformationMessage(`✓ ${step.title}: ${item.detail}`);
    } else if (item.status === 'unknown') {
      const pick = await vscode.window.showInformationMessage(`? ${step.title}: ${item.detail}`, 'I\'ve done this');
      if (pick) await this.confirm(id);
    } else {
      const openLabel = item.open ? `Open ${basename(item.open)}` : undefined;
      const actions = [openLabel, !item.open && (item.fix || step.fix?.command) ? 'Do it' : undefined, step.fix?.docs ? 'Read the guide' : undefined, 'Show log'].filter(Boolean) as string[];
      const pick = await vscode.window.showWarningMessage(`✗ ${step.title}: ${item.detail}`, ...actions);
      if (pick && pick === openLabel) await this.openFolder(item.open!);
      else if (pick === 'Do it') await this.fix(id);
      else if (pick === 'Read the guide') await this.openGuide(id);
      else if (pick === 'Show log') this.log.show();
    }
    return item;
  }

  async fix(id: string): Promise<void> {
    if (id === 'B0.config') return this.initFlow();
    const step = this.step(id);
    const [raw] = await this.doctor(['--step', id]);
    if (raw) await this.apply([raw]);
    const item = this.items.get(id) ?? raw;
    if (item && isComplete(item.status)) {
      void vscode.window.showInformationMessage(`✓ ${step.title} is already done: ${item.detail}`);
      return;
    }
    if (item?.open) return this.openFolder(item.open);
    // A step done in VSCode itself: the check may name a more fitting command, such as signing in.
    if (step.fix?.vscode) {
      await vscode.commands.executeCommand(item?.fix?.startsWith('acc.') ? item.fix : step.fix.vscode);
      await this.recheck(id);
      return;
    }
    const command = item?.fix || step.fix?.command;
    if (command) return this.runInTerminal(command, id);
    const pick = await vscode.window.showWarningMessage(`${step.title}: ${item?.detail ?? 'needs attention'}. There's no single command for this one.`, ...(step.fix?.docs ? ['Read the guide'] : []));
    if (pick) await this.openGuide(id);
  }

  async openSetup(id: string): Promise<void> {
    const step = this.step(id);
    const path = step.fix?.setupPath;
    if (!path) return;
    const choices: EnvLike[] = setupOrgChoices(id, this.config()?.environments ?? []);
    if (!choices.length) {
      void vscode.window.showWarningMessage('No environment in .acc/config.json has an org alias for this step.');
      return;
    }
    const env = choices.length === 1 ? choices[0] : (await vscode.window.showQuickPick(
      choices.map((e) => ({ label: e.name, description: e.org ?? '', env: e })),
      { title: 'Open Setup in which org?' },
    ))?.env;
    if (!env?.org) return;
    this.runInTerminal(sfOpenCommand(env.org, path));
    if (step.fix?.text) void vscode.window.showInformationMessage(`In ${env.name}: ${step.fix.text} Then click Check.`, 'Check').then((p) => p && this.check(id));
  }

  async openFolder(path: string): Promise<void> {
    const pick = await vscode.window.showInformationMessage(`Open ${path}?`, { modal: true, detail: 'This replaces the folder open in this window.' }, 'Open', 'Open in New Window');
    if (!pick) return;
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(path), { forceNewWindow: pick === 'Open in New Window' });
  }

  async confirm(id: string): Promise<void> {
    const step = this.step(id);
    const key = CONFIRMED[step.part];
    const store = step.part === 'machine' ? this.ctx.globalState : this.ctx.workspaceState;
    await store.update(key, [...new Set([...(store.get<string[]>(key) ?? []), id])]);
    await vscode.commands.executeCommand('setContext', contextKey(id), true);
    this.renderStatus();
    this.changed.fire();
    this.log.info(`Marked ${id} done by hand.`);
  }

  async openGuide(id?: string): Promise<void> {
    const docs = id ? STEPS.find((s) => s.id === id)?.fix?.docs : undefined;
    if (docs?.startsWith('http')) {
      await vscode.env.openExternal(vscode.Uri.parse(docs));
      return;
    }
    await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(this.guide));
  }

  /** B0.config's "Do it": choose the profile and, for Salesforce, the Production org, then run acc init. */
  async initFlow(): Promise<void> {
    if (!this.folder()) {
      void vscode.window.showWarningMessage('Open the project\'s folder first (File → Open Folder).');
      return;
    }
    const kind = await vscode.window.showQuickPick([
      { label: '$(cloud) Salesforce project', description: 'Finds every org from Production\'s sandbox list', profile: 'salesforce' as const },
      { label: '$(folder) Other project', description: 'One branch, no orgs', profile: 'generic' as const },
    ], { title: 'What kind of project is this?' });
    if (!kind) return;
    if (kind.profile === 'generic') return this.runInTerminal(initCommand('generic'), 'B0.config');

    const list = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Finding your logged-in Production orgs' },
      () => runFile('sf', ['org', 'list', '--json'], this.cwd(), { ...process.env, SF_NO_UPDATE_NOTIFIER: 'true' }));
    let orgs: string[] = [];
    try {
      orgs = productionOrgs(JSON.parse(list.stdout));
    } catch {
      orgs = [];
    }
    const other = '$(add) Log in to another Production org…';
    const pick = await vscode.window.showQuickPick([...orgs, other], { title: 'Which org is Production?', placeHolder: orgs.length ? undefined : 'No Production org is logged in yet' });
    if (!pick) return;
    if (pick === other) {
      this.runInTerminal('sf org login web --alias "<alias>" --instance-url https://<domain>.my.salesforce.com');
      return;
    }
    this.runInTerminal(initCommand('salesforce', pick), 'B0.config');
  }

  async chooseFolder(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length < 2) {
      void vscode.window.showInformationMessage(folders.length ? `Using ${folders[0]!.name}, the only folder open.` : 'Open a folder first.');
      return;
    }
    const pick = await vscode.window.showQuickPick(folders.map((f) => ({ label: f.name, description: f.uri.fsPath, f })), { title: 'Which folder is the project?' });
    if (!pick) return;
    await this.ctx.workspaceState.update('acc.folder', pick.f.uri.fsPath);
    await this.refresh('folder chosen');
  }

  async doctorInTerminal(): Promise<void> {
    this.runInTerminal('acc doctor');
    await this.refresh('acc doctor');
  }

  /** Opens a walkthrough once: the machine one on first use, the project one in a Salesforce folder that isn't set up. */
  async maybeOpenWalkthroughs(): Promise<void> {
    if (!this.ctx.globalState.get('acc.welcomed')) {
      await this.ctx.globalState.update('acc.welcomed', true);
      await openWalkthrough(WALKTHROUGHS.machine.id);
      return;
    }
    const f = this.folder();
    if (!f || this.ctx.workspaceState.get('acc.projectWalkthroughShown')) return;
    const root = f.uri.fsPath;
    if (existsSync(join(root, 'sfdx-project.json')) && !existsSync(join(root, '.acc', 'config.json'))) {
      await this.ctx.workspaceState.update('acc.projectWalkthroughShown', true);
      await openWalkthrough(WALKTHROUGHS.project.id);
    }
  }

  /** In a multi-root workspace, the project follows the active editor. */
  renderStatusIfFolderChanged(): void {
    const now = this.folder()?.uri.fsPath;
    if (now === this.lastFolder) return;
    this.lastFolder = now;
    this.items.clear();
    this.refreshSoon('active folder changed', 500);
  }

  watch(): void {
    const files = '{.acc/config.json,.gitignore,README.md,sfdx-project.json,manifest/*.txt,.sf/config.json}';
    const w = vscode.workspace.createFileSystemWatcher(`**/${files}`);
    const again = () => this.refreshSoon('a setup file changed');
    w.onDidChange(again);
    w.onDidCreate(again);
    w.onDidDelete(again);
    this.disposables.push(w);
  }
}

export function openWalkthrough(id: string): Thenable<unknown> {
  return vscode.commands.executeCommand('workbench.action.openWalkthrough', `${EXTENSION_ID}#${id}`, false);
}

