// The effort levels each model takes, and the effort a task's builder starts with (D-128).

import { AccError } from './exec.ts';
import { type Config, EFFORTS, type Effort } from './config.ts';
import type { Task } from './ledger.ts';

/**
 * Where acc's list of each model's levels came from, and when it was read. Anthropic's effort guide names
 * the models that take `max` and `xhigh`, and each model's default; acc copies it here rather than asking
 * at run time, so a newer model is an acc release, as a newer default model is (D-086).
 */
export const EFFORT_SOURCE = { url: 'https://platform.claude.com/docs/en/build-with-claude/effort', read: '2026-10-09' } as const;

const ALL: readonly Effort[] = EFFORTS;
const NO_XHIGH: readonly Effort[] = ['low', 'medium', 'high', 'max'];

/**
 * Each model's levels and its default, from EFFORT_SOURCE. Not every model that takes `max` takes `xhigh`.
 * Claude Haiku 4.5 takes no level at all. A model not listed, such as an alias (`opus`) or a name acc
 * doesn't know yet, isn't checked: Claude Code decides.
 */
export const MODEL_EFFORTS: Readonly<Record<string, { levels: readonly Effort[]; default: Effort | null }>> = {
  'claude-fable-5-1': { levels: ALL, default: 'high' },
  'claude-mythos-5-1': { levels: ALL, default: 'high' },
  'claude-fable-5': { levels: ALL, default: 'high' },
  'claude-mythos-5': { levels: ALL, default: 'high' },
  'claude-mythos-preview': { levels: NO_XHIGH, default: 'high' },
  'claude-opus-5-5': { levels: ALL, default: 'medium' },
  'claude-opus-5': { levels: ALL, default: 'high' },
  'claude-opus-4-8': { levels: ALL, default: 'high' },
  'claude-opus-4-7': { levels: ALL, default: 'high' },
  'claude-opus-4-6': { levels: NO_XHIGH, default: 'high' },
  'claude-opus-4-5': { levels: ['low', 'medium', 'high'], default: 'high' },
  'claude-sonnet-5-5': { levels: ALL, default: 'high' },
  'claude-sonnet-5': { levels: ALL, default: 'high' },
  'claude-sonnet-4-6': { levels: NO_XHIGH, default: 'high' },
  'claude-haiku-5-5': { levels: ALL, default: 'medium' },
  'claude-haiku-4-5': { levels: [], default: null },
};

/** A model's levels and default, by its name without a date (`-20251001`) or a context suffix (`[1m]`), or null when acc doesn't know it. */
export function modelEfforts(model: string): { levels: readonly Effort[]; default: Effort | null } | null {
  const base = model.replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
  return Object.hasOwn(MODEL_EFFORTS, base) ? MODEL_EFFORTS[base]! : null;
}

/** Where the list came from, in words, for a refusal. */
export const effortSourceWords = (): string => `acc's list of each model's levels is from ${EFFORT_SOURCE.url}, read ${EFFORT_SOURCE.read}`;

/** Refuses what isn't an effort level, before anything is set or started with it. */
export function checkEffortName(v: string, also = ''): asserts v is Effort {
  if (!(EFFORTS as readonly string[]).includes(v)) throw new AccError('usage', `"${v}" isn't an effort level. Effort is one of ${EFFORTS.join(', ')}${also}.`);
}

/**
 * What acc dispatch --effort takes (D-128): a level, or `default`, which drops the level picked for the task
 * so the builder's own (the clone's or the project's) applies again.
 */
export type EffortPick = Effort | 'default';

/** Refuses what isn't a level or `default`, before anything is started with it. */
export function checkEffortPick(v: string): asserts v is EffortPick {
  // The same check as acc agents set's, with default beside the levels, so the two can't drift apart.
  if (v !== 'default') checkEffortName(v, ', or default for the builder\'s own');
}

/** Whether the model takes the level: true for one acc doesn't know, which isn't checked. */
export const modelTakes = (model: string, effort: Effort): boolean => modelEfforts(model)?.levels.includes(effort) ?? true;

/**
 * Refuses an effort the model doesn't take, in words, with the levels it does and where acc's list came
 * from. A model acc doesn't know isn't refused. `fix`, when given, says where the effort is set and how to
 * change it (effortFixWords), so a pair that no longer fits is refused in acc's words, not Claude Code's.
 */
export function checkModelEffort(model: string, effort: Effort | null, fix?: string): void {
  if (!effort || modelTakes(model, effort)) return;
  const m = modelEfforts(model)!;
  const takes = m.levels.length ? `It takes ${m.levels.join(', ')}.` : 'It takes no effort level: leave effort unset for it.';
  throw new AccError('usage', `${model} doesn't take effort ${effort}. ${takes}${fix ? ` ${fix}` : ''} (${effortSourceWords()}.)`);
}

/**
 * Where a builder's effort is set and how to change it, for a refusal: the task's own pick, or the builder's
 * own. A resume can't pick again, so a pick that meets a model changed since is put right in acc agents.
 */
export function effortFixWords(id: string, picked: boolean, model: string, on: 'dispatch' | 'resume' = 'dispatch'): string {
  const another = (modelEfforts(model)?.levels.length ?? 1) > 0;
  if (on === 'resume') {
    return picked
      ? `It was picked for ${id}, and the builder's model has changed since: set it back with acc agents set builder --model <m>.`
      : `It's the builder's own: change it with acc agents set builder ${another ? '--effort <level> or ' : ''}--clear effort.`;
  }
  return picked
    ? `It was picked for ${id}: ${another ? `pick another with acc dispatch ${id} --effort <level>, or ` : ''}drop it with acc dispatch ${id} --effort default.`
    : `It's the builder's own: ${another ? `pick one for ${id} with acc dispatch ${id} --effort <level>, or ` : ''}clear it with acc agents set builder --clear effort.`;
}

/**
 * The effort a task's builder starts with (D-128): one picked for it now, else one picked on an earlier
 * dispatch, else the builder's own (the clone's or the project's), or null for Claude Code's default.
 * `picked` says it was a person's choice for this task, so the run keeps it. `default` picks none.
 */
export function builderEffort(task: Pick<Task, 'run'>, config: Config, chosen?: EffortPick): { effort: Effort | null; picked: boolean } {
  const picked = chosen ?? (task.run?.effortPicked ? task.run.effort : undefined);
  return picked && picked !== 'default' ? { effort: picked, picked: true } : { effort: config.agents.builder.effort, picked: false };
}

/** That a level picked for a task was dropped for a model that doesn't take it: acc dispatch and Dispatch with… say it alike. */
export const effortDroppedWords = (effort: string, model: string): string => `Its effort ${effort}, picked for it before, was dropped: ${model} doesn't take it. The builder's own applies.`;

/**
 * The effort a dispatch starts a task's builder with, and what its hold keeps (D-128): the level picked
 * now, or `default` to drop a pick, else the task's earlier pick, held or on its run. A model picked now
 * that doesn't take the earlier pick drops it, and `dropped` says which it was, so acc can say so; the
 * builder's own applies instead. The caller checks what results against the model.
 */
export function dispatchEffort(task: Pick<Task, 'run' | 'held'>, config: Config, model: string, opts: { effort?: EffortPick; modelPicked: boolean }): { effort: Effort | null; picked: boolean; keep: EffortPick | undefined; dropped: Effort | null } {
  const earlier = task.held?.effort ?? (task.run?.effortPicked ? task.run.effort : undefined);
  if (opts.effort === undefined && earlier && earlier !== 'default' && opts.modelPicked && !modelTakes(model, earlier)) {
    return { ...builderEffort(task, config, 'default'), keep: 'default', dropped: earlier };
  }
  const keep = opts.effort ?? earlier;
  return { ...builderEffort(task, config, keep ?? 'default'), keep, dropped: null };
}
