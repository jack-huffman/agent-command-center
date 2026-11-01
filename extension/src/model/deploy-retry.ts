/**
 * Retry with an agent on a ticket's page (T-174): a Salesforce ticket whose deploy to the development org failed, or
 * never ran, shows it on its Changes tab's development row and in a banner above its tabs. On, one click hands the
 * deploy back to the ticket's builder, in its own session and worktree; off, it says why: its builder still runs,
 * its worktree is gone, or there's nothing it can carry on. Plain data and the message's check: no vscode import.
 */

import type { Config } from '../../../packages/core/src/config.ts';
import { DEPLOY_RETRY_LABEL, deployRetryCase, deployRetryEnabled, deployRetryShown, type RetryTask } from '../../../packages/core/src/deploy-retry.ts';
import { oneLine } from '../../../packages/core/src/deploy-record.ts';
import { reasonInWords } from '../logic/relayed.ts';
import { KEY, type Look, type ModelArea, short } from './shared.ts';

/** Its banner's look: orange where the deploy failed, quiet where it never ran. */
export const RETRY_LOOK: Record<'failed' | 'never', Look> = {
  failed: { label: 'Deploy failed', icon: 'warning', tone: 'orange' },
  never: { label: 'Not deployed', icon: 'circle-large-outline', tone: 'neutral' },
};

/** The action, as the development row and the banner draw it. */
export interface DeployRetry {
  task: string;
  label: string;
  /** The development environment's name, and its branch: the Changes tab's row it shows on. */
  env: string;
  branch: string;
  look: Look;
  /** What went wrong, on one line, in process words: why the deploy failed, or that it never ran. */
  failure: string;
  /** Why it's off, or null when a click starts it. */
  disabled: string | null;
  /** A click is on its way: the button waits, and says so. */
  retrying: boolean;
  /** Why the last click didn't start it, in process words; null when it did, or before one. */
  error: string | null;
}

export interface DeployRetryIn {
  config: Pick<Config, 'profile' | 'environments'>;
  task: RetryTask;
  /** Its builder's session is at work, or a resume of it runs. */
  runs: boolean;
  /** Its worktree is on disk. */
  worktree: boolean;
  /** A retry of it, from this window, is on its way. */
  retrying?: boolean;
  /** Why this window's last retry of it didn't start, as acc said it. */
  error?: string | null;
}

/** The action for the ticket, or null where it doesn't show: no failed or missing deploy to retry, or a builder still at its work. */
export function deployRetry(i: DeployRetryIn): DeployRetry | null {
  if (!deployRetryShown(i)) return null;
  const c = deployRetryCase(i.config, i.task)!;
  const can = deployRetryEnabled(i);
  const retrying = !!i.retrying;
  return {
    task: i.task.id, label: DEPLOY_RETRY_LABEL, env: c.env.name, branch: c.env.branch,
    look: RETRY_LOOK[c.failure ? 'failed' : 'never'],
    failure: c.failure ? reasonInWords(oneLine(c.failure.reason)) : `It never deployed to ${c.env.name}: its builder stopped first.`,
    disabled: retrying ? 'Its builder is starting again.' : can.ok ? null : reasonInWords(can.why),
    retrying,
    error: i.error ? reasonInWords(i.error) : null,
  };
}

/** acc's words for it: the retry of the deploy, which acc runs as a resume of the builder. */
export const retryArgs = (id: string): string[] => ['resume', id, '--deploy'];

export type Message =
  /** Retry with an agent (T-174): the ticket's builder carries on, told to deploy again. */
  | { type: 'deploy-retry'; project: string; task: string };

export const area: ModelArea = {
  messages: {
    'deploy-retry': (x) => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string),
  },
};
