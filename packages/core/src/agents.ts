import { readFileSync, writeFileSync } from 'node:fs';
import { AccError, type Runner } from './exec.ts';
import { type AgentProfile, type AgentRole, type Config, DEFAULT_MODEL, type Effort, isEffort, MODEL_NAME, noProfile } from './config.ts';
import { checkEffortName } from './efforts.ts';

/**
 * The model and effort each kind of agent runs with (D-036). The project can set a default in
 * .acc/config.json; a clone can choose its own in git config, which nobody else sees, like its GitHub
 * account (D-028). A model left unset is acc's own default, Opus 5.5 (D-086); an effort or fallback
 * left unset is Claude Code's own default.
 */

const KEYS = { model: 'model', effort: 'effort', fallbackModel: 'fallbackmodel' } as const;
type Field = keyof typeof KEYS;
const gitKey = (role: AgentRole, field: Field) => `acc.${role}.${KEYS[field]}`;

/** This clone's own choices, read from git config. */
export function cloneProfile(run: Runner, root: string, role: AgentRole): Partial<AgentProfile> {
  const out: Partial<AgentProfile> = {};
  for (const field of Object.keys(KEYS) as Field[]) {
    const r = run('git', ['config', '--get', gitKey(role, field)], { cwd: root });
    const v = r.code === 0 ? r.stdout.trim() : '';
    if (!v) continue;
    if (field === 'effort') { if (isEffort(v)) out.effort = v; }
    else if (MODEL_NAME.test(v)) out[field] = v;
  }
  return out;
}

/** The model an agent runs with: its profile's, or acc's default when the profile names none (D-086). */
export const modelOf = (p: Pick<AgentProfile, 'model'> | undefined): string => p?.model ?? DEFAULT_MODEL;

export interface ProfileView extends AgentProfile {
  /** Always known: the clone's, the project's, or acc's default. */
  model: string;
  /**
   * Where each value comes from: this clone, the project's config, or a default. The model's default is
   * acc's own ('acc'); the effort's and the fallback's are Claude Code's ('default').
   */
  from: { model: 'clone' | 'project' | 'acc'; effort: 'clone' | 'project' | 'default'; fallbackModel: 'clone' | 'project' | 'default' };
}

/** What a role runs with in this clone, and where each part comes from. */
export function profileView(config: Config, run: Runner, root: string, role: AgentRole): ProfileView {
  const project = config.agents[role];
  const mine = cloneProfile(run, root, role);
  const pick = <K extends Field>(f: K) => (mine[f] != null ? { v: mine[f]!, from: 'clone' as const } : project[f] != null ? { v: project[f]!, from: 'project' as const } : { v: null, from: 'default' as const });
  const m = pick('model');
  const e = pick('effort');
  const fb = pick('fallbackModel');
  return {
    model: (m.v as string | null) ?? DEFAULT_MODEL, effort: e.v as Effort | null, fallbackModel: fb.v as string | null,
    from: { model: m.from === 'default' ? 'acc' : m.from, effort: e.from, fallbackModel: fb.from },
  };
}

/** The config with this clone's choices in place of the project's, so dispatch and review use them. */
export function withCloneAgents(config: Config, root: string, run: Runner): Config {
  const merge = (role: AgentRole): AgentProfile => ({ ...config.agents[role], ...cloneProfile(run, root, role) });
  return { ...config, agents: { ...config.agents, builder: merge('builder'), reviewer: merge('reviewer') } };
}

/**
 * Claude Code's flags for a profile. The model is always named: acc's default when the profile has none
 * (D-086). An effort or fallback left unset is left out, so Claude Code's default applies. So is a
 * fallback that is the model itself, which Claude Code refuses to start with.
 */
export function agentArgs(p: AgentProfile | undefined): string[] {
  const model = modelOf(p);
  return ['--model', model, ...(p?.effort ? ['--effort', p.effort] : []), ...(p?.fallbackModel && p.fallbackModel !== model ? ['--fallback-model', p.fallbackModel] : [])];
}

/** What a person asked to change: a value to set, null to clear it, undefined to leave it. */
export type ProfileChange = { [K in Field]?: AgentProfile[K] | null };

/** Refuses what isn't a model name, before anything is set or started with it. */
export function checkModelName(v: string): void {
  if (!MODEL_NAME.test(v)) throw new AccError('usage', `"${v}" isn't a model name. Use an alias such as opus, sonnet or fable, or a full model name.`);
}

function check(change: ProfileChange): void {
  for (const f of ['model', 'fallbackModel'] as const) {
    const v = change[f];
    if (v != null) checkModelName(v);
  }
  if (change.effort != null) checkEffortName(change.effort);
}

/**
 * Changes a role's profile: for this clone in git config (the default), or the project's default in
 * .acc/config.json, editing only that part of the file. The next agent started uses it.
 */
export function setProfile(run: Runner, root: string, configFile: string, role: AgentRole, change: ProfileChange, scope: 'clone' | 'project'): void {
  check(change);
  if (scope === 'clone') {
    for (const f of Object.keys(change) as Field[]) {
      const v = change[f];
      if (v === undefined) continue;
      const r = v === null ? run('git', ['config', '--unset', gitKey(role, f)], { cwd: root }) : run('git', ['config', gitKey(role, f), v], { cwd: root });
      // Unsetting what isn't set exits 5; that's fine.
      if (r.code !== 0 && !(v === null && r.code === 5)) throw new AccError('git', `git config refused ${gitKey(role, f)}: ${r.stderr.trim()}`);
    }
    return;
  }
  let raw: Record<string, any>;
  try {
    raw = JSON.parse(readFileSync(configFile, 'utf8'));
  } catch (e) {
    throw new AccError('bad-config', `Couldn't read ${configFile}: ${(e as Error).message}`);
  }
  raw.agents ??= {};
  const p: Record<string, unknown> = { ...(raw.agents[role] ?? {}) };
  for (const f of Object.keys(change) as Field[]) {
    const v = change[f];
    if (v === undefined) continue;
    if (v === null) delete p[f];
    else p[f] = v;
  }
  if (Object.keys(p).length) raw.agents[role] = p;
  else delete raw.agents[role];
  writeFileSync(configFile, JSON.stringify(raw, null, 2) + '\n');
}

/** The levels a person can choose for autopilot: dispatch and full aren't built yet (D-055). */
export const SETTABLE_AUTONOMY = ['manual', 'review'] as const;
export type SettableAutonomy = (typeof SETTABLE_AUTONOMY)[number];

/**
 * Sets the project's autonomy in .acc/config.json (D-055), changing only that key: the rest of the file
 * stays as it was, byte for byte, when the key is already there. Nobody else sees it until it's committed.
 */
export function setAutonomy(configFile: string, value: string): void {
  if (value === 'dispatch' || value === 'full') {
    throw new AccError('refused', `autonomy "${value}" isn't built yet: autopilot would also start Ready tasks (D-055). Choose manual or review.`);
  }
  if (!(SETTABLE_AUTONOMY as readonly string[]).includes(value)) throw new AccError('usage', `Autonomy is ${SETTABLE_AUTONOMY.join(' or ')}.`);
  let text: string;
  let raw: Record<string, unknown>;
  try {
    text = readFileSync(configFile, 'utf8');
    raw = JSON.parse(text);
  } catch (e) {
    throw new AccError('bad-config', `Couldn't read ${configFile}: ${(e as Error).message}`);
  }
  const wanted = { ...raw, autonomy: value };
  // The value replaced where it stands, so nothing else in the file moves.
  const at = [...text.matchAll(/("autonomy"\s*:\s*)"[^"\\]*"/g)];
  if (at.length === 1) {
    const edited = text.replace(/("autonomy"\s*:\s*)"[^"\\]*"/, `$1${JSON.stringify(value)}`);
    try {
      if (JSON.stringify(JSON.parse(edited)) === JSON.stringify(wanted)) {
        writeFileSync(configFile, edited);
        return;
      }
    } catch {
      // not the key we thought: write the whole file instead
    }
  }
  writeFileSync(configFile, JSON.stringify(wanted, null, 2) + '\n');
}

/**
 * Turns auto-merge on or off in .acc/config.json (GH-67), changing only `autopilot.autoMerge`: the rest of
 * the file stays as it was, byte for byte. A Salesforce project can't turn it on: a person merges every
 * pull request there. Off with no key written changes nothing. Nobody else sees it until it's committed.
 */
export function setAutoMerge(configFile: string, on: boolean): void {
  let text: string;
  let raw: Record<string, any>;
  try {
    text = readFileSync(configFile, 'utf8');
    raw = JSON.parse(text);
  } catch (e) {
    throw new AccError('bad-config', `Couldn't read ${configFile}: ${(e as Error).message}`);
  }
  if (on && raw.profile === 'salesforce') throw new AccError('refused', 'A Salesforce project never auto-merges: a person merges every pull request there.');
  const was = raw.autopilot && typeof raw.autopilot === 'object' && !Array.isArray(raw.autopilot) ? raw.autopilot : null;
  if (!on && was?.autoMerge === undefined) return;
  const wanted = { ...raw, autopilot: { ...(was ?? {}), autoMerge: on } };
  // The same values, whatever order the keys are in.
  const canon = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
    : Array.isArray(v) ? v.map(canon) : v);
  const fits = (edited: string): boolean => {
    try {
      return JSON.stringify(canon(JSON.parse(edited))) === JSON.stringify(canon(wanted));
    } catch {
      return false;
    }
  };
  // The value replaced where it stands; else the key put first in the autopilot block, or the block put
  // last in the file, indented as the file is. Anything the check doesn't recognise writes the whole file.
  const tries: string[] = [];
  const value = /("autoMerge"\s*:\s*)(true|false)/;
  if ([...text.matchAll(new RegExp(value, 'g'))].length === 1) tries.push(text.replace(value, `$1${on}`));
  const block = /("autopilot"\s*:\s*\{)(\s*)(?=")/;
  if (block.test(text)) tries.push(text.replace(block, (_m, open: string, gap: string) => `${open}${gap}"autoMerge": ${on},${gap}`));
  const indent = /^\{\s*?\n([ \t]+)"/.exec(text)?.[1] ?? '  ';
  if (!was) tries.push(text.replace(/(\S)(\s*)\}\s*$/, (_m, last: string, gap: string) => `${last},\n${indent}"autopilot": {\n${indent}${indent}"autoMerge": ${on}\n${indent}}${gap}}\n`));
  writeFileSync(configFile, tries.find(fits) ?? JSON.stringify(wanted, null, 2) + '\n');
}

export const describeProfile = (p: AgentProfile): string =>
  [`model ${p.model ?? `${DEFAULT_MODEL} (acc's default)`}`, `effort ${p.effort ?? 'default'}`, ...(p.fallbackModel ? [`falls back to ${p.fallbackModel}`] : [])].join(', ');

export { noProfile };
