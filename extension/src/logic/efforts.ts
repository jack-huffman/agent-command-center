/**
 * A builder's effort (D-???): what Dispatch with… offers beside the model, the arguments it gives acc
 * dispatch, and when a page shows an effort. Like the rest of logic/, no `vscode` import.
 */

import { EFFORTS, type Effort } from '../../../packages/core/src/config.ts';
import { modelEfforts } from '../../../packages/core/src/efforts.ts';
import { FROM_WORDS } from './agents.ts';
import type { TaskRow } from './shared.ts';

/** Each level in words: Dispatch with… and How agents run's Change… say them alike. */
export const EFFORT_WORDS: Record<Effort, string> = {
  low: 'Quickest, the least thinking',
  medium: 'Balanced',
  high: 'Thinks it through',
  xhigh: 'Thinks hard: long agentic coding',
  max: 'The most thinking: slowest, uses the most',
};

export interface EffortItem {
  label: string;
  description: string;
  /** The level, or null for none named, so Claude Code's default applies. */
  value: Effort | null;
}

/** Where a builder's effort comes from, as How agents run's Change… knows it. */
export interface BuilderEffort {
  effort: string | null;
  from: { effort: string };
}

/** The effort a task's builder would run with anyway, and where it's set: picked for the task, else the builder's own. */
function effortNow(row: Pick<TaskRow, 'run'>, builder: BuilderEffort): { effort: string | null; from: string } {
  return row.run?.effortPicked && row.run.effort ? { effort: row.run.effort, from: 'task' } : { effort: builder.effort, from: builder.from.effort };
}

/**
 * What Dispatch with… offers once a model is chosen (D-???): the effort the builder would run with anyway
 * first, saying where it's set in FROM_WORDS' words, as the model's choice does, then each other level the
 * model takes, with its words; the model's default says so. None set reads as the model's default, which
 * Claude Code applies. Only the levels the model takes are offered: every level for a model acc doesn't
 * know, and nothing for one that takes none, so the step is skipped.
 */
export function dispatchEffortItems(row: Pick<TaskRow, 'run'>, builder: BuilderEffort, model: string): EffortItem[] {
  const known = modelEfforts(model);
  const levels: readonly Effort[] = known ? known.levels : EFFORTS;
  if (!levels.length) return [];
  const now = effortNow(row, builder);
  const isDefault = (e: Effort) => known?.default === e;
  const about = (e: Effort) => `${EFFORT_WORDS[e]}${isDefault(e) ? ' · the model\'s default' : ''}`;
  const first: EffortItem | null = now.effort === null
    ? { label: known?.default ?? 'Default', description: `${FROM_WORDS.default}${known?.default ? ' · the model\'s default' : ''}`, value: null }
    : levels.includes(now.effort as Effort) ? { label: now.effort, description: `${FROM_WORDS[now.from] ?? now.from}${isDefault(now.effort as Effort) ? ' · the model\'s default' : ''}`, value: now.effort as Effort } : null;
  const shown = first?.value ?? (now.effort === null ? known?.default : null);
  return [...(first ? [first] : []), ...levels.filter((e) => e !== shown).map((e) => ({ label: e, description: about(e), value: e }))];
}

/**
 * acc dispatch's arguments for the effort picked (D-???). The effort the builder runs with anyway, on a
 * task with none picked before, adds none, so the task goes on following the clone's and the project's
 * settings, as Dispatch with…'s model does (D-086).
 */
export function dispatchEffortArgs(row: Pick<TaskRow, 'run'>, builder: BuilderEffort, effort: Effort | null): string[] {
  if (effort === null) return [];
  return !row.run?.effortPicked && effort === builder.effort ? [] : ['--effort', effort];
}

/** A builder's effort as a page shows it beside its model (D-???): only when one was named and isn't the model's default. */
export function effortShown(model: string | null | undefined, effort: string | null | undefined): string | null {
  if (!effort) return null;
  return model && modelEfforts(model)?.default === effort ? null : effort;
}
