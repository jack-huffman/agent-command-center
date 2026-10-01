import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { branchFor, parseConfig, type Config, type EnvType, type Profile } from './config.ts';
import { AccError, type Runner } from './exec.ts';
import { LICENSE_TO_TYPE, parseOrgUrl } from './onboarding/helpers.ts';

export interface InitOptions {
  root: string;
  profile: Profile;
  project?: string;
  productionOrg?: string;
  githubRepo?: string;
  githubAccount?: string;
  commitName?: string;
  commitEmail?: string;
  jiraSite?: string;
  jiraProject?: string;
}

export interface RawEnv {
  name: string;
  type: EnvType;
  org: string | null;
  default: boolean;
  protected: boolean;
  promotesTo: string[];
}

export interface InitPlan {
  config: Config;
  notes: string[];
}

const sfJson = (run: Runner, root: string, args: string[]): any => {
  const r = run('sf', [...args, '--json'], { cwd: root, env: { ...process.env, SF_NO_UPDATE_NOTIFIER: 'true', SF_DISABLE_TELEMETRY: 'true' } });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { status: r.code || 1, message: (r.stderr || r.stdout).trim().split('\n')[0] };
  }
};

/** Proposes every Salesforce environment from Production's sandbox list and the logged-in aliases (D-018). */
export function discoverSalesforce(run: Runner, root: string, productionOrg: string, notes: string[]): RawEnv[] {
  const prod = sfJson(run, root, ['org', 'display', '-o', productionOrg]);
  if (prod.status !== 0) throw new AccError('init', `"${productionOrg}" isn't logged in: ${prod.message ?? 'sf failed'}`);
  const url = parseOrgUrl(String(prod.result?.instanceUrl ?? ''));
  if (url.kind !== 'production') throw new AccError('init', `"${productionOrg}" isn't a Production org (${prod.result?.instanceUrl}).`);

  const q = sfJson(run, root, ['data', 'query', '--use-tooling-api', '-q', 'SELECT SandboxName, LicenseType FROM SandboxInfo ORDER BY SandboxName', '-o', productionOrg]);
  if (q.status !== 0) throw new AccError('init', `Couldn't read Production's sandbox list: ${q.message ?? 'sf failed'}`);
  const sandboxes: { SandboxName: string; LicenseType: string }[] = q.result?.records ?? [];

  const list = sfJson(run, root, ['org', 'list']);
  const orgs: { alias?: string; instanceUrl?: string }[] = list.status === 0 ? (Object.values(list.result ?? {}).filter(Array.isArray).flat() as never) : [];
  const aliasFor = new Map<string, string>();
  for (const o of [...orgs].sort((a, b) => String(a.alias).localeCompare(String(b.alias)))) {
    if (!o.alias || !o.instanceUrl) continue;
    const u = parseOrgUrl(o.instanceUrl);
    if (u.kind === 'sandbox' && u.domain === url.domain && !aliasFor.has(u.sandbox)) aliasFor.set(u.sandbox, o.alias);
  }

  const envs: RawEnv[] = [{ name: 'Production', type: 'production', org: productionOrg, default: false, protected: true, promotesTo: [] }];
  for (const s of sandboxes) {
    const branch = branchFor(s.SandboxName);
    const type = (LICENSE_TO_TYPE[s.LicenseType] ?? 'partial') as EnvType;
    const org = aliasFor.get(branch) ?? null;
    if (!org) notes.push(`${s.SandboxName} (${type}) has no logged-in alias yet. Run: sf org login web --alias "<alias>" --instance-url https://${url.domain}--${branch}.sandbox.my.salesforce.com`);
    envs.push({ name: s.SandboxName, type, org, default: false, protected: false, promotesTo: [] });
  }

  // Usual paths: Developer → first Partial → first Full → Production. Each may also go straight to Production.
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

function originRepo(run: Runner, root: string): string | undefined {
  const r = run('git', ['remote', 'get-url', 'origin'], { cwd: root });
  return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(r.stdout.trim())?.[1];
}

/** The account git currently pushes as, read without printing the token. */
function pushingAccount(run: Runner, root: string): string | undefined {
  const fill = run('git', ['credential', 'fill'], { cwd: root, input: 'protocol=https\nhost=github.com\n\n', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const token = /^password=(.*)$/m.exec(fill.stdout)?.[1];
  if (!token) return undefined;
  const who = run('gh', ['api', 'user', '--jq', '.login'], { env: { ...process.env, GH_TOKEN: token } });
  return who.code === 0 ? who.stdout.trim() : undefined;
}

export function planInit(run: Runner, opts: InitOptions): InitPlan {
  const notes: string[] = [];
  const root = opts.root;
  const gitGet = (k: string) => run('git', ['config', '--local', '--get', k], { cwd: root }).stdout.trim() || undefined;

  let environments: RawEnv[];
  if (opts.profile === 'salesforce') {
    if (!opts.productionOrg) throw new AccError('init', 'A Salesforce project needs --production-org <alias>, so its sandboxes can be found.');
    environments = discoverSalesforce(run, root, opts.productionOrg, notes);
  } else {
    const head = run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: root }).stdout.trim().replace(/^origin\//, '');
    const cur = run('git', ['branch', '--show-current'], { cwd: root }).stdout.trim();
    environments = [{ name: head || cur || 'main', type: 'none', org: null, default: true, protected: false, promotesTo: [] }];
  }

  const repo = opts.githubRepo ?? originRepo(run, root);
  const account = opts.githubAccount ?? (repo ? pushingAccount(run, root) : undefined);
  if (repo && !account) notes.push('Couldn\'t tell which GitHub account this repo pushes as. Pass --github-account.');
  const name = opts.commitName ?? gitGet('user.name');
  const email = opts.commitEmail ?? gitGet('user.email');

  const listIfPresent = (rel: string) => (existsSync(join(root, rel)) ? rel : undefined);
  const raw = {
    schema: 1,
    project: opts.project ?? root.split('/').filter(Boolean).pop() ?? 'project',
    profile: opts.profile,
    ...(repo && account ? { github: { repo, account } } : {}),
    ...(name && email ? { commitIdentity: { name, email } } : {}),
    environments,
    ...(opts.profile === 'salesforce' ? {
      environmentSpecific: listIfPresent('manifest/environment-specific.txt'),
      knownDrift: listIfPresent('manifest/known-drift.txt'),
    } : {}),
    trackers: opts.jiraSite && opts.jiraProject ? [{ kind: 'jira', site: opts.jiraSite, project: opts.jiraProject }] : [],
    agents: { max: 3, permissionMode: 'acceptEdits' },
    autonomy: 'manual',
    worktrees: { root: null, setup: [] },
    gates: { required: opts.profile === 'salesforce' ? ['format', 'static', 'validate'] : [], commands: {} },
  };
  const parsed = parseConfig(JSON.parse(JSON.stringify(raw)));
  if (!parsed.config) throw new AccError('init', `The discovered config doesn't validate:\n- ${parsed.errors.join('\n- ')}`);
  return { config: parsed.config, notes };
}

/** Sets this repo's commit identity and a credential helper pinned to its GitHub account (D-007, ONBOARDING B2). */
export function configureRepoAccess(run: Runner, root: string, account: string, identity: { name: string; email: string } | null): void {
  const git = (...args: string[]) => {
    const r = run('git', args, { cwd: root });
    if (r.code !== 0) throw new AccError('init', `git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  };
  if (identity) {
    git('config', 'user.name', identity.name);
    git('config', 'user.email', identity.email);
  }
  run('git', ['config', '--unset-all', 'credential.helper'], { cwd: root });
  git('config', 'credential.helper', '');
  git('config', '--add', 'credential.helper', `!f() { test "$1" = get || exit 0; echo username=${account}; echo "password=$(gh auth token -u ${account})"; }; f`);
}
