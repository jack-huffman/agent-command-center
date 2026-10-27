import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { branchFor, parseConfig, type Config, type EnvType, type Profile } from './config.ts';
import { credentialHelper } from './github.ts';
import { AccError, type Runner } from './exec.ts';
import { LICENSE_TO_TYPE, parseOrgUrl } from './onboarding/helpers.ts';
import { discoverFromMyDomain, finishEnvironments, listedOrgs, sandboxAliases, sfJson } from './sf-discovery.ts';
import { type LoadedTemplate, loadTemplate, overlayEnvironments, overlaySettings, pickedTracker, type Settings, templateTrackers } from './template.ts';

export interface InitOptions {
  root: string;
  /** By default the template's, else generic. One that disagrees with the template's is refused. */
  profile?: Profile;
  project?: string;
  productionOrg?: string;
  /**
   * A Salesforce project set up without access to Production (D-T-125): its environments are the sandboxes
   * logged in on this My Domain, and Production has no org. Not with productionOrg.
   */
  myDomain?: string;
  githubRepo?: string;
  githubAccount?: string;
  commitName?: string;
  commitEmail?: string;
  jiraSite?: string;
  jiraProject?: string;
  /**
   * One tracker, as a description's toConfig gives it (GH-81): a project started from an epic, an area path
   * or labels picked on the Connect page. It replaces the template's tracker and --jira-*, with a note.
   */
  tracker?: Record<string, unknown>;
  /** A team template's source (GH-80), fetched as templateAccount says. */
  from?: string;
  /** A template already read, in place of `from`. */
  template?: LoadedTemplate;
  /** Where a relative template path starts: the directory acc init ran in. */
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
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
  /** The config's keys the team template set (GH-80); empty without one. */
  fromTemplate: string[];
  /** The keys discovery found: the project, its GitHub repo and account, the commit identity, the environments. */
  discovered: string[];
  /**
   * Gate commands the template adds, which run on this machine. acc init lists them in its output, after it
   * writes; acc template show, --dry-run and Setup's confirmation list them before.
   */
  templateCommands: Record<string, string>;
  /** The rules files the template names (GH-108), which acc init copies into .acc/rules/. */
  rules: string[];
  /** The GitHub account the template was read as, so its rules are read as the same one. */
  readAs: string | null;
}

/** Proposes every Salesforce environment from Production's sandbox list and the logged-in aliases (D-018). */
export function discoverSalesforce(run: Runner, root: string, productionOrg: string, notes: string[]): RawEnv[] {
  const prod = sfJson(run, root, ['org', 'display', '-o', productionOrg]);
  if (prod.status !== 0) throw new AccError('init', `"${productionOrg}" isn't logged in: ${prod.message ?? 'sf failed'}`);
  const url = parseOrgUrl(String(prod.result?.instanceUrl ?? ''));
  if (url.kind !== 'production') throw new AccError('init', `"${productionOrg}" isn't a Production org (${prod.result?.instanceUrl}).`);

  const q = sfJson(run, root, ['data', 'query', '--use-tooling-api', '-q', 'SELECT SandboxName, LicenseType FROM SandboxInfo ORDER BY SandboxName', '-o', productionOrg]);
  if (q.status !== 0) throw new AccError('init', `Couldn't read Production's sandbox list: ${q.message ?? 'sf failed'}`);
  const sandboxes: { SandboxName: string; LicenseType: string }[] = q.result?.records ?? [];
  const aliasFor = sandboxAliases(listedOrgs(sfJson(run, root, ['org', 'list'])), url.domain);

  const envs: RawEnv[] = [{ name: 'Production', type: 'production', org: productionOrg, default: false, protected: true, promotesTo: [] }];
  for (const s of sandboxes) {
    const branch = branchFor(s.SandboxName);
    const type = (LICENSE_TO_TYPE[s.LicenseType] ?? 'partial') as EnvType;
    const org = aliasFor.get(branch)?.alias ?? null;
    if (!org) notes.push(`${s.SandboxName} (${type}) has no logged-in alias yet. Run: sf org login web --alias "<alias>" --instance-url https://${url.domain}--${branch}.sandbox.my.salesforce.com`);
    envs.push({ name: s.SandboxName, type, org, default: false, protected: false, promotesTo: [] });
  }
  return finishEnvironments(envs, notes);
}

function originRepo(run: Runner, root: string): string | undefined {
  const r = run('git', ['remote', 'get-url', 'origin'], { cwd: root });
  return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(r.stdout.trim())?.[1];
}

/** The account git currently pushes as, read without printing the token. */
export function pushingAccount(run: Runner, root: string): string | undefined {
  const fill = run('git', ['credential', 'fill'], { cwd: root, input: 'protocol=https\nhost=github.com\n\n', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const token = /^password=(.*)$/m.exec(fill.stdout)?.[1];
  if (!token) return undefined;
  const who = run('gh', ['api', 'user', '--jq', '.login'], { env: { ...process.env, GH_TOKEN: token } });
  return who.code === 0 ? who.stdout.trim() : undefined;
}

/**
 * The GitHub account gh reads a team template as (GH-80): --github-account, else the one this repo pushes as
 * when its origin is on GitHub, else gh's active account (null). acc template show and acc init --from both
 * use it, so Setup's preview and the acc init after it read as the same account. `pushing` is the account
 * this repo pushes as, when the caller has already found it.
 */
export function templateAccount(run: Runner, root: string | null, explicit?: string, pushing: () => string | undefined = () => (root ? pushingAccount(run, root) : undefined)): string | null {
  if (explicit) return explicit;
  if (!root || !originRepo(run, root)) return null;
  return pushing() ?? null;
}

export function planInit(run: Runner, opts: InitOptions): InitPlan {
  const notes: string[] = [];
  const root = opts.root;
  const gitGet = (k: string) => run('git', ['config', '--local', '--get', k], { cwd: root }).stdout.trim() || undefined;

  const repo = opts.githubRepo ?? originRepo(run, root);
  const account = opts.githubAccount ?? (repo ? pushingAccount(run, root) : undefined);
  if (repo && !account) notes.push('Couldn\'t tell which GitHub account this repo pushes as. Pass --github-account.');

  // Flags, then the team template, then discovery, then acc's defaults (D-097). The template is read by the
  // rule acc template show uses: a --github-repo with no GitHub origin doesn't pick the account.
  const readAs = opts.from && !opts.template ? templateAccount(run, root, opts.githubAccount, () => account) : null;
  const loaded = opts.template ?? (opts.from ? loadTemplate(run, opts.from, { account: readAs, env: opts.env, base: opts.cwd ?? root, home: opts.home, root }) : null);
  const t = loaded?.template ?? null;
  if (opts.profile && t?.profile && opts.profile !== t.profile) {
    throw new AccError('init', `--profile ${opts.profile} disagrees with the template's profile, ${t.profile}. Leave --profile out, or use another template.`);
  }
  const profile: Profile = opts.profile ?? t?.profile ?? 'generic';

  let environments: RawEnv[];
  // The sandboxes whose type was guessed without Production's list: a template's type wins for those.
  const guessed = new Set<string>();
  if (profile === 'salesforce') {
    if (opts.productionOrg && opts.myDomain) throw new AccError('init', 'Give --production-org or --my-domain, not both: --my-domain is for setting up without access to Production.');
    if (opts.myDomain) environments = discoverFromMyDomain(run, root, opts.myDomain, notes, guessed);
    else if (opts.productionOrg) environments = discoverSalesforce(run, root, opts.productionOrg, notes);
    else throw new AccError('init', 'A Salesforce project needs --production-org <alias>, so its sandboxes can be found, or, without access to Production, --my-domain <domain>, to find the sandboxes you\'re logged in to.');
  } else {
    const head = run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: root }).stdout.trim().replace(/^origin\//, '');
    const cur = run('git', ['branch', '--show-current'], { cwd: root }).stdout.trim();
    environments = [{ name: head || cur || 'main', type: 'none', org: null, default: true, protected: false, promotesTo: [] }];
  }

  const name = opts.commitName ?? gitGet('user.name');
  const email = opts.commitEmail ?? gitGet('user.email');
  const discovered = ['project', ...(repo && account ? ['github'] : []), ...(name && email ? ['commitIdentity'] : [])];
  if (profile === 'salesforce' || !t?.environments) discovered.push('environments');

  let settings: Settings = {
    gates: { required: profile === 'salesforce' ? ['format', 'static', 'validate', 'deploy'] : [], commands: {} },
    agents: { max: 3, permissionMode: 'acceptEdits' },
    autonomy: 'manual',
  };
  let trackers: Record<string, unknown>[] = opts.jiraSite && opts.jiraProject ? [{ kind: 'jira', site: opts.jiraSite, project: opts.jiraProject }] : [];
  const fromTemplate: string[] = [];
  if (t) {
    if (t.profile) fromTemplate.push('profile');
    if (t.environments) {
      environments = overlayEnvironments(t.environments, environments, profile, notes, opts.myDomain ? guessed : null);
      fromTemplate.push('environments');
    }
    settings = overlaySettings(t, settings);
    if (t.gates) fromTemplate.push('gates');
    if (t.tracker && !opts.tracker) {
      trackers = templateTrackers(t.tracker, { jiraSite: opts.jiraSite, jiraProject: opts.jiraProject }, notes);
      if (trackers.length) fromTemplate.push('trackers');
    }
    if (t.autonomy) fromTemplate.push('autonomy');
    if (t.agents) fromTemplate.push('agents');
  }

  // A tracker picked on the Connect page wins over the template's and --jira-*, as flags beat templates (D-097).
  if (opts.tracker) trackers = [pickedTracker(opts.tracker, { template: t?.tracker ?? null, jiraSite: opts.jiraSite, jiraProject: opts.jiraProject }, notes)];

  const listIfPresent = (rel: string) => (existsSync(join(root, rel)) ? rel : undefined);
  const raw = {
    schema: 1,
    project: opts.project ?? root.split('/').filter(Boolean).pop() ?? 'project',
    profile,
    ...(repo && account ? { github: { repo, account } } : {}),
    ...(name && email ? { commitIdentity: { name, email } } : {}),
    environments,
    ...(profile === 'salesforce' ? {
      environmentSpecific: listIfPresent('manifest/environment-specific.txt'),
      knownDrift: listIfPresent('manifest/known-drift.txt'),
    } : {}),
    trackers,
    agents: settings.agents,
    autonomy: settings.autonomy,
    worktrees: { root: null, setup: [] },
    gates: settings.gates,
    ...(loaded ? { template: loaded.record } : {}),
  };
  const parsed = parseConfig(JSON.parse(JSON.stringify(raw)));
  if (!parsed.config) {
    const what = loaded ? `The config from ${loaded.record.name} and what was discovered doesn't validate` : 'The discovered config doesn\'t validate';
    throw new AccError('init', `${what}:\n- ${parsed.errors.join('\n- ')}`);
  }
  return { config: parsed.config, notes, fromTemplate, discovered, templateCommands: { ...t?.gates?.commands }, rules: [...(t?.rules ?? [])], readAs };
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
  // It follows this clone's choice of account when there is one (D-028), and the project's otherwise.
  git('config', '--add', 'credential.helper', credentialHelper(account));
}
