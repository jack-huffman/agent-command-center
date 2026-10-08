/**
 * Setup's decisions and the walkthrough, generated from core's step list (D-017): one source for the GUI
 * and `acc doctor`. Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */

import { join } from 'node:path';
import type { Tracker } from '../../../packages/core/src/config.ts';
import type { CheckStatus, Step } from '../../../packages/core/src/onboarding/types.ts';
import { describe } from '../../../packages/core/src/trackers/connect.ts';
import type { StartProject } from '../connect.ts';
import { shq } from './shared.ts';

export const PUBLISHER = 'JackHuffman';
export const NAME = 'agent-command-center';
export const EXTENSION_ID = `${PUBLISHER}.${NAME}`;

export const WALKTHROUGHS = {
  machine: { id: 'acc.machine', title: 'Agent Command Center: set up this machine', description: 'Tools, accounts and the acc plugin that agents need. Each step ticks itself when its check passes.' },
  project: { id: 'acc.project', title: 'Agent Command Center: onboard a project', description: 'Get a repo ready for parallel agents: config, GitHub account, branches per environment, source tracking and safe defaults.' },
} as const;

export const COMMANDS = {
  check: 'acc.step.check',
  fix: 'acc.step.fix',
  openSetup: 'acc.step.openSetup',
  confirm: 'acc.step.confirm',
  guide: 'acc.openGuide',
  doctor: 'acc.doctor',
  machine: 'acc.openMachineWalkthrough',
  project: 'acc.openProjectWalkthrough',
  chooseFolder: 'acc.chooseFolder',
} as const;

export const contextKey = (stepId: string): string => `acc.step.${stepId}`;

/** A command link. On a line of its own, VSCode shows it as a button. */
export function commandLink(label: string, command: string, args: unknown[] = []): string {
  return `[${label}](command:${command}${args.length ? `?${encodeURIComponent(JSON.stringify(args))}` : ''})`;
}

/** Steps a person must confirm, because nothing on this machine can check them. */
/** "I've done this" is for steps only a person can finish, or ones that say a person may decide (fix.confirm). */
export const needsConfirmation = (step: Step): boolean => (!!step.fix?.text && !step.fix.command && !step.fix.setupPath && !step.fix.vscode) || !!step.fix?.confirm;

export const hasRunnableFix = (step: Step): boolean => !!step.fix?.command || !!step.fix?.fromCheck || !!step.fix?.vscode;

export function stepDescription(step: Step): string {
  const lines = [step.why, ''];
  lines.push(commandLink('Check', COMMANDS.check, [step.id]));
  if (hasRunnableFix(step)) lines.push(commandLink('Do it', COMMANDS.fix, [step.id]));
  if (step.fix?.setupPath) lines.push(commandLink('Open in Salesforce', COMMANDS.openSetup, [step.id]));
  if (needsConfirmation(step)) lines.push(commandLink('I\'ve done this', COMMANDS.confirm, [step.id]));
  if (step.fix?.docs) lines.push(commandLink('Read the guide', COMMANDS.guide, [step.id]));
  return lines.join('\n');
}

/** The page shown beside the step: what it is, why it matters, and exactly what fixing it involves. */
export function stepMedia(step: Step): string {
  const out = [`# ${step.title}`, '', `\`${step.id}\``, '', step.why, ''];
  const f = step.fix;
  if (f?.command || f?.fromCheck || f?.vscode || f?.text || f?.setupPath || f?.docs) out.push('## How to fix it', '');
  if (f?.command) out.push('**Do it** runs this in a terminal, so you see exactly what happens:', '', '```bash', f.command, '```', '');
  if (f?.fromCheck) out.push('**Do it** runs the exact command the check works out for this repo, in a terminal you can see.', '');
  if (f?.text) out.push(f.text, '');
  if (f?.setupPath) out.push('**Open in Salesforce** opens Setup in the right org.', '');
  if (f?.docs) out.push(`More detail: ${f.docs.startsWith('http') ? `[Salesforce docs](${f.docs})` : 'the onboarding guide (**Read the guide**).'}`, '');
  out.push('---', '', 'The step ticks itself when its check passes. **Check** re-runs it at any time, and so does `acc doctor` in a terminal.');
  return out.join('\n') + '\n';
}

export interface WalkthroughStepJson {
  id: string;
  title: string;
  description: string;
  media: { markdown: string };
  completionEvents: string[];
  when?: string;
}

export interface WalkthroughJson {
  id: string;
  title: string;
  description: string;
  featuredFor?: string[];
  steps: WalkthroughStepJson[];
}

export const mediaPath = (stepId: string): string => `media/steps/${stepId}.md`;

export function buildWalkthroughs(steps: Step[]): WalkthroughJson[] {
  const toJson = (s: Step): WalkthroughStepJson => ({
    id: s.id,
    title: s.title,
    description: stepDescription(s),
    media: { markdown: mediaPath(s.id) },
    completionEvents: [`onContext:${contextKey(s.id)}`],
    ...(s.profiles && !s.profiles.includes('generic') ? { when: 'acc.profile != generic' } : {}),
  });
  return [
    { ...WALKTHROUGHS.machine, steps: steps.filter((s) => s.part === 'machine').map(toJson) },
    { ...WALKTHROUGHS.project, featuredFor: ['sfdx-project.json', '.acc/config.json'], steps: steps.filter((s) => s.part === 'project').map(toJson) },
  ];
}

// ---------------------------------------------------------------- runtime decisions

export interface DoctorItem {
  id: string;
  part: 'machine' | 'project';
  title: string;
  status: CheckStatus;
  detail: string;
  fix?: string | null;
  /** A folder to open instead, when the current one is an old copy beside the repo. */
  open?: string | null;
}

/** Machine results kept for every window, with the profile of the folder they were checked in. */
export interface MachineCache {
  at: number;
  profile?: string;
  items: DoctorItem[];
}

/**
 * The machine results a refresh may reuse instead of calling slow CLIs: fresh enough, and checked in a
 * folder with the same profile, since the profile decides which machine steps apply (A1.node and A1.sf
 * are Salesforce's). An empty list, which 0.35.0 and earlier could save when acc failed, is never reused.
 */
export const reusableMachine = (cached: MachineCache | undefined, profile: string, now: number, freshMs: number): DoctorItem[] | null =>
  cached?.items.length && cached.profile === profile && now - cached.at < freshMs ? cached.items : null;

/** What a full machine check saves for startup to reuse. An empty list means acc failed, and isn't kept (GH-62). */
export const machineCache = (items: DoctorItem[], profile: string, now: number): MachineCache | null =>
  items.length ? { at: now, profile, items } : null;

/**
 * Setup's rows after a full check (GH-62). Each part the check listed replaces that part's rows, so a step
 * that no longer applies goes: A1.node, once `acc init` makes the folder generic. A part whose check came
 * back empty (acc failed) keeps its rows, and `project: null`, a folder that isn't a project, drops them.
 */
export function afterFullCheck(previous: DoctorItem[], checked: { machine: DoctorItem[]; project: DoctorItem[] | null }): DoctorItem[] {
  const rows = (part: DoctorItem['part'], fresh: DoctorItem[] | null) => (fresh === null ? [] : fresh.length ? fresh : previous.filter((i) => i.part === part));
  return [...rows('machine', checked.machine), ...rows('project', checked.project)];
}

/** Setup's rows after a Check of one step, a re-check or a fix: those rows change and every other row stays. */
export function afterStepCheck(previous: DoctorItem[], checked: DoctorItem[]): DoctorItem[] {
  const byId = new Map(previous.map((i) => [i.id, i]));
  for (const it of checked) byId.set(it.id, it);
  return [...byId.values()];
}

/** A step counts as complete when it passes, doesn't apply (skip), or a person confirmed it. */
export const isComplete = (status: CheckStatus, confirmed = false): boolean => status === 'pass' || status === 'skip' || confirmed;

/** Commands with <placeholders> are typed into the terminal but not run, so the person fills them in. */
export const hasPlaceholder = (command: string): boolean => /<[^<>\s][^<>]*>/.test(command);

export interface Summary {
  total: number;
  done: number;
  failing: DoctorItem[];
  byHand: DoctorItem[];
}

export function summarize(items: DoctorItem[], confirmed: Set<string>): Summary {
  const failing = items.filter((i) => i.status === 'fail' && !confirmed.has(i.id));
  const byHand = items.filter((i) => i.status === 'unknown' && !confirmed.has(i.id));
  return { total: items.length, done: items.filter((i) => isComplete(i.status, confirmed.has(i.id))).length, failing, byHand };
}

/** Status bar text. The words carry the meaning; colour is only an accent. */
export function statusText(s: Summary): { text: string; tooltip: string; attention: boolean } {
  const todo = s.failing.length + s.byHand.length;
  if (!s.total) return { text: '$(checklist) Setup', tooltip: 'Agent Command Center: open the setup walkthrough', attention: false };
  if (!todo) return { text: '$(check) Setup done', tooltip: `All ${s.total} setup checks pass.`, attention: false };
  const next = s.failing[0] ?? s.byHand[0]!;
  return {
    text: `$(checklist) Setup: ${todo} to do`,
    tooltip: `${s.done} of ${s.total} setup steps done. Next: ${next.title} (${next.id}).`,
    attention: s.failing.length > 0,
  };
}

export interface EnvLike {
  name: string;
  type: string;
  org: string | null;
  default: boolean;
}

/** Which orgs "Open in Salesforce" offers: Developer sandboxes for tracking steps, otherwise the default first. */
export function setupOrgChoices(stepId: string, envs: EnvLike[]): EnvLike[] {
  const withOrg = envs.filter((e) => e.org);
  if (stepId.startsWith('B8.')) return withOrg.filter((e) => e.type === 'developer' || e.type === 'developer_pro');
  return [...withOrg].sort((a, b) => Number(b.default) - Number(a.default));
}

export const sfOpenCommand = (alias: string, path: string): string => `sf org open -o "${alias}" --path "${path}"`;

/** Production orgs a person can pick for `acc init`, from `sf org list --json`. */
export function productionOrgs(sfOrgList: unknown): string[] {
  const result = (sfOrgList as { result?: Record<string, unknown> })?.result ?? {};
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of Object.values(result)) {
    if (!Array.isArray(list)) continue;
    for (const o of list as { alias?: string; instanceUrl?: string; isSandbox?: boolean; isScratch?: boolean }[]) {
      if (!o.alias || o.isScratch || seen.has(o.alias)) continue;
      const prodUrl = /^https:\/\/[a-z0-9-]+\.my\.salesforce\.com\/?$/i.test(o.instanceUrl ?? '');
      if (o.isSandbox === false && prodUrl) {
        seen.add(o.alias);
        out.push(o.alias);
      }
    }
  }
  return out.sort();
}

/** Where B0.config's Do it takes a new project's settings from: a profile, or a team template, and Production's org for Salesforce (GH-80). */
export interface InitChoice {
  profile?: 'salesforce' | 'generic';
  productionOrg?: string;
  from?: string;
}

/** acc init's arguments, each value one argument: a choice, and a tracker picked on the Connect page as JSON (GH-81). */
export const initArgs = (o: InitChoice & { tracker?: Record<string, unknown> }): string[] => [
  ...(o.from ? ['--from', o.from] : []), ...(o.profile ? ['--profile', o.profile] : []), ...(o.productionOrg ? ['--production-org', o.productionOrg] : []),
  ...(o.tracker ? ['--tracker', JSON.stringify(o.tracker)] : []),
];

/** acc init as B0.config's Do it runs it in a terminal: each argument quoted as the shell needs. */
export const initCommand = (o: InitChoice & { tracker?: Record<string, unknown> }): string => ['acc init', ...initArgs(o).map(shq)].join(' ');

/** What `acc init --json` wrote, or with --dry-run would write (GH-81): the project's name and GitHub, or acc's own words. */
export type InitOutput = { ok: true; project: string; github: { repo: string; account: string } | null } | { ok: false; error: string };

export function initOutput(stdout: string, stderr = ''): InitOutput {
  try {
    const j = JSON.parse(stdout) as { config?: { project?: unknown; github?: { repo?: unknown; account?: unknown } | null }; message?: unknown };
    const c = j.config;
    if (c && typeof c.project === 'string') {
      const g = c.github;
      return { ok: true, project: c.project, github: g && typeof g.repo === 'string' && typeof g.account === 'string' ? { repo: g.repo, account: g.account } : null };
    }
    if (typeof j.message === 'string') return { ok: false, error: j.message };
  } catch {
    // said below
  }
  return { ok: false, error: (stderr || stdout).trim().split('\n')[0] || 'acc init printed nothing.' };
}

/**
 * A project to start on the Connect page (GH-81), as acc init would write it: the folder, the name and
 * GitHub the dry run found, and its ledger in the git directory its clones share, so a sign-in kept for it
 * alone is under the key it has once it's written. The rest of acc init's arguments go with it, for Save.
 */
export function pendingProject(i: { root: string; dry: Extract<InitOutput, { ok: true }>; commonDir: string; args: string[]; tracker: Record<string, unknown> | null }): StartProject {
  return { name: i.dry.project, root: i.root, config: { github: i.dry.github }, ledgerPath: join(i.commonDir, 'acc', 'ledger.json'), args: i.args, tracker: startTracker(i.tracker) };
}

/**
 * Where a team template says the tracker is (GH-81), as the Connect page fills it in: its kind, its site,
 * organization or account, and its project or board. A template never names an epic, labels or an area
 * path (D-097), so the place is always the person's to pick.
 */
export function startTracker(t: Record<string, unknown> | null): StartProject['tracker'] {
  const d = t && typeof t.kind === 'string' ? describe(t.kind) : undefined;
  if (!t || !d) return null;
  const blank: Tracker = { kind: d.kind as Tracker['kind'], site: null, project: null, repo: null, organization: null, account: null, team: null, board: null, statusColumn: null, prefix: null, skipLabels: [], epic: null, labels: [], areaPath: null, group: null, edits: false };
  const { host, values } = d.fromConfig({ ...blank, ...t } as Tracker, null);
  const ids = new Set(d.pickers.filter((p) => p.identifies).map((p) => p.key));
  return { kind: d.kind, host: host || null, values: Object.fromEntries(Object.entries(values).filter(([k, v]) => ids.has(k) && v !== null)) };
}

/** A team template this machine used: its source and name, nothing more (GH-80). */
export interface RecentTemplate {
  source: string;
  name: string;
}

/** The recent templates with one used just now: newest first, each source once, at most `max`. */
export const rememberTemplate = (list: RecentTemplate[], entry: RecentTemplate, max = 5): RecentTemplate[] =>
  [entry, ...list.filter((r) => r.source !== entry.source)].slice(0, max);

export type ShownTemplate =
  | {
    ok: true; name: string; description: string | null; profile: 'salesforce' | 'generic' | null; sets: string[]; commands: Record<string, string>;
    /** Its tracker, which a project started from an epic fills in on the Connect page (GH-81). */
    tracker: Record<string, unknown> | null;
  }
  | { ok: false; errors: string[] };

const trackerOf = (t: unknown): Record<string, unknown> | null => {
  const tracker = t && typeof t === 'object' ? (t as { tracker?: unknown }).tracker : null;
  return tracker && typeof tracker === 'object' && !Array.isArray(tracker) ? tracker as Record<string, unknown> : null;
};

/** What `acc template show --json` said: the template, or every problem with it, or why it couldn't be read. */
export function shownTemplate(stdout: string, stderr = ''): ShownTemplate {
  try {
    const j = JSON.parse(stdout) as Record<string, unknown>;
    if (j.ok === true && typeof j.name === 'string') {
      return {
        ok: true, name: j.name, description: typeof j.description === 'string' ? j.description : null,
        profile: j.profile === 'salesforce' || j.profile === 'generic' ? j.profile : null,
        sets: Array.isArray(j.sets) ? j.sets.map(String) : [],
        commands: j.commands && typeof j.commands === 'object' ? Object.fromEntries(Object.entries(j.commands).map(([k, v]) => [k, String(v)])) : {},
        tracker: trackerOf(j.template),
      };
    }
    if (Array.isArray(j.errors) && j.errors.length) return { ok: false, errors: j.errors.map(String) };
    if (typeof j.message === 'string') return { ok: false, errors: [j.message] };
  } catch {
    // said below
  }
  return { ok: false, errors: [(stderr || stdout).trim().split('\n')[0] || 'acc template show printed nothing.'] };
}

/** The confirmation's detail: what the template is, what it sets, and the commands it would run on this machine. */
export const templateDetail = (t: Extract<ShownTemplate, { ok: true }>): string => {
  const commands = Object.entries(t.commands);
  return [
    ...(t.description ? [t.description, ''] : []),
    ...t.sets,
    ...(t.profile ? [] : ['It sets no profile, so you choose Salesforce or Other next.']),
    ...(commands.length ? ['', 'Check commands it runs on this machine:', ...commands.map(([gate, cmd]) => `${gate}: ${cmd}`)] : []),
    '',
    'You review .acc/config.json and commit it yourself.',
  ].join('\n');
};

/** The org URL an environment should have (D-015): Production at <domain>.my.salesforce.com, a sandbox named after its branch. */
export function expectedOrgUrl(domain: string, env: { type: string; branch: string }): string {
  return env.type === 'production' ? `https://${domain}.my.salesforce.com` : `https://${domain}--${env.branch}.sandbox.my.salesforce.com`;
}

/** The account gh is using right now, from `gh auth status`. */
export function activeGhAccount(status: string): string | null {
  for (const block of status.split(/(?=Logged in to )/)) {
    const m = /^Logged in to \S+ account (\S+)/.exec(block);
    if (m && /Active account: true/.test(block)) return m[1]!;
  }
  return null;
}
