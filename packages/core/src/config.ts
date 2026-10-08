import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AccError } from './exec.ts';
import { isTrackerKind, orList, TRACKER_KINDS, type TrackerKind } from './trackers/types.ts';

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

/**
 * The model and effort a kind of agent runs with (D-036). A model left out is acc's own default,
 * DEFAULT_MODEL (D-086); an effort or fallback left out is Claude Code's own default.
 */
export interface AgentProfile {
  /** An alias such as opus, sonnet or fable, or a full model name. */
  model: string | null;
  effort: Effort | null;
  /** The model Claude Code falls back to when the first is overloaded. */
  fallbackModel: string | null;
}

export const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,79}$/;
/** The model an agent runs with when neither the project nor the clone names one (D-086). */
export const DEFAULT_MODEL = 'claude-opus-5-5';
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
  kind: TrackerKind;
  /** Jira: the site, such as acme.atlassian.net. */
  site: string | null;
  /** Jira: the project key. Azure DevOps: the project name. */
  project: string | null;
  /** GitHub: owner/name. By default, the project's own repo. */
  repo: string | null;
  /** Azure DevOps: the organization, as in dev.azure.com/<organization>. */
  organization: string | null;
  /** monday.com: the account, as in acme.monday.com. */
  account: string | null;
  /** Azure DevOps: the team whose board to show. By default, the project's default team. */
  team: string | null;
  /**
   * The board the Tasks tab shows: a Jira board id, a GitHub Project number, or an Azure board's name. A
   * monday.com board's id, which is also which tracker it is, as a Jira project is.
   */
  board: number | string | null;
  /** monday.com: the status column whose labels are the board's columns. By default, the one called Status, or the first. */
  statusColumn: string | null;
  /** Azure DevOps: the work item key prefix, AB by default (AB-123). monday.com: the item key prefix, MON by default (MON-123). */
  prefix: string | null;
  /** GitHub: issues with any of these labels aren't tasks, such as milestone. */
  skipLabels: string[];
  /**
   * Where in the tracker this repo's tickets come from, narrower than its project or repo (D-072). Jira: an
   * epic's key, so only its child tickets and their sub-tasks count. GitHub: labels, so only issues with one
   * of them count. Azure DevOps: an area path, so only work items under it count. monday.com: a group's id,
   * so only the board's items in that group count. Unset, the whole project or board.
   */
  epic: string | null;
  labels: string[];
  areaPath: string | null;
  group: string | null;
  /**
   * Whether the task page may change a ticket's status, assignee and labels, and, on GitHub, whether acc
   * sync closes a task's issue when its work merges (D-082). Off by default: a client's tracker is theirs,
   * and acc only drafts updates for a person to post (D-066). Your own repo can opt in.
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
  /**
   * heavy: gates that take the machine-wide slot (D-024). severity: Code Analyzer's failing level, 1 to 5.
   * builder: the lighter checks builders run where the merge queue runs `required` once before each merge
   * (GH-73). Left out, builders run `required`, as everywhere else. ratchets: checks whose command prints a
   * number that may only get better, kept against a floor or a ceiling in `.acc/floors.json` (GH-99).
   */
  gates: { required: string[]; commands: Record<string, string>; heavy: string[]; severity: number; builder?: string[]; ratchets?: Record<string, RatchetSpec> };
  secretScan: { paths: string[]; exclude: string[] };
  /** Whether a task needs an analysis before it's built (D-052). Salesforce projects do unless they say not. */
  analysis?: { required: boolean };
  /**
   * appendOnly: files autopilot may resolve when both sides only added to the end, such as a decision log
   * (D-058). autoMerge: autopilot merges a reviewed, green pull request into an environment that isn't
   * protected (GH-67). Off unless it's true; never in a Salesforce project.
   */
  autopilot?: { appendOnly: string[]; autoMerge?: true };
  /** shared: files, or folders, that never make two tasks wait for each other, such as docs every task edits (D-093). */
  dispatch?: { shared: string[] };
  /** The team template the project was started from, and its digest then, so Setup can say when it changed (GH-80). */
  template?: TemplateRecord;
}

/** Which way a ratchet's number may go (GH-99): a floor's only up, a ceiling's only down. */
export const RATCHET_LIMITS = ['floor', 'ceiling'] as const;
export type RatchetLimit = (typeof RATCHET_LIMITS)[number];

/** A ratchet (GH-99): a command whose last line is a number, which way it may go, and how pages name it. */
export interface RatchetSpec {
  command: string;
  limit: RatchetLimit;
  label: string;
}

/** A ratchet's name: its gate's name too, and its receipt's file name. */
export const RATCHET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

export interface TemplateRecord {
  name: string;
  /** Where it was fetched from: a GitHub file URL, <git-url>#<path>, or a path as ~/… or inside the repo. */
  source: string;
  /** sha256 of the template's JSON with its keys sorted, as sha256:<hex>. */
  digest: string;
}

export const TEMPLATE_DIGEST = /^sha256:[0-9a-f]{64}$/;

/**
 * Every key a Config has, by its path as .acc/config.json nests it: `gates.severity`, an environment's
 * `environments[].org`, a tracker's `trackers[].team`, a role's `agents.builder.model`. A list of strings
 * is one key, and so is a map such as `gates.commands`.
 */
type PathsOf<T> = {
  [K in keyof T & string]-?: NonNullable<T[K]> extends infer V
    ? V extends readonly (infer E)[] ? (E extends object ? `${K}[].${PathsOf<E>}` : K)
      : V extends object ? (string extends keyof V ? K : `${K}.${PathsOf<V>}`) : K
    : never;
}[keyof T & string];
export type ConfigPath = PathsOf<Config>;
/** The keys one level holds: Under<'trackers[]'> is a tracker's. */
type Under<P extends string, C = ConfigPath> = C extends `${P}.${infer L}` ? L : never;

/**
 * Every key parseConfig knows (GH-107), in the file's order. Its warnings about unknown keys come from this
 * list, at every level, and scripts/test/settings.test.ts checks each key is read by code and described in
 * DESIGN.md §4. tsc refuses a path here that isn't a Config's, and one a Config has that's left out.
 */
export const CONFIG_KEYS = [
  'schema', 'project', 'profile', 'github.repo', 'github.account', 'commitIdentity.name', 'commitIdentity.email',
  'environments[].name', 'environments[].branch', 'environments[].type', 'environments[].org', 'environments[].default',
  'environments[].protected', 'environments[].promotesTo', 'environmentSpecific', 'knownDrift',
  'trackers[].kind', 'trackers[].site', 'trackers[].project', 'trackers[].repo', 'trackers[].organization', 'trackers[].account',
  'trackers[].team', 'trackers[].board', 'trackers[].statusColumn', 'trackers[].prefix', 'trackers[].skipLabels',
  'trackers[].epic', 'trackers[].labels', 'trackers[].areaPath', 'trackers[].group', 'trackers[].edits',
  'agents.max', 'agents.permissionMode', 'agents.builder.model', 'agents.builder.effort', 'agents.builder.fallbackModel',
  'agents.reviewer.model', 'agents.reviewer.effort', 'agents.reviewer.fallbackModel', 'autonomy',
  'worktrees.root', 'worktrees.setup', 'gates.required', 'gates.commands', 'gates.heavy', 'gates.severity', 'gates.builder', 'gates.ratchets',
  'secretScan.paths', 'secretScan.exclude', 'analysis.required', 'autopilot.appendOnly', 'autopilot.autoMerge',
  'dispatch.shared', 'template.name', 'template.source', 'template.digest',
] as const satisfies readonly ConfigPath[];

type LeftOut = Exclude<ConfigPath, (typeof CONFIG_KEYS)[number]>;
/** tsc's check that CONFIG_KEYS has every key a Config has: one left out is named in its error. */
const allKeys: [LeftOut] extends [never] ? true : LeftOut = true;
void allKeys;

/**
 * Keys parseConfig accepts that no code reads yet, each with the ticket or decision that will read it
 * (GH-107). The Command Center shows no setting for one, and scripts/test/settings.test.ts fails once one
 * is read, so it comes off. A key nothing reads and nothing promises is taken out of CONFIG_KEYS instead.
 */
export const UNREAD_KEYS: Partial<Record<ConfigPath, string>> = {};

/**
 * Keys only parseConfig reads, and why that's all they need (GH-107). scripts/test/settings.test.ts pins
 * this list to these two, so it can't grow quietly.
 */
export const VALIDATOR_ONLY: Partial<Record<ConfigPath, string>> = {
  schema: 'The file\'s format. parseConfig refuses any but 1, so nothing after it has to look.',
  'environments[].branch': 'Always the environment\'s name in lower case (D-015). parseConfig refuses any other, and code reads the branch it derives from the name.',
};

/** Whether the Command Center offers a setting for this key: not while nothing reads it (GH-107). */
export const keyShown = (key: ConfigPath, unread: Partial<Record<ConfigPath, string>> = UNREAD_KEYS): boolean => unread[key] === undefined;

/** The keys each level of the file holds, by its path: '' is the top, `trackers[]` a tracker, `agents.builder` a role. */
const LEVELS = new Map<string, Set<string>>();
for (const key of CONFIG_KEYS) {
  const parts = key.split('.');
  parts.forEach((part, i) => {
    const at = parts.slice(0, i).join('.');
    LEVELS.set(at, (LEVELS.get(at) ?? new Set()).add(part.replace(/\[\]$/, '')));
  });
}

/** A warning for each key parseConfig doesn't know, at every level (GH-107), such as `gates.foo` or `trackers[0].foo`. */
function unknownKeys(raw: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (v: Record<string, unknown>, at: string, said: string) => {
    for (const [k, x] of Object.entries(v)) {
      const path = at ? `${at}.${k}` : k;
      const name = said ? `${said}.${k}` : k;
      if (!LEVELS.get(at)?.has(k)) out.push(`Unknown key "${name}" is ignored.`);
      else if (Array.isArray(x) && LEVELS.has(`${path}[]`)) x.forEach((e, i) => { if (isObj(e)) walk(e, `${path}[]`, `${name}[${i}]`); });
      else if (isObj(x) && LEVELS.has(path)) walk(x, path, name);
    }
  };
  walk(raw, '', '');
  return out;
}

/** Gates that take the machine-wide slot unless `gates.heavy` says otherwise (D-024). */
export const DEFAULT_HEAVY: Record<Profile, string[]> = {
  generic: ['build', 'test', 'check'],
  salesforce: ['static', 'lwc-tests', 'validate'],
};

/** The gates each profile has built in, by name, so a ratchet can't take one's name (GH-99). gates.ts has them. */
export const BUILT_IN_GATES: Record<Profile, string[]> = {
  generic: [],
  salesforce: ['format', 'lint', 'static', 'lwc-tests', 'validate'],
};

/** The branch for an environment: its name in lower case (D-015). */
export function branchFor(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const strList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const JIRA_ISSUE = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

export interface ParseResult {
  config: Config | null;
  errors: string[];
  warnings: string[];
}

export function parseConfig(raw: unknown): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { config: null, errors: ['The config must be a JSON object.'], warnings };

  warnings.push(...unknownKeys(raw));
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
      if (!isObj(t) || !isTrackerKind(t.kind)) {
        errors.push(`trackers[${i}]: "kind" must be ${orList([...TRACKER_KINDS])}.`);
        return;
      }
      if (t.kind === 'monday' && (!isStr(t.account) || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(t.account.trim()) || !Number.isSafeInteger(t.board) || (t.board as number) <= 0)) {
        errors.push(`trackers[${i}]: a monday.com tracker needs "account" (as in acme.monday.com) and "board" (the board's id, a number).`);
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
      // The tracker's place (D-072): each key belongs to one kind of tracker, and is ignored on another.
      const placeKeys: { key: Under<'trackers[]'>; kind: TrackerKind; on: string; ok: boolean; error: string }[] = [
        { key: 'epic', kind: 'jira', on: 'a Jira', ok: isStr(t.epic) && JIRA_ISSUE.test(t.epic.trim()), error: '"epic" must be a Jira epic\'s key, such as ACME-3.' },
        { key: 'labels', kind: 'github', on: 'a GitHub', ok: strList(t.labels), error: '"labels" must be a list of label names, such as ["billing"].' },
        { key: 'areaPath', kind: 'azure', on: 'an Azure DevOps', ok: isStr(t.areaPath), error: '"areaPath" must be an Azure DevOps area path, such as "CRM\\\\Billing".' },
        { key: 'group', kind: 'monday', on: 'a monday.com', ok: isStr(t.group), error: '"group" must be a monday.com group\'s id, such as "topics".' },
        { key: 'statusColumn', kind: 'monday', on: 'a monday.com', ok: isStr(t.statusColumn), error: '"statusColumn" must be a monday.com status column\'s id, such as "status".' },
      ];
      const set = placeKeys.filter((p) => t[p.key] !== undefined && t[p.key] !== null);
      const bad = set.filter((p) => !p.ok);
      if (bad.length) {
        for (const p of bad) errors.push(`trackers[${i}]: ${p.error}`);
        return;
      }
      for (const p of set) {
        const empty = Array.isArray(t[p.key]) && !(t[p.key] as unknown[]).length;
        if (t.kind !== p.kind && !empty) warnings.push(`trackers[${i}]: "${p.key}" applies only to ${p.on} tracker, so it's ignored.`);
      }
      if (t.edits !== undefined && typeof t.edits !== 'boolean') {
        errors.push(`trackers[${i}]: "edits" must be true or false: whether the task page may change a ticket's status, assignee and labels, and on GitHub, whether acc sync closes an issue when its work merges.`);
        return;
      }
      const boardOk = t.board === undefined || t.board === null || (t.kind === 'azure' ? isStr(t.board) : Number.isSafeInteger(t.board) && (t.board as number) > 0);
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
        account: t.kind === 'monday' && isStr(t.account) ? t.account.trim().toLowerCase() : null,
        team: isStr(t.team) ? t.team : null,
        board: Number.isInteger(t.board) || isStr(t.board) ? (t.board as number | string) : null,
        statusColumn: t.kind === 'monday' && isStr(t.statusColumn) ? t.statusColumn.trim() : null,
        prefix: isStr(t.prefix) ? t.prefix.toUpperCase() : null,
        skipLabels: t.kind === 'github' && strList(t.skipLabels) ? t.skipLabels : [],
        epic: t.kind === 'jira' && isStr(t.epic) ? t.epic.trim().toUpperCase() : null,
        labels: t.kind === 'github' && strList(t.labels) ? t.labels.map((l) => l.trim()) : [],
        areaPath: t.kind === 'azure' && isStr(t.areaPath) ? t.areaPath.trim() : null,
        group: t.kind === 'monday' && isStr(t.group) ? t.group.trim() : null,
        edits: t.edits === true,
      });
    });
    // Two trackers whose keys start the same: a ticket's key finds only the first, so the second's can't post.
    const seen = new Map<string, number>();
    trackers.forEach((t, i) => {
      const p = keyPrefix(t);
      if (!p) return;
      const first = seen.get(p);
      if (first === undefined) seen.set(p, i);
      else warnings.push(`trackers[${first}] and trackers[${i}] both give tickets keys like ${p}-12, so those keys go to trackers[${first}]. Give one of them its own "prefix".`);
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
  if (g.builder !== undefined && !(Array.isArray(g.builder) && g.builder.every(isStr))) errors.push('"gates.builder" must be a list of gate names: the lighter checks builders run where the merge queue runs the required ones.');
  if (g.severity !== undefined && !(Number.isInteger(g.severity) && (g.severity as number) >= 1 && (g.severity as number) <= 5)) {
    errors.push('"gates.severity" must be a whole number from 1 (only the worst problems fail) to 5 (everything fails).');
  }
  // Ratchets (GH-99): each is a gate of its own, so its name can't be another gate's.
  const ratchets: Record<string, RatchetSpec> = {};
  if (g.ratchets !== undefined) {
    if (!isObj(g.ratchets)) errors.push('"gates.ratchets" must map names to { "command", "limit", "label" }, such as { "tests": { "command": "node scripts/count-tests.mjs", "limit": "floor", "label": "tests" } }.');
    else for (const [name, r] of Object.entries(g.ratchets)) {
      const at = `gates.ratchets.${name}`;
      if (!RATCHET_NAME.test(name)) errors.push(`"${at}": a ratchet's name is letters, digits, dots, dashes and underscores, up to 40 of them.`);
      else if (!isObj(r) || !isStr(r.command)) errors.push(`"${at}" needs "command": one whose last line of output is the number.`);
      else if (!(RATCHET_LIMITS as readonly unknown[]).includes(r.limit)) errors.push(`"${at}.limit" must be "floor" (the number may only go up) or "ceiling" (it may only go down).`);
      else if (!isStr(r.label) || r.label.trim().length > 24) errors.push(`"${at}.label" must be a short name for the number, up to 24 characters, such as "tests".`);
      else if (commands[name] !== undefined || (BUILT_IN_GATES[profile] ?? []).includes(name)) errors.push(`"${at}": ${name} is already a gate${commands[name] !== undefined ? ' in "gates.commands"' : `, built into the ${profile} profile`}. Give the ratchet a name of its own.`);
      else {
        for (const k of Object.keys(r)) if (!['command', 'limit', 'label'].includes(k)) warnings.push(`Unknown key "${at}.${k}" is ignored.`);
        ratchets[name] = { command: r.command, limit: r.limit as RatchetLimit, label: r.label.trim() };
      }
    }
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
      const list = ap.appendOnly ?? [];
      const autoMerge = ap.autoMerge ?? false;
      // Paths inside the repo, as git names them: never absolute, never climbing out.
      if (!strList(list) || list.some((f) => f.startsWith('/') || f.split('/').includes('..'))) {
        errors.push('"autopilot.appendOnly" must be a list of paths inside the repo, such as ["docs/DECISIONS.md"].');
      } else if (typeof autoMerge !== 'boolean') {
        errors.push('"autopilot.autoMerge" must be true or false: whether autopilot merges a reviewed pull request whose checks passed.');
      } else if (autoMerge && profile === 'salesforce') {
        // A person merges every change bound for an org (D-018).
        errors.push('"autopilot.autoMerge" can\'t be on in a Salesforce project: a person merges every pull request there.');
      } else autopilot = { appendOnly: list, ...(autoMerge ? { autoMerge: true as const } : {}) };
    }
  }

  let dispatch: Config['dispatch'];
  if (raw.dispatch !== undefined) {
    const d = raw.dispatch;
    if (!isObj(d)) errors.push('"dispatch" must be an object, such as { "shared": ["README.md"] }.');
    else {
      const list = d.shared ?? [];
      if (!strList(list) || list.some((f) => f.startsWith('/') || f.split('/').includes('..'))) {
        errors.push('"dispatch.shared" must be a list of paths inside the repo, such as ["README.md", "docs"].');
      } else dispatch = { shared: list };
    }
  }

  let template: TemplateRecord | undefined;
  if (raw.template !== undefined && raw.template !== null) {
    const t = raw.template;
    if (!isObj(t) || !isStr(t.name) || !isStr(t.source) || typeof t.digest !== 'string' || !TEMPLATE_DIGEST.test(t.digest)) {
      errors.push('"template" needs "name", "source" and "digest" (sha256:<64 hex digits>): the team template the project was started from.');
    } else template = { name: t.name, source: t.source, digest: t.digest };
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
        ...(Array.isArray(g.builder) && g.builder.every(isStr) ? { builder: g.builder as string[] } : {}),
        ...(g.ratchets !== undefined ? { ratchets } : {}),
      },
      secretScan: {
        paths: strList(s.paths) ? s.paths : defaultScan,
        exclude: strList(s.exclude) ? s.exclude : [],
      },
      ...(typeof an.required === 'boolean' ? { analysis: { required: an.required } } : {}),
      ...(autopilot ? { autopilot } : {}),
      ...(dispatch ? { dispatch } : {}),
      ...(template ? { template } : {}),
    },
    errors,
    warnings,
  };
}

/**
 * The environments, under D-015 and D-018's rules: branches, one default, promotesTo targets and no loops.
 * `typesFromDiscovery` is a team template's (GH-80): a Salesforce environment may leave its type to
 * Production's sandbox list, and comes back with type null. So does one in a template that sets no profile
 * (profile null), whose type the project's profile decides at acc init.
 */
export function parseEnvironments(raw: unknown, profile: Profile | null, errors: string[], opts: { typesFromDiscovery: true }): (Omit<Environment, 'type'> & { type: EnvType | null })[];
export function parseEnvironments(raw: unknown, profile: Profile, errors: string[], opts?: { typesFromDiscovery?: false }): Environment[];
export function parseEnvironments(raw: unknown, profile: Profile | null, errors: string[], opts: { typesFromDiscovery?: boolean } = {}): (Omit<Environment, 'type'> & { type: EnvType | null })[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push('"environments" must list at least one environment.');
    return [];
  }
  const envs: (Omit<Environment, 'type'> & { type: EnvType | null })[] = [];
  raw.forEach((e, i) => {
    const at = `environments[${i}]`;
    if (!isObj(e) || !isStr(e.name)) { errors.push(`${at}: needs a "name".`); return; }
    const branch = branchFor(e.name);
    if (e.branch !== undefined && e.branch !== branch) {
      errors.push(`${at}: the branch for "${e.name}" must be "${branch}", the environment name in lower case (D-015).`);
    }
    const left = opts.typesFromDiscovery && profile !== 'generic' && e.type === undefined;
    const type = (e.type ?? (profile === 'generic' ? 'none' : undefined)) as EnvType | undefined;
    if (!left && (type === undefined || !ENV_TYPES.includes(type))) {
      errors.push(`${at}: "type" must be one of ${ENV_TYPES.join(', ')}.`);
      return;
    }
    if (profile === 'salesforce' && type === 'none') errors.push(`${at}: a Salesforce environment needs its org type.`);
    if (e.org !== undefined && e.org !== null && !isStr(e.org)) errors.push(`${at}: "org" must be an org alias.`);
    // A Salesforce environment whose type is left to discovery is Production by its name.
    const isProd = type === 'production' || (left && profile === 'salesforce' && branch === 'production');
    if (isProd && e.protected === false) errors.push(`${at}: Production is always protected.`);
    if (e.promotesTo !== undefined && !strList(e.promotesTo)) errors.push(`${at}: "promotesTo" must be a list of branches.`);
    envs.push({
      name: e.name,
      branch,
      type: type ?? null,
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

function findCycle(envs: Pick<Environment, 'branch' | 'promotesTo'>[]): string[] | null {
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
    // A tracker is written as it was given, so the file loads again: what it doesn't set stays out, and it
    // says it may change tickets only when it may (D-066).
    trackers: config.trackers.map(({ edits, ...t }) => ({
      ...Object.fromEntries(Object.entries(t).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length))),
      ...(edits ? { edits } : {}),
    })),
    agents: { ...agents, ...(Object.keys(profile(builder)).length ? { builder: profile(builder) } : {}), ...(Object.keys(profile(reviewer)).length ? { reviewer: profile(reviewer) } : {}) },
  };
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
}

export function defaultEnvironment(config: Config): Environment {
  const env = config.environments.find((e) => e.default);
  if (!env) throw new AccError('bad-config', 'No default environment.');
  return env;
}

export function environmentByBranch(config: Pick<Config, 'environments'>, branch: string): Environment | undefined {
  return config.environments.find((e) => e.branch === branch);
}

/** Whether the project lets autopilot merge at all (GH-67): `autopilot.autoMerge`, never in a Salesforce project. */
export const autoMergeOn = (config: { profile: string; autopilot?: { autoMerge?: boolean } }): boolean =>
  config.autopilot?.autoMerge === true && config.profile !== 'salesforce';

/**
 * Whether autopilot merges a pull request into this environment's branch on its own (GH-67): auto-merge
 * is on, under autonomy review, and the environment is listed and isn't protected (D-018).
 */
export function autoMergeFor(config: Pick<Config, 'profile' | 'autonomy' | 'environments' | 'autopilot'>, branch: string): boolean {
  if (!autoMergeOn(config) || config.autonomy !== 'review') return false;
  const env = environmentByBranch(config, branch);
  return !!env && !env.protected;
}

/** Which checks a commit needs: a builder's, before acc done, review and land, or the merge's, before it merges (GH-73). */
export type GateScope = 'builder' | 'merge';

/**
 * Whether builders on this environment run the lighter `gates.builder` (GH-73): the repo names some, and
 * the merge queue runs the full check before each merge, which it does where auto-merge covers the
 * environment. Elsewhere builders run `gates.required`, as before.
 */
export function builderGatesFor(config: Pick<Config, 'profile' | 'autonomy' | 'environments' | 'autopilot' | 'gates'>, branch: string): boolean {
  return !!config.gates.builder?.length && autoMergeFor(config, branch);
}

/**
 * The checks a commit on this environment needs, by scope (GH-73). merge: `gates.required`, always. builder:
 * `gates.builder` where the merge queue runs the required ones before each merge, else `gates.required`.
 */
export function requiredGates(config: Pick<Config, 'profile' | 'autonomy' | 'environments' | 'autopilot' | 'gates'>, branch: string, scope: GateScope): string[] {
  return scope === 'builder' && builderGatesFor(config, branch) ? config.gates.builder! : config.gates.required;
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

/** What a tracker's ticket keys start with: GH, the Jira project, or the Azure DevOps or monday.com prefix. */
export function keyPrefix(t: Pick<Tracker, 'kind' | 'project' | 'prefix'>): string | null {
  if (t.kind === 'github') return 'GH';
  if (t.kind === 'azure') return (t.prefix ?? 'AB').toUpperCase();
  if (t.kind === 'monday') return (t.prefix ?? 'MON').toUpperCase();
  return t.project ? t.project.toUpperCase() : null;
}

/**
 * Which tracker a ticket key belongs to, by its index: GH-12 to GitHub, AB-123 to the Azure DevOps tracker
 * with that prefix, MON-123 to the monday.com one with its, MSP-7 to the Jira project MSP. A repo with two
 * Jira sites posts each ticket's update through its own (D-066).
 */
export function trackerForKey(trackers: Pick<Tracker, 'kind' | 'project' | 'prefix'>[], key: string): number | null {
  const k = key.toUpperCase();
  const i = trackers.findIndex((t) => {
    if (/^GH-\d+$/.test(k)) return t.kind === 'github';
    const p = t.kind === 'github' ? null : keyPrefix(t);
    return !!p && k.startsWith(`${p}-`);
  });
  return i >= 0 ? i : null;
}

/**
 * The raw trackers list with one tracker added, or put in place of the one it describes (same kind,
 * project and site, organization or repo; a monday.com one by its account and board, since a board is its
 * project). Settings the new one doesn't name, such as a GitHub tracker's
 * skipLabels (D-048), are kept: re-adding a tracker never quietly drops them. A setting it names as null
 * is taken out, so re-adding one as the whole project clears its epic, labels or area path (D-072).
 * A new monday.com tracker whose keys another tracker already gives gets a prefix of its own.
 */
export function withTracker(trackers: Record<string, unknown>[], tracker: Record<string, unknown>): Record<string, unknown>[] {
  // A repo left out and one named null are both the project's own.
  const where = (t: Record<string, unknown>) => t.site ?? t.organization ?? t.account ?? t.repo ?? null;
  const board = (t: Record<string, unknown>) => (t.kind === 'monday' && t.board !== undefined && t.board !== null ? String(t.board) : null);
  const i = trackers.findIndex((t) => t.kind === tracker.kind && (t.project ?? null) === (tracker.project ?? null) && where(t) === where(tracker) && board(t) === board(tracker));
  if (i < 0) return [...trackers, setKeys(ownPrefix(trackers, tracker))];
  return trackers.map((t, k) => (k === i ? setKeys({ ...t, ...tracker }) : t));
}

const rawPrefix = (t: Record<string, unknown>): string | null =>
  keyPrefix({ kind: t.kind as TrackerKind, project: isStr(t.project) ? t.project : null, prefix: isStr(t.prefix) ? t.prefix : null });

/**
 * A second board on a monday.com account would give its items MON keys too. Those go to the first board,
 * whose place check then takes the second's from the ledger (D-072), and their drafts can't post. So a new
 * one gets the first of MON2, MON3 and so on that no tracker uses. One that names its prefix keeps it.
 */
function ownPrefix(trackers: Record<string, unknown>[], tracker: Record<string, unknown>): Record<string, unknown> {
  const base = rawPrefix(tracker);
  if (tracker.kind !== 'monday' || isStr(tracker.prefix) || !base) return tracker;
  const used = new Set(trackers.map(rawPrefix));
  if (!used.has(base)) return tracker;
  let n = 2;
  while (used.has(`${base}${n}`)) n++;
  return { ...tracker, prefix: `${base}${n}` };
}

const setKeys = (t: Record<string, unknown>) => Object.fromEntries(Object.entries(t).filter(([, v]) => v !== null && v !== undefined));

/**
 * The raw trackers list with the tracker at `index` changed, as the Connect page changes an existing one
 * (GH-51): keys the record names are set, those it names as null are taken out, and the rest, such as
 * skipLabels, edits or prefix, are kept. It refuses when that place in the list holds another kind.
 */
export function replaceTracker(trackers: Record<string, unknown>[], index: number, tracker: Record<string, unknown>): Record<string, unknown>[] {
  const was = trackers[index];
  if (!was || was.kind !== tracker.kind) throw new AccError('config-changed', 'The trackers in .acc/config.json changed since this page opened. Open it again from the board.');
  return trackers.map((t, k) => (k === index ? setKeys({ ...t, ...tracker }) : t));
}
