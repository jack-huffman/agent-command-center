/**
 * Everything the extension decides, with no `vscode` import, so it can be tested with node:test.
 * The walkthrough is generated from core's step list (D-017): one source for the GUI and `acc doctor`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Analysis } from '../../packages/core/src/analyze.ts';
import { AUTOPILOT_REVIEW_DOES, type AutopilotRecord, reworkedByAutopilot } from '../../packages/core/src/autopilot.ts';
import type { AutopilotStepName, TaskInput } from '../../packages/core/src/ledger.ts';
import type { CheckStatus, Step } from '../../packages/core/src/onboarding/types.ts';
import { isTrackerKind, type Ticket } from '../../packages/core/src/trackers/types.ts';
import type { Pending } from '../webview/pending.ts';

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

/** Machine results kept for every window, with the profile of the folder they were checked in. */
export interface MachineCache {
  at: number;
  profile?: string;
  items: DoctorItem[];
}

/**
 * The machine results a refresh may reuse instead of calling slow CLIs: fresh enough, and checked in a
 * folder with the same profile, since the profile decides which machine steps apply (A1.node and A1.sf
 * are Salesforce's).
 */
export const reusableMachine = (cached: MachineCache | undefined, profile: string, now: number, freshMs: number): DoctorItem[] | null =>
  cached && cached.profile === profile && now - cached.at < freshMs ? cached.items : null;

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

/**
 * The agent board's lanes, left to right, as a task goes (D-068): To do first, as on a tracker's own board.
 * A tracker's board keeps its own columns in its own order. Lists still put what needs you first (TASK_GROUPS).
 */
export const BOARD_LANES: readonly TaskGroup[] = ['todo', 'ready', 'running', 'needs-you', 'review', 'rework', 'blocked', 'done'];

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
  /** Its newest review (D-032): current when it's for the branch's latest commit. When it was made, so Slack can tell one from the next. */
  review?: { verdict: 'pass' | 'changes'; summary: string; current: boolean; at?: string } | null;
  /** A review under way, to watch. */
  reviewing?: { sessionId: string } | null;
  /** Its pull request (D-033). */
  pr?: { number: number; url: string; state: string; ci?: string | null; changesRequested?: boolean; conflicts?: string[] } | null;
  /** A promotion taking its change on to another environment is open (D-075). */
  promoting?: boolean;
  /** Its analysis (D-052): the verdict, when it was made, the questions nobody has answered, and the smaller tasks a split suggests. */
  analysis?: { verdict: 'ready' | 'questions' | 'split'; at: string; open: AnalysisAsk[]; split: string[] } | null;
  /** An analysis under way, to watch. */
  analyzing?: { sessionId: string } | null;
  /** The project wants an analysis before a task is built (D-052). */
  analysisRequired?: boolean;
  /** A step autopilot couldn't take in the task's current state, and why: the task needs you (D-055). */
  autopilot?: { step: AutopilotStepName; reason: string } | null;
  /**
   * The checks that failed on GitHub (D-076): on its open pull request while it's in review, or the ones
   * autopilot sent it back to its builder for while it's in rework.
   */
  checks?: string[] | null;
  /** Its builder stopped before acc done or acc block, and the last thing it said, if that could be read (D-067). */
  stopped?: { said: string | null } | null;
  /** A resume of its builder is under way. */
  resuming?: boolean;
}

/** One of an analysis's questions a person hasn't answered: what it asks, why it matters, and what the analyst would assume. */
export interface AnalysisAsk {
  id: string;
  question: string;
  why: string;
  suggested: string;
  /** Sent to the client as a draft update, or posted (D-066). */
  client?: 'drafted' | 'posted';
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

/**
 * Whether acc sync has a pull request to follow for a task: its own, still open, or a promotion taking it
 * on, whose merge tells its ticket the change is in the next environment (D-075).
 */
export const followsPullRequests = (row: Pick<TaskRow, 'pr' | 'promoting'>): boolean => row.pr?.state === 'open' || !!row.promoting;

/** The files an open pull request conflicts in with its base, or none (D-049). */
export const prConflicts = (row: Pick<TaskRow, 'pr'>): string[] => (row.pr?.state === 'open' ? row.pr.conflicts ?? [] : []);

/** Files in a sentence: the first few, then how many more. */
export function fileList(files: string[], max = 3): string {
  return files.length > max ? `${files.slice(0, max).join(', ')} and ${files.length - max} more` : files.join(', ');
}

/** A file by its folder and name, short enough for a card: force-app/…/layouts/Lead.layout → layouts/Lead.layout. */
export const shortPath = (file: string): string => file.split('/').slice(-2).join('/');

/** What a card, a tracker's card and a ticket's page say about checks that failed on GitHub (D-076). */
export const failedChecksLine = (row: Pick<TaskRow, 'checks'>): string | null => (row.checks?.length ? `Checks failed on GitHub: ${row.checks.join(', ')}` : null);

/**
 * What a card and a ticket's page say about a pull request that won't merge into its base. A card names
 * the first few files by folder and name; the page names every file in full.
 */
export const conflictLine = (row: Pick<TaskRow, 'pr' | 'environment'>, full = false): string | null => {
  const files = prConflicts(row);
  return files.length ? `Conflicts with ${row.environment}: ${full ? files.join(', ') : fileList(files.map(shortPath))}` : null;
};

/**
 * What the Command Center says after a land: the pull request, and that the ticket's update is ready to
 * review, since acc posts nothing itself (D-066). An update that couldn't be drafted is a warning, as the
 * CLI's orange '!' is (D-053).
 */
export function landMessage(id: string, r: { opened?: boolean; pr?: { number: number }; update?: { id: string; key: string } | null; updateError?: string }): { level: 'info' | 'warning'; text: string } {
  const landed = `${id}: ${r.opened ? 'opened' : 'updated'} pull request #${r.pr?.number}.`;
  if (r.updateError) return { level: 'warning', text: `${landed} No update was drafted for its ticket: ${r.updateError.replace(/([^.!?])$/, '$1.')}` };
  // A GitHub issue's key is #12; the board names it by its task, GH-12.
  return { level: 'info', text: r.update ? `${landed} An update for ${r.update.key.startsWith('#') ? id : r.update.key} is ready for you to review and post.` : landed };
}

/**
 * A task's agent: its background id or session id, or a background session named after the task. One
 * with a process comes first: a resumed conversation is listed beside its old background session (D-067).
 */
export function sessionFor(row: Pick<TaskRow, 'id' | 'run'>, sessions: AgentSession[]): AgentSession | undefined {
  const mine = sessions.filter((s) => (row.run?.bgId && s.id === row.run.bgId) || (row.run?.sessionId && s.sessionId === row.run.sessionId));
  return mine.find((s) => s.pid) ?? mine[0] ?? sessions.find((s) => s.kind === 'background' && s.name === row.id);
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

/**
 * Which of a repo's tasks to ask a Jira or Azure DevOps tracker about once its board has loaded (D-072):
 * unfinished ones from that tracker (its kind, and a key it owns) that the board didn't show.
 */
export function placeCandidates(tasks: { id: string; state: string; source: { kind: string } }[], board: { kind: string; index: number; cards: { key: string }[] }, trackerOf: (key: string) => number | null): string[] {
  const shown = new Set(board.cards.map((c) => c.key.toUpperCase()));
  return tasks.filter((t) => t.source.kind === board.kind && t.state !== 'done' && !shown.has(t.id.toUpperCase()) && trackerOf(t.id) === board.index).map((t) => t.id);
}

/**
 * The keys a tracker says have left the repo's place, of those asked about. A read that fails says none
 * have: a task is never removed for an error (D-048). A key it wasn't asked about is never taken from it.
 */
export async function outsideKeys<T extends { key: string }>(keys: string[], read: (keys: string[]) => Promise<T[]>): Promise<T[]> {
  if (!keys.length) return [];
  const asked = new Set(keys.map((k) => k.toUpperCase()));
  try {
    return (await read(keys)).filter((o) => asked.has(o.key.toUpperCase()));
  } catch {
    return [];
  }
}

/** Accepts a pasted URL as well as a bare name. It lives with the trackers' descriptions now (GH-51). */
export { parseHost } from '../../packages/core/src/trackers/connect.ts';

/**
 * Which repo a tracker sign-in belongs to (D-027): its GitHub repo when it has one, so every clone and
 * worktree shares it, or else its git directory.
 */
export const repoKey = (p: { config: { github: { repo: string } | null }; ledgerPath: string }): string =>
  p.config.github ? `github:${p.config.github.repo.toLowerCase()}` : `git:${dirname(dirname(p.ledgerPath))}`;

/** Where VSCode keeps one repo's sign-in to one tracker host: acc.cred:github:acme/service:jira:acme.atlassian.net. */
export const credKey = (p: Parameters<typeof repoKey>[0], kind: string, host: string): string => `acc.cred:${repoKey(p)}:${kind}:${host}`;

/**
 * `acc import --json` with these tasks, through a file that's removed after. --json is what accRefusal
 * reads acc's reasons from (D-074).
 */
export async function accImport(acc: (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>, root: string, input: TaskInput[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'acc-track-'));
  try {
    const file = join(dir, 'task.json');
    writeFileSync(file, JSON.stringify(input));
    return await acc(['import', '--file', file, '--json'], root);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What `acc import` takes for a tracker's ticket: its title, description and label names. The ticket isn't changed (D-066). */
export function trackInput(t: Pick<Ticket, 'kind' | 'key' | 'url' | 'title' | 'markdown' | 'labels'>): TaskInput[] {
  return [{
    source: { kind: t.kind, key: t.kind === 'github' ? `#${t.key.replace(/^GH-/i, '')}` : t.key, url: t.url },
    title: t.title, brief: t.markdown, labels: t.labels.map((l) => l.name),
  }];
}

/**
 * Why acc refused, in its own words, from its --json output: the first item `acc import` couldn't take, or
 * the error it stopped on. Null when it took everything.
 */
export function accRefusal(r: { code: number; stdout: string; stderr: string }): string | null {
  if (r.code === 0) return null;
  type Said = { errors?: unknown; message?: unknown } | null;
  let said: Said = null;
  try { said = JSON.parse(r.stdout) as Said; } catch { /* plain text */ }
  const first = Array.isArray(said?.errors) ? said.errors.find((e): e is string => typeof e === 'string' && !!e.trim()) : undefined;
  if (first) return first;
  if (typeof said?.message === 'string' && said.message.trim()) return said.message;
  return (r.stderr || r.stdout).trim().split('\n')[0] || `acc exited ${r.code}`;
}

/** Track's reply: done, why not, or that this ticket is already on its way and nothing more was started. */
export type TrackReply = { ok: true } | { ok: false; error: string } | { ok: false; already: true };

/** A ticket's Track, as a card shows it: on its way, or why the last one didn't go (D-074). */
export interface TrackState { busy: boolean; error: string | null }

/** What a board's cards show of their Track: only the ones on their way, or with a reason to show. */
export function cardTracking(cards: { key: string }[], state: (key: string) => TrackState): Record<string, TrackState> {
  return Object.fromEntries(cards.map((c) => [c.key, state(c.key)] as const).filter(([, t]) => t.busy || t.error));
}

/**
 * The Tracks a window keeps after its boards load (D-074): every one on its way, and every card a board
 * still shows, as `<root>#<KEY>`. A refusal for a card no board shows any more is let go.
 */
export function liveTrackKeys(inFlight: string[], boards: Iterable<readonly [string, readonly { board: { cards: readonly { key: string }[] } | null }[]]>): Set<string> {
  const live = new Set(inFlight);
  for (const [root, states] of boards) for (const s of states) for (const c of s.board?.cards ?? []) live.add(`${root}#${c.key.toUpperCase()}`);
  return live;
}

/** What tracking a ticket does, passed in so it's tested without a tracker or acc. */
export interface TrackSteps {
  /** The ticket, read again from its tracker: one outside the repo's place throws, naming it (D-072). */
  read: () => Promise<Ticket>;
  /** `acc import --json` with these tasks. */
  importTasks: (input: TaskInput[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  /** acc's tasks read again, so the new one shows before Tracking… goes. */
  reload: () => Promise<void>;
  /** Its tracking started or settled, so the pages redraw. */
  changed?: () => void;
}

/**
 * Track, from a ticket's card or its page: one way for both (D-074). A key already on its way starts
 * nothing. Otherwise the ticket is read, imported with its title, description and labels, and acc's tasks
 * reloaded, then the key settles: cleared, or keeping why it didn't go until the next try.
 */
export async function trackTicket(key: string, pending: Pick<Pending<'track'>, 'start' | 'settle'>, steps: TrackSteps): Promise<TrackReply> {
  if (!pending.start(key, 'track')) return { ok: false, already: true };
  steps.changed?.();
  let error: string | null;
  try {
    error = accRefusal(await steps.importTasks(trackInput(await steps.read())));
    // It's tracked even if the reload fails: the next one shows it.
    if (error === null) await steps.reload().catch(() => undefined);
  } catch (e) {
    error = (e as Error).message || 'It couldn\'t be read or tracked.';
  }
  pending.settle(key, error);
  steps.changed?.();
  return error === null ? { ok: true } : { ok: false, error };
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

const endSentence = (text: string): string => text.trim().replace(/([^.!?…])$/, '$1.');

export type NoticeKind = 'waiting' | 'stopped' | 'review' | 'passed' | 'rework' | 'blocked' | 'ci-failed' | 'changes' | 'conflicts' | 'merged' | 'analysis-ready' | 'analysis-questions' | 'analysis-split' | 'analysis-back' | 'autopilot';

export interface TaskNotice {
  kind: NoticeKind;
  task: string;
  text: string;
  /** Needs a person: shown as a warning. The rest are news. */
  urgent: boolean;
  /** Its own buttons, before Show, for a notice whose buttons depend on more than its kind. */
  actions?: [label: string, command: string][];
  /** The autopilot step it tells, for an autopilot notice: Slack keys and words it from this (GH-58). */
  step?: AutopilotRecord;
}

/**
 * What a person would want to hear about, from how a project's tasks looked before and after a reload:
 * a builder finished, a review passed or asked for changes, an agent waits on its own prompt, a pull
 * request's checks failed, it conflicts with its base, it merged, or its analysis came back (D-052): ready,
 * with questions for you, or too big for one task. Only a task to do waits on its analysis: analyzed again
 * in review, rework or blocked, it's news, and its questions are answered with acc (D-059). A task seen
 * for the first time says nothing, so opening VSCode doesn't replay the board. A question waiting in the
 * Command Center has its own notice (D-030).
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
    // Autopilot sent it back for its failing checks (D-076), or a review asked for changes.
    else if (moved && t.state === 'rework' && t.checks?.length) say('rework', `Checks failed on GitHub for ${t.id}: ${t.checks.join(', ')}. It went back to its builder.`, true);
    else if (moved && t.state === 'rework') say('rework', `The review asked for changes on ${t.id}${t.review?.summary ? `: ${t.review.summary}` : '.'}`, true);
    else if (moved && t.state === 'blocked') say('blocked', `${t.id} is blocked: ${t.title}`, true);
    // Its builder stopped before acc done or acc block (D-067): what it last said, and Resume.
    if (t.stopped && !p.stopped && t.state === 'running') out.push({ kind: 'stopped', task: t.id, text: stoppedNotice(t.id, t.stopped.said), urgent: true, actions: [['Resume', 'acc.task.resume']] });
    else if (t.display === 'needs-you' && p.display !== 'needs-you' && t.state === 'running' && !t.asking && !t.stopped && !t.autopilot) say('waiting', `${t.id}'s agent is waiting for you in its own prompt.`, true);
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
      if (t.state !== 'todo') say('analysis-back', `${t.id}'s analysis is back.${a.open.length ? ` Its ${questionsWord(a.open.length)} can be answered with acc analysis answer.` : ''}`, false);
      else if (a.verdict === 'split') say('analysis-split', `${t.id}'s analysis says it's too big for one task.`, true);
      else if (a.open.length) say('analysis-questions', `${t.id}'s analysis has ${questionsWord(a.open.length)} for you.`, true);
      else say('analysis-ready', `${t.id}'s analysis is ready.`, false);
    }
  }
  return out;
}

/** The last thing a stopped agent said, on one line, short enough for a card or a notice. */
export function saidLine(said: string, max = 200): string {
  const one = said.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** "GH-41's agent stopped: API Error: Your computer went to sleep mid-response. …" (D-067). */
export const stoppedNotice = (id: string, said: string | null): string =>
  said ? `${id}'s agent stopped: ${endSentence(saidLine(said))}` : `${id}'s agent stopped before acc done or acc block.`;

/** The buttons a notice offers, as [label, command] pairs. The task's page is always the last. */
export function noticeActions(n: TaskNotice): [label: string, command: string][] {
  // Every notice can open its task, once: an action that already does, such as Review the update, is it.
  if (n.actions) return n.actions.some(([, c]) => c === 'acc.task.show') ? n.actions : [...n.actions, ['Show', 'acc.task.show']];
  const first: Partial<Record<NoticeKind, [string, string]>> = {
    waiting: ['Open in Claude Code', 'acc.task.openInClaude'],
    stopped: ['Resume', 'acc.task.resume'],
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

// ---------------------------------------------------------------- autopilot, hosted by the Command Center (D-064)

/** What a step autopilot couldn't take is called, as acc says it: "couldn't land GH-31", "couldn't send GH-31 back for its failing checks". */
const AUTOPILOT_VERB: Record<AutopilotStepName, [string, string]> = {
  review: ['review', ''], land: ['land', ''], dispatch: ['re-dispatch', ''], refresh: ['update', ' from its base'], resume: ['resume', ''], checks: ['send', ' back for its failing checks'],
};

/** What autopilot needs to know about a task to tell its steps: who it's tracked in, and its moves. */
export interface AutopilotTask {
  id: string;
  source: { kind: string; key: string | null };
  history: { at: string; from: string | null; to: string; actor: string; by: string }[];
}

/**
 * One notice for each step autopilot took that a window hasn't told yet (D-064): what it reviewed,
 * landed, re-dispatched, merged in or sent back for failing checks (D-076), and what it couldn't do, as a
 * warning. A land for a task with a ticket says its update is ready to review: autopilot posts nothing, a
 * person does (D-066).
 */
export function autopilotNotices(steps: AutopilotRecord[], tasks: AutopilotTask[]): TaskNotice[] {
  const out: TaskNotice[] = [];
  for (const r of steps) {
    const t = tasks.find((x) => x.id === r.task);
    const say = (text: string, urgent: boolean, actions: [string, string][] = []) => out.push({ kind: 'autopilot', task: r.task, text, urgent, actions, step: r });
    if (r.outcome === 'failed') {
      const by: Record<AutopilotStepName, [string, string]> = {
        review: ['Review', 'acc.task.review'], land: ['Land', 'acc.task.land'], dispatch: ['Re-dispatch', 'acc.task.dispatch'], refresh: ['Open pull request', 'acc.task.openPr'], resume: ['Resume', 'acc.task.resume'], checks: ['Open pull request', 'acc.task.openPr'],
      };
      const [verb, rest] = AUTOPILOT_VERB[r.step];
      say(`Autopilot couldn't ${verb} ${r.task}${rest}: ${endSentence(r.reason || 'it didn\'t say why')}`, true, [by[r.step]]);
    } else if (r.step === 'checks') {
      // Its pull request's checks failed on GitHub: back to its builder, which autopilot re-dispatches next (D-076).
      say(`Autopilot sent ${r.task} back to its builder: checks failed on GitHub${r.checks?.length ? `: ${r.checks.join(', ')}` : ''}.`, false, [['Open pull request', 'acc.task.openPr']]);
    } else if (r.step === 'review' && r.verdict === 'changes') {
      // Autopilot re-dispatches a review's rework once: a second one waits for a person. Its re-dispatch
      // after a send-back for failing checks isn't that one (D-076).
      const again = !!t && reworkedByAutopilot(t, r.at);
      const what = r.reason ? `: ${endSentence(r.reason)}` : '.';
      if (again) say(`Autopilot's review asked for changes on ${r.task} again${what} A second rework waits for you.`, true, [['Re-dispatch', 'acc.task.dispatch']]);
      else say(`Autopilot's review asked for changes on ${r.task}${what} Autopilot re-dispatches it next.`, false);
    } else if (r.step === 'review') say(`Autopilot reviewed ${r.task}: it passed. Autopilot lands it next.`, false);
    else if (r.step === 'land' && r.pr) {
      const pr: [string, string] = ['Open pull request', 'acc.task.openPr'];
      const ticket = !!t?.source.key && isTrackerKind(t.source.kind);
      const landed = r.pr.opened ? `Autopilot landed ${r.task}: pull request #${r.pr.number}` : `Autopilot updated pull request #${r.pr.number} (${r.task})`;
      if (ticket) say(`${landed}. Its update for the ticket is ready for you to review and post.`, false, [['Review the update', 'acc.task.show'], pr]);
      else say(r.pr.opened ? landed : `${landed}.`, false, [pr]);
    } else if (r.step === 'dispatch') say(r.cause === 'checks' ? `Autopilot re-dispatched ${r.task} for its failing checks.` : `Autopilot re-dispatched ${r.task} with its review's changes.`, false, [['Watch', 'acc.task.watch']]);
    // A builder that stopped, carried on once (D-067): what it last said.
    else if (r.step === 'resume') say(`Autopilot resumed ${r.task}${r.reason ? `: ${endSentence(saidLine(r.reason))}` : '.'}`, false, [['Watch', 'acc.task.watch']]);
    else if (r.step === 'refresh') {
      if (r.base) say(`Autopilot merged ${r.base} into ${r.task}, and its checks passed. It's reviewed next, then landed.`, false, [['Open pull request', 'acc.task.openPr']]);
      else say(`${r.pr ? `Pull request #${r.pr.number} (${r.task})` : r.task} no longer conflicts with its base: autopilot found nothing to merge.`, false);
    }
  }
  return out;
}

/**
 * D-044's notices that autopilot's own already told: "The review passed X" and "The review asked for
 * changes on X", for a task whose newest autopilot step is the review that said so, and its move to
 * rework when that step sent it back for failing checks (D-076). Autopilot lands or re-dispatches it
 * next, so a Land or Re-dispatch button would only race it.
 */
export function withoutAutopilotEcho(news: TaskNotice[], log: AutopilotRecord[]): TaskNotice[] {
  const newest = new Map<string, AutopilotRecord>();
  for (const r of log) if ((newest.get(r.task)?.seq ?? -1) < r.seq) newest.set(r.task, r);
  return news.filter((n) => {
    const r = newest.get(n.task);
    if (!r || r.outcome !== 'done') return true;
    if (r.step === 'checks') return n.kind !== 'rework';
    if (r.step !== 'review') return true;
    return !((n.kind === 'passed' && r.verdict === 'pass') || (n.kind === 'rework' && r.verdict === 'changes'));
  });
}

/** Where a repo's autopilot is, as its status bar item shows it. */
export type AutopilotSwitch = 'on' | 'off' | 'elsewhere' | 'refused';

export interface AutopilotStatusInput {
  project: string;
  /** More than one repo has autopilot: each item names its project. */
  many: boolean;
  state: AutopilotSwitch;
  /** The process holding autopilot's lock, when it runs elsewhere. */
  pid?: number | null;
  /** Why it can't run here, in acc's words. */
  refusal?: string | null;
  /** The last line it printed, while it's on here. */
  last?: string | null;
}

const AUTOPILOT_DOES = `it ${AUTOPILOT_REVIEW_DOES}. It never merges a pull request.`;

/**
 * The status bar's autopilot switch (D-064): an icon and the words "Autopilot: on" or "Autopilot: off",
 * with the project's name when there's more than one. The tooltip says what it does and what a click
 * does. Off until a person turns it on: the switch lasts until VSCode closes.
 */
export function autopilotStatus(s: AutopilotStatusInput): { text: string; tooltip: string } {
  const name = s.many ? ` · ${s.project}` : '';
  if (s.state === 'on') {
    return {
      text: `$(rocket) Autopilot: on${name}`,
      tooltip: [`Autopilot is on for ${s.project}: ${AUTOPILOT_DOES}`, s.last ? `Last: ${s.last}` : '', 'Click to turn it off until VSCode closes.'].filter(Boolean).join('\n\n'),
    };
  }
  if (s.state === 'elsewhere') {
    return {
      text: `$(rocket) Autopilot: on elsewhere${name}`,
      tooltip: `Autopilot is on for ${s.project} in another window or a terminal (pid ${s.pid ?? 'unknown'}): ${AUTOPILOT_DOES}\n\nStop it there to run it in this window.`,
    };
  }
  if (s.state === 'refused') return { text: `$(circle-slash) Autopilot: off${name}`, tooltip: `Autopilot can't run for ${s.project}: ${s.refusal ?? 'acc refused it.'}` };
  return { text: `$(debug-pause) Autopilot: off${name}`, tooltip: `Autopilot is off for ${s.project}. When it's on, ${AUTOPILOT_DOES}\n\nClick to turn it on until VSCode closes.` };
}

// ---------------------------------------------------------------- one status bar item (D-065)

export interface StatusParts {
  rows: Pick<TaskRow, 'id' | 'title' | 'display'>[];
  needsYou: number;
  /** A command acc runs for you that waits on an answer: its label. */
  asking: string | null;
  /** Commands acc runs for you, by label; autopilot's own isn't one. */
  running: string[];
  /** Setup is being checked right now. */
  checking: boolean;
  setup: { done: number; total: number; todo: number } | null;
  autopilot: { project: string; state: 'on' | 'off' | 'elsewhere' | 'refused' }[];
  /** The repo's GitHub account, and whether it's the right one. */
  account: { name: string; ok: boolean } | null;
}

const AUTOPILOT_WORDS = { on: 'on here', off: 'off', elsewhere: 'on in another window', refused: 'can\'t run' } as const;

/**
 * All of acc in one status bar item (D-065): what needs you first, else what's running and in review,
 * else setup left to do. A robot when autopilot is on here, and a spinner while acc is busy. The tooltip
 * says the rest; the item hides when there's nothing to say.
 */
export function combinedStatus(p: StatusParts): { text: string; tooltip: string[]; attention: boolean } {
  const tasks = statusSummary(p.rows, p.needsYou);
  const auto = p.autopilot.some((a) => a.state === 'on');
  const busy = p.checking || p.running.length > 0;
  let main = p.asking ? `$(bell) ${p.asking}: waiting for you` : tasks.text;
  if (!main && p.setup?.todo) main = `$(checklist) Setup: ${p.setup.todo} to do`;
  if (!main && busy) main = `$(sync~spin) ${p.running[0] ?? 'Checking setup'}`;
  else if (main && busy) main += ' $(sync~spin)';
  if (!main && auto) main = 'Autopilot on';
  const text = main ? `${auto ? '$(hubot) ' : ''}${main}` : '';
  const tooltip = [
    ...(tasks.tooltip ? tasks.tooltip.split('\n').filter((l) => l && !/^Open the Command Center$/.test(l)) : []),
    ...(p.asking ? [`$(bell) ${p.asking} is waiting for your answer`] : []),
    ...p.running.map((r) => `$(sync~spin) Running for you: ${r}`),
    ...p.autopilot.map((a) => `$(hubot) Autopilot ${AUTOPILOT_WORDS[a.state]}${p.autopilot.length > 1 ? `: ${a.project}` : ''}`),
    ...(p.setup ? [`$(checklist) Setup: ${p.setup.done} of ${p.setup.total} done${p.checking ? ', checking now' : ''}`] : p.checking ? ['$(sync~spin) Checking setup'] : []),
    ...(p.account ? [`${p.account.ok ? '$(github)' : '$(warning)'} GitHub: ${p.account.name}${p.account.ok ? '' : ', the wrong account'}`] : []),
  ];
  return { text, tooltip, attention: !!p.asking || p.needsYou > 0 || (p.account ? !p.account.ok : false) };
}

