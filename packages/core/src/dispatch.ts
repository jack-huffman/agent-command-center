import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { type BuilderPlace, type Config, type Effort, type Environment, environmentByBranch } from './config.ts';
import { cloudChecks, cloudGuard, cloudNeeds, cloudText, type Fired, fireRoutine, readCloudToken } from './cloud.ts';
import { environmentProtection, protectionWarnings } from './protection.ts';
import { PUSH_TIMEOUT_MS } from './land.ts';
import { fetchBranches } from './sync.ts';
import { readList } from './gates.ts';
import { inShell } from './shell.ts';
import { startFor, startSync } from './start.ts';
import { sleep } from './lock.ts';
import { AccError, type Runner } from './exec.ts';
import { type Actor, applyMove, checkMove, type FileShare, mutate, noGateHooks, type NotStarted, readLedger, reworkCause, type ReworkCause, type Task } from './ledger.ts';
import { mainCheckout, type RepoPaths, samePath } from './paths.ts';
import { analysisProblems, readAnalysis } from './analyze.ts';
import { plannedFiles, startLook, waits } from './overlap.ts';
import { readChecksReport, readQueueReport } from './checks.ts';
import { latestVerdict } from './review.ts';
import { agentArgs, checkModelName, modelOf } from './agents.ts';
import { checkEffortPick, checkModelEffort, dispatchEffort, effortFixWords, type EffortPick } from './efforts.ts';
import { type AwakeDeps, holdAwake, keepAwakeFor } from './awake.ts';
import { sessionName } from './names.ts';
import { claimHeld, holdTask, releaseHeld, startingNow } from './holding.ts';
import { machineCapProblem, machineLoad } from './limits.ts';
import { builderSettings, renderPacket } from './packet.ts';
import { rulesText } from './rules.ts';
import { NO_STEPS, type Steps } from './steps.ts';
import { awaitStart, type FoundSession, NOT_STARTED, START_WAIT_MS, transcriptWrittenAt } from './started.ts';
import { claudeProjectsDir } from './transcript.ts';
import { teamForRun } from './team.ts';

// ---------------------------------------------------------------- names and places (D-013)

/** A short branch-safe slug from a title: "Fix the Account layout!" → "fix-the-account-layout". */
export function slugify(title: string, max = 40): string {
  const words = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  let out = '';
  for (const w of words) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > max) break;
    out = next;
  }
  return out || 'task';
}

export const taskBranch = (task: Pick<Task, 'id' | 'title'>): string => `task/${task.id}-${slugify(task.title)}`;

/**
 * `worktrees.root` from the config, relative to the main checkout. The default is Claude Code's own
 * `.claude/worktrees/` inside the repo (D-022): a background agent started from the trusted main checkout
 * can enter a worktree there without a trust prompt, and Claude Code then enforces the isolation.
 */
export function worktreeRoot(config: Pick<Config, 'worktrees'>, main: string): string {
  const root = config.worktrees.root;
  if (!root) return join(main, '.claude', 'worktrees');
  return isAbsolute(root) ? root : resolve(main, root);
}

/** Whether a worktree is under the repo's `.claude/worktrees/`, where an agent can enter it without approval. */
export const isClaudeWorktree = (main: string, wt: string): boolean => wt.startsWith(join(main, '.claude', 'worktrees') + sep);

/** Claude Code's state file, where it records which folders you've trusted. Read only, never written. */
export function claudeStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(env.HOME || homedir(), '.claude.json');
}

/**
 * Whether Claude Code trusts this folder for background sessions: accepted once with \`claude\` there. On
 * Windows a folder has several spellings: git gives C:/Users/…, Node C:\Users\…, and Claude Code keys
 * ~/.claude.json by its own. So there both slashes are tried, and the drive letter and the rest compare
 * without case, as Windows compares paths (D-T-123).
 */
export function isTrusted(folder: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  let state: { projects?: Record<string, { hasTrustDialogAccepted?: boolean }> };
  try {
    state = JSON.parse(readFileSync(claudeStatePath(env), 'utf8'));
  } catch {
    return false;
  }
  const keys = new Set([folder, folder.normalize('NFC')]);
  try {
    keys.add(realpathSync(folder));
    if (platform === 'win32') keys.add(realpathSync.native(folder));
  } catch {
    // keep the raw path
  }
  const trusted = Object.entries(state.projects ?? {}).filter(([, p]) => p?.hasTrustDialogAccepted === true).map(([k]) => k);
  const same = platform === 'win32' ? windowsPathKey : (k: string) => k;
  const wanted = new Set([...keys].map(same));
  return trusted.some((k) => wanted.has(same(k)));
}

/** A Windows path as Windows compares them: one kind of slash, no trailing one, and no case. */
export const windowsPathKey = (path: string): string => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();

// ---------------------------------------------------------------- dispatch

export interface DispatchDeps {
  run: Runner;
  now: () => Date;
  /** The folder holding the acc executable, put on the builder's PATH. */
  accBinDir: string;
  env: NodeJS.ProcessEnv;
  /** How a shell runs this acc, for the builder's hooks. Without it, the builder asks in its own prompt. */
  accCommand?: string;
  /** For tests: how long to look for the new session in `claude agents --json`. */
  findSessionMs?: number;
  /** For tests: how the Mac is kept awake while the builder runs (D-067). */
  awake?: AwakeDeps;
  /** For tests: how long to wait for the builder to show it started (T-92). START_WAIT_MS by default. */
  startWaitMs?: number;
  /** For tests: Claude Code's projects folder, where the builder's conversation is saved. */
  projectsDir?: string;
  /** Where its steps are reported (T-65). */
  steps?: Steps;
}

export interface DispatchResult {
  held: false;
  task: Task;
  worktree: string;
  branch: string;
  reused: boolean;
  packetPath: string;
  bgId: string | null;
  sessionId: string | null;
  /** What the builder is called, in Claude Code and the Command Center (D-087). */
  name: string;
  /** The tasks in flight it shares files with, and those files, when it started anyway (D-093). */
  shares: FileShare[];
  /** Where the builder runs (GH-69): this Mac, or a cloud session, with its id and page. */
  where: BuilderPlace;
  cloud?: Fired;
  /** What a person should know but needn't act on now (GH-69): GitHub enforcing no protection on a branch the cloud builder could reach. */
  warnings?: string[];
  /**
   * Its builder never started (T-92): the task wasn't moved to Running, and needs a person. Why, and the
   * half-started background session acc stopped, if one was listed.
   */
  notStarted?: { reason: string; stopped: string | null };
}

/** A dispatch that waits for other tasks' files instead of starting (D-093). Nothing was created or launched. */
export interface HeldResult {
  held: true;
  task: Task;
  /** The tasks in flight whose files its plan shares, and those files. */
  waitsFor: FileShare[];
  /** The Ready tasks that share no files with work in flight, which start first. */
  first: string[];
}

/**
 * Either outcome, with the effort picked for the task before that the model picked now doesn't take, when
 * one was dropped for it (D-128): the builder's own applies instead.
 */
export type DispatchOutcome = (DispatchResult | HeldResult) & { effortDropped?: Effort };

const git = (run: Runner, cwd: string, ...args: string[]) => run('git', args, { cwd });

function ensureWorktree(run: Runner, main: string, wt: string, branch: string, env: Environment): boolean {
  if (existsSync(wt)) {
    const inside = git(run, wt, 'rev-parse', '--abbrev-ref', 'HEAD');
    if (inside.code !== 0) throw new AccError('dispatch', `${wt} exists but isn't a git worktree. Move it aside and dispatch again.`);
    if (inside.stdout.trim() !== branch) throw new AccError('dispatch', `${wt} is on ${inside.stdout.trim()}, not ${branch}.`);
    return true;
  }
  mkdirSync(dirname(wt), { recursive: true });
  git(run, main, 'fetch', '--quiet', 'origin', env.branch);
  const hasLocal = git(run, main, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).code === 0;
  let r;
  if (hasLocal) r = git(run, main, 'worktree', 'add', wt, branch);
  else {
    const remote = `refs/remotes/origin/${env.branch}`;
    const base = git(run, main, 'rev-parse', '--verify', '--quiet', remote).code === 0 ? `origin/${env.branch}` : env.branch;
    if (git(run, main, 'rev-parse', '--verify', '--quiet', base).code !== 0) throw new AccError('dispatch', `There's no "${env.branch}" branch to start from.`);
    r = git(run, main, 'worktree', 'add', '--no-track', '-b', branch, wt, base);
  }
  if (r.code !== 0) throw new AccError('dispatch', `git couldn't create the worktree: ${r.stderr.trim()}`);
  return false;
}

/** A worktree's setup: the org it targets, the main checkout's node_modules, and the project's setup commands. A verification's too (T-84). */
export function setupWorktree(run: Runner, config: Config, env: Environment, main: string, wt: string): void {
  if (config.profile === 'salesforce' && env.org) {
    mkdirSync(join(wt, '.sf'), { recursive: true });
    writeFileSync(join(wt, '.sf', 'config.json'), JSON.stringify({ 'target-org': env.org }, null, 2) + '\n');
  }
  if (existsSync(join(main, 'node_modules')) && !existsSync(join(wt, 'node_modules'))) {
    symlinkSync(join(main, 'node_modules'), join(wt, 'node_modules'), 'dir');
    excludeEverywhere(run, main, 'node_modules');
  }
  for (const cmd of config.worktrees.setup) {
    const r = run(...inShell(cmd), { cwd: wt });
    if (r.code !== 0) throw new AccError('dispatch', `Setup command failed in the worktree: ${cmd}\n${(r.stderr || r.stdout).trim()}`);
  }
}

/**
 * Adds a pattern to the repo's shared exclude file, which every worktree reads. A linked node_modules
 * is a symlink, which a "node_modules/" ignore rule (folders only) doesn't match.
 */
function excludeEverywhere(run: Runner, main: string, pattern: string): void {
  const common = run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: main }).stdout.trim();
  if (!common) return;
  const file = join(common, 'info', 'exclude');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (text.split('\n').some((l) => l.trim() === pattern)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}# Added by acc: worktrees link node_modules from the main checkout.\n${pattern}\n`);
}

export interface FindSessionOptions {
  /** Started at this time or later, in ms: an older session of the same name is another run's. */
  since?: number;
  /** In one of these folders: the one it was started in, or the worktree it may already have entered. */
  places?: string[];
}

/**
 * The new background session, with its process, found in `claude agents --json` by the name it was given,
 * the folder it started in and when (D-087). `--bg` makes its own session id and ignores `--session-id`,
 * so the name is all acc has to go on, and two clones of a repo name a task's builder alike. A session
 * can be listed a moment before its process is, so it's asked again, within the same wait, until the pid
 * shows: without it nothing keeps the Mac awake for the builder (D-067).
 */
export function findSession(run: Runner, cwd: string, name: string, waitMs: number, o: FindSessionOptions = {}): FoundSession {
  const until = Date.now() + waitMs;
  let found: FoundSession | null = null;
  const ours = (x: { name?: string; cwd?: string; kind?: string; startedAt?: number }): boolean =>
    x.name === name && x.kind === 'background'
    && (o.since === undefined || (x.startedAt !== undefined && x.startedAt >= o.since))
    && (!o.places || !x.cwd || o.places.some((p) => samePath(x.cwd!, p)));
  do {
    const r = run('claude', ['agents', '--json'], { cwd, timeoutMs: 20_000 });
    try {
      const list = JSON.parse(r.stdout) as { id?: string; sessionId?: string; name?: string; cwd?: string; kind?: string; startedAt?: number; pid?: number }[];
      const s = list.filter(ours).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
      if (s) {
        found = { bgId: s.id ?? null, sessionId: s.sessionId ?? null, pid: Number.isInteger(s.pid) && s.pid! > 0 ? s.pid! : null };
        if (found.pid) return found;
      }
    } catch {
      // not JSON yet; try again
    }
    if (Date.now() < until) sleep(500);
  } while (Date.now() < until);
  return found ?? { bgId: null, sessionId: null, pid: null };
}

/** How long before acc launches a builder its session may say it started: the same clock, read a moment apart. */
const LAUNCH_SLACK_MS = 5_000;

export interface DispatchOptions {
  actor: Actor;
  by: string;
  /** Run the session in this terminal instead of in the background (D-009's fallback). */
  foreground?: boolean;
  /** A person's say-so to build without the analysis the project wants (D-052). */
  withoutAnalysis?: boolean;
  /** What autopilot re-dispatches a rework for, kept on its move so it's never guessed from words (D-076, GH-73). */
  cause?: ReworkCause;
  /** A person's say-so to start it now, though it shares files with work in flight (D-093). */
  anyway?: boolean;
  /** A held task's start, by startHeld: what it shares with work in flight was weighed already. */
  fromHold?: { shares: FileShare[] };
  /** The model a person picked for this task's builder, kept on its run for a re-dispatch and a resume (D-086). */
  model?: string;
  /** The effort a person picked for this task's builder, kept on its run as the model is (D-128): `default` drops an earlier pick. */
  effort?: EffortPick;
  /** Where the builder runs (GH-69): --cloud or --local. Left out, the project's agents.cloud.default, else local. */
  where?: BuilderPlace;
  /** Why it's dispatched, kept on its move in History: Dispatch again's reason (T-92). */
  reason?: string;
}

/** Where a task's builder goes (GH-69): the flag, else the project's choice, else this Mac. No config, or none for agents, is this Mac too. */
export function builderPlace(config: { agents?: { cloud?: { default?: BuilderPlace } | null } | null } | null | undefined, chosen?: BuilderPlace): BuilderPlace {
  return chosen ?? config?.agents?.cloud?.default ?? 'local';
}

/**
 * The model a task's builder starts with (D-086): one picked for it now, else one picked on an earlier
 * dispatch, else the builder's own (the clone's, the project's, or acc's default). `picked` says it was a
 * person's choice for this task, so the run keeps it.
 */
export function builderModel(task: Pick<Task, 'run'>, config: Config, chosen?: string): { model: string; picked: boolean } {
  const picked = chosen ?? (task.run?.modelPicked ? task.run.model : undefined);
  return picked ? { model: picked, picked: true } : { model: modelOf(config.agents.builder), picked: false };
}

/**
 * Dispatches a task: a worktree, its setup, the instructions, and a background builder session. A first
 * dispatch whose analysis shares files with work in flight waits while another Ready task shares none
 * (D-093): it's held, and nothing is created or launched. A person can start it anyway.
 */
export function dispatch(paths: RepoPaths, config: Config, id: string, deps: DispatchDeps, opts: DispatchOptions): DispatchOutcome {
  const { run, now } = deps;
  // Its steps (T-65). A step that throws is left open, and acc's result fails it with the error's words.
  const steps = deps.steps ?? NO_STEPS;
  steps.start('task', 'Check the task');
  if (opts.model !== undefined) checkModelName(opts.model);
  if (opts.effort !== undefined) checkEffortPick(opts.effort);
  const before = readLedger(paths.ledger);
  const found = before.tasks.find((t) => t.id === id);
  if (!found) throw new AccError('no-task', `No task ${id}.`);
  // The builder's model and effort (D-036): the model and effort picked for this task, if they were (D-086,
  // D-128), when it was dispatched or when it began to wait for others' files (D-093). A model picked now
  // drops an earlier picked effort it doesn't take. On every dispatch, a level the model doesn't take is
  // refused before anything starts, wherever either is set: a clone's model may have changed since.
  const { model, picked } = builderModel(found, config, opts.model ?? found.held?.model);
  const { effort, picked: effortPicked, keep, dropped } = dispatchEffort(found, config, model, { effort: opts.effort, modelPicked: opts.model !== undefined });
  checkModelEffort(model, effort, effortFixWords(id, effortPicked, model));
  const effortDropped = dropped ? { effortDropped: dropped } : {};
  // Where it runs (GH-69): the cloud only where the project opted in and everything it needs is there.
  const where = builderPlace(config, opts.where);
  if (where === 'cloud' && opts.foreground) throw new AccError('usage', '--cloud starts the builder in a cloud session, so it can\'t run in this terminal: give --cloud or --foreground, not both.');
  if (where === 'cloud') {
    const unmet = cloudNeeds(config, run, deps.env).filter((n) => !n.ok);
    if (unmet.length) throw new AccError('cloud-unavailable', `Can't dispatch ${id} to the cloud:\n- ${unmet.map((n) => `${n.label}: ${n.fix}`).join('\n- ')}`);
  }
  const req = { to: 'running' as const, actor: opts.actor, by: opts.by, where };
  // Beside the project's cap, this machine's total across every repo (GH-111), which no one ledger knows.
  // A cloud builder uses none of this Mac, so the machine's total never refuses it (GH-69).
  const machine = where === 'cloud' ? null : machineLoad(paths, config.project, deps.env);
  const overMachine = (l: typeof before) => { const p = machineCapProblem(l, id, machine); return p ? [p] : []; };
  const problems = [...checkMove(before, config, found, req, noGateHooks), ...overMachine(before)];
  if (problems.length) throw new AccError('move-refused', `Can't dispatch ${id}:\n- ${problems.join('\n- ')}`);
  // A project that wants an analysis first gets one, unless a person says to go without (D-052).
  const held = analysisProblems(paths, config, found);
  if (held.length && !(opts.withoutAnalysis && opts.actor === 'human')) throw new AccError('move-refused', `Can't dispatch ${id}:\n- ${held.join('\n- ')}`);
  const starting = opts.fromHold ? null : startingNow(found, now());
  if (starting) throw new AccError('move-refused', `Can't dispatch ${id}: ${starting.by} is starting it.`);
  steps.done('task');
  // Only a first dispatch weighs the files: a rework's branch already holds its change (D-093). A task
  // whose analysis names no files never waits, so nothing in flight is looked at for it.
  let shares = opts.fromHold?.shares ?? [];
  let overrode = false;
  const planned = found.state === 'todo' && !opts.fromHold ? plannedFiles(readAnalysis(paths, id), paths.root) : null;
  const filesLabel = 'Check the files in flight';
  if (planned) {
    steps.start('files', filesLabel);
    const look = startLook(paths, config, before, run, id, { fetch: true, files: planned });
    shares = look.shares;
    if (waits(look)) {
      if (!(opts.anyway && opts.actor === 'human')) {
        const held = holdTask(paths, now, id, { ...opts, effort: keep }, look);
        steps.done('files', `It waits for ${held.waitsFor.map((w) => w.task).join(', ')}`);
        return { ...held, ...effortDropped };
      }
      overrode = true;
    }
    steps.done('files', overrode ? 'Started anyway, by a person' : shares.length ? `It shares files with ${[...new Set(shares.map((s) => s.task))].join(', ')}` : undefined);
  } else {
    steps.skip('files', filesLabel, opts.fromHold ? 'Weighed when it began to wait' : found.state !== 'todo' ? 'Its branch already holds its change' : 'Its analysis names no files');
  }
  // A held task a person dispatches is claimed first, as a held start claims it, so the two never both
  // launch (D-093). One whose start failed needs a person, and this is one: nothing else starts it.
  const claim = !opts.fromHold && !!found.held && !found.held.failed;
  if (claim && !claimHeld(paths, now, id, opts)) throw new AccError('move-refused', `Can't dispatch ${id}: it's being started already.`);
  try {
    steps.start('worktree', 'Make the worktree');
    const env = environmentByBranch(config, found.environment);
    if (!env) throw new AccError('dispatch', `${id}'s environment "${found.environment}" isn't in the config.`);

    const main = mainCheckout(run, paths.root);
    const wt = join(worktreeRoot(config, main), found.id);
    const enter = isClaudeWorktree(main, wt);
    // Background sessions need a trusted folder (D-022): the main checkout when entering a .claude worktree.
    const launchDir = enter ? main : wt;
    if (where === 'local' && !opts.foreground && enter && !isTrusted(main, deps.env)) {
      throw new AccError('not-trusted', `Claude Code doesn't trust ${main} yet, so it won't start a background agent there. Run \`claude\` once in that folder, accept the trust prompt, then type /exit and dispatch again.`);
    }
    const branch = found.run?.branch ?? taskBranch(found);
    const reused = ensureWorktree(run, main, wt, branch, env);
    steps.done('worktree', reused ? `Reused ${basename(wt)}` : basename(wt));
    steps.step('setup', 'Set up the worktree', () => setupWorktree(run, config, env, main, wt));

    steps.start('packet', 'Write the builder\'s instructions');
    // The worktree's own copies only (GH-108): a source elsewhere is never read here.
    const rules = rulesText(wt, config.profile);
    const rework = found.state === 'rework';
    // Sent back for failing checks on GitHub (D-076), or from the merge queue (GH-73): what they found about
    // the branch's latest commit.
    const cause = rework ? reworkCause(found) : null;
    // Read on every rework, so a person's send-back can match it against the passed review (T-76).
    const head = rework ? git(run, paths.root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).stdout.trim() : '';
    // Its team as of now (T-103), with its branch where this run works.
    const team = teamForRun(paths, config, before, run, found.id, branch, wt);
    const packet = renderPacket({
      task: found, config, env, worktree: wt, branch, rules, environmentSpecific: readList(wt, config.environmentSpecific), enterWorktree: where === 'local' && enter && !opts.foreground, cloud: where === 'cloud',
      // The Mac's acc path names the home folder, and means nothing in the cloud (GH-69): only a local builder gets it.
      ...(where === 'local' ? { accPath: join(deps.accBinDir, 'acc') } : {}), review: rework ? latestVerdict(paths, found.id) : null, head: head || undefined, analysis: readAnalysis(paths, found.id),
      // Only for these two causes: a review's or a person's rework at the same commit has its own reasons, which the report would contradict.
      checks: head && cause === 'checks' ? readChecksReport(paths, found.id, head) : null,
      queue: head && cause === 'queue' ? readQueueReport(paths, found.id, head) : null,
      // The notes the tasks it builds on left (D-106).
      deps: found.deps.flatMap((d) => before.tasks.filter((t) => t.id === d)),
      team,
    });
    mkdirSync(paths.packets, { recursive: true });
    const packetPath = join(paths.packets, `${found.id}.md`);
    writeFileSync(packetPath, packet);
    steps.done('packet');

    const settings = JSON.stringify(builderSettings(found, config, deps.accBinDir, deps.env.PATH ?? '', deps.accCommand));
    const prompt = `Read your task instructions below and do the task.\n\n${packet}`;
    // Named for its project, task and role (D-087). The task's second dispatch is its "builder 2"; a run
    // from before dispatches were counted was its first.
    const n = (found.run?.n ?? (found.run ? 1 : 0)) + 1;
    const name = sessionName({ project: config.project, key: found.id, title: found.title, role: 'builder', n });
    const base = ['--name', name, '--permission-mode', config.agents.permissionMode, ...agentArgs({ ...config.agents.builder, model, effort }), '--settings', settings];

    const record = (bgId: string | null, sessionId: string | null, cloud: (Fired & { head: string }) | null = null) => steps.step('record', 'Record the run', () => mutate(paths, now, (ledger, emit) => {
      const task = ledger.tasks.find((t) => t.id === id)!;
      const again = [...checkMove(ledger, config, task, req, noGateHooks), ...overMachine(ledger)];
      if (again.length) throw new AccError('move-refused', `Can't dispatch ${id}:\n- ${again.join('\n- ')}`);
      // What it shares with work in flight, and whether a person overrode a wait or it waited for it (D-093).
      const hold = task.held;
      const data = {
        ...(opts.cause ? { cause: opts.cause } : {}),
        ...(shares.length ? { shares } : {}),
        ...(overrode ? { anyway: true } : {}),
        ...(opts.fromHold && hold ? { held: { at: hold.at, by: hold.by, waitedFor: hold.waitsFor.map((w) => w.task) } } : {}),
      };
      applyMove(task, { ...req, reason: opts.reason ?? (reused ? `re-dispatched in ${basename(wt)}` : null) }, emit, now, data);
      // The last run's note, or that it left none (D-106): the run it was is replaced here.
      const last = task.run ? { before: task.run.note ?? null } : {};
      const at = now().toISOString();
      // A cloud run says so, with its session and where its branch stood when the routine was fired (GH-69).
      const place = cloud ? { where: 'cloud' as const, cloud: { sessionId: cloud.sessionId, url: cloud.url, firedAt: at, head: cloud.head, lastPushAt: at } } : {};
      task.run = { worktree: wt, branch, startedAt: at, model, ...(picked ? { modelPicked: true as const } : {}), ...(effort ? { effort } : {}), ...(effortPicked ? { effortPicked: true as const } : {}), ...(bgId ? { bgId } : {}), ...(sessionId ? { sessionId } : {}), name, n, ...(shares.length ? { shares } : {}), ...place, ...last };
      emit({ type: 'task.updated', task: id, actor: opts.actor, by: opts.by, data: { run: task.run } });
      return task;
    }));

    if (where === 'cloud') {
      steps.start('guard', 'Check the push guard');
      // The guard must be in the trees the cloud session loads its hooks from (GH-69): the branch its clone
      // starts on, the repo's default branch on origin, and the task branch it then checks out. Read from
      // the commits, never the files on disk: an uncommitted guard never reaches the cloud.
      const gitEnv = { ...deps.env, GIT_TERMINAL_PROMPT: '0' };
      const guard = cloudGuard(run, main, env.branch, branch, gitEnv);
      if (guard.why) throw new AccError('cloud-unguarded', `Can't dispatch ${id} to the cloud: the push guard isn't committed where the cloud session would load it. ${guard.why} The worktree is kept at ${wt}, and nothing was pushed or started.`);
      const base = guard.base;
      // GitHub's rules are the line behind the guard: where it enforces none, say so, and go on (a person decided).
      const warnings = protectionWarnings(environmentProtection(run, config.github!.repo, config.github!.account, [...new Set([base, env.branch])], deps.env));
      steps.done('guard', warnings.length ? `${warnings.length} warning(s) about GitHub's rules` : undefined);
      // The branch goes to GitHub first (GH-69): the cloud session clones from there, so nothing depends on
      // this Mac. Only the task's branch, as the repo's account, and never an environment's.
      steps.start('push', 'Push the branch');
      const push = run('git', ['push', '--set-upstream', 'origin', `${branch}:${branch}`], { cwd: main, env: gitEnv, timeoutMs: PUSH_TIMEOUT_MS });
      if (push.code !== 0) throw new AccError('dispatch', `git push refused ${branch}: ${(push.stderr || push.stdout).trim().split('\n').slice(-2).join(' ')}. The worktree is kept at ${wt}, and nothing was started.`);
      steps.done('push');
      const head = git(run, main, 'rev-parse', `refs/heads/${branch}`).stdout.trim();
      const text = cloudText({ task: found, config, env, branch, packet, checks: cloudChecks(config, env) });
      const fired = steps.step('start', 'Start the cloud session', () => fireRoutine(paths, run, config.agents.cloud!.routine!, readCloudToken(run, config.github!.repo, deps.env)!, text, deps.env));
      // No caffeinate (D-067): nothing runs on this Mac. The fire counts as the branch's first move.
      const task = record(null, null, { ...fired, head });
      return { held: false, task, worktree: wt, branch, reused, packetPath, bgId: null, sessionId: null, name, shares, where, cloud: fired, ...(warnings.length ? { warnings } : {}), ...effortDropped };
    }

    if (opts.foreground) {
      // Started as every system needs it (startSync); one Windows can't start is refused before the task is recorded as running.
      const start = startFor('claude', [...base, prompt], deps.env);
      if ('problem' in start) throw new AccError('dispatch', `${start.problem} The worktree is kept at ${wt}.`);
      const task = record(null, null);
      // The session is this terminal's, so the Mac stays awake while acc waits on it (D-067).
      const awake = holdAwake(process.pid, deps.awake);
      steps.start('start', 'Run the builder in this terminal');
      try {
        startSync('claude', [...base, prompt], { cwd: wt, stdio: 'inherit', env: deps.env });
      } finally {
        awake?.release();
      }
      steps.done('start');
      return { held: false, task, worktree: wt, branch, reused, packetPath, bgId: null, sessionId: null, name, shares, where, ...effortDropped };
    }

    const since = Date.now() - LAUNCH_SLACK_MS;
    steps.start('start', 'Start the builder');
    const launched = run('claude', ['--bg', ...base, prompt], { cwd: launchDir, env: deps.env, timeoutMs: 60_000 });
    if (launched.code !== 0) throw new AccError('dispatch', `Claude Code didn't start the agent: ${(launched.stderr || launched.stdout).trim().split('\n')[0]}. The worktree is kept at ${wt}.`);
    const places = { since, places: [launchDir, wt] };
    const first = findSession(run, launchDir, name, deps.findSessionMs ?? 8_000, places);
    // It proves it started (T-92): listed with a process, or its conversation written. Else Claude Code's
    // background sessions aren't answering, and nothing works on the task.
    const projectsDir = deps.projectsDir ?? claudeProjectsDir(deps.env);
    const { bgId, sessionId, pid, started } = awaitStart(first, () => findSession(run, launchDir, name, 0, places),
      () => transcriptWrittenAt(projectsDir, { worktree: wt, sessionId: first.sessionId, since }) !== null, deps.startWaitMs ?? START_WAIT_MS);
    if (!started) {
      steps.fail('start', `${NOT_STARTED}.`);
      // A half-started session is stopped, so it never starts late beside the next dispatch.
      const stopped = bgId && run('claude', ['stop', bgId], { cwd: wt, timeoutMs: 20_000 }).code === 0 ? bgId : null;
      const task = notStartedOn(paths, now, id, opts, { where, model: picked ? model : undefined, effort: effortPicked && effort ? effort : undefined });
      return { held: false, task, worktree: wt, branch, reused, packetPath, bgId: null, sessionId: null, name, shares, where, notStarted: { reason: NOT_STARTED, stopped }, ...effortDropped };
    }
    steps.done('start', bgId ? `Background session ${bgId}` : 'Its conversation was written');
    try {
      const task = record(bgId, sessionId);
      // acc exits now, so the Mac is kept awake for the background session's own process (D-067).
      if (pid) keepAwakeFor(paths, id, pid, deps.awake);
      return { held: false, task, worktree: wt, branch, reused, packetPath, bgId, sessionId, name, shares, where, ...effortDropped };
    } catch (e) {
      if (bgId) run('claude', ['stop', bgId], { cwd: wt });
      throw e;
    }
  } catch (e) {
    if (claim) releaseHeld(paths, now, id, opts, null);
    throw e;
  }
}

/** Writes on the task that its builder didn't start (T-92), with what it was dispatched with: it needs a person. Its hold ends. */
function notStartedOn(paths: RepoPaths, now: () => Date, id: string, opts: DispatchOptions, with_: Pick<NotStarted, 'where' | 'model' | 'effort'>): Task {
  return mutate(paths, now, (ledger, emit) => {
    const task = ledger.tasks.find((t) => t.id === id)!;
    const at = now().toISOString();
    task.notStarted = { at, by: opts.by, reason: NOT_STARTED, where: with_.where, ...(with_.model ? { model: with_.model } : {}), ...(with_.effort ? { effort: with_.effort } : {}) };
    task.held = null;
    task.updatedAt = at;
    emit({ type: 'task.updated', task: id, actor: opts.actor, by: opts.by, data: { notStarted: task.notStarted } });
    return task;
  });
}

// ---------------------------------------------------------------- cleanup (D-013)

export interface CleanupResult {
  removed: boolean;
  reasons: string[];
  worktree: string | null;
}

/** Removes a task's worktree and local branch, but only when nothing would be lost. */
export function cleanup(paths: RepoPaths, config: Config, id: string, run: Runner, now: () => Date): CleanupResult {
  const ledger = readLedger(paths.ledger);
  const task = ledger.tasks.find((t) => t.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  const wt = task.run?.worktree ?? null;
  if (!wt || !existsSync(wt)) return { removed: false, reasons: ['It has no worktree on disk.'], worktree: wt };
  const reasons: string[] = [];
  if (task.state === 'running') reasons.push(`${id} is still running. Abandon it or let it finish first.`);
  const dirty = git(run, wt, 'status', '--porcelain').stdout.trim();
  if (dirty) reasons.push(`The worktree has ${dirty.split('\n').length} uncommitted change(s).`);
  const env = environmentByBranch(config, task.environment);
  const branch = task.run?.branch;
  if (branch && env) {
    const main = mainCheckout(run, paths.root);
    git(run, main, 'fetch', '--quiet', 'origin', env.branch);
    const target = git(run, main, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${env.branch}`).code === 0 ? `origin/${env.branch}` : env.branch;
    const ahead = Number(git(run, main, 'rev-list', '--count', `${target}..${branch}`).stdout.trim() || '0');
    const merged = git(run, main, 'merge-base', '--is-ancestor', branch, target).code === 0;
    if (ahead > 0 && !merged) reasons.push(`${branch} has ${ahead} commit(s) that aren't in ${target} yet.`);
  }
  if (reasons.length) return { removed: false, reasons, worktree: wt };
  const main = mainCheckout(run, paths.root);
  const r = git(run, main, 'worktree', 'remove', wt);
  if (r.code !== 0) return { removed: false, reasons: [`git refused: ${r.stderr.trim()}`], worktree: wt };
  if (branch) git(run, main, 'branch', '-D', branch); // safe: checked above that nothing would be lost
  mutate(paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === id)!;
    if (t.run) delete t.run.worktree;
    emit({ type: 'task.updated', task: id, actor: 'human', by: 'acc cleanup', data: { worktreeRemoved: wt } });
  });
  return { removed: true, reasons: [], worktree: wt };
}
