/**
 * Finding a Salesforce project's environments (D-018), with or without access to Production (D-T-125).
 * Without it, the sandboxes this person is logged in to on one My Domain are the environments, and
 * Production is recorded with no org; someone with access records its org later (recordProduction).
 */
import { readFileSync } from 'node:fs';
import { branchFor, type Config, type EnvType } from './config.ts';
import { writeJsonKey } from './config-edit.ts';
import { AccError, type Runner } from './exec.ts';
import { LICENSE_TO_TYPE, parseOrgUrl } from './onboarding/helpers.ts';
import type { RepoPaths } from './paths.ts';
import type { RawEnv } from './init.ts';

/**
 * Production's line wherever this machine has no Production org, or isn't logged in to it (D-T-125): setup
 * and building never need it, since a builder never deploys there (D-018).
 */
export const PRODUCTION_NOT_HERE = 'This machine isn\'t logged in to Production. Setting up and building don\'t need it: someone with access to Production looks after it.';

/** What a sandbox's type is taken as when Production's sandbox list can't be read (D-T-125). */
export const GUESSED_TYPE: EnvType = 'partial';

/** One sf command's --json answer; an sf that prints no JSON fails, with its first line as the message. */
export const sfRun = (run: Runner, root: string, args: string[]): any => {
  const r = run('sf', [...args, '--json'], { cwd: root, env: { ...process.env, SF_NO_UPDATE_NOTIFIER: 'true', SF_DISABLE_TELEMETRY: 'true' } });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { status: r.code || 1, message: (r.stderr || r.stdout).trim().split('\n')[0] };
  }
};

/** One org `sf org list` knows: its alias, URL, and whether the CLI tracks its source. */
export interface ListedOrg {
  alias?: string;
  instanceUrl?: string;
  tracksSource?: boolean;
}

/** Every org `sf org list --json` lists, from each of its lists. An sf that fails lists none. */
export function listedOrgs(sfOrgList: { status?: number; result?: Record<string, unknown> }): ListedOrg[] {
  if (sfOrgList.status !== 0) return [];
  return Object.values(sfOrgList.result ?? {}).filter(Array.isArray).flat() as ListedOrg[];
}

/** Each sandbox's alias on one My Domain, by its branch: the first alias in name order wins. */
export function sandboxAliases(orgs: ListedOrg[], domain: string): Map<string, ListedOrg & { alias: string }> {
  const out = new Map<string, ListedOrg & { alias: string }>();
  for (const o of [...orgs].sort((a, b) => String(a.alias).localeCompare(String(b.alias)))) {
    if (!o.alias || !o.instanceUrl) continue;
    const u = parseOrgUrl(o.instanceUrl);
    if (u.kind === 'sandbox' && u.domain === domain && !out.has(u.sandbox)) out.set(u.sandbox, o as ListedOrg & { alias: string });
  }
  return out;
}

/**
 * Each environment's usual promotion path, and the default: Developer → first Partial → first Full →
 * Production. Each may also go straight to Production. Throws when no sandbox is logged in.
 */
export function finishEnvironments(envs: RawEnv[], notes: string[]): RawEnv[] {
  const first = (t: EnvType) => envs.find((e) => e.type === t && e.org)?.name ?? envs.find((e) => e.type === t)?.name;
  const partial = first('partial');
  const full = first('full');
  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x).map(branchFor))];
  for (const e of envs) {
    if (e.type === 'developer' || e.type === 'developer_pro') e.promotesTo = uniq([partial, full, 'Production']);
    else if (e.type === 'partial') e.promotesTo = uniq([full, 'Production']);
    else if (e.type === 'full') e.promotesTo = ['production'];
  }
  const candidates = envs.filter((e) => e.org && (e.type === 'developer' || e.type === 'developer_pro'));
  const fallback = envs.filter((e) => e.org && e.type !== 'production');
  const def = candidates[0] ?? fallback[0];
  if (!def) throw new AccError('init', 'Log in to at least one sandbox first, so day-to-day work has somewhere to go.');
  def.default = true;
  if (!candidates.length) notes.push(`There's no logged-in Developer sandbox, so "${def.name}" is the default. Agents work best against a source-tracked Developer sandbox.`);
  return envs;
}

/** A My Domain as a person types it: letters, digits and dashes, the part before .my.salesforce.com. */
export const MY_DOMAIN = /^[a-z0-9-]+$/;

/**
 * The environments, without Production (D-T-125): every sandbox this person is logged in to on one My
 * Domain, and Production with no org. A sandbox the CLI tracks source for is a Developer sandbox, as only
 * those can be; any other is taken as GUESSED_TYPE, which isn't treated as source tracked, and a note says
 * so. `guessed` gets each branch whose type was guessed.
 */
export function discoverFromMyDomain(run: Runner, root: string, domain: string, notes: string[], guessed: Set<string> = new Set()): RawEnv[] {
  const d = domain.trim().toLowerCase();
  if (!MY_DOMAIN.test(d)) throw new AccError('init', `"${domain}" isn't a My Domain: give the part before .my.salesforce.com, such as acme.`);
  const sandboxes = sandboxAliases(listedOrgs(sfRun(run, root, ['org', 'list'])), d);
  if (!sandboxes.size) throw new AccError('init', `No sandbox on the ${d} My Domain is logged in. Log in to one first: sf org login web --alias "<alias>" --instance-url https://${d}--<sandbox>.sandbox.my.salesforce.com`);
  const envs: RawEnv[] = [{ name: 'Production', type: 'production', org: null, default: false, protected: true, promotesTo: [] }];
  for (const [branch, o] of [...sandboxes].sort(([a], [b]) => a.localeCompare(b))) {
    const type: EnvType = o.tracksSource === true ? 'developer' : GUESSED_TYPE;
    if (type === GUESSED_TYPE) guessed.add(branch);
    envs.push({ name: branch, type, org: o.alias, default: false, protected: false, promotesTo: [] });
  }
  notes.push(`Found ${sandboxes.size} logged-in sandbox${sandboxes.size === 1 ? '' : 'es'} on ${d}, without Production. Production is recorded with no org on this machine.`);
  const unsure = envs.filter((e) => guessed.has(e.name));
  if (unsure.length) notes.push(`Without Production's sandbox list, ${unsure.map((e) => e.name).join(', ')} ${unsure.length === 1 ? 'is' : 'are'} taken as ${GUESSED_TYPE}: correct the type in the config, or have someone with access to Production run acc setup production --org <alias>.`);
  notes.push('Sandboxes you aren\'t logged in to aren\'t listed. Someone with access to Production can add them: acc setup production --org <alias> names any that are missing.');
  return finishEnvironments(envs, notes);
}

export interface ProductionRecorded {
  org: string;
  domain: string;
  /** Sandboxes whose type Production's list corrected: `name: was → now`. */
  corrected: string[];
  /** Sandboxes Production lists that the config doesn't. */
  missing: string[];
}

/**
 * Records Production's org in a project set up without it (D-T-125): checks the alias is logged in to a
 * Production org on the sandboxes' My Domain, reads its sandbox list, corrects each listed sandbox's type to
 * Salesforce's, and names the ones the config lacks. In the settings file it changes only Production's org
 * and those types: every other key an environment has stays as the file has it.
 */
export function recordProduction(run: Runner, paths: RepoPaths, config: Config, org: string): ProductionRecorded {
  if (config.profile !== 'salesforce') throw new AccError('refused', 'Production\'s org is for Salesforce projects.');
  const prod = config.environments.find((e) => e.type === 'production');
  if (!prod) throw new AccError('refused', 'The config has no Production environment.');
  const shown = sfRun(run, paths.root, ['org', 'display', '-o', org]);
  if (shown.status !== 0) throw new AccError('refused', `"${org}" isn't logged in: ${shown.message ?? 'sf failed'}`);
  const url = parseOrgUrl(String(shown.result?.instanceUrl ?? ''));
  if (url.kind !== 'production') throw new AccError('refused', `"${org}" isn't a Production org (${shown.result?.instanceUrl}).`);
  // The sandboxes' My Domain, from those logged in here: a Production org on another My Domain isn't this project's.
  const aliases = new Set(config.environments.filter((e) => e !== prod && e.org).map((e) => e.org));
  const others = new Set(listedOrgs(sfRun(run, paths.root, ['org', 'list'])).filter((o) => o.alias && aliases.has(o.alias))
    .map((o) => parseOrgUrl(o.instanceUrl ?? '')).flatMap((u) => (u.kind === 'sandbox' && u.domain !== url.domain ? [u.domain] : [])));
  if (others.size) throw new AccError('refused', `"${org}" is on the ${url.domain} My Domain, but the project's sandboxes are on ${[...others].join(', ')}. Use the Production org of the sandboxes' My Domain.`);
  const q = sfRun(run, paths.root, ['data', 'query', '--use-tooling-api', '-q', 'SELECT SandboxName, LicenseType FROM SandboxInfo ORDER BY SandboxName', '-o', org]);
  if (q.status !== 0) throw new AccError('refused', `Couldn't read Production's sandbox list: ${q.message ?? 'sf failed'}`);
  const records: { SandboxName: string; LicenseType: string }[] = q.result?.records ?? [];
  const corrected: string[] = [];
  const missing: string[] = [];
  const types = new Map<string, EnvType>();
  for (const r of records) {
    const e = config.environments.find((x) => x.branch === branchFor(r.SandboxName));
    const type = (LICENSE_TO_TYPE[r.LicenseType] ?? GUESSED_TYPE) as EnvType;
    if (!e) { missing.push(`${r.SandboxName} (${type})`); continue; }
    if (e.type !== type) { corrected.push(`${e.name}: ${e.type} → ${type}`); types.set(e.name, type); }
  }
  // The environments as the file writes them, not as acc reads them, so nothing else in them changes.
  const raw = (JSON.parse(readFileSync(paths.config, 'utf8')) as { environments?: Record<string, unknown>[] }).environments ?? [];
  writeJsonKey(paths.config, ['environments'], raw.map((e) => (e.name === prod.name ? { ...e, org }
    : typeof e.name === 'string' && types.has(e.name) ? { ...e, type: types.get(e.name) } : e)));
  return { org, domain: url.domain, corrected, missing };
}
