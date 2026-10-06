import type { Config } from './config.ts';
import { AccError, type Runner } from './exec.ts';
import {
  type Actor, applyMove, checkMove, type Emit, type Ledger, type MoveRequest, mutate, noGateHooks, normalizeId, readLedger, type State, type Task,
  type TaskInput, type UpsertResult, upsertTasks,
} from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { githubOutside } from './trackers/github.ts';
import type { Outside } from './trackers/types.ts';

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

export interface IntakeChanges {
  /** Moved to done: their issue was closed before work started. */
  closed: string[];
  /** Taken off the ledger before work started: their issue has a label in skipLabels, or their ticket left the repo's place. */
  removed: string[];
  /** Of those, the ones whose ticket left the repo's place (D-072). */
  left: string[];
  leftAlone: LeftAlone[];
}

export type IntakeResult = UpsertResult & IntakeChanges;

const noChanges = (): IntakeChanges => ({ closed: [], removed: [], left: [], leftAlone: [] });

/** Still to do and never dispatched. Only such a task follows its ticket off the board. */
const neverStarted = (t: Task): boolean => t.state === 'todo' && !t.run;

const issueNumber = (t: Task): number | null => {
  const n = t.source.kind === 'github' ? /^GH-(\d+)$/.exec(t.id)?.[1] : undefined;
  return n ? Number(n) : null;
};

/**
 * A task whose ticket says it should leave the board (D-048): it leaves the ledger if work on it never
 * started, with a task.removed event that keeps the reason. One that started stays as it is, and is named
 * with `note`, for a person to decide. `left`: the ticket left the repo's place (D-072).
 */
function leave(ledger: Ledger, t: Task, ticket: string, why: { reason: string; note: string; left: boolean }, emit: Emit, res: IntakeChanges): void {
  if (neverStarted(t)) {
    ledger.tasks.splice(ledger.tasks.indexOf(t), 1);
    emit({ type: 'task.removed', task: t.id, actor: 'sync', by: 'acc intake', data: { reason: why.reason, title: t.title, source: t.source } });
    res.removed.push(t.id);
    if (why.left) res.left.push(t.id);
  } else res.leftAlone.push({ task: t.id, issue: ticket, state: t.state, note: `${why.note}; ${t.id} is still ${t.state}` });
}

/** Where a repo's GitHub tickets come from (D-072): its tracker's repo, and the labels an issue needs one of. */
export interface GithubPlace {
  repo: string;
  labels: string[];
}

/**
 * Brings tasks in step with their issues (D-048). A task whose issue was closed moves to done, and one
 * whose issue has a skipped label, or left the repo's place (D-072), leaves the ledger, but only if work
 * on it never started: otherwise it stays as it is and is named. `issues` holds each issue as GitHub has
 * it now, by number; a task whose issue isn't there is left alone. Finished tasks are never looked at.
 */
export function reconcileGithub(
  ledger: Ledger, config: Config, issues: Map<number, GithubIssue>, skip: string[], emit: Emit, now: () => Date, place: GithubPlace | null = null,
): IntakeChanges {
  const res = noChanges();
  const by = 'acc intake';
  for (const t of [...ledger.tasks]) {
    const n = issueNumber(t);
    const issue = n === null || t.state === 'done' ? undefined : issues.get(n);
    if (!issue) continue;
    const key = `#${n}`;
    const label = skipLabelOf(issue, skip);
    if (label) {
      leave(ledger, t, key, { reason: `Issue ${key} has the label "${label}", which isn't imported.`, note: `${key} has the label "${label}"`, left: false }, emit, res);
      continue;
    }
    // Outside the place before closed: a closed issue that left it was never this repo's to finish.
    const outside = place ? githubOutside(issue, place.repo, place.labels) : null;
    if (outside) {
      leave(ledger, t, key, { reason: `Issue ${key} left this repo's place: ${outside}.`, note: `${key} left this repo's place: ${outside}`, left: true }, emit, res);
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
 * Reads the open issues in the repo's place as its own GitHub account (D-007): its GitHub tracker's repo,
 * the project's own by default, and only issues with one of the tracker's labels when it names some
 * (D-072). It adds or refreshes a task for each, leaving out issues with a skipped label. Then it asks
 * about each unfinished task whose issue wasn't in that list, and brings the board in step
 * (reconcileGithub). It never changes GitHub.
 */
export function intakeGithub(
  paths: RepoPaths, config: Config, deps: { run: Runner; now: () => Date; env: NodeJS.ProcessEnv },
  opts: { label?: string; actor: Actor; by: string },
): IntakeResult {
  const { run, now } = deps;
  const gh = config.github;
  if (!gh) throw new AccError('no-github', 'This project has no "github" section in .acc/config.json.');
  // The first GitHub tracker owns GH- keys (trackerForKey), so its repo is where they come from.
  const tracker = config.trackers.find((t) => t.kind === 'github');
  const place: GithubPlace = { repo: tracker?.repo ?? gh.repo, labels: tracker?.labels ?? [] };
  const skip = tracker?.skipLabels ?? [];
  const token = run('gh', ['auth', 'token', '-u', gh.account]);
  if (token.code !== 0) throw new AccError('no-github', `gh isn't logged in as ${gh.account}. Run: gh auth login`);
  const env = { ...deps.env, GH_TOKEN: token.stdout.trim() };
  // `gh issue list --label` wants every label it's given, so an issue with any one of the place's takes a list per label.
  const lists = (place.labels.length ? place.labels : [null]).map((label) => {
    const args = ['issue', 'list', '-R', place.repo, '--state', 'open', '--limit', '500'];
    if (opts.label) args.push('--label', opts.label);
    if (label) args.push('--label', label);
    const r = run('gh', [...args, '--json', 'number,title,body,url,labels'], { env });
    if (r.code !== 0) throw new AccError('github', `Couldn't list issues on ${place.repo}: ${r.stderr.trim().split('\n')[0]}`);
    return JSON.parse(r.stdout) as GithubIssue[];
  });
  const byNumber = new Map<number, GithubIssue>();
  for (const i of lists.flat()) if (!byNumber.has(i.number)) byNumber.set(i.number, i);
  const open = lists.length === 1 ? lists[0]! : [...byNumber.values()].sort((a, b) => b.number - a.number);

  const issues = new Map<number, GithubIssue>(open.map((i) => [i.number, { ...i, state: 'OPEN' }]));
  // Closed, left out by --label, or out of the place: ask about each one. Once a task is done, its issue changes nothing.
  for (const t of readLedger(paths.ledger).tasks) {
    const n = issueNumber(t);
    if (n === null || t.state === 'done' || issues.has(n)) continue;
    const v = run('gh', ['issue', 'view', String(n), '-R', place.repo, '--json', 'number,state,labels,url'], { env, timeoutMs: 60_000 });
    if (v.code !== 0) continue; // deleted or unreachable: leave the task as it is
    try {
      issues.set(n, JSON.parse(v.stdout) as GithubIssue);
    } catch {
      // not JSON: leave the task as it is
    }
  }

  const inputs = githubIssuesToTasks(open.filter((i) => !skipLabelOf(i, skip)));
  return mutate(paths, now, (ledger, emit) => ({
    ...upsertTasks(ledger, config, inputs, opts.actor, opts.by, emit, now),
    ...reconcileGithub(ledger, config, issues, skip, emit, now, place),
  }));
}

/**
 * Brings Jira or Azure DevOps tasks in step with tickets that left the repo's place (D-072): the
 * Command Center reads them after a board loads, since only it signs in to those trackers (D-066). Each
 * task leaves the ledger if work on it never started, or else is named (D-048). Only tickets a tracker
 * read and found outside are listed: a failed read never is.
 */
export function intakeOutside(paths: RepoPaths, kind: 'jira' | 'azure', outside: Outside[], now: () => Date): IntakeResult {
  return mutate(paths, now, (ledger, emit) => {
    const res: IntakeResult = { added: [], updated: [], unchanged: [], errors: [], ...noChanges() };
    for (const o of outside) {
      const id = normalizeId(o.key, kind);
      const t = ledger.tasks.find((x) => x.id === id && x.source.kind === kind);
      if (!t || t.state === 'done') continue;
      leave(ledger, t, id, { reason: `${id} left this repo's place: ${o.why}.`, note: `${id} left this repo's place: ${o.why}`, left: true }, emit, res);
    }
    return res;
  });
}
