import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, parseConfig } from '../config.ts';
import { parseJsonOutput, type Runner, sfEnv } from '../exec.ts';
import { repoPaths } from '../paths.ts';
import { withCloneAccount } from '../github.ts';
import type { CheckContext, CheckResult } from './types.ts';

export const pass = (detail: string): CheckResult => ({ status: 'pass', detail });
export const fail = (detail: string, fix?: string): CheckResult => (fix ? { status: 'fail', detail, fix } : { status: 'fail', detail });
export const unknown = (detail: string): CheckResult => ({ status: 'unknown', detail });
export const skip = (detail: string): CheckResult => ({ status: 'skip', detail });

export function makeContext(cwd: string, run: Runner, env: NodeJS.ProcessEnv = process.env, version: string | null = null): CheckContext {
  let paths = null;
  try {
    paths = repoPaths(cwd, run);
  } catch {
    paths = null;
  }
  let config: Config | null = null;
  let configErrors: string[] = [];
  if (paths && existsSync(paths.config)) {
    try {
      const r = parseConfig(JSON.parse(readFileSync(paths.config, 'utf8')));
      config = r.config;
      configErrors = r.errors;
    } catch (e) {
      configErrors = [`.acc/config.json isn't valid JSON: ${(e as Error).message}`];
    }
  }
  // This clone's own choice of GitHub account, when it made one, is the one every check uses (D-028).
  if (config && paths) config = withCloneAccount(config, paths.root, run);
  return { cwd, run, env, paths, config, configErrors, cache: new Map(), version };
}

export function cached<T>(ctx: CheckContext, key: string, fn: () => T): T {
  if (!ctx.cache.has(key)) ctx.cache.set(key, fn());
  return ctx.cache.get(key) as T;
}

export function versionAtLeast(version: string, min: string): boolean {
  const a = version.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Whether the acc plugin is older than acc: the one comparison A4.plugin fails on (GH-62) and Settings'
 * About says (GH-114). Only `x.y.z` against `x.y.z`: anything else, or a version not known, isn't older, so
 * nothing fails for want of a number. A newer plugin isn't older either: it does no harm.
 */
export const pluginBehind = (plugin: string | null | undefined, acc: string | null | undefined): boolean =>
  !!plugin && !!acc && SEMVER.test(plugin) && SEMVER.test(acc) && !versionAtLeast(plugin, acc);

export const firstVersion = (text: string): string | null => /(\d+\.\d+(?:\.\d+)?)/.exec(text)?.[1] ?? null;

export interface SfJson {
  status: number;
  result?: any;
  message?: string;
}

/** Runs `sf … --json` once per argument list and parses the reply. sf prints JSON even on failure. */
export function sfJson(ctx: CheckContext, args: string[]): SfJson {
  return cached(ctx, `sf ${args.join('\u0000')}`, () => {
    const r = ctx.run('sf', [...args, '--json'], { cwd: ctx.paths?.root ?? ctx.cwd, env: sfEnv(ctx.env) });
    if (r.code === 127) return { status: 127, message: 'The Salesforce CLI (sf) isn\'t installed.' };
    try {
      return parseJsonOutput<SfJson>(r.stdout);
    } catch {
      return { status: r.code || 1, message: (r.stderr || r.stdout).trim().split('\n')[0] ?? 'sf failed' };
    }
  });
}

/** Environment for gh calls made as the repo's configured account (D-007). Null when that account isn't logged in. */
export function ghEnv(ctx: CheckContext): NodeJS.ProcessEnv | null {
  const account = ctx.config?.github?.account;
  if (!account) return null;
  return cached(ctx, `gh-token ${account}`, () => {
    const t = ctx.run('gh', ['auth', 'token', '-u', account], { env: ctx.env });
    if (t.code !== 0 || !t.stdout.trim()) return null;
    return { ...ctx.env, GH_TOKEN: t.stdout.trim() };
  });
}

export type OrgUrl =
  | { kind: 'production'; domain: string }
  | { kind: 'sandbox'; domain: string; sandbox: string }
  | { kind: 'unknown' };

/** Reads the environment from an org's My Domain URL: `<domain>--<sandbox>.sandbox.my.salesforce.com` (D-015). */
export function parseOrgUrl(url: string): OrgUrl {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { kind: 'unknown' };
  }
  const sb = /^([a-z0-9-]+?)--([a-z0-9]+)\.sandbox\.my\.salesforce\.com$/.exec(host);
  if (sb) return { kind: 'sandbox', domain: sb[1]!, sandbox: sb[2]! };
  const prod = /^([a-z0-9-]+)\.my\.salesforce\.com$/.exec(host);
  if (prod) return { kind: 'production', domain: prod[1]! };
  return { kind: 'unknown' };
}

export const LICENSE_TO_TYPE: Record<string, string> = {
  DEVELOPER: 'developer',
  DEVELOPER_PRO: 'developer_pro',
  PARTIAL: 'partial',
  FULL: 'full',
};

export function readText(root: string, rel: string): string | null {
  const f = join(root, rel);
  return existsSync(f) ? readFileSync(f, 'utf8') : null;
}

/**
 * Credential values, not the words for them, so documentation and this source file don't match.
 * POSIX ERE, for `git grep -E`.
 */
export const SECRET_PATTERN = [
  'force://[A-Za-z0-9._~-]+:[^@[:space:]]+@',
  '"access_token"[[:space:]]*:[[:space:]]*"[^"]{20,}"',
  '<consumerSecret>[A-Za-z0-9]{8,}</consumerSecret>',
  '<password>[^<[:space:]]{6,}</password>',
  'sk_live_[0-9a-zA-Z]{20,}',
  '-----BEGIN [A-Z ]*PRIVATE KEY-----',
  'gh[pousr]_[0-9A-Za-z]{30,}',
  'AKIA[0-9A-Z]{16}',
].join('|');
