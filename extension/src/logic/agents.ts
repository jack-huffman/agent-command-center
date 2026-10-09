/**
 * Agents' sessions: which task each belongs to, how each looks, the models builders run with, and
 * opening one in Claude Code.
 * Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */

import { dirname, join, resolve } from 'node:path';
import { sessionsOf, type SessionTie } from '../../../packages/core/src/ledger.ts';
import type { AgentSession, TaskRow, Tone } from './shared.ts';

// ---------------------------------------------------------------- models (D-086)

/** The models a person picks from, in this order: Dispatch with… and How agents run's Change…, in Settings, offer the same. */
export const MODEL_CHOICES: readonly { name: string; about: string }[] = [
  { name: 'claude-opus-5-5', about: 'Claude Opus 5.5' },
  { name: 'claude-fable-5-1', about: 'Claude Fable 5.1' },
  { name: 'claude-sonnet-5-5', about: 'Claude Sonnet 5.5: lighter on your plan' },
  { name: 'claude-haiku-5-5', about: 'Claude Haiku 5.5: the lightest' },
];

/**
 * Models acc offered once and no longer does (D-128): a clone or project that names one still runs with it,
 * and Settings says it's an older model, and which replaced it.
 */
export const OLDER_MODELS: readonly { name: string; about: string; instead: string }[] = [
  { name: 'claude-haiku-4-5-20251001', about: 'Claude Haiku 4.5', instead: 'claude-haiku-5-5' },
];

/** Where a model, effort or fallback is set, in words. A model's default is acc's own, the rest Claude Code's. */
export const FROM_WORDS: Record<string, string> = { task: 'picked for this task', clone: 'this clone', project: 'project default', acc: 'acc\'s default', default: 'Claude Code\'s default' };

export interface ModelItem {
  label: string;
  description: string;
  /** The model's name, or null for Another model…, which asks for one. */
  value: string | null;
}

/**
 * What Dispatch with… offers (D-086): the model the builder would run with anyway first, saying where
 * it's set, then the other models, then Another model…. That's the model kept for the task when one was
 * picked, else the builder's own. Nothing here is chosen or reordered by the analysis's size.
 */
export function dispatchModelItems(row: Pick<TaskRow, 'run'>, builder: { model: string; from: { model: string } }): ModelItem[] {
  const now = row.run?.modelPicked && row.run.model ? { model: row.run.model, from: 'task' } : { model: builder.model, from: builder.from.model };
  return [
    { label: now.model, description: FROM_WORDS[now.from] ?? now.from, value: now.model },
    ...MODEL_CHOICES.filter((m) => m.name !== now.model).map((m) => ({ label: m.name, description: m.about, value: m.name })),
    { label: 'Another model…', description: 'an alias or a full model name, as claude --model takes it', value: null },
  ];
}

/**
 * acc dispatch's arguments for the model picked in Dispatch with… (D-086). The model the builder runs with
 * anyway, on a task with no model picked before, adds none: the task goes on following the clone's and the
 * project's settings, rather than keeping today's model for good.
 */
export function dispatchModelArgs(row: Pick<TaskRow, 'run'>, builder: { model: string }, model: string): string[] {
  return !row.run?.modelPicked && model === builder.model ? [] : ['--model', model];
}

/**
 * A task's agent, found as core finds it (sessionsOf): by its background id or session id, else by the
 * name its run recorded, else, for a run from before names, a background session named after the task
 * (D-087). One with a process comes first: a resumed conversation is listed beside its old background
 * session (D-067).
 */
export function sessionFor(row: Pick<TaskRow, 'id' | 'run'>, sessions: AgentSession[]): AgentSession | undefined {
  const mine = sessionsOf(row, sessions);
  return mine.find((s) => s.pid) ?? mine[0];
}

/**
 * The builder session a task's row, its notices and Slack look at: its current run's, only while the task
 * runs, is in review or is blocked. Never a done task's, nor an earlier run's, so a finished session can't
 * make its task need you (D-095).
 */
export function rowSession(row: Pick<TaskRow, 'id' | 'state' | 'run'>, sessions: AgentSession[]): AgentSession | undefined {
  return row.state === 'running' || row.state === 'review' || row.state === 'blocked' ? sessionFor(row, sessions) : undefined;
}

/** Whether a session works for this task: its builder, as sessionFor finds it, or its review or analysis under way. */
export function ownsSession(row: Pick<TaskRow, 'id' | 'run' | 'reviewing' | 'analyzing'>, s: AgentSession): boolean {
  if (s.sessionId && (row.reviewing?.sessionId === s.sessionId || row.analyzing?.sessionId === s.sessionId)) return true;
  return sessionsOf(row, [s]).length > 0;
}

/**
 * What an agent is called (D-087): the name acc gave it, recorded on its task's run, review or analysis,
 * so it stays the same though Claude Code lists a session under another name, as a resume can. Else
 * Claude Code's name for it, else its session's first characters. Without a session, its task's builder.
 * The Agents tab, the cards, the agent page, notices and terminals all call it this.
 */
export function displayName(s: AgentSession | undefined, row?: Pick<TaskRow, 'id' | 'run' | 'reviewing' | 'analyzing'> | null): string {
  if (!s) return row?.run?.name ?? row?.id ?? 'Agent';
  const sid = s.sessionId;
  const recorded = !row ? undefined
    : sid && row.reviewing?.sessionId === sid ? row.reviewing.name
      : sid && row.analyzing?.sessionId === sid ? row.analyzing.name
        : sessionsOf(row, [s]).length ? row.run?.name : undefined;
  return recorded ?? s.name ?? s.sessionId?.slice(0, 8) ?? s.id ?? 'Agent';
}

/** A task's builder in a notice (D-087): its name, or "GH-12's agent" for a run from before names. */
export const builderName = (t: Pick<TaskRow, 'id' | 'run'>): string => t.run?.name ?? `${t.id}'s agent`;

export interface AgentLook {
  label: string;
  icon: string;
  tone: Tone;
  needsYou: boolean;
  /** At work now: the Agents page's header counts these (GH-119). */
  working?: boolean;
}

/** What an agent's waiting question asks for, in a few words, from the tool it's about (D-030). */
export const askingLabel = (tool: string): string => (tool === 'AskUserQuestion' ? 'has a question' : tool === 'ExitPlanMode' ? 'has a plan to approve' : 'wants permission');

/**
 * Whether a session's work is over (D-095): acc tied it to a task that's done or has a later run, or to a
 * review or analysis that's recorded. Claude Code may still list it waiting at its prompt, but nobody
 * waits on it. One that's busy, or has a question waiting in the Command Center, isn't.
 */
export function finishedSession(s: AgentSession, tie: SessionTie | null | undefined, asking?: string | null): boolean {
  if (!tie?.finished || asking) return false;
  return s.state === 'blocked' || s.status === 'waiting' || !(s.state === 'working' || s.status === 'busy');
}

/**
 * `asking` is what a question waiting in the Command Center asks for; the session reads as busy meanwhile.
 * `tie` is the task acc tied it to: a finished session reads as Finished, never as Needs you (D-095).
 * Without one, it reads as Claude Code says.
 */
export function agentLook(s: AgentSession, asking?: string | null, tie?: SessionTie | null): AgentLook {
  if (asking) return { label: `Needs you: ${asking}`, icon: 'bell', tone: 'orange', needsYou: true };
  if (finishedSession(s, tie)) return { label: 'Finished', icon: 'check', tone: 'neutral', needsYou: false };
  if (s.state === 'blocked' || s.status === 'waiting') return { label: s.waitingFor ? `Needs you: ${s.waitingFor}` : 'Needs you', icon: 'bell', tone: 'orange', needsYou: true };
  if (s.state === 'failed') return { label: 'Failed', icon: 'warning', tone: 'orange', needsYou: true };
  if (s.state === 'working' || s.status === 'busy') return { label: 'Working', icon: 'sync~spin', tone: 'blue', needsYou: false, working: true };
  if (s.state === 'done') return { label: 'Done', icon: 'check', tone: 'neutral', needsYou: false };
  if (s.state === 'stopped') return { label: 'Stopped', icon: 'debug-stop', tone: 'neutral', needsYou: false };
  return { label: s.pid ? 'Idle' : 'Idle (exited)', icon: 'circle-outline', tone: 'neutral', needsYou: false };
}

/**
 * The sessions Stop finished sessions stops (D-095, D-119): background sessions whose work is over and
 * whose process still runs. One with no process has nothing left to stop, whatever state it's listed in:
 * claude stop can't confirm stopping it, so it stays in the Finished fold, marked as ended. Never a session
 * acc can't tie, its task's current builder while the task isn't done, a review or analysis under way, an
 * interactive session, or one that's busy or has a question waiting.
 */
export function stopFinishedPlan(sessions: AgentSession[], tieFor: (s: AgentSession) => SessionTie | null | undefined, askingFor: (s: AgentSession) => string | null | undefined): AgentSession[] {
  return sessions.filter((s) => s.kind === 'background' && !!s.id && !!s.pid && finishedSession(s, tieFor(s), askingFor(s)));
}

/** Claude Code for VSCode (D-040): its documented link opens a session's conversation in a tab. */
export const CLAUDE_EXTENSION = 'anthropic.claude-code';
export const claudeSessionUri = (scheme: string, sessionId: string, prompt?: string): string =>
  `${scheme}://${CLAUDE_EXTENSION}/open?session=${encodeURIComponent(sessionId)}${prompt ? `&prompt=${encodeURIComponent(prompt)}` : ''}`;
/** Session ids Claude Code's link takes: UUIDs, not the short background id. */
export const isSessionId = (v: string | undefined): v is string => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * The repo a folder is in: the nearest folder up from it, itself first, that holds .git, a folder or a
 * linked worktree's file (GH-83). The walk stops before the home folder and /, so a repo at ~ (dotfiles)
 * isn't every folder's repo.
 */
export function repoRoot(path: string, home: string | null | undefined, hasGit: (dir: string) => boolean): string | null {
  for (let dir = path; dir !== dirname(dir) && dir !== home; dir = dirname(dir)) {
    if (hasGit(dir)) return dir;
  }
  return null;
}

/**
 * A repo's git folder that all its worktrees share, where acc keeps its ledger (D-012): .git itself when
 * it's a folder. A linked worktree's .git is a file naming its own git folder, whose commondir names the
 * shared one. Read with plain file reads, never git, since it's asked every few seconds. Null when it
 * can't tell.
 */
export function commonDirOf(repo: string, fs: { isDir(path: string): boolean; read(file: string): string | null }): string | null {
  const dotGit = join(repo, '.git');
  if (fs.isDir(dotGit)) return dotGit;
  const gitdir = /^gitdir:\s*(.+?)\s*$/m.exec(fs.read(dotGit) ?? '')?.[1];
  if (!gitdir) return null;
  const own = resolve(repo, gitdir);
  const common = fs.read(join(own, 'commondir'))?.trim();
  return common ? resolve(own, common) : own;
}

/**
 * The ledger that says whose a session is (D-095): its project's, when it's in one open here. Elsewhere, the
 * ledger of the repo its folder is in: a builder's worktree's by its path, as its folder reads (D-090),
 * else the nearest folder up holding .git (GH-83), and that repo's shared git folder. Null outside a repo.
 */
export function sessionLedger(cwd: string, o: { project(path: string): string | null; repoFor(path: string): string | null; commonDir(repo: string): string | null }): string | null {
  const path = cwd.length > 1 ? cwd.replace(/\/+$/, '') : cwd;
  const own = o.project(path);
  if (own) return own;
  const repo = /^(.+)\/\.claude\/worktrees\/[^/]+(?:\/.*)?$/.exec(path)?.[1] ?? o.repoFor(path);
  const common = repo ? o.commonDir(repo) : null;
  return common ? join(common, 'acc', 'ledger.json') : null;
}

/** A short session name from an agent prompt: "Fix the login page" → "fix-the-login-page". */
export function agentName(prompt: string): string {
  return prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 5).join('-') || 'agent';
}
