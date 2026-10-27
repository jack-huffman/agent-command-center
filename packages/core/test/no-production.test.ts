// A person with no access to Production still sets up a Salesforce project and uses the Command Center
// (D-T-125): Setup's steps pass on the rest, acc init finds the environments from one My Domain's logged-in
// sandboxes, and someone with access records Production's org later.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig, type Config } from '../src/config.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { planInit } from '../src/init.ts';
import { makeContext } from '../src/onboarding/helpers.ts';
import { runSteps } from '../src/onboarding/steps.ts';
import { repoPaths } from '../src/paths.ts';
import { draftLists, seedBranches } from '../src/setup.ts';
import { discoverFromMyDomain, finishEnvironments, GUESSED_TYPE, listedOrgs, MY_DOMAIN, PRODUCTION_NOT_HERE, recordProduction, sandboxAliases, sfRun } from '../src/sf-discovery.ts';
import { previewCommand } from '../src/template.ts';
import { bad, fakeRunner, gitIn, makeRepo, ok, SF_CONFIG, sf, tempDir } from './support.ts';

const SANDBOX_Q = 'sf data query --use-tooling-api -q SELECT SandboxName, LicenseType FROM SandboxInfo';
const NOT_LOGGED_IN = sf(null, 1);
const now = () => new Date('2026-10-27T12:00:00Z');

/** This machine's orgs: both sandboxes logged in; Production as each test says. */
function orgs(production: RunResult | null): Record<string, RunResult> {
  return {
    ...(production ? { 'sf org display -o Acme Production': production } : {}),
    'sf org display -o Acme UAT': sf({ instanceUrl: 'https://acme--uat.sandbox.my.salesforce.com' }),
    'sf org display -o Acme Dev': sf({ instanceUrl: 'https://acme--dev.sandbox.my.salesforce.com' }),
    [`${SANDBOX_Q} -o Acme Production`]: sf({ records: [{ SandboxName: 'UAT', LicenseType: 'FULL' }, { SandboxName: 'Dev', LicenseType: 'DEVELOPER' }] }),
  };
}

/** A project someone else set up, its settings committed, with the branches named. */
function joined(config: unknown = SF_CONFIG, branches = ['production', 'uat', 'dev']): string {
  const repo = makeRepo({ '.acc/config.json': JSON.stringify(config, null, 2) });
  for (const b of branches) gitIn(repo, 'branch', b);
  return repo;
}

function steps(repo: string, fixtures: Record<string, RunResult>, ids: string[]): Record<string, { status: string; detail: string }> {
  const ctx = makeContext(repo, fakeRunner(fixtures), { ...process.env, GIT_CONFIG_NOSYSTEM: '1' });
  return Object.fromEntries(runSteps(ctx, 'project', ids).map(({ step, result }) => [step.id, result]));
}

const withProduction = (org: string | null) => ({ ...SF_CONFIG, environments: SF_CONFIG.environments.map((e) => (e.type === 'production' ? { ...e, org } : e)) });

test('joining a project with no Production login: each branch\'s org passes, and Production\'s line says why it isn\'t needed', () => {
  const r = steps(joined(), orgs(NOT_LOGGED_IN), ['B6.org-match'])['B6.org-match']!;
  assert.equal(r.status, 'pass', r.detail);
  assert.equal(r.detail, `production: ${PRODUCTION_NOT_HERE}, uat → acme--uat, dev → acme--dev`);
  assert.match(PRODUCTION_NOT_HERE, /isn't logged in to Production.*don't need it.*someone with access to Production looks after it/);
});

test('Production with no org on this machine passes the same way as one not logged in', () => {
  const r = steps(joined(withProduction(null)), orgs(null), ['B6.org-match'])['B6.org-match']!;
  assert.equal(r.status, 'pass', r.detail);
  assert.ok(r.detail.startsWith(`production: ${PRODUCTION_NOT_HERE}`), r.detail);
});

test('a logged-in Production is checked as before, and a Production alias on a sandbox still fails', () => {
  const here = steps(joined(), orgs(sf({ instanceUrl: 'https://acme.my.salesforce.com' })), ['B6.org-match'])['B6.org-match']!;
  assert.deepEqual([here.status, here.detail], ['pass', 'production → acme, uat → acme--uat, dev → acme--dev']);
  const wrong = steps(joined(), orgs(sf({ instanceUrl: 'https://acme--uat.sandbox.my.salesforce.com' })), ['B6.org-match'])['B6.org-match']!;
  assert.equal(wrong.status, 'fail');
  assert.match(wrong.detail, /"Acme Production" isn't a Production org/);
});

test('a sandbox that isn\'t logged in still fails, even without Production', () => {
  const f = orgs(NOT_LOGGED_IN);
  f['sf org display -o Acme Dev'] = NOT_LOGGED_IN;
  const r = steps(joined(), f, ['B6.org-match'])['B6.org-match']!;
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /"Acme Dev" isn't logged in/);
  assert.doesNotMatch(r.detail, /Acme Production/);
  assert.ok(r.detail.endsWith(`production: ${PRODUCTION_NOT_HERE}`), 'the failure still says Production isn\'t here, for the Environments page');
});

test('every org is listed: without Production the check is skipped with who runs it, and with it, it reads the list', () => {
  const away = steps(joined(), orgs(NOT_LOGGED_IN), ['B1.orgs'])['B1.orgs']!;
  assert.equal(away.status, 'skip');
  assert.match(away.detail, /isn't logged in to Production.*runs where Production is logged in/);
  const none = steps(joined(withProduction(null)), orgs(null), ['B1.orgs'])['B1.orgs']!;
  assert.equal(none.status, 'skip', 'Production with no org skips too, where it used to fail');
  const here = steps(joined(), orgs(sf({ instanceUrl: 'https://acme.my.salesforce.com' })), ['B1.orgs'])['B1.orgs']!;
  assert.equal(here.status, 'pass', here.detail);
});

test('a branch for every environment: production\'s waits for someone with access, but a sandbox\'s doesn\'t', () => {
  const away = steps(joined(SF_CONFIG, ['uat', 'dev']), orgs(NOT_LOGGED_IN), ['B6.branches'])['B6.branches']!;
  assert.equal(away.status, 'pass', away.detail);
  assert.match(away.detail, /^uat, dev\. No branch for production yet: it's retrieved from Production\. This machine isn't logged in/);
  const here = steps(joined(SF_CONFIG, ['uat', 'dev']), orgs(sf({ instanceUrl: 'https://acme.my.salesforce.com' })), ['B6.branches'])['B6.branches']!;
  assert.deepEqual([here.status, here.detail], ['fail', 'No branch for production.'], 'with Production here, its branch is still needed');
  const sandbox = steps(joined(SF_CONFIG, ['dev']), orgs(NOT_LOGGED_IN), ['B6.branches'])['B6.branches']!;
  assert.deepEqual([sandbox.status, sandbox.detail], ['fail', 'No branch for uat.']);
});

test('the lists wait for production\'s branch without Production, and fail as before once it exists', () => {
  const waiting = steps(joined(SF_CONFIG, ['uat', 'dev']), orgs(NOT_LOGGED_IN), ['B9.lists'])['B9.lists']!;
  assert.equal(waiting.status, 'skip');
  assert.match(waiting.detail, /differs from production's branch, which is retrieved from Production/);
  const made = steps(joined(SF_CONFIG), orgs(NOT_LOGGED_IN), ['B9.lists'])['B9.lists']!;
  assert.equal(made.status, 'fail', 'production\'s branch is there, so the missing lists are a problem to fix');
});

// ---------------------------------------------------------------- acc setup branches and lists

const sfConfig = (over: unknown): Config => {
  const r = parseConfig(over);
  assert.deepEqual(r.errors, []);
  return r.config!;
};

/** sf for seedBranches: the sandboxes retrieve their own files; Production isn't logged in. */
function sandboxSf(calls: string[]) {
  return (cmd: string, args: string[], opts?: RunOptions): RunResult => {
    if (cmd === 'git') return run(cmd, args, opts);
    const a = cmd === 'nice' ? args.slice(3) : args;
    calls.push(a.join(' '));
    if (a[0] === 'org' && a[1] === 'display') return NOT_LOGGED_IN;
    if (a[0] === 'project' && a[1] === 'retrieve') {
      const org = a[a.indexOf('--target-org') + 1]!;
      writeFileSync(join(opts!.cwd!, 'force-app', 'main', 'default', 'classes', 'A.cls'), org);
      return ok(JSON.stringify({ status: 0 }));
    }
    return bad(`no fake for ${a.join(' ')}`, 127);
  };
}

test('acc setup branches without Production: production\'s is skipped with a reason, and each sandbox starts from this checkout', () => {
  for (const org of [null, 'Acme Production']) {
    const dir = makeRepo({ 'sfdx-project.json': JSON.stringify({ packageDirectories: [{ path: 'force-app' }] }), 'manifest/baseline-package.xml': '<Package/>', 'force-app/main/default/classes/A.cls': 'local', 'force-app/main/default/classes/Local.cls': 'local' });
    const calls: string[] = [];
    const r = seedBranches(repoPaths(dir, run), sfConfig(withProduction(org)), { run: sandboxSf(calls), now, slots: { dir: tempDir('slots-') } });
    assert.deepEqual(r.map((b) => [b.branch, b.status]), [['production', 'skipped'], ['uat', 'made'], ['dev', 'made']], `Production's org: ${org}`);
    assert.match(r[0]!.note, /it's retrieved from Production\. This machine isn't logged in to Production/);
    assert.equal(gitIn(dir, 'show', 'uat:force-app/main/default/classes/A.cls'), 'Acme UAT');
    assert.equal(gitIn(dir, 'show', 'uat:force-app/main/default/classes/Local.cls'), 'local', 'with no production branch, nothing is cleared');
    assert.equal(run('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/production'], { cwd: dir }).code !== 0, true);
    assert.ok(!calls.some((c) => c.includes('--target-org Acme Production')), 'nothing is retrieved from Production');
  }
});

test('drafting the lists without production\'s branch says who makes it when Production has no org here', () => {
  const dir = makeRepo();
  assert.throws(() => draftLists(repoPaths(dir, run), sfConfig(withProduction(null)), { run, now }), /retrieved from Production, so someone with access to Production makes it first/);
  assert.throws(() => draftLists(repoPaths(dir, run), sfConfig(SF_CONFIG), { run, now }), /Make the branches first \(B6\)\.$/);
});

// ---------------------------------------------------------------- acc init --my-domain

/** This person's logged-in orgs: two sandboxes on acme, one tracked; one on another My Domain; no Production. */
const LOGGED_IN = sf({
  nonScratchOrgs: [
    { alias: 'acme-uat', instanceUrl: 'https://acme--uat.sandbox.my.salesforce.com', tracksSource: false },
    { alias: 'Other QA', instanceUrl: 'https://other--qa.sandbox.my.salesforce.com' },
  ],
  sandboxes: [
    { alias: 'acme-dev', instanceUrl: 'https://acme--dev.sandbox.my.salesforce.com', tracksSource: true },
    { alias: 'acme-uat', instanceUrl: 'https://acme--uat.sandbox.my.salesforce.com', tracksSource: false },
  ],
});

test('acc init --my-domain writes the logged-in sandboxes on that My Domain, and Production with no org', () => {
  const repo = makeRepo();
  const calls: string[] = [];
  const plan = planInit(fakeRunner({ 'sf org list': LOGGED_IN }, calls), { root: repo, profile: 'salesforce', myDomain: 'ACME' });
  assert.deepEqual(plan.config.environments.map((e) => [e.name, e.branch, e.type, e.org, e.default, e.protected, e.promotesTo]), [
    ['Production', 'production', 'production', null, false, true, []],
    ['dev', 'dev', 'developer', 'acme-dev', true, false, ['uat', 'production']],
    ['uat', 'uat', GUESSED_TYPE, 'acme-uat', false, false, ['production']],
  ]);
  const notes = plan.notes.join('\n');
  assert.match(notes, /Found 2 logged-in sandboxes on acme, without Production/);
  assert.match(notes, /uat is taken as partial/);
  assert.ok(!calls.some((c) => c.includes('SandboxInfo')), 'Production\'s sandbox list isn\'t read');
  assert.ok(plan.discovered.includes('environments'));
});

test('acc init refuses no sandbox on the My Domain, a My Domain that isn\'t one, and both ways at once', () => {
  const repo = makeRepo();
  const run1 = fakeRunner({ 'sf org list': LOGGED_IN });
  assert.throws(() => planInit(run1, { root: repo, profile: 'salesforce', myDomain: 'globex' }), /No sandbox on the globex My Domain is logged in/);
  assert.throws(() => planInit(run1, { root: repo, profile: 'salesforce', myDomain: 'acme.my.salesforce.com' }), /isn't a My Domain/);
  assert.throws(() => planInit(run1, { root: repo, profile: 'salesforce', myDomain: 'acme', productionOrg: 'Acme Production' }), /not both/);
  assert.throws(() => planInit(run1, { root: repo, profile: 'salesforce' }), /--production-org <alias>.*--my-domain <domain>/);
  assert.throws(() => planInit(fakeRunner({ 'sf org list': NOT_LOGGED_IN }), { root: repo, profile: 'salesforce', myDomain: 'acme' }), /No sandbox on the acme My Domain/, 'an sf that fails lists no sandbox');
});

test('a team template\'s type wins over a guessed one, and its notes don\'t claim Production\'s list', () => {
  const repo = makeRepo();
  const template = { schema: 1, name: 'ACME', profile: 'salesforce' as const, environments: [{ name: 'Production', branch: 'production', type: null, default: false, protected: true, promotesTo: [] }, { name: 'UAT', branch: 'uat', type: 'full' as const, default: false, protected: false, promotesTo: ['production'] }, { name: 'QA', branch: 'qa', type: null, default: false, protected: false, promotesTo: [] }] };
  const plan = planInit(fakeRunner({ 'sf org list': LOGGED_IN }), { root: repo, myDomain: 'acme', template: { template: template as never, record: { name: 'ACME', source: 't.json', digest: `sha256:${'0'.repeat(64)}` } } });
  assert.equal(plan.config.environments.find((e) => e.branch === 'uat')!.type, 'full');
  const notes = plan.notes.join('\n');
  assert.match(notes, /The template says UAT is full, so it's full, not the partial guessed without Production's sandbox list/);
  assert.match(notes, /The template's QA isn't one of the logged-in sandboxes, so it's left out/);
  assert.doesNotMatch(notes, /Production's sandbox list says/);
});

test('the shared discovery pieces: listed orgs, aliases by branch, and the default', () => {
  assert.deepEqual(listedOrgs({ status: 1, result: { a: [{ alias: 'x' }] } }), [], 'a failed sf lists none');
  const aliases = sandboxAliases(listedOrgs(JSON.parse(LOGGED_IN.stdout)), 'acme');
  assert.deepEqual([...aliases.keys()], ['dev', 'uat']);
  assert.equal(MY_DOMAIN.test('acme-co'), true);
  assert.equal(sfRun(fakeRunner({ 'sf org list': ok('not json') }), '/', ['org', 'list']).status, 1, 'sf that prints no JSON fails');
  assert.throws(() => finishEnvironments([{ name: 'Production', type: 'production', org: null, default: false, protected: true, promotesTo: [] }], []), /Log in to at least one sandbox/);
  const guessed = new Set<string>();
  discoverFromMyDomain(fakeRunner({ 'sf org list': LOGGED_IN }), '/', 'acme', [], guessed);
  assert.deepEqual([...guessed], ['uat']);
});

// ---------------------------------------------------------------- acc setup production

function recorded(production: RunResult, sandboxes = sf({ records: [{ SandboxName: 'UAT', LicenseType: 'FULL' }, { SandboxName: 'Dev', LicenseType: 'DEVELOPER' }, { SandboxName: 'Train', LicenseType: 'DEVELOPER_PRO' }] }), list: RunResult = LOGGED_IN) {
  const config = { ...withProduction(null), environments: [{ name: 'Production', type: 'production', org: null }, { name: 'uat', type: 'partial', org: 'acme-uat', promotesTo: ['production'] }, { name: 'dev', type: 'developer', org: 'acme-dev', default: true, promotesTo: ['uat', 'production'] }] };
  const repo = makeRepo({ '.acc/config.json': JSON.stringify(config, null, 2) });
  const paths = repoPaths(repo, run);
  const runner = fakeRunner({ 'sf org display -o acme-prod': production, 'sf org list': list, 'sf data query --use-tooling-api -q SELECT SandboxName, LicenseType FROM SandboxInfo ORDER BY SandboxName -o acme-prod': sandboxes });
  return { paths, config: sfConfig(config), runner };
}

test('someone with access records Production\'s org: the types are corrected from its list, and missing sandboxes named', () => {
  const { paths, config, runner } = recorded(sf({ instanceUrl: 'https://acme.my.salesforce.com' }));
  const r = recordProduction(runner, paths, config, 'acme-prod');
  assert.deepEqual(r, { org: 'acme-prod', domain: 'acme', corrected: ['uat: partial → full'], missing: ['Train (developer_pro)'] });
  const written = sfConfig(JSON.parse(readFileSync(paths.config, 'utf8')));
  assert.deepEqual(written.environments.map((e) => [e.branch, e.type, e.org, e.default]), [['production', 'production', 'acme-prod', false], ['uat', 'full', 'acme-uat', false], ['dev', 'developer', 'acme-dev', true]]);
  assert.equal(written.project, config.project, 'the rest of the settings are kept');
  const raw = JSON.parse(readFileSync(paths.config, 'utf8')).environments;
  assert.deepEqual(raw, [{ name: 'Production', type: 'production', org: 'acme-prod' }, { name: 'uat', type: 'full', org: 'acme-uat', promotesTo: ['production'] }, { name: 'dev', type: 'developer', org: 'acme-dev', default: true, promotesTo: ['uat', 'production'] }],
    'only the org and the corrected type change: no branch, protected or other key acc reads is written in');
});

test('recording Production refuses a Production org on another My Domain than the sandboxes, and still records one when no sandbox is logged in here', () => {
  const { paths, config, runner } = recorded(sf({ instanceUrl: 'https://globex.my.salesforce.com' }));
  const before = readFileSync(paths.config, 'utf8');
  assert.throws(() => recordProduction(runner, paths, config, 'acme-prod'), /on the globex My Domain, but the project's sandboxes are on acme/);
  assert.equal(readFileSync(paths.config, 'utf8'), before);
  const none = recorded(sf({ instanceUrl: 'https://acme.my.salesforce.com' }), undefined, NOT_LOGGED_IN);
  assert.equal(recordProduction(none.runner, none.paths, none.config, 'acme-prod').domain, 'acme', 'an sf org list that fails names no sandbox to compare with');
});

test('recording Production refuses an org that isn\'t logged in, isn\'t Production, or can\'t list its sandboxes, and writes nothing', () => {
  for (const [production, sandboxes, why] of [
    [NOT_LOGGED_IN, undefined, /"acme-prod" isn't logged in/],
    [sf({ instanceUrl: 'https://acme--uat.sandbox.my.salesforce.com' }), undefined, /isn't a Production org/],
    [sf({ instanceUrl: 'https://acme.my.salesforce.com' }), sf(null, 1), /Couldn't read Production's sandbox list/],
  ] as const) {
    const { paths, config, runner } = recorded(production, sandboxes);
    const before = readFileSync(paths.config, 'utf8');
    assert.throws(() => recordProduction(runner, paths, config, 'acme-prod'), why);
    assert.equal(readFileSync(paths.config, 'utf8'), before);
  }
  const generic = sfConfig({ schema: 1, project: 'Tool', profile: 'generic', environments: [{ name: 'main', default: true }] });
  assert.throws(() => recordProduction(fakeRunner({}), repoPaths(makeRepo(), run), generic, 'x'), /for Salesforce projects/);
});

test('a project set up without Production previews a template with --my-domain, not a Production org it doesn\'t have', () => {
  const record = { name: 'ACME', source: 't.json', digest: 'x' };
  assert.match(previewCommand(null, record, sfConfig(withProduction(null))), /--my-domain <my-domain> --dry-run$/);
  assert.match(previewCommand(null, record, sfConfig(SF_CONFIG)), /--production-org 'Acme Production' --dry-run$/);
});
