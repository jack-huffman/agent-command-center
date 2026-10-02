/**
 * Everything the extension decides, with no `vscode` import, so it can be tested with node:test.
 * The walkthrough is generated from core's step list (D-017): one source for the GUI and `acc doctor`.
 */
import type { CheckStatus, Step } from '../../packages/core/src/onboarding/types.ts';

export const PUBLISHER = 'JackHuffman';
export const NAME = 'agent-command-center';
export const EXTENSION_ID = `${PUBLISHER}.${NAME}`;

export const WALKTHROUGHS = {
  machine: { id: 'acc.machine', title: 'Agent Command Center: set up this machine', description: 'Tools and accounts the orchestrator needs. Each step ticks itself when its check passes.' },
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
export const needsConfirmation = (step: Step): boolean => !!step.fix?.text && !step.fix.command && !step.fix.setupPath;

export const hasRunnableFix = (step: Step): boolean => !!step.fix?.command || !!step.fix?.fromCheck;

export function walkthroughSteps(steps: Step[]): Step[] {
  return steps.filter((s) => !s.planned);
}

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
  if (f?.command || f?.fromCheck || f?.text || f?.setupPath || f?.docs) out.push('## How to fix it', '');
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
  const visible = walkthroughSteps(steps);
  return [
    { ...WALKTHROUGHS.machine, steps: visible.filter((s) => s.part === 'machine').map(toJson) },
    { ...WALKTHROUGHS.project, featuredFor: ['sfdx-project.json', '.acc/config.json'], steps: visible.filter((s) => s.part === 'project').map(toJson) },
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

export const initCommand = (profile: 'salesforce' | 'generic', productionOrg?: string): string =>
  profile === 'salesforce' ? `acc init --profile salesforce --production-org "${productionOrg}"` : 'acc init --profile generic';

// ---------------------------------------------------------------- sidebar (views)

export type Tone = 'orange' | 'blue' | 'neutral';
/** Orange means look at this, blue means moving or fine. Every item also carries its meaning in words. */
export const TONE_COLOR: Record<Tone, string | undefined> = { orange: 'charts.orange', blue: 'charts.blue', neutral: undefined };

export const TASK_GROUPS = ['needs-you', 'ready', 'running', 'review', 'rework', 'blocked', 'todo', 'done'] as const;
export type TaskGroup = (typeof TASK_GROUPS)[number];

export interface TaskRow {
  id: string;
  title: string;
  state: string;
  display: TaskGroup;
  environment: string;
  deps: string[];
  source: { kind: string; url: string | null };
  run?: { bgId?: string; sessionId?: string; worktree?: string; branch?: string } | null;
  /** The live state of the task's agent session, when one is known. */
  agent?: { label: string; icon: string; tone: Tone } | null;
}

/** A task's agent: its background id or session id, or a background session named after the task. */
export function sessionFor(row: Pick<TaskRow, 'id' | 'run'>, sessions: AgentSession[]): AgentSession | undefined {
  return sessions.find((s) => (row.run?.bgId && s.id === row.run.bgId) || (row.run?.sessionId && s.sessionId === row.run.sessionId))
    ?? sessions.find((s) => s.kind === 'background' && s.name === row.id);
}

export function groupTasks(rows: TaskRow[]): { group: TaskGroup; tasks: TaskRow[] }[] {
  return TASK_GROUPS.map((group) => ({ group, tasks: rows.filter((r) => r.display === group) })).filter((g) => g.tasks.length);
}

/** A Claude Code session as `claude agents --json` reports it. Background-only fields are optional. */
export interface AgentSession {
  cwd: string;
  kind: 'interactive' | 'background' | string;
  startedAt: number;
  sessionId?: string;
  name?: string;
  pid?: number;
  status?: 'busy' | 'waiting' | 'idle' | string;
  /** Background sessions only: working, blocked, done, failed, stopped. */
  state?: string;
  waitingFor?: string;
  /** Background sessions only: the short id `claude attach` takes. */
  id?: string;
}

export interface AgentLook {
  label: string;
  icon: string;
  tone: Tone;
  needsYou: boolean;
}

export function agentLook(s: AgentSession): AgentLook {
  if (s.state === 'blocked' || s.status === 'waiting') return { label: s.waitingFor ? `Needs you: ${s.waitingFor}` : 'Needs you', icon: 'bell', tone: 'orange', needsYou: true };
  if (s.state === 'failed') return { label: 'Failed', icon: 'warning', tone: 'orange', needsYou: true };
  if (s.state === 'working' || s.status === 'busy') return { label: 'Working', icon: 'sync~spin', tone: 'blue', needsYou: false };
  if (s.state === 'done') return { label: 'Done', icon: 'check', tone: 'neutral', needsYou: false };
  if (s.state === 'stopped') return { label: 'Stopped', icon: 'debug-stop', tone: 'neutral', needsYou: false };
  return { label: s.pid ? 'Idle' : 'Idle (exited)', icon: 'circle-outline', tone: 'neutral', needsYou: false };
}

export const isUnder = (path: string, root: string): boolean => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);

export interface Worktree {
  path: string;
  head: string;
  branch: string | null;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

/** Parses `git worktree list --porcelain`. The first entry is the main checkout. */
export function parseWorktrees(porcelain: string): Worktree[] {
  const out: Worktree[] = [];
  for (const block of porcelain.trim().split(/\n\s*\n/)) {
    if (!block.trim()) continue;
    const w: Worktree = { path: '', head: '', branch: null, bare: false, locked: false, prunable: false };
    for (const line of block.split('\n')) {
      const [key, ...restParts] = line.split(' ');
      const rest = restParts.join(' ');
      if (key === 'worktree') w.path = rest;
      else if (key === 'HEAD') w.head = rest;
      else if (key === 'branch') w.branch = rest.replace(/^refs\/heads\//, '');
      else if (key === 'bare') w.bare = true;
      else if (key === 'locked') w.locked = true;
      else if (key === 'prunable') w.prunable = true;
    }
    if (w.path) out.push(w);
  }
  return out;
}

export const ENV_ICON: Record<string, string> = {
  production: 'shield', full: 'server-environment', partial: 'server-environment', developer: 'beaker', developer_pro: 'beaker', none: 'git-branch',
};

/** A short session name from an agent prompt: "Fix the login page" → "fix-the-login-page". */
export function agentName(prompt: string): string {
  return prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 5).join('-') || 'agent';
}

export const githubBranchUrl = (repo: string, branch: string): string => `https://github.com/${repo}/tree/${encodeURIComponent(branch)}`;

/**
 * What VSCode passes a command run from a webview's native context menu: the row's data-vscode-context,
 * which carries the same Ref the tab's buttons use.
 */
export interface WebviewMenuContext {
  webviewSection: string;
  accRef: Record<string, string>;
}

export function isWebviewMenuContext(a: unknown): a is WebviewMenuContext {
  const x = a as { webviewSection?: unknown; accRef?: unknown } | null;
  return !!x && typeof x === 'object' && typeof x.webviewSection === 'string' && !!x.accRef && typeof x.accRef === 'object';
}

/** Accepts a pasted URL as well as a bare name: dev.azure.com/acme, acme.visualstudio.com, acme.atlassian.net/jira/… */
export function parseHost(kind: 'jira' | 'azure', input: string): string | null {
  const s = input.trim().replace(/^https?:\/\//, '');
  if (kind === 'azure') {
    const m = /^dev\.azure\.com\/([^/?#]+)/i.exec(s) ?? /^([^./?#]+)\.visualstudio\.com/i.exec(s) ?? /^([A-Za-z0-9][A-Za-z0-9-]*)$/.exec(s);
    return m ? decodeURIComponent(m[1]!) : null;
  }
  const m = /^([a-z0-9-]+\.atlassian\.net)/i.exec(s) ?? /^([a-z0-9-]+)$/i.exec(s);
  return m ? (m[1]!.includes('.') ? m[1]!.toLowerCase() : `${m[1]!.toLowerCase()}.atlassian.net`) : null;
}
