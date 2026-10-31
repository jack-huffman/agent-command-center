/**
 * A ticket's deploy on its Changes tab (T-138, D-219's engine): one line of the ticket's path, each
 * environment with an icon and words; Deploy to <next environment>, its one primary button, off with why
 * when it can't go, and any other next step in a small menu beside it; and the sheet it opens, which checks
 * first and deploys only on the person's own click. Plain data and the messages' checks: no vscode import.
 */

import type { Config, Environment } from '../../../packages/core/src/config.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import { missingDeps, type TaskDeployPlan, type TaskDeployResult, taskDeployEnabled, ticketPlace } from '../../../packages/core/src/task-deploy.ts';
import { whereWords } from '../../../packages/core/src/where.ts';
import { pathFrom, type TicketWhere, type WhereState } from '../../../packages/core/src/where-kept.ts';
import { taskList } from '../../../packages/core/src/overlap.ts';
import { plural } from '../../../packages/core/src/text.ts';
import { KEY, type Look, type ModelArea, short } from './shared.ts';

/** How each environment on the path shows: blue for where the change is, orange for the next step it can take, quiet for later. */
export const PATH_LOOK: Record<'merged' | 'deployed' | 'building' | 'next' | 'later', Look> = {
  merged: { label: 'merged', icon: 'git-merge', tone: 'blue' },
  deployed: { label: 'deployed', icon: 'pass', tone: 'blue' },
  building: { label: 'being built', icon: 'tools', tone: 'neutral' },
  next: { label: 'next', icon: 'arrow-right', tone: 'orange' },
  later: { label: 'later', icon: 'circle-large-outline', tone: 'neutral' },
};

/** How what the org was found to hold shows (T-155): blue for all of it, orange for some or none, quiet when it can't tell. */
export const WHERE_LOOK: Record<WhereState, Look> = {
  deployed: { label: 'in the org', icon: 'pass', tone: 'blue' },
  partly: { label: 'partly deployed', icon: 'warning', tone: 'orange' },
  'not-deployed': { label: 'not deployed', icon: 'circle-slash', tone: 'orange' },
  unknown: { label: 'can\'t tell', icon: 'question', tone: 'neutral' },
};

/** What the last reading of an environment found (T-155): its state, its words, git's state beside it, and when it was read. */
export interface PathFound {
  state: WhereState;
  look: Look;
  words: string;
  /** Each component that differs, for partly and not deployed. */
  differs: string[];
  git: WhereState;
  at: string;
}

/** One environment on the ticket's path: its name, its state, and when it got there, where it did. */
export interface PathStop {
  name: string;
  look: Look;
  at: string | null;
  /** What the org and git were last found to hold there; null or left out before the first reading. */
  found?: PathFound | null;
}

/** Deploy to an environment: its label, the environment's branch, and why it's off, or null when it's on. */
export interface DeployButton {
  label: string;
  to: string;
  disabled: string | null;
}

/** How the sheet shows at each step: checking, a check that passed or failed, deploying, deployed, or stopped. */
export const SHEET_LOOK: Record<'checking' | 'passed' | 'failed' | 'deploying' | 'deployed' | 'error', Look> = {
  checking: { label: 'Checking', icon: 'sync~spin', tone: 'blue' },
  passed: { label: 'The check passed', icon: 'pass', tone: 'blue' },
  failed: { label: 'The check failed', icon: 'warning', tone: 'orange' },
  deploying: { label: 'Deploying', icon: 'sync~spin', tone: 'blue' },
  deployed: { label: 'Deployed', icon: 'cloud-upload', tone: 'blue' },
  error: { label: 'It stopped', icon: 'warning', tone: 'orange' },
};

export type SheetPhase = keyof typeof SHEET_LOOK;

/** What the extension keeps of a ticket's deploy while its sheet is open: what's under way, the plan, the result. */
export interface DeployRun {
  to: string;
  toName: string;
  phase: SheetPhase;
  /** The step acc is on, in process words, while it checks or deploys. */
  progress: string | null;
  plan: TaskDeployPlan | null;
  result: TaskDeployResult | null;
  error: string | null;
  /** Cancel while it deploys: the sheet closes, and the tab says what it's doing, then how it went. */
  hidden?: boolean;
}

/** Something to do by hand after the deploy: its kind and how many. */
export interface ByHand {
  label: string;
  items: string[];
}

/** The sheet as the page draws it. */
export interface DeploySheet {
  task: string;
  to: string;
  toName: string;
  org: string | null;
  phase: SheetPhase;
  look: Look;
  /** "Checking against UAT…" or "Deploying to UAT…" while it runs; null once it's done. */
  progress: string | null;
  /** The step acc is on, in its own process words, under the progress; null before the first, or once it's done. */
  step: string | null;
  components: { count: number; types: { name: string; members: string[] }[] } | null;
  tests: string | null;
  byHand: ByHand[];
  /** The org's errors, per component, after a failed check. */
  problems: string[];
  summary: string | null;
  /** The check's id, the person's yes; only after a check that passed. */
  checkId: string | null;
  /** Why it can't deploy now though its check passed (a check of its own failed since, a conflict came): the tab's own reason; null when it can. */
  off: string | null;
  /** The name to type before Deploy is on, for production or a protected org; null when none is asked. */
  confirm: string | null;
  result: { summary: string; pr: { number: number; url: string } | null; warning: string | null } | null;
  error: string | null;
}

/** The deploy part of the Changes tab. */
export interface TicketDeploy {
  task: string;
  path: PathStop[];
  /** Deploy to the usual next step, or null at the end of the path. */
  deploy: DeployButton | null;
  /** Other next steps, for the small menu beside it: at most three (D-205). */
  others: DeployButton[];
  sheet: DeploySheet | null;
  /** What the deploy is doing, or how it went, on the tab as on the sheet: its icon and words, and its pull request. */
  status: { look: Look; words: string; pr: { number: number; url: string } | null } | null;
  /** What waits on the person here: a passed check not confirmed, else the steps left to do by hand; null when nothing does. */
  needs: string | null;
}

export interface DeployIn {
  config: Pick<Config, 'profile' | 'environments' | 'github'>;
  task: Task;
  tasks: Task[];
  /** A deploy of this task under way, in this window or another. */
  running: boolean;
  run: DeployRun | null;
  /** Its own checks that failed and no one accepted, by name; a deploy waits for them. */
  failing?: string[];
  /** The environment its pull request conflicts with, as the page's notice says; null when it doesn't. */
  conflicts?: string | null;
  /** How many steps it has left to do by hand, in every environment (record changes and deletions). */
  stepsLeft?: number;
  /** Where the orgs and branches were last read to hold its work (T-155), as kept beside the ledger; null before the first reading. */
  where?: TicketWhere | null;
}

/**
 * The ticket's path, one stop each: its own environment merged or being built, each it reached deployed,
 * with when, the next step and those after it. The path's usual way, as promotesTo's first names it. With the
 * kept readings (T-155), an environment an org was found to hold it in counts as reached, and each stop
 * carries what was found there and when.
 */
export function ticketPath(config: Pick<Config, 'environments'>, t: Pick<Task, 'environment' | 'promotions' | 'deploys' | 'pr'>, where: TicketWhere | null = null): PathStop[] {
  const place = ticketPlace(config, t, where);
  const path = pathFrom(config.environments, t.environment);
  const at = (env: string): string | null => {
    const times = [...(t.promotions ?? []).filter((p) => p.state === 'merged' && p.to === env).map((p) => p.mergedAt ?? p.at), ...(t.deploys ?? []).filter((d) => d.env === env).map((d) => d.at)];
    return times.sort().at(-1) ?? null;
  };
  const reached = place ? path.slice(0, path.indexOf(place.at) + 1) : [];
  const stop = (e: Environment, look: Look, when: string | null): PathStop => ({ name: e.name, look, at: when, found: foundAt(where, e.branch) });
  return path.map((e, i) => {
    if (i === 0) {
      const when = at(e.branch);
      if (when) return stop(e, PATH_LOOK.deployed, when);
      return t.pr?.state === 'merged' ? stop(e, PATH_LOOK.merged, null) : stop(e, PATH_LOOK.building, null);
    }
    if (reached.includes(e)) return stop(e, PATH_LOOK.deployed, at(e.branch));
    if (place?.next.includes(e)) return stop(e, PATH_LOOK.next, null);
    return stop(e, PATH_LOOK.later, null);
  });
}

/** What the kept reading of one environment found, as its stop shows it; null before the first. */
export function foundAt(where: TicketWhere | null, env: string): PathFound | null {
  const r = where?.envs.find((e) => e.env === env);
  return r ? { state: r.state, look: WHERE_LOOK[r.state], words: whereWords(r), differs: r.differs, git: r.git.state, at: r.at } : null;
}

/** Its checks that hold a deploy up: each that failed or errored and no one accepted anyway (D-031), by name. */
export const deployBlockers = (checks: readonly { gate: string; status: string; waived?: boolean }[]): string[] =>
  checks.filter((c) => (c.status === 'fail' || c.status === 'error') && !c.waived).map((c) => c.gate);

/**
 * Why a deploy to `to` can't go now, or null: the command's own reason, its own checks failing, a conflict with
 * its environment, one under way, no org, or a dependency not there yet.
 */
export function deployOff(i: Pick<DeployIn, 'config' | 'task' | 'tasks' | 'running' | 'run' | 'failing' | 'conflicts' | 'where'>, to: Environment): string | null {
  const can = taskDeployEnabled(i.config, i.task, i.where);
  if (!can.ok) return can.why;
  const failing = i.failing ?? [];
  if (failing.length) return `The ${taskList(failing)} check${failing.length === 1 ? '' : 's'} failed: fix ${failing.length === 1 ? 'it' : 'them'}, or accept ${failing.length === 1 ? 'it' : 'them'} anyway, first.`;
  if (i.conflicts) return `It conflicts with ${i.conflicts}: take in ${i.conflicts} first.`;
  if (i.run?.phase === 'checking') return 'Its check is under way. Wait for it to finish.';
  if (i.running || i.run?.phase === 'deploying') return 'A deploy of this ticket is under way. Wait for it to finish.';
  if (!to.org) return `${to.name} has no org in the project's settings.`;
  const waiting = missingDeps(i.tasks, i.task, to);
  if (waiting.length) return `It depends on ${waiting.join(', ')}, which ${waiting.length === 1 ? 'isn\'t' : 'aren\'t'} in ${to.name} yet.`;
  return null;
}

/** The sheet from what the extension keeps: the plan's facts once the check is back, the result once it's deployed. */
export function deploySheet(task: string, run: DeployRun): DeploySheet {
  const p = run.plan;
  const count = p ? p.types.reduce((n, t) => n + t.members.length, 0) : 0;
  const byHand: ByHand[] = p ? [
    { label: 'Deletions', items: p.deletions.map((d) => d.component) },
    { label: 'Record changes', items: p.records },
    { label: 'Environment-specific files, left as the org has them', items: p.leftOut },
  ].filter((b) => b.items.length) : [];
  const passed = run.phase === 'passed' && !!p?.check?.passed && !!p.check.id;
  const r = run.result;
  const running = run.phase === 'checking' || run.phase === 'deploying';
  return {
    task, to: run.to, toName: run.toName, org: p?.org ?? null, phase: run.phase, look: SHEET_LOOK[run.phase],
    progress: running ? `${run.phase === 'checking' ? 'Checking against' : 'Deploying to'} ${run.toName}…` : null,
    step: running ? run.progress : null,
    components: p ? { count, types: p.types.map((t) => ({ name: t.name, members: t.members })) } : null,
    tests: p?.tests ?? null,
    byHand,
    problems: run.phase === 'failed' ? p?.check?.problems ?? [] : [],
    summary: p?.check?.summary ?? null,
    checkId: passed ? p!.check!.id : null,
    off: null,
    confirm: p?.confirm ? p.confirmName : null,
    result: r ? { summary: r.summary, pr: r.pr, warning: r.warning } : null,
    error: run.error,
  };
}

/** The deploy part, for a Salesforce task whose environment is in the settings; null for any other. */
export function ticketDeploy(i: DeployIn): TicketDeploy | null {
  if (i.config.profile !== 'salesforce') return null;
  const path = ticketPath(i.config, i.task, i.where ?? null);
  if (!path.length) return null;
  const place = ticketPlace(i.config, i.task, i.where);
  const buttons = (place?.next ?? []).map((e): DeployButton => ({ label: `Deploy to ${e.name}`, to: e.branch, disabled: deployOff(i, e) }));
  const made = i.run ? deploySheet(i.task.id, i.run) : null;
  // A check that passed still waits for what holds the tab's Deploy up, in the same words.
  const env = made?.phase === 'passed' ? i.config.environments.find((e) => e.branch === made.to) : undefined;
  const all = made && env ? { ...made, off: deployOff({ ...i, run: null }, env) } : made;
  const sheet = all && !i.run?.hidden ? all : null;
  // The tab says what's under way, and how a deploy went, whether its sheet is open or not; a check's result is the sheet's.
  const status = all && all.phase !== 'passed' && all.phase !== 'failed'
    ? { look: all.look, words: (all.progress && all.step ? `${all.progress} ${all.step}` : all.progress) ?? all.result?.summary ?? all.error ?? all.look.label, pr: all.result?.pr ?? null } : null;
  return {
    task: i.task.id, path, deploy: buttons[0] ?? null, others: buttons.slice(1, 4), sheet, status,
    needs: (sheet?.phase === 'passed' && sheet.checkId && !sheet.off ? `Check passed: deploy to ${sheet.toName}` : null) ?? stepsLeftWords(i.stepsLeft ?? 0),
  };
}

/** Steps left to do by hand, in words: "2 steps to do by hand", or null with none. */
export const stepsLeftWords = (n: number): string | null => (n ? `${plural(n, 'step')} to do by hand` : null);

export type Message =
  /** Deploy to <environment> (T-138): opens the sheet and runs the check, which changes nothing. */
  | { type: 'deploy-check'; project: string; task: string; to: string }
  /** The sheet's Deploy: the person's yes, with the check's id and, for a protected org, its name typed. */
  | { type: 'deploy-go'; project: string; task: string; to: string; checkId: string; typed?: string }
  /** The sheet's Cancel or Close: what it kept goes. */
  | { type: 'deploy-close'; project: string; task: string }
  /** Deploy with an agent (T-154): a Claude Code chat as the deploy guide, for the ticket and where it goes. */
  | { type: 'deploy-guide'; project: string; task: string; to: string };

const ticket = (x: Record<string, unknown>): boolean => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string);

export const area: ModelArea = {
  messages: {
    'deploy-check': (x) => ticket(x) && short(x.to, 100),
    'deploy-go': (x) => ticket(x) && short(x.to, 100) && short(x.checkId, 200) && (x.typed === undefined || short(x.typed, 200)),
    'deploy-close': (x) => ticket(x),
    'deploy-guide': (x) => ticket(x) && short(x.to, 100),
  },
};
