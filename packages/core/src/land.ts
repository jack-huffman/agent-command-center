import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Config, type Environment, environmentByBranch } from './config.ts';
import { AccError, type Runner } from './exec.ts';
import { type Actor, mutate, type PullRequest, readLedger, type Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { type Receipt, receiptHooks, receiptsAt } from './receipts.ts';
import { readVerdict, type Verdict } from './review.ts';
import { conflictsOf, FETCH_TIMEOUT_MS, fetchBranches } from './sync.ts';
import { draftUpdate } from './updates.ts';

/**
 * Landing (D-033): a reviewed task's branch goes to GitHub as a pull request into its environment's
 * branch, and an update for the ticket is drafted for a person to post (D-???). acc never merges, and
 * never posts: a person does both.
 */

/** How long acc waits for the push, and for each gh call, before it stops it. */
export const PUSH_TIMEOUT_MS = 5 * 60_000;
export const GH_TIMEOUT_MS = 2 * 60_000;

/**
 * The longest a land can take: its push, its fetch and three gh calls (auth token, pr list, pr create or
 * edit), each at its timeout, plus a minute for local git, the ledger's lock and the drafts' lock.
 * Whatever runs acc land waits at least this long, or the land's result is lost (D-053). The issue
 * comment it once posted is a draft now (D-???), so its gh call is gone.
 */
export const LAND_TIMEOUT_MS = PUSH_TIMEOUT_MS + FETCH_TIMEOUT_MS + 3 * GH_TIMEOUT_MS + 60_000;

export interface LandDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
}

export interface LandResult {
  task: Task;
  sha: string;
  pr: PullRequest;
  /** False when the pull request was already open: the push updated it. */
  opened: boolean;
  /** The update drafted for the ticket, for a person to post; null for a task with no ticket (D-???). */
  update: { id: string; key: string } | null;
  /** Why no update could be drafted, when one should have been. */
  updateError?: string;
}

const STATUS_WORD: Record<string, string> = { pass: 'Passed', fail: 'Failed', error: 'Couldn\'t run', skip: 'Didn\'t apply' };
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();

/** The pull request's description: what it does, its acceptance criteria, its checks and its review. */
export function prBody(task: Task, env: Environment, sha: string, verdict: Verdict, receipts: Record<string, Receipt>): string {
  const ticket = task.source.url ? `[${task.source.key ?? task.id}](${task.source.url})` : null;
  const lines = [
    verdict.summary.trim(),
    '',
    ...(ticket ? [`Ticket: ${ticket}${task.source.kind === 'github' && task.source.key ? ` (refs ${task.source.key})` : ''}`, ''] : []),
    '## Acceptance criteria',
    '',
    ...(verdict.criteria.length ? verdict.criteria.map((c) => `- [${c.met ? 'x' : ' '}] ${c.text}${c.evidence ? ` (${c.evidence})` : ''}`) : ['_The reviewer listed none._']),
    '',
    `## Checks on ${sha.slice(0, 7)}`,
    '',
    '| Check | Result | Detail |',
    '|---|---|---|',
    ...Object.values(receipts).map((r) => `| \`${r.gate}\` | ${r.waived ? `Waived by ${r.waived.by.replace(/^human:/, '')}` : STATUS_WORD[r.status] ?? r.status} | ${cell(r.waived ? r.waived.reason : r.summary)} |`),
    '',
    '## Review',
    '',
    `Passed by a reviewer agent that read the change and couldn't edit it.`,
    ...(verdict.findings.length ? ['', 'Worth a look, not blocking:', '', ...verdict.findings.map((f) => `- ${f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`: ` : ''}${f.message}`)] : []),
    '',
    '---',
    `Built by a Claude Code agent and opened by \`acc land\` into \`${env.branch}\` (${env.name}). It merges only when a person merges it.`,
  ];
  return lines.join('\n') + '\n';
}

/** How acc acts as the repo's GitHub account: gh's token for it, which each gh call gets as GH_TOKEN (D-007, D-028). */
export function ghToken(run: Runner, account: string): string {
  const t = run('gh', ['auth', 'token', '-u', account], { timeoutMs: GH_TIMEOUT_MS });
  if (t.code !== 0 || !t.stdout.trim()) throw new AccError('no-github', `gh isn't logged in as ${account}, the account this repo works as. Sign in from the Command Center, or run gh auth login.`);
  return t.stdout.trim();
}

export function land(paths: RepoPaths, config: Config, id: string, deps: LandDeps, opts: { actor?: Actor; by?: string } = {}): LandResult {
  const { run, now } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  if (task.state !== 'review') throw new AccError('refused', `${id} is ${task.state}. A task lands from review, once its review has passed.`);
  const gh = config.github;
  if (!gh) throw new AccError('no-github', 'acc land opens a pull request on GitHub, and this project has no "github" section in .acc/config.json.');
  const env = environmentByBranch(config, task.environment);
  if (!env) throw new AccError('land', `${id}'s environment "${task.environment}" isn't in the config.`);
  const branch = task.run?.branch;
  if (!branch) throw new AccError('land', `${id} has no branch to land.`);
  const sha = run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: paths.root }).stdout.trim();
  if (!sha) throw new AccError('land', `The branch ${branch} isn't in this clone.`);
  const missing = receiptHooks(paths, config, run).missingGates(task);
  if (missing.length) throw new AccError('refused', `${id}'s checks aren't settled on ${sha.slice(0, 7)}: ${missing.join(', ')}.`);
  const verdict = readVerdict(paths, id, sha);
  if (!verdict) throw new AccError('refused', `${id} hasn't been reviewed on ${sha.slice(0, 7)}. Run acc review ${id} first.`);
  if (verdict.verdict !== 'pass') throw new AccError('refused', `${id}'s review on ${sha.slice(0, 7)} asked for changes: ${verdict.summary}`);

  const ghEnv = { ...deps.env, GH_TOKEN: ghToken(run, gh.account) };
  const ghRun = (args: string[]) => run('gh', args, { cwd: paths.root, env: ghEnv, timeoutMs: GH_TIMEOUT_MS });
  const open = ghRun(['pr', 'list', '-R', gh.repo, '--head', branch, '--state', 'open', '--json', 'number,url']);
  const existing = open.code === 0 ? (JSON.parse(open.stdout || '[]') as { number: number; url: string }[])[0] : undefined;
  // The ledger names a pull request GitHub doesn't have open: closed, or merged since acc last looked.
  // Autopilot never opens another in its place, and asks before the push, so a merged pull request's
  // deleted branch isn't made again (D-063).
  if (!existing && task.pr && opts.actor === 'orchestrator') {
    const seen = open.code === 0 ? 'isn\'t open on GitHub'
      : `may not be open on GitHub: gh couldn't list the branch's pull requests (${(open.stderr || open.stdout).trim().split('\n')[0] || `exit ${open.code}`})`;
    throw new AccError('land', `Pull request #${task.pr.number} ${seen}. Autopilot won't open another: a person decides.`);
  }

  // Push as the repo's own account: the credential helper acc set up follows this clone's choice (D-028).
  const push = run('git', ['push', '--set-upstream', 'origin', `${branch}:${branch}`], { cwd: paths.root, env: deps.env, timeoutMs: PUSH_TIMEOUT_MS });
  if (push.code !== 0) throw new AccError('land', `git push refused ${branch}: ${(push.stderr || push.stdout).trim().split('\n').slice(-2).join(' ')}`);

  const receipts = receiptsAt(paths, sha);
  const body = prBody(task, env, sha, verdict, receipts);
  const dir = mkdtempSync(join(tmpdir(), 'acc-land-'));
  let pr: PullRequest;
  let opened: boolean;
  try {
    const bodyFile = join(dir, 'body.md');
    writeFileSync(bodyFile, body);
    if (existing) {
      const edit = ghRun(['pr', 'edit', String(existing.number), '-R', gh.repo, '--body-file', bodyFile]);
      if (edit.code !== 0) throw new AccError('land', `Couldn't update pull request #${existing.number}: ${edit.stderr.trim().split('\n')[0]}`);
      pr = { number: existing.number, url: existing.url, state: 'open', landedAt: now().toISOString(), sha };
      opened = false;
    } else {
      const create = ghRun(['pr', 'create', '-R', gh.repo, '--base', env.branch, '--head', branch, '--title', `${task.id}: ${task.title}`, '--body-file', bodyFile]);
      const url = create.stdout.trim().split('\n').find((l) => /^https:\/\/github\.com\/.+\/pull\/\d+/.test(l.trim()))?.trim();
      if (create.code !== 0 || !url) throw new AccError('land', `gh couldn't open the pull request: ${(create.stderr || create.stdout).trim().split('\n')[0]}`);
      pr = { number: Number(/\/pull\/(\d+)/.exec(url)![1]), url, state: 'open', landedAt: now().toISOString(), sha };
      opened = true;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // Whether it merges into its base: branches built side by side often don't (D-049).
  const conflicts = fetchBranches(run, paths.root, [env.branch, branch], deps.env) ? conflictsOf(run, paths.root, env.branch, branch) : null;
  if (conflicts) pr = { ...pr, conflicts };

  const updated = mutate(paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === id)!;
    t.pr = pr;
    // Landed, by autopilot or by hand: whatever autopilot couldn't do before is done (D-055).
    if (t.autopilot?.failed) t.autopilot.failed = null;
    t.updatedAt = now().toISOString();
    emit({ type: 'task.updated', task: id, actor: opts.actor ?? 'human', by: opts.by ?? 'acc land', data: { pr, sha, opened } });
    return t;
  });
  // The ticket hears about it only from a person: acc drafts what to say, and posts nothing (D-???).
  // The pull request is recorded whatever happens to the draft.
  try {
    const update = draftUpdate(paths, task, {
      event: opened ? 'pr-opened' : 'pr-updated', pr: { number: pr.number, url: pr.url },
      context: { summary: verdict.client?.trim() || task.title },
    }, opts.by ?? 'acc land', now);
    return { task: updated, sha, pr, opened, update: update ? { id: update.id, key: update.key } : null };
  } catch (e) {
    return { task: updated, sha, pr, opened, update: null, updateError: (e as Error).message };
  }
}
