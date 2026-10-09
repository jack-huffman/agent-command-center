/**
 * A builder's effort (D-128): what Dispatch with… offers beside the model, the arguments it gives acc
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
  /** A line of its own under it: that it drops the level picked for the task, which a narrow window's description would cut. */
  detail?: string;
  /**
   * The level; null for none named, so Claude Code's default applies; `default` to drop the level picked
   * for the task, so the builder's own applies again.
   */
  value: Effort | 'default' | null;
}

/** Where a builder's effort comes from, as How agents run's Change… knows it. */
export interface BuilderEffort {
  effort: string | null;
  from: { effort: string };
}

/** The level picked for a task's builder, which a re-dispatch keeps, or null. One it was only started with isn't a pick. */
const pickedEffort = (row: Pick<TaskRow, 'run'>): Effort | null => (row.run?.effortPicked && row.run.effort) || null;

/**
 * What Dispatch with… offers once a model is chosen (D-128). First, the level picked for the task, when
 * the model takes it; then the builder's own, the clone's or the project's, else the model's default,
 * each saying where it's set in FROM_WORDS' words, as the model's choice does. After a pick, the builder's
 * own drops it, and says which. Then each other level the model takes, with its words; the model's default
 * says so. Only the levels the model takes are offered: every level for a model acc doesn't know, and
 * nothing for one that takes none, so the step is skipped (noEffortArgs). The builder's own is left out
 * when the model doesn't take it, since acc dispatch would refuse it.
 */
export function dispatchEffortItems(row: Pick<TaskRow, 'run'>, builder: BuilderEffort, model: string): EffortItem[] {
  const known = modelEfforts(model);
  const levels: readonly Effort[] = known ? known.levels : EFFORTS;
  if (!levels.length) return [];
  const takes = (e: string | null): e is Effort => e !== null && levels.includes(e as Effort);
  const marked = (e: string) => (known?.default === e ? ' · the model\'s default' : '');
  const pick = pickedEffort(row);
  const own = builder.effort;
  const first: EffortItem[] = [];
  if (takes(pick)) first.push({ label: pick, description: `${FROM_WORDS.task}${marked(pick)}`, value: pick });
  if (own === null || takes(own)) {
    const label = own ?? known?.default ?? 'Default';
    const where = own === null ? FROM_WORDS.default! : FROM_WORDS[builder.from.effort] ?? builder.from.effort;
    first.push({ label, description: `${where}${marked(label)}`, ...(pick ? { detail: `Drops ${pick}, picked for this task` } : {}), value: pick ? 'default' : own as Effort | null });
  }
  const shown = new Set(first.map((i) => i.label));
  return [...first, ...levels.filter((e) => !shown.has(e)).map((e) => ({ label: e, description: `${EFFORT_WORDS[e]}${marked(e)}`, value: e }))];
}

/**
 * acc dispatch's arguments for the effort picked (D-128). The effort the builder runs with anyway, on a
 * task with none picked before, adds none, so the task goes on following the clone's and the project's
 * settings, as Dispatch with…'s model does (D-086). `default` drops the task's pick.
 */
export function dispatchEffortArgs(row: Pick<TaskRow, 'run'>, builder: BuilderEffort, effort: Effort | 'default' | null): string[] {
  if (effort === null) return [];
  if (effort === 'default') return ['--effort', 'default'];
  return !row.run?.effortPicked && effort === builder.effort ? [] : ['--effort', effort];
}

/**
 * acc dispatch's arguments when the model takes no level and the effort step is skipped (D-128): a level
 * picked for the task is dropped, and `dropped` says which, so Dispatch with… can say so.
 */
export function noEffortArgs(row: Pick<TaskRow, 'run'>): { args: string[]; dropped: Effort | null } {
  const pick = pickedEffort(row);
  return pick ? { args: ['--effort', 'default'], dropped: pick } : { args: [], dropped: null };
}
/** A builder's effort as a page shows it beside its model (D-128): only when one was named and isn't the model's default. */
export function effortShown(model: string | null | undefined, effort: string | null | undefined): string | null {
  if (!effort) return null;
  return model && modelEfforts(model)?.default === effort ? null : effort;
}
