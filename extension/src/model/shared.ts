/**
 * What every area's view model uses: the sections, refs and actions, looks, and the hub as the models read it.
 * Each area of the page has its own module in model/ (D-099), and registers what it adds with `export const
 * area`. Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import type { AutopilotRecord } from '../../../packages/core/src/autopilot-log.ts';
import { DISPLAY, type DisplayState, type SessionTie } from '../../../packages/core/src/ledger.ts';
import type { Environment, Tracker } from '../../../packages/core/src/config.ts';
import type { HistoryRecord, Question } from '../../../packages/core/src/questions.ts';
import type { Suggestion } from '../../../packages/core/src/rule-suggestions.ts';
import type { TidyStatus } from '../../../packages/core/src/tidy.ts';
import type { Update } from '../../../packages/core/src/updates.ts';
import type { AgentSession, TaskRow, Tone } from '../logic/shared.ts';
import { displayName, ownsSession } from '../logic/agents.ts';
import type { HeavyState } from '../../../packages/core/src/semaphore.ts';
import type { LimitsFacts } from './limits.ts';
import type { RepoJobs } from '../progress.ts';
import type { LastStep } from '../transcript.ts';
import type { HomeArea } from './home.ts';

export const VIEW_KINDS = ['tasks', 'agents', 'worktrees', 'environments', 'setup', 'settings'] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

export const VIEW_TITLES: Record<ViewKind, string> = {
  tasks: 'Tasks', agents: 'Agents', worktrees: 'Worktrees', environments: 'Environments', setup: 'Setup', settings: 'Settings',
};

/** Identifies what an action applies to. The extension turns it back into the sidebar's node. */
export interface Ref {
  project?: string;
  task?: string;
  session?: string;
  worktree?: string;
  env?: string;
  step?: string;
}

export interface Action {
  command: string;
  label: string;
  icon: string;
  ref: Ref;
  primary?: boolean;
  danger?: boolean;
}

export interface Look {
  label: string;
  icon: string;
  tone: Tone;
}

/** What a kind of agent runs with, as Settings' How agents run shows it (D-036). */
export interface ProfileLike {
  model: string | null;
  effort: string | null;
  fallbackModel: string | null;
  from: { model: string; effort: string; fallbackModel: string };
}

export interface ProjectLike {
  name: string;
  root: string;
  agents?: { builder: ProfileLike; reviewer: ProfileLike };
  /**
   * autonomy: what autopilot may do on its own (D-055), when the config says. autopilot.autoMerge: whether
   * it merges pull requests (GH-67). trackers: which owns a ticket's key (D-066).
   */
  config: { github: { repo: string; account: string } | null; environments: Environment[]; profile: string; autonomy?: string; autopilot?: { autoMerge?: boolean }; trackers?: Pick<Tracker, 'kind' | 'project' | 'prefix'>[] };
  branch: string | null;
  worktrees: { path: string; head: string; branch: string | null; main: boolean; changed: number; locked: boolean; prunable: boolean }[];
}

export interface HubLike {
  projects: ProjectLike[];
  agents: AgentSession[];
  agentsError: string | null;
  taskRows(root: string): TaskRow[];
  projectFor(path: string): ProjectLike | undefined;
  /** Every move every task made, for the Overview's activity. */
  history?(root: string): ActivityItem[];
  /** The steps autopilot took in a project's repo, oldest first, wherever it ran (D-064). */
  autopilotLog?(root: string): AutopilotRecord[];
  /** The updates acc drafted for a project's tickets, posted or not (D-066). */
  updates?(root: string): Update[];
  /** Whether a project's repo has a tidy-up due, and the ledger it's counted from, which projects of one repo share (GH-104). */
  tidy?(root: string): (Pick<TidyStatus, 'due' | 'count' | 'every'> & { ledger: string }) | null;
  /** The rules suggested by a project's review findings that keep coming back, not yet accepted or dismissed (GH-102). */
  suggestions?(root: string): Suggestion[];
  /** Agents' questions waiting in the Command Center (D-030). */
  questions?: Question[];
  /** How earlier questions ended (D-037). */
  answers?: HistoryRecord[];
  askingFor?(s: AgentSession): string | null;
  /**
   * The task a session works for, from its repo's ledger, here or elsewhere on the machine, and whether its
   * work is over (D-095). A finished session reads as Finished and never needs you.
   */
  tieFor?(s: AgentSession): SessionTie | null;
  /** The model a session runs with (D-086): what its transcript last answered with, else what acc started it with. */
  modelFor?(s: AgentSession): string | null;
  /** The home folder, shown as ~ (GH-83). */
  home?: string;
  /** The repo a folder is in, by the nearest .git up from it, short of the home folder (GH-83). */
  repoFor?(path: string): string | null;
  /** The folders other windows' Command Centers show (D-030): a repo among them is in another window (GH-119). */
  otherWindows?: string[];
  /** Who holds the machine's heavy-check slots and who waits (D-092). */
  heavy?: HeavyState | null;
  /** The machine's load over the last minute, and its cores. */
  machine?: { load: number; cpus: number } | null;
  /** A project's repo's jobs under way: land, refresh, promote, deploy, autopilot's step, reviews, analyses and resumes. */
  jobsOf?(root: string): RepoJobs;
  /** A running builder's latest step and model, by its session. */
  stepOf?(sessionId: string): LastStep | null;
  /** This machine's limits and each project's, for Settings (GH-111). */
  limits?(): LimitsFacts | null;
}

/** The key a session goes by in refs: its session id, else its background id. */
export const sessionKey = (s: AgentSession): string => s.sessionId ?? s.id ?? `${s.pid ?? ''}:${s.startedAt}`;

/** What a session is called wherever it shows (D-087): the name acc gave it on its task, else Claude Code's. */
export function nameOf(hub: Pick<HubLike, 'projectFor' | 'taskRows'>, s: AgentSession): string {
  const p = hub.projectFor(s.cwd);
  return displayName(s, p ? hub.taskRows(p.root).find((r) => ownsSession(r, s)) : undefined);
}

export const LOOK = (label: string, icon: string, tone: Tone): Look => ({ label, icon, tone });

/** A task's state as core's DISPLAY shows it, and DESIGN.md's table: every page that shows a task's state reads it here (GH-105). */
export const displayLook = (d: DisplayState): Look => ({ label: DISPLAY[d].label, icon: DISPLAY[d].icon, tone: DISPLAY[d].tone });

export const HOME_SECTIONS = ['overview', ...VIEW_KINDS] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];

export interface ActivityItem {
  at: string;
  task: string;
  title: string;
  from: string | null;
  to: string;
  by: string;
}

export const KEY = /^[A-Z][A-Z0-9_]*-\d+$/i;
export const short = (v: unknown, max = 500): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/**
 * What one area adds, declared in its own module as `export const area` (D-099): the messages its parts of
 * the page send, each with its check, and its parts of the Command Center page. model/areas.ts, which npm
 * run build writes, gathers every area, so a new message or a new item under Needs you edits only its area.
 */
export interface ModelArea {
  /** The messages its parts send, by type, each with what such a message must hold. Everything else is ignored. */
  messages?: Record<string, (x: Record<string, unknown>) => boolean>;
  /** The acc.* commands its parts of the page may ask for. Anything else from a webview is ignored. */
  commands?: readonly string[];
  /** What it adds to the Command Center page. */
  home?: HomeArea;
}
