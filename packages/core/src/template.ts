/**
 * Team templates (GH-80, D-097): a JSON file a team keeps wherever it keeps things, which `acc init --from`
 * builds a project's config from. The template wins where it speaks, and discovery fills the rest. acc
 * ships none: docs/TEMPLATES.md shows ACME's.
 */
import { isObj } from './text.ts';
import { createHash } from 'node:crypto';
import {
  type AgentProfile, AGENT_ROLES, type AgentRole, type Autonomy, branchFor, type Config, type EnvType, type Environment, isStr, parseConfig, parseEnvironments,
  type Profile, PROFILES, type TemplateRecord,
} from './config.ts';
import { AccError, type Runner } from './exec.ts';
import type { RawEnv } from './init.ts';
import { importedRules, rulesName, templateRulesProblem } from './rules.ts';
import { type FetchOptions, fetchSource, recordedSource, COPY_KINDS } from './source.ts';
import { isTrackerKind, orList, TRACKER_KINDS, type TrackerKind, trackerName } from './trackers/types.ts';

/** A template is a short settings file: anything larger isn't one. */
export const TEMPLATE_MAX_BYTES = COPY_KINDS.template.maxBytes;
/** The autonomy a template may start a project at: the two `acc agents autonomy` offers (D-097, amending D-014). */
export const TEMPLATE_AUTONOMY = ['manual', 'review'] as const;

export type TemplateEnvironment = Omit<Environment, 'type' | 'org'> & { type: EnvType | null };

export interface TemplateTracker {
  kind: TrackerKind;
  /** Jira: the site, such as acme.atlassian.net. */
  site: string | null;
  /** Azure DevOps: the organization. */
  organization: string | null;
  /** monday.com: the account, as in acme.monday.com. */
  account: string | null;
  /** The default project: a Jira project key or an Azure DevOps project. */
  project: string | null;
  /** monday.com: the board, which is its project. */
  board: number | null;
  /** Azure DevOps or monday.com: the key prefix. */
  prefix: string | null;
}

export interface TemplateGates {
  required?: string[];
  commands?: Record<string, string>;
  heavy?: string[];
  severity?: number;
}

export interface TemplateAgents {
  max?: number;
  builder?: Partial<AgentProfile>;
  reviewer?: Partial<AgentProfile>;
}

/** What a template says. Anything it leaves out is null or absent, and discovery or acc's defaults fill it. */
export interface Template {
  name: string;
  description: string | null;
  profile: Profile | null;
  environments: TemplateEnvironment[] | null;
  gates: TemplateGates | null;
  tracker: TemplateTracker | null;
  autonomy: (typeof TEMPLATE_AUTONOMY)[number] | null;
  agents: TemplateAgents | null;
  /** Rules files acc init copies into .acc/rules/, each as acc rules import would (GH-108). */
  rules: string[] | null;
}

export interface TemplateParse {
  template: Template | null;
  errors: string[];
}

const given = (v: unknown) => v !== undefined && v !== null;

// ---------------------------------------------------------------- keys

/** Keys that look like a sign-in. A template never holds one: each person signs in on the Connect page (D-073). */
const SIGN_IN = /^(token|api[-_]?token|access[-_]?token|api[-_]?key|password|passwd|pat|secret|client[-_]?secret|email|username|user|credentials?)$/i;

/** The keys a template may set, by where they sit. */
const ALLOWED = {
  top: ['schema', 'name', 'description', 'profile', 'environments', 'gates', 'tracker', 'autonomy', 'agents', 'rules'],
  environment: ['name', 'type', 'default', 'protected', 'promotesTo', 'branch'],
  gates: ['required', 'commands', 'heavy', 'severity'],
  agents: ['max', ...AGENT_ROLES],
  role: ['model', 'effort', 'fallbackModel'],
} as const;

const OWN = 'belongs to a project\'s own .acc/config.json, not a team template';
/** Keys that belong to one project's config, and why a template can't set them. */
const PROJECT_ONLY: Record<'top' | 'environment' | 'agents' | 'tracker', Record<string, string>> = {
  top: {
    project: OWN, github: `${OWN}: acc init finds the repo and the account it pushes as`, commitIdentity: `${OWN}: it's each repo's own`,
    environmentSpecific: OWN, knownDrift: OWN, worktrees: OWN, secretScan: OWN, strayFiles: OWN, analysis: OWN, sourceTracking: `${OWN}: whether a client's orgs use source tracking is each project's own`, autopilot: OWN, template: `${OWN}: acc init records it`,
    trackers: 'isn\'t a template key: a template names one tracker, under "tracker"',
  },
  environment: { org: `${OWN}: an org alias is each person's own, and acc init finds it` },
  agents: { permissionMode: `${OWN}, so a fetched file can't loosen what builders may do` },
  tracker: {
    repo: `${OWN}: a GitHub tracker reads the project's own repo`, team: OWN, edits: `${OWN}: whether acc may change tickets is each project's choice (D-082)`,
    epic: OWN, labels: OWN, areaPath: OWN, group: OWN, statusColumn: OWN, skipLabels: OWN,
  },
};

/** The keys each kind of tracker takes in a template: its kind, its place, a default project, and a prefix. */
const TRACKER_KEYS: Record<TrackerKind, readonly string[]> = {
  github: ['kind'],
  jira: ['kind', 'site', 'project'],
  azure: ['kind', 'organization', 'project', 'prefix'],
  monday: ['kind', 'account', 'board', 'prefix'],
  // A template never names a Slack tracker (refused below), so only its kind is known here.
  slack: ['kind'],
};
/** Where each kind of tracker is: the key a template must give. */
const PLACE: Partial<Record<TrackerKind, { key: 'site' | 'organization' | 'account'; example: string }>> = {
  jira: { key: 'site', example: 'acme.atlassian.net' },
  azure: { key: 'organization', example: 'acme, as in dev.azure.com/acme' },
  monday: { key: 'account', example: 'acme, as in acme.monday.com' },
};

const unknownKey = (at: string) => `"${at}" isn't a template key. If the template was written for a newer acc, update acc.`;
const signIn = (at: string) => `"${at}" looks like a sign-in, and a team template never holds one: each person signs in on the Command Center's Connect page.`;

function checkKeys(obj: Record<string, unknown>, path: string, allowed: readonly string[], own: Record<string, string>, errors: string[], elsewhere: (k: string) => string | null = () => null): void {
  for (const k of Object.keys(obj)) {
    const at = path ? `${path}.${k}` : k;
    if (SIGN_IN.test(k)) errors.push(signIn(at));
    else if (allowed.includes(k)) continue;
    else if (Object.hasOwn(own, k)) errors.push(`"${at}" ${own[k]}.`);
    else errors.push(elsewhere(k) ?? unknownKey(at));
  }
}

// ---------------------------------------------------------------- parse

/**
 * Reads a template, refusing what it can't use: an unknown key at any level, named by its dotted path; a key
 * that belongs to a project's own config; anything like a sign-in; and a value the config's own rules
 * refuse. Environments follow D-015 and D-018's rules; a Salesforce one may leave its type to discovery.
 */
export function parseTemplate(raw: unknown): TemplateParse {
  const errors: string[] = [];
  if (!isObj(raw)) return { template: null, errors: ['A team template must be a JSON object.'] };
  checkKeys(raw, '', ALLOWED.top, PROJECT_ONLY.top, errors);
  if (raw.schema !== 1) errors.push('"schema" must be 1.');
  if (!isStr(raw.name) || raw.name.trim().length > 80) errors.push('"name" must be a short name for the template, such as "ACME Salesforce".');
  if (given(raw.description) && (typeof raw.description !== 'string' || raw.description.length > 1000)) errors.push('"description" must be a sentence or two about the template.');

  let profile: Profile | null = null;
  if (given(raw.profile)) {
    if ((PROFILES as readonly unknown[]).includes(raw.profile)) profile = raw.profile as Profile;
    else errors.push(`"profile" must be one of ${PROFILES.join(', ')}.`);
  }
  const p = profile ?? 'generic';

  let environments: TemplateEnvironment[] | null = null;
  if (given(raw.environments)) {
    if (Array.isArray(raw.environments)) raw.environments.forEach((e, i) => { if (isObj(e)) checkKeys(e, `environments[${i}]`, ALLOWED.environment, PROJECT_ONLY.environment, errors); });
    // With no profile, a type left out stays null: the project's profile decides it at acc init.
    environments = parseEnvironments(raw.environments, profile, errors, { typesFromDiscovery: true }).map(({ org: _org, ...e }) => e);
  }

  // Gates and agents are checked by the config's own rules, through a config made to hold them.
  const probe: Record<string, unknown> = {
    schema: 1, project: 'template', profile: p,
    environments: [{ name: 'main', type: p === 'salesforce' ? 'developer' : 'none', default: true }],
  };
  let gates: TemplateGates | null = null;
  if (given(raw.gates)) {
    if (!isObj(raw.gates)) errors.push('"gates" must be an object, such as { "required": ["test"], "commands": { "test": "npm test" } }.');
    else {
      checkKeys(raw.gates, 'gates', ALLOWED.gates, {}, errors);
      probe.gates = raw.gates;
      gates = Object.fromEntries(ALLOWED.gates.filter((k) => given((raw.gates as Record<string, unknown>)[k])).map((k) => [k, (raw.gates as Record<string, unknown>)[k]])) as TemplateGates;
    }
  }
  let agents: TemplateAgents | null = null;
  if (given(raw.agents)) {
    if (!isObj(raw.agents)) errors.push('"agents" must be an object, such as { "max": 3 }.');
    else {
      const a = raw.agents;
      checkKeys(a, 'agents', ALLOWED.agents, PROJECT_ONLY.agents, errors);
      for (const role of AGENT_ROLES) if (isObj(a[role])) checkKeys(a[role] as Record<string, unknown>, `agents.${role}`, ALLOWED.role, {}, errors);
      probe.agents = { max: a.max, builder: a.builder, reviewer: a.reviewer };
      const roleOf = (role: AgentRole): Partial<AgentProfile> | undefined => {
        const r = a[role];
        if (!isObj(r)) return undefined;
        const set = Object.fromEntries(ALLOWED.role.filter((k) => given(r[k])).map((k) => [k, r[k]]));
        return Object.keys(set).length ? (set as Partial<AgentProfile>) : undefined;
      };
      agents = { ...(given(a.max) ? { max: a.max as number } : {}), ...Object.fromEntries(AGENT_ROLES.flatMap((role) => (roleOf(role) ? [[role, roleOf(role)]] : []))) };
    }
  }

  let tracker: TemplateTracker | null = null;
  let trackerProbe: Record<string, unknown> | null = null;
  if (given(raw.tracker)) {
    const t = raw.tracker;
    if (!isObj(t)) errors.push('"tracker" must be an object, such as { "kind": "jira", "site": "acme.atlassian.net", "project": "ACME" }.');
    else if (!isTrackerKind(t.kind)) {
      errors.push(`"tracker.kind" must be ${orList([...TRACKER_KINDS])}.`);
    } else if (t.kind === 'slack') {
      errors.push('"tracker.kind" can\'t be slack in a team template: a Slack tracker\'s channel is each project\'s own, so each project names it in its own config.');
    } else {
      const kind = t.kind;
      const own = kind === 'monday' ? PROJECT_ONLY.tracker : { ...PROJECT_ONLY.tracker, board: `${OWN}: which board the Tasks tab shows is each project's own` };
      const other = (k: string) => {
        const takes = TRACKER_KINDS.filter((x) => TRACKER_KEYS[x].includes(k));
        return takes.length ? `"tracker.${k}" is for ${orList(takes.map(trackerName))} trackers only, and this one is ${trackerName(kind)}.` : null;
      };
      const before = errors.length;
      checkKeys(t, 'tracker', TRACKER_KEYS[kind], own, errors, other);
      const place = PLACE[kind];
      if (place && !isStr(t[place.key])) errors.push(`"tracker.${place.key}" is needed for ${trackerName(kind)}, such as ${place.example}.`);
      if (given(t.project) && !isStr(t.project)) errors.push('"tracker.project" must be the project\'s key or name.');
      if (errors.length === before) {
        // What config needs and a template may leave out, the project, is filled in to check the rest.
        trackerProbe = {
          kind, site: t.site, organization: t.organization, account: t.account, prefix: t.prefix,
          project: t.project ?? (kind === 'jira' || kind === 'azure' ? 'TEMPLATE' : undefined),
          board: t.board ?? (kind === 'monday' ? 1 : undefined),
        };
        probe.trackers = [trackerProbe];
        tracker = {
          kind,
          site: isStr(t.site) ? t.site.trim().toLowerCase() : null,
          organization: isStr(t.organization) ? t.organization.trim() : null,
          account: isStr(t.account) ? t.account.trim().toLowerCase() : null,
          project: isStr(t.project) ? t.project.trim() : null,
          board: Number.isSafeInteger(t.board) ? (t.board as number) : null,
          prefix: isStr(t.prefix) ? t.prefix.trim().toUpperCase() : null,
        };
      }
    }
  }

  let autonomy: Template['autonomy'] = null;
  if (given(raw.autonomy)) {
    if ((TEMPLATE_AUTONOMY as readonly unknown[]).includes(raw.autonomy)) autonomy = raw.autonomy as Template['autonomy'];
    else if (raw.autonomy === 'dispatch' || raw.autonomy === 'full') errors.push(`"autonomy" can't be ${raw.autonomy} in a template: a template starts a project at manual or review, and a person raises it in the project's own config (D-014).`);
    else errors.push(`"autonomy" must be one of ${TEMPLATE_AUTONOMY.join(', ')}.`);
  }

  let rules: string[] | null = null;
  if (given(raw.rules)) {
    if (!Array.isArray(raw.rules) || !raw.rules.length || !raw.rules.every(isStr)) errors.push('"rules" must be a list of rules files to copy in, such as ["https://github.com/acme/acc-rules/blob/main/salesforce.md"].');
    else {
      // Each copy is named for its file, so two can't share a name.
      const named = new Map<string, number>();
      raw.rules.forEach((s: string, i) => {
        const problem = templateRulesProblem(s);
        if (problem) return errors.push(`"rules[${i}]": ${problem}`);
        const name = rulesName(s);
        if (named.has(name)) errors.push(`"rules[${i}]" and "rules[${named.get(name)}]" would both be copied to .acc/rules/${name}.md. Rename one of the files.`);
        named.set(name, i);
      });
      rules = raw.rules.map((s: string) => s.trim());
    }
  }

  const checked = parseConfig(probe);
  errors.push(...checked.errors.map((e) => e.replace(/^trackers\[0\]: /, 'tracker: ')));

  if (errors.length) return { template: null, errors: [...new Set(errors)] };
  return {
    template: {
      name: (raw.name as string).trim(),
      description: isStr(raw.description) ? raw.description.trim() : null,
      profile, environments, gates, tracker, autonomy, agents, rules,
    },
    errors: [],
  };
}

// ---------------------------------------------------------------- digest and fetch

const canonical = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonical) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;

/** sha256 of the template's JSON with its keys sorted: whitespace and key order don't change it. */
export const templateDigest = (raw: unknown): string => `sha256:${createHash('sha256').update(JSON.stringify(canonical(raw))).digest('hex')}`;

/**
 * The template's text, fetched with gh or git, or read from the path (source.ts). Never `gh auth switch`
 * (D-007), and its calls share one deadline.
 */
export function fetchTemplateText(run: Runner, source: string, opts: FetchOptions = {}): string {
  return fetchSource(run, source, 'template', opts).text;
}

export interface ReadTemplate extends TemplateParse {
  raw: unknown;
  digest: string | null;
}

/** Fetches and parses a template. A fetch that fails throws; a template with problems comes back with them. */
export function readTemplate(run: Runner, source: string, opts: FetchOptions = {}): ReadTemplate {
  const text = fetchTemplateText(run, source, opts);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { template: null, errors: [`It isn't valid JSON: ${(e as Error).message}`], raw: null, digest: null };
  }
  return { ...parseTemplate(raw), raw, digest: templateDigest(raw) };
}

export interface LoadedTemplate {
  template: Template;
  /** What the project's config records: its name, where it came from, and its digest. */
  record: TemplateRecord;
}

/** A template ready for acc init, or an error listing every problem with it. */
export function loadTemplate(run: Runner, source: string, opts: FetchOptions & { root?: string } = {}): LoadedTemplate {
  const r = readTemplate(run, source, opts);
  if (!r.template) throw new AccError('bad-template', `${source.trim()} isn't a team template acc can use:\n- ${r.errors.join('\n- ')}`);
  return { template: r.template, record: { name: r.template.name, source: recordedSource(source, opts), digest: r.digest! } };
}

// ---------------------------------------------------------------- applying it

/**
 * The template's environments over the discovered ones (D-097). A generic project takes the template's as
 * they are. In a Salesforce project, Production's sandbox list decides which environments exist and their
 * types; the template's promotesTo, default and protected win for each sandbox it names. What doesn't
 * match either way is said in a note.
 */
export function overlayEnvironments(tEnvs: TemplateEnvironment[], base: RawEnv[], profile: Profile, notes: string[]): RawEnv[] {
  if (profile !== 'salesforce') {
    return tEnvs.map((e) => ({ name: e.name, type: e.type ?? 'none', org: null, default: e.default, protected: e.protected, promotesTo: [...e.promotesTo] }));
  }
  const named = new Map(tEnvs.map((e) => [e.branch, e]));
  const exists = new Set(base.map((e) => branchFor(e.name)));
  const out = base.map((e) => ({ ...e, promotesTo: [...e.promotesTo] }));
  for (const e of tEnvs) if (!exists.has(e.branch)) notes.push(`The template's ${e.name} isn't one of Production's sandboxes, so it's left out.`);
  const tDefault = tEnvs.find((e) => e.default);
  const useDefault = !!tDefault && exists.has(tDefault.branch);
  if (tDefault && !useDefault) {
    const stays = out.find((e) => e.default);
    notes.push(`The template's default, ${tDefault.name}, isn't one of Production's sandboxes${stays ? `, so ${stays.name} stays the default` : ''}.`);
  }
  for (const e of out) {
    const branch = branchFor(e.name);
    const t = named.get(branch);
    if (!t) {
      if (e.type !== 'production') notes.push(`${e.name} isn't in the template, so it keeps acc's usual path${e.promotesTo.length ? ` (to ${e.promotesTo.join(', ')})` : ''}.`);
      if (useDefault) e.default = false;
      continue;
    }
    if (t.type && t.type !== e.type) notes.push(`The template says ${t.name} is ${t.type}, but Production's sandbox list says ${e.type}, and that wins.`);
    const dropped = t.promotesTo.filter((b) => !exists.has(b));
    if (dropped.length) notes.push(`${e.name}'s promotion to ${dropped.join(', ')} is left out: ${dropped.length === 1 ? 'that isn\'t one of Production\'s sandboxes' : 'those aren\'t Production\'s sandboxes'}.`);
    e.promotesTo = t.promotesTo.filter((b) => exists.has(b));
    e.protected = e.type === 'production' || t.protected;
    if (useDefault) e.default = t.default;
  }
  return out;
}

export interface Settings {
  gates: TemplateGates & { required: string[]; commands: Record<string, string> };
  agents: { max: number; permissionMode: string; builder?: Partial<AgentProfile>; reviewer?: Partial<AgentProfile> };
  autonomy: Autonomy;
}

/** The template's gates, autonomy and agents over the project's: what it sets wins, and it adds gate commands. */
export function overlaySettings(t: Template, base: Settings): Settings {
  const g = t.gates ?? {};
  const a = t.agents ?? {};
  const role = (r: AgentRole) => (base.agents[r] || a[r] ? { [r]: { ...base.agents[r], ...a[r] } } : {});
  return {
    gates: {
      ...base.gates,
      ...(g.required ? { required: [...g.required] } : {}),
      commands: { ...base.gates.commands, ...g.commands },
      ...(g.heavy ? { heavy: [...g.heavy] } : {}),
      ...(g.severity !== undefined ? { severity: g.severity } : {}),
    },
    agents: { ...base.agents, ...(a.max !== undefined ? { max: a.max } : {}), ...role('builder'), ...role('reviewer') },
    autonomy: t.autonomy ?? base.autonomy,
  };
}

const trackerRaw = (t: TemplateTracker): Record<string, unknown> =>
  Object.fromEntries(Object.entries(t).filter(([, v]) => v !== null));

/**
 * The trackers acc init writes: the template's, with --jira-site and --jira-project winning over a Jira
 * one's site and project. A tracker with no project (a monday.com one with no board) is left out, with a
 * note: the Connect page finishes it.
 */
export function templateTrackers(t: TemplateTracker | null, flags: { jiraSite?: string; jiraProject?: string }, notes: string[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let site = flags.jiraSite;
  let project = flags.jiraProject;
  const connect = 'Connect one on the Command Center\'s Connect page.';
  if (t?.kind === 'jira') {
    site ??= t.site ?? undefined;
    project ??= t.project ?? undefined;
  } else if (t?.kind === 'azure' && !t.project) notes.push(`The template's Azure DevOps tracker, dev.azure.com/${t.organization}, names no project, so it's left out. ${connect}`);
  else if (t?.kind === 'monday' && !t.board) notes.push(`The template's monday.com tracker, ${t.account}.monday.com, names no board, so it's left out. ${connect}`);
  else if (t) out.push(trackerRaw(t));
  if (site && project) out.push({ kind: 'jira', site, project });
  else if (t?.kind === 'jira') notes.push(`The template's Jira tracker, ${site}, names no project, so it's left out. Pass --jira-project <key>, or connect one on the Command Center's Connect page.`);
  return out;
}

/**
 * The one tracker acc init writes for `--tracker` (GH-81), its null keys left out. It replaces the
 * template's tracker and --jira-site and --jira-project, and a note says which it replaced. When the
 * template's is the same kind on the same host, its key prefix stays unless the picked one names its own,
 * as withTracker keeps it on a replace. parseConfig checks it with the rest of the config.
 */
export function pickedTracker(tracker: Record<string, unknown>, was: { template: TemplateTracker | null; jiraSite?: string; jiraProject?: string }, notes: string[]): Record<string, unknown> {
  const picked = Object.fromEntries(Object.entries(tracker).filter(([, v]) => v !== null && v !== undefined));
  const t = was.template;
  const host = (r: Record<string, unknown>) => String(r.site ?? r.organization ?? r.account ?? r.repo ?? '').toLowerCase();
  const prefix = t?.prefix && t.kind === picked.kind && host(trackerRaw(t)) === host(picked) && typeof picked.prefix !== 'string' ? t.prefix : null;
  if (t) notes.push(`The tracker picked (--tracker) replaces the template's: ${trackerWords(t)}${prefix ? `, keeping its key prefix ${prefix}` : ''}.`);
  if (was.jiraSite || was.jiraProject) notes.push('The tracker picked (--tracker) replaces --jira-site and --jira-project.');
  return prefix ? { ...picked, prefix } : picked;
}

// ---------------------------------------------------------------- what it sets, and what differs

const envWords = (e: TemplateEnvironment) =>
  `${e.name}${e.type ? ` (${e.type})` : ''}${e.default ? ', the default' : ''}${e.protected ? ', protected' : ''}${e.promotesTo.length ? ` → ${e.promotesTo.join(', ')}` : ''}`;

export function trackerWords(t: TemplateTracker): string {
  if (t.kind === 'jira') return `Jira on ${t.site}${t.project ? `, project ${t.project}` : ', no project'}`;
  if (t.kind === 'azure') return `Azure DevOps, dev.azure.com/${t.organization}${t.project ? `, project ${t.project}` : ', no project'}`;
  if (t.kind === 'monday') return `monday.com, ${t.account}.monday.com${t.board ? `, board ${t.board}` : ', no board'}`;
  return 'GitHub issues in the project\'s own repo';
}

const roleWords = (p: Partial<AgentProfile>) =>
  [p.model ? `model ${p.model}` : '', p.effort ? `effort ${p.effort}` : '', p.fallbackModel ? `falls back to ${p.fallbackModel}` : ''].filter(Boolean).join(', ');

/** What a template sets, a line each, for acc template show and Setup's confirmation. Gate commands are listed apart. */
export function describeTemplate(t: Template): string[] {
  const lines: string[] = [];
  if (t.profile) lines.push(`Profile: ${t.profile}`);
  if (t.environments) lines.push(`Environments: ${t.environments.map(envWords).join('; ')}`);
  if (t.gates?.required) lines.push(`Required checks: ${t.gates.required.join(', ') || 'none'}`);
  if (t.gates?.heavy) lines.push(`Heavy checks: ${t.gates.heavy.join(', ') || 'none'}`);
  if (t.gates?.severity !== undefined) lines.push(`Code Analyzer fails at severity ${t.gates.severity} and worse`);
  if (t.tracker) lines.push(`Tracker: ${trackerWords(t.tracker)}`);
  if (t.autonomy) lines.push(`Autonomy: ${t.autonomy}`);
  if (t.agents?.max !== undefined) lines.push(`Agents: at most ${t.agents.max} at once`);
  for (const role of AGENT_ROLES) if (t.agents?.[role]) lines.push(`${role === 'builder' ? 'Builders' : 'Reviewers'}: ${roleWords(t.agents[role]!)}`);
  if (t.rules) lines.push(`Rules copied into .acc/rules/: ${t.rules.join('; ')}`);
  return lines;
}

const sameList = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const envKey = (e: RawEnv) => JSON.stringify([branchFor(e.name), e.type, e.org, e.default, e.protected, e.promotesTo]);
const place = (t: { site?: string | null; organization?: string | null; account?: string | null }) => (t.site ?? t.organization ?? t.account ?? '').toLowerCase();

/**
 * Where a project disagrees with what a template now says, as dotted keys (B0.template). It's the template
 * applied over the project's own settings, as acc init would, compared with them. A tracker agrees when the
 * project has one of the same kind at the same place: its project may differ, as --jira-project allows.
 * Given the repo's root, rules differ when the template names a source with no copy in .acc/rules/.
 */
export function templateDifferences(t: Template, config: Config, repo?: { root: string; home?: string }): string[] {
  const diffs: string[] = [];
  if (t.profile && t.profile !== config.profile) diffs.push('profile');
  if (t.environments && (t.profile ?? config.profile) === config.profile) {
    const base: RawEnv[] = config.environments.map(({ branch: _branch, ...e }) => e);
    const want = overlayEnvironments(t.environments, base, config.profile, []);
    if (!sameList(want.map(envKey), base.map(envKey))) diffs.push('environments');
  }
  const g = t.gates ?? {};
  if (g.required && !sameList(g.required, config.gates.required)) diffs.push('gates.required');
  if (g.commands && Object.entries(g.commands).some(([k, v]) => config.gates.commands[k] !== v)) diffs.push('gates.commands');
  if (g.heavy && !sameList(g.heavy, config.gates.heavy)) diffs.push('gates.heavy');
  if (g.severity !== undefined && g.severity !== config.gates.severity) diffs.push('gates.severity');
  if (t.tracker && !config.trackers.some((c) => c.kind === t.tracker!.kind && place(c) === place(t.tracker!))) diffs.push('tracker');
  if (t.autonomy && t.autonomy !== config.autonomy) diffs.push('autonomy');
  if (t.agents?.max !== undefined && t.agents.max !== config.agents.max) diffs.push('agents.max');
  for (const role of AGENT_ROLES) {
    for (const [k, v] of Object.entries(t.agents?.[role] ?? {})) if (config.agents[role][k as keyof AgentProfile] !== v) diffs.push(`agents.${role}.${k}`);
  }
  if (t.rules && repo) {
    const copied = new Set(importedRules(repo.root).map((c) => c.header?.source));
    if (t.rules.some((s) => !copied.has(recordedSource(s, { root: repo.root, home: repo.home, kind: 'rules' })))) diffs.push('rules');
  }
  return diffs;
}

const quoted = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The command that previews a template over this project, writing nothing: B0.template's fix. */
export function previewCommand(t: Template | null, record: TemplateRecord, config: Config): string {
  const profile = t?.profile ?? config.profile;
  const prod = config.environments.find((e) => e.type === 'production')?.org;
  return [
    'acc init --from', quoted(record.source),
    ...(t?.profile ? [] : ['--profile', config.profile]),
    // A project turning Salesforce has no Production org yet: the command names where it goes.
    ...(profile === 'salesforce' ? ['--production-org', prod ? quoted(prod) : '<production-org-alias>'] : []),
    '--dry-run',
  ].join(' ');
}
