/**
 * Cloud builders (GH-69): a task's builder as a Claude Code cloud session, started by firing the project's
 * routine, followed through its branch on GitHub, and collected into the task's worktree when its finish
 * marker lands. An option a project opts in to, never the default: a local builder stays the default
 * everywhere, and a project that hasn't opted in sees none of this.
 *
 * What Claude Code allows, as read on 2026-10-09 (D-140): a script starts a cloud session only by firing a
 * routine's API trigger, whose token a person makes at claude.ai/code/routines; nothing lists cloud
 * sessions or their state; a message can be sent with `claude -p "<msg>" --cloud <session>`; the session's
 * work comes back only as pushes to GitHub.
 */
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BuilderPlace, BUILDER_PLACES, CLOUD_MAX, CLOUD_QUIET_MINUTES, type CloudAgents, type Config, type Environment, environmentByBranch, requiredGates, ROUTINE_ID } from './config.ts';
import { writeJsonKey } from './config-edit.ts';
import { guardCommitted, RECORD_LINE, ROLE_LINE } from './cloud-guard.ts';
import { AccError, parseJsonOutput, type Runner } from './exec.ts';
import { type GateResult, priorTests, runGates } from './gates.ts';
import { type Actor, applyMove, checkMove, type CloudRun, mutate, type NoteInput, noteInput, readLedger, type Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { receiptHooks, satisfies } from './receipts.ts';
import type { SlotOptions } from './semaphore.ts';
import { FETCH_TIMEOUT_MS, fetchBranches } from './fetch.ts';

// ---------------------------------------------------------------- where a builder runs

/** How each place shows (GH-69): an icon and a label, as every state has (CLAUDE.md). */
export const BUILDER_PLACE_LOOK: Record<BuilderPlace, { label: string; icon: string }> = {
  local: { label: 'This Mac', icon: 'device-desktop' },
  cloud: { label: 'Cloud', icon: 'cloud' },
};

// ---------------------------------------------------------------- what the cloud needs

/** One thing cloud builders need (GH-69), checked without running anything: the config and the repo. */
export interface CloudNeed {
  id: 'github' | 'opted-in' | 'routine' | 'token' | 'login';
  label: string;
  ok: boolean;
  /** What to do about it, when it isn't met. */
  fix: string;
}

export const ROUTINES_URL = 'https://claude.ai/code/routines';

/**
 * What a project needs before a task can go to the cloud, from its config alone: the repo on GitHub, the
 * opt-in, and the routine. The token and the login are checked with commands (cloudNeeds), so the Command
 * Center can say what's missing from its own data, and a dispatch checks the rest before it pushes anything.
 */
/** As much of a config as the needs read: the Command Center's rows carry no more. */
export interface CloudConfigLike {
  github: { repo: string } | null;
  agents: { cloud: CloudAgents | null };
}

export function cloudOffered(config: CloudConfigLike): CloudNeed[] {
  const cloud = config.agents.cloud;
  return [
    { id: 'github', label: 'The repo is on GitHub', ok: !!config.github, fix: 'Cloud builders need the repo on GitHub: a cloud session clones it from there and pushes its branch back. Add the "github" section to .acc/config.json.' },
    { id: 'opted-in', label: 'The project has opted in', ok: !!cloud, fix: 'Cloud builders are off until a person opts the project in: acc cloud enable, or Settings\' Cloud builders switch.' },
    { id: 'routine', label: 'A routine for the repo', ok: !!cloud?.routine, fix: `Make a routine for the repo at ${ROUTINES_URL}, with an API trigger, and give acc its trigger id: acc cloud enable --routine trig_….` },
  ];
}

/** Why cloud builders aren't offered, from the first unmet need, or null when they are. */
export function cloudReason(needs: CloudNeed[]): string | null {
  const first = needs.find((n) => !n.ok);
  if (!first) return null;
  if (first.id === 'github') return 'Cloud builders need the repo on GitHub';
  if (first.id === 'opted-in') return 'Cloud builders are off for this project: opt in under Settings';
  if (first.id === 'routine') return 'Cloud builders need a routine for the repo: Setup says how';
  if (first.id === 'token') return 'Cloud builders need the routine\'s token: Setup says how';
  return 'Cloud builders need a claude.ai sign-in: claude auth login';
}

/**
 * Every need, the config's and the machine's (GH-69): the routine's token in this Mac's keychain, and the
 * Claude Code CLI signed in to a claude.ai account, which `claude -p --cloud` needs to send a message.
 */
export function cloudNeeds(config: CloudConfigLike, run: Runner, env: NodeJS.ProcessEnv): CloudNeed[] {
  const needs = cloudOffered(config);
  const repo = config.github?.repo ?? '';
  const token = repo ? readCloudToken(run, repo, env) : null;
  needs.push({ id: 'token', label: 'The routine\'s token is in this Mac\'s keychain', ok: !!token, fix: 'Generate the API trigger\'s token on the routine\'s page, then keep it in the keychain: acc cloud token. It\'s never written to .acc/config.json or git.' });
  const login = claudeLogin(run, env);
  needs.push({ id: 'login', label: 'Claude Code is signed in to claude.ai', ok: login.ok, fix: login.ok ? '' : `${login.why} Run: claude auth login` });
  return needs;
}

/** Whether `claude` is signed in with a claude.ai account, as cloud sessions need: `claude auth status` says. */
export function claudeLogin(run: Runner, env: NodeJS.ProcessEnv): { ok: boolean; why: string; email?: string } {
  const r = run('claude', ['auth', 'status'], { env, timeoutMs: 20_000 });
  if (r.code === 127) return { ok: false, why: 'The Claude Code CLI (claude) isn\'t on PATH.' };
  try {
    const s = parseJsonOutput<{ loggedIn?: boolean; authMethod?: string; email?: string }>(r.stdout);
    if (!s.loggedIn) return { ok: false, why: 'Claude Code isn\'t signed in.' };
    if (s.authMethod !== 'claude.ai') return { ok: false, why: `Claude Code is signed in with ${s.authMethod ?? 'something other than a claude.ai account'}, and cloud sessions need a claude.ai account.` };
    return { ok: true, why: '', ...(s.email ? { email: s.email } : {}) };
  } catch {
    return { ok: false, why: 'claude auth status didn\'t answer.' };
  }
}

// ---------------------------------------------------------------- the token, in the keychain

/** The keychain item the routine's token is kept in, by repo: never in .acc/config.json or git (GH-69). */
const CLOUD_TOKEN_SERVICE = 'acc-cloud-routine';
/** For tests and CI: a token given in the environment stands in for the keychain's. */
export const CLOUD_TOKEN_ENV = 'ACC_CLOUD_TOKEN';
/** A routine's API token, as claude.ai shows it: a bearer token, letters, digits, dashes and underscores. */
export const CLOUD_TOKEN = /^[A-Za-z0-9_-]{20,}$/;

/** The routine's token for a repo: the environment's, else the macOS keychain's. Null when there's none. */
export function readCloudToken(run: Runner, repo: string, env: NodeJS.ProcessEnv): string | null {
  const given = env[CLOUD_TOKEN_ENV]?.trim();
  if (given) return given;
  const r = run('security', ['find-generic-password', '-s', CLOUD_TOKEN_SERVICE, '-a', repo, '-w'], { env, timeoutMs: 20_000 });
  const token = r.code === 0 ? r.stdout.trim() : '';
  return token && CLOUD_TOKEN.test(token) ? token : null;
}

/**
 * Keeps the routine's token in the keychain, replacing any for the repo. `security` reads its command from
 * stdin in interactive mode, so the token never goes on a command line another process could read.
 */
export function writeCloudToken(run: Runner, repo: string, token: string, env: NodeJS.ProcessEnv): void {
  if (!CLOUD_TOKEN.test(token)) throw new AccError('usage', 'That doesn\'t look like a routine\'s API token: letters, digits, dashes and underscores, 20 or more.');
  const quote = (s: string) => `"${s.replace(/(["\\])/g, '\\$1')}"`;
  const r = run('security', ['-i'], { env, input: `add-generic-password -U -s ${quote(CLOUD_TOKEN_SERVICE)} -a ${quote(repo)} -w ${quote(token)}\n`, timeoutMs: 20_000 });
  if (r.code !== 0) throw new AccError('cloud', `The keychain wouldn't keep the token: ${(r.stderr || r.stdout).trim().split('\n')[0] || `security exited ${r.code}`}`);
}

/** Takes the routine's token out of the keychain. True when there was one. */
export function deleteCloudToken(run: Runner, repo: string, env: NodeJS.ProcessEnv): boolean {
  return run('security', ['delete-generic-password', '-s', CLOUD_TOKEN_SERVICE, '-a', repo], { env, timeoutMs: 20_000 }).code === 0;
}

// ---------------------------------------------------------------- firing the routine

/** The routine's fire endpoint and the beta it ships under, as the docs give them (D-140). */
const ROUTINE_FIRE_URL = (routine: string): string => `https://api.anthropic.com/v1/claude_code/routines/${routine}/fire`;
export const ROUTINE_BETA = 'experimental-cc-routine-2026-04-01';
const ROUTINE_VERSION = '2023-06-01';
/** How long a fire may take: the reply comes once the session is made. */
const FIRE_TIMEOUT_MS = 60_000;

export interface Fired {
  sessionId: string;
  url: string;
}

/**
 * Fires the routine with the task's text, and returns the session it started. curl does the request, as
 * acc's runner is synchronous; the token goes in a header file only this user can read, never on the
 * command line, and both files are removed once curl has answered.
 */
export function fireRoutine(paths: Pick<RepoPaths, 'stateDir'>, run: Runner, routine: string, token: string, text: string, env: NodeJS.ProcessEnv): Fired {
  const dir = join(paths.stateDir, 'cloud');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = `${process.pid}-${Date.now()}`;
  const headers = join(dir, `fire-${stamp}.headers`);
  const body = join(dir, `fire-${stamp}.json`);
  try {
    writeFileSync(headers, [`Authorization: Bearer ${token}`, `anthropic-beta: ${ROUTINE_BETA}`, `anthropic-version: ${ROUTINE_VERSION}`, 'Content-Type: application/json', ''].join('\n'), { mode: 0o600 });
    chmodSync(headers, 0o600);
    writeFileSync(body, JSON.stringify({ text }), { mode: 0o600 });
    const r = run('curl', ['-sS', '-X', 'POST', ROUTINE_FIRE_URL(routine), '-H', `@${headers}`, '--data-binary', `@${body}`, '-w', '\n%{http_code}'], { env, timeoutMs: FIRE_TIMEOUT_MS });
    if (r.code === 127) throw new AccError('cloud', 'curl isn\'t on PATH, and acc fires the routine with it.');
    if (r.code !== 0) throw new AccError('cloud', `The routine couldn't be fired: ${(r.stderr || r.stdout).trim().split('\n')[0] || `curl exited ${r.code}`}`);
    const lines = r.stdout.trimEnd().split('\n');
    const status = Number(lines.pop());
    const reply = lines.join('\n');
    if (status !== 200 && status !== 201) throw new AccError('cloud', `The routine refused the fire (HTTP ${status || '?'}): ${reply.trim().slice(0, 300) || 'no reply'}. ${status === 401 ? 'The token was refused: generate a new one on the routine\'s page and run acc cloud token.' : status === 429 ? 'The routine\'s hourly limit is reached (30 fires a routine, 100 an account): try later.' : ''}`.trim());
    let parsed: { claude_code_session_id?: unknown; claude_code_session_url?: unknown };
    try {
      parsed = JSON.parse(reply);
    } catch {
      throw new AccError('cloud', `The routine's reply wasn't JSON: ${reply.trim().slice(0, 200)}`);
    }
    const sessionId = typeof parsed.claude_code_session_id === 'string' ? parsed.claude_code_session_id : '';
    const url = typeof parsed.claude_code_session_url === 'string' ? parsed.claude_code_session_url : '';
    if (!sessionId || !url) throw new AccError('cloud', `The routine's reply named no session: ${reply.trim().slice(0, 200)}`);
    return { sessionId, url };
  } finally {
    rmSync(headers, { force: true });
    rmSync(body, { force: true });
  }
}

// ---------------------------------------------------------------- the finish marker

/** The trailer a cloud builder puts on its last commit in place of acc done (GH-69), and the note's parts. */
export const DONE_TRAILER = 'Acc-Done';
export const BLOCKED_TRAILER = 'Acc-Blocked';
const NOTE_TRAILERS = { landed: 'Acc-Landed', moved: 'Acc-Moved', open: 'Acc-Open' } as const;

export interface Finish {
  /** The commit says the task is done: `Acc-Done: <id>`. */
  done: boolean;
  /** The commit says the builder is stuck, and why: `Acc-Blocked: <why>`. */
  blocked: string | null;
  /** The note its trailers carry, as acc done takes it. */
  note: NoteInput | null;
}

/** What a commit message says about the task's end (GH-69): its trailers, read as git reads them, a `Key: value` line each. */
export function parseFinish(message: string, id: string): Finish {
  const trailers = new Map<string, string[]>();
  for (const line of message.split('\n')) {
    const m = /^([A-Za-z][A-Za-z-]*):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    trailers.set(key, [...(trailers.get(key) ?? []), m[2]!.trim()]);
  }
  const done = (trailers.get(DONE_TRAILER.toLowerCase()) ?? []).some((v) => v.toUpperCase() === id.toUpperCase());
  const blocked = trailers.get(BLOCKED_TRAILER.toLowerCase())?.filter(Boolean).join(' ') || null;
  const part = (k: keyof typeof NOTE_TRAILERS) => trailers.get(NOTE_TRAILERS[k].toLowerCase())?.filter(Boolean);
  const note = noteInput({ landed: part('landed'), moved: part('moved'), open: part('open') });
  return { done, blocked, note: done || blocked ? note : null };
}

// ---------------------------------------------------------------- the guard, where the cloud loads it

/**
 * Whether the guard is in the trees a cloud session loads its hooks from (GH-69): the branch its clone
 * starts on (origin's default branch, else the environment's), and the task branch it then checks out.
 * Read from the commits, never the files on disk: an uncommitted guard never reaches the cloud. `base`
 * is the branch the clone starts on; `why` says what's missing, with the fix, or is null.
 */
export function cloudGuard(run: Runner, root: string, envBranch: string, branch: string, env: NodeJS.ProcessEnv): { base: string; why: string | null } {
  const head0 = run('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd: root }).stdout.trim();
  const base = head0.startsWith('origin/') ? head0.slice('origin/'.length) : envBranch;
  fetchBranches(run, root, [base], env);
  const baseRef = run('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${base}`], { cwd: root }).code === 0 ? `refs/remotes/origin/${base}` : `refs/heads/${base}`;
  for (const ref of [baseRef, `refs/heads/${branch}`]) {
    const committed = guardCommitted(run, root, ref);
    if (!committed.ok) return { base, why: committed.why };
  }
  return { base, why: null };
}

// ---------------------------------------------------------------- the cloud packet

/**
 * The checks a cloud builder runs in its session, and those only this Mac can run (GH-69): a gate that
 * needs an org login (Salesforce validate, drift) can't run in the cloud, whose network reaches package
 * registries and GitHub and no org. acc runs those when it collects.
 */
const ORG_GATES = ['validate', 'drift'];
export function cloudChecks(config: Config, env: Environment): { inCloud: string[]; macOnly: string[] } {
  const required = requiredGates(config, env.branch, 'builder');
  const macOnly = required.filter((g) => config.profile === 'salesforce' && ORG_GATES.includes(g));
  return { inCloud: required.filter((g) => !macOnly.includes(g)), macOnly };
}

/**
 * The fire's text (GH-69): the builder's packet, and before it what a cloud session needs instead of acc:
 * the branch to work on, which is already on GitHub, the checks to run by their commands, and a finish
 * line of trailers on its last commit, which acc reads from the branch. The routine's prompt must say to
 * do what the routine-fire-payload holds; the text says so again, at the top.
 */
export function cloudText(p: { task: Task; config: Config; env: Environment; branch: string; packet: string; checks: { inCloud: string[]; macOnly: string[] } }): string {
  const { task, config, env, branch, checks } = p;
  const commandOf = (g: string): string | null => config.gates.commands[g] ?? config.gates.ratchets?.[g]?.command ?? null;
  const commands = checks.inCloud.map((g) => `- \`${g}\`: ${commandOf(g) ? `\`${commandOf(g)}\`` : `acc's built-in ${g} check, which acc runs on the Mac when it collects your work`}`);
  return [
    // The guard's record (GH-69): the repo's push guard reads these lines from the session's first message,
    // and allows a push of this branch alone, by a builder (T-86). They come first, a line each, exactly like this.
    `${RECORD_LINE}: ${branch}`,
    `${ROLE_LINE}: builder`,
    '',
    `# Cloud builder for ${task.id}: ${task.title}`,
    '',
    `This routine-fire-payload is your task: acc fired the routine to build ${task.id} in this cloud session. Do the task below as the builder, exactly as its instructions say, with these differences for a cloud session:`,
    '',
    `- **Your branch is \`${branch}\`**, already on GitHub, started from \`${env.branch}\`. Start with \`git fetch origin ${branch} && git checkout ${branch}\`. Work on it only. The \`${RECORD_LINE}\` and \`${ROLE_LINE}\` lines at the top are the repo's push guard's record of it: the guard allows \`git push origin ${branch}\` and nothing else that pushes, written plainly, as its own command.`,
    '- **acc isn\'t installed here.** Where the instructions say `acc gate run`, run these checks yourself and fix what fails:',
    ...(commands.length ? commands : ['  - this project names no checks a cloud session can run']),
    ...(checks.macOnly.length ? [`- **These checks can't run in the cloud**, since they need an org login, and acc runs them on the Mac when it collects your branch: ${checks.macOnly.map((g) => `\`${g}\``).join(', ')}. Don't try them here.`] : []),
    '- **Where the instructions say `acc done`**, finish like this instead, all in your last commit\'s message, a trailer on its own line each:',
    '  ```',
    `  ${DONE_TRAILER}: ${task.id}`,
    `  ${NOTE_TRAILERS.landed}: <what landed>`,
    `  ${NOTE_TRAILERS.moved}: <tests, checks, ratchets that moved, or none>`,
    `  ${NOTE_TRAILERS.open}: <what's still open, or none>`,
    '  ```',
    `  Give \`${NOTE_TRAILERS.landed}\`, \`${NOTE_TRAILERS.moved}\` or \`${NOTE_TRAILERS.open}\` again for each further line. Then push only your branch: \`git push origin ${branch}\`. acc sees the trailer on the branch's head and collects your work.`,
    `- **Where the instructions say \`acc block\`**, commit with \`${BLOCKED_TRAILER}: <what you need>\` on your last commit instead, push your branch, and stop.`,
    `- **Push only \`${branch}\`.** Never push \`${env.branch}\` or any other branch, never force-push, never merge a pull request or open one, and never deploy. The repo's hooks refuse anything else: the guard before a command runs, and a git pre-push hook in this clone on the push itself. A person lands your branch.`,
    '- **Leave the hooks alone.** From Bash, nothing under `.claude/` or `.git/` is written; the Edit and Write tools refuse `.claude/hooks/`, `.claude/settings.json` and anything under `.git/`; `--no-verify` and `core.hooksPath` are refused. Other files under `.claude/` can be edited with Edit or Write if the task needs it.',
    `- Commit as \`${config.commitIdentity?.name ?? 'the repo\'s commit identity'}\`${config.commitIdentity ? ` (\`git config user.name "${config.commitIdentity.name}" && git config user.email "${config.commitIdentity.email}"\`)` : ''}.`,
    '',
    '---',
    '',
    p.packet.trim(),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- following by branch

/** Whether a cloud builder has pushed nothing for longer than the project allows (GH-69): the task then needs you. */
export function cloudQuiet(task: Pick<Task, 'state' | 'run'>, config: Pick<Config, 'agents'>, now: Date): boolean {
  const c = task.run?.cloud;
  if (task.state !== 'running' || task.run?.where !== 'cloud' || !c || c.finished) return false;
  const minutes = config.agents.cloud?.quietMinutes ?? CLOUD_QUIET_MINUTES;
  return now.getTime() - Date.parse(c.lastPushAt) > minutes * 60_000;
}

/** Why a running cloud task needs a person, from its run alone (GH-69): its collect failed, or it's quiet. */
export function cloudWait(task: Pick<Task, 'state' | 'run'>, config: Pick<Config, 'agents'>, now: Date): string | null {
  const c = task.run?.cloud;
  if (task.state !== 'running' || task.run?.where !== 'cloud' || !c) return null;
  if (c.collect) return `acc couldn't collect its work: ${c.collect.reason}`;
  if (cloudQuiet(task, config, now)) return `no word from its cloud builder for ${Math.round((now.getTime() - Date.parse(c.lastPushAt)) / 60_000)} minutes: it may be waiting for an answer on claude.ai`;
  return null;
}

export interface FollowDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  /** The heavy-check slot a collect's checks take: machine-wide unless a test says otherwise. */
  slots?: SlotOptions;
}

export interface FollowChange {
  task: string;
  /** A new head on origin: the builder pushed. */
  head?: string;
  /** What acc did about it. */
  outcome: 'pushed' | 'collected' | 'collect-failed' | 'blocked' | 'unchanged' | 'unreachable';
  note: string;
}

/** origin's head of a branch, from `git ls-remote`, or null when origin didn't answer or has no such branch. */
export function remoteHead(run: Runner, root: string, branch: string, env: NodeJS.ProcessEnv): string | null {
  const r = run('git', ['ls-remote', '--heads', 'origin', branch], { cwd: root, env: { ...env, GIT_TERMINAL_PROMPT: '0' }, timeoutMs: FETCH_TIMEOUT_MS });
  if (r.code !== 0) return null;
  const m = /^([0-9a-f]{40,64})\s+refs\/heads\//m.exec(r.stdout);
  return m?.[1] ?? null;
}

/**
 * Looks at each running cloud task's branch on GitHub (GH-69): a new head is written on its run, and its
 * last commit read for the finish marker. Done, acc collects the work; blocked, the task moves to blocked
 * with the builder's reason. Nothing is pushed, and a branch origin can't answer for is left as it was.
 */
export function followCloud(paths: RepoPaths, config: Config, deps: FollowDeps, opts: { only?: string; by?: string } = {}): FollowChange[] {
  const { run, now, env } = deps;
  const out: FollowChange[] = [];
  // A finished run whose collect failed is followed on: a fix pushed to the branch collects it again.
  const tasks = readLedger(paths.ledger).tasks.filter((t) => t.state === 'running' && t.run?.where === 'cloud' && t.run.cloud && (!t.run.cloud.finished || t.run.cloud.collect) && (!opts.only || t.id === opts.only));
  for (const t of tasks) {
    const branch = t.run!.branch!;
    const head = remoteHead(run, paths.root, branch, env);
    if (!head) {
      out.push({ task: t.id, outcome: 'unreachable', note: `origin didn't answer for ${branch}` });
      continue;
    }
    if (head === t.run!.cloud!.head) {
      out.push({ task: t.id, head, outcome: 'unchanged', note: `${branch} is still at ${head.slice(0, 7)}` });
      continue;
    }
    if (!fetchBranches(run, paths.root, [branch], env)) {
      out.push({ task: t.id, head, outcome: 'unreachable', note: `couldn't fetch ${branch}` });
      continue;
    }
    const message = run('git', ['log', '-1', '--format=%B', head], { cwd: paths.root }).stdout;
    const finish = parseFinish(message, t.id);
    const at = now().toISOString();
    mutate(paths, now, (l, emit) => {
      const x = l.tasks.find((y) => y.id === t.id);
      if (!x?.run?.cloud || x.state !== 'running') return;
      x.run.cloud = { ...x.run.cloud, head, lastPushAt: at, ...(finish.done ? { finished: true as const } : {}), collect: null };
      x.updatedAt = at;
      emit({ type: 'task.updated', task: t.id, actor: 'sync', by: opts.by ?? 'acc sync', data: { cloud: { head, finished: finish.done, blocked: finish.blocked } } });
    });
    if (finish.blocked) {
      const req = { to: 'blocked' as const, actor: 'builder' as const, by: `builder:${t.id}`, reason: finish.blocked, ...(finish.note ? { note: finish.note } : {}) };
      const moved = mutate(paths, now, (l, emit) => {
        const x = l.tasks.find((y) => y.id === t.id);
        if (!x || x.state !== 'running' || checkMove(l, config, x, req, receiptHooks(paths, config, run)).length) return false;
        applyMove(x, req, emit, now, { cloud: true });
        return true;
      });
      out.push({ task: t.id, head, outcome: 'blocked', note: moved ? `its cloud builder blocked: ${finish.blocked}` : `its cloud builder blocked, but the move was refused: ${finish.blocked}` });
      continue;
    }
    if (!finish.done) {
      out.push({ task: t.id, head, outcome: 'pushed', note: `${branch} moved to ${head.slice(0, 7)}` });
      continue;
    }
    try {
      const c = collect(paths, config, t.id, deps, { actor: 'builder', by: `builder:${t.id}`, note: finish.note });
      out.push({ task: t.id, head, outcome: 'collected', note: c.reason });
    } catch (e) {
      out.push({ task: t.id, head, outcome: 'collect-failed', note: (e as Error).message });
    }
  }
  return out;
}

// ---------------------------------------------------------------- collect

export interface CollectResult {
  task: Task;
  sha: string;
  /** The checks run on this Mac, each with its outcome. */
  checks: GateResult[];
  reason: string;
}

/**
 * Collects a cloud builder's work (GH-69): fetches origin's task branch, fast-forwards the worktree to it,
 * refusing a dirty or diverged worktree with nothing changed, runs the required checks on this Mac, in the
 * heavy-check slot, and moves the task running → review under the same gatesPassed rule as acc done, with
 * the note the builder's trailers carried. A check that fails leaves the task running, needing you, with the
 * check named on its run.
 */
export function collect(paths: RepoPaths, config: Config, id: string, deps: FollowDeps, opts: { actor: Actor; by: string; note?: NoteInput | null }): CollectResult {
  const { run, now, env } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  if (task.state !== 'running') throw new AccError('refused', `${id} is ${task.state}. acc collects a running cloud builder's work.`);
  if (task.run?.where !== 'cloud' || !task.run.cloud) throw new AccError('refused', `${id}'s builder runs on this Mac, and finishes with acc done itself.`);
  const branch = task.run.branch;
  const wt = task.run.worktree;
  if (!branch || !wt) throw new AccError('refused', `${id} has no branch or worktree to collect into.`);
  const envBranch = environmentByBranch(config, task.environment);
  if (!envBranch) throw new AccError('refused', `${id}'s environment "${task.environment}" isn't in the config.`);
  const fail = (reason: string): never => {
    mutate(paths, now, (l, emit) => {
      const x = l.tasks.find((y) => y.id === id);
      if (!x?.run?.cloud) return;
      x.run.cloud.collect = { at: now().toISOString(), reason };
      emit({ type: 'task.updated', task: id, actor: opts.actor, by: opts.by, data: { cloud: { collect: x.run.cloud.collect } } });
    });
    throw new AccError('collect', `Couldn't collect ${id}: ${reason}`);
  };
  if (!existsSync(wt)) return fail(`its worktree ${wt} isn't on disk any more.`);
  const git = (...args: string[]) => run('git', args, { cwd: wt });
  const on = git('symbolic-ref', '--quiet', '--short', 'HEAD').stdout.trim();
  if (on !== branch) return fail(`${wt} is on ${on || 'a detached commit'}, not ${branch}.`);
  if (git('status', '--porcelain').stdout.trim()) return fail(`${wt} has changes nobody committed. Commit or discard them, then collect again: acc collect ${id}.`);
  if (!fetchBranches(run, paths.root, [branch], { ...env, GIT_TERMINAL_PROMPT: '0' })) return fail(`couldn't fetch ${branch} from origin.`);
  const remote = `refs/remotes/origin/${branch}`;
  const sha = git('rev-parse', '--verify', '--quiet', remote).stdout.trim();
  if (!sha) return fail(`origin has no ${branch}.`);
  const local = git('rev-parse', 'HEAD').stdout.trim();
  if (local !== sha) {
    if (git('merge-base', '--is-ancestor', local, sha).code !== 0) return fail(`${branch} has diverged: this clone has commits origin's doesn't. Bring them together by hand, then collect again: acc collect ${id}.`);
    const ff = git('merge', '--ff-only', remote);
    if (ff.code !== 0) return fail(`git couldn't fast-forward ${branch}: ${(ff.stderr || ff.stdout).trim().split('\n').at(-1)}`);
  }
  // The required checks, on this Mac, in the heavy-check slot, as a refresh runs them (D-058). The cloud's
  // own runs don't count: receipts vouch for a commit on this machine.
  const gates = requiredGates(config, envBranch.branch, 'builder');
  let results: GateResult[] = [];
  if (gates.length) {
    try {
      results = runGates({ ...paths, root: wt }, config, envBranch, gates, priorTests(paths, config, sha), { run, now, slots: deps.slots, task: id }).results;
    } catch (e) {
      return fail(`its checks couldn't run: ${(e as Error).message}`);
    }
  }
  const failed = results.filter((r) => !r.recorded || !satisfies(r.receipt));
  if (failed.length) return fail(`${failed.map((r) => `${r.gate} ${r.status === 'fail' ? 'failed' : r.status === 'hold' ? 'needs a person' : 'couldn\'t run'}: ${r.summary.replace(/[.!?]$/, '')}`).join('; ')}. Fix it on the branch and collect again: acc collect ${id}.`);
  // The note, as the builder's trailers gave it (D-106): a part it left out says so, so the move isn't refused for it.
  const given = opts.note ?? null;
  const note: NoteInput = { landed: given?.landed?.length ? given.landed : ['(the cloud builder\'s last commit gave no Acc-Landed line)'], moved: given?.moved ?? ['none'], open: given?.open ?? ['none'] };
  const req = { to: 'review' as const, actor: opts.actor, by: opts.by, reason: `Collected from its cloud session at ${sha.slice(0, 7)}.`, note };
  const moved = mutate(paths, now, (l, emit) => {
    const x = l.tasks.find((y) => y.id === id)!;
    const problems = checkMove(l, config, x, req, receiptHooks(paths, config, run));
    if (problems.length) throw new AccError('collect', `Couldn't move ${id} to review:\n- ${problems.join('\n- ')}`);
    if (x.run?.cloud) x.run.cloud = { ...x.run.cloud, head: sha, finished: true, collect: null };
    applyMove(x, req, emit, now, { cloud: { sha, checks: results.map((r) => ({ gate: r.gate, status: r.status })) } });
    return x;
  });
  return { task: moved, sha, checks: results, reason: `Collected ${sha.slice(0, 7)} from the cloud${gates.length ? `, and ${gates.join(', ')} passed on this Mac` : ''}: ${id} is in review.` };
}

/** Where a cloud run's own page is, for Watch (GH-69): its claude.ai session. */
export const cloudUrl = (run: { cloud?: Pick<CloudRun, 'url'> } | null | undefined): string | null => run?.cloud?.url ?? null;

// ---------------------------------------------------------------- opting in

export interface CloudChange {
  routine?: string | null;
  default?: BuilderPlace;
  quietMinutes?: number;
  max?: number;
  /** Where a review runs when no flag says (T-86). */
  review?: BuilderPlace;
}

/**
 * Opts a project in to cloud builders, or changes how (GH-69): `agents.cloud` in .acc/config.json, written
 * key by key so the rest of the file stays as it was. A person's, never an agent's. Nothing else is set:
 * the defaults (local, 120 minutes, 3, reviews local) apply where the file says nothing.
 */
export function enableCloud(configFile: string, change: CloudChange, current: Config['agents']['cloud']): void {
  if (change.routine !== undefined && change.routine !== null && !ROUTINE_ID.test(change.routine)) throw new AccError('usage', 'A routine\'s API trigger id looks like trig_01ABC…: copy it from the routine\'s page at claude.ai/code/routines.');
  if (change.default !== undefined && !(BUILDER_PLACES as readonly string[]).includes(change.default)) throw new AccError('usage', `The default is one of ${BUILDER_PLACES.join(', ')}.`);
  if (change.quietMinutes !== undefined && (!Number.isInteger(change.quietMinutes) || change.quietMinutes < 5 || change.quietMinutes > 1440)) throw new AccError('usage', 'The quiet time is a whole number of minutes from 5 to 1440.');
  if (change.max !== undefined && (!Number.isInteger(change.max) || change.max < 1 || change.max > 16)) throw new AccError('usage', 'The cloud cap is a whole number from 1 to 16.');
  if (change.review !== undefined && !(BUILDER_PLACES as readonly string[]).includes(change.review)) throw new AccError('usage', `Reviews run in one of ${BUILDER_PLACES.join(', ')}.`);
  if (!current) {
    // Opting in: the section, whole, with what was given and the defaults for the rest.
    const section: Record<string, unknown> = {
      ...(change.routine ? { routine: change.routine } : {}),
      default: change.default ?? 'local',
      quietMinutes: change.quietMinutes ?? CLOUD_QUIET_MINUTES,
      max: change.max ?? CLOUD_MAX,
      review: change.review ?? 'local',
    };
    writeJsonKey(configFile, ['agents', 'cloud'], section);
    return;
  }
  if (change.routine !== undefined) writeJsonKey(configFile, ['agents', 'cloud', 'routine'], change.routine ?? undefined);
  if (change.default !== undefined) writeJsonKey(configFile, ['agents', 'cloud', 'default'], change.default);
  if (change.quietMinutes !== undefined) writeJsonKey(configFile, ['agents', 'cloud', 'quietMinutes'], change.quietMinutes);
  if (change.max !== undefined) writeJsonKey(configFile, ['agents', 'cloud', 'max'], change.max);
  if (change.review !== undefined) writeJsonKey(configFile, ['agents', 'cloud', 'review'], change.review);
}

/** Takes the project out of cloud builders: the section goes, and nothing offers the cloud. The token stays in the keychain. */
export function disableCloud(configFile: string): void {
  writeJsonKey(configFile, ['agents', 'cloud'], undefined);
}
