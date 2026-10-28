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
  /** The question Do it asks before it runs fix, such as before it changes PATH (T-133). Without a yes, nothing runs. */
  ask?: string;
  /** A fix only the person can do, in words, such as quitting VSCode: Do it isn't offered for this result (T-133). */
  byHand?: string;
  /** The folder a tool is installed in when it isn't on VSCode's PATH (T-133): installed, not missing. */
  place?: string;
}

/** What the machine steps read of the filesystem: the real one, or a test's (T-133). */
export interface MachineFiles {
  exists(path: string): boolean;
  /** A folder's entries, none when it can't be read. */
  list(dir: string): string[];
  /** A file's text, null when it can't be read. */
  read(file: string): string | null;
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
  /** The filesystem the machine steps look in for an install place. Absent: this machine's (T-133). */
  files?: MachineFiles;
  /** The profile whose machine steps run, for a folder with no config yet, such as a project being started (T-133). */
  profile?: Profile;
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
  /**
   * The fix on each system, where its line differs by system (D-209): fix is this for the system acc runs
   * on, and a step's page for another system reads it (fixFor).
   */
  fixOn?: (system: InstallSystem) => Fix;
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
