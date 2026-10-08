import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { branchFor, type Environment, fullGates } from '../config.ts';
import { isTrusted, mainCheckout } from '../dispatch.ts';
import { type DriftResult, driftReportPath } from '../drift.ts';
import { parseJsonOutput } from '../exec.ts';
import { gatesFor } from '../gates.ts';
import { credentialHelper } from '../github.ts';
import { rulesStatus } from '../rules.ts';
import { DATA_EXT } from '../stray-files.ts';
import { parseSource } from '../source.ts';
import { previewCommand, type ReadTemplate, readTemplate, templateDifferences } from '../template.ts';
import { orList } from '../trackers/types.ts';
import {
  cached, fail, firstVersion, ghEnv, LICENSE_TO_TYPE, parseOrgUrl, pass, readText, SECRET_PATTERN, sfJson, skip, unknown, versionAtLeast,
} from './helpers.ts';
import type { CheckContext, CheckResult, Step, StepResult } from './types.ts';

const DOCS = 'docs/ONBOARDING.md';
const GH_SIGN_IN = '"Do it" opens VSCode\'s GitHub sign-in: pick this repo\'s account, or add it, and gh gets that login, with access to GitHub Projects for the board. gh\'s active account stays as it was. In a terminal: gh auth login.';
const BACKSTOP = ['/*.csv', '/*.xls', '/*.xlsx', '/*.eml'];

/** Project steps need a repo and a valid config. This returns the reason they can't run yet, if any. */
function needsProject(ctx: CheckContext): CheckResult | null {
  if (!ctx.paths) return skip('Not inside a repo.');
  if (!ctx.config) return skip('Needs a valid .acc/config.json first (step B0).');
  return null;
}

/**
 * A repo near an old project folder: the folder itself, its siblings, or their parent. A repo that has
 * an acc config wins over one that only has sfdx-project.json. Only the filesystem is read.
 */
export function nearbyRepo(cwd: string): string | null {
  const isRepo = (d: string) => existsSync(join(d, '.git'));
  const parent = dirname(cwd);
  let siblings: string[] = [];
  try {
    siblings = readdirSync(parent, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => join(parent, e.name));
  } catch {
    siblings = [];
  }
  const candidates = [...siblings.filter((d) => d !== cwd), parent].filter(isRepo);
  return candidates.find((d) => existsSync(join(d, '.acc', 'config.json')))
    ?? candidates.find((d) => existsSync(join(d, 'sfdx-project.json')))
    ?? null;
}

/** Every file on any environment's branch, local or as the remote has it. */
function filesOnEnvironmentBranches(ctx: CheckContext): Set<string> {
  return cached(ctx, 'env-branch-files', () => {
    const files = new Set<string>();
    for (const env of ctx.config!.environments) {
      for (const ref of [`origin/${env.branch}`, env.branch]) {
        const r = ctx.run('git', ['ls-tree', '-r', '--name-only', ref], { cwd: ctx.paths!.root });
        if (r.code === 0) for (const f of r.stdout.split('\n')) if (f) files.add(f);
      }
    }
    return files;
  });
}

const sfEnvs = (ctx: CheckContext): Environment[] => (ctx.config?.environments ?? []).filter((e) => e.type !== 'none');
const devEnvs = (ctx: CheckContext): Environment[] =>
  sfEnvs(ctx).filter((e) => (e.type === 'developer' || e.type === 'developer_pro') && e.org);

/** Variables that make Claude Code bill per token: an API key, or a cloud account (Bedrock, Vertex) when true. */
const API_KEY_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
const CLOUD_VARS = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX'];
const isTrue = (v: unknown): boolean => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());

/** The billing settings in a variable map, by name. Values are only tested, never returned. */
function billingVars(vars: Record<string, unknown>): string[] {
  return [...API_KEY_VARS.filter((v) => String(vars[v] ?? '') !== ''), ...CLOUD_VARS.filter((v) => isTrue(vars[v]))];
}

/**
 * The Claude Code settings files agents read, labelled as the person knows them: the user's own (in
 * CLAUDE_CONFIG_DIR when set), and the project's in this checkout and the main checkout agents start in (D-022).
 */
function claudeSettingsFiles(ctx: CheckContext): { file: string; label: string }[] {
  const home = ctx.env.HOME || homedir();
  const tilde = (f: string) => (f.startsWith(home + sep) ? `~${f.slice(home.length)}` : f);
  const user = ctx.env.CLAUDE_CONFIG_DIR ? join(ctx.env.CLAUDE_CONFIG_DIR, 'settings.json') : join(home, '.claude', 'settings.json');
  const files = [{ file: user, label: tilde(user) }];
  if (!ctx.paths) return files;
  let main = ctx.paths.root;
  try {
    main = mainCheckout(ctx.run, ctx.paths.root);
  } catch {
    // fall back to this checkout
  }
  for (const root of new Set([ctx.paths.root, main])) {
    for (const rel of ['.claude/settings.json', '.claude/settings.local.json']) {
      files.push({ file: join(root, rel), label: root === ctx.paths.root ? rel : tilde(join(root, rel)) });
    }
  }
  return files;
}

/** What in one settings file points at per-token billing, by name. Null when it isn't valid JSON. */
function billingSettings(file: string): string[] | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  let s: { apiKeyHelper?: unknown; env?: unknown };
  try {
    s = JSON.parse(text) ?? {};
  } catch {
    // The parser's message can quote the file, and so a key: it's never shown.
    return null;
  }
  const found = s.apiKeyHelper ? ['apiKeyHelper'] : [];
  if (s.env && typeof s.env === 'object') found.push(...billingVars(s.env as Record<string, unknown>).map((v) => `${v} under env`));
  return found;
}

/**
 * The acc plugin, as this repo's marketplace lists it (.claude-plugin/marketplace.json). The repo is
 * written as a full github.com URL, the one form of it a package may hold (D-079).
 */
export const PLUGIN = { marketplace: 'agent-command-center', name: 'acc', repo: 'https://github.com/jack-huffman/agent-command-center' } as const;
const PLUGIN_ID = `${PLUGIN.name}@${PLUGIN.marketplace}`;
const MARKETPLACE_ADD = `claude plugin marketplace add ${PLUGIN.repo}`;
const PLUGIN_INSTALL = `claude plugin install ${PLUGIN_ID} --scope user`;
/** A private marketplace doesn't update itself (D-081), so the plugin is updated by hand after a release. */
const PLUGIN_UPDATE = `claude plugin marketplace update ${PLUGIN.marketplace} && claude plugin update ${PLUGIN_ID} --scope user`;
const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * A list `claude … --json` prints, such as `claude plugin list --json`. 127 when claude isn't installed,
 * and a reason when it didn't run or printed something else.
 */
function claudeJson(ctx: CheckContext, args: string[]): Record<string, unknown>[] | 127 | string {
  const r = ctx.run('claude', args, { env: ctx.env });
  if (r.code === 127) return 127;
  if (r.code !== 0) return `claude ${args.slice(0, 2).join(' ')} didn't run: ${(r.stderr || r.stdout).trim().split('\n')[0] || `exit ${r.code}`}`;
  try {
    const list = parseJsonOutput<unknown>(r.stdout);
    if (Array.isArray(list) && list.every((x) => x && typeof x === 'object')) return list as Record<string, unknown>[];
  } catch {
    // said below
  }
  return `claude ${args.slice(0, 2).join(' ')} printed something other than a list.`;
}

function versionStep(id: string, title: string, why: string, cmd: string, args: string[], min: string | null, fix: string, profiles?: Step['profiles']): Step {
  return {
    id, part: 'machine', group: 'A1', title, why, profiles, fix: { command: fix },
    check(ctx) {
      const r = ctx.run(cmd, args, { env: ctx.env });
      if (r.code === 127) return fail(`${cmd} isn't installed.`);
      if (r.code !== 0) return fail(`${cmd} didn't run: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
      const v = firstVersion(r.stdout + r.stderr);
      if (min && (!v || !versionAtLeast(v, min))) return fail(`${cmd} ${v ?? '(unknown version)'} is older than ${min}.`);
      return pass(`${cmd} ${v ?? ''}`.trim());
    },
  };
}

/**
 * What each group of steps sets up, in words. Neighbouring groups with the same name show as one section
 * on the Setup page, in the order the steps are done (D-047).
 */
export const GROUP_TITLES: Record<string, string> = {
  A1: 'Tools', A2: 'Accounts', A4: 'The acc plugin',
  B0: 'The repo', B1: 'Orgs', B2: 'GitHub account', B3: 'Client data and secrets',
  B4: 'Salesforce project', B5: 'Salesforce project', B6: 'Environment branches', B8: 'Source tracking',
  B9: 'Environment differences', B10: 'Safe defaults', B12: 'Background agents', B13: 'Background agents',
  B14: 'Tickets', B11: 'Drift',
};

export const STEPS: Step[] = [
  // ------------------------------------------------------------ Part A: this machine
  versionStep('A1.git', 'git 2.40 or later', 'Worktrees and the shared git directory need a recent git.', 'git', ['--version'], '2.40', 'brew install git'),
  // acc itself needs no Node: its launcher falls back to VSCode's runtime (D-077).
  versionStep('A1.node', 'Node 20 or later', 'The Salesforce CLI and its plugins run on Node, and npm installs them. acc itself doesn\'t need it.', 'node', ['--version'], '20', 'brew install node', ['salesforce']),
  versionStep('A1.gh', 'GitHub CLI', 'Pull requests, issues and the per-repo account all go through gh.', 'gh', ['--version'], null, 'brew install gh'),
  {
    id: 'A1.claude', part: 'machine', group: 'A1', title: 'Claude Code CLI with background sessions',
    why: 'Builders run as `claude --bg` sessions (D-009). The VSCode extension ships its own copy, so the terminal CLI can fall far behind.',
    fix: { command: 'claude update' },
    check(ctx) {
      const v = ctx.run('claude', ['--version'], { env: ctx.env });
      if (v.code === 127) return fail('claude isn\'t installed.', 'brew install --cask claude-code');
      const h = ctx.run('claude', ['--help'], { env: ctx.env });
      if (!/--bg\b/.test(h.stdout)) return fail(`claude ${firstVersion(v.stdout) ?? ''} has no --bg. Update it.`);
      return pass(`claude ${firstVersion(v.stdout) ?? ''}`.trim());
    },
  },
  {
    id: 'A1.claude-billing', part: 'machine', group: 'A1', title: 'Agents bill your Claude subscription',
    why: 'On your Claude subscription, agents\' work counts toward the plan you already pay for; with an API key, or through Bedrock or Vertex, every token they use is billed on top, and nothing else tells you.',
    fix: {
      text: 'Remove each setting the check names: take the variable out of your shell profile (such as ~/.zshrc) and open a new terminal, or delete apiKeyHelper, or the variable under "env", from the settings file it names. If Claude Code then asks you to sign in, use /login with your Claude account. Keeping one on purpose, such as a key you mean to bill per token, is fine: mark this done.',
    },
    check(ctx) {
      // Names and places only: a key's value is never read out, shown or kept.
      const found = billingVars(ctx.env).map((v) => `${v} in the environment`);
      const unreadable: string[] = [];
      for (const { file, label } of claudeSettingsFiles(ctx)) {
        const names = billingSettings(file);
        if (names) found.push(...names.map((n) => `${n} in ${label}`));
        else unreadable.push(label);
      }
      const note = unreadable.length ? `Not valid JSON, so not checked: ${unreadable.join(', ')}.` : '';
      if (found.length) return fail(`Agents would bill per token, not your Claude subscription: ${found.join(', ')}.${note && ` ${note}`}`);
      if (unreadable.length) return unknown(note);
      return pass('Agents use your Claude subscription.');
    },
  },
  versionStep('A1.sf', 'Salesforce CLI', 'Validation, retrieves and org checks use sf.', 'sf', ['--version'], null, 'npm install -g @salesforce/cli', ['salesforce']),
  {
    id: 'A1.code-analyzer', part: 'machine', group: 'A1', title: 'Salesforce Code Analyzer', profiles: ['salesforce'],
    why: 'The `static` check runs `sf code-analyzer`.', fix: { command: 'sf plugins install code-analyzer' },
    check(ctx) {
      const r = ctx.run('sf', ['plugins'], { env: { ...ctx.env, SF_NO_UPDATE_NOTIFIER: 'true' } });
      if (r.code === 127) return fail('sf isn\'t installed.');
      return /code-analyzer/.test(r.stdout) ? pass('code-analyzer plugin installed') : fail('The code-analyzer plugin isn\'t installed.');
    },
  },
  {
    id: 'A2.gh-login', part: 'machine', group: 'A2', title: 'Logged in to GitHub',
    why: 'Each repo uses its own account through `gh auth token -u`. Never `gh auth switch`, which changes every session.',
    fix: { vscode: 'acc.github.signIn', text: GH_SIGN_IN },
    check(ctx) {
      const r = ctx.run('gh', ['auth', 'status'], { env: ctx.env });
      if (r.code === 127) return fail('gh isn\'t installed.');
      const accounts = [...(r.stdout + r.stderr).matchAll(/account (\S+)/g)].map((m) => m[1]!);
      if (!accounts.length) return fail('gh isn\'t logged in to any account.');
      const want = ctx.config?.github?.account;
      if (want && !accounts.includes(want)) return fail(`gh isn't logged in as ${want}. Logged in: ${accounts.join(', ')}.`, `gh auth login   # as ${want}`);
      return pass(`Logged in as ${accounts.join(', ')}`);
    },
  },
  {
    id: 'A4.plugin', part: 'machine', group: 'A4', title: 'The acc plugin in Claude Code',
    why: 'Its hooks keep each builder inside its own worktree and away from pushes, merges and deploys, and send it back to the finish line if it stops early. It also gives agents acc\'s skills and the reviewer. It\'s installed once, for every Claude Code session, and does nothing in a repo without .acc/config.json.',
    fix: {
      command: `${MARKETPLACE_ADD} && ${PLUGIN_INSTALL}`,
      text: 'Claude Code clones this private repo with your own git credentials, so accept the invitation to it first. Sessions already running don\'t load the plugin: start a new one.',
    },
    check(ctx) {
      const list = claudeJson(ctx, ['plugin', 'list', '--json']);
      // Its Do it installs Claude Code itself: the plugin's own commands would only say claude isn't found.
      if (list === 127) return fail('claude isn\'t installed. Do A1.claude first.', 'brew install --cask claude-code');
      if (typeof list === 'string') return unknown(`Couldn't read Claude Code's plugins: ${list}`);
      const mine = list.filter((p) => p.id === PLUGIN_ID);
      const user = mine.find((p) => p.scope === 'user');
      const version = typeof user?.version === 'string' ? user.version : '(unknown version)';
      if (user?.enabled === true) {
        // Only an older plugin fails: its hooks may not know what this acc asks of builders. A newer one is fine (GH-62).
        if (ctx.version && SEMVER.test(version) && SEMVER.test(ctx.version) && !versionAtLeast(version, ctx.version)) {
          return fail(`acc ${version} is installed, older than this acc (${ctx.version}).`, PLUGIN_UPDATE);
        }
        return pass(`acc ${version}, for every Claude Code session.`);
      }
      if (user) return fail(`acc ${version} is installed but disabled.`, `claude plugin enable ${PLUGIN_ID} --scope user`);
      const scopes = [...new Set(mine.map((p) => String(p.scope)))];
      const only = scopes.length ? ` It's installed for one project only (${scopes.join(', ')} scope), not for every session.` : '';
      const markets = claudeJson(ctx, ['plugin', 'marketplace', 'list', '--json']);
      if (Array.isArray(markets) && markets.some((m) => m.name === PLUGIN.marketplace)) return fail(`acc isn't installed in Claude Code.${only}`, PLUGIN_INSTALL);
      return fail(`acc isn't installed in Claude Code, and its marketplace isn't added.${only}`, `${MARKETPLACE_ADD} && ${PLUGIN_INSTALL}`);
    },
  },

  // ------------------------------------------------------------ Part B: this project
  {
    id: 'B0.repo', part: 'project', group: 'B0', title: 'Inside the project\'s repo',
    why: 'Everything per-project hangs off the repo: config, branches, and the ledger in the git directory (D-008).',
    fix: { fromCheck: true, docs: `${DOCS}#b1-decide-where-everything-lives` },
    check(ctx) {
      if (ctx.paths) return pass(`Repo at ${ctx.paths.root}`);
      const near = nearbyRepo(ctx.cwd);
      if (near) return { status: 'fail', detail: `This folder isn't a git repo. The project's repo looks like ${near}. Open that folder instead.`, open: near };
      const sfdx = existsSync(join(ctx.cwd, 'sfdx-project.json'));
      return fail(sfdx
        ? 'This Salesforce folder isn\'t a git repo yet. Onboarding starts with the client\'s repo (guide steps B1 and B2).'
        : 'This folder isn\'t a git repo. Open the project\'s repo folder.');
    },
  },
  {
    id: 'B0.config', part: 'project', group: 'B0', title: 'Project config',
    why: '`.acc/config.json` names the environments, GitHub account and checks.',
    fix: { command: 'acc init' },
    check(ctx) {
      if (!ctx.paths) return skip('Not inside a repo.');
      if (ctx.config) {
        const n = ctx.config.environments.length;
        return pass(`${ctx.config.project}: ${ctx.config.profile}, ${n} environment${n === 1 ? '' : 's'}`);
      }
      if (!existsSync(ctx.paths.config)) return fail('There\'s no .acc/config.json yet.');
      return fail(`.acc/config.json has problems: ${ctx.configErrors.join(' ')}`);
    },
  },
  {
    id: 'B0.template', part: 'project', group: 'B0', title: 'The team template is current',
    why: 'A project started from a team template records which one. This says when the team has changed it since, and where this project now differs. It never changes .acc/config.json: applying a change is yours to do.',
    fix: { fromCheck: true, docs: `${DOCS}#b0-open-the-repo-and-give-it-a-config` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const config = ctx.config!;
      const rec = config.template;
      if (!rec) return skip('Not started from a team template.');
      const root = ctx.paths!.root;
      const home = ctx.env.HOME || homedir();
      let local: string | null = null;
      try {
        const src = parseSource(rec.source, root, home);
        if (src.kind === 'file') local = src.path;
      } catch (e) {
        return unknown(`The template's recorded source, ${rec.source}, can't be read: ${(e as Error).message}`);
      }
      if (local && !existsSync(local)) return skip(`${rec.name} is a file, ${rec.source}, that isn't on this machine.`);
      let read: ReadTemplate;
      try {
        // A short wait, for its two calls together: it runs on every Setup refresh.
        read = readTemplate(ctx.run, rec.source, { account: config.github?.account ?? null, env: ctx.env, base: root, home, timeoutMs: 20_000 });
      } catch (e) {
        return unknown(`Couldn't read ${rec.name} from ${rec.source}: ${(e as Error).message}`);
      }
      if (read.digest === rec.digest) return pass(`${rec.name}, unchanged since this project was made from it.`);
      if (!read.template) return unknown(`${rec.name} has changed since this project was made from it, and now has problems: ${read.errors.join(' ')}`);
      const diffs = templateDifferences(read.template, config, { root, home });
      if (!diffs.length) return pass(`${rec.name} has changed since this project was made from it, and this project already agrees with it.`);
      const preview = previewCommand(read.template, rec, config);
      return { status: 'unknown', detail: `${rec.name} has changed since this project was made from it, and this project differs on ${diffs.join(', ')}. The fix previews what it would write, and changes nothing.`, fix: preview };
    },
  },
  {
    id: 'B0.rules', part: 'project', group: 'B0', title: 'Copied-in rules are current',
    why: 'A team\'s shared rules are copied into .acc/rules/, each with where it came from (GH-108), and agents read only those copies. This says when a source has changed since its copy. It never copies one in again: that is yours to choose.',
    fix: { fromCheck: true, docs: `${DOCS}#b0-open-the-repo-and-give-it-a-config` },
    offer: { vscode: 'acc.importRules', label: 'Import rules…', icon: 'cloud-download' },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const root = ctx.paths!.root;
      // One short wait for every source together: it runs on every Setup refresh.
      const copies = rulesStatus(ctx.run, root, { account: ctx.config!.github?.account ?? null, env: ctx.env, home: ctx.env.HOME || homedir(), timeoutMs: 20_000 });
      const sourced = copies.filter((c) => c.state !== 'local');
      const names = (cs: typeof copies) => (cs.length < 2 ? cs.map((c) => c.file).join('') : `${cs.slice(0, -1).map((c) => c.file).join(', ')} and ${cs.at(-1)!.file}`);
      if (!sourced.length) return skip(copies.length ? `${names(copies)} ${copies.length === 1 ? 'has' : 'have'} no source to compare with.` : 'No rules are copied in. Import rules… copies a team\'s rules file into .acc/rules/.');
      const changed = copies.filter((c) => c.state === 'changed');
      const open = copies.filter((c) => c.state === 'unreachable' || c.state === 'unchecked' || c.state === 'bad-header');
      if (changed.length || open.length) {
        const detail = [
          ...(changed.length ? [`${names(changed)} ${changed.length === 1 ? 'has' : 'have'} changed at the source since ${changed.length === 1 ? 'it was' : 'they were'} copied in. The fix shows the difference and changes nothing; copying one in again is yours to choose.`] : []),
          ...open.map((c) => `${c.file}: ${c.reason}`),
        ].join(' ');
        return { status: 'unknown', detail, ...(changed.length ? { fix: `acc rules diff${changed.length === 1 ? ` ${changed[0]!.name}` : ''}` } : {}) };
      }
      const same = copies.filter((c) => c.state === 'unchanged');
      const away = copies.filter((c) => c.state === 'not-here');
      if (!same.length) return skip(`${names(away)} came from ${away.length === 1 ? 'a file that isn\'t' : 'files that aren\'t'} on this machine.`);
      const edited = same.filter((c) => c.edited);
      return pass([
        `${names(same)}: unchanged at ${same.length === 1 ? 'its source' : 'their sources'}.`,
        ...(edited.length ? [`${names(edited)} ${edited.length === 1 ? 'was' : 'were'} edited here, as a copy may be.`] : []),
        ...(away.length ? [`${names(away)} came from ${away.length === 1 ? 'a file that isn\'t' : 'files that aren\'t'} on this machine.`] : []),
      ].join(' '));
    },
  },
  {
    id: 'B1.orgs', part: 'project', group: 'B1', title: 'Every org is listed', profiles: ['salesforce'],
    why: 'Pipelines differ by client, so the config lists every sandbox Production has, with its type (D-018).',
    fix: { command: 'acc init --force' },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const prod = ctx.config!.environments.find((e) => e.type === 'production');
      if (!prod) return fail('There\'s no Production environment.');
      if (!prod.org) return fail('Production has no org alias.');
      const q = sfJson(ctx, ['data', 'query', '--use-tooling-api', '-q', 'SELECT SandboxName, LicenseType FROM SandboxInfo', '-o', prod.org]);
      if (q.status !== 0) return unknown(`Couldn't read Production's sandbox list: ${q.message ?? 'sf failed'}`);
      const records: { SandboxName: string; LicenseType: string }[] = q.result?.records ?? [];
      const problems: string[] = [];
      const listed: string[] = [];
      for (const r of records) {
        const env = ctx.config!.environments.find((e) => e.branch === branchFor(r.SandboxName));
        const type = LICENSE_TO_TYPE[r.LicenseType] ?? r.LicenseType.toLowerCase();
        if (!env) problems.push(`${r.SandboxName} (${type}) isn't in the config.`);
        else if (env.type !== type) problems.push(`${env.name} is ${type} in Salesforce but "${env.type}" in the config.`);
        else listed.push(`${env.branch} (${type})`);
      }
      const known = new Set(records.map((r) => branchFor(r.SandboxName)));
      for (const e of ctx.config!.environments) {
        if (e.type !== 'production' && e.type !== 'none' && !known.has(e.branch)) problems.push(`${e.name} is in the config but not in Production's sandbox list.`);
      }
      return problems.length ? fail(problems.join(' ')) : pass(`All ${records.length} sandboxes are listed: ${listed.join(', ')}`);
    },
  },
  {
    id: 'B2.identity', part: 'project', group: 'B2', title: 'Commit identity',
    why: 'Commits in this repo carry its own name and email, set in the repo only.',
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const want = ctx.config!.commitIdentity;
      if (!want) return skip('No commitIdentity in the config.');
      const get = (k: string) => ctx.run('git', ['config', '--local', '--get', k], { cwd: ctx.paths!.root }).stdout.trim();
      const name = get('user.name');
      const email = get('user.email');
      if (name === want.name && email === want.email) return pass(`${name} <${email}>`);
      return fail(`Commits would be ${name || '(no name)'} <${email || 'no email'}>, not ${want.name} <${want.email}>.`,
        `git config user.name "${want.name}" && git config user.email "${want.email}"`);
    },
  },
  {
    id: 'B2.account', part: 'project', group: 'B2', title: 'The repo\'s GitHub account is logged in',
    why: 'acc runs every gh call for this repo as its own account (D-007).',
    fix: { vscode: 'acc.github.signIn', text: GH_SIGN_IN },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const account = ctx.config!.github?.account;
      if (!account) return skip('No GitHub account in the config.');
      return ghEnv(ctx) ? pass(`gh can act as ${account}`) : fail(`gh isn't logged in as ${account}.`, `gh auth login   # as ${account}`);
    },
  },
  {
    id: 'B2.credentials', part: 'project', group: 'B2', title: 'git pushes as the right account',
    why: 'gh\'s own credential helper ignores the username and uses the active account, so a repo can silently push as the wrong one.',
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const account = ctx.config!.github?.account;
      if (!account) return skip('No GitHub account in the config.');
      const helper = `git config credential.helper '' && git config --add credential.helper '${credentialHelper(ctx.config!.github!.account)}'`;
      const fill = ctx.run('git', ['credential', 'fill'], {
        cwd: ctx.paths!.root, input: 'protocol=https\nhost=github.com\n\n', env: { ...ctx.env, GIT_TERMINAL_PROMPT: '0' },
      });
      const token = /^password=(.*)$/m.exec(fill.stdout)?.[1];
      if (fill.code !== 0 || !token) return fail('git has no GitHub credential for this repo.', helper);
      const who = ctx.run('gh', ['api', 'user', '--jq', '.login'], { env: { ...ctx.env, GH_TOKEN: token } });
      const login = who.stdout.trim();
      if (who.code !== 0) return unknown('git returned a credential, but GitHub didn\'t accept it.');
      return login === account ? pass(`git pushes as ${login}`) : fail(`git would push as ${login}, not ${account}.`, helper);
    },
  },
  {
    id: 'B3.gitignore', part: 'project', group: 'B3', title: 'Client data blocked at the repo root', profiles: ['salesforce'],
    why: 'A backstop. The real safeguard is keeping client data in the Working Files folder.',
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const lines = new Set((readText(ctx.paths!.root, '.gitignore') ?? '').split('\n').map((l) => l.trim()));
      const missing = BACKSTOP.filter((p) => !lines.has(p));
      return missing.length ? fail(`.gitignore is missing ${missing.join(', ')}.`, `printf '${missing.join('\\n')}\\n' >> .gitignore`) : pass('CSV, XLS, XLSX and EML are blocked at the root.');
    },
  },
  {
    id: 'B3.data-files', part: 'project', group: 'B3', title: 'No client data files in git', profiles: ['salesforce'],
    why: 'Contact imports and workbooks belong in the Working Files folder, outside the repo.',
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const files = ctx.run('git', ['ls-files'], { cwd: ctx.paths!.root }).stdout.split('\n').filter((f) => f && !f.includes('/') && DATA_EXT.test(f));
      return files.length ? fail(`Tracked data files: ${files.join(', ')}.`, `git rm --cached ${files.map((f) => JSON.stringify(f)).join(' ')}`) : pass('No data files at the repo root.');
    },
  },
  {
    id: 'B3.secrets', part: 'project', group: 'B3', title: 'No credentials in tracked files',
    why: 'Org auth URLs, tokens and private keys must never be committed.',
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const scan = ctx.config!.secretScan;
      const spec = [...scan.paths, ...scan.exclude.map((x) => `:(exclude)${x}`)];
      const r = ctx.run('git', ['grep', '-I', '-l', '-E', SECRET_PATTERN, '--', ...spec], { cwd: ctx.paths!.root });
      if (r.code === 1) return pass(`No credentials found (scanned: ${scan.paths.join(', ')})`);
      if (r.code === 0) return fail(`Possible credentials in: ${r.stdout.trim().split('\n').join(', ')}.`, 'Remove them, rotate the credential, and rewrite history if it was pushed.');
      return unknown(`The scan didn't run: ${r.stderr.trim().split('\n')[0]}`);
    },
  },
  {
    id: 'B4.skeleton', part: 'project', group: 'B4', title: 'Salesforce project skeleton', profiles: ['salesforce'],
    why: 'sfdx-project.json defines the source folders, and local tool state must stay out of git.',
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const sfdx = readText(ctx.paths!.root, 'sfdx-project.json');
      if (!sfdx) return fail('There\'s no sfdx-project.json.');
      const local = ctx.run('git', ['ls-files', '.sf', '.sfdx', '.claude/settings.local.json'], { cwd: ctx.paths!.root }).stdout.trim();
      if (local) return fail(`Local tool state is tracked: ${local.split('\n').join(', ')}.`, 'git rm -r --cached .sf .sfdx');
      try {
        const dirs = (JSON.parse(sfdx).packageDirectories ?? []).map((d: { path: string }) => d.path);
        return pass(`Source in ${dirs.join(', ') || '(none listed)'}`);
      } catch {
        return fail('sfdx-project.json isn\'t valid JSON.');
      }
    },
  },
  {
    id: 'B5.baseline', part: 'project', group: 'B5', title: 'Baseline manifest', profiles: ['salesforce'],
    why: 'Every branch is retrieved with the same component list, so a diff between branches is real drift.',
    fix: { command: 'acc setup baseline', text: '"Do it" lists the components on every environment branch with sf, and writes the union to manifest/baseline-package.xml. Commit it on each branch.', docs: `${DOCS}#b5-make-one-baseline-manifest-for-every-environment` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const xml = readText(ctx.paths!.root, 'manifest/baseline-package.xml');
      if (!xml) return fail('There\'s no manifest/baseline-package.xml.');
      const members = (xml.match(/<members>/g) ?? []).length;
      return members ? pass(`${members} components`) : fail('manifest/baseline-package.xml lists no components.');
    },
  },
  {
    id: 'B6.branches', part: 'project', group: 'B6', title: 'A branch for every environment',
    why: 'Each environment has its own branch, named after it (D-015).',
    fix: { command: 'acc setup branches', text: '"Do it" makes each missing branch: production\'s from this checkout, then each sandbox\'s from it, each retrieved from its own org (read only). Nothing is pushed until you push it.', docs: `${DOCS}#b6-create-a-branch-per-environment-named-after-it-and-seed-each-from-its-org` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const has = (ref: string) => ctx.run('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: ctx.paths!.root }).code === 0;
      const missing = ctx.config!.environments.filter((e) => !has(`refs/heads/${e.branch}`) && !has(`refs/remotes/origin/${e.branch}`)).map((e) => e.branch);
      return missing.length ? fail(`No branch for ${missing.join(', ')}.`) : pass(ctx.config!.environments.map((e) => e.branch).join(', '));
    },
  },
  {
    id: 'B6.org-match', part: 'project', group: 'B6', title: 'Each branch points at the right org', profiles: ['salesforce'],
    why: 'A sandbox\'s name is in its URL, so the tool can prove a branch deploys where its name says (D-015).',
    fix: { vscode: 'acc.sf.login', text: '"Do it" checks each environment\'s org, lists the ones that need a login first, and opens Salesforce\'s login for the one you pick, at the URL its name implies. Nothing to type: you sign in in the browser.' },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const problems: string[] = [];
      const ok: string[] = [];
      for (const e of sfEnvs(ctx)) {
        if (!e.org) { problems.push(`${e.name} has no org alias.`); continue; }
        const d = sfJson(ctx, ['org', 'display', '-o', e.org]);
        if (d.status !== 0) { problems.push(`"${e.org}" isn't logged in (${d.message ?? 'sf failed'}).`); continue; }
        const url = parseOrgUrl(String(d.result?.instanceUrl ?? ''));
        if (e.type === 'production') {
          if (url.kind !== 'production') problems.push(`"${e.org}" isn't a Production org.`);
          else ok.push(`${e.branch} → ${url.domain}`);
        } else if (url.kind !== 'sandbox') problems.push(`"${e.org}" isn't a sandbox.`);
        else if (url.sandbox !== e.branch) problems.push(`"${e.org}" is the "${url.sandbox}" sandbox, but its branch is "${e.branch}".`);
        else ok.push(`${e.branch} → ${url.domain}--${url.sandbox}`);
      }
      return problems.length ? fail(problems.join(' '), 'sf org login web --alias "<alias>" --instance-url <My Domain URL>') : pass(ok.join(', '));
    },
  },
  {
    id: 'B8.tracking', part: 'project', group: 'B8', title: 'Developer sandboxes are source tracked', profiles: ['salesforce'],
    why: 'A Developer sandbox is tracked only if tracking was on when it was created, or switched on inside it afterwards.',
    fix: {
      text: 'Log in to the sandbox: Setup → Sandbox Settings → Enable Source Tracking in This Sandbox.',
      setupPath: '/lightning/setup/SetupOneHome/home',
      docs: 'https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-setup-enable-source-tracking-sandboxes.html',
    },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const envs = devEnvs(ctx);
      if (!envs.length) return skip('No Developer sandboxes in this project.');
      const off = envs.filter((e) => sfJson(ctx, ['data', 'query', '--use-tooling-api', '-q', 'SELECT COUNT() FROM SourceMember', '-o', e.org!]).status !== 0);
      return off.length ? fail(`Not tracked: ${off.map((e) => e.name).join(', ')}.`) : pass(`Tracked: ${envs.map((e) => e.name).join(', ')}`);
    },
  },
  {
    id: 'B8.cli-tracking', part: 'project', group: 'B8', title: 'The CLI knows they\'re tracked', profiles: ['salesforce'],
    why: 'An org logged in before tracking was switched on is remembered as untracked.',
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const envs = devEnvs(ctx);
      if (!envs.length) return skip('No Developer sandboxes in this project.');
      const list = sfJson(ctx, ['org', 'list']);
      if (list.status !== 0) return unknown(`Couldn't list orgs: ${list.message ?? 'sf failed'}`);
      const all: { alias?: string; tracksSource?: boolean }[] = Object.values(list.result ?? {}).filter(Array.isArray).flat() as never;
      const off = envs.filter((e) => !all.some((o) => o.alias === e.org && o.tracksSource === true));
      return off.length
        ? fail(`The CLI treats ${off.map((e) => `"${e.org}"`).join(', ')} as untracked.`, off.map((e) => `sf org enable tracking -o "${e.org}"`).join(' && '))
        : pass('The CLI tracks source for every Developer sandbox.');
    },
  },
  {
    id: 'B9.lists', part: 'project', group: 'B9', title: 'Environment-specific and known-drift lists', profiles: ['salesforce'],
    why: 'Environment config is never promoted or deployed (D-016), and drift checks need to know what differs by design.',
    fix: { command: 'acc setup lists', text: '"Do it" drafts both lists from how each sandbox\'s branch differs from production\'s, and names the differences neither explains. It never overwrites a list you have.', docs: `${DOCS}#b9-sort-out-the-environment-specific-differences` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const problems: string[] = [];
      const counts: string[] = [];
      for (const [label, rel] of [['environment-specific', ctx.config!.environmentSpecific], ['known-drift', ctx.config!.knownDrift]] as const) {
        if (!rel) { problems.push(`No ${label} list in the config.`); continue; }
        const text = readText(ctx.paths!.root, rel);
        if (text === null) { problems.push(`${rel} doesn't exist.`); continue; }
        const lines = text.replace(/\n$/, '').split('\n');
        if (lines.some((l) => l.trim() === '')) problems.push(`${rel} has a blank line. As a grep pattern, that matches everything.`);
        const paths = lines.filter((l) => l.trim() && !l.startsWith('#'));
        // Every environment's branch shares these lists (B10), so a path need only exist on one of them.
        const here = paths.filter((p) => !existsSync(join(ctx.paths!.root, p)));
        const elsewhere = here.length ? filesOnEnvironmentBranches(ctx) : new Set<string>();
        const gone = here.filter((p) => !elsewhere.has(p));
        if (gone.length) problems.push(`${rel} lists files that don't exist: ${gone.slice(0, 3).join(', ')}${gone.length > 3 ? ' …' : ''}.`);
        counts.push(`${paths.length} ${label}`);
      }
      return problems.length ? fail(problems.join(' ')) : pass(counts.join(', '));
    },
  },
  {
    id: 'B10.default-branch', part: 'project', group: 'B10', title: 'GitHub\'s default branch is the day-to-day one',
    why: 'New pull requests then target day-to-day work, not a protected environment.',
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const gh = ctx.config!.github;
      if (!gh) return skip('No GitHub repo in the config.');
      const env = ghEnv(ctx);
      if (!env) return unknown(`gh isn't logged in as ${gh.account}.`);
      const want = ctx.config!.environments.find((e) => e.default)!.branch;
      const r = ctx.run('gh', ['api', `repos/${gh.repo}`, '--jq', '.default_branch'], { env });
      if (r.code !== 0) return unknown(`Couldn't read ${gh.repo}: ${r.stderr.trim().split('\n')[0]}`);
      const got = r.stdout.trim();
      return got === want ? pass(`${gh.repo} defaults to ${got}`) : fail(`${gh.repo} defaults to ${got}, not ${want}.`, `gh repo edit ${gh.repo} --default-branch ${want}`);
    },
  },
  {
    id: 'B10.default-org', part: 'project', group: 'B10', title: 'The local default org is the day-to-day one', profiles: ['salesforce'],
    why: 'A deploy without --target-org then can\'t reach Production.',
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const want = ctx.config!.environments.find((e) => e.default)!.org;
      if (!want) return fail('The default environment has no org alias.');
      let got: string | undefined;
      try {
        got = JSON.parse(readText(ctx.paths!.root, '.sf/config.json') ?? '{}')['target-org'];
      } catch {
        got = undefined;
      }
      return got === want ? pass(`Default org: ${got}`) : fail(`The default org is ${got ? `"${got}"` : 'not set'}, not "${want}".`, `sf config set target-org "${want}"`);
    },
  },
  {
    id: 'B10.ignore-worktrees', part: 'project', group: 'B10', title: 'Task worktrees are git-ignored',
    why: 'Task worktrees live in .claude/worktrees/ inside the repo (D-022). Ignoring it keeps them out of your main checkout\'s changes and out of VSCode search.',
    fix: { fromCheck: true },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const r = ctx.run('git', ['check-ignore', '-q', '.claude/worktrees/probe'], { cwd: ctx.paths!.root });
      return r.code === 0 ? pass('.claude/worktrees/ is ignored.') : fail('.claude/worktrees/ isn\'t in .gitignore.', "printf '.claude/worktrees/\\n' >> .gitignore");
    },
  },
  {
    id: 'B10.readme', part: 'project', group: 'B10', title: 'README names every environment',
    why: 'Anyone opening the repo sees which branch is which org, and how changes flow.',
    fix: { command: 'acc setup readme', text: '"Do it" writes the environments table and promotion flow between markers in README.md, leaving the rest as it is. Run it again after changing the environments.' },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      if (ctx.config!.environments.length < 2) return skip('Only one environment, so there\'s no map to document.');
      const text = readText(ctx.paths!.root, 'README.md');
      if (!text) return fail('There\'s no README.md.');
      const missing = ctx.config!.environments.filter((e) => !text.includes(`\`${e.branch}\``)).map((e) => e.branch);
      return missing.length ? fail(`README.md doesn't mention ${missing.join(', ')}.`) : pass('Every environment is in the README.');
    },
  },
  {
    id: 'B12.trust', part: 'project', group: 'B12', title: 'Claude Code trusts the repo for background agents',
    why: 'Background agents start in the main checkout, and Claude Code only starts one in a folder you\'ve trusted. VSCode\'s own Claude sessions don\'t record this, so it takes one run of claude in a terminal.',
    fix: { command: 'claude', text: 'In the terminal that opens, accept the "trust this folder" prompt, then type /exit.' },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      let main = ctx.paths!.root;
      try {
        main = mainCheckout(ctx.run, ctx.paths!.root);
      } catch {
        // fall back to this checkout
      }
      return isTrusted(main, ctx.env) ? pass(`Trusted: ${main}`) : fail(`Claude Code hasn't been trusted in ${main} yet.`, 'claude   # then accept the trust prompt and type /exit');
    },
  },
  {
    id: 'B13.gate-tools', part: 'project', group: 'B13', title: 'The required checks can run',
    why: 'acc done waits for every required check to pass, and a check whose tool is missing can only report an error.',
    fix: { fromCheck: true, docs: `${DOCS}#b13-make-sure-the-checks-can-run` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const config = ctx.config!;
      const required = fullGates(config);
      if (!required.length) return skip('No checks are required ("gates.required" is empty, and "strayFiles.required" is false).');
      const defined = gatesFor(config).map((g) => g.name);
      const undefinedGates = required.filter((n) => !defined.includes(n));
      if (undefinedGates.length) return fail(`Required, but with no command: ${undefinedGates.join(', ')}. Give each one under "gates.commands" in .acc/config.json.`);
      // A builder's lighter checks, where the merge queue runs the required ones (GH-73).
      const builderOnly = (config.gates.builder ?? []).filter((n) => !defined.includes(n));
      if (builderOnly.length) return fail(`Listed for builders, but with no command: ${builderOnly.join(', ')}. Give each one under "gates.commands" in .acc/config.json.`);
      let main = ctx.paths!.root;
      try {
        main = mainCheckout(ctx.run, ctx.paths!.root);
      } catch {
        // fall back to this checkout
      }
      // The Salesforce built-ins use the repo's own Node tools; task worktrees share the main checkout's node_modules.
      const TOOLS: Record<string, string> = { format: 'prettier', lint: 'eslint', 'lwc-tests': 'sfdx-lwc-jest' };
      const absent = config.profile !== 'salesforce' ? [] : required
        .filter((n) => TOOLS[n] && !config.gates.commands[n] && !existsSync(join(main, 'node_modules', '.bin', TOOLS[n]!)))
        .map((n) => TOOLS[n]!);
      if (absent.length) return fail(`Not installed in ${main}: ${absent.join(', ')}.`, `cd "${main}" && npm install`);
      return pass(`Ready: ${required.join(', ')}.`);
    },
  },
  {
    id: 'B14.tickets', part: 'project', group: 'B14', title: 'The repo\'s ticket source',
    why: 'The Tasks board shows this repo\'s own tickets: a Jira project, an Azure DevOps board, a monday.com board or GitHub Issues, signed in on this machine for this repo, or for every project on the same site. If this repo keeps its tasks in acc alone, mark this done.',
    fix: {
      vscode: 'acc.trackers.add',
      confirm: true,
      text: '"Do it" opens the Connect page in the Command Center: pick Jira, GitHub Issues, Azure DevOps or monday.com, sign in and test the connection, then pick the project or board, which of its tickets are this repo\'s (an epic, labels, an area path or a group, or the whole of it) and the board\'s columns. Save writes them to this repo\'s .acc/config.json.',
      docs: `${DOCS}#b14-connect-the-ticket-source`,
    },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const list = ctx.config!.trackers;
      if (!list.length) return unknown('No ticket source yet, so tasks come from acc alone. Add one, or mark this done if that\'s how this repo works.');
      // With its place, when it's narrower than the project (D-072).
      const names = list.map((t) => (t.kind === 'github' ? `GitHub Issues${t.repo ? ` (${t.repo})` : ''}${t.labels.length ? ` labelled ${orList(t.labels)}` : ''}`
        : t.kind === 'jira' ? `Jira ${t.project} on ${t.site}${t.epic ? `, epic ${t.epic}` : ''}`
          : t.kind === 'monday' ? `monday.com board ${t.board} in ${t.account}${t.group ? `, group ${t.group}` : ''}`
            : `Azure DevOps ${t.project} in ${t.organization}${t.areaPath ? `, area ${t.areaPath}` : ''}`));
      return pass(`Tickets come from ${names.join(' and ')}.`);
    },
  },
  {
    id: 'B11.drift', part: 'project', group: 'B11', title: 'The day-to-day org matches its branch', profiles: ['salesforce'],
    why: 'A change made straight in an org is lost the next time its branch is deployed there. A drift check finds it first.',
    fix: { fromCheck: true, docs: `${DOCS}#b11-drift-check-any-time` },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const env = ctx.config!.environments.find((e) => e.default)!;
      if (!env.org) return skip(`${env.name} has no org.`);
      const cmd = `acc drift ${env.branch}`;
      let report: DriftResult | null = null;
      try {
        report = JSON.parse(readFileSync(driftReportPath(ctx.paths!, env.branch), 'utf8')) as DriftResult;
      } catch {
        report = null;
      }
      if (!report) return { status: 'unknown', detail: `${env.org} hasn't been compared with ${env.branch} yet. It takes a few minutes and only reads the org.`, fix: cmd };
      const days = Math.floor((Date.now() - Date.parse(report.checkedAt)) / 86_400_000);
      const when = days < 1 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
      const found = report.changed.length + report.added.length + (report.missing?.length ?? 0);
      if (found) return fail(`${env.org} had ${found} difference${found === 1 ? '' : 's'} from ${env.branch} when checked ${when}. Look with: ${cmd} --keep`, cmd);
      if (days > 14) return { status: 'unknown', detail: `${env.org} matched ${env.branch} ${when}. Check again; orgs change.`, fix: cmd };
      return pass(`${env.org} matched ${env.branch} ${when}${report.ignored ? `, apart from ${report.ignored} expected differences` : ''}.`);
    },
  },
];

export function applies(step: Step, ctx: CheckContext): boolean {
  if (!step.profiles) return true;
  if (!ctx.config) return step.part === 'machine';
  return step.profiles.includes(ctx.config.profile);
}

export function runSteps(ctx: CheckContext, part?: Step['part'], only?: string[]): StepResult[] {
  return STEPS.filter((s) => (!part || s.part === part) && (!only?.length || only.includes(s.id)) && applies(s, ctx)).map((step) => {
    try {
      return { step, result: step.check(ctx) };
    } catch (e) {
      return { step, result: unknown(`The check failed to run: ${(e as Error).message}`) };
    }
  });
}
