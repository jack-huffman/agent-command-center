import { existsSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { type Analysis, analysisProblems, readAnalysis } from './analyze.ts';
import { type Config, environmentByBranch } from './config.ts';
import type { Runner } from './exec.ts';
import { baseFor, changedPaths, listed } from './gates.ts';
import { type FileShare, isReady, type Ledger, type State, type Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { FLOORS_FILE } from './ratchets.ts';

/**
 * Conflict-aware dispatch (D-093). Before a task to do starts, the files its analysis plans to change are
 * compared with the files of every task in flight: what each plans, and what its branch has changed so
 * far. Files every task edits, such as a decision log or the docs, never count. A task that shares files
 * waits only while another Ready task shares none, which starts first: when nothing else is ready, it
 * starts anyway, and says which files it shares with which task. The merge queue takes the rest.
 */

export type { FileShare } from './ledger.ts';

/**
 * A path as git names it in the repo: relative, with no leading ./ and no trailing /. An absolute path
 * under the repo is made relative, and a glob stands for the folder before its first wildcard. Null when
 * it's outside the repo, or nothing is left, as of a glob over the whole repo.
 */
export function repoPath(path: string, root: string): string | null {
  let p = path.trim().replace(/\\/g, '/');
  if (!p) return null;
  if (isAbsolute(p)) {
    const rel = relative(root, p).replace(/\\/g, '/');
    if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return null;
    p = rel;
  }
  const wild = p.search(/[*?[{]/);
  if (wild >= 0) p = p.slice(0, wild).replace(/[^/]*$/, '');
  p = p.replace(/\/{2,}/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  if (!p || p === '.' || p.split('/').includes('..')) return null;
  return p;
}

/** The files a task's analysis plans to change, as repo paths: null when they aren't known, with no analysis or one that names none. */
export function plannedFiles(analysis: Pick<Analysis, 'approach'> | null, root: string): string[] | null {
  const files = analysis?.approach?.files;
  if (!Array.isArray(files)) return null;
  const out = files.map((f) => (typeof f?.path === 'string' ? repoPath(f.path, root) : null)).filter((p): p is string => !!p);
  return out.length ? [...new Set(out)].sort() : null;
}

/** Whether two repo paths are the same file, or one is a folder holding the other. */
export const sameFile = (a: string, b: string): boolean => listed(a, [b]) || listed(b, [a]);

/** What never makes two tasks wait for each other: autopilot.appendOnly (D-058), dispatch.shared, and the floors file, whose conflicts keep the better floors (GH-99). */
export const sharedFiles = (config: Pick<Config, 'autopilot' | 'dispatch'>): string[] => [...(config.autopilot?.appendOnly ?? []), ...(config.dispatch?.shared ?? []), FLOORS_FILE];

/**
 * The files `own` shares with each of `others`, without the shared ones, named as the file when one side
 * lists its folder. Others that share none are left out.
 */
export function overlaps(own: string[] | null, others: FileShare[], shared: string[]): FileShare[] {
  if (!own?.length) return [];
  const out: FileShare[] = [];
  for (const o of others) {
    const files = new Set<string>();
    for (const a of own) {
      for (const b of o.files) {
        if (!sameFile(a, b)) continue;
        const file = a.length >= b.length ? a : b;
        if (!listed(file, shared)) files.add(file);
      }
    }
    if (files.size) out.push({ task: o.task, files: [...files].sort() });
  }
  return out;
}

/** Where a dispatched task holds its files until its branch merges, since the conflict comes at the merge (D-093). */
export const IN_FLIGHT_STATES: readonly State[] = ['running', 'review', 'rework', 'blocked'];

/** Tasks in flight: dispatched, with a branch, and not done or back to do. */
export const inFlight = (ledger: Pick<Ledger, 'tasks'>, except?: string): Task[] =>
  ledger.tasks.filter((t) => t.id !== except && IN_FLIGHT_STATES.includes(t.state) && !!t.run?.branch);

/** The paths in git's -z output, one a field. */
export const nulPaths = (stdout: string): string[] => stdout.split('\0').filter(Boolean);

/**
 * The ref a task's branch can be read at in this clone: its local branch, else origin's copy, fetched
 * first with `fetch`. Null when neither is here, as for a branch another clone made and never pushed.
 */
export function branchRef(run: Runner, root: string, branch: string, o: { fetch?: boolean } = {}): string | null {
  const has = (ref: string) => run('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root }).code === 0;
  const local = `refs/heads/${branch}`;
  if (has(local)) return local;
  if (o.fetch) run('git', ['fetch', '--quiet', 'origin', branch], { cwd: root, timeoutMs: 60_000 });
  const remote = `refs/remotes/origin/${branch}`;
  return has(remote) ? remote : null;
}

/**
 * What a task's branch changed since it left its environment's branch: its commits, and in its worktree,
 * when it has one, what isn't committed yet, untracked files too. A rename counts as both paths. Empty
 * when git can't say, as when the branch isn't in this clone.
 */
export function branchFiles(run: Runner, root: string, env: string, branch: string, worktree?: string | null): string[] {
  try {
    return branchFilesAt(run, root, env, `refs/heads/${branch}`, worktree);
  } catch {
    return [];
  }
}

/**
 * branchFiles's reading, at a ref (a local branch, or origin's copy), which throws where git can't say:
 * no environment branch to compare with, or a ref it can't diff. A worktree it can't diff holds nothing.
 */
export function branchFilesAt(run: Runner, root: string, env: string, ref: string, worktree?: string | null): string[] {
  const base = baseFor(run, root, { branch: env }, ref);
  const files = new Set<string>();
  for (const c of changedPaths(run, root, base, ref)) files.add(c.path);
  if (worktree && existsSync(worktree)) {
    try {
      for (const c of changedPaths(run, worktree, base)) files.add(c.path);
    } catch {
      // nor does a worktree
    }
    const untracked = run('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: worktree });
    if (untracked.code === 0) for (const f of nulPaths(untracked.stdout)) files.add(f);
  }
  return [...files].sort();
}

/**
 * Whether a task's change is in its environment's branch: it's done, its pull request merged, or a pull
 * request was opened from it and its branch is now an ancestor of origin's copy, as after a merge commit.
 * A squash merge waits for acc sync to mark it done.
 */
export function branchMerged(run: Runner, root: string, task: Pick<Task, 'state' | 'pr' | 'run' | 'environment'>, ref?: string): boolean {
  if (task.state === 'done' || task.pr?.state === 'merged') return true;
  if (!task.pr || !task.run?.branch) return false;
  return run('git', ['merge-base', '--is-ancestor', ref ?? `refs/heads/${task.run.branch}`, `refs/remotes/origin/${task.environment}`], { cwd: root }).code === 0;
}

/**
 * Each task in flight whose change hasn't merged, with its files: what its analysis plans, and what its
 * branch has changed. With `fetch`, origin's copy of each environment a pull request goes into is fetched
 * first, once, so a merged one is seen as merged.
 */
export function inFlightFiles(paths: RepoPaths, ledger: Pick<Ledger, 'tasks'>, run: Runner, o: { except?: string; fetch?: boolean } = {}): FileShare[] {
  const tasks = inFlight(ledger, o.except);
  if (o.fetch) for (const env of new Set(tasks.filter((t) => t.pr).map((t) => t.environment))) run('git', ['fetch', '--quiet', 'origin', env], { cwd: paths.root, timeoutMs: 60_000 });
  return tasks.filter((t) => !branchMerged(run, paths.root, t)).map((t) => ({
    task: t.id,
    files: [...new Set([...(plannedFiles(readAnalysis(paths, t.id), paths.root) ?? []), ...branchFiles(run, paths.root, t.environment, t.run!.branch!, t.run!.worktree)])].sort(),
  }));
}

/** A strict reading of the tasks in flight: each one's files, and each whose files couldn't be read, with why. */
export interface InFlightStrict {
  shares: FileShare[];
  unreadable: { task: string; why: string }[];
}

/**
 * inFlightFiles that fails closed (D-T-115): a task whose branch isn't in this clone is read from origin's
 * copy after a fetch, and one that still can't be read is named, never left out as sharing nothing. A
 * deploy asks this, so it never goes over work it couldn't see. Origin's copy of each environment a pull
 * request goes into is fetched first, so a merged task is seen as merged.
 */
export function inFlightFilesStrict(paths: RepoPaths, ledger: Pick<Ledger, 'tasks'>, run: Runner, o: { except?: string } = {}): InFlightStrict {
  const tasks = inFlight(ledger, o.except);
  for (const env of new Set(tasks.filter((t) => t.pr).map((t) => t.environment))) run('git', ['fetch', '--quiet', 'origin', env], { cwd: paths.root, timeoutMs: 60_000 });
  const out: InFlightStrict = { shares: [], unreadable: [] };
  for (const t of tasks) {
    const branch = t.run!.branch!;
    const ref = branchRef(run, paths.root, branch, { fetch: true });
    if (!ref) {
      out.unreadable.push({ task: t.id, why: `its branch ${branch} isn't in this clone or on origin` });
      continue;
    }
    if (branchMerged(run, paths.root, t, ref)) continue;
    try {
      const files = branchFilesAt(run, paths.root, t.environment, ref, t.run!.worktree);
      out.shares.push({ task: t.id, files: [...new Set([...(plannedFiles(readAnalysis(paths, t.id), paths.root) ?? []), ...files])].sort() });
    } catch (e) {
      out.unreadable.push({ task: t.id, why: `git couldn't read ${ref}: ${(e as Error).message}` });
    }
  }
  return out;
}

/** A task to do, as the order tasks start in weighs it: its planned files, and whether it could start now. */
export interface StartCandidate {
  id: string;
  files: string[] | null;
  startable: boolean;
}

/** What decides whether a task to do starts now (D-093). */
export interface StartLook {
  /** The tasks in flight whose files its plan shares, and those files. */
  shares: FileShare[];
  /** Ready tasks that share no files with anything in flight, which start first. Empty unless it shares files. */
  first: string[];
}

/**
 * Whether a task to do waits, and for what. It waits only while it shares files with work in flight and
 * some other task could start now that shares none, as the author chose: prefer, don't block. A task whose
 * files aren't known never waits, and never counts as one sharing none.
 */
export function startOrder(task: Pick<StartCandidate, 'id' | 'files'>, candidates: StartCandidate[], flying: FileShare[], shared: string[]): StartLook {
  const shares = overlaps(task.files, flying.filter((f) => f.task !== task.id), shared);
  const first = shares.length
    ? candidates.filter((c) => c.id !== task.id && c.startable && !!c.files?.length && !overlaps(c.files, flying, shared).length).map((c) => c.id)
    : [];
  return { shares, first };
}

/** Whether it waits: it shares files, and another task can go first. */
export const waits = (look: StartLook): boolean => look.shares.length > 0 && look.first.length > 0;

/**
 * Whether agents may work in a task's environment: it's in the config and not protected, as the todo →
 * running rule checks (envNotProtected). A task that can't start there never goes first.
 */
export const envOpen = (config: Pick<Config, 'environments'>, task: Pick<Task, 'environment'>): boolean => {
  const env = environmentByBranch(config, task.environment);
  return !!env && !env.protected;
};

/**
 * Every task to do, as a candidate to start: its planned files, and whether it could start now, Ready
 * in an environment agents may work in, with nothing in its analysis holding it, and no start of its own
 * that failed.
 */
export function startCandidates(paths: RepoPaths, config: Config, ledger: Ledger): StartCandidate[] {
  return ledger.tasks.filter((t) => t.state === 'todo').map((t) => ({
    id: t.id,
    files: plannedFiles(readAnalysis(paths, t.id), paths.root),
    startable: isReady(ledger, t) && envOpen(config, t) && !t.held?.failed && !analysisProblems(paths, config, t).length,
  }));
}

/** startOrder for one task to do, against what's in flight now, read from git. `files` are its planned files, when they were read already. */
export function startLook(paths: RepoPaths, config: Config, ledger: Ledger, run: Runner, id: string, o: { fetch?: boolean; flying?: FileShare[]; files?: string[] | null } = {}): StartLook {
  const files = o.files !== undefined ? o.files : plannedFiles(readAnalysis(paths, id), paths.root);
  const flying = o.flying ?? inFlightFiles(paths, ledger, run, { except: id, fetch: o.fetch });
  return startOrder({ id, files }, startCandidates(paths, config, ledger), flying, sharedFiles(config));
}

// ---------------------------------------------------------------- in words

/** "GH-70's files: a.ts, b.ts", and each further task's: "GH-70's files: a.ts, and GH-71's: c.ts". */
export function filesOf(shares: FileShare[], name: (files: string[]) => string = (f) => f.join(', ')): string {
  return shares.map((s, i) => `${s.task}'s${i ? '' : ' files'}: ${name(s.files)}`).join(', and ');
}

/** "Waits for GH-70's files: a.ts, b.ts", as a card, acc show and autopilot say it. */
export const waitWords = (shares: FileShare[], name?: (files: string[]) => string): string => `Waits for ${filesOf(shares, name)}`;

/** "Shares files with GH-70: a.ts", and each further task's: "Shares files with GH-70: a.ts, and GH-71: c.ts". */
export function sharesWords(shares: FileShare[], name: (files: string[]) => string = (f) => f.join(', ')): string {
  return `Shares files with ${shares.map((s) => `${s.task}: ${name(s.files)}`).join(', and ')}`;
}

/** "GH-74", "GH-74 and GH-75", "GH-74, GH-75 and GH-76". */
export function taskList(ids: string[]): string {
  return ids.length > 1 ? `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}` : (ids[0] ?? '');
}
