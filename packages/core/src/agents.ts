import { readFileSync, writeFileSync } from 'node:fs';
import { AccError, type Runner } from './exec.ts';
import { type AgentProfile, type AgentRole, type Config, EFFORTS, type Effort, MODEL_NAME, noProfile } from './config.ts';

/**
 * The model and effort each kind of agent runs with (D-036). The project can set a default in
 * .acc/config.json; a clone can choose its own in git config, which nobody else sees, like its GitHub
 * account (D-028). A model or effort left unset is Claude Code's own default.
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
    if (field === 'effort') { if ((EFFORTS as readonly string[]).includes(v)) out.effort = v as Effort; }
    else if (MODEL_NAME.test(v)) out[field] = v;
  }
  return out;
}

export interface ProfileView extends AgentProfile {
  /** Where each value comes from: this clone, the project's config, or Claude Code's default. */
  from: Record<Field, 'clone' | 'project' | 'default'>;
}

/** What a role runs with in this clone, and where each part comes from. */
export function profileView(config: Config, run: Runner, root: string, role: AgentRole): ProfileView {
  const project = config.agents[role];
  const mine = cloneProfile(run, root, role);
  const pick = <K extends Field>(f: K) => (mine[f] != null ? { v: mine[f]!, from: 'clone' as const } : project[f] != null ? { v: project[f]!, from: 'project' as const } : { v: null, from: 'default' as const });
  const m = pick('model');
  const e = pick('effort');
  const fb = pick('fallbackModel');
  return { model: m.v as string | null, effort: e.v as Effort | null, fallbackModel: fb.v as string | null, from: { model: m.from, effort: e.from, fallbackModel: fb.from } };
}

/** The config with this clone's choices in place of the project's, so dispatch and review use them. */
export function withCloneAgents(config: Config, root: string, run: Runner): Config {
  const merge = (role: AgentRole): AgentProfile => ({ ...config.agents[role], ...cloneProfile(run, root, role) });
  return { ...config, agents: { ...config.agents, builder: merge('builder'), reviewer: merge('reviewer') } };
}

/** Claude Code's flags for a profile. Nothing for what's unset, so Claude Code's default applies. */
export function agentArgs(p: AgentProfile | undefined): string[] {
  if (!p) return [];
  return [...(p.model ? ['--model', p.model] : []), ...(p.effort ? ['--effort', p.effort] : []), ...(p.fallbackModel ? ['--fallback-model', p.fallbackModel] : [])];
}

/** What a person asked to change: a value to set, null to clear it, undefined to leave it. */
export type ProfileChange = { [K in Field]?: AgentProfile[K] | null };

function check(change: ProfileChange): void {
  for (const f of ['model', 'fallbackModel'] as const) {
    const v = change[f];
    if (v != null && !MODEL_NAME.test(v)) throw new AccError('usage', `"${v}" isn't a model name. Use an alias such as opus, sonnet or fable, or a full model name.`);
  }
  if (change.effort != null && !(EFFORTS as readonly string[]).includes(change.effort)) throw new AccError('usage', `Effort is one of ${EFFORTS.join(', ')}.`);
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

export const describeProfile = (p: AgentProfile): string =>
  [`model ${p.model ?? 'Claude Code\'s default'}`, `effort ${p.effort ?? 'default'}`, ...(p.fallbackModel ? [`falls back to ${p.fallbackModel}`] : [])].join(', ');

export { noProfile };
