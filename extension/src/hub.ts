import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { cpus, homedir, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { profileView, type ProfileView } from '../../packages/core/src/agents.ts';
import { type Analysis, analysisRequired, analyzing, readAnalysis } from '../../packages/core/src/analyze.ts';
import { type AutopilotLog, type AutopilotRecord, byAutopilot, failedChecks, readAutopilotLog } from '../../packages/core/src/autopilot.ts';
import { arrivedAt } from '../../packages/core/src/carried.ts';
import { type Config, parseConfig } from '../../packages/core/src/config.ts';
import { run as runSync } from '../../packages/core/src/exec.ts';
import { CLONE_ACCOUNT_KEY } from '../../packages/core/src/github.ts';
import { jobsUnderWay } from '../../packages/core/src/jobs.ts';
import { autopilotFailure, builderStopped, displayState, type FileShare, isReady, readLedger, type Ledger, runStartedAt, type SessionInfo, type Task } from '../../packages/core/src/ledger.ts';
import { envOpen, IN_FLIGHT_STATES, inFlight, nulPaths, plannedFiles, sharedFiles, type StartCandidate, startOrder } from '../../packages/core/src/overlap.ts';
import type { RepoPaths } from '../../packages/core/src/paths.ts';
import type { HistoryRecord, Question } from '../../packages/core/src/questions.ts';
import { resuming } from '../../packages/core/src/resume.ts';
import { latestVerdict, reviewing } from '../../packages/core/src/review.ts';
import { type HeavyState, heavyState } from '../../packages/core/src/semaphore.ts';
import { claudeProjectsDir, lastModelIn, lastSaidIn, transcriptFile } from '../../packages/core/src/transcript.ts';
import { readUpdate, type Update, UPDATE_ID } from '../../packages/core/src/updates.ts';
import { type AgentSession, agentLook, analysisWait, askingLabel, isUnder, parseWorktrees, repoRoot, rowAnalysis, type RowFiles, sessionFor, type TaskRow, type Worktree } from './logic.ts';
import { loadWord, type RepoJobs } from './progress.ts';
import { runFile } from './run.ts';
import { type LastStep, lastStepIn } from './transcript.ts';

export interface WorktreeInfo extends Worktree {
  main: boolean;
  /** Files with uncommitted changes, or -1 when git couldn't say. */
  changed: number;
  /** A running task's branch so far: commits and files changed since its environment's branch (D-092). */
  branchStats?: { commits: number; files: number } | null;
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

export type HubPart = 'projects' | 'tasks' | 'agents' | 'worktrees' | 'jobs';

/** While anything was under way this recently, In progress redraws every TICK_MS, so its times and done lines move on. */
const BUSY_MS = 90_000;
const TICK_MS = 15_000;

/** Where a project's analyses are kept: beside the ledger, as acc keeps them (D-052). */
const analysesOf = (p: Pick<Project, 'ledgerPath'>): RepoPaths => ({ analyses: join(dirname(p.ledgerPath), 'analyses') }) as RepoPaths;
/** And its tickets' draft updates (D-066). */
const updatesOf = (p: Pick<Project, 'ledgerPath'>): Pick<RepoPaths, 'updates'> => ({ updates: join(dirname(p.ledgerPath), 'updates') });

/** Something read from a file, kept with the file's stamp until it changes. */
interface Read<T> {
  file: string;
  stamp: string;
  value: T | null;
}

/** How long a transcript not found is left before it's looked for again: a search reads every project folder. */
const UNSAVED_MS = 30_000;

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
  private readonly said = new Map<string, Read<string>>();
  /** The model each agent last answered with, by session, kept until its transcript changes (D-086). */
  private readonly models = new Map<string, Read<string>>();
  /**
   * When a session's transcript was last looked for and not found, for each thing read from it, so it isn't
   * searched for every few seconds. One read's miss, such as the model just after a dispatch, doesn't hold
   * up another's, such as what a builder that has since stopped last said.
   */
  private readonly unsaved = new Map<Map<string, Read<string>>, Map<string, number>>();
  /** Who holds the machine's heavy-check slots and who waits (D-092), as of the last look. */
  heavy: HeavyState | null = null;
  /** The machine's load over the last minute, and its cores, as of the last look. */
  machine: { load: number; cpus: number } | null = null;
  /** Each repo's jobs under way, by ledger: projects of one repo share them (D-092). */
  private readonly repoJobs = new Map<string, RepoJobs>();
  /** Each running builder's latest step, by session, kept until its transcript changes. */
  private readonly builderSteps = new Map<string, { file: string; stamp: string; step: LastStep | null }>();
  private jobsSig = '';
  private busyAt = 0;
  /** What each in-flight task's branch has changed, by project and task, from the worktree poll (D-093). */
  private readonly changed = new Map<string, Map<string, string[]>>();
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
   * Something read from the end of a session's transcript. Read again only when the file changes: the
   * rows are derived every few seconds. A transcript not found is looked for again after a while.
   */
  private fromTranscript(cache: Map<string, Read<string>>, read: (file: string) => string | null, sessionId: string, likely: (string | null | undefined)[]): string | null {
    let cached = cache.get(sessionId);
    let file = cached && existsSync(cached.file) ? cached.file : null;
    if (!file) {
      let missed = this.unsaved.get(cache);
      if (!missed) this.unsaved.set(cache, (missed = new Map()));
      if (Date.now() - (missed.get(sessionId) ?? 0) < UNSAVED_MS) return null;
      file = transcriptFile(claudeProjectsDir(process.env), sessionId, likely);
      if (!file) {
        missed.set(sessionId, Date.now());
        return null;
      }
      missed.delete(sessionId);
    }
    const stamp = stampOf(file);
    if (!stamp) return null;
    if (cached?.file !== file || cached.stamp !== stamp) {
      cached = { file, stamp, value: read(file) };
      cache.set(sessionId, cached);
    }
    return cached.value;
  }

  /** The last thing a session's agent said, from the end of its transcript (D-067). */
  private lastSaid(sessionId: string, likely: (string | null | undefined)[]): string | null {
    return this.fromTranscript(this.said, lastSaidIn, sessionId, likely);
  }

  /** The model a session's agent last answered with, from the end of its transcript (D-086). */
  private lastModel(sessionId: string, likely: (string | null | undefined)[]): string | null {
    return this.fromTranscript(this.models, lastModelIn, sessionId, likely);
  }

  /**
   * The model a session runs with (D-086): what its transcript last answered with, else, for a task's
   * builder, the model acc started it with, before its first answer. Null when neither is known.
   */
  modelFor(s: AgentSession): string | null {
    const task = [...this.tasks.values()].flatMap((c) => c.ledger.tasks).find((t) => (!!s.sessionId && t.run?.sessionId === s.sessionId) || (!!s.id && t.run?.bgId === s.id));
    const said = s.sessionId ? this.lastModel(s.sessionId, [s.cwd, task?.run?.worktree]) : null;
    return said ?? task?.run?.model ?? null;
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
    const analyses = new Map(ledger.tasks.map((t) => [t.id, store && t.state !== 'done' && files.has(`${t.id}.json`) ? this.analysisFrom(store, t.id) : null]));
    const filesOf = this.rowFiles(ledger, p, analyses, required);
    return ledger.tasks.map((t) => {
      const a = analyses.get(t.id) ?? null;
      const running = store && t.state !== 'done' && files.has(`${t.id}.running.json`) ? analyzing(store, t.id) : null;
      const analysis = a ? rowAnalysis(a) : null;
      const waits = analysisWait({ state: t.state, analysis, analyzing: running });
      const verdict = reviews && (t.state === 'review' || t.state === 'rework') ? latestVerdict(reviews, t.id) : null;
      const head = p?.worktrees.find((w) => w.branch === t.run?.branch)?.head;
      const tree = t.state === 'running' && t.run?.worktree ? p?.worktrees.find((w) => w.path === t.run!.worktree) : undefined;
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
      // The model its agent runs with (D-086): what it last answered with, else what acc started it with.
      const model = look && t.run ? (t.run.sessionId ? this.lastModel(t.run.sessionId, [t.run.worktree, session?.cwd, p?.root]) : null) ?? t.run.model ?? null : null;
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
        model,
        asking: !!asking,
        review: verdict ? { verdict: verdict.verdict, summary: verdict.summary, current: !!head && verdict.sha === head, at: verdict.at } : null,
        // Each agent under way with the name acc gave it (D-087); the builder's is on its run.
        reviewing: live ? { sessionId: live.sessionId, name: live.name } : null,
        pr: t.pr ? { number: t.pr.number, url: t.pr.url, state: t.pr.state, ci: t.pr.ci ?? null, changesRequested: t.pr.changesRequested ?? false, conflicts: t.pr.conflicts ?? [] } : null,
        promoting: (t.promotions ?? []).some((x) => x.state === 'open'),
        closing: t.pr?.issue?.state === 'pending',
        analysis,
        analyzing: running ? { sessionId: running.sessionId, name: running.name } : null,
        analysisRequired: required,
        autopilot: failed ? { step: failed.step, reason: failed.reason } : null,
        checks: failedChecks(t),
        stopped: stopped ? { said } : null,
        resuming: !!resumed,
        since: t.state === 'running' ? runStartedAt(t) : null,
        branchStats: tree?.branchStats ? { ...tree.branchStats, uncommitted: Math.max(0, tree.changed) } : null,
        files: filesOf(t),
      };
    });
  }

  /**
   * Each task's files beside other tasks' (D-093), as acc weighs them at dispatch: a task to do's planned
   * files against each in-flight task's, planned and changed on its branch (as the worktree poll last
   * read them), without the files every task shares. acc's own answer at dispatch is final.
   */
  private rowFiles(ledger: Ledger, p: Project | undefined, analyses: Map<string, Analysis | null>, required: boolean): (t: Task) => RowFiles | null {
    if (!p) return () => null;
    const plan = (id: string) => plannedFiles(analyses.get(id) ?? null, p.root);
    const changed = this.changed.get(p.root);
    const flying: FileShare[] = inFlight(ledger).filter((t) => t.pr?.state !== 'merged')
      .map((t) => ({ task: t.id, files: [...new Set([...(plan(t.id) ?? []), ...(changed?.get(t.id) ?? [])])].sort() }));
    const live = new Set(flying.map((f) => f.task));
    const shared = sharedFiles(p.config);
    // What could start now, as acc's analysisProblems and checkMove see it.
    const candidates: StartCandidate[] = ledger.tasks.filter((t) => t.state === 'todo').map((t) => {
      const a = analyses.get(t.id) ?? null;
      const analyzed = !required || (!!a && a.verdict !== 'split' && a.questions.every((q) => !!q.answer));
      return { id: t.id, files: plan(t.id), startable: isReady(ledger, t) && envOpen(p.config, t) && !t.held?.failed && analyzed };
    });
    const capped = ledger.tasks.filter((t) => t.state === 'running').length >= p.config.agents.max;
    return (t) => {
      if (t.state === 'todo') {
        const own = plan(t.id);
        const look = startOrder({ id: t.id, files: own }, candidates, flying, shared);
        const h = t.held;
        const held = h ? { at: h.at, failed: h.failed?.reason ?? null, byAutopilot: !!h.failed && byAutopilot(h.failed.by) } : null;
        return { known: !!own, analyzed: !!analyses.get(t.id), shares: look.shares, first: look.first, held, ...(h && capped ? { capped } : {}) };
      }
      // Started beside others, while they're still in flight.
      const shares = IN_FLIGHT_STATES.includes(t.state) ? (t.run?.shares ?? []).filter((s) => live.has(s.task)) : [];
      return shares.length ? { known: true, shares, first: [], held: null } : null;
    };
  }

  /**
   * What each in-flight task's branch has changed since it left its environment's branch (D-093): its
   * commits, and in its worktree what isn't committed yet, untracked files too. Read only while a task to
   * do is Ready or held, when it can matter, one git call at a time, so a machine that stutters isn't
   * asked for much at once.
   */
  private async loadChanged(p: Project): Promise<void> {
    const ledger = this.tasks.get(p.root)?.ledger;
    if (!ledger?.tasks.some((t) => t.state === 'todo' && (!!t.held || isReady(ledger, t)))) {
      this.changed.delete(p.root);
      return;
    }
    const out = new Map<string, string[]>();
    for (const t of inFlight(ledger)) {
      if (t.pr?.state === 'merged') continue;
      const branch = `refs/heads/${t.run!.branch}`;
      let base = '';
      for (const ref of [`refs/remotes/origin/${t.environment}`, `refs/heads/${t.environment}`]) {
        const mb = await runFile('git', ['merge-base', branch, ref], p.root);
        if (mb.code === 0 && mb.stdout.trim()) { base = mb.stdout.trim(); break; }
      }
      if (!base) continue;
      const files = new Set<string>();
      const add = (r: { code: number; stdout: string }) => { if (r.code === 0) for (const f of nulPaths(r.stdout)) files.add(f); };
      add(await runFile('git', ['diff', '--name-only', '--no-renames', '-z', base, branch], p.root));
      const wt = t.run!.worktree;
      if (wt && existsSync(wt)) {
        add(await runFile('git', ['diff', '--name-only', '--no-renames', '-z', base], wt));
        add(await runFile('git', ['ls-files', '--others', '--exclude-standard', '-z'], wt));
      }
      out.set(t.id, [...files].sort());
    }
    this.changed.set(p.root, out);
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

  // ------------------------------------------------------------ jobs under way (D-092)

  /** A project's repo's jobs under way, with its reviews, analyses and resumes, as of the last look. */
  jobsOf(root: string): RepoJobs {
    const p = this.project(root);
    return (p && this.repoJobs.get(p.ledgerPath)) ?? { repo: p?.ledgerPath ?? root, max: p?.config.agents.max ?? 1, jobs: [], reviews: [], analyses: [], resumes: [] };
  }

  /** A running builder's latest step and model, by its session, as of the last look while the page was on screen. */
  stepOf(sessionId: string): LastStep | null {
    return this.builderSteps.get(sessionId)?.step ?? null;
  }

  /**
   * Looks at what runs: the machine's heavy-check slots, each repo's job markers, and its review, analysis
   * and resume markers, all stats and small reads. On screen, each running builder's latest step too, read
   * from its transcript's tail only when the file changed. Says 'jobs' only when something changed, and
   * every 15 seconds while anything is under way, so times and done lines move on.
   */
  async loadJobs(visible = true): Promise<void> {
    let heavy: HeavyState | null = null;
    try {
      heavy = heavyState();
    } catch {
      heavy = null;
    }
    const machine = { load: loadavg()[0] ?? 0, cpus: cpus().length || 1 };
    const seen = new Set<string>();
    for (const p of this.projects) {
      if (seen.has(p.ledgerPath)) continue;
      seen.add(p.ledgerPath);
      this.repoJobs.set(p.ledgerPath, this.readRepoJobs(p));
    }
    for (const k of [...this.repoJobs.keys()]) if (!seen.has(k)) this.repoJobs.delete(k);
    if (visible) this.readSteps();
    this.heavy = heavy;
    this.machine = machine;
    const running = this.projects.some((p) => this.taskRows(p.root).some((t) => t.state === 'running'));
    const busy = running || !!heavy?.held.length || !!heavy?.waiting.length || [...this.repoJobs.values()].some((r) => r.jobs.length || r.reviews.length || r.analyses.length || r.resumes.length);
    const now = Date.now();
    if (busy) this.busyAt = now;
    const sig = JSON.stringify([
      heavy && [heavy.slots, heavy.held, heavy.waiting], [...this.repoJobs.values()], loadWord(machine)?.label ?? null,
      [...this.builderSteps.entries()].map(([k, v]) => [k, v.step]),
      visible && now - this.busyAt < BUSY_MS ? Math.floor(now / TICK_MS) : 0,
    ]);
    if (sig === this.jobsSig) return;
    this.jobsSig = sig;
    this.emitter.fire('jobs');
  }

  private readRepoJobs(p: Project): RepoJobs {
    const stateDir = dirname(p.ledgerPath);
    const list = (dir: string, suffix: string): string[] => {
      try {
        return readdirSync(join(stateDir, dir)).filter((n) => n.endsWith(suffix)).map((n) => n.slice(0, -suffix.length));
      } catch {
        return [];
      }
    };
    const store = { stateDir, reviews: join(stateDir, 'reviews'), analyses: join(stateDir, 'analyses') } as RepoPaths;
    const ledger = this.ledger(p.root);
    // What a promotion takes on, as far as the ledger says: tasks that reached its source and not its destination.
    const carries = (from: string, to: string) => (ledger?.tasks ?? []).filter((t) => arrivedAt(t, from) && !arrivedAt(t, to)).map((t) => t.id);
    let jobs: RepoJobs['jobs'] = [];
    try {
      jobs = jobsUnderWay({ stateDir }).map((j) => (j.kind === 'promote' && j.from && j.env ? { ...j, carries: carries(j.from, j.env) } : j));
    } catch {
      jobs = [];
    }
    return {
      repo: p.ledgerPath,
      max: p.config.agents.max,
      jobs,
      reviews: list('reviews', '.running.json').flatMap((task) => { const r = reviewing(store, task); return r ? [{ task, ...r }] : []; }),
      analyses: list('analyses', '.running.json').flatMap((task) => { const r = analyzing(store, task); return r ? [{ task, ...r }] : []; }),
      resumes: list('resumes', '.json').flatMap((task) => { const r = resuming(store, task); return r ? [{ task, sessionId: r.sessionId, startedAt: r.startedAt, by: r.by, pid: r.pid }] : []; }),
    };
  }

  /** Each running builder's latest step, from its transcript's tail, read again only when the file changed. */
  private readSteps(): void {
    const live = new Set<string>();
    for (const p of this.projects) {
      for (const t of this.taskRows(p.root)) {
        const id = t.state === 'running' ? t.run?.sessionId : undefined;
        if (!id || live.has(id)) continue;
        live.add(id);
        let cached = this.builderSteps.get(id);
        const file = cached && existsSync(cached.file) ? cached.file : transcriptFile(claudeProjectsDir(process.env), id, [t.run?.worktree, p.root]);
        const stamp = file ? stampOf(file) : null;
        if (!file || !stamp) continue;
        if (cached?.file !== file || cached.stamp !== stamp) {
          cached = { file, stamp, step: lastStepIn(file) };
          this.builderSteps.set(id, cached);
        }
      }
    }
    for (const k of [...this.builderSteps.keys()]) if (!live.has(k)) this.builderSteps.delete(k);
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
      // A running task's branch is counted too, for In progress (D-092): only those, and only on this poll,
      // which runs while the page is on screen.
      const running = new Map((this.ledger(p.root)?.tasks ?? []).filter((t) => t.state === 'running' && t.run?.worktree).map((t) => [t.run!.worktree!, t.environment]));
      p.worktrees = await Promise.all(trees.map(async (w, i): Promise<WorktreeInfo> => {
        if (w.prunable || !existsSync(w.path)) return { ...w, main: i === 0, changed: -1 };
        const env = running.get(w.path);
        const [s, branchStats] = await Promise.all([runFile('git', ['status', '--porcelain'], w.path), env ? this.branchStats(w.path, env) : Promise.resolve(null)]);
        return { ...w, main: i === 0, changed: s.code === 0 ? s.stdout.split('\n').filter(Boolean).length : -1, ...(env ? { branchStats } : {}) };
      }));
      await this.loadChanged(p);
    }
    this.emitter.fire('worktrees');
    // A branch's latest commit decides whether its review is current, so the rows follow the worktrees.
    for (const [root, cached] of this.tasks) this.tasks.set(root, { ...cached, rows: this.deriveRows(cached.ledger, this.project(root)) });
    if (this.tasks.size) this.emitter.fire('tasks');
  }

  /**
   * Commits and files changed on a branch since it left its environment's branch: from the merge base with
   * origin's copy, else the local one, as the checks measure changes (gates.ts). Null when git can't say.
   */
  private async branchStats(path: string, env: string): Promise<{ commits: number; files: number } | null> {
    let base = '';
    for (const ref of [`origin/${env}`, env]) {
      const r = await runFile('git', ['merge-base', 'HEAD', ref], path);
      if (r.code === 0 && r.stdout.trim()) { base = r.stdout.trim(); break; }
    }
    if (!base) return null;
    const [count, diff] = await Promise.all([runFile('git', ['rev-list', '--count', `${base}..HEAD`], path), runFile('git', ['diff', '--name-only', base, 'HEAD'], path)]);
    if (count.code !== 0 || diff.code !== 0) return null;
    return { commits: Number(count.stdout.trim()) || 0, files: diff.stdout.split('\n').filter(Boolean).length };
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
