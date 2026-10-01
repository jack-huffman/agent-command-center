import type { Config, Profile } from '../config.ts';
import type { Runner } from '../exec.ts';
import type { RepoPaths } from '../paths.ts';

export type CheckStatus = 'pass' | 'fail' | 'unknown' | 'skip';

export interface CheckResult {
  status: CheckStatus;
  detail: string;
  /** A fix specific to this result, when it differs from the step's usual fix. */
  fix?: string;
  /** A folder the person should open instead, such as the project's repo next to an old copy. */
  open?: string;
}

export interface Fix {
  /** A command the person (or the walkthrough's "Do it" button) can run. */
  command?: string;
  /** A Salesforce Setup path, opened with `sf org open --path`. */
  setupPath?: string;
  /** Plain instructions, for clicks only a person can make. */
  text?: string;
  docs?: string;
  /** The check returns the exact command for this repo (CheckResult.fix), so "Do it" can run it. */
  fromCheck?: true;
}

export interface CheckContext {
  cwd: string;
  run: Runner;
  env: NodeJS.ProcessEnv;
  /** Null when cwd isn't inside a git repository. */
  paths: RepoPaths | null;
  /** Null when there's no config, or it doesn't parse. */
  config: Config | null;
  configErrors: string[];
  /** Shared between checks, so slow commands run once. */
  cache: Map<string, unknown>;
}

export interface Step {
  /** Stable id. The group prefix matches ONBOARDING.md (A1, B2 …). */
  id: string;
  part: 'machine' | 'project';
  group: string;
  title: string;
  why: string;
  /** Profiles this step applies to. Absent means every profile. */
  profiles?: Profile[];
  fix?: Fix;
  /** The milestone that builds this step's check. Planned steps show in doctor but not in the walkthrough. */
  planned?: string;
  check(ctx: CheckContext): CheckResult;
}

export interface StepResult {
  step: Step;
  result: CheckResult;
}
