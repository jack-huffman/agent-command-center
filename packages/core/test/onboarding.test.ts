import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import type { RunResult } from '../src/exec.ts';
import { makeContext, parseOrgUrl } from '../src/onboarding/helpers.ts';
import { runSteps, STEPS } from '../src/onboarding/steps.ts';
import type { CheckStatus } from '../src/onboarding/types.ts';
import { fakeRunner, gitIn, makeRepo, ok, SF_CONFIG, sf, tempDir } from './support.ts';

const SANDBOX_Q = 'sf data query --use-tooling-api -q SELECT SandboxName, LicenseType FROM SandboxInfo';
const TRACK_Q = 'sf data query --use-tooling-api -q SELECT COUNT() FROM SourceMember';

/** Fixtures for a fully set-up machine and Salesforce project. Tests override single entries. */
function healthy(): Record<string, RunResult | ((o?: { env?: NodeJS.ProcessEnv }) => RunResult)> {
  return {
    'node --version': ok('v23.11.0'),
    'gh --version': ok('gh version 2.101.0 (2026-09-15)'),
    'claude --version': ok('2.1.287 (Claude Code)'),
    'claude --help': ok('  --bg, --background   Start the session in the background'),
    'sf --version': ok('@salesforce/cli/2.151.7 darwin-arm64'),
    'sf plugins': ok('code-analyzer 5.6.1'),
    'gh auth status': ok('github.com\n  ✓ Logged in to github.com account work-account (keyring)'),
    'gh auth token -u work-account': ok('tok-work'),
    'gh api user --jq .login': (o) => ok(o?.env?.GH_TOKEN === 'tok123' ? 'work-account' : 'someone-else'),
    'gh api repos/acme-co/acme-salesforce --jq .default_branch': ok('dev'),
    [`${SANDBOX_Q} -o Acme Production`]: sf({ records: [{ SandboxName: 'UAT', LicenseType: 'FULL' }, { SandboxName: 'Dev', LicenseType: 'DEVELOPER' }] }),
    'sf org display -o Acme Production': sf({ instanceUrl: 'https://acme.my.salesforce.com' }),
    'sf org display -o Acme UAT': sf({ instanceUrl: 'https://acme--uat.sandbox.my.salesforce.com' }),
    'sf org display -o Acme Dev': sf({ instanceUrl: 'https://acme--dev.sandbox.my.salesforce.com' }),
    [`${TRACK_Q} -o Acme Dev`]: sf({ totalSize: 0, records: [] }),
    'sf org list': sf({ nonScratchOrgs: [{ alias: 'Acme Dev', tracksSource: true }, { alias: 'Acme UAT', tracksSource: false }] }),
  };
}

function sfRepo(over: { config?: unknown; files?: Record<string, string> } = {}): string {
  const repo = makeRepo({
    // A fully set-up repo names its ticket source (B14).
    '.acc/config.json': JSON.stringify(over.config ?? { ...SF_CONFIG, trackers: [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME' }] }, null, 2),
    'README.md': '| `production` | `uat` | `dev` |\n',
    '.gitignore': '.sf/\n/*.csv\n/*.xls\n/*.xlsx\n/*.eml\n.claude/worktrees/\nnode_modules/\n',
    'sfdx-project.json': JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }),
    'manifest/baseline-package.xml': '<Package><types><members>A</members><members>B</members><name>ApexClass</name></types></Package>',
    'manifest/environment-specific.txt': '# env\nforce-app/main/default/settings/MyDomain.settings-meta.xml\n',
    'manifest/known-drift.txt': '# noise\nforce-app/main/default/objects/Case/Case.object-meta.xml\n',
    'force-app/main/default/settings/MyDomain.settings-meta.xml': '<x/>\n',
    'force-app/main/default/objects/Case/Case.object-meta.xml': '<x/>\n',
    ...over.files,
  });
  for (const b of ['production', 'uat', 'dev']) gitIn(repo, 'branch', b);
  gitIn(repo, 'config', 'credential.helper', '');
  gitIn(repo, 'config', '--add', 'credential.helper', '!f() { test "$1" = get || exit 0; echo username=work-account; echo password=tok123; }; f');
  mkdirSync(join(repo, '.sf'), { recursive: true });
  writeFileSync(join(repo, '.sf', 'config.json'), JSON.stringify({ 'target-org': 'Acme Dev' }));
  // The checks' tools are installed (B13), and the day-to-day org matched its branch today (B11).
  mkdirSync(join(repo, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(repo, 'node_modules', '.bin', 'prettier'), '');
  mkdirSync(join(repo, '.git', 'acc', 'drift'), { recursive: true });
  writeFileSync(join(repo, '.git', 'acc', 'drift', 'dev.json'), JSON.stringify({ env: 'dev', changed: [], added: [], ignored: 2, checkedAt: new Date().toISOString() }));
  return repo;
}

/** Claude Code state that trusts the repo, as accepting the prompt once would leave it (D-022). */
function trustDir(repo: string): string {
  const dir = tempDir('claude-state-');
  writeFileSync(join(dir, '.claude.json'), JSON.stringify({ projects: { [realpathSync(repo)]: { hasTrustDialogAccepted: true } } }));
  return dir;
}

/** Variables that point Claude Code at per-token billing (A1.claude-billing). */
const BILLING_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX'];

/** process.env without this machine's billing variables, and a Claude config folder of its own, so no check reads the real ~/.claude. */
function testEnv(over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', CLAUDE_CONFIG_DIR: tempDir('claude-state-') };
  for (const v of BILLING_VARS) delete env[v];
  return { ...env, ...over };
}

function statuses(repo: string, fixtures = healthy()): Record<string, { status: CheckStatus; detail: string }> {
  const ctx = makeContext(repo, fakeRunner(fixtures), testEnv({ CLAUDE_CONFIG_DIR: trustDir(repo) }));
  return Object.fromEntries(runSteps(ctx).map(({ step, result }) => [step.id, result]));
}

test('step ids are unique and every group matches ONBOARDING.md', () => {
  const ids = STEPS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of STEPS) {
    assert.ok(s.id.startsWith(`${s.group}.`), s.id);
    assert.match(s.group, /^[AB]\d+$/);
    assert.ok(s.why.length > 20, `${s.id} needs a why`);
  }
});

test('a fully set-up Salesforce project passes every check that can be automated', () => {
  const r = statuses(sfRepo());
  const notPassing = Object.entries(r).filter(([, v]) => v.status !== 'pass' && v.status !== 'skip');
  assert.deepEqual(notPassing.map(([id, v]) => `${id}: ${v.detail}`), []);
  assert.equal(r['B6.org-match']!.detail, 'production → acme, uat → acme--uat, dev → acme--dev');
  assert.equal(r['A4.plugin']!.status, 'skip');
  assert.equal(r['B11.drift']!.status, 'pass');
  assert.equal(r['B13.gate-tools']!.detail, 'Ready: format, validate.');
  assert.equal(r['B14.tickets']!.detail, 'Tickets come from Jira ACME on acme.atlassian.net.');
});

test('outside a repo, project steps say so instead of failing one by one', () => {
  const r = statuses(tempDir());
  assert.equal(r['B0.repo']!.status, 'fail');
  assert.equal(r['B0.config']!.status, 'skip');
  assert.equal(r['A1.git']!.status, 'pass');
  assert.equal(r['B1.orgs'], undefined, 'Salesforce steps are hidden without a Salesforce config');
});

test('a repo with no config points at acc init', () => {
  const r = statuses(makeRepo());
  assert.equal(r['B0.config']!.status, 'fail');
  assert.match(r['B0.config']!.detail, /no \.acc\/config\.json/);
  assert.equal(r['B2.identity']!.status, 'skip');
});

test('an org that points at the wrong sandbox fails the branch match (D-015)', () => {
  const f = healthy();
  f['sf org display -o Acme Dev'] = sf({ instanceUrl: 'https://acme--uat.sandbox.my.salesforce.com' });
  const r = statuses(sfRepo(), f);
  assert.equal(r['B6.org-match']!.status, 'fail');
  assert.match(r['B6.org-match']!.detail, /"Acme Dev" is the "uat" sandbox, but its branch is "dev"/);
});

test('a sandbox missing from the config, or with the wrong type, fails B1 (D-018)', () => {
  const f = healthy();
  f[`${SANDBOX_Q} -o Acme Production`] = sf({ records: [{ SandboxName: 'UAT', LicenseType: 'PARTIAL' }, { SandboxName: 'Dev', LicenseType: 'DEVELOPER' }, { SandboxName: 'Train', LicenseType: 'DEVELOPER' }] });
  const r = statuses(sfRepo(), f);
  assert.equal(r['B1.orgs']!.status, 'fail');
  assert.match(r['B1.orgs']!.detail, /Train \(developer\) isn't in the config/);
  assert.match(r['B1.orgs']!.detail, /UAT is partial in Salesforce but "full" in the config/);
});

test('an untracked Developer sandbox fails B8, with both the org and the CLI checked', () => {
  const f = healthy();
  f[`${TRACK_Q} -o Acme Dev`] = sf(null, 1);
  f['sf org list'] = sf({ nonScratchOrgs: [{ alias: 'Acme Dev', tracksSource: false }] });
  const r = statuses(sfRepo(), f);
  assert.equal(r['B8.tracking']!.status, 'fail');
  assert.equal(r['B8.cli-tracking']!.status, 'fail');
});

test('git pushing as the wrong account fails B2 and shows the repo-local helper', () => {
  const f = healthy();
  f['gh api user --jq .login'] = ok('someone-else');
  const ctx = makeContext(sfRepo(), fakeRunner(f), testEnv());
  const res = runSteps(ctx).find((x) => x.step.id === 'B2.credentials')!.result;
  assert.equal(res.status, 'fail');
  assert.match(res.detail, /would push as someone-else, not work-account/);
  assert.ok((res.fix ?? '').includes('a=$(git config --get acc.githubAccount || echo work-account)'), 'the helper follows the clone\'s account, else the project\'s (D-028)');
});

test('a blank line in a list, a tracked data file and a committed token all fail', () => {
  const token = 'gh' + 'p_' + 'a'.repeat(36);
  const repo = sfRepo({
    files: {
      'manifest/known-drift.txt': '# noise\n\nforce-app/main/default/objects/Case/Case.object-meta.xml\n',
      'force-app/main/default/classes/Secret.cls': `String t = '${token}';\n`,
    },
  });
  // Someone forces client data past the .gitignore backstop.
  writeFileSync(join(repo, 'contacts.csv'), 'name\n');
  gitIn(repo, 'add', '-f', 'contacts.csv');
  gitIn(repo, 'commit', '-q', '-m', 'oops');
  const r = statuses(repo);
  assert.match(r['B9.lists']!.detail, /blank line/);
  assert.match(r['B3.data-files']!.detail, /contacts\.csv/);
  assert.match(r['B3.secrets']!.detail, /Secret\.cls/);
});

test('the secret scan ignores documentation of the patterns, and its own source', () => {
  const repo = sfRepo({ config: { ...SF_CONFIG, secretScan: { paths: ['.'] } }, files: {
    'docs/how.md': "grep -E 'force://|access_token|<consumerSecret>[^<]+|ghp_|AKIA[0-9A-Z]{16}'\n",
  } });
  assert.equal(statuses(repo)['B3.secrets']!.status, 'pass');
});

test('GitHub default branch and local default org are checked against the default environment', () => {
  const f = healthy();
  f['gh api repos/acme-co/acme-salesforce --jq .default_branch'] = ok('production');
  const repo = sfRepo();
  writeFileSync(join(repo, '.sf', 'config.json'), JSON.stringify({ 'target-org': 'Acme Production' }));
  const r = statuses(repo, f);
  assert.match(r['B10.default-branch']!.detail, /defaults to production, not dev/);
  assert.match(r['B10.default-org']!.detail, /"Acme Production", not "Acme Dev"/);
});

test('an old CLI without --bg fails A1.claude with the update command', () => {
  const f = healthy();
  f['claude --help'] = ok('  -p, --print');
  const ctx = makeContext(tempDir(), fakeRunner(f), testEnv());
  const res = runSteps(ctx, 'machine').find((x) => x.step.id === 'A1.claude')!;
  assert.equal(res.result.status, 'fail');
  assert.equal(res.step.fix?.command, 'claude update');
});

/** A1.claude-billing with only the given environment, a temporary home folder, and the settings files given. */
function billing(o: { env?: NodeJS.ProcessEnv; home?: Record<string, unknown>; repo?: Record<string, unknown> } = {}) {
  const home = tempDir('home-');
  const write = (dir: string, files: Record<string, unknown>) => {
    for (const [rel, s] of Object.entries(files)) {
      mkdirSync(join(dir, dirname(rel)), { recursive: true });
      writeFileSync(join(dir, rel), typeof s === 'string' ? s : JSON.stringify(s));
    }
  };
  write(home, o.home ?? {});
  const cwd = o.repo ? makeRepo() : tempDir();
  write(cwd, o.repo ?? {});
  const ctx = makeContext(cwd, fakeRunner({}), { HOME: home, PATH: process.env.PATH, ...o.env });
  return runSteps(ctx, 'machine', ['A1.claude-billing'])[0]!.result;
}

test('A1.claude-billing passes when nothing points Claude Code at per-token billing', () => {
  assert.deepEqual(billing(), { status: 'pass', detail: 'Agents use your Claude subscription.' });
  const harmless = billing({
    env: { CLAUDE_CODE_USE_BEDROCK: '0', CLAUDE_CODE_USE_VERTEX: 'false' },
    home: { '.claude/settings.json': { model: 'opus' } },
    repo: { '.claude/settings.json': { permissions: { allow: ['Bash(npm test)'] }, env: { NODE_ENV: 'test', CLAUDE_CODE_USE_VERTEX: '0' } } },
  });
  assert.deepEqual(harmless, { status: 'pass', detail: 'Agents use your Claude subscription.' });
  const step = STEPS.find((s) => s.id === 'A1.claude-billing')!;
  assert.equal(step.group, 'A1');
  assert.match(step.fix?.text ?? '', /on purpose, .* is fine/);
});

test('A1.claude-billing names each source of per-token billing, and never its value', () => {
  const KEY = 'sk-ant-api03-' + 'q'.repeat(24);
  const helper = `echo ${KEY}`;
  const cases: { env?: NodeJS.ProcessEnv; home?: Record<string, unknown>; repo?: Record<string, unknown>; want: string }[] = [
    { env: { ANTHROPIC_API_KEY: KEY }, want: 'ANTHROPIC_API_KEY in the environment' },
    { env: { ANTHROPIC_AUTH_TOKEN: KEY }, want: 'ANTHROPIC_AUTH_TOKEN in the environment' },
    { env: { CLAUDE_CODE_USE_BEDROCK: '1' }, want: 'CLAUDE_CODE_USE_BEDROCK in the environment' },
    { env: { CLAUDE_CODE_USE_VERTEX: 'true' }, want: 'CLAUDE_CODE_USE_VERTEX in the environment' },
    { home: { '.claude/settings.json': { apiKeyHelper: helper } }, want: 'apiKeyHelper in ~/.claude/settings.json' },
    { home: { '.claude/settings.json': { env: { ANTHROPIC_API_KEY: KEY } } }, want: 'ANTHROPIC_API_KEY under env in ~/.claude/settings.json' },
    { home: { '.claude/settings.json': { env: { ANTHROPIC_AUTH_TOKEN: KEY } } }, want: 'ANTHROPIC_AUTH_TOKEN under env in ~/.claude/settings.json' },
    { home: { '.claude/settings.json': { env: { CLAUDE_CODE_USE_VERTEX: '1' } } }, want: 'CLAUDE_CODE_USE_VERTEX under env in ~/.claude/settings.json' },
    { repo: { '.claude/settings.json': { apiKeyHelper: helper } }, want: 'apiKeyHelper in .claude/settings.json' },
    { repo: { '.claude/settings.json': { env: { ANTHROPIC_API_KEY: KEY } } }, want: 'ANTHROPIC_API_KEY under env in .claude/settings.json' },
    { repo: { '.claude/settings.json': { env: { ANTHROPIC_AUTH_TOKEN: KEY } } }, want: 'ANTHROPIC_AUTH_TOKEN under env in .claude/settings.json' },
    { repo: { '.claude/settings.local.json': { apiKeyHelper: helper } }, want: 'apiKeyHelper in .claude/settings.local.json' },
    { repo: { '.claude/settings.local.json': { env: { ANTHROPIC_API_KEY: KEY } } }, want: 'ANTHROPIC_API_KEY under env in .claude/settings.local.json' },
    { repo: { '.claude/settings.local.json': { env: { ANTHROPIC_AUTH_TOKEN: KEY } } }, want: 'ANTHROPIC_AUTH_TOKEN under env in .claude/settings.local.json' },
    { repo: { '.claude/settings.local.json': { env: { CLAUDE_CODE_USE_BEDROCK: 'yes' } } }, want: 'CLAUDE_CODE_USE_BEDROCK under env in .claude/settings.local.json' },
  ];
  for (const { want, ...o } of cases) {
    const r = billing(o);
    assert.equal(r.status, 'fail', want);
    assert.equal(r.detail, `Agents would bill per token, not your Claude subscription: ${want}.`);
    assert.ok(!JSON.stringify(r).includes(KEY), `${want}: the value stays out of the result`);
  }
  const all = billing({
    env: { ANTHROPIC_API_KEY: KEY, CLAUDE_CODE_USE_BEDROCK: 'true' },
    home: { '.claude/settings.json': { apiKeyHelper: helper } },
    repo: { '.claude/settings.local.json': { env: { ANTHROPIC_AUTH_TOKEN: KEY } } },
  });
  assert.equal(all.detail, 'Agents would bill per token, not your Claude subscription: ANTHROPIC_API_KEY in the environment, CLAUDE_CODE_USE_BEDROCK in the environment, apiKeyHelper in ~/.claude/settings.json, ANTHROPIC_AUTH_TOKEN under env in .claude/settings.local.json.');
});

test('A1.claude-billing reads CLAUDE_CONFIG_DIR\'s settings when set, and never quotes a file it can\'t parse', () => {
  const KEY = 'sk-ant-api03-' + 'z'.repeat(24);
  const dir = tempDir('claude-config-');
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_API_KEY: KEY } }));
  const moved = billing({ env: { CLAUDE_CONFIG_DIR: dir }, home: { '.claude/settings.json': { apiKeyHelper: 'key.sh' } } });
  assert.equal(moved.detail, `Agents would bill per token, not your Claude subscription: ANTHROPIC_API_KEY under env in ${join(dir, 'settings.json')}.`);
  const broken = billing({ home: { '.claude/settings.json': `{ "env": { "ANTHROPIC_API_KEY": "${KEY}" }, }` } });
  assert.deepEqual(broken, { status: 'unknown', detail: 'Not valid JSON, so not checked: ~/.claude/settings.json.' });
  const both = billing({ env: { ANTHROPIC_API_KEY: KEY }, repo: { '.claude/settings.json': `${KEY}` } });
  assert.equal(both.status, 'fail');
  assert.equal(both.detail, 'Agents would bill per token, not your Claude subscription: ANTHROPIC_API_KEY in the environment. Not valid JSON, so not checked: .claude/settings.json.');
});

test('org URLs give the environment name (D-015)', () => {
  assert.deepEqual(parseOrgUrl('https://acme--devbox.sandbox.my.salesforce.com'), { kind: 'sandbox', domain: 'acme', sandbox: 'devbox' });
  assert.deepEqual(parseOrgUrl('https://my-co--uat.sandbox.my.salesforce.com/'), { kind: 'sandbox', domain: 'my-co', sandbox: 'uat' });
  assert.deepEqual(parseOrgUrl('https://acme.my.salesforce.com'), { kind: 'production', domain: 'acme' });
  assert.deepEqual(parseOrgUrl('not a url'), { kind: 'unknown' });
});

test('a single-environment project skips the README environment map', () => {
  const repo = makeRepo({ '.acc/config.json': JSON.stringify({ schema: 1, project: 'Tool', environments: [{ name: 'main', default: true }] }) });
  const ctx = makeContext(repo, fakeRunner({}));
  const res = runSteps(ctx, 'project').find((x) => x.step.id === 'B10.readme')!.result;
  assert.equal(res.status, 'skip');
});

test('outside a repo, B0.repo points at the project repo next to an old folder', () => {
  const parent = tempDir();
  const old = join(parent, 'Client Production');
  mkdirSync(old);
  writeFileSync(join(old, 'sfdx-project.json'), '{}');
  const repo = join(parent, 'Client');
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(repo, '.acc'));
  writeFileSync(join(repo, '.acc', 'config.json'), '{}');
  const res = runSteps(makeContext(old, fakeRunner({})), 'project').find((x) => x.step.id === 'B0.repo')!.result;
  assert.equal(res.status, 'fail');
  assert.equal(res.open, repo);
  assert.match(res.detail, /isn't a git repo. The project's repo looks like .*Client. Open that folder instead/);
  const lonely = join(tempDir(), 'Other Sandbox');
  mkdirSync(lonely);
  writeFileSync(join(lonely, 'sfdx-project.json'), '{}');
  const none = runSteps(makeContext(lonely, fakeRunner({})), 'project').find((x) => x.step.id === 'B0.repo')!.result;
  assert.equal(none.open, undefined);
  assert.match(none.detail, /isn't a git repo yet. Onboarding starts with the client's repo/);
});

test('B12.trust fails until Claude Code has been trusted in the main checkout, and B10 wants worktrees ignored', () => {
  const repo = sfRepo({ files: { '.gitignore': '.sf/\n' } });
  const ctx = makeContext(repo, fakeRunner(healthy()), { ...process.env, CLAUDE_CONFIG_DIR: tempDir('claude-state-') });
  const r = Object.fromEntries(runSteps(ctx, 'project').map(({ step, result }) => [step.id, result]));
  assert.equal(r['B12.trust']!.status, 'fail');
  assert.match(r['B12.trust']!.detail, /hasn't been trusted in/);
  assert.equal(r['B10.ignore-worktrees']!.status, 'fail');
  assert.match(r['B10.ignore-worktrees']!.fix ?? '', /\.claude\/worktrees\//);
});

test('B13 names a required check with no command, and the tools a Salesforce repo hasn\'t installed', () => {
  const missing = sfRepo({ config: { ...SF_CONFIG, gates: { required: ['format', 'lint', 'smoke'] } } });
  assert.match(statuses(missing)['B13.gate-tools']!.detail, /Required, but with no command: smoke/);
  const noLint = sfRepo({ config: { ...SF_CONFIG, gates: { required: ['format', 'lint'] } } });
  const r = statuses(noLint)['B13.gate-tools']!;
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /Not installed in .*: eslint\./);
  assert.equal(statuses(sfRepo({ config: { ...SF_CONFIG, gates: { required: ['lint'], commands: { lint: 'npm run lint' } } } }))['B13.gate-tools']!.status, 'pass', 'a command of the project\'s own needs nothing extra');
});

test('B9 accepts a listed file that only another environment\'s branch has, since every branch shares the lists', () => {
  const only = 'force-app/main/default/objects/Task/listViews/Mine.listView-meta.xml';
  const repo = sfRepo({ files: { 'manifest/known-drift.txt': `# noise\nforce-app/main/default/objects/Case/Case.object-meta.xml\n${only}\n` } });
  gitIn(repo, 'checkout', '-q', 'uat');
  mkdirSync(join(repo, 'force-app/main/default/objects/Task/listViews'), { recursive: true });
  writeFileSync(join(repo, only), '<x/>\n');
  gitIn(repo, 'add', '-A');
  gitIn(repo, 'commit', '-q', '-m', 'uat only');
  gitIn(repo, 'checkout', '-q', 'main');
  assert.equal(statuses(repo)['B9.lists']!.status, 'pass');
  const typo = sfRepo({ files: { 'manifest/known-drift.txt': '# noise\nforce-app/main/default/objects/Case/Cse.object-meta.xml\n' } });
  assert.match(statuses(typo)['B9.lists']!.detail, /lists files that don't exist: .*Cse\.object-meta\.xml/);
});

test('B14 asks for a ticket source until the repo names one, then says where tickets come from', () => {
  const none = statuses(sfRepo({ config: SF_CONFIG }))['B14.tickets']!;
  assert.deepEqual([none.status, /tasks come from acc alone/.test(none.detail)], ['unknown', true]);
  const azure = statuses(sfRepo({ config: { ...SF_CONFIG, trackers: [{ kind: 'azure', organization: 'acme', project: 'CRM' }, { kind: 'github' }] } }))['B14.tickets']!;
  assert.equal(azure.detail, 'Tickets come from Azure DevOps CRM in acme and GitHub Issues.');
});
