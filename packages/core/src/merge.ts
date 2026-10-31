import { firstSaid } from './text.ts';
import { accChangesFor } from './acc-changes.ts';
import { autoMergeFor, type Config, environmentByBranch } from './config.ts';
import { keepChanges, mergedPaths } from './changes.ts';
import { developmentEnvironment, isDevelopmentBranch, notMergingWhy } from './pipeline.ts';
import { type CheckRead, quotedChecks, readChecks } from './checks.ts';
import { draftChangesField } from './field-drafts.ts';
import { AccError, parseJsonOutput, type Runner } from './exec.ts';
import { GH_TIMEOUT_MS, ghToken } from './land.ts';
import { type Actor, type AutopilotMerge, type MergeMethod, mutate, readLedger } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { askingUnder, pendingQuestions, questionsDir } from './questions.ts';
import { ownDeployAt, receiptHooks } from './receipts.ts';
import { reviewedAt } from './review.ts';
import { fetchBranches } from './sync.ts';

/**
 * Auto-merge (GH-67): where a repo turns it on, autopilot merges a task's open pull request once its
 * review passed and its full checks settled on the branch's latest commit, GitHub's checks passed there, GitHub
 * says it can merge, and nothing waits on a person. It merges as the repo's account (D-007), with the
 * method the repo allows, and only the commit it looked at (`--match-head-commit`). It never merges into
 * a protected environment or a pull request that changes `.acc/`. In a Salesforce project it merges only
 * into the development environment, on the deploy the task's own builder made there, on the very commit its
 * review read (T-157). acc sync then moves the task to done, as for any merge.
 *
 * Whatever moved since autopilot looked, or isn't settled yet, stops it with code merge-waits, and it looks
 * again next pass. Anything else is a failure, recorded on that commit, and the task needs you.
 */

/** How long after a land a pull request with no checks on GitHub waits, so a slow CI can register its own. */
export const NO_CHECKS_GRACE_MS = 2 * 60_000;

/**
 * How long after a land a pull request GitHub blocks with no checks waits for the checks its base requires.
 * After that it's more likely a rule no check meets, such as a required approving review, and it needs you.
 */
export const BLOCKED_NO_CHECKS_MS = 15 * 60_000;

/** The order autopilot picks a merge method in, from the ones the repo allows. */
export const MERGE_METHODS: readonly MergeMethod[] = ['merge', 'squash', 'rebase'];

/** What GitHub says merges: clean, with only checks that aren't required failing, or with hooks to run. */
const MERGEABLE = new Set(['CLEAN', 'UNSTABLE', 'HAS_HOOKS']);

export interface MergeDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
}

export interface MergeResult {
  sha: string;
  pr: { number: number; url: string };
  method: MergeMethod;
  reason: string;
}

/** A pull request as `gh pr view --json` gives what a merge needs. */
interface GhPrState {
  state?: string;
  headRefOid?: string;
  mergeable?: string;
  mergeStateStatus?: string;
  reviewDecision?: string | null;
  baseRefName?: string;
  isDraft?: boolean;
}

const short = (sha: string): string => sha.slice(0, 7) || 'no commit';

/** What GitHub says about the pull request now, or null when gh couldn't say. */
function viewPr(run: Runner, repo: string, n: number, env: NodeJS.ProcessEnv): GhPrState | null {
  const r = run('gh', ['pr', 'view', String(n), '-R', repo, '--json', 'state,headRefOid,mergeable,mergeStateStatus,reviewDecision,baseRefName,isDraft'], { env, timeoutMs: GH_TIMEOUT_MS });
  if (r.code !== 0) return null;
  try {
    return parseJsonOutput<GhPrState>(r.stdout);
  } catch {
    return null;
  }
}

/**
 * How autopilot merges in this repo: the first of merge, squash and rebase that GitHub allows it. GitHub
 * has no single default, and gh needs one named when nobody is there to choose.
 */
export function mergeMethod(run: Runner, repo: string, env: NodeJS.ProcessEnv): MergeMethod {
  const r = run('gh', ['repo', 'view', repo, '--json', 'mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed'], { env, timeoutMs: GH_TIMEOUT_MS });
  let allowed: Record<string, unknown> | null = null;
  try {
    allowed = r.code === 0 ? parseJsonOutput<Record<string, unknown>>(r.stdout) : null;
  } catch {
    allowed = null;
  }
  if (!allowed) throw new AccError('merge', `gh couldn't read how ${repo} merges pull requests: ${firstSaid(r)}`);
  const key: Record<MergeMethod, string> = { merge: 'mergeCommitAllowed', squash: 'squashMergeAllowed', rebase: 'rebaseMergeAllowed' };
  const method = MERGE_METHODS.find((m) => allowed[key[m]] === true);
  if (!method) throw new AccError('merge', `${repo} allows no way to merge a pull request.`);
  return method;
}

/** Why auto-merge doesn't cover this task's environment, in words. */
function notCovered(config: Config, env: { name: string; branch: string; protected: boolean }): string {
  if (env.protected) return `"${env.name}" is protected: a person merges into it.`;
  // A Salesforce project merges into its development environment alone (T-157).
  if (config.profile === 'salesforce' && !isDevelopmentBranch(config, env.branch)) return `"${env.name}" isn't the development environment: autopilot merges only into ${developmentEnvironment(config)?.name ?? 'the development environment'} in a Salesforce project.`;
  const sf = notMergingWhy(config);
  if (sf) return sf;
  if (config.autonomy !== 'review') return `autonomy is "${config.autonomy}": autopilot merges only under review.`;
  return 'Auto-merge is off for this project: a person merges its pull requests.';
}

export function mergePr(paths: RepoPaths, config: Config, id: string, deps: MergeDeps, opts: { actor: Actor; by: string }): MergeResult {
  const { run, now } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  const pr = task.pr;
  if (task.state !== 'review' || pr?.state !== 'open') throw new AccError('refused', `${id} is ${task.state}${pr ? ` with pull request #${pr.number} ${pr.state}` : ' with no pull request'}. Autopilot merges the open pull request of a task in review.`);
  const gh = config.github;
  if (!gh) throw new AccError('no-github', 'This project has no "github" section in .acc/config.json, so there\'s no pull request to merge.');
  const env = environmentByBranch(config, task.environment);
  if (!env) throw new AccError('merge', `${id}'s environment "${task.environment}" isn't in the config.`);
  if (!autoMergeFor(config, env.branch)) throw new AccError('refused', notCovered(config, env));
  const branch = task.run?.branch;
  const head = branch ? run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: paths.root }).stdout.trim() : '';
  if (!branch || !head) throw new AccError('merge', `${id}'s branch isn't in this clone.`);
  const wait = (why: string) => new AccError('merge-waits', why);
  // A wait for GitHub's checks, which the merge queue's head says it waits on; it says any other wait's own words (GH-73).
  const waitChecks = (why: string) => Object.assign(wait(why), { checks: true as const });
  if (task.autopilot?.merged?.sha === head) throw wait(`Autopilot already merged pull request #${pr.number}: acc sync moves ${id} to done.`);
  if (pr.sha !== head) throw wait(`Pull request #${pr.number} was landed at ${short(pr.sha ?? '')}, not ${short(head)}: a land comes first.`);
  // Its own review, or the one the merge queue's merge commit carries (GH-73).
  const reviewed = reviewedAt(paths, task, head);
  if (!reviewed) throw wait(`${id}'s review hasn't passed on ${short(head)}.`);
  // The full check, whatever a builder ran (GH-73).
  const missing = receiptHooks(paths, config, run).missingGates(task, 'merge');
  if (missing.length) throw new AccError('merge', `Its checks aren't settled on ${short(head)}: ${missing.join(', ')}.`);
  // A Salesforce task merges on the deploy its own builder made to the development org (D-206, T-157): a
  // passing deploy of the task's own, to its environment, on the very commit the review read: the head, or
  // the commit the merge queue's merge commit carries its review from. Never a commit before it: a commit
  // after the last deploy would merge changes the org never held. The full check's deploy skips in the queue
  // (elsewhere), so this is asked outright, whatever the receipts say.
  if (config.profile === 'salesforce' && !ownDeployAt(paths, task, reviewed.sha)) throw new AccError('merge', `${id}'s own deploy to ${env.name} hasn't passed on ${short(reviewed.sha)}, the commit its review read: it merges only on the deploy its builder made there.`);
  // An agent in its worktree asking a person something: the person comes first.
  const wt = task.run?.worktree;
  if (wt && askingUnder(pendingQuestions(questionsDir(deps.env)), wt)) throw wait(`An agent in ${id}'s worktree is waiting for your answer.`);

  // The base and the branch as origin has them: a base that moved on is merged in first (refresh), and
  // what the pull request changes is read from them.
  if (!fetchBranches(run, paths.root, [env.branch, branch], { ...deps.env, GIT_TERMINAL_PROMPT: '0' })) throw wait(`Couldn't fetch ${env.branch} and ${branch} from origin.`);
  const git = (...args: string[]) => run('git', args, { cwd: paths.root });
  if (git('merge-base', '--is-ancestor', `refs/remotes/origin/${env.branch}`, head).code !== 0) throw wait(`${env.branch} moved on since ${short(head)}: autopilot merges it in first.`);
  const acc = accChangesFor(run, paths.root, `refs/remotes/origin/${env.branch}`, head);
  if (acc === null) throw new AccError('merge', `git couldn't list what pull request #${pr.number} changes under .acc/.`);
  // acc's own config, such as whether a repo auto-merges, is a person's to change (a person decided);
  // floors that only rose aren't (T-102).
  if (acc.length) throw new AccError('merge', `It changes .acc/, which a person merges: ${acc.join(', ')}.`);

  const ghEnv = { ...deps.env, GH_TOKEN: ghToken(run, gh.account) };
  const seen = viewPr(run, gh.repo, pr.number, ghEnv);
  if (!seen) throw wait(`gh couldn't read pull request #${pr.number}.`);
  if (seen.state === 'MERGED') throw wait(`Pull request #${pr.number} is already merged on GitHub: acc sync moves ${id} to done.`);
  if (seen.state !== 'OPEN') throw wait(`Pull request #${pr.number} is ${String(seen.state ?? 'not open').toLowerCase()} on GitHub: acc sync follows it.`);
  if (seen.headRefOid !== head) throw wait(`Pull request #${pr.number} is at ${short(seen.headRefOid ?? '')} on GitHub, not ${short(head)}: a land or a person comes first.`);
  // Retargeted on GitHub, perhaps at a protected branch: not the merge auto-merge was turned on for.
  if (seen.baseRefName !== env.branch) throw new AccError('merge', `Pull request #${pr.number} merges into ${seen.baseRefName || 'another branch'} on GitHub, not ${env.branch}: a person merges it.`);
  if (seen.reviewDecision === 'CHANGES_REQUESTED') throw wait(`A person asked for changes on pull request #${pr.number}.`);
  if (seen.isDraft) throw new AccError('merge', `Pull request #${pr.number} is a draft on GitHub.`);

  let checks: CheckRead;
  try {
    checks = readChecks(run, gh.repo, pr.number, ghEnv, gh.checks);
  } catch (e) {
    throw wait((e as Error).message);
  }
  if (checks.sha !== head) throw wait(`Pull request #${pr.number} is at ${short(checks.sha)} on GitHub, not ${short(head)}.`);
  if (checks.pending.length) throw waitChecks(`Checks are still running on GitHub: ${checks.pending.join(', ')}.`);
  if (checks.failed.length) throw new AccError('merge', `Checks failed on GitHub: ${checks.failed.map((c) => c.name).join(', ')}.`);
  if (checks.cancelled.length) throw new AccError('merge', `Checks were cancelled on GitHub: ${checks.cancelled.join(', ')}. Run them again, or merge it yourself.`);
  // A check the project names that GitHub reports nothing for, such as a workflow not started yet: never a pass (T-108).
  if (checks.missing.length) throw waitChecks(`GitHub reports nothing yet for ${quotedChecks(checks.missing)} on pull request #${pr.number}: autopilot waits for ${checks.missing.length === 1 ? 'it' : 'them'} to pass.`);
  // None at all counts only where the base requires none, and once a slow CI has had time to start (a person
  // decided). gh can't say which a commit with no checks needs: GitHub's BLOCKED below says the base wants some.
  const landed = Date.parse(pr.landedAt ?? '');
  const since = (ms: number) => Number.isFinite(landed) && now().getTime() - landed < ms;
  if (!checks.count) {
    // A guard: gh answers --required on a commit with no checks as "no checks reported" (checks.ts).
    if (checks.required) throw waitChecks(`No checks ${env.branch} requires are reported on GitHub yet.`);
    if (since(NO_CHECKS_GRACE_MS)) throw waitChecks('No checks are reported on GitHub yet: autopilot gives them 2 minutes after a land.');
  }

  if (seen.mergeable === 'CONFLICTING' || seen.mergeStateStatus === 'DIRTY') throw new AccError('merge', `GitHub says pull request #${pr.number} conflicts with ${env.branch}.`);
  if (seen.mergeable !== 'MERGEABLE' || !seen.mergeStateStatus || seen.mergeStateStatus === 'UNKNOWN') throw wait(`GitHub is still working out whether pull request #${pr.number} can merge.`);
  if (seen.mergeStateStatus === 'BEHIND') throw wait(`GitHub says pull request #${pr.number} is behind ${env.branch}: autopilot merges it in first.`);
  // Blocked with no checks reported: at first most likely ones the base requires that haven't registered
  // yet. Still none 15 minutes after the land, it's a rule no check meets, and a person is told.
  if (seen.mergeStateStatus === 'BLOCKED' && !checks.count) {
    if (since(BLOCKED_NO_CHECKS_MS)) throw waitChecks(`GitHub says ${env.branch}'s rules block pull request #${pr.number}, and no checks are reported on it yet: autopilot waits for the checks ${env.branch} requires.`);
    throw new AccError('merge', `GitHub won't merge pull request #${pr.number}: ${env.branch}'s rules block it, and no checks were reported on it in the 15 minutes after its land. It may need an approving review: merge it yourself.`);
  }
  if (seen.mergeStateStatus === 'BLOCKED') throw new AccError('merge', `GitHub won't merge pull request #${pr.number}: ${env.branch}'s rules block it, such as a required approving review.`);
  if (!MERGEABLE.has(seen.mergeStateStatus)) throw new AccError('merge', `GitHub says pull request #${pr.number} can't merge (${seen.mergeStateStatus}).`);

  // What it changes, read while its branch isn't in its environment's yet, kept with it (T-99).
  const kept = mergedPaths(run, paths.root, task);
  const method = mergeMethod(run, gh.repo, ghEnv);
  // Only the commit autopilot looked at: a push in between makes GitHub refuse.
  const r = run('gh', ['pr', 'merge', String(pr.number), '-R', gh.repo, `--${method}`, '--match-head-commit', head], { env: ghEnv, timeoutMs: GH_TIMEOUT_MS });
  if (r.code !== 0) {
    // A gh that failed or ran out of time can have merged all the same (D-051): GitHub is asked.
    const after = viewPr(run, gh.repo, pr.number, ghEnv);
    if (after?.state !== 'MERGED') {
      if (after?.headRefOid && after.headRefOid !== head) throw wait(`Pull request #${pr.number} moved on to ${short(after.headRefOid)} on GitHub while autopilot merged it.`);
      throw new AccError('merge', `gh couldn't merge pull request #${pr.number}: ${firstSaid(r)}${after ? '' : ' GitHub didn\'t say afterwards whether it merged.'}`);
    }
  }

  const merged: AutopilotMerge = { sha: head, pr: { number: pr.number, url: pr.url }, method, at: now().toISOString() };
  // The pull request stays open in the ledger: acc sync sees it merged, moves the task to done and drafts its update.
  mutate(paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === id);
    if (!t) return;
    t.autopilot = { ...t.autopilot, failed: null, merged };
    // Merged, it leaves the merge queue (GH-73).
    if (t.autopilot.queued) t.autopilot.queued = null;
    keepChanges(t, kept, merged.at, emit, opts);
    t.updatedAt = merged.at;
    emit({ type: 'task.updated', task: id, actor: opts.actor, by: opts.by, data: { merged } });
  });
  // Merged, what it changed is kept: where its tracker keeps a ticket's changes in a field, a draft of its new text (T-105).
  draftChangesField(paths, run, config, id, opts.by, now);
  return { sha: head, pr: merged.pr, method, reason: `Merged pull request #${pr.number} into ${env.branch} at ${short(head)}. acc sync moves ${id} to done.` };
}
