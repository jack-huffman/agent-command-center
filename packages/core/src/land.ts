import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keepChanges, mergedPaths } from './changes.ts';
import { autoMergeFor, type Config, type Environment, environmentByBranch, type GateScope } from './config.ts';
import { AccError, type Runner } from './exec.ts';
import { withJob } from './jobs.ts';
import { type Actor, type CarriedReview, mutate, noteMarkdown, type PullRequest, readLedger, type Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { ratchetLine } from './ratchets.ts';
import { type GateStatus, ratchetOf, type Receipt, receiptHooks, receiptsAt } from './receipts.ts';
import { resolvedWords } from './refresh.ts';
import { NO_STEPS, type Steps } from './steps.ts';
import { carriedVerdict, readVerdict, type Verdict } from './review.ts';
import { FETCH_TIMEOUT_MS, fetchBranches } from './fetch.ts';
import { conflictsOf } from './sync.ts';
import { testsText } from './test-counts.ts';
import { draftUpdate } from './updates.ts';

/**
 * Landing (D-033): a reviewed task's branch goes to GitHub as a pull request into its environment's
 * branch, and an update for the ticket is drafted for a person to post (D-066). acc never posts: a person
 * does. It merges nothing either: a person merges, or autopilot where the repo turns auto-merge on (GH-67).
 */

/** How long acc waits for the push, and for each gh call, before it stops it. */
export const PUSH_TIMEOUT_MS = 5 * 60_000;
export const GH_TIMEOUT_MS = 2 * 60_000;

/**
 * The longest a land can take: its push, its fetch and three gh calls (auth token, pr list, pr create or
 * edit), each at its timeout, plus a minute for local git, the ledger's lock and the drafts' lock.
 * Whatever runs acc land waits at least this long, or the land's result is lost (D-053). The issue
 * comment it once posted is a draft now (D-066), so its gh call is gone.
 */
export const LAND_TIMEOUT_MS = PUSH_TIMEOUT_MS + FETCH_TIMEOUT_MS + 3 * GH_TIMEOUT_MS + 60_000;

/** The longest `acc update post` can take: gh's token and the issue comment, each at its timeout, and a minute for the drafts' lock (D-066). */
export const UPDATE_POST_TIMEOUT_MS = 2 * GH_TIMEOUT_MS + 60_000;

export interface LandDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  /** Where its steps are reported (T-65). */
  steps?: Steps;
}

export interface LandResult {
  task: Task;
  sha: string;
  pr: PullRequest;
  /** False when the pull request was already open: the push updated it. */
  opened: boolean;
  /** The update drafted for the ticket, for a person to post; null for a task with no ticket (D-066). */
  update: { id: string; key: string } | null;
  /** Why no update could be drafted, when one should have been. */
  updateError?: string;
}

const STATUS_WORD: Record<GateStatus, string> = { pass: 'Passed', fail: 'Failed', error: 'Couldn\'t run', skip: 'Didn\'t apply', hold: 'Needs a person' };
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();

/** How a pull request merges, as its description ends: by a person, or by autopilot where auto-merge covers its environment (GH-67). */
export function mergesWords(autoMerge: boolean): string {
  return autoMerge
    ? 'With autopilot running, it merges once its checks pass on GitHub and nothing waits on a person: auto-merge is on for this repo. Ask for changes to hold it.'
    : 'It merges only when a person merges it.';
}

/**
 * The pull request's description: what it does, its acceptance criteria, its checks and its review. A merge
 * commit the merge queue made says the review it carries is of the commit it was made on (GH-73). Where a
 * check counted its tests, or tried to, the table says what ran (GH-100).
 */
export function prBody(task: Task, env: Environment, sha: string, verdict: Verdict, receipts: Record<string, Receipt>, autoMerge = false, carried: CarriedReview | null = null): string {
  const ticket = task.source.url ? `[${task.source.key ?? task.id}](${task.source.url})` : null;
  const counted = Object.values(receipts).some((r) => testsText(r));
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
    counted ? '| Check | Result | Tests | Detail |' : '| Check | Result | Detail |',
    counted ? '|---|---|---|---|' : '|---|---|---|',
    // A ratchet shows its numbers, from the environment's floor to this commit's: tests 669 → 674 (+5) (GH-99).
    ...Object.values(receipts).map((r) => `| \`${r.gate}\` | ${r.waived ? `Waived by ${r.waived.by.replace(/^human:/, '')}` : STATUS_WORD[r.status] ?? r.status} |${counted ? ` ${testsText(r)} |` : ''} ${cell(r.waived ? r.waived.reason : ratchetOf(r) ? ratchetLine(ratchetOf(r)!) : r.summary)} |`),
    '',
    '## Review',
    '',
    carried
      ? `Passed on ${carried.from.slice(0, 7)} by a reviewer agent that read the change and couldn't edit it. The merge queue then merged \`${carried.base}\` in as ${sha.slice(0, 7)}${carried.resolved.length ? `, ${resolvedWords(carried.resolved, 'keeping', (f) => `\`${f}\``)}` : ''}, and ran the full check on it: the review carries over.`
      : `Passed by a reviewer agent that read the change and couldn't edit it.`,
    ...(verdict.findings.length ? ['', 'Worth a look, not blocking:', '', ...verdict.findings.map((f) => `- ${f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`: ` : ''}${f.message}`)] : []),
    '',
    // Its builder's handoff note (D-106), as its own account: the review above is what checked the change.
    '## Builder\'s note',
    '',
    ...(task.run?.note ? [`In its builder's own words, ${task.run.note.ended === 'blocked' ? 'when it blocked' : 'as it finished'}. The review above is what checked the change.`, '', ...noteMarkdown(task.run.note)] : ['_Its builder left no note._']),
    '',
    '---',
    `Built by a Claude Code agent and opened by \`acc land\` into \`${env.branch}\` (${env.name}). ${mergesWords(autoMerge)}`,
  ];
  return lines.join('\n') + '\n';
}

/** How acc acts as the repo's GitHub account: gh's token for it, which each gh call gets as GH_TOKEN (D-007, D-028). */
export function ghToken(run: Runner, account: string): string {
  const t = run('gh', ['auth', 'token', '-u', account], { timeoutMs: GH_TIMEOUT_MS });
  if (t.code !== 0 || !t.stdout.trim()) throw new AccError('no-github', `gh isn't logged in as ${account}, the account this repo works as. Sign in from the Command Center, or run gh auth login.`);
  return t.stdout.trim();
}

/**
 * A land, with a marker saying it's under way while it runs, so every window shows it (D-092). `gates` is
 * which checks the commit needs (GH-73): a builder's by default, or the merge's, as the merge queue pushes
 * its merge commit, which it checked in full. A merge commit the queue made carries the review of the
 * commit it was made on (reviewedAt).
 */
export function land(paths: RepoPaths, config: Config, id: string, deps: LandDeps, opts: { actor?: Actor; by?: string; gates?: GateScope } = {}): LandResult {
  return withJob(paths, { kind: 'land', task: id, by: opts.by ?? 'acc land' }, () => landNow(paths, config, id, deps, opts), deps.now);
}

function landNow(paths: RepoPaths, config: Config, id: string, deps: LandDeps, opts: { actor?: Actor; by?: string; gates?: GateScope }): LandResult {
  const { run, now } = deps;
  const steps = deps.steps ?? NO_STEPS;
  const { task, gh, env, branch, sha, own, verdict } = steps.step('task', 'Check its review and checks', () => {
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
    const missing = receiptHooks(paths, config, run).missingGates(task, opts.gates);
    if (missing.length) throw new AccError('refused', `${id}'s checks aren't settled on ${sha.slice(0, 7)}: ${missing.join(', ')}.`);
    const own = readVerdict(paths, id, sha);
    const verdict = own ?? carriedVerdict(paths, task, sha);
    if (!verdict) throw new AccError('refused', `${id} hasn't been reviewed on ${sha.slice(0, 7)}. Run acc review ${id} first.`);
    if (verdict.verdict !== 'pass') throw new AccError('refused', `${id}'s review on ${sha.slice(0, 7)} asked for changes: ${verdict.summary}`);
    return { task, gh, env, branch, sha, own, verdict };
  });

  const ghEnv = { ...deps.env, GH_TOKEN: steps.step('github', `Sign in to GitHub as ${gh.account}`, () => ghToken(run, gh.account)) };
  const ghRun = (args: string[]) => run('gh', args, { cwd: paths.root, env: ghEnv, timeoutMs: GH_TIMEOUT_MS });
  const existing = steps.step('find', 'Look for its pull request', () => {
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
    return existing;
  });

  // Push as the repo's own account: the credential helper acc set up follows this clone's choice (D-028).
  steps.step('push', `Push ${branch}`, () => {
    const push = run('git', ['push', '--set-upstream', 'origin', `${branch}:${branch}`], { cwd: paths.root, env: deps.env, timeoutMs: PUSH_TIMEOUT_MS });
    if (push.code !== 0) throw new AccError('land', `git push refused ${branch}: ${(push.stderr || push.stdout).trim().split('\n').slice(-2).join(' ')}`);
  });

  const receipts = receiptsAt(paths, sha);
  const body = prBody(task, env, sha, verdict, receipts, autoMergeFor(config, env.branch), own ? null : task.autopilot?.carried ?? null);
  const dir = mkdtempSync(join(tmpdir(), 'acc-land-'));
  let pr: PullRequest;
  let opened: boolean;
  steps.start('pr', existing ? `Update pull request #${existing.number}` : `Open the pull request into ${env.branch}`);
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
  } catch (e) {
    steps.fail('pr', (e as Error).message);
    throw e;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  steps.done('pr', `#${pr.number}`);
  // Whether it merges into its base: branches built side by side often don't (D-049).
  steps.start('conflicts', `Check it merges into ${env.branch}`);
  const conflicts = fetchBranches(run, paths.root, [env.branch, branch], deps.env) ? conflictsOf(run, paths.root, env.branch, branch) : null;
  if (conflicts) pr = { ...pr, conflicts };
  steps.done('conflicts', conflicts?.length ? `It conflicts in ${conflicts.join(', ')}` : undefined);

  // What its pull request changes, kept with it for after its branch is gone (T-99).
  const changed = mergedPaths(run, paths.root, task);
  const updated = steps.step('record', 'Record the pull request', () => mutate(paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === id)!;
    t.pr = pr;
    keepChanges(t, changed, now().toISOString(), emit, { actor: opts.actor ?? 'human', by: opts.by ?? 'acc land' });
    // Landed, by autopilot or by hand: whatever autopilot couldn't do before is done (D-055).
    if (t.autopilot?.failed) t.autopilot.failed = null;
    t.updatedAt = now().toISOString();
    emit({ type: 'task.updated', task: id, actor: opts.actor ?? 'human', by: opts.by ?? 'acc land', data: { pr, sha, opened } });
    return t;
  }));
  // The ticket hears about it only from a person: acc drafts what to say, and posts nothing (D-066).
  // The pull request is recorded whatever happens to the draft.
  steps.start('update', 'Draft the ticket\'s update');
  try {
    const update = draftUpdate(paths, task, {
      event: opened ? 'pr-opened' : 'pr-updated', pr: { number: pr.number, url: pr.url },
      context: { summary: verdict.client?.trim() || task.title },
    }, opts.by ?? 'acc land', now);
    steps.done('update', update ? undefined : 'It has no ticket');
    return { task: updated, sha, pr, opened, update: update ? { id: update.id, key: update.key } : null };
  } catch (e) {
    steps.fail('update', (e as Error).message);
    return { task: updated, sha, pr, opened, update: null, updateError: (e as Error).message };
  }
}
