import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { type Config, type Environment, environmentByBranch } from './config.ts';
import { AccError, type Runner } from './exec.ts';
import { type Actor, applyMove, checkMove, mutate, noGateHooks, readLedger, type Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { permissionHook } from './questions.ts';
import { type Analysis, analysisProblems, analysisSection, readAnalysis } from './analyze.ts';
import { latestVerdict, type Verdict } from './review.ts';
import { agentArgs } from './agents.ts';

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

/** The main checkout: the first entry in `git worktree list`. Worktrees are placed beside it. */
export function mainCheckout(run: Runner, cwd: string): string {
  const r = run('git', ['worktree', 'list', '--porcelain'], { cwd });
  const first = /^worktree (.+)$/m.exec(r.stdout)?.[1];
  if (r.code !== 0 || !first) throw new AccError('not-a-repo', `${cwd} isn't inside a git repository.`);
  return first;
}

/**
 * `worktrees.root` from the config, relative to the main checkout. The default is Claude Code's own
 * `.claude/worktrees/` inside the repo (D-022): a background agent started from the trusted main checkout
 * can enter a worktree there without a trust prompt, and Claude Code then enforces the isolation.
 */
export function worktreeRoot(config: Config, main: string): string {
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

/** Whether Claude Code trusts this folder for background sessions: accepted once with \`claude\` there. */
export function isTrusted(folder: string, env: NodeJS.ProcessEnv = process.env): boolean {
  let state: { projects?: Record<string, { hasTrustDialogAccepted?: boolean }> };
  try {
    state = JSON.parse(readFileSync(claudeStatePath(env), 'utf8'));
  } catch {
    return false;
  }
  const keys = new Set([folder, folder.normalize('NFC')]);
  try {
    keys.add(realpathSync(folder));
  } catch {
    // keep the raw path
  }
  return [...keys].some((k) => state.projects?.[k]?.hasTrustDialogAccepted === true);
}

// ---------------------------------------------------------------- the packet (DESIGN.md section 8)

export interface PacketInput {
  task: Task;
  config: Config;
  env: Environment;
  worktree: string;
  branch: string;
  rules: string | null;
  environmentSpecific: string[];
  /** The full path of the acc executable, given as a fallback in case an agent doubts it's on PATH. */
  accPath?: string;
  /** On a rework, the review that asked for changes (D-032). */
  review?: Verdict | null;
  /** What the task's analysis found, and what a person answered (D-052). */
  analysis?: Analysis | null;
}

/** On a rework: what the review asked for, so the next run fixes that and leaves the rest. */
function reviewSection(v: Verdict | null | undefined): string[] {
  if (!v || v.verdict !== 'changes') return [];
  const where = (f: { file?: string; line?: number }) => (f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`: ` : '');
  const must = v.findings.filter((f) => f.must);
  const unmet = v.criteria.filter((c) => !c.met);
  return [
    '## What the review asked for',
    '',
    `This is a rework. The reviewer looked at ${v.sha.slice(0, 7)} and asked for changes: ${v.summary}`,
    '',
    ...must.map((f) => `- ${where(f)}${f.message}${f.rule ? ` (rule: ${f.rule})` : ''}`),
    ...unmet.map((c) => `- Not met yet: ${c.text}. ${c.evidence}`),
    ...(must.length || unmet.length ? [''] : []),
    'Fix these, and keep the rest of the change as it is. Then finish as below.',
    '',
  ];
}

function commitRef(task: Task): string {
  if (task.source.kind === 'github') return ` Add \`refs #${task.id.replace(/^GH-/, '')}\` on its own line, so GitHub links the commit to the issue.`;
  return '';
}

export function renderPacket(p: PacketInput & { enterWorktree?: boolean }): string {
  const { task, config, env } = p;
  const sf = config.profile === 'salesforce';
  const required = config.gates.required;
  const lines: string[] = [
    `# Task ${task.id}: ${task.title}`,
    '',
    `You are the builder for ${task.id}. Work only on this task, only in this worktree, and stop when it's done.`,
    '',
  ];
  if (p.enterWorktree) {
    lines.push(
      '## First, before anything else',
      '',
      `Call the **EnterWorktree** tool with the path \`${p.worktree}\`. Do this before reading or editing any file. Your session starts in the main checkout, which you must never change. Claude Code keeps you inside the worktree once you've entered it.`,
      '',
    );
  }
  lines.push(
    '## The task',
    '',
    task.brief.trim() || '_No details were given beyond the title. If the title alone is too vague to build from, block (see the finish line) and say what you need._',
    '',
    task.source.url ? `Ticket: ${task.source.url}` : `Source: ${task.source.kind}`,
    '',
    ...analysisSection(p.analysis ?? null),
    ...reviewSection(p.review),
    '## Where you are',
    '',
    `- **Worktree:** \`${p.worktree}\`. This is your only workspace.`,
    `- **Branch:** \`${p.branch}\`, started from \`${env.branch}\`, the ${env.name} environment's branch.`,
  );
  if (sf && env.org) lines.push(`- **Org:** \`${env.org}\` (${env.name}). It's already this worktree's default org.`);
  lines.push(
    '',
    '## How to work',
    '',
    `- **Commits:** \`${task.id}: <what changed>\`, one logical change per commit.${commitRef(task)} Never write "fixes", "closes" or "resolves" in a commit message; the ticket is closed by a person.`,
    '- **Changes:** keep them to what the task asks. If you find something else that needs fixing, mention it in your final message instead of fixing it.',
  );
  if (sf) {
    lines.push(
      '- **Salesforce:** validate, never deploy. `acc gate run validate` proves a change with a check-only deploy to the org; nothing is saved. Real deploys happen after a person merges.',
      '- **Tests:** if you change Apex, name the test classes that cover it and why each is the right one: `acc gate run validate --test <TestClass>="<why>"`, once per class.',
    );
  }
  lines.push('', '## The finish line', '');
  lines.push('1. **Commit** everything the task needs. Leave nothing uncommitted.');
  if (required.length) {
    lines.push(
      `2. **Checks:** run exactly \`acc gate run\`. It runs the required checks (${required.map((g) => `\`${g}\``).join(', ')}) on your latest commit and records each result; \`acc done\` refuses until every one has passed. If one fails, fix it, commit, and run \`acc gate run\` again. If a check can't run at all (it says error), block and quote its message.`,
    );
    if (sf) {
      lines.push('   If you changed Apex, add `--test <TestClass>="<why it covers the change>"` once per test class, for example `acc gate run --test AccountServiceTest="covers the new discount rule"`. Those flags are the only thing to add.');
    }
  } else {
    lines.push('2. **Checks:** run the project\'s tests or build if it has them, and report the results.');
  }
  lines.push(
    '3. **Finish** by running exactly `acc done`, as its own command. It is already on your PATH and pre-approved. Don\'t run it through npm scripts, `npx`, or other wrappers, and don\'t chain it with other commands, or it will stop for permission. If you\'re stuck, run exactly `acc block "<what you need>"` instead, and stop.',
    '   If only the client can answer what you need (a business rule, access you don\'t have, or a choice that\'s theirs to make), run exactly `acc block --client "<your question>"` instead, and stop. Write the question for the client, in plain words with no code, file or tool names: a person reads it before it goes on the ticket.',
    ...(p.accPath ? [`   If \`acc\` really isn't found, its full path is \`${p.accPath}\`.`] : []),
    '4. **Summarize** in your final message: what changed, how you checked it, and anything a reviewer should look at.',
    '',
    '## Never',
    '',
    '- push, merge, or open a pull request (a person and `acc land` do that)',
  );
  if (sf) lines.push('- deploy to any org (`sf project deploy start`)');
  lines.push(
    '- edit files outside this worktree, or check out another branch',
    '- change the ticket or the task list, apart from `acc done` and `acc block`',
  );
  if (p.environmentSpecific.length) {
    lines.push('- edit an environment-specific file (D-016). Each org keeps its own version of these:', ...p.environmentSpecific.map((f) => `  - \`${f}\``));
  }
  if (p.rules?.trim()) lines.push('', '## Project rules', '', p.rules.trim());
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- the builder's session

/**
 * Settings for the builder session: who it is, acc on its PATH, routine commands allowed, and the
 * dangerous ones denied. Deny beats allow, so this holds even when the user's own settings allow them.
 */
export function builderSettings(task: Task, config: Config, accBinDir: string, basePath: string, accCommand?: string): Record<string, unknown> {
  const sf = config.profile === 'salesforce';
  const allow = [
    'Bash(acc done*)', 'Bash(acc block *)', 'Bash(acc show *)', 'Bash(acc gate run)', 'Bash(acc gate run *)', 'Bash(acc gate list*)',
    'Bash(git status*)', 'Bash(git diff*)', 'Bash(git add *)', 'Bash(git commit *)', 'Bash(git log*)', 'Bash(git show *)',
    'Bash(npm test*)', 'Bash(npm run *)', 'Bash(npx prettier *)', 'Bash(npx eslint *)', 'Bash(node --test*)', 'Bash(node --no-warnings --test*)',
    // A project may ask for builds and tests under nice, so the machine stays usable: the same commands, niced.
    'Bash(nice -n 15 npm test*)', 'Bash(nice -n 15 npm run *)', 'Bash(nice -n 15 npx prettier *)', 'Bash(nice -n 15 npx eslint *)',
    'Bash(nice -n 15 node --test*)', 'Bash(nice -n 15 node --no-warnings --test*)',
    ...(sf ? ['Bash(sf project deploy validate *)', 'Bash(sf code-analyzer run *)', 'Bash(sf apex run test *)', 'Bash(sf data query *)'] : []),
  ];
  const deny = [
    'Bash(git push*)', 'Bash(gh pr *)', 'Bash(git checkout *)', 'Bash(git switch *)', 'Bash(git worktree *)', 'Bash(git reset --hard*)',
    'Bash(acc set *)', 'Bash(acc dispatch *)', 'Bash(acc init*)', 'Bash(acc gate waive*)', 'Bash(acc land*)', 'Bash(acc review*)', 'Bash(acc autopilot*)', 'Bash(acc agents autonomy*)', 'Bash(acc analyze*)', 'Bash(acc analysis answer*)', 'Bash(acc promote*)', 'Bash(acc deploy*)', 'Bash(acc update*)',
    ...(sf ? ['Bash(sf project deploy start*)', 'Bash(sf project deploy quick*)', 'Bash(sf org delete *)'] : []),
  ];
  return {
    env: { ACC_TASK: task.id, ACC_ROLE: 'builder', PATH: `${accBinDir}:${basePath}` },
    permissions: { allow, deny },
    // Its permission prompts and questions go to the Command Center when one is open (D-030).
    ...(accCommand ? { hooks: permissionHook(accCommand) } : {}),
  };
}

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
}

export interface DispatchResult {
  task: Task;
  worktree: string;
  branch: string;
  reused: boolean;
  packetPath: string;
  bgId: string | null;
  sessionId: string | null;
}

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

function setupWorktree(run: Runner, config: Config, env: Environment, main: string, wt: string): void {
  if (config.profile === 'salesforce' && env.org) {
    mkdirSync(join(wt, '.sf'), { recursive: true });
    writeFileSync(join(wt, '.sf', 'config.json'), JSON.stringify({ 'target-org': env.org }, null, 2) + '\n');
  }
  if (existsSync(join(main, 'node_modules')) && !existsSync(join(wt, 'node_modules'))) {
    symlinkSync(join(main, 'node_modules'), join(wt, 'node_modules'), 'dir');
    excludeEverywhere(run, main, 'node_modules');
  }
  for (const cmd of config.worktrees.setup) {
    const r = run('sh', ['-c', cmd], { cwd: wt });
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

function readList(wt: string, rel: string | null): string[] {
  if (!rel || !existsSync(join(wt, rel))) return [];
  return readFileSync(join(wt, rel), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** The new background session, found by name and folder in `claude agents --json`. */
function findSession(run: Runner, wt: string, name: string, waitMs: number): { bgId: string | null; sessionId: string | null } {
  const until = Date.now() + waitMs;
  do {
    const r = run('claude', ['agents', '--json'], { cwd: wt, timeoutMs: 20_000 });
    try {
      const list = JSON.parse(r.stdout) as { id?: string; sessionId?: string; name?: string; cwd?: string; kind?: string; startedAt?: number }[];
      const s = list.filter((x) => x.name === name && x.kind === 'background').sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
      if (s) return { bgId: s.id ?? null, sessionId: s.sessionId ?? null };
    } catch {
      // not JSON yet; try again
    }
    if (Date.now() < until) sleep(500);
  } while (Date.now() < until);
  return { bgId: null, sessionId: null };
}

export interface DispatchOptions {
  actor: Actor;
  by: string;
  /** Run the session in this terminal instead of in the background (D-009's fallback). */
  foreground?: boolean;
  /** A person's say-so to build without the analysis the project wants (D-052). */
  withoutAnalysis?: boolean;
}

export function dispatch(paths: RepoPaths, config: Config, id: string, deps: DispatchDeps, opts: DispatchOptions): DispatchResult {
  const { run, now } = deps;
  const before = readLedger(paths.ledger);
  const found = before.tasks.find((t) => t.id === id);
  if (!found) throw new AccError('no-task', `No task ${id}.`);
  const req = { to: 'running' as const, actor: opts.actor, by: opts.by };
  const problems = checkMove(before, config, found, req, noGateHooks);
  if (problems.length) throw new AccError('move-refused', `Can't dispatch ${id}:\n- ${problems.join('\n- ')}`);
  // A project that wants an analysis first gets one, unless a person says to go without (D-052).
  const held = analysisProblems(paths, config, found);
  if (held.length && !(opts.withoutAnalysis && opts.actor === 'human')) throw new AccError('move-refused', `Can't dispatch ${id}:\n- ${held.join('\n- ')}`);
  const env = environmentByBranch(config, found.environment);
  if (!env) throw new AccError('dispatch', `${id}'s environment "${found.environment}" isn't in the config.`);

  const main = mainCheckout(run, paths.root);
  const wt = join(worktreeRoot(config, main), found.id);
  const enter = isClaudeWorktree(main, wt);
  // Background sessions need a trusted folder (D-022): the main checkout when entering a .claude worktree.
  const launchDir = enter ? main : wt;
  if (!opts.foreground && enter && !isTrusted(main, deps.env)) {
    throw new AccError('not-trusted', `Claude Code doesn't trust ${main} yet, so it won't start a background agent there. Run \`claude\` once in that folder, accept the trust prompt, then type /exit and dispatch again.`);
  }
  const branch = found.run?.branch ?? taskBranch(found);
  const reused = ensureWorktree(run, main, wt, branch, env);
  setupWorktree(run, config, env, main, wt);

  const rules = existsSync(join(wt, '.acc', 'rules.md')) ? readFileSync(join(wt, '.acc', 'rules.md'), 'utf8') : null;
  const packet = renderPacket({
    task: found, config, env, worktree: wt, branch, rules, environmentSpecific: readList(wt, config.environmentSpecific), enterWorktree: enter && !opts.foreground,
    accPath: join(deps.accBinDir, 'acc'), review: found.state === 'rework' ? latestVerdict(paths, found.id) : null, analysis: readAnalysis(paths, found.id),
  });
  mkdirSync(paths.packets, { recursive: true });
  const packetPath = join(paths.packets, `${found.id}.md`);
  writeFileSync(packetPath, packet);

  const settings = JSON.stringify(builderSettings(found, config, deps.accBinDir, deps.env.PATH ?? '', deps.accCommand));
  const prompt = `Read your task instructions below and do the task.\n\n${packet}`;
  // The builder's model and effort (D-036), when the project or this clone chose them.
  const base = ['--name', found.id, '--permission-mode', config.agents.permissionMode, ...agentArgs(config.agents.builder), '--settings', settings];

  const record = (bgId: string | null, sessionId: string | null) => mutate(paths, now, (ledger, emit) => {
    const task = ledger.tasks.find((t) => t.id === id)!;
    const again = checkMove(ledger, config, task, req, noGateHooks);
    if (again.length) throw new AccError('move-refused', `Can't dispatch ${id}:\n- ${again.join('\n- ')}`);
    applyMove(task, { ...req, reason: reused ? `re-dispatched in ${basename(wt)}` : null }, emit, now);
    task.run = { worktree: wt, branch, startedAt: now().toISOString(), ...(bgId ? { bgId } : {}), ...(sessionId ? { sessionId } : {}) };
    emit({ type: 'task.updated', task: id, actor: opts.actor, by: opts.by, data: { run: task.run } });
    return task;
  });

  if (opts.foreground) {
    const task = record(null, null);
    spawnSync('claude', [...base, prompt], { cwd: wt, stdio: 'inherit', env: deps.env });
    return { task, worktree: wt, branch, reused, packetPath, bgId: null, sessionId: null };
  }

  const launched = run('claude', ['--bg', ...base, prompt], { cwd: launchDir, env: deps.env, timeoutMs: 60_000 });
  if (launched.code !== 0) throw new AccError('dispatch', `Claude Code didn't start the agent: ${(launched.stderr || launched.stdout).trim().split('\n')[0]}. The worktree is kept at ${wt}.`);
  const { bgId, sessionId } = findSession(run, launchDir, found.id, deps.findSessionMs ?? 8_000);
  try {
    const task = record(bgId, sessionId);
    return { task, worktree: wt, branch, reused, packetPath, bgId, sessionId };
  } catch (e) {
    if (bgId) run('claude', ['stop', bgId], { cwd: wt });
    throw e;
  }
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
