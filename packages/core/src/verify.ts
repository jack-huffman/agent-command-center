import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { agentArgs } from './agents.ts';
import { fileId, STE_STRICT } from './analyze.ts';
import { writeAtomic } from './atomic.ts';
import { type AwakeDeps, holdAwake } from './awake.ts';
import { type Config, type Environment, environmentByBranch } from './config.ts';
import { readCriteria, taskTicket } from './criteria.ts';
import { mainCheckout, setupWorktree, worktreeRoot } from './dispatch.ts';
import { AccError, type RunResult, type Runner } from './exec.ts';
import { lastLine, runGates } from './gates.ts';
import { GH_TIMEOUT_MS, ghToken } from './land.ts';
import { readLedger, type Task } from './ledger.ts';
import { alive } from './lock.ts';
import { sessionName } from './names.ts';
import { repoPaths, type RepoPaths } from './paths.ts';
import type { GateStatus } from './receipts.ts';
import { baseRef, type Criterion, type Finding, parseReview, VERDICT_SCHEMA, type Verdict } from './review.ts';
import { rulesText } from './rules.ts';
import type { SlotOptions } from './semaphore.ts';
import { type SteFinding, steLint } from './ste.ts';
import { NO_STEPS, type Steps } from './steps.ts';
import { escapeRegExp, plural } from './text.ts';
import { draftUpdate, ticketOf } from './updates.ts';

/**
 * Verifying a developer's pull request (T-84): a TA checks a tracked ticket that someone else built. acc
 * finds the ticket's pull request on GitHub, checks its head out read-only in a detached worktree, runs the
 * project's checks there against the pull request's base, and has a read-only agent review the change
 * against the ticket's acceptance criteria. It drafts a QA comment as a ticket update, which a person edits
 * and posts. acc never posts, pushes or commits for a verification, and the task's state never moves.
 */

/** A pull request as a verification reads it: its number, link and title, its branches, and its head commit. */
export interface VerifyPr {
  number: number;
  url: string;
  title: string;
  /** The branch it merges from. */
  head: string;
  /** The branch it merges into: what the checks and the diff compare with. */
  base: string;
  sha: string;
}

/** One check's result in a verification: a check that couldn't run there is skipped, with its reason. */
export interface VerifyCheck {
  gate: string;
  status: GateStatus;
  summary: string;
}

export interface Verification {
  v: 1;
  task: string;
  /** The ticket it verified. */
  key: string;
  pr: VerifyPr;
  /** The commit it checked out and verified: the pull request's head when acc fetched it. */
  sha: string;
  checks: VerifyCheck[];
  verdict: Verdict['verdict'];
  /** Two or three sentences: pass, or what needs to change. */
  summary: string;
  /** One plain sentence for the client, as a review's (D-066). Not set when the verifier gave none. */
  client?: string;
  criteria: Criterion[];
  findings: Finding[];
  /** The QA comment's update draft, for a person to edit and post. Null when the ticket can't take one. */
  update: string | null;
  /** The QA comment as acc drafted it. */
  comment: string;
  /** The hard findings of the wording check on the comment that remain after the reviewer's one fix. */
  wording: SteFinding[];
  sessionId: string;
  name: string;
  at: string;
  durationMs: number;
  costUsd: number | null;
}

/** The pull requests acc found when it found none, or more than one, for the person to choose from. */
export interface PrChoice {
  v: 1;
  task: string;
  at: string;
  found: VerifyPr[];
}

/** What a task's verification says while it runs, so the page shows it as under way. */
export interface Verifying {
  sessionId: string;
  name: string;
  startedAt: string;
  pid: number;
}

/** Why the task page's section is off for a task acc's own builder made: its review is acc review's. */
export const OWN_WORK = 'acc reviews its own builders\' work';

/** The verifier's time limit. */
export const VERIFY_TIMEOUT_MS = 45 * 60_000;

/** The most of the diff the verifier is given inline. A longer one is read from the worktree. */
const DIFF_MAX = 150_000;

/** The most open pull requests acc lists to find one whose branch names the ticket. */
const PR_LIST_MAX = 200;

const PR_FIELDS = 'number,url,title,headRefName,baseRefName,headRefOid';

export const verificationsDir = (paths: Pick<RepoPaths, 'stateDir'>): string => join(paths.stateDir, 'verifications');
export const verificationPath = (paths: Pick<RepoPaths, 'stateDir'>, task: string, sha: string): string => join(verificationsDir(paths), `${fileId(task)}-${sha}.json`);
const runningPath = (paths: Pick<RepoPaths, 'stateDir'>, task: string): string => join(verificationsDir(paths), `${fileId(task)}.running.json`);
const choicePath = (paths: Pick<RepoPaths, 'stateDir'>, task: string): string => join(verificationsDir(paths), `${fileId(task)}.found.json`);

/** Where a task's verification checks out its pull request: `verify-<task>` under the worktree root. */
export const verifyWorktree = (config: Pick<Config, 'worktrees'>, main: string, task: string): string => join(worktreeRoot(config, main), `verify-${fileId(task)}`);

// ---------------------------------------------------------------- reading

const isVerification = (v: Verification | null, task: string): v is Verification =>
  !!v && v.v === 1 && v.task === task && typeof v.sha === 'string' && typeof v.at === 'string' && !!v.pr && Array.isArray(v.checks) && Array.isArray(v.findings);

/** The task's verification of one commit, or null. */
export function readVerification(paths: Pick<RepoPaths, 'stateDir'>, task: string, sha: string): Verification | null {
  try {
    const v = JSON.parse(readFileSync(verificationPath(paths, task, sha), 'utf8')) as Verification;
    return isVerification(v, task) ? v : null;
  } catch {
    return null;
  }
}

/** Every verification of the task, oldest first. A file being written, or one that can't be read, is left out. */
export function readVerifications(paths: Pick<RepoPaths, 'stateDir'>, task: string): Verification[] {
  let names: string[];
  try {
    names = readdirSync(verificationsDir(paths));
  } catch {
    return [];
  }
  const out: Verification[] = [];
  for (const n of names) {
    const sha = n.startsWith(`${task}-`) && n.endsWith('.json') ? n.slice(task.length + 1, -5) : '';
    if (!/^[0-9a-f]{7,64}$/.test(sha)) continue;
    const v = readVerification(paths, task, sha);
    if (v) out.push(v);
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.sha.localeCompare(b.sha));
}

/** The task's newest verification, or null before the first. */
export const latestVerification = (paths: Pick<RepoPaths, 'stateDir'>, task: string): Verification | null => readVerifications(paths, task).at(-1) ?? null;

/** The pull requests to choose from, kept when acc found none or several, or null. */
export function readPrChoice(paths: Pick<RepoPaths, 'stateDir'>, task: string): PrChoice | null {
  try {
    const c = JSON.parse(readFileSync(choicePath(paths, task), 'utf8')) as PrChoice;
    return c.v === 1 && c.task === task && Array.isArray(c.found) ? c : null;
  } catch {
    return null;
  }
}

/** A verification under way for the task. Null once its process has gone. */
export function verifying(paths: Pick<RepoPaths, 'stateDir'>, task: string): Verifying | null {
  try {
    const r = JSON.parse(readFileSync(runningPath(paths, task), 'utf8')) as Verifying;
    return alive(r.pid) ? r : null;
  } catch {
    return null;
  }
}

/**
 * Why a task's pull request can't be verified, or null: it must be there, come from a tracker, not be
 * one acc's own builder made (acc review judges those), and the project must have a GitHub repo.
 */
export function verifyRefusal(task: (Pick<Task, 'id' | 'source'> & { run?: Task['run'] }) | undefined, id: string, config: { github?: unknown }): string | null {
  if (!task) return `No task ${id}.`;
  if (!ticketOf(task)) return `${id} has no tracker ticket, so there is no developer's pull request to find.`;
  if (task.run) return `${id} is a task acc's own builder made, and ${OWN_WORK}: acc review ${id}.`;
  if (!config.github) return 'acc finds the developer\'s pull request on GitHub, and this project has no GitHub repo.';
  return null;
}

// ---------------------------------------------------------------- finding the pull request

type GhRun = (args: string[]) => RunResult;

interface GhPr { number?: number; url?: string; title?: string; headRefName?: string; baseRefName?: string; headRefOid?: string }

const prOf = (p: GhPr): VerifyPr | null =>
  (Number.isInteger(p.number) && typeof p.url === 'string' && typeof p.headRefName === 'string' && typeof p.baseRefName === 'string' && typeof p.headRefOid === 'string' && /^[0-9a-f]{40,64}$/.test(p.headRefOid)
    ? { number: p.number!, url: p.url, title: p.title ?? '', head: p.headRefName, base: p.baseRefName, sha: p.headRefOid }
    : null);

function ghList(ghRun: GhRun, args: string[]): GhPr[] {
  const r = ghRun(args);
  if (r.code !== 0) throw new AccError('no-github', `GitHub didn't list the pull requests: ${lastLine(r.stderr || r.stdout) || `gh exited with ${r.code}`}`);
  try {
    const list = JSON.parse(r.stdout || '[]') as GhPr[];
    return Array.isArray(list) ? list : [];
  } catch {
    throw new AccError('no-github', 'GitHub\'s list of pull requests wasn\'t JSON.');
  }
}

/** Whether text names the ticket's key as a whole word: ACME-1 isn't ACME-12, and case doesn't matter. */
export const namesKey = (text: string, key: string): boolean => new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(key)}(?![0-9])`, 'i').test(text);

/**
 * The open pull requests on the project's repo that name the ticket's key: in their title, as GitHub's
 * search finds them, or in their branch's name. Each is listed once, by number.
 */
export function findPullRequests(ghRun: GhRun, repo: string, key: string): VerifyPr[] {
  const byTitle = ghList(ghRun, ['pr', 'list', '-R', repo, '--state', 'open', '--search', `${key} in:title`, '--json', PR_FIELDS]).filter((p) => namesKey(p.title ?? '', key));
  const byHead = ghList(ghRun, ['pr', 'list', '-R', repo, '--state', 'open', '--limit', String(PR_LIST_MAX), '--json', PR_FIELDS]).filter((p) => namesKey(p.headRefName ?? '', key));
  const found = new Map<number, VerifyPr>();
  for (const p of [...byTitle, ...byHead]) {
    const pr = prOf(p);
    if (pr && !found.has(pr.number)) found.set(pr.number, pr);
  }
  return [...found.values()].sort((a, b) => a.number - b.number);
}

/**
 * The pull request a person named with --pr: its number, or its link. A link to another repo is refused:
 * acc checks out and runs only what is in the project's own repo.
 */
export function namedPr(arg: string, repo: string): number {
  const n = /^#?(\d+)$/.exec(arg.trim());
  if (n) return Number(n[1]);
  const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(arg.trim());
  if (!m) throw new AccError('usage', `--pr takes a pull request's number or its GitHub link, not "${arg}".`);
  if (m[1]!.toLowerCase() !== repo.toLowerCase()) {
    throw new AccError('refused', `That pull request is in ${m[1]}, not ${repo}, the project's repo. acc verifies pull requests in the project's repo only, as only those are its code.`);
  }
  return Number(m[2]);
}

function viewPr(ghRun: GhRun, repo: string, n: number): VerifyPr {
  const r = ghRun(['pr', 'view', String(n), '-R', repo, '--json', PR_FIELDS]);
  if (r.code !== 0) throw new AccError('no-pr', `GitHub has no pull request #${n} in ${repo}: ${lastLine(r.stderr || r.stdout) || `gh exited with ${r.code}`}`);
  let p: GhPr;
  try {
    p = JSON.parse(r.stdout) as GhPr;
  } catch {
    throw new AccError('no-github', `GitHub's answer for #${n} wasn't JSON.`);
  }
  const pr = prOf(p);
  if (!pr) throw new AccError('no-github', `GitHub's answer for #${n} had no head commit or branches.`);
  return pr;
}

/** A pull request in words, for a list to choose from: #12 ACME-7 Escalate premium cases (acme-7-escalate into dev). */
export const prWords = (p: VerifyPr): string => `#${p.number} ${p.title} (${p.head} into ${p.base})`;

// ---------------------------------------------------------------- the worktree

/**
 * Checks out the pull request's head with no branch (T-84): its head and its base are fetched from
 * origin, then a detached worktree is added at the head's commit. A detached worktree already there at
 * that commit is used again; at another commit, it's replaced. Anything else at that path is refused.
 * Returns whether it was there already.
 */
export function checkoutHead(run: Runner, main: string, wt: string, pr: VerifyPr, env: NodeJS.ProcessEnv): boolean {
  const git = (cwd: string, ...args: string[]) => run('git', args, { cwd });
  // Unattended, so git never stops to ask for a password. The base goes to its remote-tracking ref, which the
  // diff and the checks compare with; the head only to FETCH_HEAD. No local branch is made.
  const f = run('git', ['fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${pr.base}:refs/remotes/origin/${pr.base}`, `refs/pull/${pr.number}/head`], { cwd: main, env: { ...env, GIT_TERMINAL_PROMPT: '0' }, timeoutMs: GH_TIMEOUT_MS });
  if (f.code !== 0) throw new AccError('verify', `git couldn't fetch #${pr.number} from origin: ${lastLine(f.stderr) || `exit ${f.code}`}`);
  if (git(main, 'cat-file', '-e', `${pr.sha}^{commit}`).code !== 0) throw new AccError('verify', `#${pr.number}'s head moved on GitHub while acc fetched it. Verify it again.`);
  if (existsSync(wt)) {
    const head = git(wt, 'rev-parse', 'HEAD');
    if (head.code !== 0) throw new AccError('verify', `${wt} exists but isn't a git worktree. Move it aside and verify again.`);
    if (git(wt, 'symbolic-ref', '--quiet', 'HEAD').code === 0) throw new AccError('verify', `${wt} is on a branch, and acc checks a pull request out there with none. Move it aside and verify again.`);
    if (head.stdout.trim() === pr.sha) return true;
    const gone = git(main, 'worktree', 'remove', '--force', wt);
    if (gone.code !== 0) throw new AccError('verify', `git couldn't replace the worktree at ${wt}: ${lastLine(gone.stderr)}`);
  }
  mkdirSync(dirname(wt), { recursive: true });
  const r = git(main, 'worktree', 'add', '--detach', wt, pr.sha);
  if (r.code !== 0) throw new AccError('verify', `git couldn't add the worktree: ${lastLine(r.stderr)}`);
  return false;
}

/**
 * The environment the checks compare with: the one whose branch the pull request merges into. A base that
 * isn't an environment's is checked as the task's environment on that branch, with no org, so a check
 * that needs an org says it couldn't run.
 */
export function baseEnvironment(config: Pick<Config, 'environments'>, task: Pick<Task, 'environment'>, base: string): Environment {
  const env = environmentByBranch(config, base);
  if (env) return env;
  const own = environmentByBranch(config, task.environment) ?? config.environments[0]!;
  return { ...own, name: base, branch: base, org: null, default: false, protected: false, promotesTo: [] };
}

/** A check's result as a verification keeps it: one that couldn't run there is skipped, with why, never passed. */
export const verifyCheck = (r: { gate: string; status: GateStatus; summary: string }): VerifyCheck =>
  (r.status === 'error' ? { gate: r.gate, status: 'skip', summary: `It couldn't run here: ${r.summary}` } : { gate: r.gate, status: r.status, summary: r.summary });

// ---------------------------------------------------------------- what the verifier is told

export interface VerifyInput {
  task: Pick<Task, 'id' | 'title' | 'brief' | 'source'>;
  pr: VerifyPr;
  /** The ticket's description, as acc keeps it. */
  ticket: string;
  /** acc's drafted acceptance criteria, as Markdown, where there are some (T-81). */
  drafted: string | null;
  checks: VerifyCheck[];
  diff: string;
  stat: string;
  rules: string | null;
}

/** What a check said, as the verifier reads it. */
const checkWords = (c: VerifyCheck): string => `- ${c.gate}: ${c.status}. ${c.summary}`;

/** The verifier's standing instructions, and what it's given to verify. */
export function verifyPrompt(i: VerifyInput): { system: string; prompt: string } {
  const system = [
    `You verify a developer's pull request for ticket ${i.task.source.key ?? i.task.id}. A developer made this change, not an agent. Your findings go in a QA comment, which a person edits and posts on the ticket for the developer to read.`,
    'You can read files in this worktree with Read, Grep and Glob. You can\'t change anything, run commands, or post anything.',
    'Judge the change as a careful tester does:',
    '- Go through each acceptance criterion: the ticket\'s own, and the drafted ones when you get them. Say whether the change meets it, with the file and line that meets it, or what is missing.',
    '- Does it follow the project\'s rules, when you get them?',
    '- Do the tests exercise the change?',
    '- A check that failed is a finding. A check that was skipped is not: say what a person must look at instead.',
    'Give "changes" only for problems that must change before this merges, each as a finding with must: true. Lesser points are findings with must: false.',
    'Write the summary for the developer: say "pass", or say what needs to change. Write the client sentence for the client, with no code, file or tool names.',
    'Be specific: the file, the line, what is wrong, and what to do instead. Address the developer, not an agent.',
    '',
    'acc checks the QA comment with acc ste check, its wording check, and the comment must pass it. Write the summary, each criterion, each piece of evidence and each finding in Simplified Technical English (ASD-STE100), Strict mode:',
    ...STE_STRICT.slice(1),
  ].join('\n');
  const prompt = [
    `# Verify pull request #${i.pr.number} for ${i.task.source.key ?? i.task.id}: ${i.task.title}`,
    '',
    `${i.pr.url}: ${i.pr.title}. Commit ${i.pr.sha.slice(0, 7)} on \`${i.pr.head}\`, against \`${i.pr.base}\`.`,
    '',
    '## The ticket',
    '',
    i.ticket.trim() || '_The ticket has no description beyond its title._',
    '',
    ...(i.drafted?.trim() ? ['## Drafted acceptance criteria', '', 'acc drafted these from the ticket before. Judge the change against them too.', '', i.drafted.trim(), ''] : []),
    '## The checks on this commit',
    '',
    ...(i.checks.length ? i.checks.map(checkWords) : ['- none ran']),
    '',
    ...(i.rules?.trim() ? ['## The project\'s rules', '', i.rules.trim(), ''] : []),
    '## What changed',
    '',
    '```',
    i.stat.trim() || '(no files changed)',
    '```',
    '',
    i.diff.length > DIFF_MAX ? 'The diff is too long to include here. Read the changed files listed above.' : ['```diff', i.diff.trim(), '```'].join('\n'),
  ].join('\n');
  return { system, prompt };
}

/** What the verifier is told when its QA comment fails the wording check: each finding, to fix and answer again. */
export function verifyFixPrompt(findings: SteFinding[]): string {
  return [
    'acc ste check found these problems in the QA comment your answer makes. Fix each one in your words, keep what your answer says, and answer again with the whole answer.',
    '',
    ...findings.map((f) => `- Line ${f.line}: ${f.message} [${f.match}]`),
  ].join('\n');
}

// ---------------------------------------------------------------- the QA comment

/** Each check's result in words, for the QA comment. */
export const CHECK_WORDS: Record<GateStatus, string> = { pass: 'pass', fail: 'fail', error: 'skipped', skip: 'skipped', hold: 'not settled' };

/** A finding's place, as code: `file:line`. */
const placeOf = (f: Pick<Finding, 'file' | 'line'>): string => (f.file ? ` (\`${f.file}${f.line ? `:${f.line}` : ''}\`)` : '');

/**
 * The QA comment (T-84): the verdict in one line, the pull request's link and commit, each check's
 * result, each criterion met or not with its evidence, and the findings. Code, names of checks and commits
 * are in backticks, which the wording check reads as neutral words.
 */
export function qaComment(v: Pick<Verification, 'verdict' | 'summary' | 'pr' | 'sha' | 'checks' | 'criteria' | 'findings'>): string {
  const summary = v.summary.replace(/\s+/g, ' ').trim();
  return [
    `**QA result: ${v.verdict === 'pass' ? 'pass' : 'changes are necessary'}.** ${summary}`,
    '',
    `Pull request: ${v.pr.url} at commit \`${v.sha.slice(0, 7)}\`.`,
    '',
    '### Checks',
    '',
    ...(v.checks.length ? v.checks.map((c) => `- \`${c.gate}\`: ${CHECK_WORDS[c.status]}. ${c.summary.replace(/\s+/g, ' ').trim()}`) : ['- No checks ran.']),
    '',
    '### Acceptance criteria',
    '',
    ...(v.criteria.length ? v.criteria.map((c) => `- ${c.met ? 'Met' : 'Not met'}: ${c.text.trim()}${c.evidence.trim() ? ` Evidence: ${c.evidence.trim()}` : ''}`) : ['- The review found no acceptance criteria to test.']),
    '',
    '### Findings',
    '',
    ...(v.findings.length ? v.findings.map((f) => `- ${f.must ? 'Must change' : 'Look at'}: ${f.message.trim()}${placeOf(f)}`) : ['- None.']),
  ].join('\n');
}

/** The hard findings of the wording check on a QA comment, as acc ste check reads it. */
export const qaWording = (comment: string): SteFinding[] => steLint(comment).findings.filter((f) => f.level === 'hard');

// ---------------------------------------------------------------- running it

export interface VerifyDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  uuid?: () => string;
  /** Told the session and its name as the verifier starts, so it can be watched. */
  onStart?: (sessionId: string, name: string, pr: VerifyPr) => void;
  /** For tests: how the Mac is kept awake while the verifier runs (D-067). */
  awake?: AwakeDeps;
  slots?: SlotOptions;
  steps?: Steps;
}

/**
 * Verifies the developer's pull request for a tracked ticket (T-84). Without `pr`, acc looks for it on the
 * project's GitHub repo; none, or several, is refused, and what it found is kept for the person to choose
 * from. Its head is checked out with no branch, the project's required checks run there against its base,
 * and a read-only agent with the reviewer's model and effort reviews the diff against the ticket's
 * criteria. The verdict is kept at `verifications/<task>-<sha>.json`, and a QA comment is drafted as a
 * ticket update. Nothing is posted, pushed or committed, and the task's state stays as it is.
 */
export function verify(paths: RepoPaths, config: Config, id: string, deps: VerifyDeps, opts: { pr?: string; by: string }): Verification {
  const { run, now } = deps;
  const steps = deps.steps ?? NO_STEPS;
  const task = steps.step('task', 'Check the task', () => {
    const t = readLedger(paths.ledger).tasks.find((x) => x.id === id);
    const why = verifyRefusal(t, id, config);
    if (why) throw new AccError(t ? 'refused' : 'no-task', why);
    if (verifying(paths, id)) throw new AccError('refused', `${id}'s pull request is being verified now.`);
    return t!;
  });
  const gh = config.github!;
  const key = task.source.key!;
  const sessionId = (deps.uuid ?? randomUUID)();
  const name = sessionName({ project: config.project, key: id, title: task.title, role: 'verify' });
  mkdirSync(verificationsDir(paths), { recursive: true });
  const marker = runningPath(paths, id);
  const startedAt = now();
  writeFileSync(marker, JSON.stringify({ sessionId, name, startedAt: startedAt.toISOString(), pid: process.pid } satisfies Verifying));
  // The verifier is a child of this acc, so the Mac stays awake while acc lives (D-067).
  const awake = holdAwake(process.pid, deps.awake);
  try {
    const ghEnv = { ...deps.env, GH_TOKEN: steps.step('github', `Sign in to GitHub as ${gh.account}`, () => ghToken(run, gh.account)) };
    const ghRun: GhRun = (args) => run('gh', args, { cwd: paths.root, env: ghEnv, timeoutMs: GH_TIMEOUT_MS });
    const pr = steps.step('find', 'Find the developer\'s pull request', () => {
      if (opts.pr) return viewPr(ghRun, gh.repo, namedPr(opts.pr, gh.repo));
      const found = findPullRequests(ghRun, gh.repo, key);
      if (found.length === 1) return found[0]!;
      writeAtomic(choicePath(paths, id), JSON.stringify({ v: 1, task: id, at: now().toISOString(), found } satisfies PrChoice, null, 2) + '\n');
      if (!found.length) throw new AccError('no-pr', `No open pull request on ${gh.repo} names ${key} in its title or its branch. Name it: acc verify ${id} --pr <number>.`);
      throw new AccError('several-prs', `${found.length} open pull requests on ${gh.repo} name ${key}: ${found.map(prWords).join('; ')}. Name one: acc verify ${id} --pr <number>.`);
    });
    rmSync(choicePath(paths, id), { force: true });

    const main = mainCheckout(run, paths.root);
    const wt = verifyWorktree(config, main, id);
    const env = baseEnvironment(config, task, pr.base);
    steps.step('checkout', `Check out #${pr.number}'s head with no branch`, () => checkoutHead(run, main, wt, pr, deps.env));
    steps.step('setup', 'Set up the worktree', () => setupWorktree(run, config, env, main, wt));

    // The project's required checks, on the pull request's head against its base. Receipts are kept by sha,
    // as every check's are; no floor is raised, as the worktree has no branch to commit one to.
    steps.start('checks', 'Run the project\'s checks', `Against ${pr.base}`);
    const gates = runGates(repoPaths(wt, run), config, env, [], [], { run, now, task: id, ...(deps.slots ? { slots: deps.slots } : {}) });
    const checks = gates.results.map(verifyCheck);
    const counts = (s: GateStatus) => checks.filter((c) => c.status === s).length;
    steps.done('checks', [`${counts('pass')} passed`, counts('fail') ? `${counts('fail')} failed` : '', counts('skip') ? `${counts('skip')} skipped` : '', counts('hold') ? `${counts('hold')} not settled` : ''].filter(Boolean).join(', '));

    const base = baseRef(run, paths.root, pr.base);
    const diff = run('git', ['diff', '--no-color', '--find-renames', `${base}...${pr.sha}`], { cwd: paths.root }).stdout;
    const stat = run('git', ['diff', '--stat=120', '--find-renames', `${base}...${pr.sha}`], { cwd: paths.root }).stdout;
    const { system, prompt } = verifyPrompt({
      task, pr, ticket: taskTicket(task).markdown, drafted: readCriteria(paths, id)?.markdown ?? null, checks, diff, stat, rules: rulesText(wt, config.profile),
    });
    deps.onStart?.(sessionId, name, pr);
    const ask = (args: string[], input: string): ReturnType<typeof parseReview> => {
      // Read-only by construction, as the reviewer is: only the read tools, and dontAsk refuses everything else.
      const out = run('claude', [
        '-p', ...args, '--permission-mode', 'dontAsk', ...agentArgs(config.agents.reviewer),
        '--output-format', 'json', '--json-schema', JSON.stringify(VERDICT_SCHEMA), '--append-system-prompt', system,
        '--allowedTools', 'Read', 'Grep', 'Glob',
        '--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch',
      ], { cwd: wt, input, env: { ...deps.env, ACC_ROLE: 'reviewer', ACC_TASK: id }, timeoutMs: VERIFY_TIMEOUT_MS });
      if (out.timedOut) throw new AccError('verify', `The verification didn't finish within ${VERIFY_TIMEOUT_MS / 60_000} minutes, so acc stopped it.`);
      if (out.code === 127 && !out.stdout) throw new AccError('verify', `Claude Code didn't start: ${out.stderr.trim().split('\n')[0] ?? 'claude not found'}`);
      return parseReview(out.stdout);
    };
    const commentOf = (p: ReturnType<typeof parseReview>) => qaComment({ ...p.verdict, pr, sha: pr.sha, checks });
    steps.start('review', 'Review the change against the criteria', 'The verifier reads, and changes nothing');
    let parsed = ask(['--session-id', sessionId, '--name', name], prompt);
    let comment = commentOf(parsed);
    let wording = qaWording(comment);
    let cost = parsed.costUsd;
    steps.done('review', parsed.verdict.verdict === 'pass' ? 'It passes' : 'It needs changes');
    if (wording.length) {
      // One fix, in the same session: the verifier sees its answer and what the check found.
      steps.start('wording', 'Fix the wording', plural(wording.length, 'finding'));
      const fixed = ask(['--resume', parsed.sessionId ?? sessionId], verifyFixPrompt(wording));
      const again = commentOf(fixed);
      const left = qaWording(again);
      if (left.length <= wording.length) [parsed, comment, wording] = [{ ...fixed, sessionId: fixed.sessionId ?? parsed.sessionId }, again, left];
      cost = cost === null && fixed.costUsd === null ? null : (cost ?? 0) + (fixed.costUsd ?? 0);
      steps.done('wording', wording.length ? `${wording.length} left` : 'It passes');
    }
    const update = steps.step('comment', 'Draft the QA comment', () => draftUpdate(paths, task, { event: 'verify', pr: { number: pr.number, url: pr.url }, text: comment }, opts.by, now));
    const finished = now();
    const v: Verification = {
      v: 1, task: id, key, pr, sha: pr.sha, checks, ...parsed.verdict, update: update?.id ?? null, comment, wording,
      sessionId: parsed.sessionId ?? sessionId, name, at: finished.toISOString(), durationMs: finished.getTime() - startedAt.getTime(), costUsd: cost,
    };
    steps.step('save', 'Keep the verification with the task', () => writeAtomic(verificationPath(paths, id, pr.sha), JSON.stringify(v, null, 2) + '\n'));
    return v;
  } finally {
    awake?.release();
    rmSync(marker, { force: true });
  }
}

// ---------------------------------------------------------------- clearing it

export interface ClearedVerification {
  /** The worktree it removed, or null when there was none. */
  worktree: string | null;
  /** How many stored verifications it removed. */
  removed: number;
}

/**
 * Clears a task's verifications (T-84): its detached worktree, each stored verdict, and the pull requests
 * kept to choose from. Its QA comment's draft stays, for the person to post or discard. A verification
 * under way is refused.
 */
export function clearVerification(paths: RepoPaths, config: Pick<Config, 'worktrees'>, id: string, run: Runner): ClearedVerification {
  if (verifying(paths, id)) throw new AccError('refused', `${id}'s pull request is being verified now. Clear it once that finishes.`);
  const main = mainCheckout(run, paths.root);
  const wt = verifyWorktree(config, main, id);
  let worktree: string | null = null;
  if (existsSync(wt)) {
    const r = run('git', ['worktree', 'remove', '--force', wt], { cwd: main });
    if (r.code !== 0) throw new AccError('verify', `git couldn't remove the worktree at ${wt}: ${lastLine(r.stderr)}`);
    worktree = wt;
  }
  const stored = readVerifications(paths, id);
  for (const v of stored) rmSync(verificationPath(paths, id, v.sha), { force: true });
  rmSync(choicePath(paths, id), { force: true });
  return { worktree, removed: stored.length };
}

/**
 * Clears the verifications of every task that left the board (T-84): a stored verdict, or a list to
 * choose from, whose task the ledger no longer holds. Nothing runs when there is none.
 */
export function pruneVerifications(paths: RepoPaths, config: Pick<Config, 'worktrees'>, run: Runner): string[] {
  let names: string[];
  try {
    names = readdirSync(verificationsDir(paths));
  } catch {
    return [];
  }
  const tasks = new Set(readLedger(paths.ledger).tasks.map((t) => t.id));
  const stored = new Set(names.filter((n) => n.endsWith('.json') && !n.endsWith('.running.json')).map((n) => /^(.+?)(?:-[0-9a-f]{7,64}|\.found)\.json$/.exec(n)?.[1]).filter((t): t is string => !!t));
  const gone = [...stored].filter((t) => !tasks.has(t)).sort();
  for (const t of gone) clearVerification(paths, config, t, run);
  return gone;
}
