/**
 * Settings' Limits and checks (GH-111): how many builders run at once, this project's cap and this
 * machine's total side by side, each with − and + and Change…; what a change means, in this machine's own
 * numbers; the heavy-check slots; and each project's checks. Every change goes through acc, which the
 * extension's limits.ts runs: the page writes no file. Plain data, posted to the webview and rendered there
 * with text only. No vscode import, so it's testable.
 */

import { DEFAULT_MODEL } from '../../../packages/core/src/config.ts';
import { MAX_AGENTS, MAX_MACHINE_AGENTS, median, type RecentWork } from '../../../packages/core/src/limits.ts';
import { MODEL_CHOICES } from '../logic/agents.ts';
import type { Look, ModelArea } from './shared.ts';

// ---------------------------------------------------------------- what the extension reads

/** One project's limits and checks, as its config and ledger say. */
export interface ProjectLimits {
  name: string;
  root: string;
  /** Its repo's ledger: two projects of one repo share their builders and their cap's count. */
  repo: string;
  /** Its builder cap (agents.max), and whether its .acc/config.json sets it or it's acc's default. */
  max: number;
  maxFrom: 'project' | 'acc';
  /** Its tasks in Running. */
  running: number;
  required: string[];
  /** Whether its .acc/config.json names the required checks (gates.required), or leaves them to acc's default. */
  requiredFrom: 'project' | 'acc';
  /** Builders' lighter checks (gates.builder), or null where it names none. */
  builder: string[] | null;
  /** The checks it has, to choose from. */
  gates: { name: string; about: string }[];
  /** The environments whose pull requests go through the merge queue, where builders' lighter checks apply (D-096). */
  queue: string[];
  /** The model builders run with, and where it's set (D-036, D-086). */
  model: string;
  modelFrom: string;
  recent: RecentWork;
}

/** What Settings reads for its Limits and checks, from the machine, and each project. */
export interface LimitsFacts {
  machine: {
    /** Heavy checks at once, and what sets it: ACC_HEAVY_SLOTS, machine.json, or acc's default of one (D-080). */
    slots: number;
    slotsFrom: 'env' | 'machine' | 'default';
    /** Heavy checks running now, and waiting for a slot (D-092). */
    inUse: number;
    waiting: number;
    /** At most this many builders at once across every repo, or null for no total. */
    total: number | null;
    /** Builders running across every repo on this machine acc knows of, and in how many repos. */
    running: number;
    repos: number;
    /** machine.json, as a person reads its path. */
    file: string;
  };
  projects: ProjectLimits[];
}

// ---------------------------------------------------------------- what the part shows

/** A − or a +: what it sets the value to, or, when it can't, why. */
export interface Step {
  label: string;
  arg: string | null;
  why: string | null;
}

/** One of the two caps on how many builders run at once: a project's, or this machine's total. */
export interface CapCard {
  key: string;
  title: string;
  /** The project a project's cap is for. */
  project: string | null;
  value: string;
  /** What the value counts. */
  unit: string;
  /** Where it's set, and who shares it. */
  from: string;
  look: Look;
  lower: Step;
  raise: Step;
  /** What − and + and Change… run. */
  command: string;
  /** Change…'s argument: the project, or none for the machine. */
  arg: string | null;
}

/** A setting with its value, where it's set, its state, and its Change…, or why there's none. */
export interface LimitRow {
  key: string;
  name: string;
  icon: string;
  value: string;
  from: string;
  look: Look | null;
  command: string;
  arg: string | null;
  /** Why Change… can't change it here, when it can't. */
  why: string | null;
}

/** A line of what a change to the caps means. */
export interface Meaning {
  key: string;
  icon: string;
  text: string;
}

export interface LimitsModel {
  caps: CapCard[];
  meaning: Meaning[];
  /** Whether agents bill per token, from Setup's check, when it has run (D-036). */
  billing: Look | null;
  slots: LimitRow;
  checks: { project: string; root: string; rows: LimitRow[] }[];
}

// ---------------------------------------------------------------- words

const builders = (n: number): string => `${n || 'No'} builder${n === 1 ? '' : 's'}`;

/** How long, in minutes or hours. */
export function durationWords(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** A cost, as Claude Code estimates it at API prices. */
export const dollars = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : Math.round(usd).toString()}`;

const average = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** "Tool", "Tool and Other", "Tool, Other and Third". */
const names = (xs: string[]): string => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : (xs[0] ?? ''));

/** A model as a person reads it: its name, and where it's set. */
export function modelWords(model: string, from: string): string {
  const known = MODEL_CHOICES.find((m) => m.name === model)?.about.split(':')[0];
  const shown = known ? `${known.replace(/^Claude /, '')} (${model})` : model;
  if (from === 'acc' || (model === DEFAULT_MODEL && from === 'default')) return `${shown}, acc's default unless set`;
  return `${shown}, set ${from === 'clone' ? 'for this clone' : from === 'project' ? 'for the project' : from === 'task' ? 'for the task' : 'by Claude Code'}`;
}

/** A cap's state: how many run of how many, and whether the next start waits. Blue while builders work, neutral while none do. */
function capLook(running: number, max: number | null, where: string): Look {
  if (max === null) return running ? { label: `${builders(running)} running ${where}, and no total`, icon: 'hubot', tone: 'blue' } : { label: 'No total: each project\'s cap is the only limit', icon: 'circle-large-outline', tone: 'neutral' };
  if (running >= max) return { label: `Full: ${running} of ${max} running ${where}, so the next start waits`, icon: 'clock', tone: 'blue' };
  if (!running) return { label: `None running ${where}: room for ${max}`, icon: 'circle-large-outline', tone: 'neutral' };
  return { label: `${running} of ${max} running ${where}: room for ${max - running} more`, icon: 'hubot', tone: 'blue' };
}

const step = (label: string, arg: string | null, why: string | null): Step => ({ label, arg, why });

// ---------------------------------------------------------------- the model

/** The commands the part runs, through acc. */
export const LIMIT_COMMANDS = {
  agentsMax: 'acc.settings.agentsMax',
  machineAgents: 'acc.settings.machineAgents',
  heavySlots: 'acc.settings.heavySlots',
  requiredGates: 'acc.settings.requiredGates',
  builderGates: 'acc.settings.builderGates',
} as const;

export function limitsModel(f: LimitsFacts, billing: Look | null = null): LimitsModel {
  const m = f.machine;
  const many = f.projects.length > 1;
  const caps: CapCard[] = f.projects.map((p) => ({
    key: `project:${p.root}`,
    title: many ? `${p.name}'s cap` : 'This project\'s cap',
    project: p.name,
    value: String(p.max),
    unit: `${p.max === 1 ? 'builder' : 'builders'} at once`,
    from: p.maxFrom === 'project'
      ? `Set in ${p.name}'s .acc/config.json (agents.max), shared with everyone who works on the repo once it's committed.`
      : `acc's default: ${p.name}'s .acc/config.json sets none (agents.max). A change sets it there, for everyone on the repo once it's committed.`,
    look: capLook(p.running, p.max, `in ${p.name}`),
    lower: p.max > 1 ? step(`Lower ${p.name}'s cap to ${p.max - 1}`, `${p.root}|${p.max - 1}`, null) : step(`Lower ${p.name}'s cap`, null, 'One is the least: a project runs at least one builder.'),
    raise: p.max < MAX_AGENTS ? step(`Raise ${p.name}'s cap to ${p.max + 1}`, `${p.root}|${p.max + 1}`, null) : step(`Raise ${p.name}'s cap`, null, `${MAX_AGENTS} is the most a project runs at once.`),
    command: LIMIT_COMMANDS.agentsMax,
    arg: p.root,
  }));
  const t = m.total;
  caps.push({
    key: 'machine',
    title: 'This machine\'s total',
    project: null,
    value: t === null ? 'None' : String(t),
    unit: t === null ? 'no total across repos' : `${t === 1 ? 'builder' : 'builders'} at once, across every repo`,
    from: t === null
      ? `Not set in ${m.file}: usage limits belong to your Claude account, so a total keeps every repo on this machine under one.`
      : `Set in ${m.file}, beside the heavy-check slots, for every repo on this machine: usage limits belong to your Claude account, not a project.`,
    look: capLook(m.running, t, m.repos > 1 ? `across ${m.repos} repos` : 'on this machine'),
    lower: t === null ? step('Lower this machine\'s total', null, 'There\'s no total to lower: Change… sets one.') : t > 1 ? step(`Lower this machine's total to ${t - 1}`, String(t - 1), null) : step('Lower this machine\'s total', null, 'One is the least: Change… takes the total out instead.'),
    raise: t === null ? step('Raise this machine\'s total', null, 'There\'s no total to raise: Change… sets one.') : t < MAX_MACHINE_AGENTS ? step(`Raise this machine's total to ${t + 1}`, String(t + 1), null) : step('Raise this machine\'s total', null, `${MAX_MACHINE_AGENTS} is the most it can be set to.`),
    command: LIMIT_COMMANDS.machineAgents,
    arg: null,
  });

  // What a change means, in this machine's own numbers where acc has them.
  const recent = f.projects.map((p) => p.recent);
  const reviews = recent.flatMap((r) => r.reviews);
  const analyses = recent.flatMap((r) => r.analyses);
  const builds = recent.flatMap((r) => r.builds);
  const review = average(reviews);
  const analysis = average(analyses);
  const costs = review === null && analysis === null
    ? 'No review or analysis here has recorded a cost yet, so there\'s nothing to go by.'
    : `Lately ${[review !== null ? `a review cost about ${dollars(review)}` : '', analysis !== null ? `an analysis about ${dollars(analysis)}` : ''].filter(Boolean).join(' and ')}, as Claude Code estimates at API prices (the last ${[review !== null ? `${reviews.length} review${reviews.length === 1 ? '' : 's'}` : '', analysis !== null ? `${analyses.length} analys${analyses.length === 1 ? 'is' : 'es'}` : ''].filter(Boolean).join(' and ')}).`;
  const models = [...new Map(f.projects.map((p) => [`${p.model}|${p.modelFrom}`, p])).values()];
  const modelLine = !models.length
    ? `Builders run Opus 5.5 (${DEFAULT_MODEL}), acc's default unless set.`
    : models.length === 1 ? `Builders here run ${modelWords(models[0]!.model, models[0]!.modelFrom)}.`
      : `Builders run ${models.map((p) => `${modelWords(p.model, p.modelFrom)} in ${p.name}`).join('; ')}.`;
  // As many as could run at once: the projects' caps, under this machine's total.
  const repos = [...new Map(f.projects.map((p) => [p.repo, p])).values()];
  const capSum = repos.reduce((n, p) => n + p.max, 0);
  const atOnce = t === null ? capSum : Math.min(t, capSum || t);
  const middle = median(builds);
  const slotsLine = `Each builder's checks wait for this machine's heavy-check slots, ${m.slots} at once${atOnce > m.slots ? `: with ${builders(atOnce)} at once, up to ${atOnce - m.slots === 1 ? 'one waits' : `${atOnce - m.slots} wait`} in line for a slot rather than finish sooner` : atOnce === 1 ? ', so a builder never waits for another\'s checks' : atOnce ? `, so ${builders(atOnce)} at once never wait for each other's checks` : ''}.`;
  const timeLine = middle === null ? 'No builder here has finished yet, so there\'s no time to go by.' : `Lately a builder here took about ${durationWords(middle)} from its dispatch to acc done (the middle of its last ${builds.length}).`;
  const here = repos.reduce((n, p) => n + p.running, 0);
  const nowLine = `${builders(here)} running now${f.projects.length ? ` in ${names(f.projects.map((p) => p.name))}` : ''}${m.running > here ? `, ${m.running} across this machine` : ''}.`;
  const meaning: Meaning[] = [
    { key: 'usage', icon: 'account', text: `Each agent is a Claude Code session on your account. ${modelLine} More at once uses your plan's limits that many times faster, and at the limit Claude Code pauses them until it resets. On per-token billing, each one costs as it runs. ${costs}` },
    { key: 'slots', icon: 'server-process', text: `${slotsLine} ${timeLine}` },
    { key: 'files', icon: 'git-merge', text: `More at once means more tasks touching the same files. They take turns, and conflicts at merge get likelier. ${nowLine}` },
  ];

  const slotsFrom: Record<LimitsFacts['machine']['slotsFrom'], string> = {
    machine: `Set in ${m.file}, for every repo on this machine.`,
    default: `acc's default: ${m.file} sets none. A change sets it there, for every repo on this machine.`,
    env: 'Set by ACC_HEAVY_SLOTS where VSCode started, which wins over this machine\'s own setting.',
  };
  const slots: LimitRow = {
    key: 'slots', name: 'Heavy-check slots', icon: 'server-process', value: `${m.slots} at once`, from: slotsFrom[m.slotsFrom],
    look: m.inUse || m.waiting
      ? { label: `${m.inUse} of ${m.slots} in use${m.waiting ? `, ${m.waiting} waiting` : ''}`, icon: m.waiting ? 'clock' : 'sync', tone: 'blue' }
      : { label: 'None in use', icon: 'circle-large-outline', tone: 'neutral' },
    command: LIMIT_COMMANDS.heavySlots, arg: null,
    why: m.slotsFrom === 'env' ? 'ACC_HEAVY_SLOTS sets it for this VSCode: take it out of the environment VSCode starts in to set it here.' : null,
  };

  const checks = f.projects.map((p) => {
    const config = `${p.name}'s .acc/config.json`;
    const queue = p.queue.length ? names(p.queue) : null;
    const required: LimitRow = {
      key: `required:${p.root}`, name: 'Required checks', icon: 'checklist', value: p.required.join(', ') || 'None',
      from: `${p.requiredFrom === 'project' ? `Set in ${config}, for everyone on the repo once it's committed.` : `acc's default: ${config} sets none (gates.required). A change sets it there, for everyone on the repo once it's committed.`}${queue ? ` Where the merge queue runs (${queue}), they run once in it, before each merge.` : ' acc done, review and land take them.'}`,
      look: p.required.length ? null : { label: 'None: acc done takes any commit', icon: 'warning', tone: 'orange' },
      command: LIMIT_COMMANDS.requiredGates, arg: p.root,
      why: p.gates.length ? null : `${p.name} has no checks to choose from yet: add commands under "gates.commands" in ${config}.`,
    };
    const builder: LimitRow = {
      key: `builder:${p.root}`, name: 'Builders\' checks', icon: 'tools',
      value: p.builder && queue ? p.builder.join(', ') : 'The required checks',
      from: queue
        ? p.builder ? `Set in ${config}: builders run these where the merge queue runs (${queue}), and the required checks run once in it.` : `Builders run the required checks: ${config} names no lighter ones for where the merge queue runs (${queue}).`
        : 'Builders run the required checks: no environment\'s pull requests go through the merge queue here (auto-merge, under autonomy review).',
      look: p.builder && !queue ? { label: `Named (${p.builder.join(', ')}), but unused while no merge queue runs`, icon: 'info', tone: 'neutral' } : null,
      command: LIMIT_COMMANDS.builderGates, arg: p.root,
      why: p.gates.length ? null : `${p.name} has no checks to choose from yet: add commands under "gates.commands" in ${config}.`,
    };
    return { project: p.name, root: p.root, rows: [required, builder] };
  });

  return { caps, meaning, billing, slots, checks };
}

export const area: ModelArea = {
  commands: Object.values(LIMIT_COMMANDS),
};

