// What the CLI's tests share (GH-131): acc run from its source, in throwaway repos, with this machine's own
// files kept out of reach. The tests are a file per command group, named for its module in src/commands/
// (D-099), so the near-tests gate finds a module's tests by name. Each file names '../src/main.ts' itself,
// which is how the gate finds every CLI test for a change to main.ts or anything it loads.

import { type ChildProcessWithoutNullStreams, spawn as spawnAsync, spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { join } from 'node:path';
import { GENERIC_CONFIG, makeRepo, tempDir } from '../../core/test/support.ts';

// A builder's `acc gate run` runs these tests with its own ACC_TASK set, holding the machine's heavy-check slot.
export const HEAVY_DIR = join(tempDir('acc-heavy-'), 'slots');
// acc init lists the repo it writes in this machine's repos (GH-81): here, never the real ~/.acc.
export const REPOS_FILE = join(tempDir('acc-repos-'), 'repos.json');
// This machine's settings and the repos it counts are the tests' own, so a dispatch here is never noted, or
// counted, on the machine running them (GH-111).
export const MACHINE_FILE = join(tempDir('acc-machine-'), 'machine.json');

export interface AccRun {
  code: number;
  out: string;
  err: string;
  json: () => any;
}

/** How else to spawn acc, such as a timeout (GH-148): its folder, input and environment are cli()'s own arguments. */
export type SpawnOptions = Omit<SpawnSyncOptions, 'cwd' | 'input' | 'env' | 'encoding'>;

/**
 * acc as the file at `main` runs it: `acc(cwd, args, input?, env?, spawn?)`, with what the environment adds
 * over the tests' own, and how else to spawn it. Every CLI test runs acc through this, so none builds its
 * environment by hand.
 */
export function cli(main: string) {
  const accEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({ ...process.env, NO_COLOR: '1', ACC_ROLE: '', ACC_TASK: '', ACC_HEAVY_DIR: HEAVY_DIR, ACC_REPOS_FILE: REPOS_FILE, ACC_MACHINE_FILE: MACHINE_FILE, ...env });
  const run = (cwd: string, args: string[], input?: string, env: NodeJS.ProcessEnv = {}, spawn: SpawnOptions = {}): AccRun => {
    const r = spawnSync(process.execPath, ['--no-warnings', main, ...args], { ...spawn, cwd, input, encoding: 'utf8', env: accEnv(env) });
    return { code: r.status ?? 1, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
  };
  /** acc started without waiting for it, for a test that watches what it prints while it runs, in the same environment. */
  const start = (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): ChildProcessWithoutNullStreams =>
    spawnAsync(process.execPath, ['--no-warnings', main, ...args], { cwd, env: accEnv(env) });
  return Object.assign(run, { start });
}

/** For a test of moving tasks by hand, not their checks: stray-files off, so a task needs none (GH-103). */
export const UNCHECKED = { ...GENERIC_CONFIG, strayFiles: { required: false } };

export function repoWithConfig(config: unknown = GENERIC_CONFIG): string {
  return makeRepo({ '.acc/config.json': JSON.stringify(config) });
}

/** A project as a person keeps it: its own spacing, with checks to choose from (GH-111). */
export const LIMITS_CONFIG = '{\n  "schema": 1,\n  "project": "Tool",\n  "profile": "generic",\n  "environments": [\n    { "name": "main", "default": true }\n  ],\n  "agents": {\n    "max": 3\n  },\n  "autonomy": "review",\n  "autopilot": { "autoMerge": true },\n  "gates": {\n    "required": [\n      "check"\n    ],\n    "commands": {\n      "check": "true",\n      "typecheck": "true",\n      "near-tests": "true"\n    }\n  }\n}\n';
