/**
 * Deploying one ticket to its next environment (T-137, D-219), for the salesforce profile (D-003). A person
 * asks for one task and one environment on its path after where its change is now (D-018). acc cuts a branch
 * from that environment's branch with only the ticket's own commits, cherry-picked in order, and Salesforce's
 * CLI maps what they change to components, as the ticket's manifest is built (D-191). Environment-specific
 * files stay out (D-016); deletions and record changes become steps a person makes by hand (D-190). A
 * check-only deploy comes first and changes nothing. The deploy needs the person's yes with that check's id,
 * and the typed name of a protected or production org; it is the checked job, quick-deployed where Salesforce
 * allows. Then the branch's pull request is merged, so the environment's branch holds the ticket too, and the
 * deploy is kept on the task, so a later deploy of the whole branch doesn't send it again (D-206).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileId } from './analyze.ts';
import { writeAtomic } from './atomic.ts';
import { arrivedAt } from './carried.ts';
import { addPromotionSteps, stepsOf } from './change-steps.ts';
import { mergeCommitPaths } from './changes.ts';
import { type Config, type Environment, environmentByBranch } from './config.ts';
import { askOrgFor, orgDisplayArgs, orgLockDir, readOrgDisplay, type TaskDeploy } from './deploy-gate.ts';
import { environmentNamed } from './drift.ts';
import { AccError, type RunResult, type Runner, sfEnv } from './exec.ts';
import { APEX, assertCheckOnly, deployProblems, lastLine, listed, listLines, packageDirs, parseDeployJson, readList, under } from './gates.ts';
import { git, must } from './git-must.ts';
import { withJob } from './jobs.ts';
import { mutate, type Promotion, readLedger, type Task } from './ledger.ts';
import { generateManifest, type ManifestType, manifestTypes, sourceApiVersion } from './manifest.ts';
import { mergeMethod } from './merge.ts';
import { branchRef, nulPaths, taskList } from './overlap.ts';
import type { RepoPaths } from './paths.ts';
import { type SlotOptions, withSlot } from './semaphore.ts';
import { sfComponent } from './sf-metadata.ts';
import { NO_STEPS, type Steps } from './steps.ts';
import { plural } from './text.ts';
import { draftUpdate } from './updates.ts';
import { DELETION_KIND } from './deletion-kind.ts';
import { outsideOf } from './outside-changes.ts';

/** A command, as every action is one: its id, what it takes, and whether it can run now, with why not. */
export interface TaskCommand<S> {
  id: string;
  params: string;
  enabled(s: S): { ok: true } | { ok: false; why: string };
}

/** Where a ticket's change is now, and the environments it may go to next, the usual one first. */
export interface TicketPlace {
  at: Environment;
  next: Environment[];
}

/**
 * Where a ticket's change is now: the last place it reached, by time. Its own environment, then each
 * environment a person deployed it to, or a promotion took it to and merged. Null when its environment isn't
 * in the settings.
 */
export function ticketPlace(config: Pick<Config, 'environments'>, t: Pick<Task, 'environment' | 'promotions' | 'deploys'>): TicketPlace | null {
  const reached: { env: string; at: string }[] = [{ env: t.environment, at: '' }];
  for (const p of t.promotions ?? []) if (p.state === 'merged') reached.push({ env: p.to, at: p.mergedAt ?? p.at });
  for (const d of t.deploys ?? []) if (d.checkId) reached.push({ env: d.env, at: d.at });
  const last = reached.reduce((a, b) => (b.at >= a.at && environmentByBranch(config, b.env) ? b : a));
  const at = environmentByBranch(config, last.env);
  if (!at) return null;
  return { at, next: at.promotesTo.map((b) => environmentByBranch(config, b)).filter((e): e is Environment => !!e) };
}

/**
 * Where this deploy may go: `to`, or the usual next step when none is named. Only a next step from where the
 * change is now; anything else is refused, with why.
 */
export function taskDeployRoute(config: Pick<Config, 'environments'>, t: Pick<Task, 'id' | 'environment' | 'promotions' | 'deploys'>, to?: string): { from: Environment; to: Environment } {
  const place = ticketPlace(config, t);
  if (!place) throw new AccError('refused', `${t.id}'s environment, ${t.environment}, isn't in the project's settings.`);
  const next = place.next.map((e) => e.name).join(', ');
  if (!to) {
    if (!place.next.length) throw new AccError('refused', `${t.id} is in ${place.at.name}, the end of its path: there's nowhere further to deploy it.`);
    return { from: place.at, to: place.next[0]! };
  }
  const want = environmentNamed(config, to);
  if (want.branch === place.at.branch) throw new AccError('refused', `${t.id} is in ${want.name} already.${next ? ` Its next step is ${next}.` : ''}`);
  if (!place.at.promotesTo.includes(want.branch)) {
    throw new AccError('refused', `${want.name} isn't a next step for ${t.id}: its change is in ${place.at.name}, which goes on to ${next || 'nowhere'}. A ticket goes one step at a time along its path.`);
  }
  return { from: place.at, to: want };
}

/** Why this task can't be deployed from its ticket now, or that it can. */
export function taskDeployEnabled(config: Pick<Config, 'profile' | 'environments' | 'github'>, t: Pick<Task, 'id' | 'state' | 'environment' | 'promotions' | 'deploys' | 'pr' | 'run'> | undefined): { ok: true } | { ok: false; why: string } {
  if (config.profile !== 'salesforce') return { ok: false, why: 'Deploying a ticket sends Salesforce components to an org, and this isn\'t a Salesforce project.' };
  if (!t) return { ok: false, why: 'There\'s no such task.' };
  if (!config.github) return { ok: false, why: 'Deploying a ticket keeps its environment\'s branch in step through a pull request, and this project isn\'t on GitHub.' };
  if (t.state === 'running') return { ok: false, why: `${t.id}'s builder is working on it now. Wait for it to finish.` };
  if (t.pr?.state !== 'merged' && !t.run?.branch) return { ok: false, why: `${t.id} has no work yet: build it first.` };
  const place = ticketPlace(config, t);
  if (!place) return { ok: false, why: `${t.id}'s environment, ${t.environment}, isn't in the project's settings.` };
  if (!place.next.length) return { ok: false, why: `${t.id} is in ${place.at.name}, the end of its path.` };
  return { ok: true };
}

/** Deploy one ticket: the CLI's and the extension's. */
export const TASK_DEPLOY_COMMAND: TaskCommand<{ config: Pick<Config, 'profile' | 'environments' | 'github'>; task: Parameters<typeof taskDeployEnabled>[1] }> = {
  id: 'acc.task.deploy',
  params: 'The task\'s id, and the environment to deploy it to (its next step when left out); then the check\'s id as the person\'s yes, and the org\'s name typed for a protected or production org.',
  enabled: ({ config, task }) => taskDeployEnabled(config, task),
};

// ---------------------------------------------------------------- the ticket's own commits

/** A commit of the ticket's, and for a merge commit, the parent its change is read against. */
export interface TicketCommit {
  sha: string;
  mainline?: 1;
}

/**
 * The ticket's own commits, oldest first: once it has merged, the one its merge left on its environment's
 * branch (a merge commit read against its first parent); before, its branch's commits since it left that
 * branch, without the merges that took the branch's newer work in.
 */
export function ticketCommits(run: Runner, root: string, t: Pick<Task, 'id' | 'environment' | 'pr' | 'run'>): TicketCommit[] {
  if (t.pr?.state === 'merged') {
    const sha = t.pr.mergeSha ?? t.pr.sha;
    if (!sha || git(run, root, 'rev-parse', '--verify', '--quiet', `${sha}^{commit}`).code !== 0) throw new AccError('git', `${t.id}'s merge commit isn't in this clone, so its commits can't be read. Fetch ${t.environment} and try again.`);
    const parents = git(run, root, 'rev-list', '--parents', '-n', '1', sha).stdout.trim().split(/\s+/);
    return [parents.length > 2 ? { sha, mainline: 1 } : { sha }];
  }
  const branch = t.run?.branch;
  const ref = branch ? branchRef(run, root, branch, { fetch: true }) : null;
  if (!ref) throw new AccError('refused', `${t.id} has no commits here yet: its branch isn't in this clone.`);
  const base = [`origin/${t.environment}`, t.environment].find((b) => git(run, root, 'rev-parse', '--verify', '--quiet', `${b}^{commit}`).code === 0);
  if (!base) throw new AccError('git', `There's no ${t.environment} branch here to read ${t.id}'s commits from.`);
  const list = git(run, root, 'rev-list', '--reverse', '--no-merges', `${base}..${ref}`).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!list.length) throw new AccError('refused', `${t.id}'s branch has no commits of its own yet.`);
  return list.map((sha) => ({ sha }));
}

// ---------------------------------------------------------------- the plan

/** A deletion the ticket makes, which a person makes by hand in the org. */
export interface HandDeletion {
  path: string;
  component: string;
}

/** The check-only deploy's result. */
export interface TaskDeployCheck {
  passed: boolean;
  id: string | null;
  summary: string;
  /** The org's errors, per component, when it failed. */
  problems: string[];
}

export interface TaskDeployPlan {
  task: string;
  key: string;
  from: Environment;
  to: Environment;
  org: string;
  /** Production by the settings or by what Salesforce says, or protected: the org's name is typed to deploy. */
  confirm: boolean;
  /** What the person types for a protected org: its environment's name, or its org's alias. */
  confirmName: string;
  commits: string[];
  /** The destination branch's commit the ticket's commits were put on. */
  base: string;
  /** The source files that deploy. */
  files: string[];
  /** The ticket's other files: in its pull request, not deployed. */
  gitOnly: string[];
  /** Environment-specific: left out of the deploy and the branch (D-016). */
  leftOut: string[];
  deletions: HandDeletion[];
  /** Its record changes, in words: steps to make by hand in the destination's org (D-190). */
  records: string[];
  /** The components that deploy, by type, as Salesforce's CLI maps them. */
  types: ManifestType[];
  testLevel: 'NoTestRun' | 'RunLocalTests';
  tests: string;
  check: TaskDeployCheck | null;
}

/** A plan's check, as acc keeps it until the deploy, so the yes is for what was checked. */
export interface KeptCheck {
  v: 1;
  task: string;
  env: string;
  org: string;
  id: string;
  passed: boolean;
  commits: string[];
  /** Each file that deploys, with its git blob: what the check sent. */
  blobs: Record<string, string>;
  testLevel: TaskDeployPlan['testLevel'];
  at: string;
  by: string;
}

/** The start of a plan's id when nothing of the ticket deploys and the org isn't asked: its yes is for its commits alone. */
export const NOTHING_TO_CHECK = 'none-';

export const keptCheckPath =(paths: Pick<RepoPaths, 'stateDir'>, task: string): string => join(paths.stateDir, 'task-deploys', `${fileId(task)}.json`);

export function readKeptCheck(paths: Pick<RepoPaths, 'stateDir'>, task: string): KeptCheck | null {
  try {
    const k = JSON.parse(readFileSync(keptCheckPath(paths, task), 'utf8')) as KeptCheck;
    return k.v === 1 && k.task === task ? k : null;
  } catch {
    return null;
  }
}

export interface TaskDeployDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  steps?: Steps;
  slots?: SlotOptions;
  /** Where the org's deploys take turns, when not acc's own folder (a test's). */
  orgLocks?: string;
  onWait?: () => void;
}

export interface TaskDeployOpts {
  noTests?: boolean;
  by: string;
}

/** The check-only deploy's sf arguments: the ticket's manifest, with the org's local tests when Apex is in it. */
export function taskCheckArgs(org: string, manifest: string, testLevel: TaskDeployPlan['testLevel']): string[] {
  return ['project', 'deploy', 'start', '--dry-run', '--manifest', manifest, '--target-org', org, '--wait', '90', '--json', '--test-level', testLevel];
}

/**
 * The deploy's sf arguments: a quick deploy of the checked job where Salesforce allows one, a check that ran
 * tests; else a deploy of the same manifest at the same commit, without tests, as the sandbox's check was.
 */
export function taskDeployArgs(org: string, manifest: string, check: Pick<KeptCheck, 'id' | 'testLevel'>): string[] {
  if (check.testLevel === 'RunLocalTests') return ['project', 'deploy', 'quick', '--job-id', check.id, '--target-org', org, '--wait', '90', '--json'];
  return ['project', 'deploy', 'start', '--manifest', manifest, '--target-org', org, '--wait', '90', '--json', '--test-level', 'NoTestRun'];
}

interface Built {
  plan: TaskDeployPlan;
  task: Task;
  wt: string;
  branch: string;
  manifest: string;
  blobs: Record<string, string>;
  username: string;
}

/** The ticket's files that a cherry-pick left in conflict, with the other tickets that changed each. */
function conflictWords(paths: RepoPaths, run: Runner, wt: string, t: Task, to: Environment): string {
  const files = nulPaths(git(run, wt, 'diff', '--name-only', '--diff-filter=U', '-z').stdout);
  const others = readLedger(paths.ledger).tasks.filter((o) => o.id !== t.id && !arrivedAt(o, to.branch));
  const owners = (f: string) => others.filter((o) => (o.changes?.paths ?? (o.pr?.mergeSha ? mergeCommitPaths(run, paths.root, o.pr.mergeSha) : null) ?? []).includes(f)).map((o) => o.id);
  const each = files.map((f) => { const who = owners(f); return who.length ? `${f} (also changed by ${taskList(who)}, not in ${to.name} yet)` : f; });
  return each.length ? each.join(', ') : 'git didn\'t say which files';
}

/** Each other task this one depends on that isn't in the destination yet. */
export function missingDeps(tasks: Task[], t: Task, to: Environment): string[] {
  return t.deps.filter((id) => {
    const d = tasks.find((x) => x.id === id);
    if (!d) return false;
    return !arrivedAt(d, to.branch) && !(d.deploys ?? []).some((x) => x.env === to.branch && x.checkId);
  });
}

/**
 * The branch, built in a scratch worktree: the destination's branch with the ticket's commits on it, its
 * environment-specific files kept as the destination has them, and what it changes sorted out. `fn` runs with
 * it; the worktree and its local branch go after, whatever happens.
 */
function withBuilt<T>(paths: RepoPaths, config: Config, id: string, toName: string | undefined, deps: TaskDeployDeps, opts: TaskDeployOpts, fn: (b: Built) => T): T {
  const { run } = deps;
  const steps = deps.steps ?? NO_STEPS;
  const { task, from, to, shown } = steps.step('route', 'Check where it can go', () => {
    const tasks = readLedger(paths.ledger).tasks;
    const task = tasks.find((t) => t.id === id);
    const can = taskDeployEnabled(config, task);
    if (!can.ok) throw new AccError('refused', can.why);
    const { from, to } = taskDeployRoute(config, task!, toName);
    if (!to.org) throw new AccError('refused', `${to.name} has no org in the project's settings.`);
    const waiting = missingDeps(tasks, task!, to);
    if (waiting.length) throw new AccError('refused', `${id} depends on ${taskList(waiting)}, which ${waiting.length === 1 ? 'isn\'t' : 'aren\'t'} in ${to.name} yet. Deploy ${taskList(waiting)} to ${to.name} first.`);
    const shown = readOrgDisplay(run('sf', orgDisplayArgs(to.org), { env: sfEnv(), timeoutMs: 2 * 60_000 }));
    if (!shown) throw new AccError('sf', `Couldn't ask Salesforce which org ${to.org} is: is it logged in on this machine? Nothing was changed.`);
    const production = to.type === 'production' || shown.kind === 'production';
    // Salesforce lets a sandbox skip tests, never production, and acc refuses it for a protected org too (D-056).
    if (opts.noTests && (production || to.protected)) throw new AccError('refused', `${to.name} is ${production ? 'production' : 'protected'}: its deploys run the tests. Skipping them is for sandboxes.`);
    return { task: task!, from, to, shown };
  });
  const commits = steps.step('commits', `Read ${id}'s commits`, () => {
    must(git(run, paths.root, 'fetch', '--quiet', 'origin', to.branch, task.environment), `Couldn't fetch ${to.branch}`);
    return ticketCommits(run, paths.root, task);
  });
  const base = must(git(run, paths.root, 'rev-parse', `origin/${to.branch}`), `No origin/${to.branch}`).trim();
  const stamp = deps.now().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
  const branch = `deploy/${fileId(id)}-to-${to.branch}-${stamp}`;
  const dir = mkdtempSync(join(tmpdir(), 'acc-task-deploy-'));
  const wt = join(dir, 'wt');
  try {
    const raw = steps.step('build', `Put ${id}'s commits on ${to.branch}`, () => {
      must(git(run, paths.root, 'worktree', 'add', '--quiet', '-b', branch, wt, base), 'Couldn\'t make the deploy\'s worktree');
      for (const c of commits) {
        const r = git(run, wt, 'cherry-pick', '--empty=drop', ...(c.mainline ? ['-m', '1'] : []), c.sha);
        if (r.code !== 0) {
          const words = conflictWords(paths, run, wt, task, to);
          git(run, wt, 'cherry-pick', '--abort');
          throw new AccError('conflict', `${id}'s commit ${c.sha.slice(0, 7)} doesn't go onto ${to.branch} cleanly: ${words}. Nothing was deployed or pushed. Deploy those tickets to ${to.name} first, or resolve it on ${to.branch} by hand.`);
        }
      }
      const parts = nulPaths(git(run, wt, 'diff', '--name-status', '--no-renames', '-z', base, 'HEAD').stdout);
      const changes: { status: string; path: string }[] = [];
      for (let i = 0; i + 1 < parts.length; i += 2) changes.push({ status: parts[i]!, path: parts[i + 1]! });
      return changes;
    });
    const sorted = steps.step('changes', 'Work out what deploys', () => {
      const specific = [...new Set([...readList(wt, config.environmentSpecific), ...(config.environmentSpecific ? listLinesAt(run, paths.root, base, config.environmentSpecific) : [])])];
      const leftOut = raw.filter((c) => listed(c.path, specific)).map((c) => c.path);
      // Environment-specific files stay as the destination has them, in git too.
      if (leftOut.length) {
        for (const f of leftOut) {
          const there = git(run, wt, 'cat-file', '-e', `${base}:${f}`).code === 0;
          must(there ? git(run, wt, 'checkout', base, '--', f) : git(run, wt, 'rm', '--quiet', '--', f), `Couldn't keep ${to.branch}'s own ${f}`);
        }
        must(git(run, wt, 'commit', '--quiet', '-m', `Keep ${to.branch}'s own environment-specific files`), 'Couldn\'t commit the environment-specific files');
      }
      const dirs = packageDirs(wt);
      const kept = raw.filter((c) => !leftOut.includes(c.path));
      const gitOnly = kept.filter((c) => !under([c.path], dirs).length).map((c) => c.path);
      const source = kept.filter((c) => under([c.path], dirs).length);
      // A file deleted from a component the branch still holds, such as one file of a bundle, changes it: its other files deploy.
      const held = under(nulPaths(git(run, wt, 'ls-files', '-z').stdout), dirs);
      const keyOf = (p: string) => { const c = sfComponent(p); return c ? `${c.type}:${c.name}` : null; };
      const files = new Set(source.filter((c) => !c.status.startsWith('D')).map((c) => c.path));
      const deletions: HandDeletion[] = [];
      for (const d of source.filter((c) => c.status.startsWith('D'))) {
        const key = keyOf(d.path);
        const rest = key ? held.find((h) => keyOf(h) === key) : undefined;
        if (rest) files.add(rest);
        else { const c = sfComponent(d.path); deletions.push({ path: d.path, component: c ? `${c.label}: ${c.name}` : d.path }); }
      }
      return { files: [...files].sort(), gitOnly, leftOut, deletions };
    });
    const out = join(dir, 'out');
    const pkg = sorted.files.length ? steps.step('manifest', 'Map the components with Salesforce\'s CLI', () => generateManifest(run, wt, sorted.files, sourceApiVersion(wt), out)) : '';
    const manifest = join(out, 'package.xml');
    if (pkg) { mkdirSync(out, { recursive: true }); writeFileSync(manifest, pkg); }
    const blobs: Record<string, string> = {};
    for (const f of sorted.files) blobs[f] = git(run, wt, 'rev-parse', `HEAD:${f}`).stdout.trim();
    const stepping = structuredClone(task);
    addPromotionSteps(stepping, to, deps.now().toISOString());
    const testLevel = sorted.files.some((f) => APEX.test(f)) && !opts.noTests ? 'RunLocalTests' : 'NoTestRun';
    const production = to.type === 'production' || shown.kind === 'production';
    const plan: TaskDeployPlan = {
      task: id, key: task.source.key ?? id, from, to, org: to.org!, confirm: production || to.protected, confirmName: to.name,
      commits: commits.map((c) => c.sha), base, ...sorted,
      records: stepsOf(stepping, to.branch).filter((s) => s.step.state === 'todo' && s.change.kind !== DELETION_KIND.kind).map((s) => s.words),
      types: pkg ? manifestTypes(pkg) : [], testLevel,
      tests: testLevel === 'RunLocalTests' ? `The org's local tests, since Apex is in it` : opts.noTests ? 'None: skipped, as asked' : 'None: no Apex is in it',
      check: null,
    };
    return fn({ plan, task, wt, branch, manifest, blobs, username: shown.username });
  } finally {
    git(run, paths.root, 'worktree', 'remove', '--force', wt);
    git(run, paths.root, 'branch', '-D', branch);
    git(run, paths.root, 'worktree', 'prune');
    rmSync(dir, { recursive: true, force: true });
  }
}

/** An environment-specific list as a commit holds it. */
const listLinesAt = (run: Runner, root: string, ref: string, file: string): string[] => {
  const r = git(run, root, 'show', `${ref}:${file}`);
  return r.code === 0 ? listLines(r.stdout) : [];
};

/** sf's deploy result as acc reads it: passed, its id, and the org's errors per component. */
function readResult(r: RunResult, what: string, org: string, total: number): TaskDeployCheck {
  type J = { status?: number; message?: string; result?: Parameters<typeof deployProblems>[0] & { id?: string; success?: boolean; status?: string; numberComponentsTotal?: number; numberTestsCompleted?: number } };
  let j: J;
  try {
    j = parseDeployJson<J>(r);
  } catch {
    return { passed: false, id: null, summary: `Salesforce's CLI gave no result: ${lastLine(r.stderr || r.stdout) || `exit ${r.code}`}`, problems: [] };
  }
  const res = j.result;
  const id = res?.id ?? null;
  if (r.code === 0 && j.status === 0 && res?.success) {
    const ran = res.numberTestsCompleted ? `, ${plural(res.numberTestsCompleted, 'test')} passed` : '';
    return { passed: true, id, summary: `${what} ${plural(res.numberComponentsTotal ?? total, 'component')} in ${org}${ran}${id ? ` (job ${id})` : ''}.`, problems: [] };
  }
  const problems = deployProblems(res);
  return { passed: false, id, summary: problems.length ? `${plural(problems.length, 'problem')} in ${org}${id ? ` (job ${id})` : ''}: ${problems.slice(0, 3).join('; ')}` : (j.message?.trim() || `It ${res?.status ?? 'failed'} in ${org}.`), problems };
}

/** Runs `fn` holding the destination org's turn: one deploy to an org at a time, by its username. */
const orgTurn = <T>(deps: TaskDeployDeps, config: Config, b: Built, what: string, fn: () => T): T =>
  withSlot(fn, { dir: deps.orgLocks ? join(deps.orgLocks, b.username.replace(/[^\w.-]+/g, '_')) : orgLockDir(b.username), slots: 1, owner: { what, task: b.plan.task, env: b.plan.to.branch, project: config.project }, onWait: deps.onWait });

/** A check-only deploy of the plan's manifest to its org. Nothing is saved there. */
function checkOnly(deps: TaskDeployDeps, config: Config, b: Built): TaskDeployCheck {
  const args = taskCheckArgs(b.plan.org, b.manifest, b.plan.testLevel);
  assertCheckOnly('sf', args);
  const r = orgTurn(deps, config, b, `Check ${b.plan.task} for ${b.plan.to.name}`, () => withSlot(() => deps.run('sf', args, { cwd: b.wt, env: sfEnv(), timeoutMs: 120 * 60_000, nice: true }), { ...deps.slots, owner: { what: `Check ${b.plan.task}`, env: b.plan.to.branch, project: config.project } }));
  return readResult(r, 'Checked', b.plan.org, b.plan.files.length);
}

/**
 * The plan: where it goes, what deploys and what's left out or made by hand, and a check-only deploy to the
 * destination's org. Nothing changes in the org or on GitHub. The check is kept, so a yes with its id deploys
 * just what it checked.
 */
export function planTaskDeploy(paths: RepoPaths, config: Config, id: string, to: string | undefined, deps: TaskDeployDeps, opts: TaskDeployOpts): TaskDeployPlan {
  const steps = deps.steps ?? NO_STEPS;
  return withBuilt(paths, config, id, to, deps, opts, (b) => {
    if (!b.plan.files.length) {
      // Nothing goes to the org, but its pull request still moves it on: the yes is for these commits.
      const head = git(deps.run, b.wt, 'rev-parse', 'HEAD').stdout.trim();
      b.plan.check = { passed: true, id: `${NOTHING_TO_CHECK}${head.slice(0, 12)}`, summary: `Nothing of it deploys to ${b.plan.org}, so the org wasn't asked. Its pull request moves it on to ${b.plan.to.name}.`, problems: [] };
    } else {
      steps.start('check', `Check in ${b.plan.org}`, 'A check-only deploy: nothing is saved to the org');
      b.plan.check = checkOnly(deps, config, b);
      if (b.plan.check.passed) steps.done('check', b.plan.check.summary);
      else steps.fail('check', b.plan.check.summary);
    }
    if (b.plan.check.id) {
      const kept: KeptCheck = { v: 1, task: id, env: b.plan.to.branch, org: b.plan.org, id: b.plan.check.id, passed: b.plan.check.passed, commits: b.plan.commits, blobs: b.blobs, testLevel: b.plan.testLevel, at: deps.now().toISOString(), by: opts.by };
      mkdirSync(join(paths.stateDir, 'task-deploys'), { recursive: true });
      writeAtomic(keptCheckPath(paths, id), JSON.stringify(kept, null, 2) + '\n');
    }
    return b.plan;
  });
}

export interface TaskDeployResult {
  plan: TaskDeployPlan;
  deployed: boolean;
  jobId: string | null;
  pr: { number: number; url: string } | null;
  merged: boolean;
  summary: string;
  /** What didn't get done after the deploy went: the pull request's merge, the record, or the ticket's update. */
  warning: string | null;
  update: { id: string; key: string } | null;
}

/** Why the yes isn't for what would deploy now, or null: the check must be this plan's, passed, and unchanged since. */
export function yesProblem(kept: KeptCheck | null, plan: Pick<TaskDeployPlan, 'task' | 'to' | 'commits'>, blobs: Record<string, string>, checkId: string | undefined): string | null {
  if (!checkId?.trim()) return `Deploying ${plan.task} needs the person's yes: the id of its check, from a plan.`;
  if (!kept || kept.id !== checkId.trim() || kept.env !== plan.to.branch) return `${checkId} isn't ${plan.task}'s latest check for ${plan.to.name}. Make a plan first, and say yes to its check.`;
  if (!kept.passed) return `${plan.task}'s check for ${plan.to.name} (${kept.id}) didn't pass, so it can't deploy. Fix it, then make a new plan.`;
  if (kept.commits.join(' ') !== plan.commits.join(' ')) return `${plan.task}'s commits changed since its check (${kept.id}): make a new plan, so the check is of what deploys.`;
  const same = Object.keys(kept.blobs).length === Object.keys(blobs).length && Object.entries(blobs).every(([f, b]) => kept.blobs[f] === b);
  if (!same) return `What would deploy changed since ${plan.task}'s check (${kept.id}): ${plan.to.branch} moved on under it. Make a new plan.`;
  return null;
}

/** Whether the typed name confirms a protected or production org: its environment's name, or its org's alias. */
export const confirmsOrg = (plan: Pick<TaskDeployPlan, 'confirm' | 'to'>, typed: string | undefined): boolean =>
  !plan.confirm || (!!typed && [plan.to.name, plan.to.org].includes(typed.trim()));

type DeployTaskOpts = TaskDeployOpts & { checkId?: string; confirm?: string };

/** A ticket's deploy, with a marker saying it's under way while it runs, so every window shows it (D-092). */
export function deployTask(paths: RepoPaths, config: Config, id: string, to: string | undefined, deps: TaskDeployDeps, opts: DeployTaskOpts): TaskDeployResult {
  let env = to;
  try {
    env = to ? environmentNamed(config, to).branch : undefined;
  } catch {
    // An unknown name: the deploy's route refuses it, with the settings' names.
  }
  return withJob(paths, { kind: 'deploy', task: id, ...(env ? { env } : {}), by: opts.by }, () => deployTaskNow(paths, config, id, to, deps, opts), deps.now);
}

function deployTaskNow(paths: RepoPaths, config: Config, id: string, to: string | undefined, deps: TaskDeployDeps, opts: DeployTaskOpts): TaskDeployResult {
  const { run, now } = deps;
  const steps = deps.steps ?? NO_STEPS;
  return withBuilt(paths, config, id, to, deps, opts, (b) => {
    const { plan } = b;
    const none = { jobId: null, pr: null, merged: false, warning: null, update: null };
    const kept = readKeptCheck(paths, id);
    steps.step('yes', 'Check the person said yes', () => {
      const why = yesProblem(kept, plan, b.blobs, opts.checkId);
      if (why) throw new AccError('refused', why);
      if (!confirmsOrg(plan, opts.confirm)) throw new AccError('refused', `${plan.to.name} is ${plan.to.type === 'production' ? 'production' : 'protected'}. Type its name, ${plan.confirmName}, to deploy to it.`);
    });
    // A ticket with nothing for the org still moves on: its pull request merges, and nothing is sent to the org.
    const nothing = !plan.files.length;
    plan.check = { passed: true, id: kept!.id, summary: nothing ? `Nothing of it deploys to ${plan.org}.` : `Checked in ${plan.org} (job ${kept!.id}).`, problems: [] };
    const gh = config.github!;
    const token = run('gh', ['auth', 'token', '-u', gh.account]);
    if (token.code !== 0) throw new AccError('no-github', `gh isn't logged in as ${gh.account}, so the pull request can't open. Nothing was deployed.`);
    const ghEnv = { ...deps.env, GH_TOKEN: token.stdout.trim() };
    const head = git(run, b.wt, 'rev-parse', 'HEAD').stdout.trim();
    let pushed = false;
    let opened: { number: number; url: string } | null = null;
    // Any failure once the branch is pushed takes it back, and its pull request: nothing is left half done.
    const undo = (): void => {
      if (opened && run('gh', ['pr', 'close', String(opened.number), '-R', gh.repo, '--delete-branch'], { env: ghEnv, timeoutMs: 2 * 60_000 }).code === 0) return;
      if (pushed) run('git', ['push', '--quiet', 'origin', '--delete', b.branch], { cwd: b.wt, env: deps.env, timeoutMs: 5 * 60_000 });
    };
    let result: TaskDeployCheck | null = null;
    try {
      // The pull request opens before anything deploys: a branch that can't keep in step stops it.
      steps.step('push', 'Push the deploy\'s branch', () => must(run('git', ['push', '--quiet', '--set-upstream', 'origin', `${b.branch}:${b.branch}`], { cwd: b.wt, env: deps.env, timeoutMs: 5 * 60_000 }), `git push refused ${b.branch}. Nothing was deployed`));
      pushed = true;
      opened = steps.step('open', `Open the pull request into ${plan.to.branch}`, () => {
        const bodyFile = join(b.wt, '..', 'body.md');
        writeFileSync(bodyFile, taskDeployBody(plan));
        const create = run('gh', ['pr', 'create', '-R', gh.repo, '--base', plan.to.branch, '--head', b.branch, '--title', `${plan.key}: deploy to ${plan.to.name}`, '--body-file', bodyFile], { cwd: paths.root, env: ghEnv, timeoutMs: 2 * 60_000 });
        const url = create.stdout.trim().split('\n').find((l) => /\/pull\/\d+/.test(l))?.trim();
        if (create.code !== 0 || !url) throw new AccError('land', `gh couldn't open the pull request: ${lastLine(create.stderr || create.stdout)}. Nothing was deployed.`);
        return { number: Number(/\/pull\/(\d+)/.exec(url)![1]), url };
      });
      if (!nothing) {
        steps.start('deploy', `Deploy to ${plan.to.name}`, plan.testLevel === 'RunLocalTests' ? 'The checked job, quick-deployed' : 'The checked manifest, at the checked commit');
        const args = taskDeployArgs(plan.org, b.manifest, kept!);
        const r = orgTurn(deps, config, b, `Deploy ${id} to ${plan.to.name}`, () => withSlot(() => run('sf', args, { cwd: b.wt, env: sfEnv(), timeoutMs: 120 * 60_000, nice: true }), { ...deps.slots, owner: { what: `Deploy ${id}`, env: plan.to.branch, project: config.project } }));
        result = readResult(r, 'Deployed', plan.org, plan.files.length);
        if (!result.passed) {
          steps.fail('deploy', result.summary);
          undo();
          return { plan, deployed: false, ...none, jobId: result.id, summary: `The deploy of ${id} to ${plan.to.name} failed: ${result.summary} Its pull request was closed.` };
        }
        steps.done('deploy', result.summary);
      }
    } catch (e) {
      undo();
      throw e;
    }
    const pr = opened;
    const problems: string[] = [];
    // It's in the org: each component is asked for there, as the builder's deploy is (D-206).
    const asked = nothing ? null : steps.step('verify', `Ask ${plan.org} for each component`, () => askOrgFor((cmd, args) => run(cmd, args, { cwd: b.wt, env: sfEnv(), timeoutMs: 5 * 60_000 }), plan.org, plan.files));
    if (asked?.missing.length) problems.push(`${plan.org} doesn't list ${asked.missing.join(', ')}: check the org, and the component's name in its source.`);
    // The person's yes covers the merge: the environment's branch now holds what its org does.
    const mergeSha = steps.step('merge', `Merge the pull request into ${plan.to.branch}`, () => {
      try {
        const method = mergeMethod(run, gh.repo, ghEnv);
        const m = run('gh', ['pr', 'merge', String(pr.number), '-R', gh.repo, `--${method}`, '--match-head-commit', head], { env: ghEnv, timeoutMs: 2 * 60_000 });
        const view = run('gh', ['pr', 'view', String(pr.number), '-R', gh.repo, '--json', 'state,mergeCommit'], { env: ghEnv, timeoutMs: 2 * 60_000 });
        const seen = view.code === 0 ? JSON.parse(view.stdout) as { state?: string; mergeCommit?: { oid?: string } | null } : null;
        if (seen?.state === 'MERGED') return seen.mergeCommit?.oid ?? head;
        problems.push(`Pull request #${pr.number} didn't merge (${lastLine(m.stderr || m.stdout) || 'GitHub didn\'t say why'}): merge it, and acc sync follows it.`);
      } catch (e) {
        problems.push(`Pull request #${pr.number} didn't merge (${(e as Error).message}): merge it, and acc sync follows it.`);
      }
      return null;
    });
    const at = now().toISOString();
    const record: TaskDeploy | null = result && asked ? { env: plan.to.branch, org: plan.org, username: b.username, sha: head, at, jobId: result.id, paths: plan.files, components: asked.components, verified: asked.verified, tests: null, by: opts.by, checkId: kept!.id, pr } : null;
    steps.step('record', 'Record the deploy', () => {
      try {
        mutate(paths, now, (l, emit) => {
          const t = l.tasks.find((x) => x.id === id);
          if (!t) return;
          const promotion: Promotion = { from: plan.from.branch, to: plan.to.branch, pr, state: mergeSha ? 'merged' : 'open', at, ...(mergeSha ? { mergeSha, mergedAt: at } : {}) };
          if (record) t.deploys = [...(t.deploys ?? []), record];
          t.promotions = [...(t.promotions ?? []), promotion];
          // Each component it deletes is kept as a change outside git (T-138), so it's a step in every org it reaches.
          keepDeletions(t, plan.deletions, opts.by, at);
          // Its record changes become steps to make by hand in the destination, as at a promotion (T-100).
          addPromotionSteps(t, plan.to, at);
          t.updatedAt = at;
          emit({ type: 'task.updated', task: t.id, actor: 'human', by: opts.by, data: { ...(record ? { deploy: record } : {}), promotion } });
        });
        rmSync(keptCheckPath(paths, id), { force: true });
      } catch (e) {
        problems.push(`The deploy wasn't recorded on ${id}: ${(e as Error).message}`);
      }
    });
    const merged = mergeSha ? ` Pull request #${pr.number} merged into ${plan.to.branch}.` : '';
    if (!result) {
      return {
        plan, deployed: false, jobId: null, pr, merged: !!mergeSha, update: null,
        summary: `Nothing of ${id} deploys to ${plan.org}, so nothing was sent there.${merged}`,
        warning: problems.length ? problems.join(' ') : null,
      };
    }
    let update: TaskDeployResult['update'] = null;
    try {
      const u = draftUpdate(paths, b.task, { event: 'deployed', env: plan.to.name }, opts.by, now);
      if (u) update = { id: u.id, key: u.key };
    } catch (e) {
      problems.push(`Its ticket's update wasn't drafted: ${(e as Error).message}`);
    }
    return {
      plan, deployed: true, jobId: result.id, pr, merged: !!mergeSha, update,
      summary: `Deployed ${id} to ${plan.to.name}: ${result.summary}${merged}`,
      warning: problems.length ? `It's in ${plan.org}. ${problems.join(' ')}` : null,
    };
  });
}

/** Keeps each component the ticket deletes, that it doesn't keep yet, as the person's change outside git, before its steps are added. */
export function keepDeletions(t: Task, deletions: HandDeletion[], by: string, at: string): void {
  if (!deletions.length) return;
  const o = outsideOf(t);
  for (const d of deletions) {
    if (o.changes.some((c) => c.kind === DELETION_KIND.kind && (c.detail as { component?: string }).component === d.component)) continue;
    const n = o.changes.reduce((m, c) => Math.max(m, Number(c.id.slice(1)) || 0), 0) + 1;
    o.changes.push({ id: `c${n}`, kind: DELETION_KIND.kind, detail: { component: d.component, path: d.path }, why: 'The ticket deletes it, and a deploy never deletes', planned: false, actor: 'human', by, at });
  }
  t.outside = o;
}

/** The pull request's body: what deployed, what's left out and what a person makes by hand. */
export function taskDeployBody(plan: TaskDeployPlan): string {
  const list = (xs: string[]) => xs.map((f) => `- \`${f}\``);
  return [
    `Deploys ${plan.key} alone to ${plan.to.name} (${plan.org}): ${plural(plan.commits.length, 'commit')} of its own, cherry-picked onto \`${plan.to.branch}\` at ${plan.base.slice(0, 7)}.`,
    '',
    `## Components (${plan.types.reduce((n, t) => n + t.members.length, 0)})`,
    '',
    ...plan.types.flatMap((t) => t.members.map((m) => `- ${t.name}: ${m}`)),
    ...(plan.leftOut.length ? ['', '## Left out: environment-specific', '', ...list(plan.leftOut)] : []),
    ...(plan.deletions.length ? ['', '## To delete by hand in the org', '', ...plan.deletions.map((d) => `- ${d.component} (\`${d.path}\`)`)] : []),
    ...(plan.records.length ? ['', '## Record changes to make by hand', '', ...plan.records.map((r) => `- ${r}`)] : []),
    '',
    '---',
    `Opened by the Command Center for a person's deploy. It merges once the deploy to ${plan.to.name} succeeds, and closes if it fails.`,
  ].join('\n') + '\n';
}
