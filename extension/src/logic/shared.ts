/**
 * What the extension decides that several areas use: a task's row, an agent's session, tones and paths.
 * Everything in logic/ has no `vscode` import, so it can be tested with node:test.
 */

import type { Approach } from '../../../packages/core/src/analyze.ts';
import type { AutopilotStepName, FileShare, QueuePhase } from '../../../packages/core/src/ledger.ts';

// ---------------------------------------------------------------- sidebar (views)

export type Tone = 'orange' | 'blue' | 'neutral';
/** Orange means look at this, blue means moving or fine. Every item also carries its meaning in words. */
export const TONE_COLOR: Record<Tone, string | undefined> = { orange: 'charts.orange', blue: 'charts.blue', neutral: undefined };

export const TASK_GROUPS = ['needs-you', 'ready', 'running', 'review', 'rework', 'blocked', 'todo', 'done'] as const;
export type TaskGroup = (typeof TASK_GROUPS)[number];

/**
 * The agent board's lanes, left to right, as a task goes (D-068): To do first, as on a tracker's own board.
 * A tracker's board keeps its own columns in its own order. Lists still put what needs you first (TASK_GROUPS).
 */
export const BOARD_LANES: readonly TaskGroup[] = ['todo', 'ready', 'running', 'needs-you', 'review', 'rework', 'blocked', 'done'];

export interface TaskRow {
  id: string;
  title: string;
  state: string;
  display: TaskGroup;
  environment: string;
  deps: string[];
  source: { kind: string; url: string | null };
  /**
   * Its builder's run: its session's ids, the name it was given (D-087), which older runs don't have, the
   * model its builder was started with, and modelPicked when a person picked it for this task (D-086).
   */
  run?: { bgId?: string; sessionId?: string; worktree?: string; branch?: string; name?: string; model?: string; modelPicked?: true } | null;
  /** The live state of the task's agent session, when one is known. */
  agent?: { label: string; icon: string; tone: Tone } | null;
  /** The model its agent runs with (D-086): what its transcript last answered with, else what acc started it with. */
  model?: string | null;
  /** Its agent's question is waiting in the Command Center (D-030), not in the agent's own terminal. */
  asking?: boolean;
  /** Its newest review (D-032): current when it's for the branch's latest commit. When it was made, so Slack can tell one from the next. */
  review?: { verdict: 'pass' | 'changes'; summary: string; current: boolean; at?: string } | null;
  /** A review under way, to watch, and its reviewer's name (D-087). */
  reviewing?: { sessionId: string; name?: string } | null;
  /** Its pull request (D-033). */
  pr?: { number: number; url: string; state: string; ci?: string | null; changesRequested?: boolean; conflicts?: string[] } | null;
  /** A promotion taking its change on to another environment is open (D-075). */
  promoting?: boolean;
  /** Its work merged and acc hasn't closed its GitHub issue yet: the last try failed, or none has run (D-082). */
  closing?: boolean;
  /**
   * Its analysis (D-052): the verdict, when it was made, the questions nobody has answered, the smaller
   * tasks a split suggests, and its size, shown beside the model to dispatch with (D-086).
   */
  analysis?: { verdict: 'ready' | 'questions' | 'split'; at: string; open: AnalysisAsk[]; split: string[]; size?: Approach['size'] } | null;
  /** An analysis under way, to watch, and its analyst's name (D-087). */
  analyzing?: { sessionId: string; name?: string } | null;
  /** The project wants an analysis before a task is built (D-052). */
  analysisRequired?: boolean;
  /** A step autopilot couldn't take in the task's current state, and why: the task needs you (D-055). */
  autopilot?: { step: AutopilotStepName; reason: string } | null;
  /**
   * The checks that failed on GitHub (D-076): on its open pull request while it's in review, or the ones
   * autopilot sent it back to its builder for while it's in rework.
   */
  checks?: string[] | null;
  /** Its builder stopped before acc done or acc block, and the last thing it said, if that could be read (D-067). */
  stopped?: { said: string | null } | null;
  /** A resume of its builder is under way. */
  resuming?: boolean;
  /** Its place in its repo's merge queue (GH-73): 1 is the head, which is in `phase`, and held says `why`; the rest wait behind `ahead`. */
  queue?: { place: number; of: number; ahead: string | null; phase: QueuePhase; why?: string | null } | null;
  /** When its builder last started, while it's running: its dispatch, or its latest resume (D-067). */
  since?: string | null;
  /**
   * Its branch so far, while it's running (D-092): commits and files changed since its environment's
   * branch, and files nobody has committed yet. Counted only while the page is on screen.
   */
  branchStats?: { commits: number; files: number; uncommitted: number } | null;
  /** What it shares with other tasks' files (D-093), worked out by the hub, or null when nothing says. */
  files?: RowFiles | null;
}

/** A task's files beside other tasks' (D-093). acc decides at dispatch; this is what the board shows. */
export interface RowFiles {
  /** Its analysis names the files it plans to change. */
  known: boolean;
  /** It has an analysis, though that may name no files. */
  analyzed?: boolean;
  /**
   * A task to do: the tasks in flight whose files its plan shares, and those files. In flight: the ones
   * it shared when it started, while they're still in flight.
   */
  shares: FileShare[];
  /** A task to do: Ready tasks that share no files with work in flight, which start before it. */
  first: string[];
  /** A person dispatched it, and it waits: when, why its start failed if it did, and whether autopilot tried. */
  held: { at: string; failed: string | null; byAutopilot: boolean } | null;
  /** A cap is reached, so a held task waits for that too: the project's (agents.max), or this machine's total (GH-111). */
  capped?: 'project' | 'machine';
}

/** "GH-74", "GH-74 and GH-75", "GH-74, GH-75 and GH-76". */
export const taskNames = (ids: string[]): string => (ids.length > 1 ? `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}` : (ids[0] ?? ''));

/** One of an analysis's questions a person hasn't answered: what it asks, why it matters, and what the analyst would assume. */
export interface AnalysisAsk {
  id: string;
  question: string;
  why: string;
  suggested: string;
  /** Sent to the client as a draft update, or posted (D-066). */
  client?: 'drafted' | 'posted';
}

export const questionsWord = (n: number): string => `${n} question${n === 1 ? '' : 's'}`;

/** The files an open pull request conflicts in with its base, or none (D-049). */
export const prConflicts = (row: Pick<TaskRow, 'pr'>): string[] => (row.pr?.state === 'open' ? row.pr.conflicts ?? [] : []);

/** Files in a sentence: the first few, then how many more. */
export function fileList(files: string[], max = 3): string {
  return files.length > max ? `${files.slice(0, max).join(', ')} and ${files.length - max} more` : files.join(', ');
}

/** A file by its folder and name, short enough for a card: force-app/…/layouts/Lead.layout → layouts/Lead.layout. */
export const shortPath = (file: string): string => file.split('/').slice(-2).join('/');

/** A Claude Code session as `claude agents --json` reports it. Background-only fields are optional. */
export interface AgentSession {
  cwd: string;
  kind: 'interactive' | 'background' | string;
  startedAt: number;
  sessionId?: string;
  name?: string;
  pid?: number;
  status?: 'busy' | 'waiting' | 'idle' | string;
  /** Background sessions only: working, blocked, done, failed, stopped. */
  state?: string;
  waitingFor?: string;
  /** Background sessions only: the short id `claude attach` takes. */
  id?: string;
}

export const isUnder = (path: string, root: string): boolean => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);

/** A path with ~ for the home folder: /Users/me/clients/x → ~/clients/x. One outside it stays as it is. */
export function tildePath(path: string, home: string | null | undefined): string {
  if (!home || home === '/' || !isUnder(path, home)) return path;
  return path === home ? '~' : `~${path.slice(home.replace(/\/+$/, '').length)}`;
}

/**
 * What VSCode passes a command run from a webview's native context menu: the row's data-vscode-context,
 * which carries the same Ref the tab's buttons use.
 */
export interface WebviewMenuContext {
  webviewSection: string;
  accRef: Record<string, string>;
}

export function isWebviewMenuContext(a: unknown): a is WebviewMenuContext {
  const x = a as { webviewSection?: unknown; accRef?: unknown } | null;
  return !!x && typeof x === 'object' && typeof x.webviewSection === 'string' && !!x.accRef && typeof x.accRef === 'object';
}

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isProject = (p: unknown): boolean => isObject(p) && typeof p.root === 'string' && isObject(p.config);

/**
 * What a node command gets, from whatever it was called with (GH-106). A node of the right shape passes, and so
 * does a string, number or undefined, as some commands take a root or id. Any other object, and null, is
 * undefined: it isn't a row, so the command does nothing, instead of reading a field that isn't there.
 * A webview menu's context is turned into its node before this, by extension.ts.
 */
export function nodeArg(a: unknown): unknown {
  if (a === null) return undefined;
  if (typeof a !== 'object') return a;
  if (!isObject(a)) return undefined;
  switch (a.kind) {
    case 'project': return isProject(a.project) ? a : undefined;
    case 'group': return isProject(a.project) && typeof a.group === 'string' && Array.isArray(a.tasks) ? a : undefined;
    case 'task': return isProject(a.project) && isObject(a.task) && typeof a.task.id === 'string' && isObject(a.task.source) ? a : undefined;
    case 'place': return Array.isArray(a.sessions) ? a : undefined;
    case 'agent': return isObject(a.session) && typeof a.session.cwd === 'string' ? a : undefined;
    case 'worktree': return isProject(a.project) && isObject(a.worktree) && typeof a.worktree.path === 'string' ? a : undefined;
    case 'env': return isProject(a.project) && isObject(a.env) && typeof a.env.branch === 'string' ? a : undefined;
    default: return undefined;
  }
}

/** Quotes one word for a POSIX shell, so an org alias with spaces stays one argument. */
export const shq = (s: string): string => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);

/** The last thing a stopped agent said, on one line, short enough for a card or a notice. */
export function saidLine(said: string, max = 200): string {
  const one = said.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}
