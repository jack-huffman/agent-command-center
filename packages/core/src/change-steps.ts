/**
 * Changes outside git at promotion (T-100, D-018): when a ticket's work is promoted to another environment,
 * each of its changes outside git becomes a step on that promotion, with the commands that make it, for a
 * person to review and run. Nothing makes them in another org by itself. A person marks each step done, or
 * skips it with a reason, and the ticket keeps that per environment.
 */
import type { Environment } from './config.ts';
import { AccError } from './exec.ts';
import { mutate, type Task } from './ledger.ts';
import { type OutsideChange, outsideOf, type OutsideStep, type Who, WHY_MAX } from './outside-changes.ts';
import { outsideKind } from './outside-kinds.ts';
import type { RepoPaths } from './paths.ts';
import { plural } from './text.ts';

/** A step as it's shown: the change in words, and the commands that make it in its environment's org. */
export interface StepView {
  step: OutsideStep;
  change: OutsideChange;
  words: string;
  script: string[];
}

/** A change in plain words, by its kind; one of a kind nobody registered says so. */
export const changeWords = (c: OutsideChange): string => outsideKind(c.kind)?.words(c.detail) ?? `A change of kind "${c.kind}"`;

/**
 * Adds a step to `env` for each of the task's changes outside git that has none there yet, so a promotion
 * made again adds nothing twice. Returns the steps it added.
 */
export function addPromotionSteps(t: Task, env: Pick<Environment, 'branch' | 'org'>, at: string): OutsideStep[] {
  const o = outsideOf(t);
  const added = o.changes.filter((c) => !o.steps.some((s) => s.change === c.id && s.env === env.branch))
    .map((c): OutsideStep => ({ change: c.id, env: env.branch, org: env.org, state: 'todo', reason: null, by: null, at: null, added: at }));
  if (!added.length) return [];
  o.steps.push(...added);
  t.outside = o;
  return added;
}

/** The task's steps, for one environment or all, each with its change in words and its commands. */
export function stepsOf(t: Pick<Task, 'outside'>, env?: string): StepView[] {
  const o = outsideOf(t);
  return o.steps.filter((s) => !env || s.env === env).flatMap((step) => {
    const change = o.changes.find((c) => c.id === step.change);
    if (!change) return [];
    return [{ step, change, words: changeWords(change), script: outsideKind(change.kind)?.script(change.detail, step.org) ?? [] }];
  });
}

/** The steps not done yet, for one environment or all. */
export const openSteps = (t: Pick<Task, 'outside'>, env?: string): StepView[] => stepsOf(t, env).filter((s) => s.step.state === 'todo');

/**
 * A person marks a step done, or skips it with a reason (T-100). A builder can't: the step is about another
 * org, which only a person changes.
 */
export function markStep(paths: RepoPaths, now: () => Date, id: string, changeId: string, env: string, outcome: { done: true } | { skip: string }, who: Who): OutsideStep {
  if (who.actor === 'builder') throw new AccError('refused', 'A person marks a promotion\'s steps: they make the change in another org.');
  const skip = 'skip' in outcome ? outcome.skip.trim() : null;
  if ('skip' in outcome && !skip) throw new AccError('usage', 'Say why it\'s skipped: --skip "<why>".');
  if (skip && skip.length > WHY_MAX) throw new AccError('usage', `Say why in at most ${WHY_MAX} characters.`);
  return mutate(paths, now, (ledger, emit) => {
    const t = ledger.tasks.find((x) => x.id === id);
    if (!t) throw new AccError('no-task', `No task ${id}.`);
    const o = outsideOf(t);
    const step = o.steps.find((s) => s.change === changeId && s.env === env);
    if (!step) {
      const there = [...new Set(o.steps.filter((s) => s.change === changeId).map((s) => s.env))];
      throw new AccError('usage', there.length ? `${changeId} has steps in ${there.join(', ')}, not ${env}.` : `${id} has no step for ${changeId}${o.steps.length ? '' : ': its work hasn\'t been promoted with any change outside git'}.`);
    }
    const at = now().toISOString();
    step.state = skip ? 'skipped' : 'done';
    step.reason = skip;
    step.by = who.by;
    step.at = at;
    t.outside = o;
    t.updatedAt = at;
    emit({ type: 'task.updated', task: t.id, actor: who.actor, by: who.by, data: { step: { change: changeId, env, state: step.state, reason: skip } } });
    return step;
  });
}

/** What a promotion's pull request says of the changes to make by hand in `env`, task by task. Nothing when there are none. */
export function stepsSection(tasks: Pick<Task, 'id' | 'outside'>[], env: Pick<Environment, 'branch' | 'name' | 'org'>): string[] {
  const each = tasks.map((t) => ({ t, steps: openSteps(t, env.branch) })).filter((x) => x.steps.length);
  if (!each.length) return [];
  const n = each.reduce((m, x) => m + x.steps.length, 0);
  return [
    `## Changes outside git to make by hand (${n})`,
    '',
    `Git doesn't carry these. Make each one in ${env.name}${env.org ? ` (\`${env.org}\`)` : ''} after this merges, then mark it done on its ticket, or skip it with a reason. Nothing makes them by itself.`,
    '',
    ...each.flatMap(({ t, steps }) => [`### ${t.id}`, '', ...steps.flatMap((s) => [`- ${s.words}. Why: ${s.change.why}`, ...(s.script.length ? ['', '  ```sh', ...s.script.map((l) => `  ${l}`), '  ```', ''] : [])])]),
  ];
}

/** That a task's promotion to `env` has steps not done, in words, or null. */
export function stepsLeftWords(t: Pick<Task, 'outside'>, env: string): string | null {
  const left = openSteps(t, env).length;
  return left ? `${plural(left, 'change')} outside git still to make in ${env}` : null;
}
