/**
 * Checking a group of finished tasks together (T-165), as the Board shows it: In review's Check together (n), on
 * or off with its reason, what the group check is doing while it runs, and on each task its latest step. Plain
 * data, with no vscode import, so it's testable.
 */
import type { Environment } from '../../../packages/core/src/config.ts';
import { GROUP_CHECK_COMMAND, listWords } from '../../../packages/core/src/group-check.ts';
import type { GroupMark, GroupOutcome } from '../../../packages/core/src/ledger.ts';
import { inProcessWords } from '../logic/processes.ts';
import type { TaskRow } from '../logic/shared.ts';
import type { Action, Look, ModelArea } from './shared.ts';

/** How each step of a group check shows on its task: orange for what needs a builder or a person, else blue. */
export const GROUP_LOOK: Record<GroupOutcome, Look> = {
  checking: { label: 'Checking with the group', icon: 'sync~spin', tone: 'blue' },
  passed: { label: 'Group check passed', icon: 'pass', tone: 'blue' },
  failed: { label: 'Group check failed', icon: 'warning', tone: 'orange' },
  merged: { label: 'Merged with the group', icon: 'git-merge', tone: 'blue' },
  'sent-back': { label: 'Sent back from the group check', icon: 'debug-restart', tone: 'orange' },
  'left-out': { label: 'Left out of the group check', icon: 'circle-slash', tone: 'orange' },
  together: { label: 'Fails only with the group', icon: 'bell', tone: 'orange' },
  'needs-you': { label: 'Needs you', icon: 'bell', tone: 'orange' },
};

/** A step on its task, in its own words, in process words (D-132). */
export const groupLook = (m: Pick<GroupMark, 'outcome' | 'words'>): Look => ({ ...GROUP_LOOK[m.outcome], label: inProcessWords(m.words) });

/** The task's latest step of a group check, or null when it was never in one. */
export const lastGroupLook = (row: Pick<TaskRow, 'groupChecks'>): Look | null => {
  const m = row.groupChecks?.at(-1);
  return m ? groupLook(m) : null;
};

/** In review's Check together for one environment: its button, on or off with why, and the group's step while one runs. */
export interface Together {
  env: string;
  action: Action;
  progress: Look | null;
}

/** Whether a task's review passed on its latest commit, so it may join a group check. */
export const readyForGroup = (r: Pick<TaskRow, 'state' | 'review'>): boolean => r.state === 'review' && r.review?.verdict === 'pass' && !!r.review.current;

/**
 * Check together for each environment a task in review goes to: the count of tasks ready, and the command's
 * own enabled rule, so the button is off with the same reason acc would give. A group under way shows its step.
 */
export function togetherFor(project: string, config: { environments: Environment[] }, rows: TaskRow[]): Together[] {
  const envs = [...new Set(rows.filter((r) => r.state === 'review').map((r) => r.environment))];
  return envs.map((env) => {
    const n = rows.filter((r) => r.environment === env && readyForGroup(r)).length;
    const live = rows.filter((r) => r.environment === env && r.groupChecks?.at(-1)?.outcome === 'checking');
    const can = GROUP_CHECK_COMMAND.enabled({ config, env, ready: n, running: live.length > 0 });
    const name = config.environments.find((e) => e.branch === env)?.name ?? env;
    const action: Action = {
      command: GROUP_CHECK_COMMAND.id, label: `Check together (${n})`, icon: 'checklist', ref: { project, env },
      ...(can.ok ? {} : { disabled: can.why }),
    };
    const progress: Look | null = live.length ? { label: `Checking ${listWords(live.map((r) => r.id))} together for ${name}: running the full check`, icon: 'sync~spin', tone: 'blue' } : null;
    return { env, action, progress };
  });
}

export const area: ModelArea = {
  commands: [GROUP_CHECK_COMMAND.id],
};
