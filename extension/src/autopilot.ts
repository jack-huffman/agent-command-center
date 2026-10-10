import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { autopilotMode } from '../../packages/core/src/autopilot.ts';
import { autoMergeOn } from '../../packages/core/src/config.ts';
import { alive } from '../../packages/core/src/lock.ts';
import type { Hub, Project } from './hub.ts';
import { autopilotStatus, type AutopilotStatusInput } from './logic/autopilot.ts';
import { isWebviewMenuContext } from './logic/shared.ts';
import type { Runs } from './runs.ts';
import type { ExtensionArea } from './area.ts';

/** acc's own words for a project autopilot can't land in. */
const NO_GITHUB = 'Autopilot lands reviewed work as pull requests on GitHub, and this project has no "github" section in .acc/config.json.';
/** How often the switch looks for an autopilot another window or a terminal started. */
const LOCK_LOOK_MS = 10_000;

/** A repo autopilot runs in. Projects of one repo share its ledger, so they share one autopilot. */
interface Repo {
  /** The repo's ledger, which names it. */
  key: string;
  /** The project it's shown and run as. */
  project: Project;
}

/**
 * The Command Center hosts autopilot (D-064): a status bar switch for each repo whose autonomy isn't
 * manual, and while it's on, `acc autopilot --every 60` as one of this window's runs (D-030). It's off
 * when VSCode opens: the autonomy setting is the project's consent, and the click is this person's,
 * here, until VSCode closes. Nothing about the switch is saved. Only one autopilot runs a repo, so one
 * started in another window or a terminal shows here as on elsewhere.
 */
export class AutopilotHost implements vscode.Disposable {
  private readonly hub: Hub;
  private readonly runs: Runs;
  private readonly accCommand: string;
  private readonly showRun: (id: string) => void;
  private readonly items = new Map<string, vscode.StatusBarItem>();
  private readonly emitter = new vscode.EventEmitter<void>();
  /** Its state changed: the one status bar item redraws (D-065). */
  readonly onDidChange = this.emitter.event;
  /** This window's autopilot in each repo, while its process lasts. */
  private readonly mine = new Map<string, { id: string; stopping: boolean }>();
  /** Each repo's latest autopilot run here, still there to show after it ends. */
  private readonly latest = new Map<string, string>();
  /** Who holds each repo's autopilot lock, looked at every few seconds rather than on every redraw. */
  private readonly owners = new Map<string, number | null>();
  private repos: Repo[] = [];
  private readonly timer: NodeJS.Timeout;
  private readonly listening: vscode.Disposable;
  private disposed = false;

  constructor(hub: Hub, runs: Runs, accCommand: string, showRun: (id: string) => void) {
    this.hub = hub;
    this.runs = runs;
    this.accCommand = accCommand;
    this.showRun = showRun;
    this.timer = setInterval(() => { this.lookAtLocks(); this.render(); }, LOCK_LOOK_MS);
    this.timer.unref?.();
    // Its tooltip carries the last line autopilot printed.
    this.listening = runs.onDidChange(() => { if (this.mine.size) this.render(); });
    this.reconcile();
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    this.listening.dispose();
    // Closing the window ends autopilot: it never runs on with no window to show it.
    for (const m of this.mine.values()) if (!m.stopping) this.runs.control(m.id, 'stop');
    for (const item of this.items.values()) item.dispose();
    this.emitter.dispose();
  }

  /** The projects changed: one switch a repo, and no autopilot left running for a repo that's gone. */
  reconcile(): void {
    const byRepo = new Map<string, Project[]>();
    for (const p of this.hub.projects) byRepo.set(p.ledgerPath, [...(byRepo.get(p.ledgerPath) ?? []), p]);
    // The main checkout's project when it's open, since a task branch's config can be behind.
    this.repos = [...byRepo].map(([key, ps]) => ({ key, project: ps.find((p) => p.worktrees.find((w) => w.main)?.path === p.root) ?? ps[0]! }));
    const keys = new Set(this.repos.map((r) => r.key));
    for (const [key, m] of this.mine) {
      if (!keys.has(key) && !m.stopping) { m.stopping = true; this.runs.control(m.id, 'stop'); }
    }
    for (const [key, item] of this.items) {
      if (keys.has(key)) continue;
      item.dispose();
      this.items.delete(key);
    }
    // Its switch is in the one status bar item's menu now (D-065), so it makes no items of its own.
    this.lookAtLocks();
    this.render();
  }

  /** Turns a repo's autopilot on or off, for this window until VSCode closes. */
  async toggle(arg?: unknown): Promise<void> {
    const shown = this.repos.filter((r) => this.stateOf(r));
    let repo = typeof arg === 'string' ? this.repos.find((r) => r.key === arg || r.project.root === arg) : shown.length === 1 ? shown[0] : undefined;
    if (!repo && shown.length > 1) repo = (await vscode.window.showQuickPick(shown.map((r) => ({ label: r.project.name, description: this.stateOf(r)?.state, r })), { title: 'Autopilot for which project?' }))?.r;
    if (!repo) {
      if (!shown.length) void vscode.window.showInformationMessage('Autopilot is off: every project here has autonomy manual. Change it in Settings, under How agents run.');
      return;
    }
    const name = repo.project.name;
    const m = this.mine.get(repo.key);
    if (m) {
      if (!m.stopping) { m.stopping = true; this.runs.control(m.id, 'stop'); }
      this.render();
      return;
    }
    this.lookAtLocks();
    const s = this.stateOf(repo);
    if (!s) return void vscode.window.showInformationMessage(`Autopilot is off for ${name}: its autonomy is manual. Change it in Settings, under How agents run.`);
    if (s.state === 'refused') return void vscode.window.showWarningMessage(s.refusal ?? `Autopilot can't run for ${name}.`);
    if (s.state === 'elsewhere') {
      this.render();
      return void vscode.window.showInformationMessage(`Autopilot is already on for ${name}, in another window or a terminal (pid ${s.pid ?? 'unknown'}). Stop it there to run it here.`);
    }
    this.start(repo);
  }

  /** Shows a repo's autopilot output in the page: the one running here, or the last one that ran. */
  showOutput(arg?: unknown): void {
    const root = typeof arg === 'string' ? arg : (arg as { project?: { root?: string } } | undefined)?.project?.root;
    const p = root ? this.hub.project(root) ?? this.hub.projectFor(root) : this.repos[0]?.project;
    const id = p ? this.latest.get(p.ledgerPath) : undefined;
    if (id && this.runs.views().some((r) => r.id === id)) return this.showRun(id);
    void vscode.window.showInformationMessage('Autopilot isn\'t running in this window, so its output is where it runs: another window, or a terminal.');
  }

  private start(repo: Repo): void {
    const cwd = repo.project.worktrees.find((w) => w.main)?.path ?? repo.project.root;
    // Set before it starts: a command that can't start ends at once.
    const m = { id: '', stopping: false };
    this.mine.set(repo.key, m);
    m.id = this.runs.start(`${this.accCommand} autopilot --every 60`, {
      cwd, label: `Autopilot · ${repo.project.name}`, background: true,
      // It stops by itself if this window's extension host goes without stopping it.
      env: { ACC_AUTOPILOT_PARENT: String(process.pid) },
      onExit: (code) => this.ended(repo.key, m, code),
    });
    this.latest.set(repo.key, m.id);
    this.render();
  }

  private ended(key: string, m: { id: string; stopping: boolean }, code: number | null): void {
    if (this.mine.get(key) === m) this.mine.delete(key);
    if (this.disposed) return;
    this.lookAtLocks();
    if (!m.stopping && code !== 0) {
      const repo = this.repos.find((r) => r.key === key);
      if (this.owners.get(key)) {
        // Another window or a terminal took the lock first: it's on there, and nothing failed here.
        this.runs.control(m.id, 'dismiss');
      } else {
        const last = this.lastLine(m.id);
        void vscode.window.showWarningMessage(`Autopilot stopped for ${repo?.project.name ?? 'this project'} (exit ${code ?? '?'})${last ? `: ${last}` : '.'}`, 'Show output')
          .then((pick) => pick && this.showRun(m.id));
      }
    }
    this.render();
  }

  /** Where a repo's autopilot is, or null when its autonomy is manual and there's no switch to show. */
  private stateOf(repo: Repo): Omit<AutopilotStatusInput, 'project' | 'many'> | null {
    const config = repo.project.config;
    if (config.autonomy === 'manual') return null;
    const m = this.mine.get(repo.key);
    if (m && !m.stopping) return { state: 'on', last: this.lastLine(m.id) };
    const mode = autopilotMode(config);
    if (mode.refusal) return { state: 'refused', refusal: mode.refusal };
    if (!config.github) return { state: 'refused', refusal: NO_GITHUB };
    // Its own, on its way out, still holds the lock for a moment.
    const pid = m ? null : this.owners.get(repo.key);
    return pid ? { state: 'elsewhere', pid } : { state: 'off' };
  }

  /** Whether autopilot runs for a project's repo in this window, somewhere else, or not at all, for In progress (D-092). */
  stateFor(root: string): 'on' | 'elsewhere' | null {
    const p = this.hub.project(root);
    const repo = p && this.repos.find((r) => r.key === p.ledgerPath);
    const s = repo ? this.stateOf(repo) : null;
    return s?.state === 'on' || s?.state === 'elsewhere' ? s.state : null;
  }

  /** Each repo's autopilot whose autonomy isn't manual: its name, key, and whether it's on here, off, elsewhere or can't run. */
  looks(): { key: string; project: string; state: 'on' | 'off' | 'elsewhere' | 'refused'; text: string; autoMerge: boolean }[] {
    const many = this.repos.filter((r) => r.project.config.autonomy !== 'manual').length > 1;
    return this.repos.flatMap((r) => {
      const s = this.stateOf(r);
      const autoMerge = autoMergeOn(r.project.config);
      return s ? [{ key: r.key, project: r.project.name, state: s.state, text: autopilotStatus({ project: r.project.name, many, autoMerge, ...s }).text, autoMerge }] : [];
    });
  }

  /**
   * Whether autopilot merges pull requests in each repo (GH-67), whatever its autonomy: on only where
   * the config turns auto-merge on, and never in a Salesforce project. `acts` is false while autonomy is
   * manual, when nothing runs to merge.
   */
  mergeLooks(): { key: string; root: string; project: string; on: boolean; acts: boolean }[] {
    return this.repos.map((r) => ({ key: r.key, root: r.project.root, project: r.project.name, on: autoMergeOn(r.project.config), acts: r.project.config.autonomy === 'review' }));
  }

  private render(): void {
    if (this.disposed) return;
    this.emitter.fire();
  }

  /** The live process holding each repo's autopilot lock, beside its ledger, if any. */
  private lookAtLocks(): void {
    for (const r of this.repos) {
      let pid: number | null = null;
      try {
        const owner = JSON.parse(readFileSync(join(dirname(r.key), 'autopilot.lock', 'owner'), 'utf8')) as { pid?: unknown };
        pid = typeof owner.pid === 'number' && alive(owner.pid) ? owner.pid : null;
      } catch {
        pid = null; // no lock: nothing runs
      }
      this.owners.set(r.key, pid);
    }
  }

  private lastLine(id: string): string | null {
    const lines = this.runs.views().find((r) => r.id === id)?.lines ?? [];
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i]!.trim()) return lines[i]!.trim();
    return null;
  }
}

export const area: ExtensionArea = {
  register({ reg, autopilot }) {
    reg('acc.autopilot.toggle', (arg?: unknown) => autopilot.toggle(arg));
    // From an In progress line's ⋯ menu on the Overview, the line's project (GH-160).
    reg('acc.autopilot.output', (arg?: unknown) => autopilot.showOutput(isWebviewMenuContext(arg) ? arg.accRef.project : arg));
  },
};
