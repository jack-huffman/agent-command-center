import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
    '.acc/config.json': JSON.stringify(over.config ?? SF_CONFIG, null, 2),
    'README.md': '| `production` | `uat` | `dev` |\n',
    '.gitignore': '.sf/\n/*.csv\n/*.xls\n/*.xlsx\n/*.eml\n',
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
  return repo;
}

function statuses(repo: string, fixtures = healthy()): Record<string, { status: CheckStatus; detail: string }> {
  const ctx = makeContext(repo, fakeRunner(fixtures), { ...process.env, GIT_CONFIG_NOSYSTEM: '1' });
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
  assert.equal(r['B11.drift']!.status, 'skip');
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
  const ctx = makeContext(sfRepo(), fakeRunner(f), { ...process.env, GIT_CONFIG_NOSYSTEM: '1' });
  const res = runSteps(ctx).find((x) => x.step.id === 'B2.credentials')!.result;
  assert.equal(res.status, 'fail');
  assert.match(res.detail, /would push as someone-else, not work-account/);
  assert.match(res.fix ?? '', /gh auth token -u work-account/);
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
  const ctx = makeContext(tempDir(), fakeRunner(f));
  const res = runSteps(ctx, 'machine').find((x) => x.step.id === 'A1.claude')!;
  assert.equal(res.result.status, 'fail');
  assert.equal(res.step.fix?.command, 'claude update');
});

test('org URLs give the environment name (D-015)', () => {
  assert.deepEqual(parseOrgUrl('https://avalign--aleysian.sandbox.my.salesforce.com'), { kind: 'sandbox', domain: 'avalign', sandbox: 'aleysian' });
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
