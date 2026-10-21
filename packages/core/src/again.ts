import { type DispatchDeps, type DispatchOptions, type DispatchOutcome, dispatch } from './dispatch.ts';
import { AccError } from './exec.ts';
import { type Config } from './config.ts';
import { moveTask, noGateHooks, readLedger } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { endResume } from './resume.ts';
import { DISPATCH_AGAIN } from './started.ts';

/** Why a running task is dispatched again when no reason is given: acc couldn't see its builder (T-92). */
export const AGAIN_REASON = 'Claude Code\'s background sessions weren\'t answering, so acc couldn\'t see its builder';

/**
 * Dispatch again (T-92), a person's, in one step: a task whose builder didn't start is dispatched with the
 * model, effort and place it was dispatched with. A running one whose builder acc can't see is first set
 * back to To do, its background session stopped where it's listed and any resume ended, then dispatched
 * with its run's place; its run keeps a picked model and effort (D-086, D-128). Both moves carry the reason
 * in its History.
 */
export function dispatchAgain(paths: RepoPaths, config: Config, id: string, deps: DispatchDeps, opts: Pick<DispatchOptions, 'actor' | 'by'> & { reason?: string }): DispatchOutcome {
  if (opts.actor !== 'human') throw new AccError('refused', `${DISPATCH_AGAIN} is a person's: it sets a running task back.`);
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  const why = opts.reason?.trim() || (task.notStarted ? task.notStarted.reason : AGAIN_REASON);
  const reason = `Dispatched again: ${why}`;
  const base = { actor: opts.actor, by: opts.by, reason };
  if (task.notStarted) {
    const n = task.notStarted;
    return dispatch(paths, config, id, deps, { ...base, where: n.where, ...(n.model ? { model: n.model } : {}), ...(n.effort ? { effort: n.effort } : {}) });
  }
  if (task.state !== 'running') throw new AccError('refused', `${id} is ${task.state}, and its builder didn't fail to start: dispatch it as usual.`);
  if (task.run?.where === 'cloud') throw new AccError('refused', `${id}'s builder runs in the cloud: its branch says whether it's quiet, and ${DISPATCH_AGAIN} is for a builder on this Mac.`);
  if (task.run?.bgId) deps.run('claude', ['stop', task.run.bgId], { cwd: task.run.worktree ?? paths.root, timeoutMs: 20_000 });
  endResume(paths, id);
  moveTask(paths, config, id, { to: 'todo', actor: opts.actor, by: opts.by, reason }, noGateHooks, deps.now);
  return dispatch(paths, config, id, deps, { ...base, where: 'local' });
}
