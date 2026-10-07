import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { profileView, type ProfileView } from '../../packages/core/src/agents.ts';
import { type Analysis, analysisRequired, analyzing, readAnalysis } from '../../packages/core/src/analyze.ts';
import { type AutopilotLog, type AutopilotRecord, failedChecks, readAutopilotLog } from '../../packages/core/src/autopilot.ts';
import { type Config, parseConfig } from '../../packages/core/src/config.ts';
import { run as runSync } from '../../packages/core/src/exec.ts';
import { CLONE_ACCOUNT_KEY } from '../../packages/core/src/github.ts';
import { autopilotFailure, builderStopped, displayState, readLedger, type Ledger, type SessionInfo } from '../../packages/core/src/ledger.ts';
import type { RepoPaths } from '../../packages/core/src/paths.ts';
import type { HistoryRecord, Question } from '../../packages/core/src/questions.ts';
import { resuming } from '../../packages/core/src/resume.ts';
import { latestVerdict, reviewing } from '../../packages/core/src/review.ts';
import { claudeProjectsDir, lastSaidIn, transcriptFile } from '../../packages/core/src/transcript.ts';
import { readUpdate, type Update, UPDATE_ID } from '../../packages/core/src/updates.ts';
import { type AgentSession, agentLook, analysisWait, askingLabel, isUnder, parseWorktrees, repoRoot, rowAnalysis, sessionFor, type TaskRow, type Worktree } from './logic.ts';
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
  /** What builders and reviewers run with in this clone, and where each part is set (D-036). */
  agents: { builder: ProfileView; reviewer: ProfileView };
}

export type HubPart = 'projects' | 'tasks' | 'agents' | 'worktrees';

/** Where a project's analyses are kept: beside the ledger, as acc keeps them (D-052). */
const analysesOf = (p: Pick<Project, 'ledgerPath'>): RepoPaths => ({ analyses: join(dirname(p.ledgerPath), 'analyses') }) as RepoPaths;
/** And its tickets' draft updates (D-066). */
const updatesOf = (p: Pick<Project, 'ledgerPath'>): Pick<RepoPaths, 'updates'> => ({ updates: join(dirname(p.ledgerPath), 'updates') });

/** When a file last changed, as one value: a rewrite in the same millisecond still has a new size or inode. */
function stampOf(file: string): string | null {
  try {
    const s = statSync(file);
    return `${s.mtimeMs}:${s.size}:${s.ino}`;
  } catch {
    return null;
  }
}

/**
 * Everything the sidebar shows, loaded from the same sources acc uses. The hub only reads: every change
 * goes through acc (D-012).
 */
export class Hub implements vscode.Disposable {
  projects: Project[] = [];
  agents: AgentSession[] = [];
  agentsError: string | null = null;
  /** When `claude agents` last answered, so a question can tell a fresh look from an old one. */
  agentsAt = 0;
  /** Agents' questions waiting in the Command Center (D-030), set by Questions. */
  questions: Question[] = [];
  /** How earlier questions ended, newest last (D-037), set by Questions. */
  answers: HistoryRecord[] = [];
  /** The home folder, which sessions' folders show as ~ (GH-83). */
  readonly home = homedir();
  /** The repo each session's folder is in, as of the last `claude agents`, so a repo made since shows next time (GH-83). */
  private readonly repos = new Map<string, string | null>();
  private readonly tasks = new Map<string, { stamp: string; ledger: Ledger; rows: TaskRow[] }>();
  /** The steps autopilot took in each repo, by ledger: projects of one repo share them (D-064). */
  private readonly steps = new Map<string, AutopilotLog>();
  /** Each analysis read, by file, kept until the file changes: the rows are re-derived every few seconds. */
  private readonly analyses = new Map<string, { stamp: string; analysis: Analysis | null }>();
  /** Each ticket update read, by file, kept until it changes; and each repo's, by ledger, as of the last load (D-066). */
  private readonly updateFiles = new Map<string, { stamp: string; update: Update | null }>();
  private readonly repoUpdates = new Map<string, Update[]>();
  /** The last thing each stopped builder said, by session, kept until its transcript changes (D-067). */
  private readonly said = new Map<string, { file: string; stamp: string; said: string | null }>();
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
      const agents = { builder: profileView(config, runSync, root, 'builder'), reviewer: profileView(config, runSync, root, 'reviewer') };
      found.push({ name: config.project, root, config, githubFrom: config.github ? (chosen ? 'clone' : 'config') : null, ledgerPath: join(common.stdout.trim(), 'acc', 'ledger.json'), branch: old?.branch ?? null, worktrees: old?.worktrees ?? [], agents });
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

  /** The repo a folder is in: the nearest folder up holding .git, short of the home folder (GH-83). */
  repoFor(path: string): string | null {
    if (!this.repos.has(path)) this.repos.set(path, repoRoot(path, this.home, (d) => existsSync(join(d, '.git'))));
    return this.repos.get(path)!;
  }

  // ------------------------------------------------------------ tasks

  taskRows(root: string): TaskRow[] {
    return this.tasks.get(root)?.rows ?? [];
  }

  ledger(root: string): Ledger | undefined {
    return this.tasks.get(root)?.ledger;
  }

  /** The steps autopilot took in a project's repo, oldest first, wherever it ran (D-064). */
  autopilotLog(root: string): AutopilotRecord[] {
    const p = this.project(root);
    return (p && this.steps.get(p.ledgerPath)?.records) || [];
  }

  /** Every move every task made, for the Overview's activity. */
  history(root: string): { at: string; task: string; title: string; from: string | null; to: string; by: string }[] {
    return (this.ledger(root)?.tasks ?? []).flatMap((t) => t.history.map((h) => ({ at: h.at, task: t.id, title: t.title, from: h.from, to: h.to, by: h.by })));
  }

  /**
   * Reads each ledger again if it, the analyses or the ticket updates changed on disk. Cheap: three stats
   * per project. An analysis starting or ending, or an update drafted or posted, adds or replaces a file
   * beside the ledger, which the ledger doesn't see.
   */
  async loadTasks(force = false): Promise<void> {
    let changed = false;
    const read = new Set<string>();
    for (const p of this.projects) {
      const stamp = `${stampOf(p.ledgerPath) ?? 0}|${stampOf(analysesOf(p).analyses) ?? 0}|${stampOf(updatesOf(p).updates) ?? 0}`;
      const cached = this.tasks.get(p.root);
      if (!force && cached && cached.stamp === stamp) continue;
      let ledger: Ledger;
      try {
        ledger = readLedger(p.ledgerPath);
      } catch {
        continue; // mid-write or unreadable: keep what we had
      }
      // acc appends the events before it writes the ledger, so they're read with it, once a repo.
      if (!read.has(p.ledgerPath)) {
        read.add(p.ledgerPath);
        const log = readAutopilotLog(join(dirname(p.ledgerPath), 'events.jsonl'), this.steps.get(p.ledgerPath));
        if (log) this.steps.set(p.ledgerPath, log);
        else this.steps.delete(p.ledgerPath);
        this.repoUpdates.set(p.ledgerPath, this.readUpdates(p));
      }
      const rows = this.deriveRows(ledger, p);
      this.tasks.set(p.root, { stamp, ledger, rows });
      changed = true;
    }
    if (changed || force) this.emitter.fire('tasks');
  }

  /** A project's ticket updates, oldest first: drafts, those being posted, and what's done with (D-066). */
  updates(root: string): Update[] {
    const p = this.project(root);
    return (p && this.repoUpdates.get(p.ledgerPath)) || [];
  }

  /** Every update in the repo's folder, each file read again only when it has changed. */
  private readUpdates(p: Project): Update[] {
    const store = updatesOf(p);
    let names: string[] = [];
    try {
      names = readdirSync(store.updates).filter((n) => n.endsWith('.json') && UPDATE_ID.test(n.slice(0, -5)));
    } catch {
      // none yet
    }
    const out: Update[] = [];
    const seen = new Set<string>();
    for (const n of names) {
      const file = join(store.updates, n);
      seen.add(file);
      const stamp = stampOf(file);
      if (!stamp) continue;
      let cached = this.updateFiles.get(file);
      if (cached?.stamp !== stamp) {
        cached = { stamp, update: readUpdate(store, n.slice(0, -5)) };
        this.updateFiles.set(file, cached);
      }
      if (cached.update) out.push(cached.update);
    }
    for (const f of [...this.updateFiles.keys()]) if (f.startsWith(`${store.updates}/`) && !seen.has(f)) this.updateFiles.delete(f);
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  }

  /** A task's analysis (D-052), read again only when its file has changed. */
  analysis(root: string, id: string): Analysis | null {
    const p = this.project(root);
    return p ? this.analysisFrom(analysesOf(p), id) : null;
  }

  private analysisFrom(paths: RepoPaths, id: string): Analysis | null {
    const file = join(paths.analyses, `${id}.json`);
    const stamp = stampOf(file);
    if (!stamp) {
      this.analyses.delete(file);
      return null;
    }
    const cached = this.analyses.get(file);
    if (cached?.stamp === stamp) return cached.analysis;
    const analysis = readAnalysis(paths, id);
    this.analyses.set(file, { stamp, analysis });
    return analysis;
  }

  /**
   * The last thing a session's agent said, from the end of its transcript. Read again only when the file
   * changes: the rows are derived every few seconds.
   */
  private lastSaid(sessionId: string, likely: (string | null | undefined)[]): string | null {
    let cached = this.said.get(sessionId);
    const file = cached && existsSync(cached.file) ? cached.file : transcriptFile(claudeProjectsDir(process.env), sessionId, likely);
    if (!file) return null;
    const stamp = stampOf(file);
    if (!stamp) return null;
    if (cached?.file !== file || cached.stamp !== stamp) {
      cached = { file, stamp, said: lastSaidIn(file) };
      this.said.set(sessionId, cached);
    }
    return cached.said;
  }

  /**
   * Task rows with each running task's agent state, so a waiting agent shows as Needs you, and each task's
   * analysis, so one with questions for a person does too (D-052). A running task whose builder stopped
   * before acc done or acc block needs you too, with the last thing it said (D-067): judged only once
   * `claude agents` has answered, and not while it fails.
   */
  private deriveRows(ledger: Ledger, p?: Project): TaskRow[] {
    // Reviews sit beside the ledger (D-032). A branch's latest commit is its worktree's HEAD.
    const reviews = p ? ({ reviews: join(dirname(p.ledgerPath), 'reviews') } as RepoPaths) : null;
    // So do analyses: one listing a reload, and a task with none costs nothing more.
    const store = p ? analysesOf(p) : null;
    let files = new Set<string>();
    try {
      if (store) files = new Set(readdirSync(store.analyses));
    } catch {
      // none yet
    }
    const required = p ? analysisRequired(p.config) : false;
    const sessions = this.agentsAt && !this.agentsError ? this.agents : null;
    const stateDir = p ? dirname(p.ledgerPath) : null;
    const now = new Date();
    return ledger.tasks.map((t) => {
      const a = store && t.state !== 'done' && files.has(`${t.id}.json`) ? this.analysisFrom(store, t.id) : null;
      const running = store && t.state !== 'done' && files.has(`${t.id}.running.json`) ? analyzing(store, t.id) : null;
      const analysis = a ? rowAnalysis(a) : null;
      const waits = analysisWait({ state: t.state, analysis, analyzing: running });
      const verdict = reviews && (t.state === 'review' || t.state === 'rework') ? latestVerdict(reviews, t.id) : null;
      const head = p?.worktrees.find((w) => w.branch === t.run?.branch)?.head;
      const live = reviews && t.state === 'review' ? reviewing(reviews, t.id) : null;
      const base = { id: t.id, run: t.run };
      const session = t.state === 'running' || t.state === 'review' || t.state === 'blocked' ? sessionFor(base, this.agents) : undefined;
      const asking = session ? this.askingFor(session) : null;
      const resumed = stateDir && t.state === 'running' ? resuming({ stateDir }, t.id) : null;
      const stopped = builderStopped(t, sessions, { resuming: !!resumed, now });
      // A resume just started isn't listed yet, and its old background session may still say blocked.
      const carrying = !!resumed && !session?.pid;
      const look = carrying ? { label: 'Resumed: working', icon: 'sync~spin', tone: 'blue' as const } : session ? agentLook(session, asking) : null;
      const info: SessionInfo | undefined = stopped ? { stopped: true } : carrying ? { status: 'busy' } : session ? (asking ? { state: 'blocked', status: 'waiting' } : { state: session.state, status: session.status }) : undefined;
      const said = stopped && t.run?.sessionId ? this.lastSaid(t.run.sessionId, [t.run.worktree, session?.cwd, p?.root]) : null;
      const failed = autopilotFailure(t);
      return {
        id: t.id,
        title: t.title,
        state: t.state,
        // A question waiting in the Command Center makes the agent wait on you, though it reads as busy.
        // So does an analysis with questions for a person, or one that says it's too big for one task.
        display: waits ? 'needs-you' : displayState(ledger, t, info) as TaskRow['display'],
        environment: t.environment,
        deps: t.deps.filter((d) => ledger.tasks.find((x) => x.id === d)?.state !== 'done'),
        source: { kind: t.source.kind, url: t.source.url },
        run: t.run,
        agent: look ? { label: look.label, icon: look.icon, tone: look.tone } : null,
        asking: !!asking,
        review: verdict ? { verdict: verdict.verdict, summary: verdict.summary, current: !!head && verdict.sha === head, at: verdict.at } : null,
        reviewing: live ? { sessionId: live.sessionId } : null,
        pr: t.pr ? { number: t.pr.number, url: t.pr.url, state: t.pr.state, ci: t.pr.ci ?? null, changesRequested: t.pr.changesRequested ?? false, conflicts: t.pr.conflicts ?? [] } : null,
        promoting: (t.promotions ?? []).some((x) => x.state === 'open'),
        closing: t.pr?.issue?.state === 'pending',
        analysis,
        analyzing: running ? { sessionId: running.sessionId } : null,
        analysisRequired: required,
        autopilot: failed ? { step: failed.step, reason: failed.reason } : null,
        checks: failedChecks(t),
        stopped: stopped ? { said } : null,
        resuming: !!resumed,
      };
    });
  }

  // ------------------------------------------------------------ agents

  /** What the session's waiting question asks for, if it has one. */
  askingFor(s: AgentSession): string | null {
    const q = s.sessionId ? this.questions.find((x) => x.sessionId === s.sessionId) : undefined;
    return q ? askingLabel(q.tool) : null;
  }

  setAnswers(answers: HistoryRecord[]): void {
    this.answers = answers;
    this.emitter.fire('agents');
  }

  setQuestions(questions: Question[]): void {
    this.questions = questions;
    for (const [root, cached] of this.tasks) this.tasks.set(root, { ...cached, rows: this.deriveRows(cached.ledger, this.project(root)) });
    this.emitter.fire('agents');
    if (this.tasks.size) this.emitter.fire('tasks');
  }

  async loadAgents(): Promise<void> {
    const r = await runFile('claude', ['agents', '--json'], this.projects[0]?.root ?? process.cwd(), process.env, undefined, 20_000);
    this.repos.clear();
    if (r.code === 127) {
      this.agents = [];
      this.agentsError = 'The Claude Code CLI (claude) isn\'t on PATH.';
    } else {
      try {
        const list = JSON.parse(r.stdout) as AgentSession[];
        this.agents = Array.isArray(list) ? list : [];
        this.agentsError = null;
        this.agentsAt = Date.now();
      } catch {
        this.agentsError = (r.stderr || r.stdout).trim().split('\n')[0] || 'claude agents didn\'t answer.';
      }
    }
    this.emitter.fire('agents');
    // Agent state feeds task display (Needs you), so re-derive the rows.
    for (const [root, cached] of this.tasks) this.tasks.set(root, { ...cached, rows: this.deriveRows(cached.ledger, this.project(root)) });
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
    // A branch's latest commit decides whether its review is current, so the rows follow the worktrees.
    for (const [root, cached] of this.tasks) this.tasks.set(root, { ...cached, rows: this.deriveRows(cached.ledger, this.project(root)) });
    if (this.tasks.size) this.emitter.fire('tasks');
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
