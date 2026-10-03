import type { Config } from './config.ts';
import { AccError, type Runner } from './exec.ts';
import {
  type Actor, applyMove, checkMove, type Emit, type Ledger, type MoveRequest, mutate, noGateHooks, readLedger, type State, type Task,
  type TaskInput, type UpsertResult, upsertTasks,
} from './ledger.ts';
import type { RepoPaths } from './paths.ts';

export interface GithubIssue {
  number: number;
  title: string;
  body?: string | null;
  url: string;
  labels?: { name: string }[];
  /** OPEN or CLOSED, when it was asked for. */
  state?: string;
}

/** "Depends on #3", "Blocked by #4 and #5", "depends on #6, #7" become dependencies (DESIGN.md section 6). */
export function depsFromBody(body: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const m of (body ?? '').matchAll(/\b(?:depends on|blocked by)\s+((?:#\d+(?:\s*(?:,|and|&)\s*)?)+)/gi)) {
    for (const n of m[1]!.matchAll(/#(\d+)/g)) out.add(`#${n[1]}`);
  }
  return [...out];
}

export function githubIssuesToTasks(issues: GithubIssue[], environment?: string): TaskInput[] {
  return issues.map((i) => ({
    source: { kind: 'github', key: `#${i.number}`, url: i.url },
    title: i.title,
    brief: i.body ?? '',
    deps: depsFromBody(i.body).filter((d) => d !== `#${i.number}`),
    labels: (i.labels ?? []).map((l) => l.name),
    ...(environment ? { environment } : {}),
  }));
}

/** The issue's first label that skipLabels names, or null. GitHub's labels ignore case, so this does too. */
export function skipLabelOf(issue: Pick<GithubIssue, 'labels'>, skip: string[]): string | null {
  const names = new Set(skip.map((s) => s.toLowerCase()));
  return (issue.labels ?? []).map((l) => l.name).find((n) => names.has(n.toLowerCase())) ?? null;
}

/** A task whose issue says it should leave the board, kept because work on it had started. */
export interface LeftAlone {
  task: string;
  issue: string;
  state: State;
  note: string;
}

export interface GithubChanges {
  /** Moved to done: their issue was closed before work started. */
  closed: string[];
  /** Taken off the ledger: their issue has a label in skipLabels. */
  removed: string[];
  leftAlone: LeftAlone[];
}

export type GithubIntakeResult = UpsertResult & GithubChanges;

/** Still to do and never dispatched. Only such a task follows its issue off the board. */
const neverStarted = (t: Task): boolean => t.state === 'todo' && !t.run;

const issueNumber = (t: Task): number | null => {
  const n = t.source.kind === 'github' ? /^GH-(\d+)$/.exec(t.id)?.[1] : undefined;
  return n ? Number(n) : null;
};

/**
 * Brings tasks in step with their issues (D-???). A task whose issue was closed moves to done, and one
 * whose issue has a skipped label leaves the ledger, but only if work on it never started: otherwise it
 * stays as it is and is named. `issues` holds each issue as GitHub has it now, by number; a task whose
 * issue isn't there is left alone. Finished tasks are never looked at.
 */
export function reconcileGithub(
  ledger: Ledger, config: Config, issues: Map<number, GithubIssue>, skip: string[], emit: Emit, now: () => Date,
): GithubChanges {
  const res: GithubChanges = { closed: [], removed: [], leftAlone: [] };
  const by = 'acc intake';
  for (const t of [...ledger.tasks]) {
    const n = issueNumber(t);
    const issue = n === null || t.state === 'done' ? undefined : issues.get(n);
    if (!issue) continue;
    const key = `#${n}`;
    const label = skipLabelOf(issue, skip);
    if (label) {
      if (neverStarted(t)) {
        ledger.tasks.splice(ledger.tasks.indexOf(t), 1);
        emit({ type: 'task.removed', task: t.id, actor: 'sync', by, data: { reason: `Issue ${key} has the label "${label}", which isn't imported.`, title: t.title, source: t.source } });
        res.removed.push(t.id);
      } else res.leftAlone.push({ task: t.id, issue: key, state: t.state, note: `${key} has the label "${label}"; ${t.id} is still ${t.state}` });
      continue;
    }
    if (issue.state?.toUpperCase() !== 'CLOSED') continue;
    const req: MoveRequest = { to: 'done', actor: 'sync', by, reason: `Issue ${key} was closed on GitHub.` };
    if (neverStarted(t) && !checkMove(ledger, config, t, req, noGateHooks).length) {
      applyMove(t, req, emit, now);
      res.closed.push(t.id);
    } else res.leftAlone.push({ task: t.id, issue: key, state: t.state, note: `${key} was closed on GitHub; ${t.id} is still ${t.state}` });
  }
  return res;
}

/**
 * Reads the repo's open issues as its own GitHub account (D-007) and adds or refreshes a task for each,
 * leaving out issues with a skipped label. Then it asks about each unfinished task whose issue wasn't
 * in that list, and brings the board in step (reconcileGithub). It never changes GitHub.
 */
export function intakeGithub(
  paths: RepoPaths, config: Config, deps: { run: Runner; now: () => Date; env: NodeJS.ProcessEnv },
  opts: { label?: string; actor: Actor; by: string },
): GithubIntakeResult {
  const { run, now } = deps;
  const gh = config.github;
  if (!gh) throw new AccError('no-github', 'This project has no "github" section in .acc/config.json.');
  const token = run('gh', ['auth', 'token', '-u', gh.account]);
  if (token.code !== 0) throw new AccError('no-github', `gh isn't logged in as ${gh.account}. Run: gh auth login`);
  const env = { ...deps.env, GH_TOKEN: token.stdout.trim() };
  const args = ['issue', 'list', '-R', gh.repo, '--state', 'open', '--limit', '500', '--json', 'number,title,body,url,labels'];
  if (opts.label) args.push('--label', opts.label);
  const r = run('gh', args, { env });
  if (r.code !== 0) throw new AccError('github', `Couldn't list issues on ${gh.repo}: ${r.stderr.trim().split('\n')[0]}`);
  const open = JSON.parse(r.stdout) as GithubIssue[];
  const skip = config.trackers.find((t) => t.kind === 'github' && (t.repo ?? gh.repo) === gh.repo)?.skipLabels ?? [];

  const issues = new Map<number, GithubIssue>(open.map((i) => [i.number, { ...i, state: 'OPEN' }]));
  // Closed, or left out by --label: ask about each one. Once a task is done, its issue changes nothing.
  for (const t of readLedger(paths.ledger).tasks) {
    const n = issueNumber(t);
    if (n === null || t.state === 'done' || issues.has(n)) continue;
    const v = run('gh', ['issue', 'view', String(n), '-R', gh.repo, '--json', 'number,state,labels'], { env, timeoutMs: 60_000 });
    if (v.code !== 0) continue; // deleted, transferred or unreachable: leave the task as it is
    try {
      issues.set(n, JSON.parse(v.stdout) as GithubIssue);
    } catch {
      // not JSON: leave the task as it is
    }
  }

  const inputs = githubIssuesToTasks(open.filter((i) => !skipLabelOf(i, skip)));
  return mutate(paths, now, (ledger, emit) => ({
    ...upsertTasks(ledger, config, inputs, opts.actor, opts.by, emit, now),
    ...reconcileGithub(ledger, config, issues, skip, emit, now),
  }));
}
