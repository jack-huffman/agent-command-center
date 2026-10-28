import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { run, type RunResult } from '../src/exec.ts';
import { makeContext, parseOrgUrl, pluginBehind } from '../src/onboarding/helpers.ts';
import { fixFor as stepFix, NEARBY_LIMIT, nearbyFolders, nearbyRepo, PLUGIN, runSteps, STEPS, userPlugin } from '../src/onboarding/steps.ts';
import type { CheckStatus } from '../src/onboarding/types.ts';
import { repoPaths } from '../src/paths.ts';
import { importRules, renderHeader, rulesDigest } from '../src/rules.ts';
import { writeReadme } from '../src/setup.ts';
import { NO_TRACKING_REASON } from '../src/source-tracking.ts';
import { templateDigest } from '../src/template.ts';
import { fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, NO_FILES, ok, SF_CONFIG, sf, tempDir } from './support.ts';

const SANDBOX_Q = 'sf data query --use-tooling-api -q SELECT SandboxName, LicenseType FROM SandboxInfo';
const TRACK_Q = 'sf data query --use-tooling-api -q SELECT COUNT() FROM SourceMember';

/** Fixtures for a fully set-up machine and Salesforce project. Tests override single entries. */
function healthy(): Record<string, RunResult | ((o?: { env?: NodeJS.ProcessEnv }) => RunResult)> {
  return {
    'brew --version': ok('Homebrew 4.5.0'),
    'node --version': ok('v23.11.0'),
    'npm --version': ok('11.6.2'),
    'java -version': { code: 0, stdout: '', stderr: 'openjdk version "21.0.4" 2024-07-16 LTS' },
    'python3 --version': ok('Python 3.12.7'),
    'gh --version': ok('gh version 2.101.0 (2026-09-15)'),
    'claude --version': ok('2.1.287 (Claude Code)'),
    'claude --help': ok('  --bg, --background   Start the session in the background'),
    'claude plugin list --json': ok(JSON.stringify([{ id: 'acc@agent-command-center', version: '0.35.0', scope: 'user', enabled: true, installPath: '/tmp/plugins/cache/acc/0.35.0' }])),
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
  // A Mac's, as the fixtures are, whatever runs the test: Windows has steps of its own (winget, Git's sh), T-133.
  const ctx = { ...makeContext(repo, fakeRunner(fixtures), testEnv({ CLAUDE_CONFIG_DIR: trustDir(repo) })), system: 'mac' as const, platform: 'darwin' as const };
  return Object.fromEntries(runSteps(ctx).map(({ step, result }) => [step.id, result]));
}

test('step ids are unique, and each starts with its group', () => {
  const ids = STEPS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of STEPS) {
    assert.ok(s.id.startsWith(`${s.group}.`), s.id);
    assert.match(s.group, /^[AB]\d+$/);
    assert.ok(s.why.length > 20, `${s.id} needs a why`);
  }
});

const ROOT = join(import.meta.dirname, '..', '..', '..');
const doc = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Every step ONBOARDING.md names, as [id, title], in its order: it writes each one as **title** (`id`). */
const guideSteps = (md: string): [string, string][] =>
  [...md.matchAll(/\*\*([^*]+)\*\*\s+\(`([AB]\d+\.[\w-]+)`\)/g)].map((m) => [m[2]!, m[1]!.replace(/\s+/g, ' ').trim()]);

/** A heading's anchor, as GitHub and VSCode's preview make it. */
const slug = (heading: string) => heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
const anchors = (md: string) => new Set([...md.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1]!)));

test('ONBOARDING.md names every step by its id and title, in the walkthrough\'s order', () => {
  const want = STEPS.map((s): [string, string] => [s.id, s.title]);
  const got = guideSteps(doc('docs/ONBOARDING.md'));
  const title = new Map(want);
  const missing = want.filter(([id]) => !got.some(([g]) => g === id)).map(([id]) => id);
  const extra = got.filter(([id]) => !title.has(id)).map(([id]) => id);
  const mismatched = got.filter(([id, t]) => title.has(id) && title.get(id) !== t).map(([id, t]) => `${id} is "${t}", not "${title.get(id)}"`);
  assert.deepEqual(got, want, [
    'docs/ONBOARDING.md should write each step as **<title>** (`<id>`), once, in the step list\'s order.',
    `Missing: ${missing.join(', ') || 'none'}. Extra: ${extra.join(', ') || 'none'}. Mismatched: ${mismatched.join('; ') || 'none'}.`,
  ].join(' '));
});

test('the guide links that steps and the README give lead to headings in ONBOARDING.md, and back', () => {
  const headings = anchors(doc('docs/ONBOARDING.md'));
  const fromSteps = STEPS.flatMap((s) => (s.fix?.docs?.startsWith('docs/ONBOARDING.md#') ? [[s.id, s.fix.docs.slice('docs/ONBOARDING.md#'.length)]] : []));
  assert.ok(fromSteps.length >= 7, 'B0, B5, B6, B9, B11, B13 and B14 link to the guide');
  const fromReadme = [...doc('README.md').matchAll(/docs\/ONBOARDING\.md#([\w-]+)/g)].map((m) => ['README.md', m[1]!]);
  assert.ok(fromReadme.length, 'the README links into the guide');
  for (const [from, anchor] of [...fromSteps, ...fromReadme]) assert.ok(headings.has(anchor!), `${from} links to #${anchor}, which isn't a heading in ONBOARDING.md`);
  const readme = anchors(doc('README.md'));
  for (const [, anchor] of doc('docs/ONBOARDING.md').matchAll(/\.\.\/README\.md#([\w-]+)/g)) assert.ok(readme.has(anchor!), `ONBOARDING.md links to README.md#${anchor}, which isn't a heading`);
});

test('a fully set-up Salesforce project passes every check that can be automated', () => {
  const r = statuses(sfRepo());
  const notPassing = Object.entries(r).filter(([, v]) => v.status !== 'pass' && v.status !== 'skip');
  assert.deepEqual(notPassing.map(([id, v]) => `${id}: ${v.detail}`), []);
  assert.equal(r['B6.org-match']!.detail, 'production → acme, uat → acme--uat, dev → acme--dev');
  assert.equal(r['A4.plugin']!.detail, 'The plugin 0.35.0, for every Claude Code session.');
  assert.equal(r['B11.drift']!.status, 'pass');
  assert.equal(r['B13.gate-tools']!.detail, 'Ready: format, validate, deploy, stray-files.', 'deploy sits beside validate (D-206)');
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

test('a project that doesn\'t use source tracking skips both B8 steps with the reason, even with untracked sandboxes; on or not set, they still run (T-73)', () => {
  const f = healthy();
  f[`${TRACK_Q} -o Acme Dev`] = sf(null, 1);
  f['sf org list'] = sf({ nonScratchOrgs: [{ alias: 'Acme Dev', tracksSource: false }] });
  const config = (over: Record<string, unknown>) => ({ ...SF_CONFIG, trackers: [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME' }], ...over });
  const off = statuses(sfRepo({ config: config({ sourceTracking: false }) }), f);
  for (const id of ['B8.tracking', 'B8.cli-tracking']) {
    assert.deepEqual(off[id], { status: 'skip', detail: NO_TRACKING_REASON }, id);
  }
  assert.match(NO_TRACKING_REASON, /doesn't use source tracking.*Source tracking under Limits and checks in the project's settings/);
  for (const over of [{ sourceTracking: true }, {}]) {
    const r = statuses(sfRepo({ config: config(over) }), f);
    assert.deepEqual([r['B8.tracking']!.status, r['B8.cli-tracking']!.status], ['fail', 'fail'], JSON.stringify(over));
  }
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

test('Claude Code that isn\'t installed is installed with Homebrew, which needs no Node', () => {
  const f = healthy();
  f['claude --version'] = { code: 127, stdout: '', stderr: 'not found' };
  const ctx = { ...makeContext(tempDir(), fakeRunner(f), testEnv()), system: 'mac' as const, files: NO_FILES };
  const res = runSteps(ctx, 'machine', ['A1.claude'])[0]!.result;
  assert.equal(res.status, 'fail');
  assert.equal(res.fix, 'brew install --cask claude-code');
});

/** A4.plugin's result, with `claude plugin list --json` and `claude plugin marketplace list --json` answering as given. */
function plugin(list: RunResult, markets: RunResult = ok('[]'), calls: string[] = [], acc: string | null = null) {
  const f = healthy();
  f['claude plugin list --json'] = list;
  f['claude plugin marketplace list --json'] = markets;
  return runSteps({ ...makeContext(tempDir(), fakeRunner(f, calls), testEnv(), acc), system: 'mac' }, 'machine', ['A4.plugin'])[0]!.result;
}
const ACC = { id: 'acc@agent-command-center', version: '0.35.0', scope: 'user', enabled: true };
const ADD = 'claude plugin marketplace add https://github.com/jack-huffman/agent-command-center';
const INSTALL = 'claude plugin install acc@agent-command-center --scope user';

test('A4.plugin passes when acc is installed for every session and enabled, and names its version', () => {
  const calls: string[] = [];
  const r = plugin(ok(JSON.stringify([{ id: 'cloudflare@cloudflare', version: '1.0.0', scope: 'user', enabled: true }, ACC])), ok('[]'), calls);
  assert.deepEqual([r.status, r.detail], ['pass', 'The plugin 0.35.0, for every Claude Code session.']);
  assert.ok(!calls.some((c) => c.includes('marketplace')), 'an installed plugin needs no marketplace check');
});

test('A4.plugin\'s fix is what this machine lacks: the marketplace and the plugin, the plugin, or turning it on', () => {
  const none = plugin(ok('[]'), ok(JSON.stringify([{ name: 'claude-plugins-official', source: 'github' }])));
  assert.deepEqual([none.status, none.fix], ['fail', `${ADD} && ${INSTALL}`]);
  assert.match(none.detail, /marketplace isn't added/);
  const added = plugin(ok('[]'), ok(JSON.stringify([{ name: 'agent-command-center', source: 'git' }])));
  assert.deepEqual([added.status, added.fix, added.detail], ['fail', INSTALL, "The plugin isn't installed in Claude Code."]);
  const off = plugin(ok(JSON.stringify([{ ...ACC, enabled: false }])));
  assert.deepEqual([off.status, off.fix, off.detail], ['fail', 'claude plugin enable acc@agent-command-center --scope user', 'The plugin 0.35.0 is installed but turned off.']);
  // One project's install isn't every session's.
  const project = plugin(ok(JSON.stringify([{ ...ACC, scope: 'project' }])), ok(JSON.stringify([{ name: 'agent-command-center' }])));
  assert.equal(project.fix, INSTALL);
  assert.match(project.detail, /for one project only \(project scope\)/);
  // A marketplace list that doesn't run gets both: adding a marketplace that's there already is harmless.
  assert.equal(plugin(ok('[]'), { code: 1, stdout: '', stderr: 'boom' }).fix, `${ADD} && ${INSTALL}`);
});

test('A4.plugin fails on a plugin older than this acc, with the update as its fix, and passes an equal or newer one (GH-62)', () => {
  const at = (version: unknown, acc: string | null) => plugin(ok(JSON.stringify([{ ...ACC, version }])), ok('[]'), [], acc);
  const old = at('0.35.0', '0.36.0');
  assert.deepEqual([old.status, old.detail], ['fail', 'The plugin 0.35.0 is installed, older than this Command Center (0.36.0).']);
  assert.equal(old.fix, 'claude plugin marketplace update agent-command-center && claude plugin update acc@agent-command-center --scope user');
  assert.equal(at('0.9.0', '0.10.0').status, 'fail', 'compared as numbers, not text');
  assert.deepEqual([at('0.36.0', '0.36.0').status, at('0.36.0', '0.36.0').detail], ['pass', 'The plugin 0.36.0, for every Claude Code session.']);
  assert.equal(at('0.37.0', '0.36.0').status, 'pass', 'a newer plugin is fine');
  // Nothing to compare: the caller doesn't know acc's version, or the plugin's isn't one.
  assert.equal(at('0.35.0', null).status, 'pass');
  assert.equal(at('9d655cb', '0.36.0').status, 'pass');
  assert.equal(at(undefined, '0.36.0').status, 'pass');
  // A disabled plugin is turned on first; the next check asks for the update.
  const off = plugin(ok(JSON.stringify([{ ...ACC, enabled: false }])), ok('[]'), [], '0.36.0');
  assert.equal(off.fix, 'claude plugin enable acc@agent-command-center --scope user');
});

test('A4.plugin waits for Claude Code, and says unknown for output it can\'t read', () => {
  const missing = plugin({ code: 127, stdout: '', stderr: 'not found' });
  assert.deepEqual([missing.status, missing.detail, missing.fix], ['fail', 'claude isn\'t installed. Do A1.claude first.', 'brew install --cask claude-code'], 'Do it installs Claude Code, not the plugin');
  for (const junk of [ok('Installed plugins:\n  acc'), ok('{"id":"acc@agent-command-center"}'), ok('[1, 2]'), { code: 1, stdout: '', stderr: 'error: unknown option \'--json\'' }]) {
    const r = plugin(junk);
    assert.equal(r.status, 'unknown', junk.stdout || junk.stderr);
    assert.match(r.detail, /^Couldn't read Claude Code's plugins: claude plugin list/);
  }
});

test('A4.plugin\'s names and address are the marketplace\'s and the plugin\'s own', () => {
  const market = JSON.parse(doc('.claude-plugin/marketplace.json'));
  const manifest = JSON.parse(doc('plugin/.claude-plugin/plugin.json'));
  assert.deepEqual(PLUGIN, { marketplace: market.name, name: market.plugins[0].name, repo: manifest.repository });
  assert.equal(market.plugins[0].source, './plugin');
  const fix = stepFix(STEPS.find((s) => s.id === 'A4.plugin')!, 'mac')!.command!;
  assert.equal(fix, `${ADD} && ${INSTALL}`);
  assert.ok(!/<[^>]+>/.test(fix), 'Do it runs it as it is, with nothing to fill in');
});

test('edge case: a step whose line differs by system gives each system its own, whichever system acc runs on; a step without one gives its fix (D-209)', () => {
  const a4 = STEPS.find((s) => s.id === 'A4.plugin')!;
  assert.equal(stepFix(a4, 'windows')!.command, `${ADD}; if ($?) { ${INSTALL} }`, 'PowerShell 5.1 has no &&');
  assert.equal(stepFix(a4)!.command, a4.fix!.command, 'on the system acc runs on, its fix');
  const git = STEPS.find((s) => s.id === 'A1.git')!;
  assert.deepEqual([stepFix(git, 'mac')!.command, stepFix(git, 'windows')!.command], ['brew install git', 'winget install --id Git.Git -e']);
  assert.match(stepFix(git, 'windows')!.text!, /restart VSCode/, 'Windows is told to restart VSCode');
  assert.equal(stepFix(git, 'mac')!.text, undefined);
  const analyzer = STEPS.find((s) => s.id === 'A1.code-analyzer')!;
  assert.equal(analyzer.fixOn, undefined);
  assert.deepEqual(stepFix(analyzer, 'windows'), analyzer.fix, 'one line for every system');
  // The Salesforce CLI's line is the same npm line everywhere, and Windows is still told to restart VSCode (T-133).
  const sf = STEPS.find((s) => s.id === 'A1.sf')!;
  assert.deepEqual([stepFix(sf, 'mac')!.command, stepFix(sf, 'windows')!.command], ['npm install -g @salesforce/cli', 'npm install -g @salesforce/cli']);
});

test('Node is a Salesforce project\'s step: acc itself doesn\'t need it (D-077)', () => {
  const generic = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  assert.equal(statuses(generic)['A1.node'], undefined, 'a generic project doesn\'t ask for it');
  assert.equal(statuses(generic)['A1.git']!.status, 'pass');
  assert.equal(statuses(sfRepo())['A1.node']!.status, 'pass');
  // With no project open, the machine part still lists it, as it does A1.sf.
  assert.equal(statuses(tempDir())['A1.node']!.status, 'pass');
  assert.ok(!STEPS.find((s) => s.id === 'A1.node')!.profiles!.includes('generic'));
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

// The home settings file as the step names it: under ~ with this system's separator (~\.claude\... on Windows).
const HOME_SETTINGS = join('~', '.claude', 'settings.json');

test('A1.claude-billing names each source of per-token billing, and never its value', () => {
  const KEY = 'sk-ant-api03-' + 'q'.repeat(24);
  const helper = `echo ${KEY}`;
  const cases: { env?: NodeJS.ProcessEnv; home?: Record<string, unknown>; repo?: Record<string, unknown>; want: string }[] = [
    { env: { ANTHROPIC_API_KEY: KEY }, want: 'ANTHROPIC_API_KEY in the environment' },
    { env: { ANTHROPIC_AUTH_TOKEN: KEY }, want: 'ANTHROPIC_AUTH_TOKEN in the environment' },
    { env: { CLAUDE_CODE_USE_BEDROCK: '1' }, want: 'CLAUDE_CODE_USE_BEDROCK in the environment' },
    { env: { CLAUDE_CODE_USE_VERTEX: 'true' }, want: 'CLAUDE_CODE_USE_VERTEX in the environment' },
    { home: { '.claude/settings.json': { apiKeyHelper: helper } }, want: `apiKeyHelper in ${HOME_SETTINGS}` },
    { home: { '.claude/settings.json': { env: { ANTHROPIC_API_KEY: KEY } } }, want: `ANTHROPIC_API_KEY under env in ${HOME_SETTINGS}` },
    { home: { '.claude/settings.json': { env: { ANTHROPIC_AUTH_TOKEN: KEY } } }, want: `ANTHROPIC_AUTH_TOKEN under env in ${HOME_SETTINGS}` },
    { home: { '.claude/settings.json': { env: { CLAUDE_CODE_USE_VERTEX: '1' } } }, want: `CLAUDE_CODE_USE_VERTEX under env in ${HOME_SETTINGS}` },
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
  assert.equal(all.detail, `Agents would bill per token, not your Claude subscription: ANTHROPIC_API_KEY in the environment, CLAUDE_CODE_USE_BEDROCK in the environment, apiKeyHelper in ${HOME_SETTINGS}, ANTHROPIC_AUTH_TOKEN under env in .claude/settings.local.json.`);
});

test('A1.claude-billing reads CLAUDE_CONFIG_DIR\'s settings when set, and never quotes a file it can\'t parse', () => {
  const KEY = 'sk-ant-api03-' + 'z'.repeat(24);
  const dir = tempDir('claude-config-');
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_API_KEY: KEY } }));
  const moved = billing({ env: { CLAUDE_CONFIG_DIR: dir }, home: { '.claude/settings.json': { apiKeyHelper: 'key.sh' } } });
  assert.equal(moved.detail, `Agents would bill per token, not your Claude subscription: ANTHROPIC_API_KEY under env in ${join(dir, 'settings.json')}.`);
  const broken = billing({ home: { '.claude/settings.json': `{ "env": { "ANTHROPIC_API_KEY": "${KEY}" }, }` } });
  assert.deepEqual(broken, { status: 'unknown', detail: `Not valid JSON, so not checked: ${HOME_SETTINGS}.` });
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

test('B10.readme applies to one environment once a tracker has a place, and fails until the README links it (GH-81)', () => {
  const config = { schema: 1, project: 'acme-portal', environments: [{ name: 'main', default: true }], trackers: [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', epic: 'ACME-3' }] };
  const repo = makeRepo({ '.acc/config.json': JSON.stringify(config), 'README.md': '# acme-portal\n' });
  const readme = () => runSteps(makeContext(repo, fakeRunner({})), 'project', ['B10.readme'])[0]!.result;
  assert.deepEqual(readme(), { status: 'fail', detail: 'README.md doesn\'t link the Jira epic ACME-3, where this repo\'s tickets come from.' });
  assert.equal(STEPS.find((s) => s.id === 'B10.readme')!.fix?.command, 'acc setup readme', 'Do it writes it');
  writeReadme(repoPaths(repo, run), parseConfig(config).config!);
  assert.match(readFileSync(join(repo, 'README.md'), 'utf8'), /\*\*Its tickets come from\*\* Jira epic \[ACME-3\]\(https:\/\/acme\.atlassian\.net\/browse\/ACME-3\)\./);
  assert.deepEqual(readme(), { status: 'pass', detail: 'The README says where this repo\'s tickets come from.' });
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

test('nearbyRepo reads no more than 200 of a crowded folder\'s 5,000 entries, so it finishes within a second (GH-174)', () => {
  assert.equal(NEARBY_LIMIT, 200);
  const parent = tempDir('crowded-');
  for (let i = 0; i < 5000; i++) mkdirSync(join(parent, `sibling-${i}`));
  assert.equal(nearbyFolders(parent).length, 200);
  const start = performance.now();
  const near = nearbyRepo(join(parent, 'sibling-0'));
  const took = performance.now() - start;
  assert.equal(near, null);
  assert.ok(took < 1000, `took ${Math.round(took)} ms`);
});

test('nearbyRepo doesn\'t look among the system temp directory\'s folders, even with a repo there, and finds nothing in a missing folder (GH-174)', () => {
  const repo = tempDir('near-repo-');
  mkdirSync(join(repo, '.git'));
  mkdirSync(join(repo, '.acc'));
  writeFileSync(join(repo, '.acc', 'config.json'), '{}');
  assert.equal(dirname(repo), tmpdir(), 'the repo sits in the temp directory');
  assert.equal(nearbyRepo(tempDir('old-folder-')), null);
  assert.equal(nearbyRepo(join(tempDir(), 'gone', 'old')), null);
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
  assert.deepEqual([none.status, /tasks come from the Command Center alone/.test(none.detail)], ['unknown', true]);
  const azure = statuses(sfRepo({ config: { ...SF_CONFIG, trackers: [{ kind: 'azure', organization: 'acme', project: 'CRM' }, { kind: 'github' }] } }))['B14.tickets']!;
  assert.equal(azure.detail, 'Tickets come from Azure DevOps CRM in acme and GitHub Issues.');
  // A narrower place is named too (D-072).
  const placed = statuses(sfRepo({ config: { ...SF_CONFIG, trackers: [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', epic: 'ACME-3' }, { kind: 'azure', organization: 'acme', project: 'CRM', areaPath: 'CRM\\Billing' }, { kind: 'github', labels: ['billing', 'invoices'] }] } }))['B14.tickets']!;
  assert.equal(placed.detail, 'Tickets come from Jira ACME on acme.atlassian.net, epic ACME-3 and Azure DevOps CRM in acme, area CRM\\Billing and GitHub Issues labelled billing or invoices.');
});

/** B0.template's result in a repo, with gh and sf answered from fixtures (GH-80). */
function templateCheck(repo: string, fixtures: Record<string, RunResult | ((o?: { env?: NodeJS.ProcessEnv }) => RunResult)> = {}, calls: string[] = []) {
  const ctx = makeContext(repo, fakeRunner(fixtures, calls), testEnv());
  return runSteps(ctx, 'project', ['B0.template'])[0]!.result;
}

test('B0.template doesn\'t apply without a template, passes while it\'s unchanged or the project agrees, and names what differs without writing (GH-80)', () => {
  assert.equal(templateCheck(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) })).status, 'skip');

  const file = join(tempDir('team-'), 'tools.json');
  const template = { schema: 1, name: 'ACME tools', gates: { required: ['test'], commands: { test: 'npm test' } }, agents: { max: 2 } };
  writeFileSync(file, JSON.stringify(template, null, 2));
  const config = { ...GENERIC_CONFIG, gates: template.gates, agents: { max: 2 }, template: { name: 'ACME tools', source: file, digest: templateDigest(template) } };
  const repo = makeRepo({ '.acc/config.json': JSON.stringify(config, null, 2) });
  const before = readFileSync(join(repo, '.acc', 'config.json'), 'utf8');

  assert.deepEqual(Object.values(templateCheck(repo)), ['pass', 'ACME tools, unchanged since this project was made from it.']);
  writeFileSync(file, JSON.stringify({ agents: { max: 2 }, gates: template.gates, name: 'ACME tools', schema: 1 }));
  assert.equal(templateCheck(repo).status, 'pass', 'reformatted and reordered is unchanged');

  writeFileSync(file, JSON.stringify({ ...template, description: 'ACME\'s small repos.' }));
  const agrees = templateCheck(repo);
  assert.deepEqual([agrees.status, /already agrees with it/.test(agrees.detail)], ['pass', true]);

  writeFileSync(file, JSON.stringify({ ...template, gates: { required: ['test', 'lint'], commands: { test: 'npm test', lint: 'npm run lint' } }, agents: { max: 4 } }));
  const differs = templateCheck(repo);
  assert.equal(differs.status, 'unknown', 'checked by hand: the template is the team\'s, and the project may differ on purpose');
  assert.match(differs.detail, /ACME tools has changed since this project was made from it, and this project differs on gates\.required, gates\.commands, agents\.max\./);
  assert.equal(differs.fix, `acc init --from '${file}' --profile generic --dry-run`);

  writeFileSync(file, JSON.stringify({ ...template, gatez: {} }));
  assert.match(templateCheck(repo).detail, /now has problems: "gatez" isn't a template key/);

  rmSync(file);
  const gone = templateCheck(repo);
  assert.deepEqual([gone.status, /isn't on this machine/.test(gone.detail)], ['skip', true]);
  assert.equal(readFileSync(join(repo, '.acc', 'config.json'), 'utf8'), before, 'the check never writes .acc/config.json');
});

test('B0.template reads a GitHub template as the repo\'s account, and one it can\'t read is checked by hand (GH-80)', () => {
  const template = { schema: 1, name: 'ACME tools', autonomy: 'review' };
  const source = 'https://github.com/acme/acc-templates/blob/main/tools.json';
  const repo = makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, github: { repo: 'acme/app', account: 'acme-dev' }, autonomy: 'review', template: { name: 'ACME tools', source, digest: templateDigest(template) } }) });
  const api = 'gh api repos/acme/acc-templates/contents/tools.json?ref=main';
  const token = { 'gh auth token -u acme-dev': ok('tok-acme') };
  assert.equal(templateCheck(repo, { ...token, [api]: (o) => (o?.env?.GH_TOKEN === 'tok-acme' ? ok(JSON.stringify(template)) : sf(null, 1)) }).status, 'pass');
  const down = templateCheck(repo, { ...token, [api]: { code: 1, stdout: '', stderr: 'HTTP 502: Server Error' } });
  assert.equal(down.status, 'unknown');
  assert.match(down.detail, /Couldn't read ACME tools from https:\/\/github\.com\/acme\/acc-templates\/blob\/main\/tools\.json: .*502/);
  assert.equal(templateCheck(repo, {}).status, 'unknown', 'gh not logged in as the account');
});

/** B0.rules's result in a repo (GH-108). */
function rulesCheck(repo: string, fixtures: Parameters<typeof templateCheck>[1] = {}, calls: string[] = []) {
  const ctx = makeContext(repo, fakeRunner(fixtures, calls), testEnv());
  return runSteps(ctx, 'project', ['B0.rules'])[0]!.result;
}

test('B0.rules doesn\'t apply with nothing copied in, passes while each source is unchanged though a copy was edited here, and shows a change without applying it (GH-108)', () => {
  const repo = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  assert.deepEqual([rulesCheck(repo).status, /No rules are copied in/.test(rulesCheck(repo).detail)], ['skip', true]);

  const file = join(tempDir('team-'), 'acme.md');
  writeFileSync(file, '- Every change has a test.\n');
  importRules(run, repo, file, { name: 'acme' });
  const copy = join(repo, '.acc', 'rules', 'acme.md');
  assert.deepEqual(Object.values(rulesCheck(repo)), ['pass', '.acc/rules/acme.md: unchanged at its source.']);
  writeFileSync(copy, `${readFileSync(copy, 'utf8')}- And this repo's own line.\n`);
  const edited = rulesCheck(repo);
  assert.deepEqual([edited.status, /was edited here/.test(edited.detail)], ['pass', true], 'an edit made here isn\'t a change at the source');
  const before = readFileSync(copy, 'utf8');

  writeFileSync(file, '- Every change has a test and a changelog line.\n');
  const changed = rulesCheck(repo);
  assert.equal(changed.status, 'unknown');
  assert.match(changed.detail, /^\.acc\/rules\/acme\.md has changed at the source since it was copied in\. The fix shows the difference and changes nothing/);
  assert.equal(changed.fix, 'acc rules diff acme');
  assert.equal(readFileSync(copy, 'utf8'), before, 'the check never writes the copy');

  rmSync(file);
  const gone = rulesCheck(repo);
  assert.deepEqual([gone.status, /came from a file that isn't on this machine/.test(gone.detail)], ['skip', true]);
  assert.equal(readFileSync(copy, 'utf8'), before);
});

test('B0.rules reads a GitHub source as the repo\'s account, and one it can\'t read, or a bad header, is checked by hand (GH-108)', () => {
  const source = 'https://github.com/acme/acc-rules/blob/main/salesforce.md';
  const text = '- Apex has tests.\n';
  const repo = makeRepo({
    '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, github: { repo: 'acme/app', account: 'acme-dev' } }),
    '.acc/rules/salesforce.md': renderHeader({ source, commit: null, copied: '2026-10-01', sha256: rulesDigest(text) }) + text,
  });
  const api = 'gh api repos/acme/acc-rules/contents/salesforce.md?ref=main';
  const token = { 'gh auth token -u acme-dev': ok('tok-acme') };
  assert.equal(rulesCheck(repo, { ...token, [api]: (o) => (o?.env?.GH_TOKEN === 'tok-acme' ? ok(text) : sf(null, 1)) }).status, 'pass');
  const down = rulesCheck(repo, { ...token, [api]: { code: 1, stdout: '', stderr: 'HTTP 502: Server Error' } });
  assert.equal(down.status, 'unknown');
  assert.match(down.detail, /\.acc\/rules\/salesforce\.md: Couldn't read https:\/\/github\.com\/acme\/acc-rules\/blob\/main\/salesforce\.md: .*502/);
  assert.equal(down.fix, undefined, 'nothing to run');

  writeFileSync(join(repo, '.acc', 'rules', 'evil.md'), renderHeader({ source: '--upload-pack=touch acc-owned#x.md', commit: null, copied: '2026-10-01', sha256: rulesDigest('x') }) + 'x');
  const calls: string[] = [];
  const evil = rulesCheck(repo, { ...token, [api]: ok(text) }, calls);
  assert.equal(evil.status, 'unknown');
  assert.match(evil.detail, /\.acc\/rules\/evil\.md: Its header's source, .*can't start with "-"/);
  assert.ok(!calls.some((c) => c.startsWith('git clone')), calls.join('\n'));
  assert.ok(!existsSync(join(repo, 'acc-owned')));
});

test('B0.template never hands git a committed source that starts with "-" (GH-80)', () => {
  const source = '--upload-pack=touch acc-owned#tools.json';
  const repo = makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, template: { name: 'ACME tools', source, digest: `sha256:${'0'.repeat(64)}` } }) });
  const calls: string[] = [];
  const r = templateCheck(repo, {}, calls);
  assert.equal(r.status, 'unknown');
  assert.match(r.detail, /can't start with "-", which git would read as an option/);
  assert.ok(!calls.some((c) => c.startsWith('git clone')), calls.join('\n'));
  assert.ok(!existsSync(join(repo, 'acc-owned')));
});

test('the plugin is behind acc only when both are x.y.z and it\'s older: the one comparison A4 and Settings\' About share (GH-114)', () => {
  assert.deepEqual([pluginBehind('0.36.0', '0.37.0'), pluginBehind('0.9.0', '0.10.0'), pluginBehind('0.37.0', '0.37.0'), pluginBehind('0.38.0', '0.37.0')], [true, true, false, false]);
  assert.deepEqual([pluginBehind(null, '0.37.0'), pluginBehind('0.36.0', null), pluginBehind('0.36', '0.37.0'), pluginBehind('9d655cb', '0.37.0'), pluginBehind('0.36.0', '')], [false, false, false, false, false]);
  assert.deepEqual(userPlugin([{ id: 'acc@agent-command-center', scope: 'project', version: '1.0.0', enabled: true }, { id: 'acc@agent-command-center', scope: 'user', version: '0.37.0', enabled: false }]), { version: '0.37.0', enabled: false });
  assert.deepEqual(userPlugin([{ id: 'acc@agent-command-center', scope: 'user', version: 37 }]), { version: null, enabled: false });
  assert.equal(userPlugin([{ id: 'other@x', scope: 'user' }]), null);
});

/** The fix a project step gives for a system (T-124): sh on a Mac and Linux, Windows PowerShell 5.1 on Windows. */
function fixFor(id: string, system: 'mac' | 'windows' | 'linux', fixtures = healthy(), repo = sfRepo()): string | undefined {
  const ctx = { ...makeContext(repo, fakeRunner(fixtures), testEnv({ CLAUDE_CONFIG_DIR: trustDir(repo) })), system };
  return runSteps(ctx, 'project', [id])[0]!.result.fix;
}

test('B2.credentials\' fix is built for its shell: && and \'\' on a Mac, `; if ($?)` and \'""\' on Windows, where PowerShell 5.1 has no && and drops an empty argument (T-124)', () => {
  const f = healthy();
  f['gh api user --jq .login'] = ok('someone-else');
  const mac = fixFor('B2.credentials', 'mac', f)!;
  const win = fixFor('B2.credentials', 'windows', f)!;
  assert.ok(mac.startsWith("git config credential.helper '' && git config --add credential.helper '!f()"), mac);
  assert.ok(win.startsWith("git config credential.helper '\"\"'; if ($?) { git config --add credential.helper '!f()"), win);
  assert.ok(!win.includes('&&'), 'no && on Windows');
  assert.ok(win.includes('test \\"$1\\" = get'), 'a double quote is written \\" so 5.1 keeps it');
  assert.ok(!mac.includes('\\"'), 'sh needs no such escape');
});

test('B8.cli-tracking\'s fix quotes the org for its shell, and a single org needs no chain (T-124)', () => {
  const f = healthy();
  f['sf org list'] = sf({ nonScratchOrgs: [{ alias: 'Acme Dev', tracksSource: false }] });
  assert.equal(fixFor('B8.cli-tracking', 'mac', f), "sf org enable tracking -o 'Acme Dev'");
  assert.equal(fixFor('B8.cli-tracking', 'windows', f), "sf org enable tracking -o 'Acme Dev'");
});

test('A4.plugin\'s fix and its update line are built for the shell of the system they run on (T-124)', () => {
  const add = 'claude plugin marketplace add https://github.com/jack-huffman/agent-command-center';
  const install = 'claude plugin install acc@agent-command-center --scope user';
  const run = (system: 'mac' | 'windows') => {
    const f = healthy();
    f['claude plugin list --json'] = ok('[]');
    f['claude plugin marketplace list --json'] = ok('[]');
    return runSteps({ ...makeContext(tempDir(), fakeRunner(f), testEnv()), system }, 'machine', ['A4.plugin'])[0]!.result;
  };
  assert.equal(run('mac').fix, `${add} && ${install}`);
  assert.equal(run('windows').fix, `${add}; if ($?) { ${install} }`);
  const old = JSON.stringify([{ id: 'acc@agent-command-center', version: '0.0.1', scope: 'user', enabled: true }]);
  const update = (system: 'mac' | 'windows') => {
    const f = healthy();
    f['claude plugin list --json'] = ok(old);
    return runSteps({ ...makeContext(tempDir(), fakeRunner(f), testEnv()), system, version: '9.9.9' }, 'machine', ['A4.plugin'])[0]!.result.fix;
  };
  assert.equal(update('mac'), 'claude plugin marketplace update agent-command-center && claude plugin update acc@agent-command-center --scope user');
  assert.equal(update('windows'), 'claude plugin marketplace update agent-command-center; if ($?) { claude plugin update acc@agent-command-center --scope user }');
});
