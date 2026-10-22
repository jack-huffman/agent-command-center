import { type DispatchDeps, type DispatchOptions, type DispatchOutcome, dispatch } from './dispatch.ts';
import { AccError } from './exec.ts';
import { type Config } from './config.ts';
import { moveTask, noGateHooks, readLedger } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { endResume } from './resume.ts';
import { DISPATCH_AGAIN, MISSING_WORDS, type Unseen } from './started.ts';

/** Why a running task is dispatched again when no reason is given: acc couldn't see its builder (T-92). */
export const AGAIN_REASON = 'Claude Code\'s background sessions weren\'t answering, so acc couldn\'t see its builder';

/** Why a running builder acc can see isn't dispatched again (T-93): stopping it would end work that is going on. */
export const againRefusal = (id: string): string => `${id}'s builder is working where the Command Center can see it, so ${DISPATCH_AGAIN} would stop work that's going on. It is for a builder that didn't start, or one the Command Center can't see.`;

/**
 * Dispatch again (T-92), a person's, in one step: a task whose builder didn't start is dispatched with the
 * model, effort and place it was dispatched with. A running one whose builder acc can't see (`opts.unseen`, from builderUnseen; any other is refused, T-93) is first
 * set back to To do, its background session stopped where it's listed and any resume ended, then dispatched
 * with its run's place; its run keeps a picked model and effort (D-086, D-128). Both moves carry the reason
 * in its History. With no `claude` to start one (`opts.unseen` is 'missing'), it is refused (T-94).
 */
export function dispatchAgain(paths: RepoPaths, config: Config, id: string, deps: DispatchDeps, opts: Pick<DispatchOptions, 'actor' | 'by'> & { reason?: string; unseen?: Unseen | null }): DispatchOutcome {
  if (opts.actor !== 'human') throw new AccError('refused', `${DISPATCH_AGAIN} is a person's: it sets a running task back.`);
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  // No `claude` to start a builder with (T-94): refused, in the words the Command Center shows.
  if (opts.unseen === 'missing') throw new AccError('refused', MISSING_WORDS);
  const why = opts.reason?.trim() || (task.notStarted ? task.notStarted.reason : AGAIN_REASON);
  const reason = `Dispatched again: ${why}`;
  const base = { actor: opts.actor, by: opts.by, reason };
  if (task.notStarted) {
    const n = task.notStarted;
    return dispatch(paths, config, id, deps, { ...base, where: n.where, ...(n.model ? { model: n.model } : {}), ...(n.effort ? { effort: n.effort } : {}) });
  }
  if (task.state !== 'running') throw new AccError('refused', `${id} is ${task.state}, and its builder didn't fail to start: dispatch it as usual.`);
  if (task.run?.where === 'cloud') throw new AccError('refused', `${id}'s builder runs in the cloud: its branch says whether it's quiet, and ${DISPATCH_AGAIN} is for a builder on this Mac.`);
  if (!opts.unseen) throw new AccError('refused', againRefusal(id));
  if (task.run?.bgId) deps.run('claude', ['stop', task.run.bgId], { cwd: task.run.worktree ?? paths.root, timeoutMs: 20_000 });
  endResume(paths, id);
  moveTask(paths, config, id, { to: 'todo', actor: opts.actor, by: opts.by, reason }, noGateHooks, deps.now);
  return dispatch(paths, config, id, deps, { ...base, where: 'local' });
}
