import { isObj } from './text.ts';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AccError } from './exec.ts';
import { writeAtomic } from './atomic.ts';
import { GITHUB_NO_PROJECT } from './trackers/github.ts';
import { SLACK_CHANNEL, SLACK_PREFIX, SLACK_REACTION, SLACK_WORKSPACE } from './trackers/slack.ts';
import { isTrackerKind, orList, type TextField, TRACKER_KINDS, type TrackerKind } from './trackers/types.ts';
import { changesFieldProblem, readChangesField } from './changes-field.ts';
import { commandGateProblem } from './deploy-commands.ts';

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

/** Whether a value is one of the effort levels. */
export const isEffort = (v: unknown): v is Effort => (EFFORTS as readonly unknown[]).includes(v);

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

/** Where a builder may run (GH-69): this Mac, or a Claude Code cloud session the project's routine starts. */
export const BUILDER_PLACES = ['local', 'cloud'] as const;
export type BuilderPlace = (typeof BUILDER_PLACES)[number];

/** A routine's trigger id, as claude.ai/code/routines shows it: the API trigger acc fires. */
export const ROUTINE_ID = /^trig_[A-Za-z0-9]{8,}$/;
/** How long a cloud builder may go without a push before its task needs you, when the config doesn't say. */
export const CLOUD_QUIET_MINUTES = 120;
/** How many cloud builders a project runs at once, when the config doesn't say. They don't count against agents.max. */
export const CLOUD_MAX = 3;

/** A project's cloud builders (GH-69): `agents.cloud` in .acc/config.json. Present only once a person opted in. */
export interface CloudAgents {
  /** The routine's API trigger id, or null until a person has made one. */
  routine: string | null;
  /** Where a task goes when neither --cloud nor --local says. */
  default: BuilderPlace;
  quietMinutes: number;
  max: number;
  /** Where a task's review runs when neither --cloud nor --local says (T-86): local unless it says cloud. */
  review: BuilderPlace;
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

/** The states a GitHub Project's card follows (GH-146): a task's, and ready, a task to do whose deps are done. */
export const CARD_STATES = ['todo', 'ready', 'running', 'review', 'rework', 'blocked', 'done'] as const;
export type CardState = (typeof CARD_STATES)[number];

export interface Tracker {
  kind: TrackerKind;
  /**
   * The board's name on the Tasks tab's switch and in Settings (T-127), as a person renamed it. Unset, the
   * name the tracker gives: its board, its epics, its Project, its channel.
   */
  name: string | null;
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
  /** Slack: the workspace, as in acme.slack.com. */
  workspace: string | null;
  /** Slack: the channel's id, such as C0123ABCD. Its threads are the tracker's tickets. */
  channel: string | null;
  /**
   * Slack: the reaction, by its name without colons (ticket), that marks a message for the board (T-85). Unset,
   * the board is off and a thread is tracked by its link only.
   */
  reaction: string | null;
  /** Slack: the reaction, such as white_check_mark, that puts a marked message in the board's Done column. */
  doneReaction: string | null;
  /** Azure DevOps: the team whose board to show. By default, the project's default team. */
  team: string | null;
  /**
   * The board the Tasks tab shows: a Jira board id, a GitHub Project number, or an Azure board's name. A
   * monday.com board's id, which is also which tracker it is, as a Jira project is. A GitHub tracker's
   * "issues" is no Project (T-107): its columns are Open and Closed, even where the repo has a Project.
   */
  board: number | string | null;
  /** monday.com: the status column whose labels are the board's columns. By default, the one called Status, or the first. */
  statusColumn: string | null;
  /**
   * Azure DevOps: the work item key prefix, AB by default (AB-123). monday.com: the item key prefix, MON by default
   * (MON-123). Slack: the thread key prefix, SL by default (SL-1696512345123456).
   */
  prefix: string | null;
  /** GitHub: issues with any of these labels aren't tasks, such as milestone. */
  skipLabels: string[];
  /**
   * Where in the tracker this repo's tickets come from, narrower than its project or repo (D-072). Jira:
   * epics' keys, so only their child tickets and their sub-tasks count (T-107): the file's "epics", or an
   * older file's one "epic". GitHub: labels, so only issues with one of them count. Azure DevOps: an area
   * path, so only work items under it count. monday.com: a group's id, so only the board's items in that
   * group count. Unset or empty, the whole project or board.
   */
  epics: string[];
  /**
   * Jira only: which sprint's tickets count, with or without an epic (T-78). "active" for the board's open
   * sprints, whichever they are now, or a sprint's id for that one. Unset, the whole board: its backlog and
   * every sprint.
   */
  sprint: 'active' | number | null;
  /**
   * Jira only: a Jira Service Management queue's id (T-128). The tracker's board is that queue, its tickets the
   * ones the queue's JQL picks out, and a project's queue boards are each a tracker of their own. Not with
   * epics or a sprint. Unset, the project's board.
   */
  queue: number | null;
  labels: string[];
  areaPath: string | null;
  group: string | null;
  /**
   * Whether the task page may change a ticket's status, assignee and labels, and, on GitHub, whether acc
   * sync closes a task's issue when its work merges (D-082). Off by default: a client's tracker is theirs,
   * and acc only drafts updates for a person to post (D-066). Your own repo can opt in.
   */
  edits: boolean;
  /**
   * GitHub: the Project column a task's card moves to as the task enters each state (GH-146), by the
   * column's name, such as { "review": "QA" }. A state left out goes to its usual column: In Progress,
   * Testing or In Review, Blocked, Done, Todo. Only where "edits" is true.
   */
  statusFor: Record<string, string> | null;
  /**
   * The ticket field a ticket's changes are kept in (T-105), such as Jira's "Deployment Notes": its id, its
   * name and how it keeps text. On GitHub, the issue's description, under a heading of its own. Slack has
   * none. Unset, a ticket's changes show on its page only.
   */
  changesField: TextField | null;
}

export interface Config {
  schema: 1;
  project: string;
  profile: Profile;
  /**
   * checks: the GitHub checks a pull request must pass before autopilot merges it (T-108), such as the
   * `check` job a GitHub Actions workflow runs. Each one missing, pending or failed holds the merge, so no
   * checks reported never counts as passed for them. Absent or empty: GitHub's own say (GH-67).
   */
  github: { repo: string; account: string; checks?: string[] } | null;
  commitIdentity: { name: string; email: string } | null;
  environments: Environment[];
  environmentSpecific: string | null;
  knownDrift: string | null;
  trackers: Tracker[];
  /**
   * cloud: the project has opted in to cloud builders (GH-69): the routine acc fires for a task, where a
   * builder goes when neither --cloud nor --local says (local unless it says cloud), how many minutes a
   * cloud builder may go without pushing before its task needs you, and how many may run at once, and
   * where a review runs when no flag says (T-86). Null where the project hasn't opted in, so nothing offers
   * the cloud.
   */
  agents: { max: number; permissionMode: string; builder: AgentProfile; reviewer: AgentProfile; cloud: CloudAgents | null };
  autonomy: Autonomy;
  worktrees: { root: string | null; setup: string[] };
  /**
   * heavy: gates that take the machine-wide slot (D-024). severity: Code Analyzer's failing level, 1 to 5.
   * builder: the lighter checks builders run where the merge queue runs `required` once before each merge
   * (GH-73). Left out, builders run `required`, as everywhere else. tests: the checks that run tests, whose
   * receipts count what ran and which need a person when none did (GH-100), besides those acc knows.
   * ratchets: checks whose command prints a number that may only get better, kept against a floor or a
   * ceiling in `.acc/floors.json` (GH-99). nearIndexes: files that gather every code file in their folder,
   * for the tests near a change, where the folder's index would otherwise be guessed (D-155).
   */
  gates: {
    required: string[]; commands: Record<string, string>; heavy: string[]; severity: number; builder?: string[]; tests?: string[];
    ratchets?: Record<string, RatchetSpec>; nearIndexes?: string[];
  };
  secretScan: { paths: string[]; exclude: string[] };
  /**
   * The stray-files check (GH-103): whether it's required, the files or folders a change may add that it
   * would otherwise fail (`allow`), and in Salesforce the folders where data files belong (`data`).
   */
  strayFiles: { required: boolean; allow: string[]; data: string[] };
  /** Whether a task needs an analysis before it's built (D-052). Salesforce projects do unless they say not. */
  analysis?: { required: boolean };
  /**
   * Whether a Salesforce project uses source tracking (T-73). Left out, it does. False where it doesn't:
   * Setup's source-tracking steps then skip. A project that isn't Salesforce has nothing that reads it.
   */
  sourceTracking?: boolean;
  /**
   * appendOnly: files autopilot may resolve when both sides only added to the end, such as a decision log
   * (D-058). autoMerge: autopilot merges a reviewed, green pull request into an environment that isn't
   * protected (GH-67). Off unless it's true; never in a Salesforce project.
   */
  autopilot?: { appendOnly: string[]; autoMerge?: true };
  /** shared: files, or folders, that never make two tasks wait for each other, such as docs every task edits (D-093). */
  dispatch?: { shared: string[] };
  /**
   * every: how many tasks merge in a repo before the Command Center offers a tidy-up task (GH-104), which a
   * person confirms. Left out, 8; 0 never offers one.
   */
  tidy?: { every: number };
  /** The team template the project was started from, and its digest then, so Setup can say when it changed (GH-80). */
  template?: TemplateRecord;
  /**
   * Tools the project's own checks need on this machine (T-68), such as a pinned browser: Setup's step for
   * each runs its check command, which exits 0 when it's there, and offers its fix command when it isn't.
   */
  tools?: ProjectTool[];
}

/** A tool the project's checks need: its name, why, a command that exits 0 when it's there, and one that sets it up. */
export interface ProjectTool { title: string; why: string; check: string; fix: string }

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
  'schema', 'project', 'profile', 'github.repo', 'github.account', 'github.checks', 'commitIdentity.name', 'commitIdentity.email',
  'environments[].name', 'environments[].branch', 'environments[].type', 'environments[].org', 'environments[].default',
  'environments[].protected', 'environments[].promotesTo', 'environmentSpecific', 'knownDrift',
  'trackers[].kind', 'trackers[].name', 'trackers[].site', 'trackers[].project', 'trackers[].repo', 'trackers[].organization', 'trackers[].account',
  'trackers[].workspace', 'trackers[].channel', 'trackers[].reaction', 'trackers[].doneReaction', 'trackers[].team', 'trackers[].board', 'trackers[].statusColumn', 'trackers[].prefix', 'trackers[].skipLabels',
  'trackers[].epics', 'trackers[].sprint', 'trackers[].queue', 'trackers[].labels', 'trackers[].areaPath', 'trackers[].group', 'trackers[].edits',
  'trackers[].statusFor', 'trackers[].changesField.id', 'trackers[].changesField.name', 'trackers[].changesField.format',
  'agents.max', 'agents.permissionMode', 'agents.builder.model', 'agents.builder.effort', 'agents.builder.fallbackModel',
  'agents.reviewer.model', 'agents.reviewer.effort', 'agents.reviewer.fallbackModel',
  'agents.cloud.routine', 'agents.cloud.default', 'agents.cloud.quietMinutes', 'agents.cloud.max', 'agents.cloud.review', 'autonomy',
  'worktrees.root', 'worktrees.setup', 'gates.required', 'gates.commands', 'gates.heavy', 'gates.severity', 'gates.builder', 'gates.tests',
  'gates.ratchets', 'gates.nearIndexes',
  'secretScan.paths', 'secretScan.exclude', 'strayFiles.required', 'strayFiles.allow', 'strayFiles.data', 'analysis.required', 'sourceTracking', 'autopilot.appendOnly', 'autopilot.autoMerge',
  'dispatch.shared', 'tidy.every', 'template.name', 'template.source', 'template.digest',
  'tools[].title', 'tools[].why', 'tools[].check', 'tools[].fix',
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
/** A Jira tracker's one "epic", as files before T-107 keep it: read as a list of one, so it isn't an unknown key. */
LEVELS.get('trackers[]')!.add('epic');

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
  salesforce: ['static', 'lwc-tests', 'validate', 'deploy'],
};

/** The gates each profile has built in, by name, so a ratchet can't take one's name (GH-99). gates.ts has them. */
export const BUILT_IN_GATES: Record<Profile, string[]> = {
  // Every profile has stray-files (GH-103), STRAY_FILES below, so a ratchet can't take its name.
  generic: ['stray-files'],
  salesforce: ['format', 'lint', 'static', 'lwc-tests', 'validate', 'deploy', 'stray-files'],
};

/**
 * A Salesforce project's required checks, with deploy beside validate (D-206): a builder validates, then
 * deploys to its build org, so wherever validate is required, deploy is too, right after it. A list that
 * names deploy itself keeps its own order.
 */
export function withDeploy(profile: Profile, gates: string[]): string[] {
  if (profile !== 'salesforce' || gates.includes('deploy') || !gates.includes('validate')) return gates;
  const at = gates.indexOf('validate');
  return [...gates.slice(0, at + 1), 'deploy', ...gates.slice(at + 1)];
}

/** The branch for an environment: its name in lower case (D-015). */
export function branchFor(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

/** A string with something in it besides spaces. */
export const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const strList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
/** Paths inside the repo, as git names them: never absolute, never climbing out. */
const inRepo = (v: unknown): v is string[] => strList(v) && !v.some((f) => f.startsWith('/') || f.split('/').includes('..'));
const JIRA_ISSUE = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

/**
 * Why a tracker's `queue` is refused (T-128), or null when it's one: a Jira Service Management queue's id, a
 * whole number above 0, on a Jira tracker with no epics and no sprint, since the queue's JQL is its place.
 */
export function queueProblem(t: Record<string, unknown>): string | null {
  if (t.kind !== 'jira') return '"queue" applies only to a Jira tracker: it\'s a Jira Service Management queue.';
  if (!Number.isSafeInteger(t.queue) || (t.queue as number) < 1) return '"queue" must be a Jira Service Management queue\'s id, such as 12.';
  const epics = (t.epic !== undefined && t.epic !== null) || (Array.isArray(t.epics) && t.epics.length);
  if (epics || (t.sprint !== undefined && t.sprint !== null)) return 'a queue\'s tickets are the ones its own JQL picks out, so it takes no "epic", "epics" or "sprint". Take them out, or make the queue a tracker of its own.';
  return null;
}

/**
 * Why a tracker's `sprint` is refused (T-78), or null when it's one: "active", or a sprint's id, a whole
 * number above 0. Only a Jira tracker has sprints; Azure DevOps iterations aren't these.
 */
export function sprintProblem(kind: unknown, sprint: unknown): string | null {
  if (kind !== 'jira') return '"sprint" applies only to a Jira tracker: other trackers have no sprints here.';
  if (sprint === 'active' || (Number.isSafeInteger(sprint) && (sprint as number) > 0)) return null;
  return '"sprint" must be "active", for the board\'s open sprints, or a sprint\'s id, such as 42.';
}

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
    } else if (g.checks !== undefined && !(Array.isArray(g.checks) && g.checks.every(isStr))) {
      errors.push('"github.checks" must be a list of check names, such as ["check"].');
    } else github = { repo: g.repo, account: g.account, ...(Array.isArray(g.checks) && g.checks.length ? { checks: (g.checks as string[]).map((c) => c.trim()) } : {}) };
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
      if (t.kind === 'slack') {
        const missing = (['workspace', 'channel'] as const).filter((k) => !isStr(t[k]));
        if (missing.length) {
          errors.push(`trackers[${i}]: a Slack tracker needs ${missing.map((k) => `"${k}"`).join(' and ')}: "workspace" as in acme.slack.com, and "channel", a channel's id such as C0123ABCD.`);
          return;
        }
        if (!SLACK_WORKSPACE.test(String(t.workspace).trim())) {
          errors.push(`trackers[${i}]: "workspace" must be a Slack workspace's domain, as in acme.slack.com: letters, digits and hyphens.`);
          return;
        }
        if (!SLACK_CHANNEL.test(String(t.channel).trim())) {
          errors.push(`trackers[${i}]: "channel" must be a Slack channel's id, such as C0123ABCD, not its name.`);
          return;
        }
        // The board's reactions (T-85): each a reaction's name without colons, and the two different.
        const badReaction = (['reaction', 'doneReaction'] as const).find((k) => t[k] !== undefined && t[k] !== null && !(isStr(t[k]) && SLACK_REACTION.test(t[k].trim())));
        if (badReaction) {
          errors.push(`trackers[${i}]: "${badReaction}" must be a Slack reaction's name without colons, such as ${badReaction === 'reaction' ? 'ticket' : 'white_check_mark'}.`);
          return;
        }
        if (isStr(t.reaction) && isStr(t.doneReaction) && t.reaction.trim() === t.doneReaction.trim()) {
          errors.push(`trackers[${i}]: "doneReaction" must be another reaction than "reaction", or every marked message would be done.`);
          return;
        }
        if (isStr(t.doneReaction) && !isStr(t.reaction)) warnings.push(`trackers[${i}]: "doneReaction" needs "reaction" too, so it's ignored: without a reaction there is no board.`);
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
      const placeKeys: { key: Under<'trackers[]'> | 'epic'; kind: TrackerKind; on: string; ok: boolean; error: string }[] = [
        { key: 'epic', kind: 'jira', on: 'a Jira', ok: isStr(t.epic) && JIRA_ISSUE.test(t.epic.trim()), error: '"epic" must be a Jira epic\'s key, such as ACME-3.' },
        { key: 'epics', kind: 'jira', on: 'a Jira', ok: strList(t.epics) && t.epics.every((e) => JIRA_ISSUE.test(e.trim())), error: '"epics" must be a list of Jira epics\' keys, such as ["ACME-3", "ACME-7"].' },
        { key: 'labels', kind: 'github', on: 'a GitHub', ok: strList(t.labels), error: '"labels" must be a list of label names, such as ["billing"].' },
        { key: 'areaPath', kind: 'azure', on: 'an Azure DevOps', ok: isStr(t.areaPath), error: '"areaPath" must be an Azure DevOps area path, such as "CRM\\\\Billing".' },
        { key: 'group', kind: 'monday', on: 'a monday.com', ok: isStr(t.group), error: '"group" must be a monday.com group\'s id, such as "topics".' },
        { key: 'statusColumn', kind: 'monday', on: 'a monday.com', ok: isStr(t.statusColumn), error: '"statusColumn" must be a monday.com status column\'s id, such as "status".' },
        { key: 'workspace', kind: 'slack', on: 'a Slack', ok: isStr(t.workspace), error: '"workspace" must be a Slack workspace\'s domain, as in acme.slack.com.' },
        { key: 'channel', kind: 'slack', on: 'a Slack', ok: isStr(t.channel), error: '"channel" must be a Slack channel\'s id, such as C0123ABCD.' },
        { key: 'reaction', kind: 'slack', on: 'a Slack', ok: isStr(t.reaction), error: '"reaction" must be a Slack reaction\'s name, such as ticket.' },
        { key: 'doneReaction', kind: 'slack', on: 'a Slack', ok: isStr(t.doneReaction), error: '"doneReaction" must be a Slack reaction\'s name, such as white_check_mark.' },
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
      // A queue is a Jira Service Management board (T-128): Jira's only, and its JQL is the place, so no epics or sprint.
      if (t.queue !== undefined && t.queue !== null) {
        const why = queueProblem(t);
        if (why) {
          errors.push(`trackers[${i}]: ${why}`);
          return;
        }
      }
      // A sprint narrows a Jira board only (T-78): on any other tracker it's an error, not a key ignored.
      if (t.sprint !== undefined && t.sprint !== null) {
        const why = sprintProblem(t.kind, t.sprint);
        if (why) {
          errors.push(`trackers[${i}]: ${why}`);
          return;
        }
      }
      if (t.edits !== undefined && typeof t.edits !== 'boolean') {
        errors.push(`trackers[${i}]: "edits" must be true or false: whether the task page may change a ticket's status, assignee and labels, and on GitHub, whether acc sync closes an issue when its work merges.`);
        return;
      }
      // Which column each state's card goes to (GH-146): a state's name, and a column's.
      if (t.statusFor !== undefined && t.statusFor !== null) {
        const sf = t.statusFor;
        const bad = !isObj(sf) || Object.entries(sf).some(([k, v]) => !(CARD_STATES as readonly string[]).includes(k) || !isStr(v));
        if (bad) {
          errors.push(`trackers[${i}]: "statusFor" names a GitHub Project column for each state, such as { "review": "QA" }. Its states: ${CARD_STATES.join(', ')}.`);
          return;
        }
        if (t.kind !== 'github') warnings.push(`trackers[${i}]: "statusFor" applies only to a GitHub tracker, so it's ignored.`);
      }
      // Where a ticket's changes are kept (T-105): a field its tracker has, and none on Slack.
      if (t.changesField !== undefined && t.changesField !== null) {
        const why = changesFieldProblem(t.kind, t.changesField);
        if (why) {
          errors.push(`trackers[${i}]: ${why}`);
          return;
        }
      }
      // A GitHub tracker's "issues" is no Project (T-107): Open and Closed, even where the repo has one.
      const boardOk = t.board === undefined || t.board === null || (t.kind === 'azure' ? isStr(t.board) : (Number.isSafeInteger(t.board) && (t.board as number) > 0) || (t.kind === 'github' && t.board === GITHUB_NO_PROJECT));
      if (!boardOk) {
        errors.push(`trackers[${i}]: "board" must be ${t.kind === 'azure' ? 'an Azure board\'s name, such as Stories' : t.kind === 'github' ? `a GitHub Project number, or "${GITHUB_NO_PROJECT}" for no Project` : 'a Jira board id or a GitHub Project number'}.`);
        return;
      }
      // A board's own name (T-127): a few words, shown on the Tasks tab's switch and in Settings.
      if (t.name !== undefined && t.name !== null && (typeof t.name !== 'string' || t.name.trim().length > TRACKER_NAME_MAX)) {
        errors.push(`trackers[${i}]: "name" must be the board's name, in up to ${TRACKER_NAME_MAX} characters.`);
        return;
      }
      trackers.push({
        kind: t.kind,
        name: isStr(t.name) && t.name.trim() ? t.name.trim() : null,
        site: isStr(t.site) ? t.site : null,
        project: isStr(t.project) ? t.project : null,
        repo: isStr(t.repo) ? t.repo : null,
        organization: isStr(t.organization) ? t.organization : null,
        account: t.kind === 'monday' && isStr(t.account) ? t.account.trim().toLowerCase() : null,
        workspace: t.kind === 'slack' && isStr(t.workspace) ? t.workspace.trim().toLowerCase() : null,
        channel: t.kind === 'slack' && isStr(t.channel) ? t.channel.trim().toUpperCase() : null,
        reaction: t.kind === 'slack' && isStr(t.reaction) ? t.reaction.trim() : null,
        doneReaction: t.kind === 'slack' && isStr(t.reaction) && isStr(t.doneReaction) ? t.doneReaction.trim() : null,
        team: isStr(t.team) ? t.team : null,
        board: Number.isInteger(t.board) || isStr(t.board) ? (t.board as number | string) : null,
        statusColumn: t.kind === 'monday' && isStr(t.statusColumn) ? t.statusColumn.trim() : null,
        prefix: isStr(t.prefix) ? t.prefix.toUpperCase() : null,
        skipLabels: t.kind === 'github' && strList(t.skipLabels) ? t.skipLabels : [],
        epics: t.kind === 'jira' ? [...new Set([t.epic, ...(strList(t.epics) ? t.epics : [])].filter(isStr).map((e) => e.trim().toUpperCase()))] : [],
        sprint: t.kind === 'jira' && (t.sprint === 'active' || Number.isSafeInteger(t.sprint)) ? (t.sprint as 'active' | number) : null,
        queue: t.kind === 'jira' && Number.isSafeInteger(t.queue) ? (t.queue as number) : null,
        labels: t.kind === 'github' && strList(t.labels) ? t.labels.map((l) => l.trim()) : [],
        areaPath: t.kind === 'azure' && isStr(t.areaPath) ? t.areaPath.trim() : null,
        group: t.kind === 'monday' && isStr(t.group) ? t.group.trim() : null,
        edits: t.edits === true,
        statusFor: t.kind === 'github' && isObj(t.statusFor) && Object.keys(t.statusFor).length
          ? Object.fromEntries(Object.entries(t.statusFor).map(([k, v]) => [k, String(v).trim()])) : null,
        changesField: readChangesField(t.kind, t.changesField),
      });
    });
    // Two trackers whose keys start the same: a ticket's key finds only the first, so the second's can't post.
    // Two boards of one project on one site (T-127), such as other epics, post through the same project: no warning.
    const seen = new Map<string, number>();
    trackers.forEach((t, i) => {
      const p = keyPrefix(t);
      if (!p) return;
      const first = seen.get(p);
      // A service desk's queue boards share its project's keys (T-128): each ticket goes to the first, which takes in them all.
      if (first !== undefined && sameDesk(trackers[first]!, t)) return;
      if (first === undefined) seen.set(p, i);
      else if (!sameSource(trackers[first]!, t)) warnings.push(`trackers[${first}] and trackers[${i}] both give tickets keys like ${p}-12, so those keys go to trackers[${first}]. Give one of them its own "prefix".`);
    });
    // Two trackers in the very same place, differing only by name (T-127): one board shown twice.
    const places = new Map<string, number>();
    trackers.forEach((t, i) => {
      const k = boardKeys(t as unknown as Record<string, unknown>);
      const first = places.get(k);
      if (first === undefined) places.set(k, i);
      else warnings.push(`trackers[${first}] and trackers[${i}] are the same board: the same place, differing only by name. Give one other epics, labels or another place, or take it out.`);
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
      if (isEffort(p.effort)) effort = p.effort;
      else errors.push(`"agents.${role}.effort" must be one of ${EFFORTS.join(', ')}.`);
    }
    return { model: model(p.model, 'model'), effort, fallbackModel: model(p.fallbackModel, 'fallbackModel') };
  };
  const builder = profileOf('builder');
  const reviewer = profileOf('reviewer');
  // Cloud builders (GH-69): off unless the project says so. A section that's there opts in, even empty.
  let cloud: CloudAgents | null = null;
  if (a.cloud !== undefined && a.cloud !== null) {
    if (!isObj(a.cloud)) errors.push('"agents.cloud" must be an object: { "routine": "trig_…", "default": "local" | "cloud", "quietMinutes": 120, "max": 3, "review": "local" | "cloud" }.');
    else {
      const c = a.cloud;
      if (c.routine !== undefined && c.routine !== null && (typeof c.routine !== 'string' || !ROUTINE_ID.test(c.routine))) errors.push('"agents.cloud.routine" must be a routine\'s API trigger id, such as trig_01ABC…, from claude.ai/code/routines.');
      const where = c.default ?? 'local';
      if (!(BUILDER_PLACES as readonly unknown[]).includes(where)) errors.push(`"agents.cloud.default" must be one of ${BUILDER_PLACES.join(', ')}.`);
      const quiet = c.quietMinutes ?? CLOUD_QUIET_MINUTES;
      if (typeof quiet !== 'number' || !Number.isInteger(quiet) || quiet < 5 || quiet > 1440) errors.push('"agents.cloud.quietMinutes" must be a whole number of minutes from 5 to 1440.');
      const cmax = c.max ?? CLOUD_MAX;
      if (typeof cmax !== 'number' || !Number.isInteger(cmax) || cmax < 1 || cmax > 16) errors.push('"agents.cloud.max" must be a whole number from 1 to 16.');
      // Where a review runs (T-86): local unless the project says cloud.
      const review = c.review ?? 'local';
      if (!(BUILDER_PLACES as readonly unknown[]).includes(review)) errors.push(`"agents.cloud.review" must be one of ${BUILDER_PLACES.join(', ')}.`);
      cloud = { routine: typeof c.routine === 'string' ? c.routine : null, default: where as BuilderPlace, quietMinutes: quiet as number, max: cmax as number, review: review as BuilderPlace };
    }
  }

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
    // A command gate never deploys, and none takes the deploy gate's name (D-206): the runner can't see inside a shell command.
    for (const [name, cmd] of Object.entries(commands)) {
      const problem = commandGateProblem(name, cmd, profile);
      if (problem) errors.push(problem);
    }
  }
  if (g.heavy !== undefined && !strList(g.heavy)) errors.push('"gates.heavy" must be a list of gate names.');
  if (g.builder !== undefined && !strList(g.builder)) errors.push('"gates.builder" must be a list of gate names: the lighter checks builders run where the merge queue runs the required ones.');
  if (g.tests !== undefined && !strList(g.tests)) errors.push('"gates.tests" must be a list of gate names: the checks that run tests, whose receipts count what ran.');
  if (g.nearIndexes !== undefined && !strList(g.nearIndexes)) errors.push('"gates.nearIndexes" must be a list of paths from the repo\'s root, such as "src/web/main.ts": each gathers every code file in its folder.');
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

  const sf = isObj(raw.strayFiles) ? raw.strayFiles : {};
  if (raw.strayFiles !== undefined && !isObj(raw.strayFiles)) errors.push('"strayFiles" must be an object, such as { "allow": ["LICENSE"] }.');
  if (sf.required !== undefined && typeof sf.required !== 'boolean') errors.push('"strayFiles.required" must be true or false: whether a change must pass the stray-files check.');
  if (sf.allow !== undefined && !inRepo(sf.allow)) errors.push('"strayFiles.allow" must be a list of paths inside the repo, such as ["LICENSE", "fixtures"].');
  if (sf.data !== undefined && !inRepo(sf.data)) errors.push('"strayFiles.data" must be a list of folders inside the repo, such as ["data/samples"].');
  if (profile !== 'salesforce' && Array.isArray(sf.data) && sf.data.length) warnings.push('"strayFiles.data" applies only to a Salesforce project, so it\'s ignored.');

  const an = isObj(raw.analysis) ? raw.analysis : {};
  if (raw.analysis !== undefined && !isObj(raw.analysis)) errors.push('"analysis" must be an object, such as { "required": true }.');
  if (an.required !== undefined && typeof an.required !== 'boolean') errors.push('"analysis.required" must be true or false.');

  const tracking = raw.sourceTracking;
  if (tracking !== undefined && typeof tracking !== 'boolean') errors.push('"sourceTracking" must be true or false: whether the project uses Salesforce source tracking.');
  if (profile !== 'salesforce' && tracking === false) warnings.push('"sourceTracking" applies only to a Salesforce project, so it\'s ignored.');

  let autopilot: Config['autopilot'];
  if (raw.autopilot !== undefined) {
    const ap = raw.autopilot;
    if (!isObj(ap)) errors.push('"autopilot" must be an object, such as { "appendOnly": ["docs/DECISIONS.md"] }.');
    else {
      const list = ap.appendOnly ?? [];
      const autoMerge = ap.autoMerge ?? false;
      if (!inRepo(list)) {
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
      if (!inRepo(list)) {
        errors.push('"dispatch.shared" must be a list of paths inside the repo, such as ["README.md", "docs"].');
      } else dispatch = { shared: list };
    }
  }

  let tools: Config['tools'];
  if (raw.tools !== undefined) {
    const list = raw.tools;
    if (!Array.isArray(list) || !list.every((t) => isObj(t) && ['title', 'why', 'check', 'fix'].every((k) => isStr(t[k])))) {
      errors.push('"tools" must be a list of tools, each with "title", "why", "check" (a command that exits 0 when the tool is there) and "fix" (a command that sets it up).');
    } else tools = list.map((t) => ({ title: t.title as string, why: t.why as string, check: t.check as string, fix: t.fix as string }));
  }

  let tidy: Config['tidy'];
  if (raw.tidy !== undefined) {
    const t = raw.tidy;
    if (!isObj(t)) errors.push('"tidy" must be an object, such as { "every": 8 }.');
    else if (t.every !== undefined) {
      if (typeof t.every !== 'number' || !Number.isInteger(t.every) || t.every < 0 || t.every > 100) {
        errors.push('"tidy.every" must be a whole number from 0 to 100: how many tasks merge before a tidy-up is offered, or 0 for never.');
      } else tidy = { every: t.every };
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
      agents: { max: max as number, permissionMode: permissionMode as string, builder, reviewer, cloud },
      autonomy,
      worktrees: { root: isStr(w.root) ? w.root : null, setup: strList(w.setup) ? w.setup : [] },
      gates: {
        required: withDeploy(profile, strList(g.required) ? g.required : []),
        commands,
        heavy: strList(g.heavy) ? g.heavy : DEFAULT_HEAVY[profile],
        severity: (g.severity as number | undefined) ?? 2,
        ...(strList(g.builder) ? { builder: g.builder } : {}),
        ...(g.ratchets !== undefined ? { ratchets } : {}),
        ...(strList(g.tests) ? { tests: g.tests } : {}),
        ...(strList(g.nearIndexes) ? { nearIndexes: g.nearIndexes } : {}),
      },
      secretScan: {
        paths: strList(s.paths) ? s.paths : defaultScan,
        exclude: strList(s.exclude) ? s.exclude : [],
      },
      strayFiles: {
        required: sf.required !== false,
        allow: inRepo(sf.allow) ? sf.allow : [],
        data: inRepo(sf.data) ? sf.data : [],
      },
      ...(typeof an.required === 'boolean' ? { analysis: { required: an.required } } : {}),
      ...(typeof tracking === 'boolean' ? { sourceTracking: tracking } : {}),
      ...(autopilot ? { autopilot } : {}),
      ...(dispatch ? { dispatch } : {}),
      ...(tidy ? { tidy } : {}),
      ...(template ? { template } : {}),
      ...(tools ? { tools } : {}),
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
  const { builder, reviewer, cloud, ...agents } = config.agents;
  // The cloud section is written only where the project opted in (GH-69), as it was given: a routine it has none of stays out.
  const cloudOut = cloud ? { cloud: { ...(cloud.routine ? { routine: cloud.routine } : {}), default: cloud.default, quietMinutes: cloud.quietMinutes, max: cloud.max, review: cloud.review } } : {};
  const out = {
    ...config,
    environments: config.environments.map(({ branch: _branch, ...e }) => e),
    // A tracker is written as it was given, so the file loads again: what it doesn't set stays out, and it
    // says it may change tickets only when it may (D-066).
    // A Jira tracker's epics go as epicKeys says, in their place: one as "epic", several as "epics" (T-107).
    trackers: config.trackers.map(({ edits, ...t }) => ({
      ...Object.fromEntries(Object.entries(t).flatMap(([k, v]) => (k === 'epics' ? Object.entries(epicKeys(v as string[])) : [[k, v]])).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length))),
      ...(edits ? { edits } : {}),
    })),
    agents: { ...agents, ...(Object.keys(profile(builder)).length ? { builder: profile(builder) } : {}), ...(Object.keys(profile(reviewer)).length ? { reviewer: profile(reviewer) } : {}), ...cloudOut },
  };
  writeAtomic(file, JSON.stringify(out, null, 2) + '\n');
}

/**
 * A Jira tracker's epics as the file keeps them (T-107): one as "epic", as files before kept it, so an older
 * acc still reads it; several as "epics". The other is null, which takes it out of a tracker being changed.
 */
export const epicKeys = (epics: string[]): { epic: string | null; epics: string[] | null } =>
  (epics.length > 1 ? { epic: null, epics } : { epic: epics[0] ?? null, epics: null });

/** How many tasks merge in a repo before a tidy-up is offered, when the config doesn't say (GH-104). */
export const TIDY_EVERY = 8;

/** How many tasks merge before the Command Center offers a tidy-up (GH-104). 0 never offers one. */
export const tidyEvery = (config: Pick<Config, 'tidy'>): number => config.tidy?.every ?? TIDY_EVERY;

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

/** The built-in check every project has, that a change adds no logs, temp files, new root files, big files or data exports (GH-103). */
export const STRAY_FILES = 'stray-files';

/** A list of checks with stray-files added, unless `strayFiles.required` turns it off (GH-103). */
export const withStrayFiles = (config: Pick<Config, 'strayFiles'>, gates: string[]): string[] =>
  config.strayFiles.required && !gates.includes(STRAY_FILES) ? [...gates, STRAY_FILES] : gates;

/**
 * The full check: `gates.required`, and stray-files unless the project turned it off (GH-103). It's what the
 * merge queue runs, and what code asks for, never `gates.required` itself, so every place names the same list.
 */
export const fullGates = (config: Pick<Config, 'gates' | 'strayFiles'>): string[] => withStrayFiles(config, config.gates.required);

/**
 * The checks a commit on this environment needs, by scope (GH-73). merge: the full check, always. builder:
 * `gates.builder` where the merge queue runs the full one before each merge, else the full one. Both have
 * stray-files unless the project turned it off (GH-103), as it's cheap and the builder can fix what it finds.
 */
export function requiredGates(config: Pick<Config, 'profile' | 'autonomy' | 'environments' | 'autopilot' | 'gates' | 'strayFiles'>, branch: string, scope: GateScope): string[] {
  return scope === 'builder' && builderGatesFor(config, branch) ? withStrayFiles(config, config.gates.builder!) : fullGates(config);
}

/**
 * Whether a gate runs tests (GH-100): one `gates.tests` names, a gate called `test`, or Salesforce's
 * `lwc-tests`. Its receipt says when acc couldn't read what ran, and it needs a person when none did.
 * validate is one only when it runs Apex tests, which it says itself.
 */
export function isTestGate(config: Pick<Config, 'profile' | 'gates'>, name: string): boolean {
  return !!config.gates.tests?.includes(name) || name === 'test' || (config.profile === 'salesforce' && name === 'lwc-tests');
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

/** What a tracker's ticket keys start with: GH, the Jira project, or the Azure DevOps, monday.com or Slack prefix. */
export function keyPrefix(t: Pick<Tracker, 'kind' | 'project' | 'prefix'>): string | null {
  if (t.kind === 'github') return 'GH';
  if (t.kind === 'azure') return (t.prefix ?? 'AB').toUpperCase();
  if (t.kind === 'monday') return (t.prefix ?? 'MON').toUpperCase();
  if (t.kind === 'slack') return (t.prefix ?? SLACK_PREFIX).toUpperCase();
  return t.project ? t.project.toUpperCase() : null;
}

/** The longest name a board takes (T-127). */
export const TRACKER_NAME_MAX = 80;

/**
 * Whether two trackers read one source (T-127): the same kind, site, organization, account or workspace, and
 * project, repo, monday.com board or Slack channel. Their tickets are one set, each kept as one task, however
 * the two narrow it (epics, labels, an area path, a group).
 */
export function sameSource(a: Pick<Tracker, 'kind' | 'site' | 'organization' | 'account' | 'workspace' | 'project' | 'repo' | 'board' | 'channel'>, b: typeof a): boolean {
  if (a.kind !== b.kind) return false;
  const where = (t: typeof a) => t.site ?? t.organization ?? t.account ?? t.workspace ?? null;
  const what = (t: typeof a) => (t.kind === 'monday' ? String(t.board ?? '') : t.kind === 'slack' ? t.channel : t.kind === 'github' ? t.repo : t.project);
  return where(a) === where(b) && what(a) === what(b);
}

/** Two queue boards of one Jira service desk (T-128): the same site and project, each with a queue. */
export const sameDesk = (a: Pick<Tracker, 'kind' | 'site' | 'project' | 'queue'>, b: Pick<Tracker, 'kind' | 'site' | 'project' | 'queue'>): boolean =>
  a.kind === 'jira' && b.kind === 'jira' && a.queue !== null && b.queue !== null && a.site === b.site && a.project?.toUpperCase() === b.project?.toUpperCase();

/**
 * The queues a queue board's place holds (T-128): its own first, then each other queue board on its service
 * desk, since a ticket goes to the first of them and its place check speaks for them all. Empty with no queue.
 */
export const deskQueues = (trackers: Tracker[], t: Tracker): number[] =>
  (t.queue === null ? [] : [t.queue, ...trackers.filter((o) => sameDesk(o, t) && o.queue !== t.queue).map((o) => o.queue!)]);

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
 * project; a Slack one by its workspace and channel, since a channel is its project; a Jira one with a queue by
 * its queue too, T-128). Settings the new one
 * doesn't name, such as a GitHub tracker's
 * skipLabels (D-048), are kept: re-adding a tracker never quietly drops them. A setting it names as null
 * is taken out, so re-adding one as the whole project clears its epic, labels or area path (D-072).
 * A new monday.com or Slack tracker whose keys another tracker already gives gets a prefix of its own.
 */
export function withTracker(trackers: Record<string, unknown>[], tracker: Record<string, unknown>): Record<string, unknown>[] {
  // A repo left out and one named null are both the project's own.
  const where = (t: Record<string, unknown>) => t.site ?? t.organization ?? t.account ?? t.workspace ?? t.repo ?? null;
  // What stands for a project where the tracker has none: a monday.com board, or a Slack channel (by its id, as the config keeps it, upper-cased).
  // A Jira Service Management queue (T-128) is a board of its own, so each queue is its own tracker.
  const board = (t: Record<string, unknown>) => (t.kind === 'monday' && t.board !== undefined && t.board !== null ? String(t.board)
    : t.kind === 'slack' && isStr(t.channel) ? t.channel.trim().toUpperCase()
      : t.kind === 'jira' && t.queue !== undefined && t.queue !== null ? `queue ${String(t.queue)}` : null);
  const i = trackers.findIndex((t) => t.kind === tracker.kind && (t.project ?? null) === (tracker.project ?? null) && where(t) === where(tracker) && board(t) === board(tracker));
  if (i < 0) return [...trackers, setKeys(ownPrefix(trackers, tracker))];
  return trackers.map((t, k) => (k === i ? setKeys({ ...t, ...tracker }) : t));
}

const rawPrefix = (t: Record<string, unknown>): string | null =>
  keyPrefix({ kind: t.kind as TrackerKind, project: isStr(t.project) ? t.project : null, prefix: isStr(t.prefix) ? t.prefix : null });

/**
 * A second board on a monday.com account would give its items MON keys too. Those go to the first board,
 * whose place check then takes the second's from the ledger (D-072), and their drafts can't post. So a new
 * one gets the first of MON2, MON3 and so on that no tracker uses. A second Slack channel is the same: its
 * threads get SL2 keys, not SL. One that names its prefix keeps it.
 */
function ownPrefix(trackers: Record<string, unknown>[], tracker: Record<string, unknown>): Record<string, unknown> {
  const base = rawPrefix(tracker);
  if ((tracker.kind !== 'monday' && tracker.kind !== 'slack') || isStr(tracker.prefix) || !base) return tracker;
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
  const next = trackers.map((t, k) => (k === index ? setKeys({ ...t, ...tracker }) : t));
  // A Change that gives this board the very place of another (T-127) is refused, in words that name the other.
  const other = next.findIndex((t, k) => k !== index && boardKeys(t) === boardKeys(next[index]!));
  if (other >= 0) throw new AccError('usage', `That's the same place as ${boardLabel(next[other]!, other)}: choose other epics, labels or another place, or change that board instead.`);
  return next;
}

/** A board as a person knows it, for a message: its own name, else its place in the list (T-127). */
const boardLabel = (t: Record<string, unknown>, index: number): string => (isStr(t.name) && t.name.trim() ? `the board “${t.name.trim()}”` : `board ${index + 1} in the project's list`);

/**
 * Connects a tracker, or changes one, in the repo's .acc/config.json, as acc trackers set does for the
 * Connect page (GH-112): added with withTracker, or put in place of the one at `index` with replaceTracker.
 * The config it would make is checked first, and one with problems is refused with nothing written. The
 * rest of the file is kept as it was. Returns where the tracker is in the list, and the config's warnings.
 */
export function saveTracker(file: string, index: number | null, record: Record<string, unknown>, add = false): { index: number; warnings: string[] } {
  if (!isObj(record) || !isTrackerKind(record.kind)) throw new AccError('usage', `A tracker needs a "kind": ${orList([...TRACKER_KINDS])}.`);
  if (index !== null && (!Number.isInteger(index) || index < 0)) throw new AccError('usage', 'The tracker to change is its place in the list, from 0.');
  const raw = readRaw(file);
  const was = Array.isArray(raw.trackers) ? raw.trackers as Record<string, unknown>[] : [];
  const trackers = index !== null ? replaceTracker(was, index, record) : add ? addBoard(was, record) : withTracker(was, record);
  const wanted = { ...raw, trackers };
  const checked = parseConfig(wanted);
  if (!checked.config) throw new AccError('bad-config', `That tracker would leave ${file} with problems, so nothing was written:\n- ${checked.errors.join('\n- ')}`);
  writeAtomic(file, JSON.stringify(wanted, null, 2) + '\n');
  // Added, it's where withTracker put it: in place of the one it describes, or last. Either is a new object.
  return { index: index ?? trackers.findIndex((t, k) => was[k] !== t), warnings: checked.warnings };
}

function readRaw(file: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new AccError(existsSync(file) ? 'bad-config' : 'no-config', existsSync(file) ? `${file} isn't valid JSON: ${(e as Error).message}` : `No ${file}. Run "acc init" first.`);
  }
  if (!isObj(raw)) throw new AccError('bad-config', `${file} must be a JSON object.`);
  return raw;
}

/** A tracker's settings that say which board it is: every key but its name (T-127). */
const boardKeys = (t: Record<string, unknown>): string => JSON.stringify(canonical(setKeys({ ...t, name: null })));
const canonical = (x: unknown): unknown => (Array.isArray(x) ? x.map(canonical) : isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canonical(x[k])])) : x);

/**
 * The raw trackers list with one more board (T-127): Add a board always adds, so two boards of one Jira project
 * with other epics sit side by side, where withTracker would put the new one in place of the first. The very
 * same board twice is refused. A monday.com or Slack one whose keys another gives gets a prefix of its own.
 */
export function addBoard(trackers: Record<string, unknown>[], tracker: Record<string, unknown>): Record<string, unknown>[] {
  const next = setKeys(ownPrefix(trackers, tracker));
  if (trackers.some((t) => boardKeys(t) === boardKeys(next))) throw new AccError('usage', 'That board is in the project already: choose other epics, labels or another place, or change the one there.');
  return [...trackers, next];
}

/**
 * Takes the tracker at `index` out of the repo's .acc/config.json (T-127), as the Connect page's and Settings'
 * Remove ask. `kind` is the kind the page showed: another kind there means the list changed since, and nothing
 * is written. Only the file changes: tasks added from the board stay in the ledger, on My work.
 */
export function removeTracker(file: string, index: number, kind: string): { removed: Record<string, unknown>; warnings: string[] } {
  if (!Number.isInteger(index) || index < 0) throw new AccError('usage', 'The tracker to remove is its place in the list, from 0.');
  const raw = readRaw(file);
  const was = Array.isArray(raw.trackers) ? raw.trackers as Record<string, unknown>[] : [];
  const removed = was[index];
  if (!removed || removed.kind !== kind) throw new AccError('config-changed', 'The trackers in .acc/config.json changed since this page opened. Open it again from the board.');
  const trackers = was.filter((_, k) => k !== index);
  const wanted = { ...raw, trackers };
  const checked = parseConfig(wanted);
  if (!checked.config) throw new AccError('bad-config', `Removing it would leave ${file} with problems, so nothing was written:\n- ${checked.errors.join('\n- ')}`);
  writeAtomic(file, JSON.stringify(wanted, null, 2) + '\n');
  return { removed, warnings: checked.warnings };
}
