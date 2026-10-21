import { type Config } from './config.ts';
import { type ClaudeSession, readLedger, runStartedAt, type Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { askAgents, listSessions, resuming } from './resume.ts';
import { claudeProjectsDir } from './transcript.ts';
import { builderUnseen, noteAnswer, quietMs, transcriptWrittenAt, type Silent, type Unseen } from './started.ts';
import type { Runner } from './exec.ts';

/**
 * Whether acc can't see a task's builder, asked just now (T-93): the look `acc show` takes, for Dispatch again
 * to judge by. `claude agents` is asked; an answer clears the clock, none starts it, and `since` (a clock
 * the caller has kept, such as the Command Center's) counts where it began earlier. A caller that asked
 * already, as `acc show` does, passes its `sessions` (T-94), so it isn't asked twice. Null for a task not
 * running, and when `claude agents` answers.
 */
export function unseenNow(paths: RepoPaths, config: Config, task: Task, deps: { run: Runner; now: () => Date; env?: NodeJS.ProcessEnv }, since?: number | null, asked?: ClaudeSession[] | null): Silent | null {
  if (task.state !== 'running' || task.run?.where === 'cloud') return null;
  const now = deps.now();
  const sessions = asked !== undefined ? asked : listSessions(deps.run, paths.root);
  const noted = noteAnswer(paths, sessions !== null, now);
  const silentSince = sessions !== null ? null : since != null && noted !== null ? Math.min(since, noted) : noted;
  const resumed = !!resuming(paths, task.id);
  return unseenFrom(task, config, { silentSince, now, resuming: resumed, env: deps.env });
}

/**
 * builderUnseen for a task, reading its conversation as the Command Center, `acc show` and Dispatch again all
 * do (T-93): only what was written since this run began counts, never an earlier run's in a worktree that
 * was reused. Its conversation is read only while `claude agents` is silent.
 */
export function unseenFrom(task: Task, config: Config | null | undefined, o: { silentSince: number | null; now: Date; resuming: boolean; env?: NodeJS.ProcessEnv }): Silent | null {
  const written = o.silentSince !== null ? runWrittenAt(task, o.env) : null;
  return builderUnseen(task, { silentSince: o.silentSince, now: o.now, resuming: o.resuming, writtenAt: written, quietMs: quietMs(config) });
}

/**
 * The same, for a task by its id, for Dispatch again: or 'missing' when there is no `claude` to ask (T-94),
 * since no builder can start then. Only a task Dispatch again would start a builder on this Mac for asks:
 * one running here, or one whose builder didn't start here. Null for any other, and for no such task.
 */
export const unseenOf = (paths: RepoPaths, config: Config, id: string, deps: Parameters<typeof unseenNow>[3], since?: number | null): Unseen | null => {
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  const here = task?.notStarted ? task.notStarted.where !== 'cloud' : task?.state === 'running' && task.run?.where !== 'cloud';
  if (!task || !here) return null;
  const asked = askAgents(deps.run, paths.root);
  if (asked.missing) return 'missing';
  return unseenNow(paths, config, task, deps, since, asked.sessions);
};

/** When this run's conversation was last written (T-93): not before the run began, so an earlier run's in a reused worktree doesn't count. Null when there's none. */
export function runWrittenAt(task: Task, env?: NodeJS.ProcessEnv): number | null {
  if (!task.run?.worktree) return null;
  return transcriptWrittenAt(claudeProjectsDir(env), { worktree: task.run.worktree, sessionId: task.run.sessionId, since: Date.parse(runStartedAt(task) ?? '') || 0 });
}
