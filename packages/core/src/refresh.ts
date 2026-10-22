import { existsSync } from 'node:fs';
import { type Config, type Environment, environmentByBranch, fullGates } from './config.ts';
import { mainCheckout } from './dispatch.ts';
import { AccError, type RunResult, type Runner } from './exec.ts';
import { type Gate, type GateResult, listed, priorTests, runGates } from './gates.ts';
import { withJob } from './jobs.ts';
import { type Actor, mutate, readLedger, type Task } from './ledger.ts';
import { type RepoPaths, repoPaths, samePath } from './paths.ts';
import { FLOORS_FILE, mergeFloors } from './ratchets.ts';
import { satisfies } from './receipts.ts';
import type { SlotOptions } from './semaphore.ts';
import { conflictsOf, fetchBranches } from './sync.ts';

/**
 * Refreshing a pull request (D-058): when its base moved on and it conflicts, autopilot merges the base
 * into the task's branch, in the task's worktree. It resolves only files listed in `autopilot.appendOnly`
 * where both sides added to the end, by keeping both. Any other conflict leaves the branch as it was, for
 * a person. The merge commit's checks run before anything else; it's reviewed and landed in the passes
 * after, like any commit, so nothing that hasn't passed is pushed. Where auto-merge is on, the merge queue
 * takes the same parts one at a time, at a task's turn (GH-73): mergeBaseIn, then checkCommit.
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
 * Resolves one conflicted file with `merge`, given the merge base's text and each side's, when it's a
 * plain text file at the same path on both sides. Deleted, renamed, a link or binary, or a merge that
 * returns null: false, and it's left. A file added on both sides has no merge base's text: only with
 * `added`, as the floors file can be (GH-99), is it merged from an empty one.
 */
function resolveWith(run: Runner, wt: string, mergeBase: string, path: string, stages: Map<number, Stage>, merge: (common: string, ours: string, theirs: string) => string | null, added = false): boolean {
  const git = (...args: string[]) => run('git', args, { cwd: wt });
  const [common, ours, theirs] = [stages.get(1), stages.get(2), stages.get(3)];
  if ((!common && !added) || !ours || !theirs) return false;
  if (![common, ours, theirs].every((s) => !s || s.mode === '100644' || s.mode === '100755')) return false;
  // The same path on each side and in the merge base: a rename put none of these stages here.
  const at = (ref: string) => git('rev-parse', '--verify', '--quiet', `${ref}:${path}`).stdout.trim();
  if (at(mergeBase) !== (common?.sha ?? '') || at('HEAD') !== ours.sha || at('MERGE_HEAD') !== theirs.sha) return false;
  const blobs = [common, ours, theirs].map((s) => (s ? git('cat-file', 'blob', s.sha) : { code: 0, stdout: '', stderr: '' }));
  if (blobs.some((b) => b.code !== 0 || !isText(b.stdout))) return false;
  const merged = merge(blobs[0]!.stdout, blobs[1]!.stdout, blobs[2]!.stdout);
  if (merged === null) return false;
  // Into the index as it is, then out to the file, so the repo's line endings and filters apply.
  const blob = run('git', ['hash-object', '-w', '--stdin'], { cwd: wt, input: merged });
  if (blob.code !== 0) return false;
  if (git('update-index', '--cacheinfo', `${ours.mode},${blob.stdout.trim()},${path}`).code !== 0) return false;
  return git('checkout', '--', path).code === 0;
}

/**
 * What autopilot did to the files it resolved, as a merge message, a refresh and a pull request say it:
 * "kept both sides' additions to docs/DECISIONS.md", "kept the better of each ratchet's floors in
 * .acc/floors.json" (GH-99), or both. `keeping` for a clause after a comma; `file` names a file as wanted.
 */
export function resolvedWords(resolved: string[], verb: 'kept' | 'keeping' = 'kept', file = (f: string) => f): string {
  const added = resolved.filter((f) => f !== FLOORS_FILE);
  return [
    ...(added.length ? [`${verb} both sides' additions to ${added.map(file).join(', ')}`] : []),
    ...(resolved.includes(FLOORS_FILE) ? [`${verb} the better of each ratchet's floors in ${file(FLOORS_FILE)}`] : []),
  ].join(', and ');
}

// ---------------------------------------------------------------- the parts, which the merge queue takes one at a time (GH-73)

/** A task's own worktree, where autopilot merges its base in and checks the merge: on its branch, with nothing uncommitted. */
export interface MergePlace {
  id: string;
  env: Environment;
  branch: string;
  wt: string;
  /** The branch's commit before anything is merged: where a failure puts it back. */
  from: string;
}

/** The base couldn't be merged in: conflicts in files autopilot doesn't resolve. The branch is as it was. */
export class MergeConflict extends AccError {
  readonly files: string[];
  constructor(message: string, files: string[]) {
    super('refresh', message);
    this.files = files;
  }
}

/** The checks failed on the commit, each with its summary and its log. The branch is as it was. */
export class CheckFailure extends AccError {
  readonly failed: GateResult[];
  constructor(message: string, failed: GateResult[]) {
    super('refresh', message);
    this.failed = failed;
  }
}

const gitIn = (run: Runner, wt: string) => (...args: string[]) => run('git', args, { cwd: wt });
const midMerge = (run: Runner, wt: string): boolean => gitIn(run, wt)('rev-parse', '--verify', '--quiet', 'MERGE_HEAD').code === 0;
const dirtyIn = (run: Runner, wt: string, untracked = true): boolean => gitIn(run, wt)('status', '--porcelain', ...(untracked ? [] : ['--untracked-files=no'])).stdout.trim() !== '';

/**
 * The task's worktree, ready to merge into (D-058): its own, never the main checkout, on its branch, with
 * nothing uncommitted and nothing half merged. Anything else is refused, and nothing is touched.
 */
export function mergePlace(paths: RepoPaths, config: Config, task: Task, run: Runner): MergePlace {
  const id = task.id;
  const env = environmentByBranch(config, task.environment);
  if (!env) throw new AccError('refresh', `${id}'s environment "${task.environment}" isn't in the config.`);
  const branch = task.run?.branch;
  const wt = task.run?.worktree;
  if (!branch) throw new AccError('refresh', `${id} has no branch.`);
  if (!wt || !existsSync(wt)) throw new AccError('refresh', `${id}'s worktree isn't on disk any more, so there's nowhere to merge ${env.branch} in.`);
  if (samePath(wt, mainCheckout(run, paths.root))) throw new AccError('refresh', `${id}'s worktree is the main checkout. Autopilot merges only in a task's own worktree.`);
  const git = gitIn(run, wt);
  const on = git('symbolic-ref', '--quiet', '--short', 'HEAD').stdout.trim();
  if (on !== branch) throw new AccError('refresh', `${wt} is on ${on || 'a detached commit'}, not ${branch}.`);
  if (dirtyIn(run, wt) || midMerge(run, wt)) throw new AccError('refresh', `${id}'s worktree has changes nobody committed, so autopilot leaves it alone.`);
  return { id, env, branch, wt, from: git('rev-parse', 'HEAD').stdout.trim() };
}

/**
 * Brings the base and the branch from origin, unattended, so git never stops to ask for a password. Refuses
 * when origin's branch has commits this clone's lacks, as after GitHub's "Update branch": merging here
 * would leave the branch unable to push.
 */
export function fetchBase(paths: RepoPaths, place: MergePlace, run: Runner, env: NodeJS.ProcessEnv): void {
  const { branch, from } = place;
  if (!fetchBranches(run, paths.root, [place.env.branch, branch], { ...env, GIT_TERMINAL_PROMPT: '0' })) {
    throw new AccError('refresh', `Couldn't fetch ${place.env.branch} and ${branch} from origin.`);
  }
  if (gitIn(run, place.wt)('merge-base', '--is-ancestor', `refs/remotes/origin/${branch}`, from).code !== 0) {
    throw new AccError('refresh', `origin's ${branch} has commits this clone's branch doesn't, perhaps from GitHub. Bring them in by hand.`);
  }
}

/** git as the repo's commit identity, with rerere off, so an answer remembered from another merge never stands in. */
export const merging = (config: Config, run: Runner, wt: string) => {
  const who = config.commitIdentity ? ['-c', `user.name=${config.commitIdentity.name}`, '-c', `user.email=${config.commitIdentity.email}`] : [];
  return (...args: string[]) => run('git', ['-c', 'rerere.enabled=false', ...who, ...args], { cwd: wt });
};

/**
 * Undoes a merge, and says whether the branch is as it was. Files nobody tracks are left out: the
 * worktree had none before, so any now are what a check wrote.
 */
function putBack(config: Config, place: MergePlace, run: Runner, how: string[]): string {
  const { wt, from } = place;
  merging(config, run, wt)(...how);
  const back = gitIn(run, wt)('rev-parse', 'HEAD').stdout.trim() === from && !dirtyIn(run, wt, false) && !midMerge(run, wt);
  return back ? `The branch is as it was, at ${short(from)}, and nothing was pushed.` : `Putting the branch back at ${short(from)} didn't work: look at ${wt} before anything else.`;
}

/** Puts the branch back where it was before a merge commit, as the merge queue does when it couldn't push one (GH-73). */
export const undoMerge = (config: Config, place: MergePlace, run: Runner): string => putBack(config, place, run, ['reset', '--hard', place.from]);

/**
 * Merges origin's copy of the base into the worktree as one commit (D-058), resolving only append-only
 * files both sides added to the end of, by keeping both. Null when there was nothing to merge in. A
 * conflict it can't resolve is a MergeConflict; anything else that stops it is an AccError. Either way the
 * branch is put back as it was. The repo's hooks run on the commit. With `leave`, as a builder's own acc
 * refresh asks (T-103), a conflict it can't resolve is left in the worktree, half merged, for the builder
 * to resolve; `by` names who resolved the rest in the commit's message.
 */
export function mergeBaseIn(config: Config, place: MergePlace, run: Runner, o: { leave?: boolean; by?: string } = {}): { sha: string; resolved: string[] } | null {
  const { env, branch, wt } = place;
  const git = gitIn(run, wt);
  const merge = merging(config, run, wt);
  const merged = merge('merge', '--no-ff', '--no-commit', `origin/${env.branch}`);
  if (!midMerge(run, wt)) {
    if (merged.code === 0) return null; // already up to date
    throw new AccError('refresh', `git wouldn't merge ${env.branch} in: ${lastLines(merged)} ${putBack(config, place, run, ['reset', '--merge'])}`);
  }
  const appendOnly = config.autopilot?.appendOnly ?? [];
  const mergeBase = git('merge-base', 'HEAD', 'MERGE_HEAD').stdout.trim();
  const resolved: string[] = [];
  const left: string[] = [];
  for (const [path, stages] of unmerged(run, wt)) {
    // Both sides raised floors (GH-99): each ratchet keeps the better. One that a person relaxed is left.
    if (path === FLOORS_FILE ? resolveWith(run, wt, mergeBase, path, stages, mergeFloors, true) : listed(path, appendOnly) && resolveWith(run, wt, mergeBase, path, stages, appendOnlyMerge)) resolved.push(path);
    else left.push(path);
  }
  if (left.length && o.leave) throw new MergeConflict(`Conflicts with ${env.branch} in ${left.join(', ')}. The merge is left in ${wt} for you to resolve: fix each file, git add it, then git commit. Nothing was pushed.`, left);
  if (left.length) throw new MergeConflict(`Conflicts with ${env.branch} that autopilot can't resolve: ${left.join(', ')}. ${putBack(config, place, run, ['merge', '--abort'])}`, left);
  if (merged.code !== 0 && !resolved.length) throw new AccError('refresh', `git couldn't merge ${env.branch} in: ${lastLines(merged)} ${putBack(config, place, run, ['merge', '--abort'])}`);
  const message = [`Merge ${env.branch} into ${branch}`, ...(resolved.length ? ['', `${o.by ?? 'Autopilot'} ${resolvedWords(resolved)}.`] : [])].join('\n');
  // The repo's hooks run, as on any commit.
  const commit = merge('commit', '-m', message);
  if (commit.code !== 0) throw new AccError('refresh', `The merge commit was refused: ${lastLines(commit)} ${putBack(config, place, run, ['merge', '--abort'])}`);
  return { sha: git('rev-parse', 'HEAD').stdout.trim(), resolved };
}

export interface CheckDeps {
  run: Runner;
  now: () => Date;
  slots?: SlotOptions;
  /** Told when a heavy gate has to wait for the machine's slot, and when it starts. */
  onWait?: (gate: Gate) => void;
  onStart?: (gate: Gate) => void;
}

/**
 * Runs the gates on the worktree's commit, `sha`, with the tests the commit before named, before anything
 * else happens. A failure is a CheckFailure, and one that couldn't run, such as a heavy-check slot that
 * stayed taken (D-069), an AccError with its code. Either way the branch goes back to `from` (D-058).
 * A waiver holds for its own commit (D-031), except that a person's waiver on the head clears a hold, not a
 * fail or an error, on the merge of that head (GH-100).
 */
export function checkCommit(paths: RepoPaths, config: Config, place: MergePlace, sha: string, gates: string[], deps: CheckDeps): void {
  const { env, wt, from } = place;
  const { run } = deps;
  const what = sha === from ? 'Its checks' : `Merged ${env.branch} in, but its checks`;
  let failed: GateResult[] = [];
  try {
    if (gates.length) {
      const ran = runGates(repoPaths(wt, run), config, env, gates, priorTests(paths, config, from), { run, now: deps.now, slots: deps.slots, task: place.id, onWait: deps.onWait, onStart: deps.onStart, waivedOn: from });
      failed = ran.results.filter((r) => !r.recorded || !satisfies(r.receipt));
    }
  } catch (e) {
    const err = e as AccError;
    throw new AccError(err.code ?? 'refresh', `${what} couldn't run: ${err.message} ${putBack(config, place, run, ['reset', '--hard', from])}`);
  }
  if (failed.length) {
    const said = failed.map((r) => `${r.gate} ${!r.recorded ? 'wasn\'t recorded' : r.status === 'fail' ? 'failed' : r.status === 'hold' ? 'needs a person' : 'couldn\'t run'}: ${r.summary.replace(/[.!?]$/, '')}${r.receipt.log ? ` (log ${r.receipt.log})` : ''}`);
    throw new CheckFailure(`${what} failed on ${short(sha)}: ${said.join('; ')}. ${putBack(config, place, run, ['reset', '--hard', from])}`, failed);
  }
}

// ---------------------------------------------------------------- a refresh, all of it (D-058)

/**
 * A refresh is for conflicts only: a pull request only behind its base is left alone. Where auto-merge is
 * on, the merge queue brings one up to date at its turn (GH-73), with mergeBaseIn and checkCommit.
 */
export function refresh(paths: RepoPaths, config: Config, id: string, deps: RefreshDeps, opts: { actor: Actor; by: string }): RefreshResult {
  // Marked under way while it runs, so every window shows it (D-092).
  return withJob(paths, { kind: 'refresh', task: id, by: opts.by }, () => refreshNow(paths, config, id, deps, opts), deps.now);
}

function refreshNow(paths: RepoPaths, config: Config, id: string, deps: RefreshDeps, opts: { actor: Actor; by: string }): RefreshResult {
  const { run, now } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  const pr = task.pr;
  if (task.state !== 'review' || pr?.state !== 'open') throw new AccError('refused', `${id} is ${task.state}${pr ? ` with pull request #${pr.number} ${pr.state}` : ' with no pull request'}. Autopilot updates the open pull request of a task in review.`);
  const place = mergePlace(paths, config, task, run);
  const { env, branch, from } = place;
  fetchBase(paths, place, run, deps.env);
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
  // What acc last saw can be stale: ask git again before merging anything.
  if (conflictsOf(run, paths.root, env.branch, branch)?.length === 0) return settled();

  const made = mergeBaseIn(config, place, run);
  if (!made) return settled(); // already up to date
  const { sha, resolved } = made;

  // Its checks, on the merge commit, before anything else happens. A waiver holds for its own commit (D-031),
  // except that a person's waiver on the head clears a hold on this merge of it (GH-100).
  const required = fullGates(config);
  checkCommit(paths, config, place, sha, required, { run, now, slots: deps.slots });

  const refreshed = { base: env.branch, from, to: sha, resolved };
  record((t) => {
    // Updated, by autopilot: whatever it couldn't do before is behind it (D-055).
    if (t.autopilot?.failed) t.autopilot.failed = null;
    return { refreshed };
  });
  const kept = resolved.length ? `, ${resolvedWords(resolved, 'keeping')}` : '';
  return { sha, from, resolved, reason: `Merged ${env.branch} into ${short(from)} as ${short(sha)}${kept}.${required.length ? ' Its checks passed.' : ''} It's reviewed next pass, then landed.` };
}
