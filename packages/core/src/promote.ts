import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { carriedTasks } from './carried.ts';
import { type Config, type Environment } from './config.ts';
import { AccError, type RunResult, type Runner, sfEnv } from './exec.ts';
import { assertCheckOnly, listed, niced, type Outcome, packageDirs, readDeploy, under } from './gates.ts';
import { mutate, type Promotion, type Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { type SlotOptions, withSlot } from './semaphore.ts';
import { draftUpdate } from './updates.ts';

/**
 * Promotion (D-034): merged work moves from one environment's branch to another along a path its
 * `promotesTo` allows, through a pull request a person merges. The pull request's branch starts from
 * the destination and takes only what changed on the source, so a fix made straight in the
 * destination is never undone, and environment-specific files never travel. Each task whose change it
 * carries records it, and its ticket gets a draft update a person posts (D-???).
 */

export interface PromotionPlan {
  from: Environment;
  to: Environment;
  /** Environments the usual path goes through that this route skips (D-018). */
  skipped: Environment[];
  /** Files to bring over, and files the source deleted that the destination still has. */
  files: string[];
  deleted: string[];
  /** Changed, but environment-specific, so left out. */
  leftOut: string[];
  fromSha: string;
  toSha: string;
}

export interface PromoteDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  slots?: SlotOptions;
  onStep?: (what: string) => void;
}

const git = (run: Runner, cwd: string, ...args: string[]): RunResult => run('git', args, { cwd });
const must = (r: RunResult, what: string): string => {
  if (r.code !== 0) throw new AccError('git', `${what}: ${(r.stderr || r.stdout).trim().split('\n').pop() ?? ''}`);
  return r.stdout;
};

/** Every promotion path from each environment that nothing promotes into, following every listed option. */
export function promotionPaths(envs: Pick<Environment, 'branch' | 'promotesTo'>[]): string[][] {
  const into = new Set(envs.flatMap((e) => e.promotesTo));
  const starts = envs.filter((e) => !into.has(e.branch) && e.promotesTo.length);
  const out: string[][] = [];
  const walk = (path: string[]) => {
    const last = envs.find((e) => e.branch === path[path.length - 1]);
    const next = (last?.promotesTo ?? []).filter((b) => !path.includes(b));
    if (!next.length) { out.push(path); return; }
    for (const b of next) walk([...path, b]);
  };
  for (const s of starts) walk([s.branch]);
  return out;
}

export function envByName(config: Config, name: string): Environment {
  const e = config.environments.find((x) => x.branch === name.toLowerCase() || x.name.toLowerCase() === name.toLowerCase());
  if (!e) throw new AccError('usage', `No environment "${name}". The config has: ${config.environments.map((x) => x.branch).join(', ')}.`);
  return e;
}

/** What the usual path, each environment's first `promotesTo`, goes through before `to`. */
export function skippedOn(config: Config, from: Environment, to: Environment): Environment[] {
  const usual = from.promotesTo[0];
  if (!usual || usual === to.branch) return [];
  const path: Environment[] = [];
  let at: Environment | undefined = from;
  while (at?.promotesTo[0] && at.promotesTo[0] !== to.branch) {
    const next = config.environments.find((e) => e.branch === at!.promotesTo[0]);
    if (!next || path.includes(next)) break;
    path.push(next);
    at = next;
  }
  // The usual path never reaches the destination: what's skipped is at least the usual next step.
  return at?.promotesTo[0] === to.branch ? path : path.slice(0, 1);
}

/** The environment-specific paths, as either branch lists them. */
function specificOn(run: Runner, root: string, config: Config, refs: string[]): string[] {
  if (!config.environmentSpecific) return [];
  const out = new Set<string>();
  for (const ref of refs) {
    const r = git(run, root, 'show', `${ref}:${config.environmentSpecific}`);
    if (r.code !== 0) continue;
    for (const l of r.stdout.split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#'))) out.add(l);
  }
  return [...out];
}

/** Works out a promotion from the branches on GitHub, after fetching them. Changes nothing. */
export function planPromotion(paths: RepoPaths, config: Config, fromName: string, toName: string | undefined, deps: Pick<PromoteDeps, 'run'>): PromotionPlan {
  const { run } = deps;
  const from = envByName(config, fromName);
  if (!from.promotesTo.length) throw new AccError('refused', `${from.name} doesn't promote anywhere: its "promotesTo" is empty.`);
  const to = toName ? envByName(config, toName) : envByName(config, from.promotesTo[0]!);
  if (!from.promotesTo.includes(to.branch)) throw new AccError('refused', `${from.name} can't promote to ${to.name}. Its "promotesTo" allows: ${from.promotesTo.join(', ')}.`);
  must(git(run, paths.root, 'fetch', '--quiet', 'origin', from.branch, to.branch), `Couldn't fetch ${from.branch} and ${to.branch}`);
  const src = `origin/${from.branch}`;
  const dst = `origin/${to.branch}`;
  const fromSha = must(git(run, paths.root, 'rev-parse', src), `No ${src}`).trim();
  const toSha = must(git(run, paths.root, 'rev-parse', dst), `No ${dst}`).trim();
  // What the source changed since the two last shared history, so changes made only in the destination stay.
  const parts = must(git(run, paths.root, 'diff', '--name-status', '--no-renames', '-z', `${dst}...${src}`), 'git diff failed').split('\0').filter(Boolean);
  const specific = specificOn(run, paths.root, config, [src, dst]);
  const blob = (ref: string, f: string) => git(run, paths.root, 'rev-parse', '--verify', '--quiet', `${ref}:${f}`).stdout.trim();
  const files: string[] = [];
  const deleted: string[] = [];
  const leftOut: string[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [status, f] = [parts[i]!, parts[i + 1]!];
    if (listed(f, specific)) { leftOut.push(f); continue; }
    const there = blob(dst, f);
    if (status.startsWith('D')) { if (there) deleted.push(f); continue; }
    // Already the same in the destination, from an earlier promotion: nothing to bring.
    if (there && there === blob(src, f)) continue;
    files.push(f);
  }
  return { from, to, skipped: skippedOn(config, from, to), files, deleted, leftOut, fromSha, toSha };
}

export interface PromoteResult {
  plan: PromotionPlan;
  branch: string | null;
  pr: { number: number; url: string } | null;
  validation: Outcome | null;
  /** Why no pull request was opened: nothing to promote, or validation didn't pass. */
  stopped: string | null;
  /** The tasks whose change it carries, each recorded so acc sync follows the pull request for it (D-???). */
  tasks: string[];
  /** The updates drafted for those tasks' tickets, for a person to post (D-066). */
  updates: { task: string; id: string; key: string }[];
  /** What didn't get done once the pull request was open: its tasks recorded, or their updates drafted. */
  warning: string | null;
}

const describeSkip = (plan: PromotionPlan) => plan.skipped.map((e) => `Skips \`${e.branch}\` (${e.name}): this change hasn't been validated there.`);

export function promotionBody(plan: PromotionPlan, validation: Outcome | null): string {
  const list = (xs: string[]) => (xs.length > 60 ? [...xs.slice(0, 60).map((f) => `- \`${f}\``), `- …and ${xs.length - 60} more`] : xs.map((f) => `- \`${f}\``));
  return [
    `Promotes \`${plan.from.branch}\` (${plan.from.name}) at ${plan.fromSha.slice(0, 7)} into \`${plan.to.branch}\` (${plan.to.name}).`,
    '',
    ...(plan.skipped.length ? ['> [!WARNING]', ...describeSkip(plan).map((l) => `> ${l}`), ''] : []),
    ...(plan.deleted.length ? ['> [!WARNING]', `> Deletes ${plan.deleted.length} file${plan.deleted.length === 1 ? '' : 's'} in \`${plan.to.branch}\`. That usually means the branches have drifted apart.`, ''] : []),
    `## Changes (${plan.files.length})`,
    '',
    ...list(plan.files),
    ...(plan.deleted.length ? ['', `## Deleted (${plan.deleted.length})`, '', ...list(plan.deleted)] : []),
    ...(plan.leftOut.length ? ['', '## Left out: environment-specific', '', ...list(plan.leftOut)] : []),
    ...(validation ? ['', '## Validation', '', `Check-only deploy to ${plan.to.name}: ${validation.status}. ${validation.summary}`] : []),
    '',
    '---',
    `Opened by \`acc promote\`. It merges only when a person merges it; deploying to ${plan.to.name} is a separate step after that.`,
  ].join('\n') + '\n';
}

/**
 * Builds the promotion branch from the destination, validates it against the destination's org when
 * there is one, pushes it as the repo's account, and opens the pull request. Never merges or deploys.
 */
/**
 * The promotion's own check: a check-only deploy of what it brings, to the destination's org. Unlike a
 * task's validate gate, it goes to a protected org too, since that's where a promotion is headed, and
 * runs the org's local tests when Apex changes. Nothing is saved to the org.
 */
export function promotionCheckArgs(org: string, source: string[]): string[] {
  const apex = source.some((f) => /\.(cls|trigger)(-meta\.xml)?$/.test(f));
  return ['project', 'deploy', 'start', '--dry-run', '--target-org', org, '--wait', '90', '--json', '--ignore-conflicts', ...source.flatMap((f) => ['--source-dir', f]), '--test-level', apex ? 'RunLocalTests' : 'NoTestRun'];
}

/**
 * Records the promotion on each task it carries, then drafts each ticket's update: the change is ready to
 * go on, with the pull request's link. Nothing is posted (D-066). The pull request stands either way; what
 * couldn't be done is said.
 */
function recordCarried(paths: RepoPaths, plan: PromotionPlan, pr: Promotion['pr'], carried: Task[], by: string, now: () => Date): Pick<PromoteResult, 'updates' | 'warning'> {
  const problems: string[] = [];
  const at = now().toISOString();
  try {
    mutate(paths, now, (ledger, emit) => {
      for (const c of carried) {
        const t = ledger.tasks.find((x) => x.id === c.id);
        if (!t) continue;
        const promotion: Promotion = { from: plan.from.branch, to: plan.to.branch, pr, state: 'open', at };
        t.promotions = [...(t.promotions ?? []), promotion];
        emit({ type: 'task.updated', task: t.id, actor: 'human', by, data: { promotion } });
      }
    });
  } catch (e) {
    problems.push(`Its tasks weren't recorded, so acc sync won't follow it for them: ${(e as Error).message}`);
  }
  const updates: PromoteResult['updates'] = [];
  try {
    for (const t of carried) {
      const u = draftUpdate(paths, t, { event: 'promotion-opened', env: plan.to.name, pr }, by, now);
      if (u) updates.push({ task: t.id, id: u.id, key: u.key });
    }
  } catch (e) {
    problems.push(`Its tickets' updates weren't all drafted: ${(e as Error).message}`);
  }
  return { updates, warning: problems.length ? `The pull request is open. ${problems.join(' ')}` : null };
}

export function promote(paths: RepoPaths, config: Config, fromName: string, toName: string | undefined, deps: PromoteDeps, opts: { allowDeletions?: boolean; validate?: boolean; by?: string } = {}): PromoteResult {
  const { run, now } = deps;
  const plan = planPromotion(paths, config, fromName, toName, deps);
  const none = { tasks: [], updates: [], warning: null };
  if (!plan.files.length && !plan.deleted.length) return { plan, branch: null, pr: null, validation: null, stopped: `${plan.to.name} already has everything from ${plan.from.name}.`, ...none };
  if (plan.deleted.length && !opts.allowDeletions) {
    throw new AccError('refused', `Promoting would delete ${plan.deleted.length} file(s) in ${plan.to.branch}, which usually means the branches have drifted apart: ${plan.deleted.slice(0, 5).join(', ')}${plan.deleted.length > 5 ? ', …' : ''}. Check them, then add --allow-deletions.`);
  }
  const gh = config.github;
  if (!gh) throw new AccError('no-github', 'acc promote opens a pull request on GitHub, and this project has no "github" section.');
  const stamp = now().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
  const branch = `promote/${plan.from.branch}-to-${plan.to.branch}-${stamp}`;
  const dir = mkdtempSync(join(tmpdir(), 'acc-promote-'));
  const wt = join(dir, 'wt');
  let validation: Outcome | null = null;
  try {
    deps.onStep?.(`Building ${branch} from ${plan.to.branch}`);
    must(git(run, paths.root, 'worktree', 'add', '--quiet', '-b', branch, wt, plan.toSha), 'Couldn\'t make the promotion worktree');
    for (let i = 0; i < plan.files.length; i += 200) must(git(run, wt, 'checkout', plan.fromSha, '--', ...plan.files.slice(i, i + 200)), 'Couldn\'t bring the changes over');
    for (let i = 0; i < plan.deleted.length; i += 200) must(git(run, wt, 'rm', '--quiet', '--', ...plan.deleted.slice(i, i + 200)), 'Couldn\'t remove the deleted files');
    must(git(run, wt, 'commit', '--quiet', '-m', `Promote ${plan.from.branch} to ${plan.to.branch}`, '-m', `${plan.files.length} changed, ${plan.deleted.length} deleted, from ${plan.fromSha.slice(0, 7)}.`), 'Couldn\'t commit the promotion');

    // Salesforce: a check-only deploy to the destination's org, before anyone is asked to merge it.
    const source = config.profile === 'salesforce' ? under(plan.files, packageDirs(wt)) : [];
    if (source.length && plan.to.org && opts.validate !== false) {
      deps.onStep?.(`Validating against ${plan.to.name} (${plan.to.org}). Nothing is saved to the org.`);
      const args = promotionCheckArgs(plan.to.org, source);
      assertCheckOnly('sf', args);
      const [cmd, a] = niced('sf', args);
      const r = withSlot(() => run(cmd, a, { cwd: wt, env: sfEnv(), timeoutMs: 120 * 60_000 }), { ...deps.slots });
      validation = readDeploy(r, plan.to.org, [], source.length);
      if (validation.status !== 'pass') {
        return { plan, branch: null, pr: null, validation, stopped: `Validation against ${plan.to.name} didn't pass: ${validation.summary}`, ...none };
      }
    }

    // What it carries is worked out before anything is pushed: once the pull request is open, it's recorded.
    const carried = carriedTasks(paths, run, plan);
    deps.onStep?.(`Pushing ${branch}`);
    must(run('git', ['push', '--quiet', '--set-upstream', 'origin', `${branch}:${branch}`], { cwd: wt, env: deps.env, timeoutMs: 5 * 60_000 }), `git push refused ${branch}`);
    const token = run('gh', ['auth', 'token', '-u', gh.account]);
    if (token.code !== 0) throw new AccError('no-github', `gh isn't logged in as ${gh.account}. The branch ${branch} is pushed; open its pull request on GitHub.`);
    const bodyFile = join(dir, 'body.md');
    writeFileSync(bodyFile, promotionBody(plan, validation));
    const title = `Promote ${plan.from.name} to ${plan.to.name}${plan.skipped.length ? ` (skips ${plan.skipped.map((e) => e.branch).join(', ')})` : ''}`;
    const create = run('gh', ['pr', 'create', '-R', gh.repo, '--base', plan.to.branch, '--head', branch, '--title', title, '--body-file', bodyFile], { cwd: paths.root, env: { ...deps.env, GH_TOKEN: token.stdout.trim() }, timeoutMs: 2 * 60_000 });
    const url = create.stdout.trim().split('\n').find((l) => /\/pull\/\d+/.test(l))?.trim();
    if (create.code !== 0 || !url) throw new AccError('land', `gh couldn't open the pull request: ${(create.stderr || create.stdout).trim().split('\n')[0]}. The branch ${branch} is pushed.`);
    const pr = { number: Number(/\/pull\/(\d+)/.exec(url)![1]), url };
    mkdirSync(paths.stateDir, { recursive: true });
    const tasks = carried.map((t) => t.id);
    appendFileSync(join(paths.stateDir, 'promotions.jsonl'), JSON.stringify({ at: now().toISOString(), from: plan.from.branch, to: plan.to.branch, fromSha: plan.fromSha, branch, pr, files: plan.files.length, deleted: plan.deleted.length, skipped: plan.skipped.map((e) => e.branch), tasks }) + '\n');
    return { plan, branch, pr, validation, stopped: null, tasks, ...recordCarried(paths, plan, pr, carried, opts.by ?? 'acc promote', now) };
  } finally {
    git(run, paths.root, 'worktree', 'remove', '--force', wt);
    // The branch lives on GitHub once pushed; locally it goes with its worktree.
    git(run, paths.root, 'branch', '-D', branch);
    git(run, paths.root, 'worktree', 'prune');
    rmSync(dir, { recursive: true, force: true });
  }
}

export const skipWarning = describeSkip;
