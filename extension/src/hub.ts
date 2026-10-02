import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { type Config, parseConfig } from '../../packages/core/src/config.ts';
import { CLONE_ACCOUNT_KEY } from '../../packages/core/src/github.ts';
import { displayState, readLedger, type Ledger } from '../../packages/core/src/ledger.ts';
import { type AgentSession, agentLook, isUnder, parseWorktrees, sessionFor, type TaskRow, type Worktree } from './logic.ts';
import { runFile } from './run.ts';

export interface WorktreeInfo extends Worktree {
  main: boolean;
  /** Files with uncommitted changes, or -1 when git couldn't say. */
  changed: number;
}

export interface Project {
  name: string;
  root: string;
  /** The config, with this clone's own GitHub account in place when it chose one (D-028). */
  config: Config;
  /** Where config.github.account comes from: this clone's choice, or the project's config. */
  githubFrom: 'clone' | 'config' | null;
  ledgerPath: string;
  branch: string | null;
  worktrees: WorktreeInfo[];
}

export type HubPart = 'projects' | 'tasks' | 'agents' | 'worktrees';

/**
 * Everything the sidebar shows, loaded from the same sources acc uses. The hub only reads: every change
 * goes through acc (D-012).
 */
export class Hub implements vscode.Disposable {
  projects: Project[] = [];
  agents: AgentSession[] = [];
  agentsError: string | null = null;
  private readonly tasks = new Map<string, { mtime: number; ledger: Ledger; rows: TaskRow[] }>();
  private readonly emitter = new vscode.EventEmitter<HubPart>();
  readonly onDidChange = this.emitter.event;
  private readonly timers = new Map<string, NodeJS.Timeout>();

  dispose(): void {
    for (const t of this.timers.values()) clearInterval(t);
    this.emitter.dispose();
  }

  /** Re-reads which workspace folders are configured projects. */
  async loadProjects(): Promise<void> {
    const found: Project[] = [];
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      const root = f.uri.fsPath;
      const file = join(root, '.acc', 'config.json');
      if (!existsSync(file)) continue;
      let config: Config | null = null;
      try {
        config = parseConfig(JSON.parse(readFileSync(file, 'utf8'))).config;
      } catch {
        config = null;
      }
      if (!config) continue;
      const common = await runFile('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], root);
      if (common.code !== 0) continue;
      const mine = (await runFile('git', ['config', '--get', CLONE_ACCOUNT_KEY], root)).stdout.trim();
      const chosen = !!config.github && /^[A-Za-z0-9-]+$/.test(mine) && mine !== config.github.account;
      if (chosen) config = { ...config, github: { ...config.github!, account: mine } };
      const old = this.projects.find((p) => p.root === root);
      found.push({ name: config.project, root, config, githubFrom: config.github ? (chosen ? 'clone' : 'config') : null, ledgerPath: join(common.stdout.trim(), 'acc', 'ledger.json'), branch: old?.branch ?? null, worktrees: old?.worktrees ?? [] });
    }
    this.projects = found;
    await vscode.commands.executeCommand('setContext', 'acc.hasProject', found.length > 0);
    this.emitter.fire('projects');
    await Promise.all([this.loadTasks(true), this.loadWorktrees()]);
  }

  project(root: string): Project | undefined {
    return this.projects.find((p) => p.root === root);
  }

  /** The project a path belongs to: its main checkout or any of its worktrees. */
  projectFor(path: string): Project | undefined {
    return this.projects.find((p) => isUnder(path, p.root) || p.worktrees.some((w) => isUnder(path, w.path)));
  }

  // ------------------------------------------------------------ tasks

  taskRows(root: string): TaskRow[] {
    return this.tasks.get(root)?.rows ?? [];
  }

  ledger(root: string): Ledger | undefined {
    return this.tasks.get(root)?.ledger;
  }

  /** Reads each ledger again if it changed on disk. Cheap: one stat per project. */
  async loadTasks(force = false): Promise<void> {
    let changed = false;
    for (const p of this.projects) {
      let mtime = 0;
      try {
        mtime = existsSync(p.ledgerPath) ? statSync(p.ledgerPath).mtimeMs : 0;
      } catch {
        mtime = 0;
      }
      const cached = this.tasks.get(p.root);
      if (!force && cached && cached.mtime === mtime) continue;
      let ledger: Ledger;
      try {
        ledger = readLedger(p.ledgerPath);
      } catch {
        continue; // mid-write or unreadable: keep what we had
      }
      const rows = this.deriveRows(ledger);
      this.tasks.set(p.root, { mtime, ledger, rows });
      changed = true;
    }
    if (changed || force) this.emitter.fire('tasks');
  }

  /** Task rows with each running task's agent state, so a waiting agent shows as Needs you. */
  private deriveRows(ledger: Ledger): TaskRow[] {
    return ledger.tasks.map((t) => {
      const base = { id: t.id, run: t.run };
      const session = t.state === 'running' || t.state === 'review' || t.state === 'blocked' ? sessionFor(base, this.agents) : undefined;
      const look = session ? agentLook(session) : null;
      return {
        id: t.id,
        title: t.title,
        state: t.state,
        display: displayState(ledger, t, session ? { state: session.state, status: session.status } : undefined) as TaskRow['display'],
        environment: t.environment,
        deps: t.deps.filter((d) => ledger.tasks.find((x) => x.id === d)?.state !== 'done'),
        source: { kind: t.source.kind, url: t.source.url },
        run: t.run,
        agent: look ? { label: look.label, icon: look.icon, tone: look.tone } : null,
      };
    });
  }

  // ------------------------------------------------------------ agents

  async loadAgents(): Promise<void> {
    const r = await runFile('claude', ['agents', '--json'], this.projects[0]?.root ?? process.cwd(), process.env, undefined, 20_000);
    if (r.code === 127) {
      this.agents = [];
      this.agentsError = 'The Claude Code CLI (claude) isn\'t on PATH.';
    } else {
      try {
        const list = JSON.parse(r.stdout) as AgentSession[];
        this.agents = Array.isArray(list) ? list : [];
        this.agentsError = null;
      } catch {
        this.agentsError = (r.stderr || r.stdout).trim().split('\n')[0] || 'claude agents didn\'t answer.';
      }
    }
    this.emitter.fire('agents');
    // Agent state feeds task display (Needs you), so re-derive the rows.
    for (const [root, cached] of this.tasks) this.tasks.set(root, { ...cached, rows: this.deriveRows(cached.ledger) });
    if (this.tasks.size) this.emitter.fire('tasks');
  }

  // ------------------------------------------------------------ worktrees and branches

  async loadWorktrees(): Promise<void> {
    for (const p of this.projects) {
      const [list, branch] = await Promise.all([
        runFile('git', ['worktree', 'list', '--porcelain'], p.root),
        runFile('git', ['branch', '--show-current'], p.root),
      ]);
      p.branch = branch.code === 0 ? branch.stdout.trim() || null : null;
      const trees = list.code === 0 ? parseWorktrees(list.stdout) : [];
      p.worktrees = await Promise.all(trees.map(async (w, i): Promise<WorktreeInfo> => {
        if (w.prunable || !existsSync(w.path)) return { ...w, main: i === 0, changed: -1 };
        const s = await runFile('git', ['status', '--porcelain'], w.path);
        return { ...w, main: i === 0, changed: s.code === 0 ? s.stdout.split('\n').filter(Boolean).length : -1 };
      }));
    }
    this.emitter.fire('worktrees');
  }

  // ------------------------------------------------------------ polling, only while a view is visible

  poll(key: string, everyMs: number, fn: () => Promise<void>, on: boolean): void {
    const t = this.timers.get(key);
    if (t) clearInterval(t);
    this.timers.delete(key);
    if (!on) return;
    void fn();
    const timer = setInterval(() => void fn(), everyMs);
    timer.unref?.(); // a timer alone never keeps a process alive
    this.timers.set(key, timer);
  }
}
