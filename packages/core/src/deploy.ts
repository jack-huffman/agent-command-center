import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config, Environment } from './config.ts';
import { AccError, parseJsonOutput, type RunResult, type Runner, sfEnv } from './exec.ts';
import { listed, niced, packageDirs, under } from './gates.ts';
import type { RepoPaths } from './paths.ts';
import { envByName } from './promote.ts';
import { type SlotOptions, withSlot } from './semaphore.ts';

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

export function planDeploy(paths: RepoPaths, config: Config, envName: string, deps: { run: Runner }, opts: { since?: string; noTests?: boolean } = {}): DeployPlan {
  const { run } = deps;
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
  const specific = config.environmentSpecific ? show(config.environmentSpecific).stdout.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : [];
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
  return { env, org: env.org, base, head, files, deleted, leftOut, testLevel: apex && !opts.noTests ? 'RunLocalTests' : 'NoTestRun', confirm: env.protected };
}

export interface DeployResult {
  plan: DeployPlan;
  deployed: boolean;
  jobId: string | null;
  summary: string;
}

/** The deploy's sf arguments. A deploy, so the gates' check-only guard doesn't apply; nothing else builds these. */
export function deployArgs(plan: DeployPlan): string[] {
  return ['project', 'deploy', 'start', '--target-org', plan.org, '--wait', '90', '--json', '--test-level', plan.testLevel, ...plan.files.flatMap((f) => ['--source-dir', f])];
}

export function deploy(paths: RepoPaths, config: Config, envName: string, deps: { run: Runner; now: () => Date; slots?: SlotOptions; onWait?: () => void }, opts: { since?: string; confirmed?: boolean; noTests?: boolean; by: string }): DeployResult {
  const { run, now } = deps;
  const plan = planDeploy(paths, config, envName, deps, opts);
  if (!plan.files.length && !plan.deleted.length) return { plan, deployed: false, jobId: null, summary: `${plan.env.name} already has ${plan.env.branch} at ${plan.head.slice(0, 7)}.` };
  if (plan.deleted.length) {
    throw new AccError('refused', `${plan.deleted.length} file(s) were deleted on ${plan.env.branch} since the last deploy (${plan.deleted.slice(0, 5).join(', ')}${plan.deleted.length > 5 ? ', …' : ''}). acc doesn't deploy deletions; remove them from the org by hand, or with a destructive-changes manifest.`);
  }
  if (plan.confirm && !opts.confirmed) throw new AccError('refused', `${plan.env.name} is protected. Deploying to it needs a person's confirmation: add --confirm-production.`);
  if (!plan.files.length) return { plan, deployed: false, jobId: null, summary: 'Nothing deployable changed.' };
  const dir = mkdtempSync(join(tmpdir(), 'acc-deploy-'));
  const wt = join(dir, 'wt');
  try {
    const add = git(run, paths.root, 'worktree', 'add', '--quiet', '--detach', wt, plan.head);
    if (add.code !== 0) throw new AccError('git', `Couldn't check out ${plan.head.slice(0, 7)}: ${add.stderr.trim()}`);
    const [cmd, args] = niced('sf', deployArgs(plan));
    const r = withSlot(() => run(cmd, args, { cwd: wt, env: sfEnv(), timeoutMs: 120 * 60_000 }), { ...deps.slots, onWait: deps.onWait });
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
      return { plan, deployed: false, jobId, summary: `The deploy to ${plan.env.name} failed${jobId ? ` (job ${jobId})` : ''}: ${list.join('; ') || result.message || 'see sf\'s output'}` };
    }
    const record: DeployRecord = { env: plan.env.branch, org: plan.org, sha: plan.head, at: now().toISOString(), by: opts.by, jobId, files: plan.files.length };
    const file = deployRecordPath(paths, plan.env.branch);
    mkdirSync(join(paths.stateDir, 'deploys'), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(record, null, 2) + '\n');
    renameSync(`${file}.tmp`, file);
    return { plan, deployed: true, jobId, summary: `Deployed ${plan.files.length} file(s) from ${plan.env.branch} at ${plan.head.slice(0, 7)} to ${plan.env.name}${jobId ? ` (job ${jobId})` : ''}.` };
  } finally {
    git(run, paths.root, 'worktree', 'remove', '--force', wt);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}
