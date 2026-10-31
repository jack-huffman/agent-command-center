/**
 * A ticket's deploy on its Changes tab (T-158): one row for each environment on the ticket's path, in order, each
 * with its org and its state as an icon and a label (deployed, partly deployed, not deployed, or can't tell, read
 * from git and the org by T-155), when it was read, and a quiet Check again. Then one primary Deploy…, which asks
 * where, from the environments ahead (T-156), and starts the deploy guide's agent there (D-235). Nothing on the tab
 * deploys by itself. Plain data and the messages' checks: no vscode import.
 */

import type { Config, Environment } from '../../../packages/core/src/config.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import { missingDeps, taskDeployEnabled, ticketPlace } from '../../../packages/core/src/task-deploy.ts';
import { OPTIONS_MAX } from '../../../packages/core/src/talk-questions.ts';
import { environmentsAhead } from '../../../packages/core/src/ticket-path.ts';
import { pathFrom, type TicketWhere, type WhereState } from '../../../packages/core/src/where-kept.ts';
import { taskList } from '../../../packages/core/src/overlap.ts';
import { plural } from '../../../packages/core/src/text.ts';
import { reasonInWords } from '../logic/relayed.ts';
import { KEY, type Look, type ModelArea, short } from './shared.ts';

/** How an environment's state shows (T-155): blue for all of it, orange for some or none, quiet when it can't tell. */
export const WHERE_LOOK: Record<WhereState, Look> = {
  deployed: { label: 'Deployed', icon: 'pass', tone: 'blue' },
  partly: { label: 'Partly deployed', icon: 'warning', tone: 'orange' },
  'not-deployed': { label: 'Not deployed', icon: 'circle-slash', tone: 'orange' },
  unknown: { label: 'Can\'t tell', icon: 'question', tone: 'neutral' },
};

/**
 * Whether the work is merged into the development environment's branch: blue once it is, orange while its pull
 * request is open, quiet while it's built or before there's work.
 */
export const MERGE_LOOK: Record<'merged' | 'open' | 'building' | 'none', Look> = {
  merged: { label: 'Merged', icon: 'git-merge', tone: 'blue' },
  open: { label: 'Not merged yet', icon: 'git-pull-request', tone: 'orange' },
  building: { label: 'Being built', icon: 'tools', tone: 'neutral' },
  none: { label: 'No work yet', icon: 'circle-large-outline', tone: 'neutral' },
};

/** The usual next step, on its one row; and a deploy under way, on its row. */
export const NEXT_LOOK: Look = { label: 'Next', icon: 'arrow-right', tone: 'neutral' };
export const BUSY_LOOK: Look = { label: 'An agent is deploying it', icon: 'sync~spin', tone: 'blue' };

/** One environment on the ticket's path, as its row shows it. */
export interface EnvRow {
  name: string;
  branch: string;
  org: string | null;
  /** Its state, an icon and a label. */
  look: Look;
  /** When the work got there, by acc's records; null where it didn't, or acc has no record. */
  at: string | null;
  /** Words after the label: how many differ, or why it can't tell; null for none. */
  detail: string | null;
  /** Each component that differs, for partly and not deployed: the row opens to show them. */
  differs: string[];
  /** Where acc's own record, git and the org disagree, in words (T-155); none when they agree. */
  notes: string[];
  /** When it was last read; null before the first reading. */
  readAt: string | null;
  /** The development environment's row only: whether the work is merged into its branch, in words with an icon. */
  merged: { look: Look; words: string } | null;
  /** The usual next step, its icon and label: on one row at most; null on the rest. */
  next: Look | null;
  /** A deploy to it under way, its icon and words; null when there's none. */
  busy: Look | null;
  /** A read of it under way, so its Check again waits. */
  reading: boolean;
}

/** One environment Deploy… offers: its name, its org, what happens next, and why it can't be picked, or null. */
export interface DeployChoice {
  to: string;
  name: string;
  org: string | null;
  then: string;
  disabled: string | null;
}

/** Deploy…: the tab's one primary action. Off with why when nothing can go; on, it asks which environment. */
export interface DeployPick {
  label: string;
  disabled: string | null;
  /** At most three (D-205), in path order, the usual next step first. */
  choices: DeployChoice[];
}

/** The deploy part of the Changes tab. */
export interface TicketDeploy {
  task: string;
  rows: EnvRow[];
  /** Deploy…, or null at the end of the path. */
  pick: DeployPick | null;
  /** What the agent's deploy is doing, on the tab as on its row; null when there's none. */
  status: { look: Look; words: string } | null;
  /** What waits on the person here: the steps left to do by hand; null when nothing does. */
  needs: string | null;
}

export interface DeployIn {
  config: Pick<Config, 'profile' | 'environments' | 'github'>;
  task: Task;
  tasks: Task[];
  /** The environment's branch a deploy of this task is under way to, in this window or another: empty when acc didn't say which; null when there's none. */
  deploying: string | null;
  /** Its own checks that failed and no one accepted, by name; a deploy waits for them. */
  failing?: string[];
  /** The environment its pull request conflicts with, as the page's notice says; null when it doesn't. */
  conflicts?: string | null;
  /** How many steps it has left to do by hand, in every environment (record changes and deletions). */
  stepsLeft?: number;
  /** Where the orgs and branches were last read to hold its work (T-155), as kept beside the ledger; null before the first reading. */
  where?: TicketWhere | null;
  /** Whether a read of where its work is in an environment, by its branch, is under way; none when left out. */
  reading?: (branch: string) => boolean;
}

/** When acc recorded the work reaching `env`: a merged promotion or a deploy, the latest; null with none. */
function reachedAt(t: Pick<Task, 'promotions' | 'deploys'>, env: string): string | null {
  const times = [...(t.promotions ?? []).filter((p) => p.state === 'merged' && p.to === env).map((p) => p.mergedAt ?? p.at), ...(t.deploys ?? []).filter((d) => d.env === env).map((d) => d.at)];
  return times.sort().at(-1) ?? null;
}

/**
 * The rows, one for each environment on the ticket's path, in order, then each in `also` off the usual way (an
 * environment Deploy… offers, as Hotfix off QA). An environment's state is its last reading (T-155); before the
 * first, deployed where acc recorded it there, else can't tell, with no read time. Only the usual next step is
 * next; the development environment's row also says whether the work is merged into its branch.
 */
export function envRows(config: Pick<Config, 'environments'>, t: Pick<Task, 'environment' | 'promotions' | 'deploys' | 'pr' | 'state' | 'run'>, where: TicketWhere | null = null, deploying: string | null = null, also: Environment[] = [], reading: (branch: string) => boolean = () => false): EnvRow[] {
  const next = ticketPlace(config, t, where)?.next[0]?.branch ?? null;
  const path = pathFrom(config.environments, t.environment);
  return [...path, ...also.filter((e) => !path.includes(e))].map((e, i): EnvRow => {
    const r = where?.envs.find((x) => x.env === e.branch);
    const at = reachedAt(t, e.branch);
    const state: WhereState = r ? r.state : at ? 'deployed' : 'unknown';
    const detail = r?.state === 'partly' ? `${plural(r.differs.length, 'component')} differ${r.differs.length === 1 ? 's' : ''}`
      : r?.state === 'not-deployed' && r.differs.length ? `${plural(r.differs.length, 'component')} not in ${e.name}`
      : r?.state === 'unknown' ? reasonInWords(r.why) : null;
    const merge = t.pr?.state === 'merged' ? 'merged' : t.state === 'running' ? 'building' : t.pr || t.run?.branch ? 'open' : 'none';
    const words = { merged: `Merged into ${e.branch}`, open: `Not merged into ${e.branch} yet`, building: 'Being built', none: 'No work to merge yet' }[merge];
    return {
      name: e.name, branch: e.branch, org: e.org, look: WHERE_LOOK[state], at: state === 'deployed' ? at : null, detail,
      differs: r && (r.state === 'partly' || r.state === 'not-deployed') ? r.differs : [], notes: (r?.notes ?? []).map((n) => reasonInWords(n)), readAt: r?.at ?? null,
      merged: i === 0 ? { look: MERGE_LOOK[merge], words } : null,
      next: e.branch === next ? NEXT_LOOK : null, busy: deploying === e.branch ? BUSY_LOOK : null,
      reading: reading(e.branch),
    };
  });
}

/** Its checks that hold a deploy up: each that failed or errored and no one accepted anyway (D-031), by name. */
export const deployBlockers = (checks: readonly { gate: string; status: string; waived?: boolean }[]): string[] =>
  checks.filter((c) => (c.status === 'fail' || c.status === 'error') && !c.waived).map((c) => c.gate);

/** Why nothing can go now, or null: the command's own reason, its own checks failing, a conflict with its environment, or a deploy under way. */
export function pickOff(i: Pick<DeployIn, 'config' | 'task' | 'deploying' | 'failing' | 'conflicts' | 'where'>): string | null {
  const can = taskDeployEnabled(i.config, i.task, i.where);
  if (!can.ok) return can.why;
  const failing = i.failing ?? [];
  if (failing.length) return `The ${taskList(failing)} check${failing.length === 1 ? '' : 's'} failed: fix ${failing.length === 1 ? 'it' : 'them'}, or accept ${failing.length === 1 ? 'it' : 'them'} anyway, first.`;
  if (i.conflicts) return `It conflicts with ${i.conflicts}: take in ${i.conflicts} first.`;
  if (i.deploying != null) return 'A deploy of this ticket is under way. Wait for it to finish.';
  return null;
}

/** Why a deploy to `to` can't go now, or null: why nothing can, or no org, or a dependency not there yet. */
export function deployOff(i: Pick<DeployIn, 'config' | 'task' | 'tasks' | 'deploying' | 'failing' | 'conflicts' | 'where'>, to: Environment): string | null {
  const off = pickOff(i);
  if (off) return off;
  if (!to.org) return `${to.name} has no org in the project's settings.`;
  const waiting = missingDeps(i.tasks, i.task, to);
  if (waiting.length) return `It depends on ${waiting.join(', ')}, which ${waiting.length === 1 ? 'isn\'t' : 'aren\'t'} in ${to.name} yet.`;
  return null;
}

/** What happens once the person picks `e`: an agent deploys it, after they type its name for Production or a protected org (D-239). */
export const choiceThen = (e: Pick<Environment, 'name' | 'type' | 'protected'>): string =>
  (e.type === 'production' || e.protected ? `An agent deploys it after you type ${e.name}'s name` : 'An agent deploys it');

/** Deploy…: the environments ahead, at most three in path order, each with what happens next and why it can't be picked. */
export function deployPick(i: DeployIn): DeployPick | null {
  const place = ticketPlace(i.config, i.task, i.where);
  if (!place) return null;
  const ahead = environmentsAhead(i.config, place.at, [i.task.environment]).slice(0, OPTIONS_MAX);
  if (!ahead.length) return null;
  const off = pickOff(i);
  const choices = ahead.map((e): DeployChoice => ({ to: e.branch, name: e.name, org: e.org, then: choiceThen(e), disabled: off ?? deployOff(i, e) }));
  // Every choice off for its own reason: nothing can go, so Deploy… is off, saying each reason once; the same
  // dependency missing from each says so in one line, naming each environment.
  const waits = ahead.map((e) => missingDeps(i.tasks, i.task, e).join(', '));
  const oneWait = ahead.every((e, n) => e.org && waits[n] && waits[n] === waits[0]) ? waits[0]! : null;
  const names = ahead.map((e) => e.name);
  const where = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0];
  const none = off || !choices.every((c) => c.disabled) ? null
    : oneWait ? `It depends on ${oneWait}, which ${oneWait.includes(',') ? 'aren\'t' : 'isn\'t'} in ${where} yet.`
      : [...new Set(choices.map((c) => c.disabled!))].join(' ');
  return { label: 'Deploy…', disabled: off ?? none, choices };
}

/** The deploy part, for a Salesforce task whose environment is in the settings; null for any other. */
export function ticketDeploy(i: DeployIn): TicketDeploy | null {
  if (i.config.profile !== 'salesforce') return null;
  // Each environment Deploy… offers has a row, though it is off the usual way.
  const pick = deployPick(i);
  const also = (pick?.choices ?? []).map((c) => i.config.environments.find((e) => e.branch === c.to)).filter((e): e is Environment => !!e);
  const rows = envRows(i.config, i.task, i.where ?? null, i.deploying, also, i.reading);
  if (!rows.length) return null;
  const to = i.config.environments.find((e) => e.branch === i.deploying);
  return {
    task: i.task.id, rows, pick,
    status: i.deploying != null ? { look: BUSY_LOOK, words: to ? `An agent is deploying ${i.task.id} to ${to.name}.` : `An agent is deploying ${i.task.id}.` } : null,
    needs: stepsLeftWords(i.stepsLeft ?? 0),
  };
}

/** Steps left to do by hand, in words: "2 steps to do by hand", or null with none. */
export const stepsLeftWords = (n: number): string | null => (n ? `${plural(n, 'step')} to do by hand` : null);

export type Message =
  /** Deploy…'s pick (T-158): the deploy guide's agent, a Claude Code chat, for the ticket and the environment picked. */
  | { type: 'deploy-guide'; project: string; task: string; to: string }
  /** A row's Check again: read where the ticket's work is in that row's environment, by its branch, again. */
  | { type: 'where-check'; project: string; task: string; env: string };

const ticket = (x: Record<string, unknown>): boolean => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string);

export const area: ModelArea = {
  messages: {
    'deploy-guide': (x) => ticket(x) && short(x.to, 100),
    'where-check': (x) => ticket(x) && short(x.env, 100),
  },
};
