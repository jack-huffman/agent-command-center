import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AccError } from './exec.ts';

export const PROFILES = ['generic', 'salesforce'] as const;
export type Profile = (typeof PROFILES)[number];

export const ENV_TYPES = ['production', 'full', 'partial', 'developer', 'developer_pro', 'none'] as const;
export type EnvType = (typeof ENV_TYPES)[number];

export const AUTONOMY = ['manual', 'dispatch', 'review', 'full'] as const;
export type Autonomy = (typeof AUTONOMY)[number];

/** bypassPermissions is deliberately absent: builders never run unguarded. */
export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk'] as const;

/** How hard Claude thinks, as Claude Code's --effort takes it (D-036). */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

/** The model and effort a kind of agent runs with. Anything left out is Claude Code's own default (D-036). */
export interface AgentProfile {
  /** An alias such as opus, sonnet or fable, or a full model name. */
  model: string | null;
  effort: Effort | null;
  /** The model Claude Code falls back to when the first is overloaded. */
  fallbackModel: string | null;
}

export const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,79}$/;
export const AGENT_ROLES = ['builder', 'reviewer'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];
export const noProfile = (): AgentProfile => ({ model: null, effort: null, fallbackModel: null });

export interface Environment {
  name: string;
  /** Always the lower-cased environment name (D-015). */
  branch: string;
  type: EnvType;
  org: string | null;
  default: boolean;
  protected: boolean;
  /** Branches this environment may promote to, usual step first (D-018). */
  promotesTo: string[];
}

export interface Tracker {
  kind: 'github' | 'jira' | 'azure';
  /** Jira: the site, such as acme.atlassian.net. */
  site: string | null;
  /** Jira: the project key. Azure DevOps: the project name. */
  project: string | null;
  /** GitHub: owner/name. By default, the project's own repo. */
  repo: string | null;
  /** Azure DevOps: the organization, as in dev.azure.com/<organization>. */
  organization: string | null;
  /** Azure DevOps: the team whose board to show. By default, the project's default team. */
  team: string | null;
  /** The board the Tasks tab shows: a Jira board id, a GitHub Project number, or an Azure board's name. */
  board: number | string | null;
  /** Azure DevOps: the work item key prefix, AB by default (AB-123). */
  prefix: string | null;
  /** GitHub: issues with any of these labels aren't tasks, such as milestone. */
  skipLabels: string[];
  /**
   * Whether the task page may change a ticket's status, assignee and labels. Off by default: a client's
   * tracker is theirs, and acc only drafts updates for a person to post (D-???). Your own repo can opt in.
   */
  edits: boolean;
}

export interface Config {
  schema: 1;
  project: string;
  profile: Profile;
  github: { repo: string; account: string } | null;
  commitIdentity: { name: string; email: string } | null;
  environments: Environment[];
  environmentSpecific: string | null;
  knownDrift: string | null;
  trackers: Tracker[];
  agents: { max: number; permissionMode: string; builder: AgentProfile; reviewer: AgentProfile };
  autonomy: Autonomy;
  worktrees: { root: string | null; setup: string[] };
  /** heavy: gates that take the machine-wide slot (D-024). severity: Code Analyzer's failing level, 1 to 5. */
  gates: { required: string[]; commands: Record<string, string>; heavy: string[]; severity: number };
  secretScan: { paths: string[]; exclude: string[] };
  /** Whether a task needs an analysis before it's built (D-052). Salesforce projects do unless they say not. */
  analysis?: { required: boolean };
  /** appendOnly: files autopilot may resolve when both sides only added to the end, such as a decision log (D-058). */
  autopilot?: { appendOnly: string[] };
}

const TOP_KEYS = new Set([
  'schema', 'project', 'profile', 'github', 'commitIdentity', 'environments', 'environmentSpecific',
  'knownDrift', 'trackers', 'agents', 'autonomy', 'worktrees', 'gates', 'secretScan', 'analysis', 'autopilot',
]);

/** Gates that take the machine-wide slot unless `gates.heavy` says otherwise (D-024). */
export const DEFAULT_HEAVY: Record<Profile, string[]> = {
  generic: ['build', 'test', 'check'],
  salesforce: ['static', 'lwc-tests', 'validate'],
};

/** The branch for an environment: its name in lower case (D-015). */
export function branchFor(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const strList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

export interface ParseResult {
  config: Config | null;
  errors: string[];
  warnings: string[];
}

export function parseConfig(raw: unknown): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { config: null, errors: ['The config must be a JSON object.'], warnings };

  for (const k of Object.keys(raw)) if (!TOP_KEYS.has(k)) warnings.push(`Unknown key "${k}" is ignored.`);
  if (raw.schema !== 1) errors.push('"schema" must be 1.');
  if (!isStr(raw.project)) errors.push('"project" must be a name.');

  const profile = (raw.profile ?? 'generic') as Profile;
  if (!PROFILES.includes(profile)) errors.push(`"profile" must be one of ${PROFILES.join(', ')}.`);

  let github: Config['github'] = null;
  if (raw.github !== undefined && raw.github !== null) {
    const g = raw.github;
    if (!isObj(g) || !isStr(g.repo) || !/^[\w.-]+\/[\w.-]+$/.test(g.repo) || !isStr(g.account)) {
      errors.push('"github" needs "repo" (owner/name) and "account" (the gh account for this repo).');
    } else github = { repo: g.repo, account: g.account };
  }

  let commitIdentity: Config['commitIdentity'] = null;
  if (raw.commitIdentity !== undefined && raw.commitIdentity !== null) {
    const c = raw.commitIdentity;
    if (!isObj(c) || !isStr(c.name) || !isStr(c.email)) errors.push('"commitIdentity" needs "name" and "email".');
    else commitIdentity = { name: c.name, email: c.email };
  }

  const environments = parseEnvironments(raw.environments, profile, errors);

  const optPath = (key: string): string | null => {
    const v = raw[key];
    if (v === undefined || v === null) return null;
    if (!isStr(v)) { errors.push(`"${key}" must be a path inside the repo.`); return null; }
    return v;
  };
  const environmentSpecific = optPath('environmentSpecific');
  const knownDrift = optPath('knownDrift');

  const trackers: Tracker[] = [];
  if (raw.trackers !== undefined) {
    if (!Array.isArray(raw.trackers)) errors.push('"trackers" must be a list.');
    else raw.trackers.forEach((t, i) => {
      if (!isObj(t) || (t.kind !== 'github' && t.kind !== 'jira' && t.kind !== 'azure')) {
        errors.push(`trackers[${i}]: "kind" must be github, jira or azure.`);
        return;
      }
      if (t.kind === 'azure' && (!isStr(t.organization) || !isStr(t.project))) {
        errors.push(`trackers[${i}]: an Azure DevOps tracker needs "organization" and "project".`);
        return;
      }
      if (t.prefix !== undefined && !(isStr(t.prefix) && /^[A-Za-z][A-Za-z0-9]{0,9}$/.test(t.prefix))) {
        errors.push(`trackers[${i}]: "prefix" must be a few letters, such as AB.`);
        return;
      }
      if (t.kind === 'jira' && (!isStr(t.site) || !isStr(t.project))) {
        errors.push(`trackers[${i}]: a Jira tracker needs "site" and "project".`);
        return;
      }
      if (t.skipLabels !== undefined && !(Array.isArray(t.skipLabels) && t.skipLabels.every(isStr))) {
        errors.push(`trackers[${i}]: "skipLabels" must be a list of label names, such as ["milestone"].`);
        return;
      }
      if (t.kind !== 'github' && Array.isArray(t.skipLabels) && t.skipLabels.length) {
        warnings.push(`trackers[${i}]: "skipLabels" applies only to a GitHub tracker, so it's ignored.`);
      }
      if (t.edits !== undefined && typeof t.edits !== 'boolean') {
        errors.push(`trackers[${i}]: "edits" must be true or false: whether the task page may change a ticket's status, assignee and labels.`);
        return;
      }
      const boardOk = t.board === undefined || t.board === null || (t.kind === 'azure' ? isStr(t.board) : Number.isInteger(t.board) && (t.board as number) > 0);
      if (!boardOk) {
        errors.push(`trackers[${i}]: "board" must be ${t.kind === 'azure' ? 'an Azure board\'s name, such as Stories' : 'a Jira board id or a GitHub Project number'}.`);
        return;
      }
      trackers.push({
        kind: t.kind,
        site: isStr(t.site) ? t.site : null,
        project: isStr(t.project) ? t.project : null,
        repo: isStr(t.repo) ? t.repo : null,
        organization: isStr(t.organization) ? t.organization : null,
        team: isStr(t.team) ? t.team : null,
        board: Number.isInteger(t.board) || isStr(t.board) ? (t.board as number | string) : null,
        prefix: isStr(t.prefix) ? t.prefix.toUpperCase() : null,
        skipLabels: t.kind === 'github' && strList(t.skipLabels) ? t.skipLabels : [],
        edits: t.edits === true,
      });
    });
  }

  const a = isObj(raw.agents) ? raw.agents : {};
  const max = a.max ?? 3;
  if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > 16) errors.push('"agents.max" must be a whole number from 1 to 16.');
  const permissionMode = a.permissionMode ?? 'acceptEdits';
  if (typeof permissionMode !== 'string' || !(PERMISSION_MODES as readonly string[]).includes(permissionMode)) {
    errors.push(`"agents.permissionMode" must be one of ${PERMISSION_MODES.join(', ')}. bypassPermissions is never allowed for builders.`);
  }

  const profileOf = (role: AgentRole): AgentProfile => {
    const p = a[role];
    if (p === undefined || p === null) return noProfile();
    if (!isObj(p)) { errors.push(`"agents.${role}" must be an object with model, effort and fallbackModel.`); return noProfile(); }
    const model = (v: unknown, key: string): string | null => {
      if (v === undefined || v === null) return null;
      if (typeof v !== 'string' || !MODEL_NAME.test(v)) { errors.push(`"agents.${role}.${key}" must be a model alias, such as sonnet, or a full model name.`); return null; }
      return v;
    };
    let effort: Effort | null = null;
    if (p.effort !== undefined && p.effort !== null) {
      if ((EFFORTS as readonly unknown[]).includes(p.effort)) effort = p.effort as Effort;
      else errors.push(`"agents.${role}.effort" must be one of ${EFFORTS.join(', ')}.`);
    }
    return { model: model(p.model, 'model'), effort, fallbackModel: model(p.fallbackModel, 'fallbackModel') };
  };
  const builder = profileOf('builder');
  const reviewer = profileOf('reviewer');

  const autonomy = (raw.autonomy ?? 'manual') as Autonomy;
  if (!AUTONOMY.includes(autonomy)) errors.push(`"autonomy" must be one of ${AUTONOMY.join(', ')}.`);

  const w = isObj(raw.worktrees) ? raw.worktrees : {};
  if (w.root !== undefined && w.root !== null && !isStr(w.root)) errors.push('"worktrees.root" must be a path.');
  if (w.setup !== undefined && !strList(w.setup)) errors.push('"worktrees.setup" must be a list of commands.');

  const g = isObj(raw.gates) ? raw.gates : {};
  if (g.required !== undefined && !strList(g.required)) errors.push('"gates.required" must be a list of gate names.');
  const commands: Record<string, string> = {};
  if (g.commands !== undefined) {
    if (!isObj(g.commands) || !Object.values(g.commands).every(isStr)) errors.push('"gates.commands" must map gate names to commands.');
    else Object.assign(commands, g.commands);
  }
  if (g.heavy !== undefined && !strList(g.heavy)) errors.push('"gates.heavy" must be a list of gate names.');
  if (g.severity !== undefined && !(Number.isInteger(g.severity) && (g.severity as number) >= 1 && (g.severity as number) <= 5)) {
    errors.push('"gates.severity" must be a whole number from 1 (only the worst problems fail) to 5 (everything fails).');
  }

  const s = isObj(raw.secretScan) ? raw.secretScan : {};
  if (s.paths !== undefined && !strList(s.paths)) errors.push('"secretScan.paths" must be a list.');
  if (s.exclude !== undefined && !strList(s.exclude)) errors.push('"secretScan.exclude" must be a list.');
  const defaultScan = profile === 'salesforce' ? ['force-app', 'config', 'scripts'] : ['.'];

  const an = isObj(raw.analysis) ? raw.analysis : {};
  if (raw.analysis !== undefined && !isObj(raw.analysis)) errors.push('"analysis" must be an object, such as { "required": true }.');
  if (an.required !== undefined && typeof an.required !== 'boolean') errors.push('"analysis.required" must be true or false.');

  let autopilot: Config['autopilot'];
  if (raw.autopilot !== undefined) {
    const ap = raw.autopilot;
    if (!isObj(ap)) errors.push('"autopilot" must be an object, such as { "appendOnly": ["docs/DECISIONS.md"] }.');
    else {
      for (const k of Object.keys(ap)) if (k !== 'appendOnly') warnings.push(`Unknown key "autopilot.${k}" is ignored.`);
      const list = ap.appendOnly ?? [];
      // Paths inside the repo, as git names them: never absolute, never climbing out.
      if (!strList(list) || list.some((f) => f.startsWith('/') || f.split('/').includes('..'))) {
        errors.push('"autopilot.appendOnly" must be a list of paths inside the repo, such as ["docs/DECISIONS.md"].');
      } else autopilot = { appendOnly: list };
    }
  }

  if (errors.length) return { config: null, errors, warnings };
  return {
    config: {
      schema: 1,
      project: raw.project as string,
      profile,
      github,
      commitIdentity,
      environments,
      environmentSpecific,
      knownDrift,
      trackers,
      agents: { max: max as number, permissionMode: permissionMode as string, builder, reviewer },
      autonomy,
      worktrees: { root: isStr(w.root) ? w.root : null, setup: strList(w.setup) ? w.setup : [] },
      gates: {
        required: strList(g.required) ? g.required : [],
        commands,
        heavy: strList(g.heavy) ? g.heavy : DEFAULT_HEAVY[profile],
        severity: (g.severity as number | undefined) ?? 2,
      },
      secretScan: {
        paths: strList(s.paths) ? s.paths : defaultScan,
        exclude: strList(s.exclude) ? s.exclude : [],
      },
      ...(typeof an.required === 'boolean' ? { analysis: { required: an.required } } : {}),
      ...(autopilot ? { autopilot } : {}),
    },
    errors,
    warnings,
  };
}

function parseEnvironments(raw: unknown, profile: Profile, errors: string[]): Environment[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push('"environments" must list at least one environment.');
    return [];
  }
  const envs: Environment[] = [];
  raw.forEach((e, i) => {
    const at = `environments[${i}]`;
    if (!isObj(e) || !isStr(e.name)) { errors.push(`${at}: needs a "name".`); return; }
    const branch = branchFor(e.name);
    if (e.branch !== undefined && e.branch !== branch) {
      errors.push(`${at}: the branch for "${e.name}" must be "${branch}", the environment name in lower case (D-015).`);
    }
    const type = (e.type ?? (profile === 'salesforce' ? undefined : 'none')) as EnvType | undefined;
    if (type === undefined || !ENV_TYPES.includes(type)) {
      errors.push(`${at}: "type" must be one of ${ENV_TYPES.join(', ')}.`);
      return;
    }
    if (profile === 'salesforce' && type === 'none') errors.push(`${at}: a Salesforce environment needs its org type.`);
    if (e.org !== undefined && e.org !== null && !isStr(e.org)) errors.push(`${at}: "org" must be an org alias.`);
    const isProd = type === 'production';
    if (isProd && e.protected === false) errors.push(`${at}: Production is always protected.`);
    if (e.promotesTo !== undefined && !strList(e.promotesTo)) errors.push(`${at}: "promotesTo" must be a list of branches.`);
    envs.push({
      name: e.name,
      branch,
      type,
      org: isStr(e.org) ? e.org : null,
      default: e.default === true,
      protected: isProd || e.protected === true,
      promotesTo: strList(e.promotesTo) ? e.promotesTo.map(branchFor) : [],
    });
  });

  const seen = new Set<string>();
  for (const env of envs) {
    if (seen.has(env.branch)) errors.push(`Two environments share the branch "${env.branch}".`);
    seen.add(env.branch);
  }
  const defaults = envs.filter((e) => e.default);
  if (envs.length && defaults.length !== 1) errors.push('Mark exactly one environment as "default": the one day-to-day work starts from.');
  for (const d of defaults) if (d.protected) errors.push(`The default environment "${d.name}" can't be protected.`);
  for (const env of envs) {
    for (const to of env.promotesTo) {
      if (to === env.branch) errors.push(`"${env.name}" can't promote to itself.`);
      else if (!seen.has(to)) errors.push(`"${env.name}" promotes to "${to}", which isn't a listed environment.`);
    }
  }
  const cycle = findCycle(envs);
  if (cycle) errors.push(`The promotion paths loop: ${cycle.join(' → ')}.`);
  return envs;
}

function findCycle(envs: Environment[]): string[] | null {
  const next = new Map(envs.map((e) => [e.branch, e.promotesTo]));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (b: string): string[] | null => {
    if (state.get(b) === 'done') return null;
    if (state.get(b) === 'visiting') return [...stack.slice(stack.indexOf(b)), b];
    state.set(b, 'visiting');
    stack.push(b);
    for (const to of next.get(b) ?? []) {
      const c = visit(to);
      if (c) return c;
    }
    stack.pop();
    state.set(b, 'done');
    return null;
  };
  for (const e of envs) {
    const c = visit(e.branch);
    if (c) return c;
  }
  return null;
}

export function loadConfig(file: string): ParseResult & { config: Config } {
  if (!existsSync(file)) throw new AccError('no-config', `No ${file}. Run "acc init" first.`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new AccError('bad-config', `${file} isn't valid JSON: ${(e as Error).message}`);
  }
  const r = parseConfig(raw);
  if (!r.config) throw new AccError('bad-config', `${file} has problems:\n- ${r.errors.join('\n- ')}`);
  return r as ParseResult & { config: Config };
}

/** Writes the config in a stable, readable shape. Branch names are derived, so they aren't written. */
export function writeConfig(file: string, config: Config): void {
  mkdirSync(dirname(file), { recursive: true });
  // A profile with nothing set is left out, so the file says only what was chosen (D-036).
  const profile = (p: AgentProfile) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null));
  const { builder, reviewer, ...agents } = config.agents;
  const out = {
    ...config,
    environments: config.environments.map(({ branch: _branch, ...e }) => e),
    // A tracker says it may change tickets only when it may (D-???).
    trackers: config.trackers.map(({ edits, ...t }) => (edits ? { ...t, edits } : t)),
    agents: { ...agents, ...(Object.keys(profile(builder)).length ? { builder: profile(builder) } : {}), ...(Object.keys(profile(reviewer)).length ? { reviewer: profile(reviewer) } : {}) },
  };
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
}

export function defaultEnvironment(config: Config): Environment {
  const env = config.environments.find((e) => e.default);
  if (!env) throw new AccError('bad-config', 'No default environment.');
  return env;
}

export function environmentByBranch(config: Config, branch: string): Environment | undefined {
  return config.environments.find((e) => e.branch === branch);
}

/**
 * Environments the usual path from `from` passes through before reaching `to`, which a direct
 * promotion would skip (D-018). Empty when `to` is the usual next step or isn't on the usual path.
 */
export function skippedOnRoute(config: Config, from: string, to: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>([from]);
  let cur = environmentByBranch(config, from);
  while (cur && cur.promotesTo[0] && !seen.has(cur.promotesTo[0])) {
    const nxt = cur.promotesTo[0];
    if (nxt === to) return chain;
    chain.push(nxt);
    seen.add(nxt);
    cur = environmentByBranch(config, nxt);
  }
  return [];
}

/**
 * Which tracker a ticket key belongs to, by its index: GH-12 to GitHub, AB-123 to the Azure DevOps tracker
 * with that prefix, MSP-7 to the Jira project MSP. A repo with two Jira sites posts each ticket's update
 * through its own (D-???).
 */
export function trackerForKey(trackers: Pick<Tracker, 'kind' | 'project' | 'prefix'>[], key: string): number | null {
  const k = key.toUpperCase();
  const i = trackers.findIndex((t) => (/^GH-\d+$/.test(k) ? t.kind === 'github'
    : t.kind === 'azure' ? k.startsWith(`${(t.prefix ?? 'AB').toUpperCase()}-`)
      : t.kind === 'jira' && !!t.project && k.startsWith(`${t.project.toUpperCase()}-`)));
  return i >= 0 ? i : null;
}

/**
 * The raw trackers list with one tracker added, or put in place of the one it describes (same kind,
 * project and site, organization or repo). Settings the new one doesn't name, such as a GitHub tracker's
 * skipLabels (D-048), are kept: re-adding a tracker never quietly drops them.
 */
export function withTracker(trackers: Record<string, unknown>[], tracker: Record<string, unknown>): Record<string, unknown>[] {
  const where = (t: Record<string, unknown>) => t.site ?? t.organization ?? t.repo;
  const i = trackers.findIndex((t) => t.kind === tracker.kind && t.project === tracker.project && where(t) === where(tracker));
  if (i < 0) return [...trackers, tracker];
  return trackers.map((t, k) => (k === i ? { ...t, ...tracker } : t));
}
