import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { arrivedAt } from './carried.ts';
import type { Config, Environment } from './config.ts';
import { AccError, parseJsonOutput, type RunResult, type Runner, sfEnv } from './exec.ts';
import { listed, listLines, niced, packageDirs, under } from './gates.ts';
import { withJob } from './jobs.ts';
import { readLedger, type Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { envByName } from './promote.ts';
import { type SlotOptions, withSlot } from './semaphore.ts';
import { NO_STEPS, type Steps } from './steps.ts';
import { plural } from './text.ts';
import { draftUpdate } from './updates.ts';

/**
 * Deploying (D-011, D-034): after a person merges, an environment's branch goes to its org, one
 * deploy at a time. Only what changed since the last deploy goes, never an environment-specific
 * file, and a protected org needs a person to confirm. It's the one command in acc that changes an
 * org, and builders and reviewers can never run it.
 */

export interface DeployRecord {
  env: string;
  org: string;
  sha: string;
  at: string;
  by: string;
  jobId: string | null;
  files: number;
}

export interface DeployPlan {
  env: Environment;
  org: string;
  /** The last deployed commit, or the one given to start from. */
  base: string;
  head: string;
  files: string[];
  deleted: string[];
  leftOut: string[];
  testLevel: 'NoTestRun' | 'RunLocalTests';
  /** A protected org: the deploy needs a person's confirmation. */
  confirm: boolean;
}

export const deployRecordPath = (paths: RepoPaths, env: string): string => join(paths.stateDir, 'deploys', `${env}.json`);

export function lastDeploy(paths: RepoPaths, env: string): DeployRecord | null {
  try {
    return JSON.parse(readFileSync(deployRecordPath(paths, env), 'utf8')) as DeployRecord;
  } catch {
    return null;
  }
}

const git = (run: Runner, cwd: string, ...args: string[]): RunResult => run('git', args, { cwd });

/** Works out a deploy, reporting its first two steps (T-65): the branch, then what changed on it. */
export function planDeploy(paths: RepoPaths, config: Config, envName: string, deps: { run: Runner; steps?: Steps }, opts: { since?: string; noTests?: boolean } = {}): DeployPlan {
  const steps = deps.steps ?? NO_STEPS;
  const { env, head, base } = steps.step('branch', 'Check the branch', () => deployBase(paths, config, envName, deps.run, opts));
  return steps.step('changes', 'Work out what changed', () => deployChanges(paths, config, deps.run, env, base, head, opts));
}

/** Where a deploy starts and ends: the last deployed commit, or the one given, and the branch's head on GitHub. */
function deployBase(paths: RepoPaths, config: Config, envName: string, run: Runner, opts: { since?: string; noTests?: boolean }): { env: Environment; head: string; base: string } {
  if (config.profile !== 'salesforce') throw new AccError('refused', 'acc deploy deploys Salesforce source to an org; this project isn\'t a Salesforce one.');
  const env = envByName(config, envName);
  if (!env.org) throw new AccError('refused', `${env.name} has no org alias in .acc/config.json.`);
  // Salesforce lets a sandbox skip tests, never production, and acc refuses it for any protected org too (D-056).
  if (opts.noTests && (env.type === 'production' || env.protected)) throw new AccError('refused', `${env.name} is ${env.type === 'production' ? 'production' : 'protected'}: its deploys run the tests. --no-tests is for sandboxes.`);
  const fetched = git(run, paths.root, 'fetch', '--quiet', 'origin', env.branch);
  if (fetched.code !== 0) throw new AccError('git', `Couldn't fetch ${env.branch}: ${fetched.stderr.trim().split('\n').pop()}`);
  const head = git(run, paths.root, 'rev-parse', `origin/${env.branch}`).stdout.trim();
  const last = lastDeploy(paths, env.branch);
  const since = opts.since ?? last?.sha;
  if (!since) throw new AccError('usage', `${env.name} hasn't been deployed by acc before, so say where to start: --since <the commit or tag the org already has>.`);
  const base = git(run, paths.root, 'rev-parse', '--verify', '--quiet', `${since}^{commit}`).stdout.trim();
  if (!base) throw new AccError('usage', `There's no commit "${since}" here.`);
  if (git(run, paths.root, 'merge-base', '--is-ancestor', base, head).code !== 0) throw new AccError('refused', `${since} isn't on ${env.branch}, so it can't be where the org's deploy starts.`);
  return { env, head, base };
}

/** What changed on the branch between the two, sorted into files to deploy, deletions, and environment-specific files left out. */
function deployChanges(paths: RepoPaths, config: Config, run: Runner, env: Environment, base: string, head: string, opts: { noTests?: boolean }): DeployPlan {
  const r = git(run, paths.root, 'diff', '--name-status', '--no-renames', '-z', base, head);
  const parts = r.stdout.split('\0').filter(Boolean);
  // Read sfdx-project.json and the environment-specific list as the branch has them.
  const show = (f: string) => git(run, paths.root, 'show', `${head}:${f}`);
  const sfdx = show('sfdx-project.json');
  const dirs = (() => {
    if (sfdx.code !== 0) return ['force-app'];
    const tmp = mkdtempSync(join(tmpdir(), 'acc-sfdx-'));
    try {
      writeFileSync(join(tmp, 'sfdx-project.json'), sfdx.stdout);
      return packageDirs(tmp);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  })();
  const specific = config.environmentSpecific ? listLines(show(config.environmentSpecific).stdout) : [];
  const files: string[] = [];
  const deleted: string[] = [];
  const leftOut: string[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [status, f] = [parts[i]!, parts[i + 1]!];
    if (!under([f], dirs).length) continue;
    if (listed(f, specific)) leftOut.push(f);
    else if (status.startsWith('D')) deleted.push(f);
    else files.push(f);
  }
  const apex = files.some((f) => /\.(cls|trigger)(-meta\.xml)?$/.test(f));
  return { env, org: env.org!, base, head, files, deleted, leftOut, testLevel: apex && !opts.noTests ? 'RunLocalTests' : 'NoTestRun', confirm: env.protected };
}

export interface DeployResult {
  plan: DeployPlan;
  deployed: boolean;
  jobId: string | null;
  summary: string;
  /** The updates drafted for the tickets of the tasks it carried, for a person to post (D-066). */
  updates: { task: string; id: string; key: string }[];
}

/**
 * The tasks a deploy carried to its org: each whose change reached the environment's branch at a commit
 * that's in what was deployed, after the last deploy and up to the new head. It reached it by its own
 * merge, or by a promotion's (D-075). A squash merge's commit is the one acc sync recorded; a task merged
 * before acc recorded it falls back to its branch's commit, which a squash leaves off the branch, so it's
 * missed (D-066).
 */
export function deployedTasks(paths: RepoPaths, run: Runner, plan: Pick<DeployPlan, 'env' | 'base' | 'head'>): Task[] {
  const on = (sha: string, tip: string) => git(run, paths.root, 'merge-base', '--is-ancestor', sha, tip).code === 0;
  return readLedger(paths.ledger).tasks.filter((t) => {
    const sha = arrivedAt(t, plan.env.branch);
    return !!sha && on(sha, plan.head) && !on(sha, plan.base);
  });
}

/** The deploy's sf arguments. A deploy, so the gates' check-only guard doesn't apply; nothing else builds these. */
export function deployArgs(plan: DeployPlan): string[] {
  return ['project', 'deploy', 'start', '--target-org', plan.org, '--wait', '90', '--json', '--test-level', plan.testLevel, ...plan.files.flatMap((f) => ['--source-dir', f])];
}

type DeployDeps = { run: Runner; now: () => Date; slots?: SlotOptions; onWait?: () => void; steps?: Steps };
type DeployOpts = { since?: string; confirmed?: boolean; noTests?: boolean; by: string };

/** A deploy, with a marker saying it's under way while it runs, so every window shows it (D-092). */
export function deploy(paths: RepoPaths, config: Config, envName: string, deps: DeployDeps, opts: DeployOpts): DeployResult {
  const env = config.environments.find((x) => x.branch === envName.toLowerCase() || x.name.toLowerCase() === envName.toLowerCase());
  return withJob(paths, { kind: 'deploy', env: env?.branch ?? envName, by: opts.by }, () => deployNow(paths, config, envName, deps, opts), deps.now);
}

function deployNow(paths: RepoPaths, config: Config, envName: string, deps: DeployDeps, opts: DeployOpts): DeployResult {
  const { run, now } = deps;
  const steps = deps.steps ?? NO_STEPS;
  const plan = planDeploy(paths, config, envName, deps, opts);
  if (!plan.files.length && !plan.deleted.length) return { plan, deployed: false, jobId: null, summary: `${plan.env.name} already has ${plan.env.branch} at ${plan.head.slice(0, 7)}.`, updates: [] };
  steps.step('ready', `Check it can go to ${plan.env.name}`, () => {
    if (plan.deleted.length) {
      throw new AccError('refused', `${plan.deleted.length} file(s) were deleted on ${plan.env.branch} since the last deploy (${plan.deleted.slice(0, 5).join(', ')}${plan.deleted.length > 5 ? ', …' : ''}). acc doesn't deploy deletions; remove them from the org by hand, or with a destructive-changes manifest.`);
    }
    if (plan.confirm && !opts.confirmed) throw new AccError('refused', `${plan.env.name} is protected. Deploying to it needs a person's confirmation: add --confirm-production.`);
  });
  if (!plan.files.length) return { plan, deployed: false, jobId: null, summary: 'Nothing deployable changed.', updates: [] };
  const dir = mkdtempSync(join(tmpdir(), 'acc-deploy-'));
  const wt = join(dir, 'wt');
  try {
    steps.step('checkout', `Check out ${plan.env.branch} at ${plan.head.slice(0, 7)}`, () => {
      const add = git(run, paths.root, 'worktree', 'add', '--quiet', '--detach', wt, plan.head);
      if (add.code !== 0) throw new AccError('git', `Couldn't check out ${plan.head.slice(0, 7)}: ${add.stderr.trim()}`);
    });
    steps.start('deploy', `Deploy to ${plan.env.name}`, `${plural(plan.files.length, 'file')}, ${plan.testLevel === 'RunLocalTests' ? 'with the org\'s local tests' : 'no tests'}`);
    const [cmd, args] = niced('sf', deployArgs(plan));
    const owner = { what: `Deploy ${plan.env.branch}`, env: plan.env.branch, project: config.project };
    const r = withSlot(() => run(cmd, args, { cwd: wt, env: sfEnv(), timeoutMs: 120 * 60_000 }), { owner, ...deps.slots, onWait: deps.onWait });
    let result: { status?: number; message?: string; result?: { id?: string; success?: boolean; status?: string; details?: { componentFailures?: { fullName?: string; problem?: string }[] | { fullName?: string; problem?: string } } } };
    try {
      result = parseJsonOutput(r.stdout);
    } catch {
      throw new AccError('deploy', `sf gave no result: ${(r.stderr || r.stdout).trim().split('\n').pop() ?? ''}`);
    }
    const jobId = result.result?.id ?? null;
    if (r.code !== 0 || result.status !== 0 || result.result?.success === false) {
      const failures = result.result?.details?.componentFailures;
      const list = (Array.isArray(failures) ? failures : failures ? [failures] : []).slice(0, 3).map((f) => `${f.fullName}: ${f.problem}`);
      const why = list.join('; ') || result.message || 'see sf\'s output';
      steps.fail('deploy', why);
      return { plan, deployed: false, jobId, summary: `The deploy to ${plan.env.name} failed${jobId ? ` (job ${jobId})` : ''}: ${why}`, updates: [] };
    }
    steps.done('deploy', jobId ? `Job ${jobId}` : undefined);
    steps.step('record', 'Record the deploy', () => {
      const record: DeployRecord = { env: plan.env.branch, org: plan.org, sha: plan.head, at: now().toISOString(), by: opts.by, jobId, files: plan.files.length };
      const file = deployRecordPath(paths, plan.env.branch);
      mkdirSync(join(paths.stateDir, 'deploys'), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(record, null, 2) + '\n');
      renameSync(`${file}.tmp`, file);
    });
    // Each ticket whose change went can hear so, once a person posts it. acc posts nothing (D-066).
    steps.start('updates', 'Draft the tickets\' updates');
    const updates: DeployResult['updates'] = [];
    let unsaid = '';
    try {
      for (const t of deployedTasks(paths, run, plan)) {
        const u = draftUpdate(paths, t, { event: 'deployed', env: plan.env.name }, opts.by, now);
        if (u) updates.push({ task: t.id, id: u.id, key: u.key });
      }
      steps.done('updates', updates.length ? `${updates.length} drafted` : 'No ticket\'s change went');
    } catch (e) {
      unsaid = ` Its tickets' updates weren't all drafted: ${(e as Error).message}`;
      steps.fail('updates', (e as Error).message);
    }
    return { plan, deployed: true, jobId, summary: `Deployed ${plan.files.length} file(s) from ${plan.env.branch} at ${plan.head.slice(0, 7)} to ${plan.env.name}${jobId ? ` (job ${jobId})` : ''}.${unsaid}`, updates };
  } finally {
    git(run, paths.root, 'worktree', 'remove', '--force', wt);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}
