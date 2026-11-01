/**
 * Retry with an agent (T-174): a Salesforce ticket whose builder's deploy to the development org failed, or never
 * ran, is handed back to its builder in one step. Its own session carries on in its worktree (resume, D-067), told
 * which deploy failed and why, to deploy again and read the result: it fixes what its own work broke, until the
 * deploy and the coverage floor pass (D-238), and blocks with options on a failure outside its work (a login, a
 * lock, an org that is down), changing no code to get round it. A blocked task, or one in review, goes back to
 * running as it carries on; it finishes with acc done, so a retry that changed no code merges on the review it had,
 * and one that changed code is reviewed again before autopilot merges it (D-244's merge asks for both).
 */
import { existsSync } from 'node:fs';
import type { Config, Environment } from './config.ts';
import { environmentByBranch } from './config.ts';
import { envRecord, oneLine, type TaskDeployFailure } from './deploy-record.ts';
import { AccError } from './exec.ts';
import { type Actor, type ClaudeSession, DONE_COMMAND, readLedger, sessionActive, sessionsOf, type Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { listSessions, resume, RESUME_MOVES_FROM, type ResumeDeps, type ResumeResult, resuming } from './resume.ts';
import type { TaskCommand } from './task-deploy.ts';

/** The action's label, on the development row, on the banner and in the CLI's words. */
export const DEPLOY_RETRY_LABEL = 'Retry with an agent';

/** The task's fields the retry reads. */
export type RetryTask = Pick<Task, 'id' | 'title' | 'state' | 'environment' | 'deploys' | 'deployFailures' | 'promotions' | 'pr' | 'run'>;

/** What a retry is for: the development environment, and its failed deploy, or null for a deploy that never ran. */
export interface DeployRetryCase {
  env: Environment;
  failure: TaskDeployFailure | null;
}

/**
 * What the retry is for, or null when there's nothing to retry: a Salesforce task with work on its branch, running,
 * blocked or in review, whose pull request hasn't merged, and whose own environment's row by acc's record (T-167)
 * says its deploy failed, or that nothing deployed there.
 */
export function deployRetryCase(config: Pick<Config, 'profile' | 'environments'>, t: RetryTask | undefined): DeployRetryCase | null {
  if (config.profile !== 'salesforce' || !t || !t.run?.branch || t.pr?.state === 'merged') return null;
  if (t.state !== 'running' && !RESUME_MOVES_FROM.includes(t.state)) return null;
  const env = environmentByBranch(config, t.environment);
  if (!env) return null;
  const rec = envRecord(t, env.branch);
  if (rec.state === 'failed') {
    const failure = (t.deployFailures ?? []).filter((f) => f.env === env.branch).sort((a, b) => a.at.localeCompare(b.at)).at(-1) ?? null;
    return { env, failure };
  }
  return rec.state === 'not-deployed' ? { env, failure: null } : null;
}

/** What the action needs to know beyond the task: whether its builder still works, and whether its worktree is on disk. */
export interface DeployRetryState {
  config: Pick<Config, 'profile' | 'environments'>;
  task: RetryTask | undefined;
  /** Its builder's session is at work, or a resume of it runs. */
  runs: boolean;
  /** Its worktree is on disk. */
  worktree: boolean;
}

/**
 * Whether Retry with an agent shows: where there's something to retry, and not for a deploy that never ran while
 * its builder still works, since that builder hasn't got to its deploy yet. A failed deploy shows it, off, while the
 * builder runs.
 */
export function deployRetryShown(s: Pick<DeployRetryState, 'config' | 'task' | 'runs'>): boolean {
  const c = deployRetryCase(s.config, s.task);
  return !!c && !(c.failure === null && s.runs);
}

/** Why Retry with an agent can't run now, or that it can. */
export function deployRetryEnabled(s: DeployRetryState): { ok: true } | { ok: false; why: string } {
  const { config, task: t } = s;
  if (config.profile !== 'salesforce') return { ok: false, why: 'A retry deploys Salesforce components to the development org, and this isn\'t a Salesforce project.' };
  if (!t) return { ok: false, why: 'There\'s no such task.' };
  if (!deployRetryCase(config, t)) {
    const env = environmentByBranch(config, t.environment);
    const rec = env ? envRecord(t, env.branch) : null;
    const why = !t.run?.branch ? `${t.id} has no work yet: build it first.`
      : t.pr?.state === 'merged' ? `${t.id} has merged into ${t.environment} already.`
        : t.state !== 'running' && !RESUME_MOVES_FROM.includes(t.state) ? `${t.id} is ${t.state === 'rework' ? 'sent back for changes' : t.state}: a retry carries on a builder that is running, blocked or in review.`
          : !env ? `${t.id}'s environment, ${t.environment}, isn't in the project's settings.`
            : rec?.state === 'deployed' ? `Its deploy to ${env.name} passed: there's nothing to retry.`
              : `There's no failed deploy to ${env.name} to retry.`;
    return { ok: false, why };
  }
  if (s.runs) return { ok: false, why: `${t.id}'s builder is still working on it. Wait for it to finish or block.` };
  if (t.run?.where === 'cloud') return { ok: false, why: `${t.id}'s builder runs in the cloud: answer it on its page on claude.ai.` };
  if (!t.run?.worktree || !s.worktree) return { ok: false, why: `${t.id}'s worktree isn't on disk any more, so its builder has nowhere to carry on. Dispatch it again.` };
  if (!t.run.sessionId) return { ok: false, why: `${t.id}'s builder has no conversation to carry on. Dispatch it again.` };
  return { ok: true };
}

/** Retry with an agent: the CLI's and the extension's. */
export const DEPLOY_RETRY_COMMAND: TaskCommand<DeployRetryState> = {
  id: 'acc.task.retryDeploy',
  params: 'The task\'s id. Its builder carries on in its own session and worktree, told which deploy to the development org failed and why, or that it never deployed, to deploy again until the deploy and the coverage floor pass, or to block on a failure outside its work.',
  enabled: (s) => deployRetryEnabled(s),
};

/** Whether the task's builder works now: one of its sessions is at work, or a resume of it runs. */
export const builderRuns = (t: Pick<Task, 'id' | 'run'>, sessions: readonly ClaudeSession[], resumingNow: boolean): boolean =>
  resumingNow || sessionsOf(t, [...sessions]).some(sessionActive);

/** The failed deploy in one line: where, when, and why. */
export function failureLine(c: DeployRetryCase): string {
  const where = `${c.env.name}${c.env.org ? ` (${c.env.org})` : ''}`;
  if (!c.failure) return `You stopped before you deployed to ${where}.`;
  return `Your deploy to ${where} failed at ${c.failure.at.slice(0, 16).replace('T', ' ')} UTC: ${oneLine(c.failure.reason)}`;
}

/** What the builder is told: which deploy failed and why, deploy again, fix only its own work, and block on anything else. */
export function deployRetryMessage(t: Pick<Task, 'id' | 'title'>, c: DeployRetryCase): string {
  return [
    `You are the builder for ${t.id}: ${t.title}. A person asked you to retry your deploy to the development org.`,
    '',
    failureLine(c),
    '',
    `Start with \`git status\` and \`git log --oneline -3\`. Then deploy again and read the result: run \`acc gate run deploy\`, with one \`--test <TestClass>="<why it covers the change>"\` for each Apex test class, as before.`,
    '',
    '- **A failure in your own work** (a component that doesn\'t deploy, a test of yours that fails, a changed class under the coverage floor): fix it, commit, and deploy again. Keep going until the deploy passes and each changed Apex class reaches the coverage floor.',
    '- **A failure outside your work** (an expired login, a lock on the org, an org that is down, a test another person broke): change no code to get round it. Say so in a blocked note with options, and stop: `acc block "<what failed, in one sentence>" --item "<the failure, as the deploy said it>" --item "<the options: a) b) c), with (recommended) on one>"`.',
    '',
    `When the deploy passes, finish as before: commit everything, run exactly \`acc gate run\`, then finish with your note, all on one line: \`${DONE_COMMAND}\`.`,
  ].join('\n');
}

/** The reason in the task's History when the retry moves it back to running. */
export const retryReason = (c: DeployRetryCase): string =>
  (c.failure ? `Retry the deploy to ${c.env.name} with an agent: ${oneLine(c.failure.reason)}` : `Retry the deploy to ${c.env.name} with an agent: it never deployed`);

export interface DeployRetryResult extends ResumeResult {
  case: DeployRetryCase;
}

/**
 * Retry with an agent: refused, with the command's reason, unless it can run now. Its builder's session carries
 * on in its worktree with the retry's message; a blocked task, or one in review, moves back to running as it does.
 */
export function retryDeploy(paths: RepoPaths, config: Config, id: string, deps: ResumeDeps, opts: { actor: Actor; by: string }): DeployRetryResult {
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  const sessions = config.profile === 'salesforce' && task.run?.sessionId ? listSessions(deps.run, paths.root) : [];
  if (!sessions) throw new AccError('refused', `claude agents didn't answer, so acc can't tell whether ${id}'s builder is still at work. Try again in a moment.`);
  const can = deployRetryEnabled({ config, task, runs: builderRuns(task, sessions, !!resuming(paths, id)), worktree: !!task.run?.worktree && existsSync(task.run.worktree) });
  if (!can.ok) throw new AccError('refused', `${DEPLOY_RETRY_LABEL} can't run for ${id}: ${can.why}`);
  const c = deployRetryCase(config, task)!;
  const r = resume(paths, config, id, deps, { ...opts, message: deployRetryMessage(task, c), ...(task.state === 'running' ? {} : { move: { reason: retryReason(c) } }) });
  return { ...r, case: c };
}
