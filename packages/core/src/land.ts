import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Config, type Environment, environmentByBranch } from './config.ts';
import { AccError, type Runner } from './exec.ts';
import { type Actor, mutate, type PullRequest, readLedger, type Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { type Receipt, receiptHooks, receiptsAt } from './receipts.ts';
import { readVerdict, type Verdict } from './review.ts';

/**
 * Landing (D-033): a reviewed task's branch goes to GitHub as a pull request into its environment's
 * branch, and the ticket hears about it. acc never merges: a person does, on GitHub.
 */

export interface LandDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
}

/** A comment for a ticket acc can't post itself (Jira, Azure DevOps): the extension posts it as you. */
export interface PendingComment {
  kind: 'jira' | 'azure';
  key: string;
  text: string;
}

export interface LandResult {
  task: Task;
  sha: string;
  pr: PullRequest;
  /** False when the pull request was already open: the push updated it. */
  opened: boolean;
  /** Commented on the GitHub issue. */
  commented: boolean;
  comment: PendingComment | null;
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

/** What the ticket is told: the pull request, and that it's waiting for a person. */
export const ticketComment = (task: Task, pr: PullRequest, opened: boolean): string =>
  opened ? `${task.id} has a pull request: ${pr.url}\nAn agent built it and another reviewed it. It merges when a person approves it.`
    : `${task.id}'s pull request was updated after rework: ${pr.url}`;

function ghToken(run: Runner, account: string): string {
  const t = run('gh', ['auth', 'token', '-u', account]);
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

  // Push as the repo's own account: the credential helper acc set up follows this clone's choice (D-028).
  const push = run('git', ['push', '--set-upstream', 'origin', `${branch}:${branch}`], { cwd: paths.root, env: deps.env, timeoutMs: 5 * 60_000 });
  if (push.code !== 0) throw new AccError('land', `git push refused ${branch}: ${(push.stderr || push.stdout).trim().split('\n').slice(-2).join(' ')}`);

  const ghEnv = { ...deps.env, GH_TOKEN: ghToken(run, gh.account) };
  const ghRun = (args: string[]) => run('gh', args, { cwd: paths.root, env: ghEnv, timeoutMs: 2 * 60_000 });
  const receipts = receiptsAt(paths, sha);
  const body = prBody(task, env, sha, verdict, receipts);
  const dir = mkdtempSync(join(tmpdir(), 'acc-land-'));
  let pr: PullRequest;
  let opened: boolean;
  try {
    const bodyFile = join(dir, 'body.md');
    writeFileSync(bodyFile, body);
    const open = ghRun(['pr', 'list', '-R', gh.repo, '--head', branch, '--state', 'open', '--json', 'number,url']);
    const existing = open.code === 0 ? (JSON.parse(open.stdout || '[]') as { number: number; url: string }[])[0] : undefined;
    if (existing) {
      const edit = ghRun(['pr', 'edit', String(existing.number), '-R', gh.repo, '--body-file', bodyFile]);
      if (edit.code !== 0) throw new AccError('land', `Couldn't update pull request #${existing.number}: ${edit.stderr.trim().split('\n')[0]}`);
      pr = { number: existing.number, url: existing.url, state: 'open' };
      opened = false;
    } else {
      const create = ghRun(['pr', 'create', '-R', gh.repo, '--base', env.branch, '--head', branch, '--title', `${task.id}: ${task.title}`, '--body-file', bodyFile]);
      const url = create.stdout.trim().split('\n').find((l) => /^https:\/\/github\.com\/.+\/pull\/\d+/.test(l.trim()))?.trim();
      if (create.code !== 0 || !url) throw new AccError('land', `gh couldn't open the pull request: ${(create.stderr || create.stdout).trim().split('\n')[0]}`);
      pr = { number: Number(/\/pull\/(\d+)/.exec(url)![1]), url, state: 'open' };
      opened = true;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // The ticket hears about it. GitHub acc tells itself; Jira and Azure DevOps go through the extension, as you.
  let commented = false;
  let comment: PendingComment | null = null;
  const text = ticketComment(task, pr, opened);
  const issue = task.source.kind === 'github' ? /(\d+)$/.exec(task.source.key ?? task.id)?.[1] : undefined;
  if (issue) commented = ghRun(['issue', 'comment', issue, '-R', gh.repo, '--body', text]).code === 0;
  else if ((task.source.kind === 'jira' || task.source.kind === 'azure') && task.source.key) comment = { kind: task.source.kind, key: task.source.key, text };

  const updated = mutate(paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === id)!;
    t.pr = pr;
    t.updatedAt = now().toISOString();
    emit({ type: 'task.updated', task: id, actor: opts.actor ?? 'human', by: opts.by ?? 'acc land', data: { pr, sha, opened } });
    return t;
  });
  return { task: updated, sha, pr, opened, commented, comment };
}
