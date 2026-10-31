/**
 * Checking a group of finished tasks together (T-165): one full check for several tasks, not one each. A person
 * picks the tasks in review whose review passed on their latest commit and that go to one environment. acc makes
 * a scratch branch from that environment's branch, in a worktree of its own, never the main checkout, and merges
 * each task's branch into it in order. A task that conflicts with the group is left out, with the files and the
 * task it conflicts with. Then the full check runs once, with the merge's scope.
 *
 * - All pass: the checked branch is pushed to the environment's branch, so each task merges in the same order
 *   with no second check, and moves to done. Floors the check raised are committed once, on the group's branch.
 *   If the environment's branch moved meanwhile, the group is merged and checked again first.
 * - A check fails: its log is read for the failing tests, the files in its errors and stacks, and a geometry
 *   finding's page, and matched against what each task changed (group-blame.ts). One match goes back to its
 *   builder with the failure, and the rest are checked again without it. Any other count splits the group in
 *   halves, checked in turn, so a task is never sent back on a guess. Tasks that each pass, and fail only
 *   together, need a person.
 *
 * Each step is kept on each task it checked (`groupChecks`), and one group runs at a time for an environment.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type QueueCheck, type QueueReport, queueReportPath, tailText } from './checks.ts';
import { issueToClose } from './closing.ts';
import { keepChanges } from './changes.ts';
import { type Config, defaultEnvironment, type Environment, environmentByBranch, requiredGates } from './config.ts';
import { numberDecisions } from './decisions.ts';
import { setupWorktree, worktreeRoot } from './dispatch.ts';
import { AccError, type Runner } from './exec.ts';
import { fetchBranches } from './fetch.ts';
import { draftChangesField } from './field-drafts.ts';
import { type GateResult, runGates } from './gates.ts';
import { failureOf, type GroupFailure, matchFailure, reachOf, type Suspect } from './group-blame.ts';
import type { GroupFound } from './group-report.ts';
import { type Actor, applyMove, AUTOPILOT_BY, checkMove, type GroupMark, type GroupOutcome, type Ledger, mutate, noGateHooks, readLedger, SEND_BACKS, sendBacks, sentBackAt, type Task } from './ledger.ts';
import { withLock } from './lock.ts';
import { mainCheckout, type RepoPaths, repoPaths } from './paths.ts';
import { FLOORS_FILE } from './ratchets.ts';
import { satisfies } from './receipts.ts';
import { MergeConflict, mergeBaseIn, merging } from './refresh.ts';
import { reviewedAt } from './review.ts';
import type { SlotOptions } from './semaphore.ts';
import type { TaskCommand } from './task-deploy.ts';
import { draftUpdate } from './updates.ts';

/** The fewest tasks a group check takes: one alone is its own merge's check. */
export const GROUP_MIN = 2;

/** How many times the group is checked again when the environment's branch moved after its check. */
export const MOVED_AGAIN = 3;

/** How many steps a task keeps of its group checks. */
export const GROUP_MARKS = 30;

const short = (sha: string): string => sha.slice(0, 7);

/** "T-1", "T-1 and T-2", "T-1, T-2 and T-3". */
export function listWords(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

// ---------------------------------------------------------------- who's ready, and the command

/** A task ready for a group check: in review, on its branch's latest commit, which its review passed. */
export interface GroupMember {
  id: string;
  branch: string;
  head: string;
}

/** Why a task in the ledger can't join a group check for `env` now, or null when it can. */
export function notReady(paths: RepoPaths, run: Runner, t: Task, env: string): string | null {
  if (t.environment !== env) return `${t.id} goes to ${t.environment}, not ${env}.`;
  if (t.state !== 'review') return `${t.id} is ${t.state}: a group check takes tasks in review.`;
  const branch = t.run?.branch;
  const head = branch ? run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: paths.root }).stdout.trim() : '';
  if (!branch || !head) return `${t.id}'s branch isn't in this clone.`;
  if (!reviewedAt(paths, t, head)) return `${t.id}'s review hasn't passed on its latest commit, ${short(head)}.`;
  return null;
}

/** The tasks ready for a group check into `env`, in ledger order. */
export function groupReady(paths: RepoPaths, run: Runner, ledger: Pick<Ledger, 'tasks'>, env: string): GroupMember[] {
  return ledger.tasks.filter((t) => !notReady(paths, run, t, env)).map((t) => ({ id: t.id, branch: t.run!.branch!, head: run('git', ['rev-parse', `refs/heads/${t.run!.branch}`], { cwd: paths.root }).stdout.trim() }));
}

/** What the command's enabled rule reads: the project's environments, where the group goes, how many are ready, and whether one runs there now. */
export interface GroupEnabledInput {
  config: Pick<Config, 'environments'>;
  env: string | null;
  ready: number;
  running: boolean;
}

/** Why a group check can't start now, or that it can. */
export function groupEnabled(s: GroupEnabledInput): { ok: true } | { ok: false; why: string } {
  const env = s.env ? environmentByBranch(s.config, s.env) : null;
  if (!env) return { ok: false, why: `${s.env ?? 'That environment'} isn't in the project's settings.` };
  if (env.protected) return { ok: false, why: `${env.name} is protected: a person merges into it, one change at a time.` };
  if (s.running) return { ok: false, why: `A group check for ${env.name} is under way. Wait for it to end.` };
  if (s.ready < GROUP_MIN) return { ok: false, why: `A group check takes ${GROUP_MIN} or more tasks in review whose review passed on their latest commit. ${s.ready} ${s.ready === 1 ? 'is' : 'are'} ready for ${env.name}.` };
  return { ok: true };
}

/** Check a group of tasks together: the CLI's and the extension's. */
export const GROUP_CHECK_COMMAND: TaskCommand<GroupEnabledInput> = {
  id: 'acc.task.checkTogether',
  params: 'The tasks to check together, by id, in the order they merge; or, with none named, every task ready: in review, its review passed on its latest commit. The environment by its branch, when the tasks named don\'t say it; the default environment when nothing does.',
  enabled: groupEnabled,
};

/** The lock that keeps one group check at a time for an environment. */
export const groupLockDir = (paths: Pick<RepoPaths, 'stateDir'>, env: string): string => join(paths.stateDir, 'groups', `${env.replace(/[^\w.-]+/g, '-')}.lock`);

/** Whether a group check for `env` is under way now, from this machine. */
export function groupRunning(paths: Pick<RepoPaths, 'stateDir'>, env: string): boolean {
  try {
    const owner = JSON.parse(readFileSync(join(groupLockDir(paths, env), 'owner'), 'utf8')) as { pid?: number };
    if (typeof owner.pid !== 'number') return false;
    process.kill(owner.pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// ---------------------------------------------------------------- finding the task: no git, so it's tested alone

/** A check of some of the group: it passed, or what its failure named. */
export type GroupCheckResult = { ok: true } | { ok: false; failure: GroupFailure };

/** A task the failure is shown to be its change's. */
export interface Culprit {
  id: string;
  failure: GroupFailure;
  /** What the failure names that its change reaches. */
  files: string[];
  /** The tasks it was checked with when it failed. */
  with: string[];
  /** It failed checked alone, so no match was needed. */
  alone: boolean;
}

export interface Settled {
  /** The tasks whose check passed together, in order: they merge. Empty when no check passed. */
  passed: string[];
  sentBack: Culprit[];
  /** Tasks that each pass, but fail together: they need a person. */
  together: string[];
  /** Each check made, in order, and whether it passed. */
  checks: { ids: string[]; ok: boolean }[];
}

/** Splits a group in two, the first half the larger. */
export const halves = <T>(xs: T[]): [T[], T[]] => [xs.slice(0, Math.ceil(xs.length / 2)), xs.slice(Math.ceil(xs.length / 2))];

/**
 * Checks the group, and while a check fails, finds the task whose change caused it: the one task the failure's
 * files match, or else the half that fails on its own, split again until one task is left or a match is one.
 * That task goes back; the rest are checked again without it. When both halves pass, the tasks fail only
 * together, and nothing merges. `match` says which tasks' changes reach the failure's files.
 */
export function settleGroup(ids: string[], check: (ids: string[]) => GroupCheckResult, match: (f: GroupFailure, ids: string[]) => { id: string; files: string[] }[]): Settled {
  const checks: Settled['checks'] = [];
  const sentBack: Culprit[] = [];
  const ask = (g: string[]): GroupCheckResult => {
    const r = check(g);
    checks.push({ ids: g, ok: r.ok });
    return r;
  };
  const culprit = (g: string[], failure: GroupFailure): Culprit | { together: string[] } => {
    const m = match(failure, g);
    const others = (id: string) => g.filter((x) => x !== id);
    if (m.length === 1) return { id: m[0]!.id, failure, files: m[0]!.files, with: others(m[0]!.id), alone: g.length === 1 };
    // Checked alone and failed: it's its own, whatever the files say.
    if (g.length === 1) return { id: g[0]!, failure, files: m[0]?.files ?? [], with: [], alone: true };
    const [a, b] = halves(g);
    const ra = ask(a);
    if (!ra.ok) return culprit(a, ra.failure);
    const rb = ask(b);
    if (!rb.ok) return culprit(b, rb.failure);
    return { together: g };
  };
  let group = [...ids];
  while (group.length) {
    const r = ask(group);
    if (r.ok) return { passed: group, sentBack, together: [], checks };
    const found = culprit(group, r.failure);
    if ('together' in found) return { passed: [], sentBack, together: found.together, checks };
    sentBack.push(found);
    group = group.filter((x) => x !== found.id);
  }
  return { passed: [], sentBack, together: [], checks };
}

// ---------------------------------------------------------------- what each task's ticket says

/** What a check's step says on each task it checked. */
export function checkedWords(id: string, ids: string[], ok: boolean, failed: string[] = []): string {
  const others = ids.filter((x) => x !== id);
  const who = others.length ? `Checked with ${listWords(others)}` : 'Checked alone';
  return `${who}: ${ok ? 'passed' : `failed${failed.length ? ` (${failed.join(', ')})` : ''}`}`;
}

/** What a send-back says on its task: the failing tests, else the files the failure names that its change reaches. */
export function sentBackWords(c: Pick<Culprit, 'failure' | 'files' | 'alone'>): string {
  const what = c.failure.tests.length ? listWords(c.failure.tests) : c.files.length ? listWords(c.files) : listWords(c.failure.checks);
  return `Sent back: its change fails ${what}${c.alone ? ', checked alone' : ''}`;
}

/** Appends a step to each task, or replaces a live `checking` step of the same group. */
export function markTasks(paths: RepoPaths, now: () => Date, who: { actor: Actor; by: string }, group: string, env: string, marks: { id: string; with: string[]; outcome: GroupOutcome; words: string }[]): void {
  if (!marks.length) return;
  mutate(paths, now, (l, emit) => {
    const at = now().toISOString();
    for (const m of marks) {
      const t = l.tasks.find((x) => x.id === m.id);
      if (!t) continue;
      const mark: GroupMark = { group, env, with: m.with, outcome: m.outcome, words: m.words, at };
      const all = t.groupChecks ?? [];
      const last = all[all.length - 1];
      const kept = last?.group === group && last.outcome === 'checking' ? all.slice(0, -1) : all;
      t.groupChecks = [...kept, mark].slice(-GROUP_MARKS);
      t.updatedAt = at;
      emit({ type: 'task.updated', task: t.id, actor: who.actor, by: who.by, data: { groupCheck: mark } });
    }
  });
}

// ---------------------------------------------------------------- the group check, with git

export interface GroupDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  /** The heavy-check slot each check takes, machine-wide unless a test says otherwise (D-092). */
  slots?: SlotOptions;
  /** Told at each step, in words, as acc's steps show. */
  onStep?: (words: string) => void;
}

export interface GroupResult {
  group: string;
  env: string;
  /** The tasks that merged, in order, and the commit the environment's branch is at now. */
  merged: string[];
  at: string | null;
  /** Each task left out before the check, with the files and the task it conflicts with. */
  leftOut: { id: string; files: string[]; with: string | null }[];
  sentBack: { id: string; words: string }[];
  /** Tasks that pass alone and fail together, for a person. */
  together: string[];
  /** Each task that stopped for something else, such as autopilot's send-back limit, and why. */
  needsYou: { id: string; why: string }[];
  /** How many times the full check ran. */
  checks: number;
  /** One sentence for the person. */
  summary: string;
}

/** Which environment a group goes to: the one asked for, else the named tasks', else the default. */
export function groupEnvironment(config: Config, ledger: Pick<Ledger, 'tasks'>, ids: string[], asked?: string): Environment {
  if (asked) {
    const e = environmentByBranch(config, asked);
    if (!e) throw new AccError('usage', `${asked} isn't an environment's branch in the project's settings.`);
    return e;
  }
  const envs = [...new Set(ids.map((id) => ledger.tasks.find((t) => t.id === id)?.environment).filter((x): x is string => !!x))];
  if (envs.length > 1) throw new AccError('usage', `Those tasks go to ${listWords(envs)}: a group goes to one environment. Name it with --env.`);
  const e = envs[0] ? environmentByBranch(config, envs[0]) : defaultEnvironment(config);
  if (!e) throw new AccError('usage', `${envs[0]} isn't an environment in the project's settings.`);
  return e;
}

/** The files a task's branch changed since it left `base`. */
const changedFiles = (run: Runner, root: string, base: string, branch: string): string[] =>
  run('git', ['diff', '--name-only', `${base}...${branch}`], { cwd: root }).stdout.split('\n').map((s) => s.trim()).filter(Boolean);

/**
 * Checks a group together, and merges it when it passes. `ids` in their merge order, or every task ready when
 * empty. Refused, with why, when the command's enabled rule says no, or a task named isn't ready.
 */
export function checkTogether(paths: RepoPaths, config: Config, ids: string[], deps: GroupDeps, who: { actor: Actor; by: string }, asked?: string): GroupResult {
  const ledger = readLedger(paths.ledger);
  const env = groupEnvironment(config, ledger, ids, asked);
  for (const id of ids) {
    const t = ledger.tasks.find((x) => x.id === id);
    if (!t) throw new AccError('no-task', `No task ${id}.`);
    const why = notReady(paths, deps.run, t, env.branch);
    if (why) throw new AccError('refused', why);
  }
  if (new Set(ids).size !== ids.length) throw new AccError('usage', 'A task is named twice.');
  const ready = groupReady(paths, deps.run, ledger, env.branch);
  const members = ids.length ? ids.map((id) => ready.find((m) => m.id === id)!) : ready;
  const can = GROUP_CHECK_COMMAND.enabled({ config, env: env.branch, ready: members.length, running: groupRunning(paths, env.branch) });
  if (!can.ok) throw new AccError('refused', can.why);
  mkdirSync(join(paths.stateDir, 'groups'), { recursive: true });
  try {
    // A lock whose owner is gone is broken; a live one is never, however long its check takes.
    return withLock(groupLockDir(paths, env.branch), () => runGroup(paths, config, env, members, deps, who), { timeoutMs: 200, staleMs: 24 * 60 * 60_000 });
  } catch (e) {
    if ((e as AccError).code === 'lock-timeout') throw new AccError('refused', `A group check for ${env.name} is under way. Wait for it to end.`);
    throw e;
  }
}

function runGroup(paths: RepoPaths, config: Config, env: Environment, all: GroupMember[], deps: GroupDeps, who: { actor: Actor; by: string }): GroupResult {
  const { run, now } = deps;
  const say = (w: string) => deps.onStep?.(w);
  const group = `${env.branch}@${now().toISOString()}`;
  const mark = (marks: Parameters<typeof markTasks>[5]) => markTasks(paths, now, who, group, env.branch, marks);
  const main = mainCheckout(run, paths.root);
  const wt = join(worktreeRoot(config, main), `group-${env.branch.replace(/[^\w.-]+/g, '-')}`);
  const scratch = `acc/group/${env.branch}`;
  const git = (...args: string[]) => run('git', args, { cwd: paths.root });
  const inWt = (...args: string[]) => run('git', args, { cwd: wt });
  const unattended = { ...deps.env, GIT_TERMINAL_PROMPT: '0' };
  const result: GroupResult = { group, env: env.branch, merged: [], at: null, leftOut: [], sentBack: [], together: [], needsYou: [], checks: 0, summary: '' };
  const removeScratch = () => {
    if (existsSync(wt)) git('worktree', 'remove', '--force', wt);
    git('branch', '-D', scratch);
  };
  try {
    let members = all;
    for (let attempt = 0; attempt <= MOVED_AGAIN; attempt++) {
      say(`Fetching ${env.branch} and each task's branch`);
      if (!fetchBranches(run, paths.root, [env.branch], unattended)) throw new AccError('group', `Couldn't fetch ${env.branch} from origin.`);
      const base = git('rev-parse', `refs/remotes/origin/${env.branch}`).stdout.trim();
      removeScratch();
      const add = git('worktree', 'add', '--quiet', '-B', scratch, wt, base);
      if (add.code !== 0) throw new AccError('group', `git couldn't make the group's worktree: ${add.stderr.trim()}`);
      setupWorktree(run, config, env, main, wt);
      const merge = merging(config, run, wt);
      const place = (from: string) => ({ id: 'group', env, branch: scratch, wt, from });

      // Each task's branch, in order. One that conflicts with those before it is left out, with the task it conflicts with.
      const changed = new Map(members.map((m) => [m.id, changedFiles(run, paths.root, base, m.head)]));
      const mergeIn = (ids: string[], record: boolean): string[] => {
        const kept: string[] = [];
        for (const id of ids) {
          const m = members.find((x) => x.id === id)!;
          if (record) say(`Merging ${id} into the group`);
          try {
            mergeBaseIn(config, place(inWt('rev-parse', 'HEAD').stdout.trim()), run, { ref: m.head, message: `Merge ${id} into the group check for ${env.branch}`, by: 'acc' });
            kept.push(id);
          } catch (e) {
            if (!(e instanceof MergeConflict) || !record) throw e;
            const by = kept.find((k) => changed.get(k)!.some((f) => e.files.includes(f))) ?? null;
            result.leftOut.push({ id, files: e.files, with: by });
            mark([{ id, with: kept, outcome: 'left-out', words: `Left out of the group check: it conflicts${by ? ` with ${by}` : ''} in ${listWords(e.files)}` }]);
          }
        }
        // The decisions they add, numbered against the environment's branch, as the merge queue does (T-102).
        numberDecisions(run, wt, `refs/remotes/origin/${env.branch}`, merge);
        return kept;
      };
      const ids = mergeIn(members.map((m) => m.id), true);
      members = members.filter((m) => ids.includes(m.id));
      if (!members.length) break;

      // What each change reaches, read from the whole group's tree, for matching a failure to it.
      const tracked = new Set(inWt('ls-files').stdout.split('\n').filter(Boolean));
      const read = (f: string): string | null => { try { return readFileSync(join(wt, f), 'utf8'); } catch { return null; } };
      const suspects: Suspect[] = ids.map((id) => ({ id, changed: changed.get(id)!, reach: reachOf(changed.get(id)!, tracked, read) }));
      const roots = [wt, ...(() => { try { return [realpathSync(wt)]; } catch { return []; } })()];

      // The gates each failure came from, for its send-back's report.
      const ranOf = new WeakMap<GroupFailure, GateResult[]>();
      let built = ids.join(' ');
      const gates = requiredGates(config, env.branch, 'merge');
      const check = (g: string[]): GroupCheckResult => {
        // A part of the group: merged again from the environment's branch, in the same order.
        if (g.join(' ') !== built) {
          say(`Merging ${listWords(g)} again from ${env.branch}`);
          inWt('reset', '--quiet', '--hard', base);
          mergeIn(g, false);
          built = g.join(' ');
        }
        mark(g.map((id) => ({ id, with: g.filter((x) => x !== id), outcome: 'checking' as const, words: `Checking with ${listWords(g.filter((x) => x !== id)) || 'no other task'}: running the full check` })));
        say(`Running the full check on ${listWords(g)}`);
        result.checks++;
        let failed: GateResult[];
        try {
          const ran = runGates(repoPaths(wt, run), config, env, gates, [], { run, now, slots: deps.slots, task: `group ${env.branch}`, raise: true });
          failed = ran.results.filter((r) => !r.recorded || !satisfies(r.receipt));
        } catch (e) {
          throw new AccError((e as AccError).code ?? 'group', `The full check couldn't run: ${(e as Error).message}`);
        }
        // A check that ran no tests, or skipped more than before, is a person's call (GH-100).
        const held = failed.filter((r) => r.status === 'hold');
        if (held.length) throw new AccError('group', `The full check needs a person: ${held.map((r) => `${r.gate}: ${r.summary.replace(/[.!?]$/, '')}`).join('; ')}.`);
        const names = failed.map((r) => r.gate);
        mark(g.map((id) => ({ id, with: g.filter((x) => x !== id), outcome: failed.length ? 'failed' as const : 'passed' as const, words: checkedWords(id, g, !failed.length, names) })));
        if (!failed.length) return { ok: true };
        const log = failed.map((r) => { try { return r.receipt.log ? readFileSync(r.receipt.log, 'utf8') : ''; } catch { return ''; } }).join('\n');
        const failure = failureOf(names, `${failed.map((r) => r.summary).join('\n')}\n${log}`, tracked, roots);
        ranOf.set(failure, failed);
        return { ok: false, failure };
      };
      const settled = settleGroup(ids, check, (f, g) => matchFailure(f, suspects.filter((s) => g.includes(s.id))));

      for (const c of settled.sentBack) {
        const why = sendBackGroup(paths, config, members.find((m) => m.id === c.id)!, c, ranOf.get(c.failure) ?? [], env.branch, deps, who);
        if (why) {
          result.needsYou.push({ id: c.id, why });
          mark([{ id: c.id, with: c.with, outcome: 'needs-you', words: `${sentBackWords(c)}. ${why}` }]);
        } else {
          result.sentBack.push({ id: c.id, words: sentBackWords(c) });
          mark([{ id: c.id, with: c.with, outcome: 'sent-back', words: sentBackWords(c) }]);
        }
      }
      if (settled.together.length) {
        result.together = settled.together;
        mark(settled.together.map((id) => ({ id, with: settled.together.filter((x) => x !== id), outcome: 'together' as const, words: `Passes alone, but fails with ${listWords(settled.together.filter((x) => x !== id))}: a person decides` })));
      }
      // Nothing that failed merges: only the group whose own check passed, on the commit that was checked.
      if (!settled.passed.length) break;
      members = members.filter((m) => settled.passed.includes(m.id));

      // Floors the passing check raised, committed once on the group's branch.
      if (inWt('status', '--porcelain', '--', FLOORS_FILE).stdout.trim()) {
        inWt('add', '--', FLOORS_FILE);
        merge('commit', '--quiet', '-m', `Raise the floors from the group check of ${listWords(settled.passed)}`);
      }
      say(`Merging ${listWords(settled.passed)} into ${env.branch}`);
      // The environment's branch moved after the check: the group is merged and checked again on the new one.
      fetchBranches(run, paths.root, [env.branch], unattended);
      if (git('rev-parse', `refs/remotes/origin/${env.branch}`).stdout.trim() !== base) {
        say(`${env.branch} moved after the check: checking the group again`);
        continue;
      }
      const head = inWt('rev-parse', 'HEAD').stdout.trim();
      const push = run('git', ['push', '--quiet', 'origin', `${head}:refs/heads/${env.branch}`], { cwd: wt, env: unattended });
      if (push.code !== 0) {
        fetchBranches(run, paths.root, [env.branch], unattended);
        if (git('rev-parse', `refs/remotes/origin/${env.branch}`).stdout.trim() !== base) continue;
        throw new AccError('group', `The group passed its check, but ${env.branch} refused the push: ${(push.stderr || push.stdout).trim().split('\n').slice(-2).join(' ')} Nothing merged.`);
      }
      fetchBranches(run, paths.root, [env.branch], unattended);
      // Each task's own merge commit on the group's branch: where its change reached the environment.
      const merges = new Map<string, string>();
      for (const line of inWt('log', '--merges', '--format=%H %P', `${base}..${head}`).stdout.split('\n')) {
        const [sha, , second] = line.trim().split(' ');
        const m = members.find((x) => x.head === second);
        if (sha && m) merges.set(m.id, sha);
      }
      mergedDone(paths, config, members, merges, changed, env, deps, who, settled.passed);
      result.merged = settled.passed;
      result.at = head;
      mark(settled.passed.map((id) => ({ id, with: settled.passed.filter((x) => x !== id), outcome: 'merged' as const, words: `${checkedWords(id, settled.passed, true)}, and merged into ${env.branch} as ${short(merges.get(id) ?? head)}` })));
      break;
    }
    if (!result.merged.length && !result.sentBack.length && !result.together.length && !result.needsYou.length && members.length) {
      throw new AccError('group', `${env.branch} kept moving while the group was checked: ${MOVED_AGAIN + 1} checks, and nothing merged. Try again.`);
    }
  } finally {
    removeScratch();
  }
  result.summary = groupSummary(result);
  return result;
}

/** One sentence on what a group check did. */
export function groupSummary(r: Pick<GroupResult, 'env' | 'merged' | 'leftOut' | 'sentBack' | 'together' | 'needsYou' | 'checks'>): string {
  const parts = [
    r.merged.length ? `${listWords(r.merged)} merged into ${r.env}` : `Nothing merged into ${r.env}`,
    ...(r.sentBack.length ? [`${listWords(r.sentBack.map((s) => s.id))} went back to ${r.sentBack.length === 1 ? 'its builder' : 'their builders'}`] : []),
    ...(r.leftOut.length ? [`${listWords(r.leftOut.map((s) => s.id))} conflicted and ${r.leftOut.length === 1 ? 'was' : 'were'} left out`] : []),
    ...(r.together.length ? [`${listWords(r.together)} fail only together, and need you`] : []),
    ...(r.needsYou.length ? [`${listWords(r.needsYou.map((s) => s.id))} need${r.needsYou.length === 1 ? 's' : ''} you`] : []),
  ];
  return `${parts.join('; ')}. The full check ran ${r.checks === 1 ? 'once' : `${r.checks} times`}.`;
}

/**
 * Sends a task back to its builder, review → rework, as autopilot's send-back from the merge queue, so it shares
 * D-076's limits and its re-dispatch, and its packet says what the group check found. Returns why it couldn't, so
 * the task needs a person, or null.
 */
function sendBackGroup(paths: RepoPaths, config: Config, m: GroupMember, c: Culprit, failed: GateResult[], base: string, deps: GroupDeps, who: { actor: Actor; by: string }): string | null {
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === m.id);
  if (!task) return `${m.id} isn't in the ledger any more.`;
  if (sentBackAt(task, m.head)) return `Autopilot already sent ${short(m.head)} back once: a person decides.`;
  if (sendBacks(task) >= SEND_BACKS) return `${m.id} went back to its builder ${SEND_BACKS} times already: a person decides.`;
  const at = deps.now().toISOString();
  const checks: QueueCheck[] = failed.filter((r) => c.failure.checks.includes(r.gate)).map((r) => {
    let log: string | null = null;
    try { log = r.receipt.log ? tailText(readFileSync(r.receipt.log, 'utf8')) || null : null; } catch { log = null; }
    return { gate: r.gate, status: r.status, summary: r.summary, file: r.receipt.log, log };
  });
  const group: GroupFound = { with: c.with, alone: c.alone, tests: c.failure.tests, files: c.files, lines: c.failure.lines };
  const report: QueueReport = { v: 1, task: m.id, sha: m.head, base, pr: task.pr ? { number: task.pr.number, url: task.pr.url } : null, kind: 'check', conflicts: [], checks, merge: null, at, group };
  mkdirSync(paths.queue, { recursive: true });
  writeFileSync(queueReportPath(paths, m.id, m.head), JSON.stringify(report, null, 2) + '\n');
  const reason = `The group check sent it back: ${sentBackWords(c).replace(/^Sent back: /, '')}.`;
  return mutate(paths, deps.now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === m.id);
    if (!t) return `${m.id} isn't in the ledger any more.`;
    // Autopilot's send-back (D-076), so its limits and its re-dispatch hold, whoever asked for the group check.
    const req = { to: 'rework' as const, actor: 'orchestrator' as const, by: AUTOPILOT_BY, reason };
    const problems = checkMove(l, config, t, req, noGateHooks);
    if (problems.length) return problems.join(' ');
    applyMove(t, req, emit, deps.now, { kind: 'queue', checks: c.failure.checks, conflicts: [], sha: m.head, groupCheck: who.by });
    const sentBack = { sha: m.head, checks: c.failure.checks, at, kind: 'queue' as const };
    t.autopilot = { failed: null, ...t.autopilot, sentBack };
    emit({ type: 'task.updated', task: t.id, actor: 'orchestrator', by: AUTOPILOT_BY, data: { autopilot: { sentBack } } });
    return null;
  });
}

/**
 * The tasks merged: each moves to done, as acc sync moves one whose pull request merged (D-033): its pull
 * request marked merged at its own merge commit, what it changed kept (T-99), its issue closed where its tracker
 * lets acc (D-082), else its update drafted (D-066).
 */
function mergedDone(paths: RepoPaths, config: Config, members: GroupMember[], merges: Map<string, string>, changed: Map<string, string[]>, env: Environment, deps: GroupDeps, who: { actor: Actor; by: string }, ids: string[]): void {
  const { run, now } = deps;
  const moved: string[] = [];
  mutate(paths, now, (l, emit) => {
    const at = now().toISOString();
    for (const id of ids) {
      const t = l.tasks.find((x) => x.id === id);
      const m = members.find((x) => x.id === id);
      if (!t || !m) continue;
      const mergeSha = merges.get(id);
      if (t.pr) t.pr = { ...t.pr, state: 'merged', ...(mergeSha ? { mergeSha } : {}), syncedAt: at };
      keepChanges(t, changed.get(id) ?? null, at, emit, who);
      const req = { to: 'done' as const, actor: who.actor, by: who.by, reason: `Checked together with ${listWords(ids.filter((x) => x !== id)) || 'no other task'}, and merged into ${env.branch}.` };
      if (t.state !== 'review' || checkMove(l, config, t, req, noGateHooks).length) continue;
      applyMove(t, req, emit, now);
      if (t.pr && issueToClose(config, t)) t.pr.issue = { state: 'pending', at };
      moved.push(id);
    }
  });
  const ledger = readLedger(paths.ledger);
  for (const id of moved) {
    draftChangesField(paths, run, config, id, who.by, now);
    const t = ledger.tasks.find((x) => x.id === id);
    if (!t || t.pr?.issue) continue;
    try {
      draftUpdate(paths, t, { event: 'merged', env: env.name }, who.by, now);
    } catch {
      // The task stays done; its update can be drafted by hand.
    }
  }
}
