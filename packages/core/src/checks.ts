import { firstSaid, sentence } from './text.ts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.ts';
import { AccError, parseJsonOutput, type RunResult, type Runner } from './exec.ts';
import { GH_TIMEOUT_MS, ghToken } from './land.ts';
import { type Actor, applyMove, checkMove, mutate, noGateHooks, readLedger } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { type GroupFound, groupSection } from './group-report.ts';

/**
 * GitHub's checks on a pull request (D-076). Autopilot reads them, and the logs of the ones that failed,
 * as the repo's account (D-007), and changes nothing on GitHub. The base branch's required checks count
 * when it has any; otherwise every check on the commit does. A check still queued or running isn't a
 * failure yet, nor is one cancelled or skipped. A failed check that isn't a GitHub Actions job has no log
 * on GitHub, so it alone never sends a task back; an Actions job whose log can't be fetched is named as
 * such, and no log is made up.
 */

/** How much of a failed check's log goes to its builder, and how many checks' logs autopilot reads. */
export const LOG_TAIL_LINES = 100;
export const LOG_TAIL_BYTES = 10 * 1024;
export const MAX_LOGS = 5;

/** What a builder reads for a failed check GitHub keeps no log for. */
export const NO_ACTIONS_LOG = 'GitHub keeps no log for it: it isn\'t a GitHub Actions job.';

/** A check as `gh pr checks --json` lists it. */
interface GhCheck {
  name?: string;
  bucket?: string;
  link?: string;
  workflow?: string;
  state?: string;
}

/** A check that failed on GitHub. */
export interface FailedCheck {
  name: string;
  /** Its GitHub Actions workflow, or '' for a check that isn't an Actions job. */
  workflow: string;
  link: string;
  /** Its Actions job, whose log autopilot can read, or null: GitHub keeps no log for it. */
  job: { repo: string; id: string } | null;
}

/** What GitHub's checks say on a pull request's latest commit. */
export interface CheckRead {
  /** The pull request's latest commit on GitHub. */
  sha: string;
  /**
   * The base branch's required checks, or every check on the commit when it requires none. False too when
   * the commit has no checks at all: gh says so before it looks for required ones, so which the base
   * requires is unknown, and GitHub's own word on merging says whether it's waiting for any (GH-67).
   */
  required: boolean;
  /** gh's fail bucket: failure, timed out, action required, startup failure or error. */
  failed: FailedCheck[];
  /** Checks still queued or running. */
  pending: string[];
  /** Checks someone cancelled: not a failure to send back, but not a pass to merge on either (GH-67). */
  cancelled: string[];
  /** How many checks counted, so none reported reads apart from all passed. */
  count: number;
  /**
   * The checks the project names (`github.checks`, T-108) that GitHub reports nothing for on the commit yet,
   * such as a workflow that hasn't started. Not a pass: autopilot waits for each.
   */
  missing: string[];
}

const short = (sha: string): string => sha.slice(0, 7) || 'no commit';
const said = (r: RunResult): string => `${r.stderr}\n${r.stdout}`;

/** An Actions job's link: …/<owner>/<repo>/actions/runs/<run>/job/<job>. Its repo is host-qualified off github.com. */
const JOB_LINK = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/actions\/runs\/\d+\/job\/(\d+)(?:[/?#]|$)/;

export function actionsJob(link: string): FailedCheck['job'] {
  const m = JOB_LINK.exec(link);
  if (!m) return null;
  return { repo: m[1] === 'github.com' ? m[2]! : `${m[1]}/${m[2]}`, id: m[3]! };
}

/** The pull request's latest commit on GitHub. */
export function headOf(run: Runner, repo: string, pr: number, env: NodeJS.ProcessEnv): string {
  const r = run('gh', ['pr', 'view', String(pr), '-R', repo, '--json', 'headRefOid'], { env, timeoutMs: GH_TIMEOUT_MS });
  let sha = '';
  try {
    sha = parseJsonOutput<{ headRefOid?: string }>(r.stdout).headRefOid ?? '';
  } catch {
    sha = '';
  }
  if (r.code !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) throw new AccError('checks', `gh couldn't read pull request #${pr}: ${firstSaid(r)}`);
  return sha;
}

/** The checks gh listed, whatever its exit code: it exits 8 while some are pending. Null when it listed none. */
function listOf(r: RunResult): GhCheck[] | null {
  try {
    const list = parseJsonOutput<unknown>(r.stdout);
    return Array.isArray(list) ? (list as GhCheck[]) : null;
  } catch {
    return null;
  }
}

/** Checks the project names, as a wait names them: the "check" check, the "check" and "lint" checks. */
export const quotedChecks = (names: readonly string[]): string => `the ${names.map((n) => `"${n}"`).join(', ').replace(/, ([^,]*)$/, ' and $1')} check${names.length === 1 ? '' : 's'}`;

/**
 * The checks on a pull request's latest commit, and that commit. Only reads. Each check in named (T-108)
 * counts even where the base requires others, and one GitHub reports nothing for is missing.
 */
export function readChecks(run: Runner, repo: string, pr: number, env: NodeJS.ProcessEnv, named: readonly string[] = []): CheckRead {
  const sha = headOf(run, repo, pr, env);
  const checks = (...more: string[]) => run('gh', ['pr', 'checks', String(pr), '-R', repo, ...more, '--json', 'name,bucket,link,workflow,state'], { env, timeoutMs: GH_TIMEOUT_MS });
  let required = true;
  let r = checks('--required');
  let list = listOf(r);
  // A base branch that requires no checks, as on a private repo on GitHub's free plan: every check counts.
  if (!list && /no required checks reported/i.test(said(r))) {
    required = false;
    r = checks();
    list = listOf(r);
  }
  // No checks at all on the commit, which gh says before it looks for required ones, with --required too.
  if (!list && /no checks reported/i.test(said(r))) {
    required = false;
    list = [];
  }
  if (!list) throw new AccError('checks', `gh couldn't read pull request #${pr}'s checks: ${firstSaid(r)}`);
  const name = (c: GhCheck) => c.name || c.workflow || 'a check';
  // A named check the base doesn't require is read from every check on the commit, and counts all the same.
  if (named.length && required && named.some((n) => !list!.some((c) => name(c) === n))) {
    const all = checks();
    const every = listOf(all) ?? (/no checks reported/i.test(said(all)) ? [] : null);
    if (!every) throw new AccError('checks', `gh couldn't read pull request #${pr}'s checks: ${firstSaid(all)}`);
    list = [...list, ...every.filter((c) => named.includes(name(c)) && !list!.some((l) => name(l) === name(c)))];
  }
  const missing = named.filter((n) => !list!.some((c) => name(c) === n));
  const failed = list.filter((c) => c.bucket === 'fail').map((c): FailedCheck => ({ name: name(c), workflow: c.workflow ?? '', link: c.link ?? '', job: actionsJob(c.link ?? '') }));
  const pending = list.filter((c) => c.bucket === 'pending').map(name);
  const cancelled = list.filter((c) => c.bucket === 'cancel').map(name);
  return { sha, required, failed, pending, cancelled, count: list.length, missing };
}

/** gh's "<job>\t<step>\t" before each line of a job's log, and the timestamp GitHub starts each with. */
const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const PREFIX = /^[^\t\n]*\t[^\t\n]*\t/;
const STAMP = /^﻿?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;

/**
 * The end of a job's log, as its builder reads it: colour codes, gh's job and step names and GitHub's
 * timestamps stripped, then the last `lines` lines, no more than `bytes` of them. A last line longer than
 * that keeps its end.
 */
export function tailLog(text: string, lines = LOG_TAIL_LINES, bytes = LOG_TAIL_BYTES): string {
  return tailOf(text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(CSI, '').replace(PREFIX, '').replace(STAMP, '').trimEnd()), lines, bytes);
}

/** The end of a check's own log, as acc wrote it on this machine: only colour codes stripped (GH-73). */
export function tailText(text: string, lines = LOG_TAIL_LINES, bytes = LOG_TAIL_BYTES): string {
  return tailOf(text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(CSI, '').trimEnd()), lines, bytes);
}

function tailOf(all: string[], lines: number, bytes: number): string {
  while (all.length && !all.at(-1)) all.pop();
  const kept: string[] = [];
  let size = 0;
  for (const line of all.slice(-lines).reverse()) {
    const b = Buffer.byteLength(line) + (kept.length ? 1 : 0);
    if (size + b > bytes) {
      if (!kept.length) kept.push(Buffer.from(line).subarray(-bytes).toString('utf8').replace(/^�+/, ''));
      break;
    }
    kept.push(line);
    size += b;
  }
  return kept.reverse().join('\n');
}

/** The end of a failed Actions job's log: its failed steps, else all of it. Gh's first line when it couldn't. */
export function fetchLog(run: Runner, job: NonNullable<FailedCheck['job']>, env: NodeJS.ProcessEnv): { log: string } | { error: string } {
  const view = (flag: string) => run('gh', ['run', 'view', '--job', job.id, flag, '-R', job.repo], { env, timeoutMs: GH_TIMEOUT_MS });
  let r = view('--log-failed');
  // A job that timed out or was stopped has no failed step: its whole log, then.
  if (r.code === 0 && !tailLog(r.stdout)) r = view('--log');
  if (r.code !== 0) return { error: firstSaid(r) };
  const log = tailLog(r.stdout);
  return log ? { log } : { error: 'GitHub gave an empty log.' };
}

// ---------------------------------------------------------------- what autopilot sent back, kept

/** A failed check as autopilot sent it back: its log's end, or why there's none. */
export interface ReportedCheck {
  name: string;
  workflow: string;
  link: string;
  log: string | null;
  /** Why there's no log: gh's first line, or that GitHub keeps none for it. */
  noLog: string | null;
}

/** What GitHub's checks said on a commit autopilot sent back, kept for its builder's packet. */
export interface ChecksReport {
  v: 1;
  task: string;
  sha: string;
  pr: { number: number; url: string };
  required: boolean;
  checks: ReportedCheck[];
  at: string;
}

export const checksPath = (paths: Pick<RepoPaths, 'checks'>, task: string, sha: string): string => join(paths.checks, `${task}-${sha}.json`);

export function readChecksReport(paths: Pick<RepoPaths, 'checks'>, task: string, sha: string): ChecksReport | null {
  try {
    const r = JSON.parse(readFileSync(checksPath(paths, task, sha), 'utf8')) as ChecksReport;
    return r.v === 1 && r.task === task && Array.isArray(r.checks) ? r : null;
  } catch {
    return null;
  }
}

/** A fence longer than any run of backticks in the text, so a log can't close it early. */
const fence = (text: string): string => '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));

/** On a rework autopilot sent back: each failed check, its link, and the end of its log (D-076). */
export function checksSection(r: ChecksReport | null | undefined): string[] {
  if (!r?.checks.length) return [];
  const which = r.required ? 'checks its base branch requires' : 'its checks';
  const lines = [
    '## What GitHub\'s checks said',
    '',
    `This is a rework. Your change is pull request #${r.pr.number}, and ${which} failed on GitHub on ${short(r.sha)}: ${r.checks.map((c) => c.name).join(', ')}. Its review passed: these failures are all there is to fix.`,
    '',
    'Reproduce each failure here and fix it, keeping the rest of the change as it is. Then finish as below: commit, run `acc gate run`, then `acc done`. If a failure isn\'t caused by this change, such as a check that fails on the base branch too or a service that was down, don\'t work around it: run `acc block "<what you found>"` and stop.',
    '',
  ];
  for (const c of r.checks) {
    lines.push(`### ${c.name}${c.workflow && c.workflow !== c.name ? ` (${c.workflow})` : ''}`, '');
    if (c.link) lines.push(`Link: ${c.link}`, '');
    if (c.log) {
      const f = fence(c.log);
      lines.push('The end of its log:', '', `${f}text`, c.log, f, '');
    } else lines.push(`Couldn't fetch its log: ${sentence(c.noLog ?? 'GitHub gave none')}`, '');
  }
  return lines;
}

// ---------------------------------------------------------------- what the merge queue sent back, kept (GH-73)

/** A gate the merge queue's full check failed, with the end of its log. */
export interface QueueCheck {
  gate: string;
  status: string;
  summary: string;
  /** Where its whole log is, on this machine. */
  file: string | null;
  log: string | null;
}

/** What the merge queue found on a commit it sent back to its builder, kept for its packet (GH-73). */
export interface QueueReport {
  v: 1;
  task: string;
  /** The branch's commit it sent back: the branch is there again. */
  sha: string;
  /** The environment's branch it was merging into. */
  base: string;
  /** Its pull request; null for a group check's send-back of a task with none (T-165). */
  pr: { number: number; url: string } | null;
  /** What stopped it: merging the base in conflicted, or the full check failed. */
  kind: 'conflict' | 'check';
  /** The files git couldn't merge. */
  conflicts: string[];
  /** The gates that failed, and the merge commit they failed on, which was put back; null when there was nothing to merge in. */
  checks: QueueCheck[];
  merge: string | null;
  at: string;
  /** A group check's send-back (T-165): what the failure names that this task's change reaches, and the log's lines. */
  group?: GroupFound;
}

export const queueReportPath = (paths: Pick<RepoPaths, 'queue'>, task: string, sha: string): string => join(paths.queue, `${task}-${sha}.json`);

export function readQueueReport(paths: Pick<RepoPaths, 'queue'>, task: string, sha: string): QueueReport | null {
  try {
    const r = JSON.parse(readFileSync(queueReportPath(paths, task, sha), 'utf8')) as QueueReport;
    return r.v === 1 && r.task === task && Array.isArray(r.checks) && Array.isArray(r.conflicts) ? r : null;
  } catch {
    return null;
  }
}

/**
 * On a rework the merge queue sent back (GH-73): the files that conflict with the base, and how to merge it
 * in here, or each gate of the full check that failed and the end of its log.
 */
export function queueSection(r: QueueReport | null | undefined): string[] {
  if (!r) return [];
  // A group check's send-back (T-165) says what it found in its own words.
  if (r.group) return groupSection(r, r.group);
  const base = `\`${r.base}\``;
  const lines = ['## What the merge queue found', ''];
  if (r.kind === 'conflict') {
    lines.push(
      `This is a rework. Your change is pull request #${r.pr?.number}. Its review passed, and the merge queue took it to merge into ${base}, but ${base} has moved on, and merging it into ${short(r.sha)} conflicts in: ${r.conflicts.map((f) => `\`${f}\``).join(', ')}.`,
      '',
      `Merge it in here: run \`git merge origin/${r.base}\`, resolve each of those files so that both your change and what ${base} added hold, then commit the merge. Keep the rest of your change as it is. Then finish as below: run \`acc gate run\`, then \`acc done\`. If a conflict can't be resolved without a choice that isn't yours, run \`acc block "<what you found>"\` and stop.`,
      '',
    );
    return lines;
  }
  const where = r.merge ? `after merging ${base} in (as ${short(r.merge)}, put back since)` : `on ${short(r.sha)}`;
  lines.push(
    `This is a rework. Your change is pull request #${r.pr?.number}. Its review passed, and the merge queue took it to merge into ${base}, but the full check failed ${where}: ${r.checks.map((c) => c.gate).join(', ')}. You ran the lighter checks; the full one runs once, in the queue.`,
    '',
    `Reproduce each failure here and fix it, keeping the rest of the change as it is.${r.merge ? ` Merge ${base} in first, with \`git merge origin/${r.base}\`, since the failure may come from the two together.` : ''} Run the failing check by name, such as \`acc gate run ${r.checks[0]?.gate ?? 'check'}\`, then finish as below: commit, run \`acc gate run\`, then \`acc done\`. If a failure isn't caused by this change, such as a check that fails on ${base} too, don't work around it: run \`acc block "<what you found>"\` and stop.`,
    '',
  );
  for (const c of r.checks) {
    lines.push(`### ${c.gate}`, '', sentence(c.summary), '');
    if (c.file) lines.push(`Its whole log: \`${c.file}\``, '');
    if (c.log) {
      const f = fence(c.log);
      lines.push('The end of its log:', '', `${f}text`, c.log, f, '');
    }
  }
  return lines;
}

// ---------------------------------------------------------------- the send-back

export interface SendBackDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
}

export interface SendBackResult {
  sha: string;
  checks: string[];
  /** Where what the checks said is kept. */
  report: string;
  reason: string;
}

/**
 * Sends a task in review back to its builder because its pull request's checks failed on GitHub
 * (D-076): it reads them again, with their logs, keeps them for the packet, then moves the task to
 * rework and writes down the commit. Whatever changed since autopilot looked, a push, a re-run, a check
 * still running, stops it with code checks-moved, and it looks again next pass.
 */
export function sendBack(paths: RepoPaths, config: Config, id: string, deps: SendBackDeps, opts: { actor: Actor; by: string }): SendBackResult {
  const { run, now } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  const pr = task.pr;
  if (task.state !== 'review' || pr?.state !== 'open') throw new AccError('refused', `${id} is ${task.state}${pr ? ` with pull request #${pr.number} ${pr.state}` : ' with no pull request'}. Autopilot sends back the open pull request of a task in review.`);
  const gh = config.github;
  if (!gh) throw new AccError('no-github', 'This project has no "github" section in .acc/config.json, so there are no checks to read.');
  const branch = task.run?.branch;
  const head = branch ? run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: paths.root }).stdout.trim() : '';
  if (!head) throw new AccError('checks', `${id}'s branch isn't in this clone.`);
  const moved = (why: string) => new AccError('checks-moved', why);
  if (pr.sha !== head) throw moved(`Pull request #${pr.number} was landed at ${short(pr.sha ?? '')}, not ${short(head)}: a land comes first.`);

  const env = { ...deps.env, GH_TOKEN: ghToken(run, gh.account) };
  const read = readChecks(run, gh.repo, pr.number, env);
  const away = (sha: string) => moved(`Pull request #${pr.number} is at ${short(sha)} on GitHub, not ${short(head)}.`);
  if (read.sha !== head) throw away(read.sha);
  if (read.pending.length) throw moved(`Checks are still running on GitHub: ${read.pending.join(', ')}.`);
  if (!read.failed.some((c) => c.job)) throw moved(read.failed.length ? `Checks failed on GitHub with no log there: ${read.failed.map((c) => c.name).join(', ')}.` : 'Its checks no longer fail on GitHub.');

  let fetched = 0;
  const checks = read.failed.map((c): ReportedCheck => {
    const base = { name: c.name, workflow: c.workflow, link: c.link };
    if (!c.job) return { ...base, log: null, noLog: NO_ACTIONS_LOG };
    if (fetched >= MAX_LOGS) return { ...base, log: null, noLog: `Not fetched: autopilot reads the logs of ${MAX_LOGS} checks at most.` };
    fetched++;
    const got = fetchLog(run, c.job, env);
    return 'log' in got ? { ...base, log: got.log, noLog: null } : { ...base, log: null, noLog: got.error };
  });
  // Someone pushed while the logs were read: they're about a commit the pull request has left.
  const still = headOf(run, gh.repo, pr.number, env);
  if (still !== head) throw away(still);

  const names = checks.map((c) => c.name);
  const at = now().toISOString();
  const report: ChecksReport = { v: 1, task: id, sha: head, pr: { number: pr.number, url: pr.url }, required: read.required, checks, at };
  mkdirSync(paths.checks, { recursive: true });
  const file = checksPath(paths, id, head);
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');

  const reason = `Checks failed on GitHub on ${short(head)}: ${names.join(', ')}.`;
  mutate(paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === id);
    if (!t) throw new AccError('no-task', `No task ${id}.`);
    if (t.pr?.sha !== head) throw moved(`Pull request #${pr.number} was landed again meanwhile.`);
    const req = { to: 'rework' as const, actor: opts.actor, by: opts.by, reason };
    const problems = checkMove(l, config, t, req, noGateHooks);
    if (problems.length) throw new AccError('move-refused', `Can't send ${id} back:\n- ${problems.join('\n- ')}`);
    // The names and the commit go with the move, so what it was for is never read back from its words.
    applyMove(t, req, emit, now, { checks: names, sha: head });
    const sentBack = { sha: head, checks: names, at };
    t.autopilot = { failed: null, ...t.autopilot, sentBack };
    emit({ type: 'task.updated', task: id, actor: opts.actor, by: opts.by, data: { autopilot: { sentBack } } });
  });
  return { sha: head, checks: names, report: file, reason: `Sent it back to its builder: ${reason[0]!.toLowerCase()}${reason.slice(1)}` };
}
