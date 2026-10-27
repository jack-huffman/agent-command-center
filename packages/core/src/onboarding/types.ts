import type { Config, Profile } from '../config.ts';
import type { Runner } from '../exec.ts';
import type { RepoPaths } from '../paths.ts';
import type { InstallSystem, InstallTool } from './install-lines.ts';

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
  /** A VSCode command "Do it" runs, for a step done in VSCode's own UI, such as Add a tracker. */
  vscode?: string;
  /** Offer "I've done this" even with a Do it: the step is a choice a person can settle by hand. */
  confirm?: true;
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
  /** acc's own version, when the caller knows it: A4.plugin fails on an older plugin (GH-62). */
  version: string | null;
  /** The system the checks run on, when it isn't this one: a test's. Absent: process.platform. */
  platform?: NodeJS.Platform;
  /** The system the install lines are for. Absent, it's the one acc runs on (SYSTEM): only tests set it (T-124). */
  system?: InstallSystem;
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
  /** The tool this step's fix installs: its line for each system is in install-lines.ts, and the step's page shows them all (T-124). */
  install?: InstallTool;
  /** Something the step always offers, whatever its result, such as Import rules… (GH-108): a VSCode command. */
  offer?: { vscode: string; label: string; icon: string };
  check(ctx: CheckContext): CheckResult;
}

export interface StepResult {
  step: Step;
  result: CheckResult;
}
