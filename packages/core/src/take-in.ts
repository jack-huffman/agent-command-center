import { type Config, isTestGate, requiredGates } from './config.ts';
import { AccError, type Runner } from './exec.ts';
import { fetchBranches } from './fetch.ts';
import { priorTests, runGates } from './gates.ts';
import type { GateStatus } from './receipts.ts';
import { withJob } from './jobs.ts';
import { type Actor, mutate, readLedger, type State } from './ledger.ts';
import { type RepoPaths, repoPaths } from './paths.ts';
import { MergeConflict, mergeBaseIn, mergePlace, resolvedWords } from './refresh.ts';
import type { SlotOptions } from './semaphore.ts';
import { type Landed, landedCommits, landedFor, ownFiles } from './team.ts';
import { sharedFiles } from './overlap.ts';

/**
 * acc refresh (T-103): a builder takes its teammates' merged work in early, while the conflicts are small.
 * In the task's own worktree, it fetches the environment's branch from origin and merges `origin/<env>`
 * into the task branch as a commit on that branch, resolving only what autopilot's refresh resolves
 * (D-058): append-only files and the floors file. Then it runs the builder's test checks on the merge.
 * A conflict stops it with the files listed: for the builder, the merge is left in its worktree to
 * resolve; for a person, whose run must not leave a builder's worktree half merged, it's undone. It never
 * pushes anything: the branch reaches origin only by acc land, autopilot or a person.
 */

export interface TakeInDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  slots?: SlotOptions;
}

export interface TakeInResult {
  task: string;
  /** The merge commit, or null when the branch already held the environment's branch. */
  sha: string | null;
  from: string;
  /** What the merge took in: each change that reached the environment's branch since the branch left it. */
  landed: Landed[];
  /** Files whose additions on both sides, or whose floors, were kept. */
  resolved: string[];
  /** The test checks run on the merge, each with how it went. */
  tests: { gate: string; status: GateStatus; summary: string }[];
  reason: string;
}

/** The states a task's worktree may take merges in: its builder works there, or will again. */
export const TAKE_IN_STATES: readonly State[] = ['running', 'rework', 'blocked'];

/** The builder's checks that run tests, as the merge is checked with: the tests near what changed, where the project has them. */
export const takeInGates = (config: Config, env: string): string[] => requiredGates(config, env, 'builder').filter((g) => isTestGate(config, g));

const short = (sha: string): string => sha.slice(0, 7);

/** acc refresh, marked under way while it runs so every window shows it (D-092). `leave` keeps a conflict in the worktree for its builder. */
export function takeIn(paths: RepoPaths, config: Config, id: string, deps: TakeInDeps, opts: { actor: Actor; by: string; leave: boolean }): TakeInResult {
  return withJob(paths, { kind: 'refresh', task: id, by: opts.by }, () => takeInNow(paths, config, id, deps, opts), deps.now);
}

function takeInNow(paths: RepoPaths, config: Config, id: string, deps: TakeInDeps, opts: { actor: Actor; by: string; leave: boolean }): TakeInResult {
  const { run, now } = deps;
  const ledger = readLedger(paths.ledger);
  const task = ledger.tasks.find((t) => t.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  if (!TAKE_IN_STATES.includes(task.state)) throw new AccError('refused', `${id} is ${task.state}. acc refresh is for a task its builder works on: running, sent back or blocked. Autopilot and the merge queue bring a pull request up to date.`);
  const wt = task.run?.worktree;
  // Said for the one in the worktree, before mergePlace's words for autopilot.
  if (wt && run('git', ['status', '--porcelain'], { cwd: wt }).stdout.trim()) throw new AccError('refused', `${id}'s worktree has changes nobody committed. Commit them first, then run acc refresh again.`);
  const place = mergePlace(paths, config, task, run);
  const { env, from } = place;
  if (!fetchBranches(run, paths.root, [env.branch], { ...deps.env, GIT_TERMINAL_PROMPT: '0' })) throw new AccError('refresh', `Couldn't fetch ${env.branch} from origin, so nothing was merged.`);
  const landed = landedFor(paths, run, ledger, landedCommits(run, paths.root, env.branch, place.branch), ownFiles(paths, run, task), sharedFiles(config));
  let made: { sha: string; resolved: string[] } | null;
  try {
    made = mergeBaseIn(config, place, run, { leave: opts.leave, by: 'acc refresh' });
  } catch (e) {
    if (e instanceof MergeConflict && !opts.leave) throw new MergeConflict(`${e.message} Its builder runs acc refresh in its worktree to resolve them there.`, e.files);
    throw e;
  }
  if (!made) return { task: id, sha: null, from, landed: [], resolved: [], tests: [], reason: `${id}'s branch already holds ${env.branch}: nothing to take in.` };
  const { sha, resolved } = made;
  const gates = takeInGates(config, env.branch);
  const ran = gates.length ? runGates(repoPaths(place.wt, run), config, env, gates, priorTests(paths, config, from), { run, now, slots: deps.slots, task: id }).results : [];
  const tests = ran.map((r) => ({ gate: r.gate, status: r.status, summary: r.summary }));
  mutate(paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === id);
    if (!t) return;
    t.updatedAt = now().toISOString();
    emit({ type: 'task.updated', task: id, actor: opts.actor, by: opts.by, data: { tookIn: { base: env.branch, from, to: sha, merges: landed.map((x) => x.sha) } } });
  });
  const failed = tests.filter((t) => t.status !== 'pass');
  const kept = resolved.length ? `, ${resolvedWords(resolved, 'keeping')}` : '';
  const said = !tests.length ? ' The project names no test checks for a builder, so none ran.'
    : failed.length ? ` ${failed.map((t) => `${t.gate} ${t.status === 'fail' ? 'failed' : `says ${t.status}`}: ${t.summary.replace(/[.!?]$/, '')}`).join('; ')}. Fix it on your branch: the merge is yours now.`
    : ` ${tests.map((t) => t.gate).join(', ')} passed.`;
  return { task: id, sha, from, landed, resolved, tests, reason: `Merged origin/${env.branch} into ${short(from)} as ${short(sha)}${kept}: ${landed.length} merge${landed.length === 1 ? '' : 's'} taken in.${said} Nothing was pushed.` };
}
