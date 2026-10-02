import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { branchFor, type Environment } from '../config.ts';
import { isTrusted, mainCheckout } from '../dispatch.ts';
import { type DriftResult, driftReportPath } from '../drift.ts';
import { gatesFor } from '../gates.ts';
import {
  cached, fail, firstVersion, ghEnv, LICENSE_TO_TYPE, parseOrgUrl, pass, readText, SECRET_PATTERN, sfJson, skip, unknown, versionAtLeast,
} from './helpers.ts';
import type { CheckContext, CheckResult, Step, StepResult } from './types.ts';

const DOCS = 'docs/ONBOARDING.md';
const DATA_EXT = /\.(csv|xls|xlsx|eml)$/i;
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

export const STEPS: Step[] = [
  // ------------------------------------------------------------ Part A: this machine
  versionStep('A1.git', 'git 2.40 or later', 'Worktrees and the shared git directory need a recent git.', 'git', ['--version'], '2.40', 'brew install git'),
  versionStep('A1.node', 'Node 20 or later', 'The acc CLI runs on Node.', 'node', ['--version'], '20', 'brew install node'),
  versionStep('A1.gh', 'GitHub CLI', 'Pull requests, issues and the per-repo account all go through gh.', 'gh', ['--version'], null, 'brew install gh'),
  {
    id: 'A1.claude', part: 'machine', group: 'A1', title: 'Claude Code CLI with background sessions',
    why: 'Builders run as `claude --bg` sessions (D-009). The VSCode extension ships its own copy, so the terminal CLI can fall far behind.',
    fix: { command: 'claude update' },
    check(ctx) {
      const v = ctx.run('claude', ['--version'], { env: ctx.env });
      if (v.code === 127) return fail('claude isn\'t installed.', 'npm install -g @anthropic-ai/claude-code');
      const h = ctx.run('claude', ['--help'], { env: ctx.env });
      if (!/--bg\b/.test(h.stdout)) return fail(`claude ${firstVersion(v.stdout) ?? ''} has no --bg. Update it.`);
      return pass(`claude ${firstVersion(v.stdout) ?? ''}`.trim());
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
    fix: { command: 'gh auth login' },
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
    id: 'A4.plugin', part: 'machine', group: 'A4', title: 'The acc plugin',
    why: 'Gives every agent the acc command, the guard hooks and the skills.',
    planned: 'M6',
    check: () => skip('The plugin arrives with milestone M6.'),
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
    fix: { fromCheck: true },
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
      const helper = `git config credential.helper '' && git config --add credential.helper '!f() { test "$1" = get || exit 0; echo username=${account}; echo "password=$(gh auth token -u ${account})"; }; f'`;
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
    fix: { docs: `${DOCS}#b5-make-one-baseline-manifest-for-every-environment` },
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
    fix: { docs: `${DOCS}#b6-create-a-branch-per-environment-named-after-it-and-seed-each-from-its-org` },
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
    fix: { fromCheck: true },
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
    fix: { docs: `${DOCS}#b9-sort-out-the-environment-specific-differences` },
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
      const required = config.gates.required;
      if (!required.length) return skip('No checks are required ("gates.required" is empty).');
      const defined = gatesFor(config).map((g) => g.name);
      const undefinedGates = required.filter((n) => !defined.includes(n));
      if (undefinedGates.length) return fail(`Required, but with no command: ${undefinedGates.join(', ')}. Give each one under "gates.commands" in .acc/config.json.`);
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
    why: 'The Tasks board shows this repo\'s own tickets: a Jira project, an Azure DevOps board or GitHub Issues, signed in for this repo only (D-027). If this repo keeps its tasks in acc alone, mark this done.',
    fix: {
      vscode: 'acc.trackers.add',
      text: '"Do it" walks you through it in VSCode: pick Azure DevOps, Jira or GitHub Issues, sign in, then pick the project, team and board. It writes them to this repo\'s .acc/config.json.',
      docs: `${DOCS}#b14-connect-the-ticket-source`,
    },
    check(ctx) {
      const need = needsProject(ctx);
      if (need) return need;
      const list = ctx.config!.trackers;
      if (!list.length) return unknown('No ticket source yet, so tasks come from acc alone. Add one, or mark this done if that\'s how this repo works.');
      const names = list.map((t) => (t.kind === 'github' ? `GitHub Issues${t.repo ? ` (${t.repo})` : ''}` : t.kind === 'jira' ? `Jira ${t.project} on ${t.site}` : `Azure DevOps ${t.project} in ${t.organization}`));
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
