import { existsSync, realpathSync } from 'node:fs';
import { type Config, environmentByBranch } from './config.ts';
import { mainCheckout } from './dispatch.ts';
import { AccError, type RunResult, type Runner } from './exec.ts';
import { listed, priorTests, runGates } from './gates.ts';
import { withJob } from './jobs.ts';
import { type Actor, mutate, readLedger, type Task } from './ledger.ts';
import { type RepoPaths, repoPaths } from './paths.ts';
import { satisfies } from './receipts.ts';
import type { SlotOptions } from './semaphore.ts';
import { conflictsOf, fetchBranches } from './sync.ts';

/**
 * Refreshing a pull request (D-058): when its base moved on and it conflicts, or with auto-merge on when
 * it's only behind (GH-67), autopilot merges the base into the task's branch, in the task's worktree. It resolves only files listed in `autopilot.appendOnly`
 * where both sides added to the end, by keeping both. Any other conflict leaves the branch as it was, for
 * a person. The merge commit's checks run before anything else; it's reviewed and landed in the passes
 * after, like any commit, so nothing that hasn't passed is pushed.
 */

export interface RefreshDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  /** The heavy-check slot its checks take, machine-wide unless a test says otherwise. */
  slots?: SlotOptions;
}

export interface RefreshResult {
  /** The merge commit, or null when nothing was merged: the pull request no longer conflicted. */
  sha: string | null;
  /** The branch's commit before. */
  from: string;
  /** Files whose additions on both sides were kept. */
  resolved: string[];
  reason: string;
}

const short = (sha: string): string => sha.slice(0, 7);
const lastLines = (r: RunResult): string => (r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ');

/**
 * A file both sides only added to: the merge base's content, then the base branch's additions (theirs),
 * then the task branch's (ours). Null when either side changed anything before its end. The same
 * addition on both sides is kept once, as git keeps it.
 */
export function appendOnlyMerge(common: string, ours: string, theirs: string): string | null {
  if (!ours.startsWith(common) || !theirs.startsWith(common)) return null;
  let start = common;
  let mine = ours.slice(common.length);
  let added = theirs.slice(common.length);
  // A last line without its newline: each side's addition begins by ending that line, and it's ended once.
  if (start && !start.endsWith('\n') && (mine || added)) {
    if ([mine, added].some((t) => t && !t.startsWith('\n'))) return null; // that line itself changed
    start += '\n';
    mine = mine.slice(1);
    added = added.slice(1);
  }
  if (mine === added) return start + mine;
  // One side already holds the other's addition, as a branch stacked on another does: keep it once.
  if (added.startsWith(mine)) return start + added;
  if (mine.startsWith(added)) return start + mine;
  // Entries stay on lines of their own when the base branch's addition doesn't end its last line.
  return start + added + (added && mine && !added.endsWith('\n') ? '\n' : '') + mine;
}

interface Stage {
  mode: string;
  sha: string;
}

/** The files git couldn't merge, each with its stages: 1 the merge base's, 2 ours, 3 theirs. */
function unmerged(run: Runner, wt: string): Map<string, Map<number, Stage>> {
  const out = new Map<string, Map<number, Stage>>();
  for (const entry of run('git', ['ls-files', '-u', '-z'], { cwd: wt }).stdout.split('\0')) {
    const m = /^(\d+) ([0-9a-f]+) ([123])\t(.+)$/s.exec(entry);
    if (!m) continue;
    const stages = out.get(m[4]!) ?? new Map<number, Stage>();
    stages.set(Number(m[3]), { mode: m[1]!, sha: m[2]! });
    out.set(m[4]!, stages);
  }
  return out;
}

/** Text git can hand back as it was: no NUL, and nothing that didn't read as UTF-8. */
const isText = (s: string): boolean => !s.includes('\0') && !s.includes('�');

/**
 * Resolves one conflicted file by keeping both sides' additions, when that's all they were. Edited
 * anywhere but its end, added on both sides, deleted, renamed, a link or binary: false, and it's left.
 */
function resolveAppend(run: Runner, wt: string, mergeBase: string, path: string, stages: Map<number, Stage>): boolean {
  const git = (...args: string[]) => run('git', args, { cwd: wt });
  const [common, ours, theirs] = [stages.get(1), stages.get(2), stages.get(3)];
  if (!common || !ours || !theirs) return false;
  if (![common, ours, theirs].every((s) => s.mode === '100644' || s.mode === '100755')) return false;
  // The same path on each side and in the merge base: a rename put none of these stages here.
  const at = (ref: string) => git('rev-parse', '--verify', '--quiet', `${ref}:${path}`).stdout.trim();
  if (at(mergeBase) !== common.sha || at('HEAD') !== ours.sha || at('MERGE_HEAD') !== theirs.sha) return false;
  const blobs = [common, ours, theirs].map((s) => git('cat-file', 'blob', s.sha));
  if (blobs.some((b) => b.code !== 0 || !isText(b.stdout))) return false;
  const merged = appendOnlyMerge(blobs[0]!.stdout, blobs[1]!.stdout, blobs[2]!.stdout);
  if (merged === null) return false;
  // Into the index as it is, then out to the file, so the repo's line endings and filters apply.
  const blob = run('git', ['hash-object', '-w', '--stdin'], { cwd: wt, input: merged });
  if (blob.code !== 0) return false;
  if (git('update-index', '--cacheinfo', `${ours.mode},${blob.stdout.trim()},${path}`).code !== 0) return false;
  return git('checkout', '--', path).code === 0;
}

const samePath = (a: string, b: string): boolean => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
};

/**
 * With `behind`, the base is merged in even when it would merge cleanly: auto-merge brings a pull request
 * up to date with its base before it merges it (GH-67). Without it, a refresh is for conflicts only.
 */
export function refresh(paths: RepoPaths, config: Config, id: string, deps: RefreshDeps, opts: { actor: Actor; by: string; behind?: boolean }): RefreshResult {
  // Marked under way while it runs, so every window shows it (D-092).
  return withJob(paths, { kind: 'refresh', task: id, by: opts.by }, () => refreshNow(paths, config, id, deps, opts), deps.now);
}

function refreshNow(paths: RepoPaths, config: Config, id: string, deps: RefreshDeps, opts: { actor: Actor; by: string; behind?: boolean }): RefreshResult {
  const { run, now } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  const pr = task.pr;
  if (task.state !== 'review' || pr?.state !== 'open') throw new AccError('refused', `${id} is ${task.state}${pr ? ` with pull request #${pr.number} ${pr.state}` : ' with no pull request'}. Autopilot updates the open pull request of a task in review.`);
  const env = environmentByBranch(config, task.environment);
  if (!env) throw new AccError('refresh', `${id}'s environment "${task.environment}" isn't in the config.`);
  const branch = task.run?.branch;
  const wt = task.run?.worktree;
  if (!branch) throw new AccError('refresh', `${id} has no branch.`);
  if (!wt || !existsSync(wt)) throw new AccError('refresh', `${id}'s worktree isn't on disk any more, so there's nowhere to merge ${env.branch} in.`);
  if (samePath(wt, mainCheckout(run, paths.root))) throw new AccError('refresh', `${id}'s worktree is the main checkout. Autopilot merges only in a task's own worktree.`);
  const git = (...args: string[]) => run('git', args, { cwd: wt });
  const on = git('symbolic-ref', '--quiet', '--short', 'HEAD').stdout.trim();
  if (on !== branch) throw new AccError('refresh', `${wt} is on ${on || 'a detached commit'}, not ${branch}.`);
  const mid = () => git('rev-parse', '--verify', '--quiet', 'MERGE_HEAD').code === 0;
  const dirty = (untracked = true) => git('status', '--porcelain', ...(untracked ? [] : ['--untracked-files=no'])).stdout.trim() !== '';
  if (dirty() || mid()) throw new AccError('refresh', `${id}'s worktree has changes nobody committed, so autopilot leaves it alone.`);
  const from = git('rev-parse', 'HEAD').stdout.trim();

  // Unattended, so git never stops to ask for a password.
  if (!fetchBranches(run, paths.root, [env.branch, branch], { ...deps.env, GIT_TERMINAL_PROMPT: '0' })) {
    throw new AccError('refresh', `Couldn't fetch ${env.branch} and ${branch} from origin.`);
  }
  // Someone updated the pull request on GitHub: merging here would leave the branch unable to push.
  if (git('merge-base', '--is-ancestor', `refs/remotes/origin/${branch}`, from).code !== 0) {
    throw new AccError('refresh', `origin's ${branch} has commits this clone's branch doesn't, perhaps from GitHub. Bring them in by hand.`);
  }
  const record = (change: (t: Task) => Record<string, unknown>) => mutate(paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === id);
    if (!t) return;
    const data = change(t);
    t.updatedAt = now().toISOString();
    emit({ type: 'task.updated', task: id, actor: opts.actor, by: opts.by, data });
  });
  const settled = (): RefreshResult => {
    record((t) => {
      if (t.pr) t.pr = { ...t.pr, conflicts: [] };
      return { pr: t.pr };
    });
    return { sha: null, from, resolved: [], reason: `Pull request #${pr.number} no longer conflicts with ${env.branch}, so nothing was merged.` };
  };
  // What acc last saw can be stale: ask git again before merging anything. A pull request only behind its
  // base is merged with it all the same.
  if (!opts.behind && conflictsOf(run, paths.root, env.branch, branch)?.length === 0) return settled();
  /** Nothing to merge in after all: the base has nothing the branch lacks. A conflict acc saw is marked gone. */
  const upToDate = (): RefreshResult => (pr.conflicts?.length ? settled() : { sha: null, from, resolved: [], reason: `Pull request #${pr.number} already has everything on ${env.branch}, so nothing was merged.` });
  if (opts.behind && git('merge-base', '--is-ancestor', `refs/remotes/origin/${env.branch}`, from).code === 0) return upToDate();

  // rerere off, so an answer remembered from another merge never stands in for these rules.
  const who = config.commitIdentity ? ['-c', `user.name=${config.commitIdentity.name}`, '-c', `user.email=${config.commitIdentity.email}`] : [];
  const merge = (...args: string[]) => run('git', ['-c', 'rerere.enabled=false', ...who, ...args], { cwd: wt });
  /**
   * Undoes the merge, and says whether the branch is as it was. Files nobody tracks are left out: the
   * worktree had none before, so any now are what a check wrote.
   */
  const putBack = (how: string[]): string => {
    merge(...how);
    const back = git('rev-parse', 'HEAD').stdout.trim() === from && !dirty(false) && !mid();
    return back ? `The branch is as it was, at ${short(from)}, and nothing was pushed.` : `Putting the branch back at ${short(from)} didn't work: look at ${wt} before anything else.`;
  };

  const merged = merge('merge', '--no-ff', '--no-commit', `origin/${env.branch}`);
  if (!mid()) {
    if (merged.code === 0) return opts.behind ? upToDate() : settled(); // already up to date
    throw new AccError('refresh', `git wouldn't merge ${env.branch} in: ${lastLines(merged)} ${putBack(['reset', '--merge'])}`);
  }
  const appendOnly = config.autopilot?.appendOnly ?? [];
  const mergeBase = git('merge-base', 'HEAD', 'MERGE_HEAD').stdout.trim();
  const resolved: string[] = [];
  const left: string[] = [];
  for (const [path, stages] of unmerged(run, wt)) {
    if (listed(path, appendOnly) && resolveAppend(run, wt, mergeBase, path, stages)) resolved.push(path);
    else left.push(path);
  }
  if (left.length) throw new AccError('refresh', `Conflicts with ${env.branch} that autopilot can't resolve: ${left.join(', ')}. ${putBack(['merge', '--abort'])}`);
  if (merged.code !== 0 && !resolved.length) throw new AccError('refresh', `git couldn't merge ${env.branch} in: ${lastLines(merged)} ${putBack(['merge', '--abort'])}`);
  const message = [`Merge ${env.branch} into ${branch}`, ...(resolved.length ? ['', `Autopilot kept both sides' additions to ${resolved.join(', ')}.`] : [])].join('\n');
  // The repo's hooks run, as on any commit.
  const commit = merge('commit', '-m', message);
  if (commit.code !== 0) throw new AccError('refresh', `The merge commit was refused: ${lastLines(commit)} ${putBack(['merge', '--abort'])}`);
  const sha = git('rev-parse', 'HEAD').stdout.trim();

  // Its checks, on the merge commit, before anything else happens. A waiver is for its own commit (D-031).
  const required = config.gates.required;
  let failed: string[] = [];
  try {
    if (required.length) {
      const ran = runGates(repoPaths(wt, run), config, env, required, priorTests(paths, config, from), { run, now, slots: deps.slots, task: id });
      failed = ran.results.filter((r) => !r.recorded || !satisfies(r.receipt))
        .map((r) => `${r.gate} ${!r.recorded ? 'wasn\'t recorded' : r.status === 'fail' ? 'failed' : 'couldn\'t run'}: ${r.summary.replace(/[.!?]$/, '')}${r.receipt.log ? ` (log ${r.receipt.log})` : ''}`);
    }
  } catch (e) {
    const err = e as AccError;
    throw new AccError(err.code ?? 'refresh', `Merged ${env.branch} in, but its checks couldn't run: ${err.message} ${putBack(['reset', '--hard', from])}`);
  }
  if (failed.length) throw new AccError('refresh', `Merged ${env.branch} in, but its checks failed on ${short(sha)}: ${failed.join('; ')}. ${putBack(['reset', '--hard', from])}`);

  const refreshed = { base: env.branch, from, to: sha, resolved, ...(opts.behind ? { behind: true } : {}) };
  record((t) => {
    // Updated, by autopilot: whatever it couldn't do before is behind it (D-055).
    if (t.autopilot?.failed) t.autopilot.failed = null;
    return { refreshed };
  });
  const kept = resolved.length ? `, keeping both sides' additions to ${resolved.join(', ')}` : '';
  return { sha, from, resolved, reason: `Merged ${env.branch} into ${short(from)} as ${short(sha)}${kept}.${required.length ? ' Its checks passed.' : ''} It's reviewed next pass, then landed.` };
}
