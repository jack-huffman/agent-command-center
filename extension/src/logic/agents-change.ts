/**
 * What Settings' Change… on an agent's row asks acc to do (T-163): a role's model and effort, its fallback
 * model, or back to the default, for this clone only or for the project. Like the rest of logic/, no `vscode` import.
 */

import type { AgentRole } from '../../../packages/core/src/config.ts';

/** What Change… changes: the model and effort, the fallback model, or all of them back to the default. */
export type AgentsChange = 'model' | 'fallback' | 'reset';

/**
 * The acc arguments for a change. The project's model and effort go through `acc agents model`, which writes
 * `default` for a value the person set back; the rest go through `acc agents set`, with `--clear` for a
 * value set back, and `--project` for the project's settings (without it, this clone only).
 */
export function agentsChangeArgs(
  role: AgentRole, what: AgentsChange, to: { model: string | null; effort: string | null; fallback: string | null }, project: boolean,
): string[] {
  if (what === 'model' && project) return ['agents', 'model', role, to.model ?? 'default', '--effort', to.effort ?? 'default'];
  const where = project ? ['--project'] : [];
  const field = (flag: string, value: string | null) => (value ? [`--${flag}`, value] : ['--clear', flag]);
  if (what === 'model') return ['agents', 'set', role, ...field('model', to.model), ...field('effort', to.effort), ...where];
  if (what === 'fallback') return ['agents', 'set', role, ...field('fallback-model', to.fallback), ...where];
  return ['agents', 'set', role, '--clear', 'model', '--clear', 'effort', '--clear', 'fallback-model', ...where];
}
