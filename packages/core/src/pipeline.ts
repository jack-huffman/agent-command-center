/**
 * A Salesforce project's pipeline (T-157): the development environment, and whether autopilot merges a
 * reviewed, deployed task into its branch on its own. A Salesforce project merges on its own unless its
 * settings say not (`autopilot.autoMerge: false`), and only into the development environment: the project's
 * default environment, of any type but Production. Never into Production, a protected environment or any
 * further environment, and never a deploy past the development org: a deploy past it is a person's pick,
 * run by an agent (D-235). This amends D-014 and D-083 for Salesforce projects. Only types from config.ts
 * here, so config.ts can read these without a cycle.
 */

import type { Environment } from './config.ts';

/** What this module reads of the config: the profile, the environments, autonomy and the switch. */
export type PipelineConfig = { profile: string; autonomy?: string; environments: Pick<Environment, 'name' | 'branch' | 'type' | 'org' | 'default' | 'protected' | 'promotesTo'>[]; autopilot?: { autoMerge?: boolean } };

/**
 * Whether a profile's projects merge on their own with no word in the config: Salesforce does (T-157), so a
 * reviewed task lands in the development environment with no click; any other profile is off until it
 * turns auto-merge on (D-083).
 */
export const autoMergeDefault = (profile: string): boolean => profile === 'salesforce';

/** The org types a development environment can be: every type but Production (and `none`, which has no org). */
export const DEVELOPMENT_TYPES: readonly string[] = ['developer', 'developer_pro', 'partial', 'full'];

/**
 * The development environment of a Salesforce project: its default environment, where day-to-day work
 * starts, unless that is Production or protected. Null when there is none: then nothing merges on its own,
 * and `notMergingWhy` says so.
 */
export function developmentEnvironment<E extends Pick<Environment, 'default' | 'protected' | 'type'>>(config: { environments: E[] }): E | null {
  const env = config.environments.find((e) => e.default);
  if (!env || env.protected || env.type === 'production') return null;
  return env;
}

/**
 * Whether a Salesforce environment could be the development environment: listed, with an org type that
 * isn't Production, and not protected. Settings offers these when a person changes it.
 */
export const canBeDevelopment = (env: Pick<Environment, 'type' | 'protected'>): boolean => DEVELOPMENT_TYPES.includes(env.type) && !env.protected;

/**
 * Why a Salesforce project doesn't merge on its own, in words, or null when it does: no default environment,
 * a default that is Production or protected, the switch off, or autonomy that isn't review. Autopilot
 * being switched off in the Command Center isn't the config's to say, so it isn't here.
 */
export function notMergingWhy(config: PipelineConfig): string | null {
  if (config.profile !== 'salesforce') return null;
  const dflt = config.environments.find((e) => e.default);
  if (!dflt) return 'No environment is the default, so there is no development environment to merge into.';
  if (dflt.type === 'production') return `The default environment, ${dflt.name}, is Production: nothing merges into Production on its own.`;
  if (dflt.protected) return `The default environment, ${dflt.name}, is protected: a person merges into it.`;
  if (config.autopilot?.autoMerge === false) return 'Merging on its own is off for this project: a person merges each pull request.';
  if (config.autonomy !== undefined && config.autonomy !== 'review') return `Autonomy is ${config.autonomy}, so autopilot doesn't run and nothing merges on its own.`;
  return null;
}

/**
 * Whether a Salesforce project's branch is the development environment's: the only branch autopilot merges
 * into there (T-157). A branch of any other environment, protected or not, is never merged into on its own.
 */
export function isDevelopmentBranch(config: PipelineConfig, branch: string): boolean {
  const dev = developmentEnvironment(config);
  return !!dev && dev.branch === branch;
}

/**
 * Environments in promotion order, dev first and production last. An environment sits after everything that
 * promotes into it (the longest way in). Ties, and environments on no path, keep the config's order, after the
 * ones on a path. Moved here from the extension's `logic/environments.ts` (T-157), which re-exports it, so
 * acc's own pipeline command lists them the same way.
 */
export function inPromotionOrder<E extends { branch: string; promotesTo: string[] }>(envs: E[]): E[] {
  const depth = new Map<string, number>();
  const walk = (branch: string, d: number, seen: string[]) => {
    if ((depth.get(branch) ?? -1) >= d) return;
    depth.set(branch, d);
    for (const next of envs.find((e) => e.branch === branch)?.promotesTo ?? []) if (!seen.includes(next)) walk(next, d + 1, [...seen, next]);
  };
  const into = new Set(envs.flatMap((e) => e.promotesTo));
  for (const e of envs) if (e.promotesTo.length && !into.has(e.branch)) walk(e.branch, 0, [e.branch]);
  const rank = (e: E) => depth.get(e.branch) ?? Infinity;
  return envs.map((e, i) => ({ e, i })).sort((a, b) => (rank(a.e) === rank(b.e) ? a.i - b.i : rank(a.e) < rank(b.e) ? -1 : 1)).map((x) => x.e);
}

/** What a merge into the development environment needs, as the Command Center and acc say it. */
export const SALESFORCE_MERGE_WORDS = 'A task whose review passed and whose own deploy to the development org passed joins the merge queue, and they merge in turn into the development environment\'s branch: its base merged in, the full check run once, then merged once GitHub says it can. Never into Production, a protected environment or any further environment, and never a deploy past the development org: a deploy past it is yours to pick, run by an agent.';
