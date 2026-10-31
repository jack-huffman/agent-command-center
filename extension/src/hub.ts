import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { cpus, homedir, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { profileView, type ProfileView } from '../../packages/core/src/agents.ts';
import { SERVICE_DOWN } from '../../packages/core/src/started.ts';
import { type Analysis, analyzing, readAnalysis } from '../../packages/core/src/analyze.ts';
import { type AutopilotLog, type AutopilotRecord, readAutopilotLog } from '../../packages/core/src/autopilot-log.ts';
import { type Config, parseConfig } from '../../packages/core/src/config.ts';
import { run as runSync } from '../../packages/core/src/exec.ts';
import { CLONE_ACCOUNT_KEY } from '../../packages/core/src/github.ts';
import { groupRunning } from '../../packages/core/src/group-check.ts';
import { type Ledger, readLedger, readRuns, type RepoAgents, type RunsLog, type SessionTie, tieSession } from '../../packages/core/src/ledger.ts';
import type { RepoPaths } from '../../packages/core/src/paths.ts';
import { type HistoryRecord, listeners, type Question, questionsDir } from '../../packages/core/src/questions.ts';
import { rememberRepo } from '../../packages/core/src/repos.ts';
import { reviewing } from '../../packages/core/src/review.ts';
import { type Suggestion, suggestRules, WRITTEN_RULE_FILES } from '../../packages/core/src/rule-suggestions.ts';
import { RULES_DIR } from '../../packages/core/src/rules.ts';
import { readTidy, tidyDue, tidyFile, type TidyRecord, type TidyStatus } from '../../packages/core/src/tidy.ts';
import { type AskGit, InEnvironmentAsks } from './logic/in-environment.ts';
import { type BranchMove, branchMoves as readBranchMoves, branchesPath } from '../../packages/core/src/branches.ts';
import type { Protection } from '../../packages/core/src/protection.ts';
import { type HeavyState, heavyState } from '../../packages/core/src/semaphore.ts';
import { claudeProjectsDir, lastModelIn, lastSaidIn, transcriptFile } from '../../packages/core/src/transcript.ts';
import { readUpdate, type Update, UPDATE_ID } from '../../packages/core/src/updates.ts';
import { type AgentSession, isUnder, stateOf, type TaskRow } from './logic/shared.ts';
import { askingLabel, commonDirOf, repoRoot, sessionFor, sessionLedger } from './logic/agents.ts';
import { parseWorktrees, type Worktree } from './logic/worktrees.ts';
import { stepInWords } from './logic/relayed.ts';
import { loadWord, readRepoJobs, readSteps, type RepoJobs } from './progress.ts';
import { runFile } from './run.ts';
import { branchStats as readBranchStats } from './worktrees.ts';
import type { LastStep } from './transcript.ts';
import { analysesOf, deriveRows, loadChanged } from './task-rows.ts';
import { readLimits } from './limits.ts';
import type { LimitsFacts } from './model/limits.ts';
import type { EditActivity } from './model/shared.ts';

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
/** How long Settings' limits are kept before they're read again (GH-111). */
const LIMITS_MS = 15_000;

/** And its tickets' draft updates (D-066). */
const updatesOf = (p: Pick<Project, 'ledgerPath'>): Pick<RepoPaths, 'updates'> => ({ updates: join(dirname(p.ledgerPath), 'updates') });

/** Where a project's reviews and what a person did with each suggested rule are kept (GH-102). */
const suggestionsOf = (p: Pick<Project, 'ledgerPath' | 'root'>): Pick<RepoPaths, 'root' | 'reviews' | 'suggestions'> =>
  ({ root: p.root, reviews: join(dirname(p.ledgerPath), 'reviews'), suggestions: join(dirname(p.ledgerPath), 'rules') });

/** Something read from a file, kept with the file's stamp until it changes. */
interface Read<T> {
  file: string;
  stamp: string;
  value: T | null;
}

/** How long a transcript not found is left before it's looked for again: a search reads every project folder. */
const UNSAVED_MS = 30_000;

/** Plain file reads for finding a repo's shared git folder: never git, which is too slow to ask every few seconds. */
const FILES = {
  isDir: (p: string): boolean => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  read: (f: string): string | null => {
    try {
      return readFileSync(f, 'utf8');
    } catch {
      return null;
    }
  },
};

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
  /** Since when `claude agents` hasn't answered, in ms, or null while it answers (T-92): past the grace, acc can't see a local builder. */
  agentsSilentSince: number | null = null;
  /** The Claude Code CLI isn't on PATH (T-93): kept out of the silence clock, its own state with its own words. */
  claudeMissing = false;
  /** Agents' questions waiting in the Command Center (D-030), set by Questions. */
  questions: Question[] = [];
  /** How earlier questions ended, newest last (D-037), set by Questions. */
  answers: HistoryRecord[] = [];
  /** The home folder, which sessions' folders show as ~ (GH-83). */
  readonly home = homedir();
  /**
   * The folders other windows' Command Centers show, by the listener files each keeps fresh while it's open
   * (D-030), as of the last `claude agents`: the Agents page says a repo is in another window (GH-119).
   */
  otherWindows: string[] = [];
  /** The repo each session's folder is in, as of the last `claude agents`, so a repo made since shows next time (GH-83). */
  private readonly repos = new Map<string, string | null>();
  private readonly tasks = new Map<string, { stamp: string; ledger: Ledger; rows: TaskRow[] }>();
  /** Whether each finished task's work is in its environment, by project root, as git answers in the background (T-147). */
  private readonly merged = new Map<string, InEnvironmentAsks>();
  /** The steps autopilot took in each repo, by ledger: projects of one repo share them (D-064). */
  private readonly steps = new Map<string, AutopilotLog>();
  /** Each analysis read, by file, kept until the file changes: the rows are re-derived every few seconds. */
  private readonly analyses = new Map<string, { stamp: string; analysis: Analysis | null }>();
  /** Each ticket update read, by file, kept until it changes; and each repo's, by ledger, as of the last load (D-066). */
  private readonly updateFiles = new Map<string, { stamp: string; update: Update | null }>();
  private readonly repoUpdates = new Map<string, Update[]>();
  /** Each repo's last tidy-up a person added or skipped, by ledger, as of the last load (GH-104). */
  private readonly repoTidy = new Map<string, TidyRecord | null>();
  /** Each repo's environment branches that moved by anything but acc's merge, by ledger, as of the last load (GH-69). */
  private readonly repoBranches = new Map<string, BranchMove[]>();
  /** What GitHub enforces on each environment branch, by project root, once the cloud area has read it (GH-69). */
  private readonly protection = new Map<string, Protection[]>();
  /** Each project's suggested rules, by root, kept until its reviews, its records or its written rules change (GH-102). */
  private readonly ruleSuggestions = new Map<string, { stamp: string; suggestions: Suggestion[] }>();
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
  /**
   * What each repo's ledger says about its agents (D-095), by ledger, wherever the repo is: read again only
   * when the ledger, its events, its reviews or its analyses change. Its runs are read on from where they
   * were, and each verdict is read once, until its file changes.
   */
  private readonly agentRepos = new Map<string, { stamp: string; runs: RunsLog | undefined; repo: RepoAgents | null }>();
  private readonly verdictFiles = new Map<string, { stamp: string; verdict: { task: string; sessionId: string } | null }>();
  /** Each session folder's ledger, and each session's tie, as of the last look: worked out once a look. */
  private readonly sessionLedgers = new Map<string, string | null>();
  private readonly ledgerAgents = new Map<string, RepoAgents | null>();
  private ties = new WeakMap<AgentSession, SessionTie | null>();
  private jobsSig = '';
  private busyAt = 0;
  /** Settings' limits (GH-111), as of the last read, kept a while: it reads every repo's ledger acc noted on this machine. */
  private limitsRead: { at: number; facts: LimitsFacts } | null = null;
  /** What each in-flight task's branch has changed, by project and task, from the worktree poll (D-093). */
  readonly changed = new Map<string, Map<string, string[]>>();
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
    // This machine's repos, so the Connect page can say which epic another repo uses (GH-81). A repo set up
    // before the list existed joins it the first time it's open here.
    for (const p of found) rememberRepo(p.root);
    this.forgetTies(true);
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

  /** The steps autopilot took in a project's repo, oldest first, wherever it ran (D-064), each reason in process words (GH-163). */
  autopilotLog(root: string): AutopilotRecord[] {
    const p = this.project(root);
    return (p && this.steps.get(p.ledgerPath)?.records.map(stepInWords)) || [];
  }

  /** Whether a group check for `env` holds its lock in this project's repo now (T-165), as acc itself reads it. */
  groupRunning(root: string, env: string): boolean {
    const p = this.project(root);
    return !!p && groupRunning(stateOf(p), env);
  }

  /** Every move every task made, for the Overview's activity. */
  history(root: string): { at: string; task: string; title: string; from: string | null; to: string; by: string }[] {
    return (this.ledger(root)?.tasks ?? []).flatMap((t) => t.history.map((h) => ({ at: h.at, task: t.id, title: t.title, from: h.from, to: h.to, by: h.by })));
  }

  /** Every edit a person made to a task's fields (T-74), for History. */
  edits(root: string): EditActivity[] {
    return (this.ledger(root)?.tasks ?? []).flatMap((t) => (t.edits ?? []).map((e) => ({ at: e.at, task: t.id, title: t.title, fields: e.fields, by: e.by })));
  }

  /**
   * Reads each ledger again if it, the analyses, the ticket updates, the tidy-up record, the moved branches,
   * the reviews or the suggested rules changed on disk. Cheap: seven stats per project. An analysis starting or ending, an update drafted or posted, or a
   * tidy-up skipped, adds or replaces a file beside the ledger, which the ledger doesn't see.
   */
  async loadTasks(force = false): Promise<void> {
    let changed = false;
    const read = new Set<string>();
    for (const p of this.projects) {
      // A verdict on a task that moved meanwhile writes no event, so the reviews folder is watched too (GH-102).
      const store = suggestionsOf(p);
      // acc sync writes a moved environment branch beside the ledger too (GH-69), which the ledger doesn't see.
      const stamp = [p.ledgerPath, analysesOf(p).analyses, updatesOf(p).updates, tidyFile(stateOf(p)), branchesPath(stateOf(p)), store.reviews, store.suggestions].map((f) => stampOf(f) ?? 0).join('|');
      const cached = this.tasks.get(p.root);
      if (!force && cached && cached.stamp === stamp) continue;
      // A task that moved can finish its agents (D-095).
      this.forgetTies();
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
        this.repoTidy.set(p.ledgerPath, readTidy(stateOf(p)));
        this.repoBranches.set(p.ledgerPath, readBranchMoves(stateOf(p)));
      }
      const rows = deriveRows(this, ledger, p);
      // tidy()'s noes are asked again after a new read of the ledger; its yeses stay (T-147).
      this.merged.get(p.root)?.forgetNos();
      this.tasks.set(p.root, { stamp, ledger, rows });
      changed = true;
    }
    if (changed || force) this.emitter.fire('tasks');
  }

  /**
   * The rules a project's review findings suggest, not yet accepted or dismissed (GH-102). Worked out again
   * only when a verdict is added, a person acts on one, or a file of written rules changes; it only reads.
   */
  suggestions(root: string): Suggestion[] {
    const p = this.project(root);
    if (!p) return [];
    const store = suggestionsOf(p);
    const stamp = [store.reviews, store.suggestions, join(p.root, RULES_DIR), ...WRITTEN_RULE_FILES.map((f) => join(p.root, f))].map((f) => stampOf(f) ?? 0).join('|');
    const cached = this.ruleSuggestions.get(p.root);
    if (cached?.stamp === stamp) return cached.suggestions;
    let suggestions: Suggestion[] = [];
    try {
      suggestions = suggestRules(store) as Suggestion[];
    } catch {
      suggestions = cached?.suggestions ?? []; // mid-write: keep what we had
    }
    this.ruleSuggestions.set(p.root, { stamp, suggestions });
    return suggestions;
  }

  /** A project's ticket updates, oldest first: drafts, those being posted, and what's done with (D-066). */
  updates(root: string): Update[] {
    const p = this.project(root);
    return (p && this.repoUpdates.get(p.ledgerPath)) || [];
  }

  /**
   * Whether the project's repo has a tidy-up due (GH-104): the merges since the last one a person added or
   * skipped, from the ledger as last loaded. Projects that share a repo share its ledger, which names it.
   */
  tidy(root: string): (TidyStatus & { ledger: string }) | null {
    const p = this.project(root);
    const ledger = this.ledger(root);
    if (!p || !ledger) return null;
    // A branch merged in git counts, with or without a pull request (as `acc tidy` counts it), asked once a branch.
    // Git's answers so far: the rest are asked in the background, and the page draws again once they're in (T-147).
    return { ...tidyDue(ledger, p.config, this.repoTidy.get(p.ledgerPath) ?? null, this.inEnvironment(p).read()), ledger: p.ledgerPath };
  }

  /** Runs git for the tidy-up count's asks without holding up the extension (T-147). A test puts a stand-in here. */
  askGit: AskGit = (args, cwd) => runFile('git', args, cwd);

  /** A project's background asks of git (T-147), made the first time its tidy-up count is read. */
  private inEnvironment(p: Project): InEnvironmentAsks {
    let asks = this.merged.get(p.root);
    if (!asks) this.merged.set(p.root, (asks = new InEnvironmentAsks(p.root, join(dirname(p.ledgerPath), 'reviews'), (args, cwd) => this.askGit(args, cwd), () => this.emitter.fire('tasks'))));
    return asks;
  }

  /** The environment branches of a project's repo that moved by anything but acc's own merge, until a person has seen them (GH-69). */
  branchMoves(root: string): BranchMove[] {
    const p = this.project(root);
    return (p && this.repoBranches.get(p.ledgerPath)) || [];
  }

  /** What GitHub enforces on each environment branch (GH-69), as the cloud area last read it; null until it has. */
  cloudProtection(root: string): Protection[] | null {
    return this.protection.get(root) ?? null;
  }

  /** The cloud area read it: kept for Settings, and the page redraws. */
  setCloudProtection(root: string, found: Protection[] | null): void {
    if (found) this.protection.set(root, found);
    else this.protection.delete(root);
    this.emitter.fire('projects');
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

  analysisFrom(paths: RepoPaths, id: string): Analysis | null {
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
  lastSaid(sessionId: string, likely: (string | null | undefined)[]): string | null {
    return this.fromTranscript(this.said, lastSaidIn, sessionId, likely);
  }

  /** The model a session's agent last answered with, from the end of its transcript (D-086). */
  lastModel(sessionId: string, likely: (string | null | undefined)[]): string | null {
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

  // ------------------------------------------------------------ agents

  /** What the session's waiting question asks for, if it has one. */
  askingFor(s: AgentSession): string | null {
    const q = s.sessionId ? this.questions.find((x) => x.sessionId === s.sessionId) : undefined;
    return q ? askingLabel(q.tool) : null;
  }

  /**
   * The task a session works for, and whether its work is over (D-095), from the ledger of the repo it's in:
   * a project open here, or any repo elsewhere on the machine. Null when acc can't tie it, and it reads as
   * Claude Code says. Worked out once a look, from files read again only when they change.
   */
  tieFor(s: AgentSession): SessionTie | null {
    const known = this.ties.get(s);
    if (known !== undefined) return known;
    let ledger = this.sessionLedgers.get(s.cwd);
    if (ledger === undefined) {
      ledger = sessionLedger(s.cwd, { project: (p) => this.projectFor(p)?.ledgerPath ?? null, repoFor: (p) => this.repoFor(p), commonDir: (r) => commonDirOf(r, FILES) });
      this.sessionLedgers.set(s.cwd, ledger);
    }
    let repo = ledger ? this.ledgerAgents.get(ledger) : null;
    if (ledger && repo === undefined) {
      repo = this.agentRepo(ledger);
      this.ledgerAgents.set(ledger, repo);
    }
    const tie = repo ? tieSession(s, repo) : null;
    this.ties.set(s, tie);
    return tie;
  }

  /** Forgets each session's tie, so the next look works it out again; with `folders`, each folder's ledger too. */
  private forgetTies(folders = false): void {
    this.ties = new WeakMap();
    this.ledgerAgents.clear();
    if (folders) this.sessionLedgers.clear();
  }

  /**
   * What a repo's ledger, events, verdicts and analyses say about its agents. Null without a ledger, or with
   * one this version can't read: its sessions stay untied.
   */
  private agentRepo(ledgerPath: string): RepoAgents | null {
    const dir = dirname(ledgerPath);
    const store = { stateDir: dir, reviews: join(dir, 'reviews'), analyses: join(dir, 'analyses') } as RepoPaths;
    const events = join(dir, 'events.jsonl');
    const stamp = [ledgerPath, events, store.reviews, store.analyses].map((f) => stampOf(f) ?? 0).join('|');
    const cached = this.agentRepos.get(ledgerPath);
    if (cached?.stamp === stamp) return cached.repo;
    let ledger: Ledger | null = null;
    try {
      ledger = existsSync(ledgerPath) ? readLedger(ledgerPath) : null;
    } catch {
      ledger = null;
    }
    if (!ledger) {
      this.agentRepos.set(ledgerPath, { stamp, runs: undefined, repo: null });
      return null;
    }
    const runs = readRuns(events, cached?.runs);
    const names = (d: string): string[] => {
      try {
        return readdirSync(d);
      } catch {
        return [];
      }
    };
    const verdicts: RepoAgents['verdicts'] = [];
    const seen = new Set<string>();
    for (const n of names(store.reviews)) {
      if (!n.endsWith('.json') || n.endsWith('.running.json')) continue;
      const file = join(store.reviews, n);
      const fileStamp = stampOf(file);
      if (!fileStamp) continue;
      seen.add(file);
      let v = this.verdictFiles.get(file);
      if (v?.stamp !== fileStamp) {
        let read: { task?: unknown; sessionId?: unknown } | null = null;
        try {
          read = JSON.parse(readFileSync(file, 'utf8'));
        } catch {
          read = null;
        }
        v = { stamp: fileStamp, verdict: typeof read?.task === 'string' && typeof read.sessionId === 'string' ? { task: read.task, sessionId: read.sessionId } : null };
        this.verdictFiles.set(file, v);
      }
      if (v.verdict) verdicts.push(v.verdict);
    }
    for (const f of [...this.verdictFiles.keys()]) if (f.startsWith(`${store.reviews}/`) && !seen.has(f)) this.verdictFiles.delete(f);
    const analysisFiles = new Set(names(store.analyses));
    const analyses = ledger.tasks.flatMap((t) => {
      const a = analysisFiles.has(`${t.id}.json`) ? this.analysisFrom(store, t.id) : null;
      return a?.sessionId ? [{ task: t.id, sessionId: a.sessionId }] : [];
    });
    const running = (d: string) => names(d).filter((n) => n.endsWith('.running.json')).map((n) => n.slice(0, -'.running.json'.length));
    const live: RepoAgents['live'] = [
      ...running(store.reviews).flatMap((task) => { const r = reviewing(store, task); return r ? [{ task, sessionId: r.sessionId, role: 'review' as const }] : []; }),
      ...running(store.analyses).flatMap((task) => { const r = analyzing(store, task); return r ? [{ task, sessionId: r.sessionId, role: 'analysis' as const }] : []; }),
    ];
    const repo: RepoAgents = { tasks: ledger.tasks, runs: runs?.runs ?? [], verdicts, analyses, live };
    this.agentRepos.set(ledgerPath, { stamp, runs, repo });
    return repo;
  }

  setAnswers(answers: HistoryRecord[]): void {
    this.answers = answers;
    this.emitter.fire('agents');
  }

  setQuestions(questions: Question[]): void {
    this.questions = questions;
    for (const [root, cached] of this.tasks) this.tasks.set(root, { ...cached, rows: deriveRows(this, cached.ledger, this.project(root)) });
    this.emitter.fire('agents');
    if (this.tasks.size) this.emitter.fire('tasks');
  }

  async loadAgents(): Promise<void> {
    const r = await runFile('claude', ['agents', '--json'], this.projects[0]?.root ?? process.cwd(), process.env, undefined, 20_000);
    this.repos.clear();
    this.forgetTies(true);
    this.otherWindows = listeners(questionsDir()).filter((l) => l.pid !== process.pid).flatMap((l) => l.roots.filter((x) => typeof x === 'string'));
    this.claudeMissing = r.code === 127;
    if (r.code === 127) {
      this.agents = [];
      this.agentsError = 'The Claude Code CLI (claude) isn\'t on PATH.';
    } else {
      try {
        // Its service's socket missing is no answer, whatever it printed (T-92).
        if (SERVICE_DOWN.test(r.stderr)) throw new Error(r.stderr);
        const list = JSON.parse(r.stdout) as AgentSession[];
        this.agents = Array.isArray(list) ? list : [];
        this.agentsError = null;
        this.agentsAt = Date.now();
      } catch {
        this.agentsError = (r.stderr || r.stdout).trim().split('\n')[0] || 'Claude Code\'s list of background sessions didn\'t answer.';
      }
    }
    // A missing claude isn't silence (T-93): it never answers, and waiting changes nothing.
    this.agentsSilentSince = this.agentsError && !this.claudeMissing ? this.agentsSilentSince ?? Date.now() : null;
    this.emitter.fire('agents');
    // Agent state feeds task display (Needs you), so re-derive the rows.
    for (const [root, cached] of this.tasks) this.tasks.set(root, { ...cached, rows: deriveRows(this, cached.ledger, this.project(root)) });
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
   * from its transcript's tail only when the file changed. Says 'jobs' only when something changed, and,
   * while the page is on screen, every 15 seconds until 90 seconds after anything was last under way, so times
   * and done lines move on.
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
      this.repoJobs.set(p.ledgerPath, readRepoJobs(p, this.ledger(p.root)));
    }
    for (const k of [...this.repoJobs.keys()]) if (!seen.has(k)) this.repoJobs.delete(k);
    if (visible) readSteps(this, this.builderSteps, stampOf);
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

  // ------------------------------------------------------------ limits (GH-111)

  /** This machine's limits and each project's, read again at most every LIMITS_MS, or once forgotten. */
  limits(): LimitsFacts | null {
    const now = Date.now();
    if (this.limitsRead && now - this.limitsRead.at < LIMITS_MS) return this.limitsRead.facts;
    try {
      this.limitsRead = { at: now, facts: readLimits(this.projects, (root) => this.ledger(root), this.heavy) };
    } catch {
      this.limitsRead = null;
    }
    return this.limitsRead?.facts ?? null;
  }

  /** A limit changed: the next look reads them again, and the page redraws. */
  forgetLimits(): void {
    this.limitsRead = null;
    this.emitter.fire('jobs');
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
        const [s, branchStats] = await Promise.all([runFile('git', ['status', '--porcelain'], w.path), env ? readBranchStats(w.path, env) : Promise.resolve(null)]);
        return { ...w, main: i === 0, changed: s.code === 0 ? s.stdout.split('\n').filter(Boolean).length : -1, ...(env ? { branchStats } : {}) };
      }));
      await loadChanged(this, p);
    }
    this.emitter.fire('worktrees');
    // A session in one of a project's worktrees outside its folder is the project's from now on.
    this.forgetTies(true);
    // A branch's latest commit decides whether its review is current, so the rows follow the worktrees.
    for (const [root, cached] of this.tasks) this.tasks.set(root, { ...cached, rows: deriveRows(this, cached.ledger, this.project(root)) });
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
