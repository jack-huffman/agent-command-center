import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.ts';
import { AccError, parseJsonOutput, type RunResult, type Runner } from './exec.ts';
import { GH_TIMEOUT_MS, ghToken } from './land.ts';
import { type Actor, applyMove, checkMove, mutate, noGateHooks, readLedger } from './ledger.ts';
import type { RepoPaths } from './paths.ts';

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
}

const short = (sha: string): string => sha.slice(0, 7) || 'no commit';
const firstLine = (r: RunResult): string => (r.stderr || r.stdout).trim().split('\n')[0]?.trim() || `exit ${r.code}`;
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
  if (r.code !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) throw new AccError('checks', `gh couldn't read pull request #${pr}: ${firstLine(r)}`);
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

/** The checks on a pull request's latest commit, and that commit. Only reads. */
export function readChecks(run: Runner, repo: string, pr: number, env: NodeJS.ProcessEnv): CheckRead {
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
  if (!list) throw new AccError('checks', `gh couldn't read pull request #${pr}'s checks: ${firstLine(r)}`);
  const name = (c: GhCheck) => c.name || c.workflow || 'a check';
  const failed = list.filter((c) => c.bucket === 'fail').map((c): FailedCheck => ({ name: name(c), workflow: c.workflow ?? '', link: c.link ?? '', job: actionsJob(c.link ?? '') }));
  const pending = list.filter((c) => c.bucket === 'pending').map(name);
  const cancelled = list.filter((c) => c.bucket === 'cancel').map(name);
  return { sha, required, failed, pending, cancelled, count: list.length };
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
  const all = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(CSI, '').replace(PREFIX, '').replace(STAMP, '').trimEnd());
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
  if (r.code !== 0) return { error: firstLine(r) };
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
const sentence = (text: string): string => text.trim().replace(/([^.!?])$/, '$1.');

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
