/**
 * Settings' Pipeline section writes the project's environments (T-157): which is the development
 * environment, and where each goes next. Each change edits `.acc/config.json` by its keys, keeps the rest
 * as it was, checks the whole through the parser before anything is written, and writes the file whole
 * (writeAtomic), for a person to commit. Builders, reviewers and analysts can't run these: the CLI refuses
 * them by role, and the builder's settings deny the command.
 */

import { readFileSync } from 'node:fs';
import { writeAtomic } from './atomic.ts';
import { branchFor, type Config, parseConfig } from './config.ts';
import { AccError } from './exec.ts';
import { canBeDevelopment, developmentEnvironment } from './pipeline.ts';

/** The file as JSON, and the indent it uses, so the write keeps its shape. */
function readRaw(configFile: string): { raw: Record<string, any>; indent: string } {
  let text: string;
  let raw: Record<string, any>;
  try {
    text = readFileSync(configFile, 'utf8');
    raw = JSON.parse(text);
  } catch (e) {
    throw new AccError('bad-config', `Couldn't read ${configFile}: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AccError('bad-config', `${configFile} isn't a settings object.`);
  return { raw, indent: /^\{\s*?\n([ \t]+)"/.exec(text)?.[1] ?? '  ' };
}

/** The environment in the raw list that `name` names, by name or branch, whatever the case. */
function rawEnvironment(raw: Record<string, any>, name: string): Record<string, any> {
  const envs: unknown[] = Array.isArray(raw.environments) ? raw.environments : [];
  const want = branchFor(name);
  const env = envs.find((e) => e && typeof e === 'object' && typeof (e as { name?: unknown }).name === 'string' && branchFor((e as { name: string }).name) === want);
  if (!env) throw new AccError('refused', `No environment is called "${name}". The settings list ${envs.map((e) => (e as { name?: string })?.name).filter(Boolean).join(', ') || 'none'}.`);
  return env as Record<string, any>;
}

/** The edited settings checked whole, then written; a parse error names what's wrong and nothing is written. */
function writeChecked(configFile: string, raw: Record<string, any>, indent: string): Config {
  const r = parseConfig(raw);
  if (!r.config) throw new AccError('refused', `That would leave the settings with problems:\n- ${r.errors.join('\n- ')}`);
  writeAtomic(configFile, JSON.stringify(raw, null, indent) + '\n');
  return r.config;
}

/**
 * Makes `name` the development environment: the project's default, where work starts and, in a Salesforce
 * project, where reviewed work merges on its own (T-157). Refused for Production or a protected environment,
 * by the parser's rule that the default can't be protected, and for one the settings don't list. The same
 * environment again changes nothing.
 */
export function setDevelopmentEnvironment(configFile: string, name: string): { config: Config; changed: boolean } {
  const { raw, indent } = readRaw(configFile);
  const env = rawEnvironment(raw, name);
  if (env.default === true) return { config: parseChecked(raw), changed: false };
  if (env.type === 'production' || env.protected === true) throw new AccError('refused', `${env.name} is ${env.type === 'production' ? 'Production' : 'protected'}: it can't be the development environment. Nothing merges into it on its own.`);
  for (const e of raw.environments as Record<string, any>[]) {
    if (e === env) e.default = true;
    else delete e.default;
  }
  const config = writeChecked(configFile, raw, indent);
  // The parser allowed it, so it's the development environment now, unless its type says Production.
  if (!canBeDevelopment(config.environments.find((e) => e.branch === branchFor(name))!)) throw new AccError('refused', `${env.name} can't be the development environment.`);
  return { config, changed: true };
}

/**
 * Sets where `name` goes next: the environments its work is promoted to, usual step first (D-018). An
 * empty list means it goes nowhere further. Each must be a listed environment, not itself, and the paths
 * must not loop: the parser's rules, checked before anything is written.
 */
export function setNextSteps(configFile: string, name: string, next: string[]): { config: Config; changed: boolean } {
  const { raw, indent } = readRaw(configFile);
  const env = rawEnvironment(raw, name);
  const branches = next.map((n) => rawEnvironment(raw, n)).map((e) => branchFor(e.name as string));
  const was: string[] = Array.isArray(env.promotesTo) ? env.promotesTo.map((b: unknown) => branchFor(String(b))) : [];
  if (JSON.stringify(was) === JSON.stringify(branches)) return { config: parseChecked(raw), changed: false };
  if (branches.length) env.promotesTo = branches;
  else delete env.promotesTo;
  return { config: writeChecked(configFile, raw, indent), changed: true };
}

/** The settings as they are, checked, when a change turns out to change nothing. */
function parseChecked(raw: Record<string, any>): Config {
  const r = parseConfig(raw);
  if (!r.config) throw new AccError('bad-config', `The settings have problems:\n- ${r.errors.join('\n- ')}`);
  return r.config;
}

/** The development environment's name, for a message, or what stands in its place. */
export const developmentName = (config: Config): string => developmentEnvironment(config)?.name ?? 'no development environment';
