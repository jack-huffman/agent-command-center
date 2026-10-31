/**
 * What an agent is doing (T-164): Researching, Building, Testing, Deploying and the rest, read from its latest
 * steps in its session, as the agent's page tells them (D-030). The Agents page, a task's Agent panel, In
 * progress and the status bar all say it in these words. The step behind it goes on hover, in process words
 * (D-132): a raw command never reaches the page.
 * Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */

import { inProcessWords } from './processes.ts';

/** A tool call in a session, as its transcript holds it: read in the extension, never posted to the page. */
export interface ToolStep {
  tool: string;
  /** A Bash call's command line. */
  command?: string | null;
  /** The file it read or edited, relative to the session's folder where it's inside it. */
  path?: string | null;
}

export const ACTIVITY_KEYS = ['planning', 'researching', 'building', 'testing', 'deploying', 'committing', 'reviewing', 'working'] as const;
export type ActivityKey = (typeof ACTIVITY_KEYS)[number];

/** Each activity's words and icon: the one table every page reads (T-164). Working is the one a step the table doesn't know gets. */
export const ACTIVITIES: Record<ActivityKey, { label: string; icon: string }> = {
  planning: { label: 'Planning', icon: 'list-ordered' },
  researching: { label: 'Researching', icon: 'search' },
  building: { label: 'Building', icon: 'tools' },
  testing: { label: 'Testing', icon: 'beaker' },
  deploying: { label: 'Deploying', icon: 'rocket' },
  committing: { label: 'Committing', icon: 'git-commit' },
  reviewing: { label: 'Reviewing', icon: 'eye' },
  working: { label: 'Working', icon: 'sync~spin' },
};

export interface Activity {
  key: ActivityKey;
  label: string;
  icon: string;
  /** The step behind it, in process words, for its hover and a screen reader; null for Working. */
  detail: string | null;
}

/** How many of a session's latest tool calls are read for what it's doing: one it doesn't know looks further back. */
export const RECENT_STEPS = 5;

/** Tools that read: what a builder does while it researches. */
const READS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'LS']);
/** Tools that change a file. */
const EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
/** A shell command that only reads. */
const READ_LINE = /^(?:cat|head|tail|less|grep|rg|ls|find|sed -n|wc|tree|git (?:log|show|diff|status|grep|blame))\b/;

/** One step of a command line, without what only sets it up: a lower priority, `env X=1`, `npx`, a path to acc. */
function bare(part: string): string {
  let s = part.trim();
  for (let was = ''; was !== s;) {
    was = s;
    s = s.replace(/^(?:nice(?: -n ?-?\d+)?|time|npx|env)\s+/, '').replace(/^\w+=\S*\s+/, '');
  }
  return s.replace(/^\S*\/acc(?=\s|$)/, 'acc');
}

/** What one step of a command line does, by the table's key, with its detail; null for a step the table doesn't know. */
function lineDoing(line: string): { key: ActivityKey; detail: string } | null {
  let m: RegExpExecArray | null;
  if ((m = /^acc gate run(?:\s+(?!-)(\S+))?/.exec(line))) {
    if (m[1] === 'deploy') return { key: 'deploying', detail: 'Deploying its branch to its own org' };
    return { key: 'testing', detail: m[1] ? `Running the ${m[1]} check` : 'Running the checks' };
  }
  if ((m = /^acc deploy(?:\s+(?!-)(\S+))?/.exec(line))) return { key: 'deploying', detail: m[1] ? `Deploying to ${m[1]}` : 'Deploying' };
  if (/^sf project deploy (?:start|quick|resume)\b/.test(line)) {
    return /\s--dry-run\b/.test(line) ? { key: 'testing', detail: 'Checking a deploy, without making it' } : { key: 'deploying', detail: 'Deploying to an org' };
  }
  if (/^sf apex run test\b/.test(line)) return { key: 'testing', detail: 'Running the Apex tests' };
  if (/^npm run check\b/.test(line)) return { key: 'testing', detail: 'Running the full check' };
  if (/^(?:npm (?:run )?test\b|node --test\b)/.test(line)) return { key: 'testing', detail: 'Running the tests' };
  if (/^acc done\b/.test(line)) return { key: 'committing', detail: 'Finishing the task' };
  if (/^git commit\b/.test(line)) return { key: 'committing', detail: 'Committing its work' };
  if (READ_LINE.test(line)) return { key: 'researching', detail: 'Reading the code' };
  return null;
}

/** A command line's activity: its last step the table knows, one that only reads giving way to any other. */
function commandDoing(command: string): { key: ActivityKey; detail: string } | null {
  const found = command.split(/&&|\|\||[;|\n]/).map((p) => lineDoing(bare(p))).filter((d) => d !== null);
  return found.filter((d) => d.key !== 'researching').at(-1) ?? found.at(-1) ?? null;
}

/** One step's activity, or null for one the table doesn't know. */
function stepDoing(s: ToolStep): { key: ActivityKey; detail: string } | null {
  const path = s.path?.trim() || null;
  if (EDITS.has(s.tool)) return { key: 'building', detail: path ? `${s.tool === 'Write' ? 'Writing' : 'Editing'} ${path}` : 'Editing a file' };
  if (READS.has(s.tool)) return { key: 'researching', detail: s.tool === 'Read' && path ? `Reading ${path}` : s.tool.startsWith('Web') ? 'Reading the web' : 'Searching the code' };
  if (s.tool === 'Bash' && s.command) return commandDoing(s.command);
  return null;
}

const activity = (key: ActivityKey, detail: string | null): Activity => ({ key, ...ACTIVITIES[key], detail: detail === null ? null : inProcessWords(detail) });

/**
 * What an agent is doing, from its latest steps, newest first (T-164). A reviewer is Reviewing and an analyst
 * Planning, whatever step it's on. A builder is what its newest step the table knows says; a step it doesn't
 * know looks one further back, up to RECENT_STEPS. With none it knows, Working.
 */
export function activityOf(recent: readonly ToolStep[], role?: string | null): Activity {
  if (role === 'review') return activity('reviewing', 'Reviewing the branch');
  if (role === 'analysis') return activity('planning', 'Making a plan: reading the ticket and the code');
  for (const s of recent.slice(0, RECENT_STEPS)) {
    const d = stepDoing(s);
    if (d) return activity(d.key, d.detail);
  }
  return activity('working', null);
}

/**
 * What a session is doing (T-164), by its role and its latest steps as the hub last read them (`stepOf`).
 * A session whose steps aren't read yet, or has none, is Working, unless its role says more.
 */
export function sessionDoing(s: { sessionId?: string }, role: string | null | undefined, stepOf?: (sessionId: string) => { recent?: readonly ToolStep[] } | null): Activity {
  return activityOf((s.sessionId ? stepOf?.(s.sessionId)?.recent : null) ?? [], role);
}
