import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { loadConfig, parseConfig, writeConfig } from '../src/config.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { planInit, templateAccount } from '../src/init.ts';
import { makeContext } from '../src/onboarding/helpers.ts';
import { runSteps } from '../src/onboarding/steps.ts';
import { importRules } from '../src/rules.ts';
import { parseSource, recordedSource, sourceProblem } from '../src/source.ts';
import { describeTemplate, fetchTemplateText, loadTemplate, parseTemplate, previewCommand, readTemplate, type Template, templateDifferences, templateDigest } from '../src/template.ts';
import { bad, fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, ok, sf, tempDir } from './support.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');

/** The ACME sample in docs/TEMPLATES.md, so the doc can't drift from the code. */
function acmeSample(): Record<string, unknown> {
  const md = readFileSync(join(ROOT, 'docs', 'TEMPLATES.md'), 'utf8');
  const block = /## A sample[\s\S]*?```json\n([\s\S]*?)```/.exec(md);
  assert.ok(block, 'docs/TEMPLATES.md has a sample under "## A sample"');
  return JSON.parse(block[1]!);
}

const GENERIC_TEMPLATE = {
  schema: 1,
  name: 'ACME tools',
  description: 'ACME\'s small repos.',
  profile: 'generic',
  environments: [{ name: 'main', default: true, promotesTo: ['release'] }, { name: 'release', protected: true }],
  gates: { required: ['test', 'lint'], commands: { test: 'npm test', lint: 'npm run lint' } },
  tracker: { kind: 'jira', site: 'acme.atlassian.net', project: 'ACME' },
  autonomy: 'review',
  agents: { max: 2, builder: { model: 'claude-sonnet-5-5', effort: 'high' } },
};

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const errorsOf = (raw: unknown) => parseTemplate(raw).errors.join('\n');
const parsed = (raw: unknown): Template => {
  const r = parseTemplate(raw);
  assert.deepEqual(r.errors, []);
  return r.template!;
};

function withKey(path: string[], value: unknown, base: Record<string, unknown> = clone(GENERIC_TEMPLATE)): Record<string, unknown> {
  let at: Record<string, unknown> = base;
  for (const k of path.slice(0, -1)) at = at[k] as Record<string, unknown>;
  at[path.at(-1)!] = value;
  return base;
}

// ---------------------------------------------------------------- parse

test('the ACME sample in docs/TEMPLATES.md is a template acc accepts', () => {
  const t = parsed(acmeSample());
  assert.equal(t.name, 'ACME Salesforce');
  assert.equal(t.profile, 'salesforce');
  assert.deepEqual(t.environments!.map((e) => [e.branch, e.type, e.default, e.protected]), [['production', null, false, true], ['uat', 'full', false, false], ['dev', 'developer', true, false]]);
  assert.deepEqual(t.tracker, { kind: 'jira', site: 'acme.atlassian.net', organization: null, account: null, project: 'ACME', board: null, prefix: null });
  assert.equal(t.autonomy, 'review');
  assert.deepEqual(t.agents, { max: 3, builder: { model: 'claude-opus-5-5', effort: 'high' }, reviewer: { model: 'claude-opus-5-5' } });
  assert.deepEqual(t.rules, ['https://github.com/acme/acc-rules/blob/main/salesforce.md']);
  assert.ok(describeTemplate(t).includes('Tracker: Jira on acme.atlassian.net, project ACME'));
});

test('an unknown key is refused at every level, named by its dotted path', () => {
  const t = clone(GENERIC_TEMPLATE) as Record<string, any>;
  t.gatez = {};
  t.environments[1].colour = 'blue';
  t.tracker.sit = 'acme.atlassian.net';
  t.agents.builder.efort = 'high';
  t.gates.requird = ['test'];
  t.agents.reviewr = {};
  const errors = errorsOf(t);
  for (const at of ['gatez', 'environments[1].colour', 'tracker.sit', 'agents.builder.efort', 'gates.requird', 'agents.reviewr']) {
    assert.match(errors, new RegExp(`"${at.replace(/[[\].]/g, '\\$&')}" isn't a template key`), at);
  }
  assert.match(errors, /update acc/, 'a template written for a newer acc says so');
});

test('a wrong value is refused, naming its key, by the config\'s own rules', () => {
  assert.match(errorsOf(withKey(['tracker', 'kind'], 'trello')), /"tracker\.kind" must be github, jira, azure, monday or slack/);
  assert.match(errorsOf(withKey(['agents', 'builder', 'effort'], 'huge')), /"agents\.builder\.effort" must be one of low, medium, high, xhigh, max/);
  assert.match(errorsOf(withKey(['agents', 'max'], 40)), /"agents\.max" must be a whole number from 1 to 16/);
  assert.match(errorsOf(withKey(['gates', 'severity'], 9)), /"gates\.severity"/);
  assert.match(errorsOf(withKey(['profile'], 'apex')), /"profile" must be one of generic, salesforce/);
  assert.match(errorsOf(withKey(['schema'], 2)), /"schema" must be 1/);
  const loop = withKey(['environments'], [{ name: 'main', default: true, promotesTo: ['release'] }, { name: 'release', promotesTo: ['main'] }]);
  assert.match(errorsOf(loop), /The promotion paths loop: main → release → main/);
  const twoDefaults = withKey(['environments'], [{ name: 'main', default: true }, { name: 'release', default: true }]);
  assert.match(errorsOf(twoDefaults), /exactly one environment as "default"/);
  assert.match(errorsOf(withKey(['tracker'], { kind: 'jira', project: 'ACME' })), /"tracker\.site" is needed for Jira/);
  assert.match(errorsOf(withKey(['tracker'], { kind: 'azure', organization: 'acme', prefix: 'toolong12345' })), /tracker: "prefix" must be a few letters/);
});

test('a template starts a project at manual or review, never dispatch or full (amending D-014)', () => {
  assert.equal(parsed(withKey(['autonomy'], 'manual')).autonomy, 'manual');
  assert.equal(parsed(withKey(['autonomy'], 'review')).autonomy, 'review');
  for (const a of ['dispatch', 'full']) assert.match(errorsOf(withKey(['autonomy'], a)), new RegExp(`"autonomy" can't be ${a} in a template`));
});

test('what belongs to one project\'s config is refused as that, and anything like a sign-in as a sign-in', () => {
  const t = clone(GENERIC_TEMPLATE) as Record<string, any>;
  t.github = { repo: 'acme/app', account: 'acme-dev' };
  t.commitIdentity = { name: 'Jordan Kim', email: 'jordan@example.com' };
  t.agents.permissionMode = 'dontAsk';
  t.tracker.edits = true;
  t.tracker.epic = 'ACME-3';
  t.environments[0].org = 'ACME Dev';
  t.strayFiles = { allow: ['notes.md'] };
  t.trackers = [];
  const errors = errorsOf(t);
  for (const at of ['github', 'commitIdentity', 'agents.permissionMode', 'tracker.edits', 'tracker.epic', 'environments[0].org', 'strayFiles']) {
    assert.match(errors, new RegExp(`"${at.replace(/[[\].]/g, '\\$&')}" belongs to a project's own \\.acc/config\\.json`), at);
  }
  assert.match(errors, /can't loosen what builders may do/);
  assert.match(errors, /"trackers" isn't a template key: a template names one tracker, under "tracker"/);

  const signIns = clone(GENERIC_TEMPLATE) as Record<string, any>;
  signIns.tracker.apiToken = 'x';
  signIns.tracker.password = 'x';
  signIns.token = 'x';
  const s = errorsOf(signIns);
  for (const at of ['tracker.apiToken', 'tracker.password', 'token']) assert.match(s, new RegExp(`"${at.replace('.', '\\.')}" looks like a sign-in`), at);
  assert.doesNotMatch(s, /isn't a template key/, 'a sign-in is named as one, not as an unknown key');
});

test('a tracker key for another kind says which kind takes it', () => {
  assert.match(errorsOf(withKey(['tracker'], { kind: 'jira', site: 'acme.atlassian.net', organization: 'acme' })), /"tracker\.organization" is for Azure DevOps trackers only, and this one is Jira/);
  assert.match(errorsOf(withKey(['tracker'], { kind: 'github', board: 3 })), /"tracker\.board" belongs to a project's own/);
  assert.deepEqual(parsed(withKey(['tracker'], { kind: 'monday', account: 'Acme', board: 12 })).tracker, { kind: 'monday', site: null, organization: null, account: 'acme', project: null, board: 12, prefix: null });
});

test('a team template that names a Slack tracker is refused, since its channel is each project\'s own (T-27)', () => {
  assert.match(errorsOf(withKey(['tracker'], { kind: 'slack' })), /"tracker\.kind" can't be slack in a team template: a Slack tracker's channel is each project's own/);
  assert.match(errorsOf(withKey(['tracker'], { kind: 'slack', workspace: 'acme', channel: 'C0123ABCD' })), /can't be slack in a team template/);
});

// ---------------------------------------------------------------- digest and record

test('the digest ignores whitespace and key order, and changes with a value', () => {
  const a = templateDigest(JSON.parse(JSON.stringify(GENERIC_TEMPLATE, null, 2)));
  const reordered: Record<string, unknown> = Object.fromEntries(Object.entries(clone(GENERIC_TEMPLATE)).reverse());
  reordered.agents = { builder: { effort: 'high', model: 'claude-sonnet-5-5' }, max: 2 };
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
  assert.equal(templateDigest(JSON.parse(JSON.stringify(reordered))), a);
  assert.notEqual(templateDigest(withKey(['agents', 'max'], 3)), a);
});

test('a path is recorded relative to the repo inside it, as ~/… under the home folder, and URLs as given', () => {
  const home = tempDir('home-');
  const repo = join(home, 'code', 'app');
  assert.equal(recordedSource(join(home, 'team', 'acme.json'), { home, root: repo }), '~/team/acme.json');
  assert.equal(recordedSource('~/team/acme.json', { home, root: repo }), '~/team/acme.json');
  assert.equal(recordedSource('templates/acme.json', { base: repo, home, root: repo }), 'templates/acme.json');
  assert.equal(recordedSource('/srv/team/acme.json', { home, root: repo }), resolve('/srv/team/acme.json'), 'outside both: the full path, as this system writes it');
  // A name that starts with - stays ./-…, so sourceProblem never refuses it as an option.
  assert.equal(recordedSource('./-template.json', { base: repo, home, root: repo }), './-template.json');
  const url = 'https://github.com/acme/acc-templates/blob/main/salesforce.json';
  assert.equal(recordedSource(` ${url} `, { home, root: repo }), url);
});

// ---------------------------------------------------------------- fetching

test('a GitHub file URL is read through gh api as the repo\'s account, with GH_TOKEN and never gh auth switch', () => {
  const calls: string[] = [];
  const text = JSON.stringify(acmeSample());
  const run = fakeRunner({
    'gh auth token -u acme-dev': ok('tok-acme\n'),
    'gh api repos/acme/acc-templates/contents/salesforce.json?ref=main': (o?: RunOptions) => (o?.env?.GH_TOKEN === 'tok-acme' ? ok(text) : bad('HTTP 401: Bad credentials')),
    'gh api repos/acme/acc-templates/contents/teams/ops%20team.json?ref=release%2F2': (o?: RunOptions) => (o?.env?.GH_TOKEN === 'tok-acme' ? ok(text) : bad('no token')),
  }, calls);
  assert.equal(fetchTemplateText(run, 'https://github.com/acme/acc-templates/blob/main/salesforce.json', { account: 'acme-dev' }), text);
  assert.equal(fetchTemplateText(run, 'https://raw.githubusercontent.com/acme/acc-templates/main/salesforce.json', { account: 'acme-dev' }), text);
  assert.equal(fetchTemplateText(run, 'https://github.com/acme/acc-templates/blob/release%2F2/teams/ops%20team.json', { account: 'acme-dev' }), text);
  assert.ok(calls.includes('gh api repos/acme/acc-templates/contents/salesforce.json?ref=main -H Accept: application/vnd.github.raw'));
  assert.ok(!calls.some((c) => c.startsWith('gh auth switch')), 'never gh auth switch (D-007)');
});

test('a raw.githubusercontent.com URL from GitHub\'s Raw button names its branch or tag without refs/heads/ or refs/tags/', () => {
  const at = (ref: string, path: string) => ({ kind: 'github', owner: 'acme', repo: 'acc-templates', ref, path });
  assert.deepEqual(parseSource('https://raw.githubusercontent.com/acme/acc-templates/refs/heads/main/teams/salesforce.json'), at('main', 'teams/salesforce.json'));
  assert.deepEqual(parseSource('https://raw.githubusercontent.com/acme/acc-templates/refs/tags/v2/salesforce.json'), at('v2', 'salesforce.json'));
  assert.deepEqual(parseSource('https://raw.githubusercontent.com/acme/acc-templates/main/salesforce.json'), at('main', 'salesforce.json'));
  assert.deepEqual(parseSource('https://raw.githubusercontent.com/acme/acc-templates/refs-old/salesforce.json'), at('refs-old', 'salesforce.json'), 'only a whole refs/heads/ or refs/tags/ is taken off');

  const calls: string[] = [];
  const text = JSON.stringify(GENERIC_TEMPLATE);
  const run = fakeRunner({ 'gh api repos/acme/acc-templates/contents/teams/salesforce.json?ref=main': ok(text) }, calls);
  assert.equal(fetchTemplateText(run, 'https://raw.githubusercontent.com/acme/acc-templates/refs/heads/main/teams/salesforce.json'), text);
  assert.deepEqual(calls, ['gh api repos/acme/acc-templates/contents/teams/salesforce.json?ref=main -H Accept: application/vnd.github.raw']);
});

test('a fetch\'s calls share one deadline, so B0.template\'s 20 seconds cover both of them', () => {
  // Waits without giving the event loop a turn, as a slow gh would.
  const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const waits: number[] = [];
  const text = JSON.stringify(GENERIC_TEMPLATE);
  const source = 'https://github.com/acme/acc-templates/blob/main/generic.json';
  const api = 'gh api repos/acme/acc-templates/contents/generic.json?ref=main';
  const slowToken = (ms: number) => (o?: RunOptions) => { waits.push(o!.timeoutMs!); sleep(ms); return ok('tok-acme'); };
  const run = fakeRunner({ 'gh auth token -u acme-dev': slowToken(80), [api]: (o?: RunOptions) => { waits.push(o!.timeoutMs!); return ok(text); } });
  assert.equal(fetchTemplateText(run, source, { account: 'acme-dev', timeoutMs: 1000 }), text);
  assert.ok(waits[0]! <= 1000 && waits[0]! > 900, `the first call may take it all: ${waits[0]}`);
  assert.ok(waits[1]! <= 1000 - 80, `the second gets only what's left: ${waits[1]}`);

  const calls: string[] = [];
  const spent = fakeRunner({ 'gh auth token -u acme-dev': slowToken(120), [api]: ok(text) }, calls);
  assert.throws(() => fetchTemplateText(spent, source, { account: 'acme-dev', timeoutMs: 100 }), /Couldn't read .*generic\.json within 1 second, so acc stopped/);
  assert.ok(!calls.some((c) => c.startsWith('gh api')), 'nothing starts once the time is up');
});

test('a GitHub file that isn\'t there names the source and the account', () => {
  const run = fakeRunner({
    'gh auth token -u acme-dev': ok('tok-acme'),
    'gh api repos/acme/acc-templates/contents/missing.json?ref=main': bad('gh: Not Found (HTTP 404)'),
    'gh auth token -u nobody': bad('no oauth token found for github.com account nobody'),
  });
  const source = 'https://github.com/acme/acc-templates/blob/main/missing.json';
  assert.throws(() => fetchTemplateText(run, source, { account: 'acme-dev' }), (e: Error) => e.message.includes(source) && e.message.includes('acme-dev'));
  assert.throws(() => fetchTemplateText(run, source, { account: 'nobody' }), /gh isn't logged in as nobody/);
});

test('<git-url>#<path> reads one file from a git repo\'s default branch, and removes its temporary folder', () => {
  const team = makeRepo({ 'templates/generic.json': JSON.stringify(GENERIC_TEMPLATE, null, 2) });
  const bare = join(tempDir('team-'), 'acc-templates.git');
  gitIn(team, 'clone', '-q', '--bare', team, bare);
  const calls: string[] = [];
  let env: NodeJS.ProcessEnv | undefined;
  const run = fakeRunner({}, calls);
  const spy = (cmd: string, args: string[], opts?: RunOptions): RunResult => {
    if (args[0] === 'clone') env = opts?.env;
    return run(cmd, args, opts);
  };
  const r = readTemplate(spy, `${bare}#templates/generic.json`);
  assert.deepEqual(r.errors, []);
  assert.equal(r.template!.name, 'ACME tools');
  assert.equal(env?.GIT_TERMINAL_PROMPT, '0', 'git never waits for a password');
  const clone = calls.find((c) => c.startsWith('git clone'))!;
  assert.ok(clone.includes('--no-checkout'));
  assert.ok(clone.includes(` -- ${bare} `), 'git reads the URL as a URL, never as an option');
  const dir = dirname(clone.split(' ').at(-1)!);
  assert.ok(!existsSync(dir), 'the temporary folder is gone');
  assert.throws(() => readTemplate(spy, `${bare}#templates/missing.json`), /has no templates\/missing\.json/);
  assert.ok(!existsSync(dirname(calls.filter((c) => c.startsWith('git clone')).at(-1)!.split(' ').at(-1)!)), 'gone after a failure too');
});

test('a sign-in in a URL, plain http, any other web address and a big file are refused before anything is fetched', () => {
  const calls: string[] = [];
  const run = fakeRunner({}, calls);
  assert.throws(() => fetchTemplateText(run, 'https://jordan:tok123@github.com/acme/acc-templates/blob/main/x.json'), /Take the sign-in out of the URL/);
  assert.throws(() => fetchTemplateText(run, 'https://tok123@git.example.com/acme/t.git#x.json'), /Take the sign-in out of the URL/);
  assert.throws(() => fetchTemplateText(run, 'http://git.example.com/acme/t.git#x.json'), /Use https:\/\//);
  assert.throws(() => fetchTemplateText(run, 'https://example.com/acme.json'), /only with gh or git/);
  assert.deepEqual(calls, []);
  assert.equal(sourceProblem('git@github.com:acme/acc-templates.git#salesforce.json'), null, 'an ssh user is fine');
  const big = join(tempDir(), 'big.json');
  writeFileSync(big, JSON.stringify({ ...GENERIC_TEMPLATE, description: 'x'.repeat(100 * 1024) }));
  assert.throws(() => fetchTemplateText(run, big), /over 64 KB/);
});

test('a source that starts with "-" is refused before git sees it, since a committed source reaches git on every Setup refresh', () => {
  const calls: string[] = [];
  const run = fakeRunner({}, calls);
  for (const s of ['--upload-pack=touch /tmp/acc-owned#x.json', '-uevil#x.json', '  --config=core.sshCommand=x#t.json', '-template.json']) {
    assert.match(sourceProblem(s)!, /can't start with "-", which git would read as an option/, s);
    assert.throws(() => parseSource(s), /can't start with "-"/, s);
    assert.throws(() => readTemplate(run, s), /can't start with "-"/, s);
  }
  assert.deepEqual(calls, []);
  const dir = tempDir();
  assert.deepEqual(parseSource('./-template.json', dir), { kind: 'file', path: join(dir, '-template.json') }, 'a file named so is given as ./-…');
});

// ---------------------------------------------------------------- acc init

/** A generic repo with an origin on GitHub, pushing as acme-dev. */
function genericRepo(): { repo: string; run: ReturnType<typeof fakeRunner>; calls: string[] } {
  const repo = makeRepo();
  gitIn(repo, 'remote', 'add', 'origin', 'https://github.com/acme/app.git');
  gitIn(repo, 'config', 'credential.helper', '');
  gitIn(repo, 'config', '--add', 'credential.helper', '!f() { test "$1" = get || exit 0; echo username=acme-dev; echo password=tok-acme; }; f');
  const calls: string[] = [];
  const run = fakeRunner({ 'gh api user --jq .login': (o?: RunOptions) => ok(o?.env?.GH_TOKEN === 'tok-acme' ? 'acme-dev' : 'someone-else') }, calls);
  return { repo, run, calls };
}

const loaded = (raw: unknown, source = '~/team/acme.json') => {
  const t = parsed(raw);
  return { template: t, record: { name: t.name, source, digest: templateDigest(raw) } };
};

test('acc init from a generic template: the template wins where it speaks, and discovery fills the rest', () => {
  const { repo, run } = genericRepo();
  const plan = planInit(run, { root: repo, template: loaded(GENERIC_TEMPLATE) });
  const c = plan.config;
  assert.equal(c.profile, 'generic');
  assert.deepEqual(c.environments.map((e) => [e.branch, e.default, e.protected, e.promotesTo]), [['main', true, false, ['release']], ['release', false, true, []]]);
  assert.deepEqual(c.gates.required, ['test', 'lint']);
  assert.deepEqual(c.gates.commands, { test: 'npm test', lint: 'npm run lint' });
  assert.deepEqual(c.trackers.map((t) => [t.kind, t.site, t.project]), [['jira', 'acme.atlassian.net', 'ACME']]);
  assert.equal(c.autonomy, 'review');
  assert.equal(c.agents.max, 2);
  assert.deepEqual(c.agents.builder, { model: 'claude-sonnet-5-5', effort: 'high', fallbackModel: null });
  assert.equal(c.agents.permissionMode, 'acceptEdits', 'a template never sets it');
  // Discovered.
  assert.deepEqual(c.github, { repo: 'acme/app', account: 'acme-dev' });
  assert.deepEqual(c.commitIdentity, { name: 'Test Person', email: 'test@example.com' });
  assert.equal(c.project, repo.split('/').pop());
  assert.deepEqual(plan.fromTemplate, ['profile', 'environments', 'gates', 'trackers', 'autonomy', 'agents']);
  assert.deepEqual(plan.discovered, ['project', 'github', 'commitIdentity']);
  assert.deepEqual(plan.templateCommands, { test: 'npm test', lint: 'npm run lint' });
  assert.deepEqual(c.template, { name: 'ACME tools', source: '~/team/acme.json', digest: templateDigest(GENERIC_TEMPLATE) });

  // The written config loads again, with no warning.
  const file = join(repo, '.acc', 'config.json');
  writeConfig(file, c);
  const again = loadConfig(file);
  assert.deepEqual(again.warnings, []);
  assert.deepEqual(again.config.template, c.template);
  assert.deepEqual(templateDifferences(parsed(GENERIC_TEMPLATE), again.config), [], 'a project made from a template agrees with it');
});

test('a template that sets little leaves the rest to discovery and the Command Center\'s defaults', () => {
  const { repo, run } = genericRepo();
  const plan = planInit(run, { root: repo, template: loaded({ schema: 1, name: 'ACME minimal', gates: { required: ['test'], commands: { test: 'npm test' } } }) });
  assert.equal(plan.config.profile, 'generic');
  assert.deepEqual(plan.config.environments.map((e) => e.branch), ['main']);
  assert.equal(plan.config.autonomy, 'manual');
  assert.equal(plan.config.agents.max, 3);
  assert.deepEqual(plan.config.trackers, []);
  assert.deepEqual(plan.fromTemplate, ['gates']);
  assert.deepEqual(plan.discovered, ['project', 'github', 'commitIdentity', 'environments']);
});

test('flags beat the template: --jira-project replaces its project, and a --profile that disagrees is refused', () => {
  const { repo, run } = genericRepo();
  const plan = planInit(run, { root: repo, template: loaded(GENERIC_TEMPLATE), jiraProject: 'OPS' });
  assert.deepEqual(plan.config.trackers.map((t) => [t.site, t.project]), [['acme.atlassian.net', 'OPS']]);
  assert.throws(() => planInit(run, { root: repo, template: loaded(GENERIC_TEMPLATE), profile: 'salesforce' }), /--profile salesforce disagrees with the template's profile, generic/);

  // A Jira site with no project, and no --jira-project: the tracker waits for the Connect page.
  const noProject = withKey(['tracker'], { kind: 'jira', site: 'acme.atlassian.net' });
  const left = planInit(run, { root: repo, template: loaded(noProject) });
  assert.deepEqual(left.config.trackers, []);
  assert.ok(left.notes.some((n) => /Jira tracker, acme\.atlassian\.net, names no project.*--jira-project.*Connect page/.test(n)), left.notes.join('\n'));
  assert.ok(!left.fromTemplate.includes('trackers'));
  assert.deepEqual(planInit(run, { root: repo, template: loaded(noProject), jiraProject: 'ACME' }).config.trackers.map((t) => t.project), ['ACME']);
});

test('a tracker picked on the Connect page is written as it is, narrowed to its place, and replaces the template\'s (GH-81)', () => {
  const { repo, run } = genericRepo();
  // As each description's toConfig gives it: nulls for what wasn't picked.
  const cases: [Record<string, unknown>, unknown[]][] = [
    [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', board: 7, epic: 'ACME-3' }, ['jira', 'acme.atlassian.net', 'ACME', 7, ['ACME-3'], [], null]],
    [{ kind: 'azure', organization: 'acme', project: 'CRM', team: 'Sales', board: 'Stories', areaPath: 'CRM\\Billing' }, ['azure', 'acme', 'CRM', 'Stories', [], [], 'CRM\\Billing']],
    [{ kind: 'github', repo: null, labels: ['billing', 'invoices'] }, ['github', null, null, null, [], ['billing', 'invoices'], null]],
    [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', board: 7, epic: null, epics: ['ACME-3', 'ACME-7'] }, ['jira', 'acme.atlassian.net', 'ACME', 7, ['ACME-3', 'ACME-7'], [], null]],
  ];
  let checked = 0;
  for (const [tracker, want] of cases) {
    const plan = planInit(run, { root: repo, tracker });
    assert.equal(plan.config.trackers.length, 1);
    const t = plan.config.trackers[0]!;
    assert.deepEqual([t.kind, t.site ?? t.organization, t.project, t.board, t.epics, t.labels, t.areaPath], want, tracker.kind as string);
    assert.deepEqual(plan.notes.filter((n) => /--tracker/.test(n)), [], 'nothing replaced, nothing to say');
    checked++;
  }
  assert.equal(checked, 4);

  // The template's Jira tracker gives way to an Azure one, and --jira-* to a Jira epic, each with a note.
  const azure = planInit(run, { root: repo, template: loaded(GENERIC_TEMPLATE), tracker: cases[1]![0] });
  assert.deepEqual(azure.config.trackers.map((t) => [t.kind, t.areaPath]), [['azure', 'CRM\\Billing']]);
  assert.ok(azure.notes.includes('The tracker picked (--tracker) replaces the template\'s: Jira on acme.atlassian.net, project ACME.'), azure.notes.join('\n'));
  assert.ok(!azure.fromTemplate.includes('trackers'), 'the tracker isn\'t the template\'s');
  assert.deepEqual(azure.config.gates.required, ['test', 'lint'], 'the rest of the template still applies');
  const jira = planInit(run, { root: repo, template: loaded(GENERIC_TEMPLATE), jiraProject: 'OPS', tracker: cases[0]![0] });
  assert.deepEqual(jira.config.trackers.map((t) => [t.project, t.epics]), [['ACME', ['ACME-3']]]);
  assert.ok(jira.notes.some((n) => /replaces --jira-site and --jira-project/.test(n)), jira.notes.join('\n'));

  // A template's key prefix stays on the same kind of tracker on the same host, unless the one picked names
  // its own, as withTracker keeps it on a replace. Another host, or another kind, starts without it.
  const azureTemplate = { ...GENERIC_TEMPLATE, tracker: { kind: 'azure', organization: 'Acme', project: 'CRM', prefix: 'crm' } };
  const prefixes: [Record<string, unknown>, unknown][] = [
    [cases[1]![0], 'CRM'],
    [{ ...cases[1]![0], prefix: 'BIL' }, 'BIL'],
    [{ ...cases[1]![0], prefix: null }, 'CRM'],
    [{ ...cases[1]![0], organization: 'contoso' }, undefined],
    [cases[0]![0], undefined],
  ];
  let kept = 0;
  for (const [tracker, want] of prefixes) {
    const plan = planInit(run, { root: repo, template: loaded(azureTemplate), tracker });
    assert.equal(plan.config.trackers[0]!.prefix ?? undefined, want, JSON.stringify(tracker));
    assert.equal(plan.notes.some((n) => /keeping its key prefix CRM/.test(n)), want === 'CRM', plan.notes.join('\n'));
    kept++;
  }
  assert.equal(kept, prefixes.length);

  // Checked as the config is: an unknown kind, or a Jira tracker with no project, is refused.
  assert.throws(() => planInit(run, { root: repo, tracker: { kind: 'trello', board: 1 } }), /trackers\[0\]: "kind" must be/);
  assert.throws(() => planInit(run, { root: repo, tracker: { kind: 'jira', site: 'acme.atlassian.net', epic: 'ACME-3' } }), /a Jira tracker needs "site" and "project"/);
});

test('acc init --from reads the template as the account the repo pushes as', () => {
  const { repo, calls } = genericRepo();
  const text = JSON.stringify(GENERIC_TEMPLATE);
  const run = fakeRunner({
    'gh api user --jq .login': (o?: RunOptions) => ok(o?.env?.GH_TOKEN === 'tok-acme' ? 'acme-dev' : 'someone-else'),
    'gh auth token -u acme-dev': ok('tok-acme'),
    'gh api repos/acme/acc-templates/contents/generic.json?ref=main': (o?: RunOptions) => (o?.env?.GH_TOKEN === 'tok-acme' ? ok(text) : bad('HTTP 404')),
  }, calls);
  const source = 'https://github.com/acme/acc-templates/blob/main/generic.json';
  const plan = planInit(run, { root: repo, from: source });
  assert.deepEqual(plan.config.template, { name: 'ACME tools', source, digest: templateDigest(GENERIC_TEMPLATE) });
  assert.ok(calls.includes('gh auth token -u acme-dev'));
  assert.throws(() => planInit(run, { root: repo, from: source, githubAccount: 'nobody' }), /gh isn't logged in as nobody/);
});

test('acc init --from and acc template show read a GitHub template as one account: --github-account, else a GitHub origin\'s, else gh\'s active one', () => {
  const { repo, run } = genericRepo();
  assert.equal(templateAccount(run, repo), 'acme-dev', 'the account a GitHub origin pushes as');
  assert.equal(templateAccount(run, repo, 'acme-ops'), 'acme-ops', '--github-account wins');
  assert.equal(templateAccount(run, null), null, 'outside a repo: gh\'s active account');
  assert.equal(templateAccount(run, makeRepo()), null, 'no origin: gh\'s active account');

  // The same credential, but an origin that isn't on GitHub: gh's active account, though --github-repo names one.
  gitIn(repo, 'remote', 'set-url', 'origin', 'https://git.example.com/acme/app.git');
  assert.equal(templateAccount(run, repo), null);
  const calls: string[] = [];
  const text = JSON.stringify(GENERIC_TEMPLATE);
  const active = fakeRunner({
    'gh api user --jq .login': (o?: RunOptions) => ok(o?.env?.GH_TOKEN === 'tok-acme' ? 'acme-dev' : 'someone-else'),
    'gh api repos/acme/acc-templates/contents/generic.json?ref=main': (o?: RunOptions) => (o?.env?.GH_TOKEN === 'tok-acme' ? bad('read as the pushing account') : ok(text)),
  }, calls);
  const plan = planInit(active, { root: repo, from: 'https://github.com/acme/acc-templates/blob/main/generic.json', githubRepo: 'acme/app' });
  assert.equal(plan.config.template?.name, 'ACME tools');
  assert.deepEqual(plan.config.github, { repo: 'acme/app', account: 'acme-dev' }, 'the config still records the account the repo pushes as');
  assert.ok(!calls.some((c) => c.startsWith('gh auth token')), calls.join('\n'));
});

const SANDBOX_INIT = 'sf data query --use-tooling-api -q SELECT SandboxName, LicenseType FROM SandboxInfo ORDER BY SandboxName -o ACME Production';
const SANDBOX_CHECK = 'sf data query --use-tooling-api -q SELECT SandboxName, LicenseType FROM SandboxInfo -o ACME Production';

/** ACME's real orgs: Production, and Dev, Int and UAT sandboxes, each logged in. */
function acmeOrgs(): Record<string, RunResult> {
  const sandboxes = sf({ records: [{ SandboxName: 'Dev', LicenseType: 'DEVELOPER' }, { SandboxName: 'Int', LicenseType: 'PARTIAL' }, { SandboxName: 'UAT', LicenseType: 'FULL' }] });
  return {
    'sf org display -o ACME Production': sf({ instanceUrl: 'https://acme.my.salesforce.com' }),
    [SANDBOX_INIT]: sandboxes,
    [SANDBOX_CHECK]: sandboxes,
    'sf org list': sf({ nonScratchOrgs: [
      { alias: 'ACME Dev', instanceUrl: 'https://acme--dev.sandbox.my.salesforce.com' },
      { alias: 'ACME Int', instanceUrl: 'https://acme--int.sandbox.my.salesforce.com' },
      { alias: 'ACME UAT', instanceUrl: 'https://acme--uat.sandbox.my.salesforce.com' },
    ] }),
  };
}

test('a Salesforce template meets the real sandboxes: Production\'s list decides which exist, and the template\'s paths and default win for those it names', () => {
  const repo = makeRepo();
  const run = fakeRunner(acmeOrgs());
  const template = {
    schema: 1, name: 'ACME Salesforce', profile: 'salesforce',
    environments: [
      { name: 'Production' },
      { name: 'Int', default: true, promotesTo: ['production'] },
      { name: 'QA', type: 'partial', promotesTo: ['production'] },
      { name: 'Dev', type: 'developer', promotesTo: ['int', 'qa'] },
    ],
  };
  const plan = planInit(run, { root: repo, productionOrg: 'ACME Production', template: loaded(template) });
  const envs = Object.fromEntries(plan.config.environments.map((e) => [e.branch, e]));
  assert.deepEqual(Object.keys(envs), ['production', 'dev', 'int', 'uat'], 'QA isn\'t a sandbox, so it\'s left out; UAT is kept');
  assert.deepEqual([envs.int!.default, envs.dev!.default], [true, false], 'the template\'s default wins over discovery\'s Developer sandbox');
  assert.deepEqual(envs.int!.promotesTo, ['production'], 'the template\'s path, not acc\'s int → uat → production');
  assert.deepEqual(envs.dev!.promotesTo, ['int'], 'the promotion to QA is dropped');
  assert.deepEqual(envs.uat!.promotesTo, ['production'], 'UAT keeps acc\'s usual path');
  assert.equal(envs.int!.type, 'partial', 'the type is Salesforce\'s');
  const notes = plan.notes.join('\n');
  assert.match(notes, /The template's QA isn't one of Production's sandboxes, so it's left out/);
  assert.match(notes, /UAT isn't in the template, so it keeps acc's usual path \(to production\)/);
  assert.match(notes, /Dev's promotion to qa is left out/);
  assert.deepEqual(plan.fromTemplate, ['profile', 'environments']);
  assert.ok(plan.discovered.includes('environments'));

  // B1.orgs passes against the same orgs.
  writeConfig(join(repo, '.acc', 'config.json'), plan.config);
  const ctx = makeContext(repo, run, { ...process.env, GIT_CONFIG_NOSYSTEM: '1' });
  const b1 = runSteps(ctx, 'project', ['B1.orgs'])[0]!.result;
  assert.equal(b1.status, 'pass', b1.detail);
});

test('a Salesforce template whose default isn\'t a sandbox keeps discovery\'s default, and says so', () => {
  const repo = makeRepo();
  const plan = planInit(fakeRunner(acmeOrgs()), {
    root: repo, productionOrg: 'ACME Production',
    template: loaded({ schema: 1, name: 'ACME', profile: 'salesforce', environments: [{ name: 'Production' }, { name: 'Sandbox', default: true, promotesTo: ['production'] }] }),
  });
  assert.equal(plan.config.environments.find((e) => e.default)!.branch, 'dev');
  assert.match(plan.notes.join('\n'), /The template's default, Sandbox, isn't one of Production's sandboxes, so Dev stays the default/);
});

test('a template that sets no profile leaves out the types it doesn\'t give, so --profile salesforce hears no false note about them', () => {
  const template = {
    schema: 1, name: 'ACME any',
    environments: [{ name: 'Production' }, { name: 'UAT', promotesTo: ['production'] }, { name: 'Int', type: 'full', promotesTo: ['uat'] }, { name: 'Dev', default: true, promotesTo: ['int'] }],
  };
  const t = parsed(template);
  assert.equal(t.profile, null);
  assert.deepEqual(t.environments!.map((e) => [e.branch, e.type, e.protected]), [['production', null, false], ['uat', null, false], ['int', 'full', false], ['dev', null, false]]);
  assert.ok(describeTemplate(t).includes('Environments: Production; UAT → production; Int (full) → uat; Dev, the default → int'), describeTemplate(t).join('\n'));

  const repo = makeRepo();
  const run = fakeRunner(acmeOrgs());
  const plan = planInit(run, { root: repo, profile: 'salesforce', productionOrg: 'ACME Production', template: loaded(template) });
  const notes = plan.notes.join('\n');
  assert.deepEqual(notes.match(/Production's sandbox list says/g), ['Production\'s sandbox list says'], notes);
  assert.match(notes, /The template says Int is full, but Production's sandbox list says partial, and that wins/, 'only a type the template gave is weighed');
  assert.deepEqual(plan.config.environments.map((e) => [e.branch, e.type, e.default, e.protected, e.promotesTo]), [
    ['production', 'production', false, true, []], ['dev', 'developer', true, false, ['int']], ['int', 'partial', false, false, ['uat']], ['uat', 'full', false, false, ['production']],
  ]);
  writeConfig(join(repo, '.acc', 'config.json'), plan.config);
  const b1 = runSteps(makeContext(repo, run, { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }), 'project', ['B1.orgs'])[0]!.result;
  assert.equal(b1.status, 'pass', b1.detail);

  // In a generic project the same environments are type none, as the template gives them.
  const { repo: g, run: gRun } = genericRepo();
  const generic = planInit(gRun, { root: g, template: loaded(template) });
  assert.deepEqual(generic.config.environments.map((e) => [e.branch, e.type]), [['production', 'none'], ['uat', 'none'], ['int', 'full'], ['dev', 'none']]);
});

test('a bad template is refused with every problem it has', () => {
  const dir = tempDir();
  const file = join(dir, 'bad.json');
  writeFileSync(file, JSON.stringify(withKey(['gatez'], {})));
  const calls: string[] = [];
  assert.throws(() => loadTemplate(fakeRunner({}, calls), file), (e: Error) => e.message.includes('isn\'t a team template acc can use') && e.message.includes('"gatez"'));
  writeFileSync(file, '{ not json');
  assert.throws(() => loadTemplate(fakeRunner({}), file), /isn't valid JSON/);
  mkdirSync(join(dir, 'empty'));
  assert.throws(() => loadTemplate(fakeRunner({}), join(dir, 'empty', 'none.json')), /There's no team template at/);
});

// ---------------------------------------------------------------- what differs

test('templateDifferences names the keys a project now differs on, and agrees where the project chose within the template', () => {
  const base = parseConfig({ schema: 1, project: 'App', profile: 'generic', environments: [{ name: 'main', default: true, promotesTo: ['release'] }, { name: 'release', protected: true }],
    trackers: [{ kind: 'jira', site: 'acme.atlassian.net', project: 'OPS' }], gates: { required: ['lint', 'test'], commands: { test: 'npm test', lint: 'npm run lint', extra: 'make' } },
    autonomy: 'review', agents: { max: 2, builder: { model: 'claude-sonnet-5-5', effort: 'high' } } }).config!;
  assert.deepEqual(templateDifferences(parsed(GENERIC_TEMPLATE), base), [], 'another Jira project, and an extra gate command, still agree');
  const changed = clone(GENERIC_TEMPLATE) as Record<string, any>;
  changed.gates.required = ['test'];
  changed.agents.max = 4;
  changed.agents.builder.effort = 'max';
  changed.environments[1].protected = false;
  changed.tracker = { kind: 'azure', organization: 'acme', project: 'CRM' };
  changed.autonomy = 'manual';
  assert.deepEqual(templateDifferences(parsed(changed), base), ['environments', 'gates.required', 'tracker', 'autonomy', 'agents.max', 'agents.builder.effort']);
  assert.deepEqual(templateDifferences(parsed(withKey(['profile'], 'salesforce', { schema: 1, name: 'x' })), base), ['profile']);
});

test('a template may name rules files to copy in: URLs or paths from / or ~/, each to its own name (GH-108)', () => {
  const rules = ['https://github.com/acme/acc-rules/blob/main/salesforce.md', 'git@github.com:acme/acc-rules.git#apex-logging.md', '~/team/acme-security.md'];
  const t = parsed({ ...clone(GENERIC_TEMPLATE), rules });
  assert.deepEqual(t.rules, rules);
  assert.ok(describeTemplate(t).includes(`Rules copied into .acc/rules/: ${rules.join('; ')}`));
  assert.equal(parsed(clone(GENERIC_TEMPLATE)).rules, null, 'none named: none copied');
  assert.match(errorsOf({ ...clone(GENERIC_TEMPLATE), rules: 'https://github.com/acme/acc-rules/blob/main/salesforce.md' }), /"rules" must be a list of rules files to copy in/);
  assert.match(errorsOf({ ...clone(GENERIC_TEMPLATE), rules: [] }), /"rules" must be a list/);
  assert.match(errorsOf({ ...clone(GENERIC_TEMPLATE), rules: ['team/acme.md'] }), /"rules\[0\]": team\/acme\.md is a relative path, which would mean a different file on each machine/);
  assert.match(errorsOf({ ...clone(GENERIC_TEMPLATE), rules: ['http://git.example.com/r.git#x.md'] }), /"rules\[0\]": Use https:\/\/: acc doesn't fetch a rules file over plain http/);
  assert.match(errorsOf({ ...clone(GENERIC_TEMPLATE), rules: ['--upload-pack=x#y.md'] }), /"rules\[0\]": A rules file's source can't start with "-"/);
  assert.match(errorsOf({ ...clone(GENERIC_TEMPLATE), rules: ['/srv/a/acme.md', '/srv/b/ACME.md'] }), /"rules\[1\]" and "rules\[0\]" would both be copied to \.acc\/rules\/acme\.md/);
});

test('templateDifferences says rules differ when the template names a source with no copy in the repo (GH-108)', () => {
  const file = join(tempDir('team-'), 'acme.md');
  writeFileSync(file, '- Every change has a test.\n');
  const repo = makeRepo();
  const t = parsed({ schema: 1, name: 'ACME tools', rules: [file] });
  const config = parseConfig(GENERIC_CONFIG).config!;
  assert.deepEqual(templateDifferences(t, config, { root: repo }), ['rules']);
  assert.deepEqual(templateDifferences(t, config), [], 'without the repo, rules aren\'t compared');
  importRules(run, repo, file);
  assert.deepEqual(templateDifferences(t, config, { root: repo }), []);
});

test('the preview of a template that turns a project Salesforce names the Production org it needs', () => {
  const record = { name: 'Acme', source: 'templates/acme.json', digest: 'sha256:x' } as never;
  const generic = { profile: 'generic', environments: [{ name: 'main', branch: 'main', type: 'none' }] } as never;
  assert.equal(previewCommand({ profile: 'salesforce' } as never, record, generic), "acc init --from 'templates/acme.json' --production-org <production-org-alias> --dry-run");
  const sf = { profile: 'salesforce', environments: [{ name: 'Production', branch: 'main', type: 'production', org: 'acme-prod' }] } as never;
  assert.equal(previewCommand({ profile: 'salesforce' } as never, record, sf), "acc init --from 'templates/acme.json' --production-org 'acme-prod' --dry-run");
  assert.equal(previewCommand({} as never, record, generic), "acc init --from 'templates/acme.json' --profile generic --dry-run");
});
