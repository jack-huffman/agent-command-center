// The effort levels each model takes, and the effort a task's builder starts with (D-???).

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

/** Where the list came from, in words, for a refusal and for acc show. */
export const effortSourceWords = (): string => `acc's list of each model's levels is from ${EFFORT_SOURCE.url}, read ${EFFORT_SOURCE.read}`;

/** Refuses what isn't an effort level, before anything is set or started with it. */
export function checkEffortName(v: string): asserts v is Effort {
  if (!(EFFORTS as readonly string[]).includes(v)) throw new AccError('usage', `"${v}" isn't an effort level. Effort is one of ${EFFORTS.join(', ')}.`);
}

/**
 * Refuses an effort the model doesn't take, in words, with the levels it does and where acc's list came
 * from. A model acc doesn't know isn't refused.
 */
export function checkModelEffort(model: string, effort: Effort | null): void {
  if (!effort) return;
  const m = modelEfforts(model);
  if (!m || m.levels.includes(effort)) return;
  const takes = m.levels.length ? `It takes ${m.levels.join(', ')}.` : 'It takes no effort level: leave effort unset for it.';
  throw new AccError('usage', `${model} doesn't take effort ${effort}. ${takes} (${effortSourceWords()}.)`);
}

/**
 * The effort a task's builder starts with (D-???): one picked for it now, else one picked on an earlier
 * dispatch, else the builder's own (the clone's or the project's), or null for Claude Code's default.
 * `picked` says it was a person's choice for this task, so the run keeps it.
 */
export function builderEffort(task: Pick<Task, 'run'>, config: Config, chosen?: Effort): { effort: Effort | null; picked: boolean } {
  const picked = chosen ?? (task.run?.effortPicked ? task.run.effort : undefined);
  return picked ? { effort: picked, picked: true } : { effort: config.agents.builder.effort, picked: false };
}
