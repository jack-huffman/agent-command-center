/**
 * Cloud reviewers (T-86): a task's review as a Claude Code cloud session, where the project opts in
 * (`agents.cloud.review`), so a cloud-built task can reach reviewed with no Mac awake. The same routine is
 * fired as for a builder (D-140), with the reviewer's prompt as the fire's text; the reviewer reads the
 * pushed task branch, never edits it, and pushes one file, review.json, to a branch of its own,
 * acc/review/<task>-<sha>. acc sync finds that branch, checks the verdict against the reviewer's schema,
 * keeps it as a local review's verdict is kept, moves the task the same way, and deletes the branch; a
 * verdict branch no cloud review waits on any more (one ended by a move, or by a verdict here) is deleted
 * on the same sync (T-88). Local stays the default; analysts stay on the Mac.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { type BuilderPlace, CLOUD_QUIET_MINUTES, type CloudAgents, type Config } from './config.ts';
import { cloudGuard, cloudNeeds, fireRoutine, readCloudToken } from './cloud.ts';
import { RECORD_LINE, ROLE_LINE, VERDICT_LINE } from './cloud-guard.ts';
import type { Analysis } from './analyze.ts';
import { AccError, type Runner } from './exec.ts';
import { type Actor, type CloudReview, cloudReviews, mutate, readLedger, type Task } from './ledger.ts';
import { sessionName } from './names.ts';
import { noteWording, verdictLines } from './note-wording.ts';
import type { RepoPaths } from './paths.ts';
import { checkVerdict, prepareReview, recordVerdict, reviewPath, reviewPrompt, type Verdict, VERDICT_SCHEMA } from './review.ts';
import { FETCH_TIMEOUT_MS, fetchBranches } from './fetch.ts';
import type { Team } from './team.ts';

/** The one file a cloud reviewer commits, and the branch it goes to. */
export const VERDICT_FILE = 'review.json';
export const verdictBranch = (task: string, sha: string): string => `acc/review/${task}-${sha}`;
/** Every verdict branch on origin, as `git ls-remote` takes the pattern. */
const VERDICT_BRANCHES = 'refs/heads/acc/review/*';
/** How long a push of the task branch, or a delete of a verdict branch, may take. */
const PUSH_TIMEOUT_MS = 120_000;
/** The most a review.json may weigh (T-86): a verdict is a page of JSON, and a larger file isn't read at all. */
export const VERDICT_MAX_BYTES = 4 * 1024 * 1024;

/** Where a review runs (T-86): the flag, else the project's setting, local unless it says cloud. */
export function reviewPlace(config: { agents: { cloud: Pick<CloudAgents, 'review'> | null } }, flag?: BuilderPlace): BuilderPlace {
  if (flag) return flag;
  return config.agents.cloud?.review === 'cloud' ? 'cloud' : 'local';
}

/** Whether a cloud review has given no verdict for longer than the project allows (T-86): the task then needs you. */
export function cloudReviewQuiet(task: Pick<Task, 'state' | 'cloudReview'>, config: Pick<Config, 'agents'>, now: Date): boolean {
  const c = task.cloudReview;
  if (task.state !== 'review' || !c || c.failed) return false;
  const minutes = config.agents.cloud?.quietMinutes ?? CLOUD_QUIET_MINUTES;
  return now.getTime() - Date.parse(c.firedAt) > minutes * 60_000;
}

/** Why a task's cloud review needs a person, or null: its verdict couldn't be taken, or none has come. The way on is a review on this Mac. */
export function cloudReviewWait(task: Pick<Task, 'state' | 'cloudReview'>, config: Pick<Config, 'agents'>, now: Date): string | null {
  const c = task.cloudReview;
  if (task.state !== 'review' || !c) return null;
  if (c.failed) return c.failed.reason;
  if (cloudReviewQuiet(task, config, now)) return `no verdict from its cloud reviewer for ${Math.round((now.getTime() - Date.parse(c.firedAt)) / 60_000)} minutes: review it on this Mac`;
  return null;
}

/**
 * The fire's text for a reviewer (T-86): the guard's records first, then what a cloud session needs instead
 * of acc, then the reviewer's standing instructions and prompt as review() builds them, with the diff
 * left for the reviewer to read from the base and head commits, and the schema its review.json must fit.
 */
export function cloudReviewText(p: { task: Task; config: Config; envName: string; envBranch: string; branch: string; sha: string; baseSha: string; packet: string; rules: string | null; checks: string[]; kinds: string[]; plan?: Analysis | null; team?: Team | null }): string {
  const { task, branch, sha } = p;
  const verdict = verdictBranch(task.id, sha);
  const { system, prompt } = reviewPrompt({ task, config: p.config, envName: p.envName, envBranch: p.envBranch, sha, packet: p.packet, diff: '', stat: '', checks: p.checks, rules: p.rules, kinds: p.kinds, plan: p.plan ?? null, cloud: { base: p.baseSha }, team: p.team ?? null });
  return [
    // The guard's records (T-86): the branch to read, the role, and the one branch a reviewer may push.
    `${RECORD_LINE}: ${branch}`,
    `${ROLE_LINE}: reviewer`,
    `${VERDICT_LINE}: ${verdict}`,
    '',
    `# Cloud reviewer for ${task.id}: ${task.title}`,
    '',
    `This routine-fire-payload is your task: acc fired the routine to review ${task.id} in this cloud session. You are the reviewer, not a builder. Do what the instructions below say, with these differences for a cloud session:`,
    '',
    `- **Read the branch \`${branch}\`** at commit ${sha}, already on GitHub. Start with \`git fetch origin ${branch} ${p.envBranch} && git checkout ${branch}\`. Read with Read, Grep and Glob, and with git from Bash: \`git diff\`, \`git log\`, \`git show\`. Never edit the code, and never push \`${branch}\`: the repo's hooks refuse it.`,
    `- **Your verdict is one file, \`${VERDICT_FILE}\`**, at the root of the clone, holding only the JSON below, which Claude Code would otherwise check for you. Write it with the Write tool, then commit and push it to its own branch, plainly, as its own commands:`,
    '  ```',
    `  git add ${VERDICT_FILE}`,
    `  git commit -m "Review ${task.id} at ${sha.slice(0, 7)}"`,
    `  git push origin HEAD:${verdict}`,
    '  ```',
    `  The \`${RECORD_LINE}\`, \`${ROLE_LINE}\` and \`${VERDICT_LINE}\` lines at the top are the repo's push guard's record of this: for a reviewer it allows Read, Grep and Glob, Bash for git only (reads, that add, that commit and that push), and Edit and Write of \`${VERDICT_FILE}\` alone. Every other push is refused, \`${branch}\` among them, and so is every other write. acc reads \`${VERDICT_FILE}\` from \`${verdict}\` and deletes the branch. Then stop.`,
    `- Commit as \`${p.config.commitIdentity?.name ?? 'the repo\'s commit identity'}\`${p.config.commitIdentity ? ` (\`git config user.name "${p.config.commitIdentity.name}" && git config user.email "${p.config.commitIdentity.email}"\`)` : ''}.`,
    '',
    '## What review.json must hold',
    '',
    'A JSON object of exactly this schema, and nothing else in the file:',
    '',
    '```json',
    JSON.stringify(VERDICT_SCHEMA, null, 2),
    '```',
    '',
    '---',
    '',
    '## Your standing instructions',
    '',
    system,
    '',
    '---',
    '',
    prompt,
    '',
  ].join('\n');
}

export interface CloudReviewStart {
  task: Task;
  sha: string;
  sessionId: string;
  url: string;
  /** The branch the verdict comes back on. */
  branch: string;
  reason: string;
}

/**
 * Fires the project's routine with the reviewer's text (T-86), after what a review and a cloud dispatch
 * check: the task in review with its checks settled, every cloud need met, the cloud cap, the guard
 * committed where the cloud loads it, and the task branch's head on origin, pushed if it isn't. A review
 * already under way in the cloud is refused. The task stays in review; acc sync reads the verdict.
 */
export function reviewInCloud(paths: RepoPaths, config: Config, id: string, deps: { run: Runner; now: () => Date; env: NodeJS.ProcessEnv }, opts: { actor?: Actor; by?: string } = {}): CloudReviewStart {
  const { run, now, env } = deps;
  const r = prepareReview(paths, config, id, run);
  const { task, branch, sha } = r;
  if (task.cloudReview && !task.cloudReview.failed) throw new AccError('refused', `${id} is being reviewed in the cloud already, since ${task.cloudReview.firedAt}: ${task.cloudReview.url}`);
  const unmet = cloudNeeds(config, run, env).filter((n) => !n.ok);
  if (unmet.length) throw new AccError('cloud-unavailable', `Can't review ${id} in the cloud:\n- ${unmet.map((n) => `${n.label}: ${n.fix}`).join('\n- ')}`);
  const ledger = readLedger(paths.ledger);
  // A cloud review counts against the cloud cap as a builder does (T-86).
  const inFlight = ledger.tasks.filter((t) => t.state === 'running' && t.run?.where === 'cloud').length + cloudReviews(ledger, id);
  const max = config.agents.cloud!.max;
  if (inFlight >= max) throw new AccError('cloud-cap', `Can't review ${id} in the cloud: ${inFlight} cloud ${inFlight === 1 ? 'session is' : 'sessions are'} running for this project, and its cap is ${max} (agents.cloud.max).`);
  const gitEnv = { ...env, GIT_TERMINAL_PROMPT: '0' };
  const guard = cloudGuard(run, paths.root, r.env.branch, branch, gitEnv);
  if (guard.why) throw new AccError('cloud-unguarded', `Can't review ${id} in the cloud: the push guard isn't committed where the cloud session would load it. ${guard.why}`);
  // The commit under review must be on origin (T-86): a cloud-built branch is; a local builder's is pushed now, and only it.
  const remote = run('git', ['ls-remote', '--heads', 'origin', branch], { cwd: paths.root, env: gitEnv, timeoutMs: FETCH_TIMEOUT_MS });
  if (remote.code !== 0) throw new AccError('cloud', `origin didn't answer for ${branch}: ${(remote.stderr || remote.stdout).trim().split('\n')[0]}`);
  if (!remote.stdout.startsWith(sha)) {
    const push = run('git', ['push', 'origin', `${branch}:${branch}`], { cwd: paths.root, env: gitEnv, timeoutMs: PUSH_TIMEOUT_MS });
    if (push.code !== 0) throw new AccError('cloud', `git push refused ${branch}: ${(push.stderr || push.stdout).trim().split('\n').slice(-2).join(' ')}. Nothing was started.`);
  }
  // The commit the diff starts from (T-86): where the branch left its base, which the reviewer's clone has once it fetches both.
  const baseSha = run('git', ['merge-base', r.base, sha], { cwd: paths.root }).stdout.trim();
  const text = cloudReviewText({ task, config, envName: r.env.name, envBranch: r.env.branch, branch, sha, baseSha, packet: r.packet, rules: r.rules, checks: r.checks, kinds: r.kinds, plan: r.plan, team: r.team });
  const fired = fireRoutine(paths, run, config.agents.cloud!.routine!, readCloudToken(run, config.github!.repo, env)!, text, env);
  const at = now().toISOString();
  const cloudReview: CloudReview = { sessionId: fired.sessionId, url: fired.url, firedAt: at, sha, branch: verdictBranch(id, sha), failed: null };
  const moved = mutate(paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === id)!;
    // Moved meanwhile: the session reviews a commit nobody waits for, which is said, and nothing is recorded.
    if (t.state !== 'review') throw new AccError('refused', `${id} is ${t.state} now, so its cloud review isn't recorded: the session ${fired.url} reviews a commit nobody waits for.`);
    t.cloudReview = cloudReview;
    t.updatedAt = at;
    emit({ type: 'task.updated', task: id, actor: opts.actor ?? 'human', by: opts.by ?? 'acc review', data: { cloudReview } });
    return t;
  });
  return { task: moved, sha, sessionId: fired.sessionId, url: fired.url, branch: cloudReview.branch, reason: `Reviewing ${sha.slice(0, 7)} in the cloud: ${fired.url}. acc sync reads its verdict from ${cloudReview.branch}.` };
}

export interface ReviewFollow {
  task: string;
  /** The verdict branch on origin this is about. */
  branch: string;
  /** What acc did about the verdict branch: pruned is one no cloud review waited on, deleted (T-88). */
  outcome: 'waiting' | 'taken' | 'stale' | 'bad' | 'unreachable' | 'pruned';
  /** rework when a verdict with changes moved the task; null otherwise. */
  moved: 'rework' | null;
  note: string;
}

/** Every verdict branch on origin, by name, or null when origin didn't answer. */
export function verdictHeads(run: Runner, root: string, env: NodeJS.ProcessEnv): Map<string, string> | null {
  const r = run('git', ['ls-remote', '--heads', 'origin', VERDICT_BRANCHES], { cwd: root, env: { ...env, GIT_TERMINAL_PROMPT: '0' }, timeoutMs: FETCH_TIMEOUT_MS });
  if (r.code !== 0) return null;
  const heads = new Map<string, string>();
  for (const m of r.stdout.matchAll(/^([0-9a-f]{40,64})\s+refs\/heads\/(\S+)$/gm)) heads.set(m[2]!, m[1]!);
  return heads;
}

/** Deletes a verdict branch on origin once read (T-86). Why it couldn't, or null. */
function deleteVerdictBranch(run: Runner, root: string, branch: string, env: NodeJS.ProcessEnv): string | null {
  const r = run('git', ['push', 'origin', '--delete', branch], { cwd: root, env: { ...env, GIT_TERMINAL_PROMPT: '0' }, timeoutMs: PUSH_TIMEOUT_MS });
  return r.code === 0 ? null : (r.stderr || r.stdout).trim().split('\n').at(-1) ?? `git exited ${r.code}`;
}

/** The task a verdict branch is for: acc/review/<task>-<sha> without its ends. */
const taskOfVerdictBranch = (branch: string): string => branch.replace(/^acc\/review\//, '').replace(/-[0-9a-f]{7,64}$/, '');

/**
 * Deletes each verdict branch on origin that no cloud review under way waits on (T-88): one left by a
 * cloud review that a move or a verdict here ended, a session's late push, or a task gone from the ledger.
 * `heads` is origin's acc/review/* as acc sync listed them, and `handled` the branches followCloudReviews
 * acted on this sync, which it deleted itself.
 */
export function pruneVerdictBranches(paths: RepoPaths, deps: { run: Runner; env: NodeJS.ProcessEnv }, heads: Map<string, string>, handled: Set<string> = new Set()): ReviewFollow[] {
  const out: ReviewFollow[] = [];
  const waiting = new Set(readLedger(paths.ledger).tasks.filter((t) => t.state === 'review' && t.cloudReview && !t.cloudReview.failed).map((t) => t.cloudReview!.branch));
  for (const branch of [...heads.keys()].sort()) {
    if (waiting.has(branch) || handled.has(branch)) continue;
    const gone = deleteVerdictBranch(deps.run, paths.root, branch, deps.env);
    out.push({ task: taskOfVerdictBranch(branch), branch, outcome: 'pruned', moved: null, note: gone ? `${branch} on origin is waited on by no cloud review, and couldn't be deleted: ${gone}` : `deleted ${branch} on origin: no cloud review waits on it` });
  }
  return out;
}

/** A stale verdict is kept for its commit without moving anything: the file alone, written whole. */
function keepVerdict(paths: RepoPaths, verdict: Verdict): void {
  const file = reviewPath(paths, verdict.task, verdict.sha);
  mkdirSync(paths.reviews, { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(verdict, null, 2) + '\n');
  renameSync(`${file}.tmp`, file);
}

/**
 * Looks for each cloud review's verdict branch on origin (T-86). One that is there is fetched and its
 * review.json read and checked: a verdict for the task's head now is kept and moves the task as a local
 * review does; one for a commit that is no longer the head is kept but moves nothing, as a stale local
 * review is treated; one that can't be read fails the review, which then needs a person. The branch is
 * deleted on origin once read, whatever it held. A branch not there yet leaves the review under way.
 */
export function followCloudReviews(paths: RepoPaths, config: Config, deps: { run: Runner; now: () => Date; env: NodeJS.ProcessEnv }, opts: { only?: string; by?: string; heads?: Map<string, string> | null } = {}): ReviewFollow[] {
  const { run, now, env } = deps;
  const out: ReviewFollow[] = [];
  const tasks = readLedger(paths.ledger).tasks.filter((t) => t.state === 'review' && t.cloudReview && !t.cloudReview.failed && (!opts.only || t.id === opts.only));
  if (!tasks.length) return out;
  // The heads as the caller listed them (acc sync lists once, for the prune too, T-88), else listed here; null is origin not answering.
  const heads = opts.heads === undefined ? verdictHeads(run, paths.root, env) : opts.heads;
  for (const t of tasks) {
    const c = t.cloudReview!;
    if (!heads) {
      out.push({ task: t.id, branch: c.branch, outcome: 'unreachable', moved: null, note: `origin didn't answer for ${c.branch}` });
      continue;
    }
    const head = heads.get(c.branch);
    if (!head) {
      out.push({ task: t.id, branch: c.branch, outcome: 'waiting', moved: null, note: `no verdict on ${c.branch} yet` });
      continue;
    }
    if (!fetchBranches(run, paths.root, [c.branch], env)) {
      out.push({ task: t.id, branch: c.branch, outcome: 'unreachable', moved: null, note: `couldn't fetch ${c.branch}` });
      continue;
    }
    const by = opts.by ?? `reviewer:${t.id} (cloud)`;
    const at = now();
    const deleted = (): string => {
      const gone = deleteVerdictBranch(run, paths.root, c.branch, env);
      return gone ? ` (${c.branch} couldn't be deleted on origin: ${gone})` : '';
    };
    // A verdict acc can't read (T-86): the review fails, the task needs a person, and nothing waits on the branch any more.
    const fail = (reason: string): void => {
      mutate(paths, now, (l, emit) => {
        const x = l.tasks.find((y) => y.id === t.id);
        if (!x?.cloudReview) return;
        x.cloudReview = { ...x.cloudReview, failed: { at: at.toISOString(), reason } };
        x.updatedAt = at.toISOString();
        emit({ type: 'task.updated', task: t.id, actor: 'sync', by, data: { cloudReview: x.cloudReview } });
      });
      out.push({ task: t.id, branch: c.branch, outcome: 'bad', moved: null, note: `${reason}${deleted()}` });
    };
    // The file's size first (T-86): a verdict too large isn't read, and is said to be that, not missing.
    const size = run('git', ['cat-file', '-s', `${head}:${VERDICT_FILE}`], { cwd: paths.root });
    if (size.code !== 0) {
      fail(`its cloud reviewer pushed ${c.branch} without ${VERDICT_FILE}: review it on this Mac`);
      continue;
    }
    const bytes = Number(size.stdout.trim());
    if (!Number.isFinite(bytes) || bytes > VERDICT_MAX_BYTES) {
      fail(`its cloud reviewer's ${VERDICT_FILE} is ${Number.isFinite(bytes) ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : 'of a size git couldn\'t say'}, more than a verdict can be (${VERDICT_MAX_BYTES / 1024 / 1024} MB at most): review it on this Mac`);
      continue;
    }
    const shown = run('git', ['show', `${head}:${VERDICT_FILE}`], { cwd: paths.root });
    if (shown.code !== 0) {
      // Read-fails after the size passed: more than git show could hand over (ENOBUFS), else what git said, and never that the file was missing.
      const why = /ENOBUFS/.test(shown.stderr) ? 'too large to read' : (shown.stderr || shown.stdout).trim().split('\n')[0] || `git exited ${shown.code}`;
      fail(`its cloud reviewer's ${VERDICT_FILE} couldn't be read from ${c.branch} (${why}): review it on this Mac`);
      continue;
    }
    let answered: ReturnType<typeof checkVerdict>;
    try {
      answered = checkVerdict(JSON.parse(shown.stdout));
    } catch (e) {
      fail(`its cloud reviewer's ${VERDICT_FILE} isn't a verdict acc can read (${e instanceof SyntaxError ? 'not JSON' : (e as Error).message.replace(/\.$/, '')}): review it on this Mac`);
      continue;
    }
    // Its words to a person fail the wording check (T-149): a cloud reviewer can't be asked again, so nothing is kept.
    const wording = noteWording(verdictLines(answered));
    if (wording.length) {
      fail(`its cloud reviewer's words fail the Simplified Technical English check (${[...new Set(wording.map((f) => f.where))].join(', ')}): review it on this Mac`);
      continue;
    }
    const verdict: Verdict = {
      v: 1, task: t.id, sha: c.sha, env: t.environment, ...answered, sessionId: c.sessionId, name: sessionName({ project: config.project, key: t.id, title: t.title, role: 'review' }),
      at: at.toISOString(), durationMs: at.getTime() - Date.parse(c.firedAt), costUsd: null,
    };
    const current = run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${t.run?.branch ?? ''}`], { cwd: paths.root }).stdout.trim();
    const end = (data: Record<string, unknown>): void => mutate(paths, now, (l, emit) => {
      const x = l.tasks.find((y) => y.id === t.id);
      if (x?.cloudReview?.sha === c.sha) x.cloudReview = null;
      emit({ type: 'task.updated', task: t.id, actor: 'sync', by, data: { cloudReview: null, ...data } });
    });
    if (existsSync(reviewPath(paths, t.id, c.sha))) {
      // A verdict for the commit is here already: a person reviewed it on this Mac meanwhile, and that one stands.
      end({});
      out.push({ task: t.id, branch: c.branch, outcome: 'taken', moved: null, note: `a verdict for ${c.sha.slice(0, 7)} was already on this Mac, and it stands${deleted()}` });
    } else if (current !== c.sha) {
      // Stale (T-86): kept for its commit, as a local review of an older commit is, and the task stays where it is.
      keepVerdict(paths, verdict);
      end({ reviewed: { sha: c.sha, verdict: verdict.verdict, stale: true } });
      out.push({ task: t.id, branch: c.branch, outcome: 'stale', moved: null, note: `its cloud review ${verdict.verdict === 'pass' ? 'passed' : 'asked for changes'} on ${c.sha.slice(0, 7)}, but the branch is at ${current.slice(0, 7) || 'no commit'} now: the verdict is kept, and the task stays in review${deleted()}` });
    } else {
      const moved = recordVerdict(paths, config, verdict, now, { actor: 'reviewer', by, head: current });
      out.push({ task: t.id, branch: c.branch, outcome: 'taken', moved, note: `${verdict.verdict === 'pass' ? `its cloud review passed on ${c.sha.slice(0, 7)}` : `its cloud review asked for changes on ${c.sha.slice(0, 7)}${moved ? ', so it went to rework' : ''}`}: ${verdict.summary}${deleted()}` });
    }
  }
  return out;
}
