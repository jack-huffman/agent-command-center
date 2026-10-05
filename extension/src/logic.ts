/**
 * Everything the extension decides, with no `vscode` import, so it can be tested with node:test.
 * The walkthrough is generated from core's step list (D-017): one source for the GUI and `acc doctor`.
 */
import type { Analysis } from '../../packages/core/src/analyze.ts';
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
/** "I've done this" is for steps only a person can finish, or ones that say a person may decide (fix.confirm). */
export const needsConfirmation = (step: Step): boolean => (!!step.fix?.text && !step.fix.command && !step.fix.setupPath && !step.fix.vscode) || !!step.fix?.confirm;

export const hasRunnableFix = (step: Step): boolean => !!step.fix?.command || !!step.fix?.fromCheck || !!step.fix?.vscode;

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
  /** Its agent's question is waiting in the Command Center (D-030), not in the agent's own terminal. */
  asking?: boolean;
  /** Its newest review (D-032): current when it's for the branch's latest commit. */
  review?: { verdict: 'pass' | 'changes'; summary: string; current: boolean } | null;
  /** A review under way, to watch. */
  reviewing?: { sessionId: string } | null;
  /** Its pull request (D-033). */
  pr?: { number: number; url: string; state: string; ci?: string | null; changesRequested?: boolean; conflicts?: string[] } | null;
  /** Its analysis (D-052): the verdict, when it was made, the questions nobody has answered, and the smaller tasks a split suggests. */
  analysis?: { verdict: 'ready' | 'questions' | 'split'; at: string; open: AnalysisAsk[]; split: string[] } | null;
  /** An analysis under way, to watch. */
  analyzing?: { sessionId: string } | null;
  /** The project wants an analysis before a task is built (D-052). */
  analysisRequired?: boolean;
  /** A step autopilot couldn't take in the task's current state, and why: the task needs you (D-055). */
  autopilot?: { step: 'review' | 'land' | 'dispatch'; reason: string } | null;
}

/** One of an analysis's questions a person hasn't answered: what it asks, why it matters, and what the analyst would assume. */
export interface AnalysisAsk {
  id: string;
  question: string;
  why: string;
  suggested: string;
}

/** What a task's row keeps of its analysis: enough for its card, its notices and the Overview. */
export function rowAnalysis(a: Analysis): NonNullable<TaskRow['analysis']> {
  const open = a.questions.filter((q) => !q.answer).map(({ id, question, why, suggested }) => ({ id, question, why, suggested }));
  return { verdict: a.verdict, at: a.at, open, split: a.split };
}

/** Its analysis is ready to build from: made, not too big, and every question answered. */
export const analysisReady = (row: Pick<TaskRow, 'analysis'>): boolean => !!row.analysis && row.analysis.verdict !== 'split' && !row.analysis.open.length;

/**
 * What a task to do waits on from its analysis, if anything: a person's answers, or a split (D-052). Only
 * a task to do: the analysis comes before the build.
 */
export function analysisWait(row: Pick<TaskRow, 'state' | 'analysis' | 'analyzing'>): 'questions' | 'split' | null {
  if (row.state !== 'todo' || !row.analysis || row.analyzing) return null;
  if (row.analysis.verdict === 'split') return 'split';
  return row.analysis.open.length ? 'questions' : null;
}

export const questionsWord = (n: number): string => `${n} question${n === 1 ? '' : 's'}`;

/** acc's arguments for a person's answer (D-012). The words come after --, so an answer that starts with - stays words. */
export const analysisAnswerArgs = (task: string, question: string, text: string): string[] => ['analysis', 'answer', task, question, '--json', '--', text];

/** The files an open pull request conflicts in with its base, or none (D-049). */
export const prConflicts = (row: Pick<TaskRow, 'pr'>): string[] => (row.pr?.state === 'open' ? row.pr.conflicts ?? [] : []);

/** Files in a sentence: the first few, then how many more. */
export function fileList(files: string[], max = 3): string {
  return files.length > max ? `${files.slice(0, max).join(', ')} and ${files.length - max} more` : files.join(', ');
}

/** A file by its folder and name, short enough for a card: force-app/…/layouts/Lead.layout → layouts/Lead.layout. */
export const shortPath = (file: string): string => file.split('/').slice(-2).join('/');

/**
 * What a card and a ticket's page say about a pull request that won't merge into its base. A card names
 * the first few files by folder and name; the page names every file in full.
 */
export const conflictLine = (row: Pick<TaskRow, 'pr' | 'environment'>, full = false): string | null => {
  const files = prConflicts(row);
  return files.length ? `Conflicts with ${row.environment}: ${full ? files.join(', ') : fileList(files.map(shortPath))}` : null;
};

/**
 * What the Command Center says after a land. `comment` is the Jira or Azure DevOps comment the extension
 * posted, and its error if it failed. A comment that isn't confirmed or failed is a warning, as the
 * CLI's orange '!' is (D-051, D-053).
 */
export function landMessage(id: string, r: { opened?: boolean; pr?: { number: number }; commentUnconfirmed?: string | null }, comment?: { key: string; error?: string }): { level: 'info' | 'warning'; text: string } {
  let note = r.commentUnconfirmed ? ` The comment on ${id}'s issue isn't confirmed: ${r.commentUnconfirmed.replace(/([^.!?])$/, '$1.')} Look at the issue before you post it again.` : '';
  let warn = !!r.commentUnconfirmed;
  if (comment) {
    note = comment.error === undefined ? ` Commented on ${comment.key}.` : ` Couldn't comment on ${comment.key}: ${comment.error}`;
    warn = comment.error !== undefined;
  }
  return { level: warn ? 'warning' : 'info', text: `${id}: ${r.opened ? 'opened' : 'updated'} pull request #${r.pr?.number}.${note}` };
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

/** What an agent's waiting question asks for, in a few words, from the tool it's about (D-030). */
export const askingLabel = (tool: string): string => (tool === 'AskUserQuestion' ? 'has a question' : tool === 'ExitPlanMode' ? 'has a plan to approve' : 'wants permission');

/** `asking` is what a question waiting in the Command Center asks for; the session reads as busy meanwhile. */
export function agentLook(s: AgentSession, asking?: string | null): AgentLook {
  if (asking) return { label: `Needs you: ${asking}`, icon: 'bell', tone: 'orange', needsYou: true };
  if (s.state === 'blocked' || s.status === 'waiting') return { label: s.waitingFor ? `Needs you: ${s.waitingFor}` : 'Needs you', icon: 'bell', tone: 'orange', needsYou: true };
  if (s.state === 'failed') return { label: 'Failed', icon: 'warning', tone: 'orange', needsYou: true };
  if (s.state === 'working' || s.status === 'busy') return { label: 'Working', icon: 'sync~spin', tone: 'blue', needsYou: false };
  if (s.state === 'done') return { label: 'Done', icon: 'check', tone: 'neutral', needsYou: false };
  if (s.state === 'stopped') return { label: 'Stopped', icon: 'debug-stop', tone: 'neutral', needsYou: false };
  return { label: s.pid ? 'Idle' : 'Idle (exited)', icon: 'circle-outline', tone: 'neutral', needsYou: false };
}

/** Claude Code for VSCode (D-040): its documented link opens a session's conversation in a tab. */
export const CLAUDE_EXTENSION = 'anthropic.claude-code';
export const claudeSessionUri = (scheme: string, sessionId: string, prompt?: string): string =>
  `${scheme}://${CLAUDE_EXTENSION}/open?session=${encodeURIComponent(sessionId)}${prompt ? `&prompt=${encodeURIComponent(prompt)}` : ''}`;
/** Session ids Claude Code's link takes: UUIDs, not the short background id. */
export const isSessionId = (v: string | undefined): v is string => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

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

/** Quotes one word for a POSIX shell, so an org alias with spaces stays one argument. */
export const shq = (s: string): string => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);

// ---------------------------------------------------------------- runs: commands acc runs for you (D-030)

/** Colour codes and other terminal controls, which a log shown as text doesn't want. */
const CONTROL = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/**
 * Adds a chunk of output to a log of lines, as a terminal would show it: a carriage return redraws the
 * current line (progress bars), colour codes are dropped, and only the last `keep` lines are kept.
 * The last element is the line still being written.
 */
export function appendOutput(lines: string[], chunk: string, keep = 2000): string[] {
  const out = lines.length ? [...lines] : [''];
  for (const part of chunk.replace(CONTROL, '').replace(/\r\n/g, '\n').split(/(\n|\r)/)) {
    if (part === '\n') out.push('');
    else if (part === '\r') out[out.length - 1] = '';
    else if (part) out[out.length - 1] += part;
  }
  return out.length > keep ? out.slice(out.length - keep) : out;
}

export interface RunPrompt {
  /** yesno: answer with Yes or No. secret: a password, which a pipe can't take. text: anything else. */
  kind: 'yesno' | 'secret' | 'text';
  text: string;
}

/**
 * Whether a command that has gone quiet is waiting for an answer, from its last, unfinished line:
 * "Continue? [Y/n]", "Password:", "Enter a name:". Null when it's just busy.
 */
export function promptOf(partial: string): RunPrompt | null {
  const line = partial.trim();
  if (!line || line.length > 300) return null;
  if (/password|passphrase|passcode/i.test(line) && /[:?]\s*$/.test(line)) return { kind: 'secret', text: line };
  if (/(\(|\[)\s*y(es)?\s*\/\s*n(o)?\s*(\)|\])|\by\/n\b|yes\/no/i.test(line)) return { kind: 'yesno', text: line };
  if (/(press (enter|return|any key))/i.test(line)) return { kind: 'text', text: line };
  if (/[?:>]\s*$/.test(line) && !/^(https?:\/\/|\w:\\)/.test(line)) return { kind: 'text', text: line };
  return null;
}

/** Commands that need a real terminal: they read the keyboard directly, or talk to you in their own screen. */
export const needsTerminal = (command: string): boolean => /^\s*(claude(\s*$|\s+(?!update\b)[^-])|claude\s*#|sudo\b|ssh\b|vi\b|vim\b|nano\b|gh auth login\b|.*\|\s*less\b)/.test(command) || hasPlaceholder(command);

// ---------------------------------------------------------------- what changed, said once (D-044)

export type NoticeKind = 'waiting' | 'review' | 'passed' | 'rework' | 'blocked' | 'ci-failed' | 'changes' | 'conflicts' | 'merged' | 'analysis-ready' | 'analysis-questions' | 'analysis-split';

export interface TaskNotice {
  kind: NoticeKind;
  task: string;
  text: string;
  /** Needs a person: shown as a warning. The rest are news. */
  urgent: boolean;
}

/**
 * What a person would want to hear about, from how a project's tasks looked before and after a reload:
 * a builder finished, a review passed or asked for changes, an agent waits on its own prompt, a pull
 * request's checks failed, it conflicts with its base, it merged, or its analysis came back (D-052): ready,
 * with questions for you, or too big for one task. A task seen for the first time says
 * nothing, so opening VSCode doesn't replay the board. A question waiting in the Command Center has its
 * own notice (D-030).
 */
export function taskNotices(before: TaskRow[], after: TaskRow[]): TaskNotice[] {
  const was = new Map(before.map((t) => [t.id, t]));
  const out: TaskNotice[] = [];
  for (const t of after) {
    const p = was.get(t.id);
    if (!p) continue;
    const say = (kind: NoticeKind, text: string, urgent: boolean) => out.push({ kind, task: t.id, text, urgent });
    const moved = p.state !== t.state;
    if (moved && p.state === 'running' && t.state === 'review') say('review', `${t.id} is ready for review: ${t.title}`, false);
    else if (moved && t.state === 'rework') say('rework', `The review asked for changes on ${t.id}${t.review?.summary ? `: ${t.review.summary}` : '.'}`, true);
    else if (moved && t.state === 'blocked') say('blocked', `${t.id} is blocked: ${t.title}`, true);
    if (t.display === 'needs-you' && p.display !== 'needs-you' && t.state === 'running' && !t.asking) say('waiting', `${t.id}'s agent is waiting for you in its own prompt.`, true);
    const passed = (r: TaskRow) => r.state === 'review' && r.review?.verdict === 'pass' && r.review.current && !r.pr;
    if (passed(t) && !passed(p)) say('passed', `The review passed ${t.id}. It's ready to land.`, false);
    const pr = t.pr;
    if (pr?.state === 'open' && pr.ci === 'failing' && p.pr?.ci !== 'failing') say('ci-failed', `Checks failed on pull request #${pr.number} (${t.id}).`, true);
    if (pr?.state === 'open' && pr.changesRequested && !p.pr?.changesRequested) say('changes', `A reviewer asked for changes on pull request #${pr.number} (${t.id}).`, true);
    // Said when it starts to conflict, not again as the files change.
    if (pr && prConflicts(t).length && !prConflicts(p).length) say('conflicts', `Pull request #${pr.number} (${t.id}) conflicts with ${t.environment} in ${fileList(prConflicts(t))}.`, true);
    if (pr?.state === 'merged' && p.pr?.state !== 'merged') say('merged', `Pull request #${pr.number} merged. ${t.id} is done.`, false);
    // A new analysis, not an answer to one of its questions: an answer keeps its time (D-052).
    const a = t.analysis;
    if (a && a.at !== p.analysis?.at) {
      if (a.verdict === 'split') say('analysis-split', `${t.id}'s analysis says it's too big for one task.`, true);
      else if (a.open.length) say('analysis-questions', `${t.id}'s analysis has ${questionsWord(a.open.length)} for you.`, true);
      else say('analysis-ready', `${t.id}'s analysis is ready.`, false);
    }
  }
  return out;
}

/** The buttons a notice offers, as [label, command] pairs. The task's page is always the last. */
export function noticeActions(n: TaskNotice): [label: string, command: string][] {
  const first: Partial<Record<NoticeKind, [string, string]>> = {
    waiting: ['Open in Claude Code', 'acc.task.openInClaude'],
    review: ['Review', 'acc.task.review'],
    passed: ['Land', 'acc.task.land'],
    rework: ['Re-dispatch', 'acc.task.dispatch'],
    'ci-failed': ['Open pull request', 'acc.task.openPr'],
    changes: ['Open pull request', 'acc.task.openPr'],
    conflicts: ['Open pull request', 'acc.task.openPr'],
    'analysis-ready': ['Dispatch', 'acc.task.dispatch'],
    // Its questions are answered on its page, so Answer is the page.
    'analysis-questions': ['Answer', 'acc.task.show'],
  };
  const a = first[n.kind];
  if (a?.[1] === 'acc.task.show') return [a];
  return [...(a ? [a] : []), ['Show', 'acc.task.show']];
}

export interface StatusSummary {
  /** Empty when nothing is in play: the item hides. */
  text: string;
  tooltip: string;
  attention: boolean;
}

/**
 * The status bar's one line on the swarm: what needs you, what's running, what's in review. Each count
 * has its icon and its words, so it reads without colour.
 */
export function statusSummary(rows: Pick<TaskRow, 'id' | 'title' | 'display'>[], needsYou: number): StatusSummary {
  const running = rows.filter((r) => r.display === 'running');
  const review = rows.filter((r) => r.display === 'review');
  const parts = [
    needsYou ? `$(bell) ${needsYou} need${needsYou === 1 ? 's' : ''} you` : '',
    running.length ? `$(sync) ${running.length} running` : '',
    review.length ? `$(eye) ${review.length} in review` : '',
  ].filter(Boolean);
  const list = (label: string, rs: typeof rows) => (rs.length ? [`${label}: ${rs.map((r) => r.id).join(', ')}`] : []);
  const tooltip = [
    needsYou ? `${needsYou} thing${needsYou === 1 ? '' : 's'} need${needsYou === 1 ? 's' : ''} you` : '',
    ...list('Running', running),
    ...list('In review', review),
  ].filter(Boolean).join('\n');
  return { text: parts.join('  '), tooltip: tooltip ? `${tooltip}\n\nOpen the Command Center` : '', attention: needsYou > 0 };
}
