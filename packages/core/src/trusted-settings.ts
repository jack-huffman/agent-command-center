/**
 * The project's settings as a run trusts them (D-206): the main checkout's `.acc/config.json` when the
 * run is in a worktree, else the environment branch's committed copy, origin's after a fetch and this
 * clone's after it. Never the checkout's own file, which a builder could point at another org, unprotect,
 * or give a check of its own. A deploy reads where it goes from them (deploy-gate.ts), and a run in a
 * worktree runs a command gate or a ratchet only as they have it (gates.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, type Environment, loadConfig, parseConfig } from './config.ts';
import type { Runner, RunResult } from './exec.ts';
import { mainCheckout, type RepoPaths, samePath } from './paths.ts';

/** The project's settings as a run trusts them, where they were read, and a reader for a file beside them. */
export interface TrustedSettings {
  config: Config;
  /** Where they came from, as a person reads it. */
  from: string;
  /** A file's text from the same place, by its path from the repo's root, or null when it isn't there. */
  read: (rel: string) => string | null;
}

/** What a reading needs of the run: where the repo's state lives, and how to run git. */
export type TrustedRun = { paths: RepoPaths; runner: Runner };

/**
 * The project's settings as a run trusts them (D-206): the main checkout's file when this run is in a
 * worktree, else the environment branch's committed copy, origin's after a fetch and this clone's after
 * it, since a local environment branch is any clone's to move. Never this checkout's own file, which a
 * builder could point at another org or unprotect. A problem says why none could be read.
 */
export function trustedSettings(run: TrustedRun, env: Pick<Environment, 'branch'>): TrustedSettings | { problem: string } {
  const { paths, runner } = run;
  let main: string;
  try {
    main = mainCheckout(runner, paths.root);
  } catch (e) {
    return { problem: (e as Error).message };
  }
  if (!samePath(main, paths.root)) {
    try {
      const { config } = loadConfig(join(main, '.acc', 'config.json'));
      const read = (rel: string): string | null => {
        try {
          return readFileSync(join(main, rel), 'utf8');
        } catch {
          return null;
        }
      };
      return { config, from: `the main checkout's settings (${main})`, read };
    } catch (e) {
      return { problem: `Couldn't read the project's settings from the main checkout, ${main}: ${(e as Error).message}` };
    }
  }
  // Origin's copy, fetched now, comes first: a clone with no origin, or one it can't reach, falls back to its own branch.
  runner('git', ['fetch', '--quiet', 'origin', env.branch], { cwd: paths.root, timeoutMs: 60_000 });
  const show = (ref: string, rel: string): RunResult => runner('git', ['show', `${ref}:${rel}`], { cwd: paths.root });
  const tried: string[] = [];
  for (const ref of [`refs/remotes/origin/${env.branch}`, `refs/heads/${env.branch}`]) {
    const r = show(ref, '.acc/config.json');
    if (r.code !== 0) {
      tried.push(ref);
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(r.stdout);
    } catch (e) {
      return { problem: `${ref}'s .acc/config.json isn't valid JSON: ${(e as Error).message}` };
    }
    const parsed = parseConfig(raw);
    if (!parsed.config) return { problem: `${ref}'s .acc/config.json has problems: ${parsed.errors.join('; ')}` };
    return { config: parsed.config, from: `${env.branch}'s committed settings (${ref})`, read: (rel) => { const f = show(ref, rel); return f.code === 0 ? f.stdout : null; } };
  }
  return { problem: `Couldn't read the project's settings from ${tried.join(' or ')}. A deploy reads where it goes from the main checkout, or from the environment's branch, never from this checkout's own .acc/config.json.` };
}

/**
 * Why a run in a worktree may not run this checkout's command gates and ratchets, or null (D-206): one
 * the project's settings lack, or whose command differs there, is refused, naming where the settings were
 * read. A command gate runs through the shell, where the gate runner can't see and the builder's hook
 * doesn't reach, so a worktree's copy of the settings can't add one. In the main checkout the settings are
 * the person's own, and nothing is compared; a checkout with no command gate or ratchet has nothing to.
 */
export function untrustedGates(run: TrustedRun, config: Pick<Config, 'gates'>, env: Pick<Environment, 'branch'>): string | null {
  const commands = Object.entries(config.gates.commands);
  const ratchets = Object.entries(config.gates.ratchets ?? {});
  if (!commands.length && !ratchets.length) return null;
  let main: string;
  try {
    main = mainCheckout(run.runner, run.paths.root);
  } catch {
    return null; // not a repository: the run fails on that first
  }
  if (samePath(main, run.paths.root)) return null;
  const trusted = trustedSettings(run, env);
  const how = 'A check runs only as the project\'s settings have it (D-206): a person changes them in the main checkout, and the task\'s branch takes the change with acc refresh.';
  if ('problem' in trusted) return `${trusted.problem} ${how}`;
  const problems: string[] = [];
  for (const [name, cmd] of commands) {
    const t = trusted.config.gates.commands[name];
    if (t === undefined) problems.push(`gates.commands.${name} isn't in ${trusted.from}`);
    else if (t !== cmd) problems.push(`gates.commands.${name} runs "${cmd}" here and "${t}" in ${trusted.from}`);
  }
  for (const [name, spec] of ratchets) {
    const t = trusted.config.gates.ratchets?.[name];
    if (!t) problems.push(`gates.ratchets.${name} isn't in ${trusted.from}`);
    else if (t.command !== spec.command) problems.push(`gates.ratchets.${name} runs "${spec.command}" here and "${t.command}" in ${trusted.from}`);
  }
  if (!problems.length) return null;
  return `This checkout's .acc/config.json names a check the project's settings don't, or with another command: ${problems.join('; ')}. ${how}`;
}
