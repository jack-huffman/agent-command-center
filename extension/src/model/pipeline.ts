/**
 * Settings' Pipeline section (T-157): each project's environments in path order, with org, type and whether
 * each is protected; which is the development environment; whether reviewed work merges into it on its own
 * (on by default in a Salesforce project); and where each environment goes next. A person changes the
 * development environment, the switch and the next steps here; each change asks acc to write the project's
 * settings, for them to commit. Plain data, drawn by the webview. No vscode import, so it's testable.
 */

import { autoMergeOn } from '../../../packages/core/src/config.ts';
import { canBeDevelopment, developmentEnvironment, inPromotionOrder, notMergingWhy, SALESFORCE_MERGE_WORDS } from '../../../packages/core/src/pipeline.ts';
import { OPTIONS_MAX } from '../../../packages/core/src/talk-questions.ts';
import { ENV_ICON, envTypeWords } from '../logic/environments.ts';
import type { SettingsAction } from './settings.ts';
import type { Look, ProjectLike } from './shared.ts';

/** An environment's place in the pipeline, with an icon and a label: the development one in blue, the rest neutral. */
export const PIPELINE_ROLE_LOOK = {
  development: { label: 'Development: work merges here', icon: 'git-merge', tone: 'blue' },
  production: { label: 'Production: a person deploys', icon: 'shield', tone: 'neutral' },
  protected: { label: 'Protected: a person merges', icon: 'lock', tone: 'neutral' },
  further: { label: 'Further: deployed by an agent on your pick', icon: 'arrow-right', tone: 'neutral' },
} as const satisfies Record<string, Look>;
export type PipelineRole = keyof typeof PIPELINE_ROLE_LOOK;

/** Whether reviewed work merges on its own, with an icon: on in blue, off neutral, and orange where the settings keep it from merging. */
export const PIPELINE_MERGE_LOOK = {
  on: { label: 'on', icon: 'git-merge', tone: 'blue' },
  off: { label: 'off', icon: 'circle-slash', tone: 'neutral' },
  held: { label: 'on, but nothing merges', icon: 'warning', tone: 'orange' },
} as const satisfies Record<string, Look>;

/** One environment as the section lists it. */
export interface PipelineEnv {
  name: string;
  branch: string;
  type: string;
  typeWords: string;
  icon: string;
  org: string | null;
  protected: boolean;
  role: PipelineRole;
  look: Look;
  /** Where its work goes next, by name, usual step first. */
  next: string[];
  /** Make it the development environment, and Change next steps…: each off with why where it can't be. */
  actions: SettingsAction[];
}

/** One project's pipeline, under its name. */
export interface PipelineProject {
  root: string;
  project: string;
  salesforce: boolean;
  /** The development environment's name, or null when none is. */
  development: string | null;
  /** The switch: its state, what it means, and Change…. */
  merge: { key: 'autopilot.autoMerge'; look: Look; meaning: string; action: SettingsAction | null };
  envs: PipelineEnv[];
}

const action = (command: string, label: string, icon: string, arg: string, name: string, disabled: string | null = null): SettingsAction => ({ command, label, icon, arg, name, primary: false, disabled });

/** Which role an environment plays: development, Production, protected, or a further step. */
export function pipelineRole(env: Pick<ProjectLike['config']['environments'][number], 'branch' | 'type' | 'protected'>, development: string | null): PipelineRole {
  if (env.branch === development) return 'development';
  if (env.type === 'production') return 'production';
  if (env.protected) return 'protected';
  return 'further';
}

/** The switch's words for a Salesforce project: on, off, or on but held by the settings, with why. */
export function pipelineMerge(p: ProjectLike): PipelineProject['merge'] {
  const key = 'autopilot.autoMerge' as const;
  const change = action('acc.agents.autoMerge', 'Change…', 'edit', p.root, `Change whether reviewed work merges into the development environment on its own, in ${p.name}`);
  if (p.config.profile !== 'salesforce') {
    // One short sentence, in view: Agents' row holds the words and the Change… for a project that isn't Salesforce.
    return { key, look: PIPELINE_MERGE_LOOK[autoMergeOn(p.config) ? 'on' : 'off'], meaning: 'Not Salesforce: Agents\' Auto-merge row says whether its pull requests merge on their own.', action: null };
  }
  const on = autoMergeOn(p.config);
  if (!on) return { key, look: PIPELINE_MERGE_LOOK.off, meaning: 'A person merges every pull request. Turned on, a task whose review passed and whose own deploy to the development org passed merges into the development environment on its own.', action: change };
  const why = notMergingWhy({ ...p.config, autonomy: p.config.autonomy ?? 'manual' });
  if (why) return { key, look: PIPELINE_MERGE_LOOK.held, meaning: `${why} ${SALESFORCE_MERGE_WORDS}`, action: change };
  return { key, look: PIPELINE_MERGE_LOOK.on, meaning: `${SALESFORCE_MERGE_WORDS} It merges while autopilot is on.`, action: change };
}

/** One project's pipeline: its environments in path order, each with its role and buttons, and the switch. */
export function pipelineProject(p: ProjectLike): PipelineProject {
  const dev = developmentEnvironment(p.config);
  const development = dev?.branch ?? null;
  const byBranch = new Map(p.config.environments.map((e) => [e.branch, e.name]));
  const envs = inPromotionOrder(p.config.environments).map((e): PipelineEnv => {
    const role = pipelineRole(e, development);
    const ref = `${p.root}|${e.branch}`;
    const cannot = role === 'development' ? 'It is the development environment' : e.type === 'production' ? 'Production can\'t be the development environment' : e.protected ? 'A protected environment can\'t be the development environment' : !canBeDevelopment(e) ? 'It has no org' : null;
    return {
      name: e.name, branch: e.branch, type: e.type, typeWords: envTypeWords(e.type), icon: ENV_ICON[e.type] ?? 'git-branch', org: e.org, protected: e.protected,
      role, look: PIPELINE_ROLE_LOOK[role], next: e.promotesTo.map((b) => byBranch.get(b) ?? b),
      // Each name holds its button's visible words, as a screen reader's label must (WCAG 2.5.3).
      actions: [
        action('acc.pipeline.development', 'Make it development', 'git-merge', ref, `Make it development: ${e.name}, in ${p.name}`, cannot),
        action('acc.pipeline.next', 'Next steps…', 'arrow-right', ref, `Next steps for ${e.name}, in ${p.name}: where its work goes next`),
      ],
    };
  });
  return { root: p.root, project: p.name, salesforce: p.config.profile === 'salesforce', development: dev?.name ?? null, merge: pipelineMerge(p), envs };
}

/**
 * The environments offered when a person picks the development environment with no row's button (D-205): a
 * single choice shows at most OPTIONS_MAX, in path order, of those that can be it and aren't it now, and the
 * person's own words always go, so `more` says how many the pick left for typing a name.
 */
export function developmentChoices<E extends Pick<ProjectLike['config']['environments'][number], 'branch' | 'type' | 'protected' | 'promotesTo'>>(config: { environments: E[] }, now: string | null): { offered: E[]; more: number } {
  const can = inPromotionOrder(config.environments).filter((e) => canBeDevelopment(e) && e.branch !== now);
  return { offered: can.slice(0, OPTIONS_MAX), more: Math.max(0, can.length - OPTIONS_MAX) };
}

/** Every onboarded project's pipeline, Salesforce projects first since the section is theirs above all. */
export const pipelineProjects = (projects: ProjectLike[]): PipelineProject[] =>
  projects.map(pipelineProject).sort((a, b) => Number(b.salesforce) - Number(a.salesforce));
