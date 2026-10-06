import { type Config, environmentByBranch } from './config.ts';
import type { Runner, RunResult } from './exec.ts';
import { type Actor, mutate, type PullRequest, readLedger, type Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { issueRepo } from './trackers/github.ts';
import { discardUpdate, listUpdates, type UpdateEvent } from './updates.ts';

/**
 * Closing a task's GitHub issue when its work merges (D-???): the one change acc makes to a ticket on its
 * own, and only where the tracker says "edits": true (D-066). acc sync marks the close pending as it moves
 * the task to done, then settles it: the issue closes as the repo's account (D-007), with a comment naming
 * the pull request, or is left as it is when it's already closed, was reopened, moved or is gone. A close
 * that fails stays pending, and the next sync tries again. Jira and Azure DevOps tickets are never changed:
 * their status belongs to the client's workflow. `acc sync --close-done` does the same, when a person runs
 * it, for tasks done before acc closed issues.
 */

/** What became of one issue, or with --plan, what would. */
export interface IssueClose {
  task: string;
  /** The issue: #12. */
  key: string;
  /** The task's pull request, whose merge closes it. */
  pr: number;
  /** 'to close' is --plan's: an issue acc would close. */
  outcome: 'closed' | 'left' | 'failed' | 'to close';
  /** Why it was left, or why acc couldn't close it. */
  reason?: string;
  /** The task's unposted drafts the close stands in for, discarded. */
  discarded?: string[];
}

/** How long each gh call may take, as acc sync's others do. */
const GH_CALL_MS = 60_000;

const ALREADY_CLOSED = 'it was already closed';

/** The drafts a close stands in for: its comment says the change merged, so they'd say it again. */
const STOOD_IN = new Set<UpdateEvent>(['pr-opened', 'pr-updated', 'merged']);

/** The GitHub tracker that owns GH- keys (trackerForKey: the first), when it lets acc change its tickets. */
function editsTracker(config: Config): Config['trackers'][number] | null {
  const tracker = config.trackers.find((t) => t.kind === 'github');
  return tracker?.edits && config.github ? tracker : null;
}

/** Whether acc closes issues here at all: a GitHub tracker that says "edits": true, and a repo account to close them as. */
export const closesIssues = (config: Config): boolean => !!editsTracker(config);

/**
 * The GitHub issue acc closes when the task's work merges, or null: a task from a GitHub issue, where the
 * GitHub tracker says "edits": true. Never a Jira or Azure DevOps ticket, edits or not.
 */
export function issueToClose(config: Config, task: Pick<Task, 'id' | 'source'>): { repo: string; number: number } | null {
  const tracker = editsTracker(config);
  const n = /^GH-(\d+)$/.exec(task.id)?.[1];
  if (task.source.kind !== 'github' || !tracker || !n) return null;
  return { repo: tracker.repo ?? config.github!.repo, number: Number(n) };
}

/**
 * The comment the close leaves, for whoever reads the issue: plain, with no word of how acc built it. The
 * pull request is named with its repo when the issue lives in another.
 */
export function closeText(config: Config, task: Pick<Task, 'environment'> & { pr: Pick<PullRequest, 'number'> }, repo: string): string {
  const env = environmentByBranch(config, task.environment)?.name ?? task.environment;
  const prRepo = config.github?.repo;
  const ref = prRepo && prRepo.toLowerCase() !== repo.toLowerCase() ? `${prRepo}#${task.pr.number}` : `#${task.pr.number}`;
  return `Done: pull request ${ref} merged into ${env}.`;
}

/** What gh said, in one line. */
const firstLine = (r: RunResult): string => (r.stderr || r.stdout).trim().split('\n')[0] || `gh exited with ${r.code}.`;

type Look = { close: true } | { close: false; outcome: 'left' | 'failed'; reason: string };

/**
 * Looks at the issue before closing it, so it closes once. One already closed, moved to another repo, or
 * gone is left as it is. So is one reopened, when acc has tried before or it's the tidy's: a person
 * reopened it after the work merged.
 */
function look(run: Runner, env: NodeJS.ProcessEnv, repo: string, n: number, leaveReopened: boolean): Look {
  const r = run('gh', ['issue', 'view', String(n), '-R', repo, '--json', 'state,stateReason,url'], { env, timeoutMs: GH_CALL_MS });
  if (r.code !== 0) {
    const why = firstLine(r);
    return /could not resolve to an issue/i.test(why) ? { close: false, outcome: 'left', reason: 'GitHub can\'t find it' } : { close: false, outcome: 'failed', reason: why };
  }
  let issue: { state?: string; stateReason?: string | null; url?: string };
  try {
    issue = JSON.parse(r.stdout) as typeof issue;
  } catch {
    return { close: false, outcome: 'failed', reason: 'gh\'s answer wasn\'t JSON' };
  }
  const lives = issueRepo(issue.url);
  if (lives && lives.toLowerCase() !== repo.toLowerCase()) return { close: false, outcome: 'left', reason: `it moved to ${lives}` };
  const state = String(issue.state ?? '').toUpperCase();
  if (state === 'CLOSED') return { close: false, outcome: 'left', reason: ALREADY_CLOSED };
  if (state !== 'OPEN') return { close: false, outcome: 'failed', reason: 'gh didn\'t say whether it\'s open' };
  if (leaveReopened && String(issue.stateReason ?? '').toUpperCase() === 'REOPENED') return { close: false, outcome: 'left', reason: 'it was reopened' };
  return { close: true };
}

/** Closes the issue as completed, with its comment, in one call. */
function close(run: Runner, env: NodeJS.ProcessEnv, repo: string, n: number, text: string): Pick<IssueClose, 'outcome' | 'reason'> {
  const r = run('gh', ['issue', 'close', String(n), '-R', repo, '--reason', 'completed', '--comment', text], { env, timeoutMs: GH_CALL_MS });
  if (r.code === 0) return { outcome: 'closed' };
  // Stopped at its timeout, gh may still have closed it (D-051): the next sync looks first.
  return { outcome: 'failed', reason: r.timedOut ? `gh stopped at its timeout, and may have closed it: ${firstLine(r)}` : firstLine(r) };
}

/**
 * Settles the closes acc sync marked pending, or with `tidy`, closes the issues of tasks done before acc
 * closed them: done, with a merged pull request and no close recorded. Each outcome is recorded on the
 * task's pull request in one write: closed, left with why, or still pending with why it failed. A close
 * that took, or found the issue already closed, discards the task's unposted pull request and merged
 * drafts, which its comment stands in for. With `plan`, it only looks: nothing is closed or written.
 * `env` carries GH_TOKEN for the repo's account.
 */
export function settleCloses(
  paths: RepoPaths, config: Config, deps: { run: Runner; now: () => Date; env: NodeJS.ProcessEnv },
  opts: { tidy?: boolean; plan?: boolean; actor?: Actor; by?: string } = {},
): IssueClose[] {
  const { run, now, env } = deps;
  const tidy = !!opts.tidy;
  const tasks = readLedger(paths.ledger).tasks.filter((t) => (tidy ? t.state === 'done' && t.pr?.state === 'merged' && !t.pr.issue : t.pr?.issue?.state === 'pending'));
  const results: IssueClose[] = [];
  for (const t of tasks) {
    const pr = t.pr!;
    const key = t.id.replace(/^GH-/, '#');
    const target = issueToClose(config, t);
    if (!target) {
      // Pending under a tracker that no longer says "edits": acc lets it be.
      if (!tidy) results.push({ task: t.id, key, pr: pr.number, outcome: 'left', reason: 'its tracker doesn\'t say "edits": true now' });
      continue;
    }
    const seen = look(run, env, target.repo, target.number, tidy || !!pr.issue?.reason);
    if (!seen.close) results.push({ task: t.id, key, pr: pr.number, outcome: seen.outcome, reason: seen.reason });
    else if (opts.plan) results.push({ task: t.id, key, pr: pr.number, outcome: 'to close' });
    else results.push({ task: t.id, key, pr: pr.number, ...close(run, env, target.repo, target.number, closeText(config, { environment: t.environment, pr }, target.repo)) });
  }
  if (opts.plan || !results.length) return results;
  const at = now().toISOString();
  mutate(paths, now, (ledger, emit) => {
    for (const r of results) {
      const t = ledger.tasks.find((x) => x.id === r.task);
      // Settled by another sync meanwhile, or a new pull request since: leave that one's be.
      if (!t?.pr || t.pr.number !== r.pr || (t.pr.issue && t.pr.issue.state !== 'pending')) continue;
      const issue: NonNullable<PullRequest['issue']> = r.outcome === 'failed'
        ? { state: 'pending', at, reason: r.reason ?? '' }
        : { state: r.outcome === 'closed' ? 'closed' : 'left', at, ...(r.reason ? { reason: r.reason } : {}) };
      // Failing the same way again leaves the log alone.
      if (t.pr.issue?.state === issue.state && t.pr.issue.reason === issue.reason) continue;
      t.pr = { ...t.pr, issue };
      emit({ type: 'task.updated', task: t.id, actor: opts.actor ?? 'sync', by: opts.by ?? 'acc sync', data: { pr: t.pr } });
    }
  });
  const settled = results.filter((r) => r.outcome === 'closed' || r.reason === ALREADY_CLOSED);
  const drafts = settled.length ? listUpdates(paths) : [];
  for (const r of settled) {
    const gone: string[] = [];
    for (const u of drafts) {
      if (u.task !== r.task || u.state !== 'draft' || !STOOD_IN.has(u.event)) continue;
      try {
        discardUpdate(paths, u.id, 'acc sync', now);
        gone.push(u.id);
      } catch {
        // Claimed for posting since: a person has it.
      }
    }
    if (gone.length) r.discarded = gone;
  }
  return results;
}

/** One close in words, for sync's output: what happened, or with `plan`, what would. */
export function closeWords(r: IssueClose, plan = false): string {
  const drafts = r.discarded?.length ? `; discarded its unposted update${r.discarded.length === 1 ? '' : 's'} ${r.discarded.join(', ')}` : '';
  switch (r.outcome) {
    case 'closed': return `closed issue ${r.key}${drafts}`;
    case 'to close': return `would close issue ${r.key}`;
    case 'left': return `${plan ? 'would leave' : 'left'} issue ${r.key} as it is: ${r.reason}${drafts}`;
    case 'failed': return plan ? `couldn't look at issue ${r.key}: ${r.reason}` : `couldn't close issue ${r.key} (${r.reason}): the next sync tries again`;
  }
}
