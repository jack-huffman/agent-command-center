// What the CLI's tests share (GH-131): acc run from its source, in throwaway repos, with this machine's own
// files kept out of reach. The tests are a file per command group, named for its module in src/commands/
// (D-099), so the near-tests gate finds a module's tests by name. Each file names '../src/main.ts' itself,
// which is how the gate finds every CLI test for a change to main.ts or anything it loads.

import { spawnSync } from 'node:child_process';
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

/** acc as the file at `main` runs it: `acc(cwd, args, input?, env?)`, with what the environment adds over the tests' own. */
export function cli(main: string) {
  return (cwd: string, args: string[], input?: string, env: NodeJS.ProcessEnv = {}): AccRun => {
    const r = spawnSync(process.execPath, ['--no-warnings', main, ...args], {
      cwd, input, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ACC_ROLE: '', ACC_TASK: '', ACC_HEAVY_DIR: HEAVY_DIR, ACC_REPOS_FILE: REPOS_FILE, ACC_MACHINE_FILE: MACHINE_FILE, ...env },
    });
    return { code: r.status ?? 1, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
  };
}

/** For a test of moving tasks by hand, not their checks: stray-files off, so a task needs none (GH-103). */
export const UNCHECKED = { ...GENERIC_CONFIG, strayFiles: { required: false } };

export function repoWithConfig(config: unknown = GENERIC_CONFIG): string {
  return makeRepo({ '.acc/config.json': JSON.stringify(config) });
}

/** A project as a person keeps it: its own spacing, with checks to choose from (GH-111). */
export const LIMITS_CONFIG = '{\n  "schema": 1,\n  "project": "Tool",\n  "profile": "generic",\n  "environments": [\n    { "name": "main", "default": true }\n  ],\n  "agents": {\n    "max": 3\n  },\n  "autonomy": "review",\n  "autopilot": { "autoMerge": true },\n  "gates": {\n    "required": [\n      "check"\n    ],\n    "commands": {\n      "check": "true",\n      "typecheck": "true",\n      "near-tests": "true"\n    }\n  }\n}\n';
