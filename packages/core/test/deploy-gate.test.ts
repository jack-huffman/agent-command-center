// The deploy gate (D-T-115): a Salesforce builder deploys its change to its build org, checks each component is
// there, and runs the named Apex tests in the org, with a fake sf that records every call. It reads where it goes
// from the project's settings, never its worktree's copy; asks Salesforce which org that is and refuses production;
// refuses where else it mustn't; takes turns on one org, by its username; stops while another task in flight
// changes a file it changed, or can't be read; and acc done refuses a Salesforce task until the task's own
// deploy passed on the last commit, however many refreshes skipped it.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { type Config, parseConfig, withDeploy } from '../src/config.ts';
import { commandGateProblem, DEPLOY_GATE, deploysByHand, HAND_DEPLOY_DENIES, handDeployIn } from '../src/deploy-commands.ts';
import {
  apexTestArgs, DEPLOY_ELSEWHERE, deployedComponents, deployGate, deployGateArgs, type DeployTests, latestDeploys, listMetadataArgs, orgDisplayArgs, orgLockDir, readApexRun, readListed, readOrgDisplay, recordDeploy,
  type TaskDeploy, testsWords,
} from '../src/deploy-gate.ts';
import { deploy, deployedByTasks, lastDeploy, writeDeployRecord } from '../src/deploy.ts';
import { run, type RunResult } from '../src/exec.ts';
import { assertCheckOnly, deployProblems, gatesFor, outcome, parseDeployJson, runGates } from '../src/gates.ts';
import { guardBash, guardEdit } from '../src/hooks.ts';
import { checkMove, mutate, readLedger, type Task, upsertTasks } from '../src/ledger.ts';
import { branchFilesAt, branchRef, inFlightFilesStrict } from '../src/overlap.ts';
import { builderSettings } from '../src/packet.ts';
import { repoPaths } from '../src/paths.ts';
import { countsForDone, readReceipt, receiptHooks, satisfies, writeReceipt } from '../src/receipts.ts';
import { trustedSettings } from '../src/trusted-settings.ts';
import { fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, ok, sf, SF_CONFIG, tempDir } from './support.ts';

const now = () => new Date('2026-10-23T12:00:00Z');
/** The project's settings as the fixture commits them: SF_CONFIG with UAT protected, and QA, an environment with no org. */
const RAW = { ...SF_CONFIG, environments: [...SF_CONFIG.environments.map((e) => (e.name === 'UAT' ? { ...e, protected: true } : e)), { name: 'QA', type: 'developer' }] };
const config = (raw: unknown = RAW): Config => {
  const r = parseConfig(raw);
  assert.deepEqual(r.errors, []);
  return r.config!;
};
const env = (c: Config, branch = 'dev') => c.environments.find((e) => e.branch === branch)!;
const write = (dir: string, rel: string, text: string) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const commitAll = (dir: string, msg = 'change') => { gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-q', '-m', msg); };
const CLASS = 'force-app/main/default/classes/Account.cls';
const FIELD = 'force-app/main/default/objects/Account/fields/Foo__c.field-meta.xml';
const TESTS = [{ name: 'AccountTest', reason: 'covers Account' }];
const SANDBOX = { username: 'dev@acme.com.dev', id: '00D000000000001', instanceUrl: 'https://acme--dev.sandbox.my.salesforce.com' };
const SFDX_PROJECT = JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] });
const SOURCE = {
  'sfdx-project.json': SFDX_PROJECT,
  [CLASS]: 'public class Account {}\n',
  'force-app/main/default/classes/Old.cls': 'public class Old {}\n',
  'force-app/main/default/emailservices/EmailToCase.xml-meta.xml': '<x/>\n',
  'manifest/environment-specific.txt': 'force-app/main/default/emailservices/EmailToCase.xml-meta.xml\n',
  'manifest/known-drift.txt': '',
  '.gitignore': '.sf/\n',
};

/**
 * A Salesforce repo on dev, its settings committed there, with uat, qa and production beside it, T-1 running
 * on its own branch (checked out here) with Account changed and a field added, and T-2 running on a branch of
 * its own that changed nothing yet. validate passed on T-1's commit, as a deploy follows a check-only one.
 */
function fixture() {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(RAW), ...SOURCE });
  gitIn(dir, 'branch', '-m', 'dev');
  for (const b of ['uat', 'qa', 'production']) gitIn(dir, 'branch', b, 'dev');
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-2-other');
  gitIn(dir, 'checkout', '-q', 'dev');
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-1-thing');
  write(dir, CLASS, 'public class Account { void go() {} }\n');
  write(dir, FIELD, '<CustomField/>\n');
  commitAll(dir);
  const c = config();
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, c, [{ source: { kind: 'manual', key: 'T-1' }, title: 'Thing' }, { source: { kind: 'manual', key: 'T-2' }, title: 'Other' }], 'human', 'human:test', emit, now);
    for (const t of l.tasks) {
      t.state = 'running';
      t.run = { branch: `task/${t.id}-${t.id === 'T-1' ? 'thing' : 'other'}` };
    }
  });
  const sha = gitIn(dir, 'rev-parse', 'HEAD');
  const at = now().toISOString();
  /** A passing receipt for a gate on the commit checked out now. */
  const passed = (gate: string) => writeReceipt(paths, { gate, sha: gitIn(dir, 'rev-parse', 'HEAD'), env: 'dev', status: 'pass', startedAt: at, finishedAt: at, durationMs: 1, summary: 'Passed.', command: null, log: null });
  passed('validate');
  return { dir, c, paths, sha, passed };
}

/** A fake sf: which org, the deploy, the org's listings, and the test run, each recorded. `over` replaces any of them. */
function fakeSf(calls: string[], over: Record<string, RunResult | (() => RunResult)> = {}) {
  return fakeRunner({
    'nice -n 15 sf org display': sf(SANDBOX),
    'nice -n 15 sf project deploy start': sf({ id: '0Af1', success: true, numberComponentsTotal: 2 }),
    'nice -n 15 sf org list metadata --metadata-type ApexClass': sf([{ fullName: 'Account', type: 'ApexClass' }, { fullName: 'AccountTest', type: 'ApexClass' }]),
    'nice -n 15 sf org list metadata --metadata-type CustomField': sf([{ fullName: 'Account.Foo__c', type: 'CustomField' }]),
    'nice -n 15 sf apex run test': sf({ summary: { outcome: 'Passed', testsRan: 3, passing: 3, failing: 0, skipped: 0, testRunCoverage: '91%', testRunId: '707x1' }, tests: [] }),
    ...over,
  }, calls);
}

const slots = (more: Record<string, unknown> = {}) => ({ dir: tempDir('slots-'), ...more });
const deployRun = (f: ReturnType<typeof fixture>, runner: ReturnType<typeof fakeRunner>, more: Record<string, unknown> = {}) =>
  runGates(f.paths, f.c, env(f.c), [DEPLOY_GATE], TESTS, { run: runner, now, slots: slots(), task: 'T-1', deploys: true, ...more }).results[0]!;
const ledgerTask = (paths: ReturnType<typeof repoPaths>, id = 'T-1'): Task => readLedger(paths.ledger).tasks.find((t) => t.id === id)!;
const sfCalls = (calls: string[]) => calls.filter((l) => l.startsWith('nice -n 15 sf'));

// ---------------------------------------------------------------- the deploy, its check and its tests

test('the deploy gate asks which org, deploys the changed source with the named tests, asks the org for each component, runs the tests there, and records it all', () => {
  const f = fixture();
  const calls: string[] = [];
  const r = deployRun(f, fakeSf(calls));
  assert.equal(r.status, 'pass', r.summary);
  assert.match(r.summary, /^Deployed 2 components to Acme Dev \(job 0Af1\): 2 listed in the org; 3 tests passed in the org, 91% coverage\.$/);
  // Which org, first: Salesforce says, before anything goes.
  assert.equal(sfCalls(calls)[0], 'nice -n 15 sf org display --target-org Acme Dev --json');
  // The deploy: a real one, of the changed paths, at the test level the change needs.
  const deployed = calls.find((l) => l.includes('deploy start'))!;
  assert.match(deployed, /^nice -n 15 sf project deploy start --target-org Acme Dev --wait 90 --json --source-dir force-app\/main\/default\/classes\/Account\.cls --source-dir force-app\/main\/default\/objects\/Account\/fields\/Foo__c\.field-meta\.xml --test-level RunSpecifiedTests --tests AccountTest$/);
  assert.ok(!deployed.includes('--dry-run'), 'not check-only');
  // The verify: each component's type asked for, once.
  assert.deepEqual(calls.filter((l) => l.includes('list metadata')), [
    'nice -n 15 sf org list metadata --metadata-type ApexClass --target-org Acme Dev --json',
    'nice -n 15 sf org list metadata --metadata-type CustomField --target-org Acme Dev --json',
  ]);
  // The tests, in the org, with coverage.
  assert.deepEqual(calls.filter((l) => l.includes('apex run test')), ['nice -n 15 sf apex run test --target-org Acme Dev --class-names AccountTest --result-format json --code-coverage --wait 60 --json']);
  // The receipt: which org (its username), what was deployed, the job, the tests and their result, with every command in its log.
  const receipt = readReceipt(f.paths, f.sha, DEPLOY_GATE)!;
  assert.equal(receipt.status, 'pass');
  assert.deepEqual([receipt.details!.jobId, receipt.details!.username, receipt.details!.orgId, receipt.details!.orgKind], ['0Af1', 'dev@acme.com.dev', '00D000000000001', 'sandbox']);
  assert.deepEqual(receipt.details!.components, ['Apex Class: Account', 'Custom Field: Account.Foo__c']);
  assert.deepEqual([receipt.details!.verified, receipt.details!.missing, receipt.details!.unchecked], [2, [], []]);
  assert.deepEqual(receipt.details!.tests, TESTS);
  assert.deepEqual(receipt.details!.testRun, { id: '707x1', names: ['AccountTest'], outcome: 'pass', ran: 3, failed: 0, coverage: '91%', failures: [] });
  assert.deepEqual(receipt.counts, { run: 3, passed: 3, failed: 0, skipped: 0, todo: 0, runner: 'apex' });
  assert.equal(receipt.elsewhere, undefined, 'the task\'s own deploy');
  assert.match(receipt.command!, /^sf org display --target-org 'Acme Dev'/);
  const log = readFileSync(receipt.log!, 'utf8');
  assert.ok(log.includes('$ sf org display') && log.includes('$ sf project deploy start') && log.includes('$ sf org list metadata') && log.includes('$ sf apex run test'), 'each step is logged');
  // The task's record: the org and its username, the components, the time, the tests.
  const t = ledgerTask(f.paths);
  assert.equal(t.deploys!.length, 1);
  const d = t.deploys![0]!;
  assert.deepEqual([d.env, d.org, d.username, d.sha, d.at, d.jobId, d.paths, d.verified], ['dev', 'Acme Dev', 'dev@acme.com.dev', f.sha, now().toISOString(), '0Af1', [CLASS, FIELD], 2]);
  assert.deepEqual(d.tests, { names: ['AccountTest'], outcome: 'pass', ran: 3, failed: 0, coverage: '91%' });
  assert.deepEqual(latestDeploys(t.deploys).map((x) => x.org), ['Acme Dev']);
});

test('without Apex the deploy runs no tests (NoTestRun), and the record says so', () => {
  const f = fixture();
  write(f.dir, CLASS, 'public class Account {}\n');
  commitAll(f.dir, 'only the field');
  const sha = gitIn(f.dir, 'rev-parse', 'HEAD');
  f.passed('validate');
  const calls: string[] = [];
  const r = runGates(f.paths, f.c, env(f.c), [DEPLOY_GATE], [], { run: fakeSf(calls, { 'nice -n 15 sf project deploy start': sf({ id: '0Af3', success: true, numberComponentsTotal: 1 }) }), now, slots: slots(), task: 'T-1', deploys: true }).results[0]!;
  assert.equal(r.status, 'pass', r.summary);
  assert.match(r.summary, /1 component to Acme Dev \(job 0Af3\): 1 listed in the org; no tests: no Apex changed\.$/);
  assert.ok(calls.find((l) => l.includes('deploy start'))!.endsWith('--test-level NoTestRun'));
  assert.ok(!calls.some((l) => l.includes('apex run test')), 'no test run');
  assert.equal(readReceipt(f.paths, sha, DEPLOY_GATE)!.counts, undefined, 'no counts to hold on');
  assert.equal(ledgerTask(f.paths).deploys![0]!.tests, null);
});

test('a failed deploy fails with its problems, asks the org nothing, and records no deploy', () => {
  const f = fixture();
  const calls: string[] = [];
  const failed = sf({ id: '0Af2', success: false, details: { componentFailures: { fileName: CLASS, lineNumber: 3, problem: 'Missing ;' } } }, 1);
  const r = deployRun(f, fakeSf(calls, { 'nice -n 15 sf project deploy start': failed }));
  assert.equal(r.status, 'fail');
  assert.match(r.summary, /^The deploy to Acme Dev failed \(job 0Af2\), 1 problem: force-app\/main\/default\/classes\/Account\.cls:3: Missing ;$/);
  assert.ok(!calls.some((l) => l.includes('list metadata') || l.includes('apex run test')));
  assert.equal(ledgerTask(f.paths).deploys, undefined);
  // sf that gives no result at all is an error, not a failure.
  assert.equal(deployRun(f, fakeSf([], { 'nice -n 15 sf project deploy start': { code: 1, stdout: '', stderr: 'Killed' } })).status, 'error');
});

test('a component the org doesn\'t list after the deploy fails the gate, and one acc can\'t ask for is said, not failed', () => {
  const f = fixture();
  const r = deployRun(f, fakeSf([], { 'nice -n 15 sf org list metadata --metadata-type CustomField': sf([]) }));
  assert.equal(r.status, 'fail');
  assert.match(r.summary, /but the org doesn't list Custom Field: Account\.Foo__c/);
  assert.deepEqual(readReceipt(f.paths, f.sha, DEPLOY_GATE)!.details!.missing, ['Custom Field: Account.Foo__c']);
  assert.equal(ledgerTask(f.paths).deploys!.length, 1, 'the deploy happened, so it is recorded');
  // The listing itself failing: the component goes unchecked, and the deploy still passes.
  const unchecked = deployRun(f, fakeSf([], { 'nice -n 15 sf org list metadata --metadata-type CustomField': { code: 1, stdout: '', stderr: 'no such type' } }));
  assert.equal(unchecked.status, 'pass', unchecked.summary);
  assert.match(unchecked.summary, /1 listed in the org, 1 component acc couldn't ask the org for/);
  assert.equal(ledgerTask(f.paths).deploys!.at(-1)!.verified, 1);
});

test('tests that fail in the org fail the gate and name them; a run of no tests is a hold; a run with no result is an error', () => {
  const f = fixture();
  const failing = sf({ summary: { outcome: 'Failed', testsRan: 3, passing: 2, failing: 1, skipped: 0, testRunCoverage: '80%' }, tests: [{ ApexClass: { Name: 'AccountTest' }, MethodName: 'works', Outcome: 'Fail', Message: 'boom' }] });
  const r = deployRun(f, fakeSf([], { 'nice -n 15 sf apex run test': failing }));
  assert.equal(r.status, 'fail');
  assert.match(r.summary, /Deployed 2 components to Acme Dev \(job 0Af1\), but 1 test failed in the org: AccountTest\.works: boom$/);
  assert.deepEqual(r.counts, { run: 3, passed: 2, failed: 1, skipped: 0, todo: 0, runner: 'apex' });
  assert.deepEqual(ledgerTask(f.paths).deploys![0]!.tests, { names: ['AccountTest'], outcome: 'fail', ran: 3, failed: 1, coverage: '80%' });
  const none = deployRun(f, fakeSf([], { 'nice -n 15 sf apex run test': sf({ summary: { outcome: 'Passed', testsRan: 0, passing: 0, failing: 0 } }) }));
  assert.equal(none.status, 'hold', 'ran no tests, so it can\'t vouch for the change (GH-100)');
  const gone = deployRun(f, fakeSf([], { 'nice -n 15 sf apex run test': { code: 1, stdout: '', stderr: 'timed out' } }));
  assert.equal(gone.status, 'error');
  assert.match(gone.summary, /Deployed to Acme Dev \(job 0Af1\), but the test run gave no result: timed out/);
  assert.equal(ledgerTask(f.paths).deploys!.length, 3, 'each deploy that reached the org is recorded');
});

// ---------------------------------------------------------------- never where it mustn't

test('the gate refuses, without calling sf: no org, a protected environment, production, an environment-specific file, a deletion, Apex with no tests', () => {
  const f = fixture();
  const calls: string[] = [];
  const runner = fakeSf(calls);
  const against = (branch: string, tests = TESTS) => runGates(f.paths, f.c, env(f.c, branch), [DEPLOY_GATE], tests, { run: runner, now, slots: slots(), task: 'T-1', deploys: true }).results[0]!;
  const qa = against('qa');
  assert.equal(qa.status, 'error');
  assert.match(qa.summary, /QA has no org alias in qa's committed settings \(refs\/heads\/qa\)/);
  const uat = against('uat');
  assert.equal(uat.status, 'error');
  assert.match(uat.summary, /UAT is protected in uat's committed settings .*A builder deploys only to its own unprotected build org \(D-018\)/);
  assert.match(against('production').summary, /Production is production in production's committed settings/);
  write(f.dir, 'force-app/main/default/emailservices/EmailToCase.xml-meta.xml', '<z/>\n');
  commitAll(f.dir, 'org-owned');
  const specific = against('dev');
  assert.equal(specific.status, 'fail');
  assert.match(specific.summary, /environment-specific files.*\(D-016\): force-app\/main\/default\/emailservices\/EmailToCase\.xml-meta\.xml/);
  gitIn(f.dir, 'checkout', '-q', 'dev', '--', 'force-app/main/default/emailservices/EmailToCase.xml-meta.xml');
  gitIn(f.dir, 'rm', '-q', 'force-app/main/default/classes/Old.cls');
  commitAll(f.dir, 'delete');
  const deleted = against('dev');
  assert.equal(deleted.status, 'fail');
  assert.match(deleted.summary, /Deletions \(and renames\) stay a person's: force-app\/main\/default\/classes\/Old\.cls\. acc never deploys a deletion/);
  gitIn(f.dir, 'checkout', '-q', 'dev', '--', 'force-app/main/default/classes/Old.cls');
  commitAll(f.dir, 'restore');
  const untested = against('dev', []);
  assert.equal(untested.status, 'fail');
  assert.match(untested.summary, /Apex changed \(force-app\/main\/default\/classes\/Account\.cls\)\. Name the test classes .* acc gate run deploy --test/);
  assert.deepEqual(sfCalls(calls), [], 'none of these reached sf');
});

test('the gate reads where it goes from the project\'s settings, never its worktree\'s: a builder that points its copy at another org, or unmarks protected, can\'t deploy there', () => {
  const f = fixture();
  // The worktree's copy says Dev is another org and UAT isn't protected; dev's committed copy says otherwise.
  const edited = { ...RAW, environments: RAW.environments.map((e) => (e.name === 'Dev' ? { ...e, org: 'Evil Org' } : e.name === 'UAT' ? { ...e, protected: false } : e)) };
  write(f.dir, '.acc/config.json', JSON.stringify(edited));
  commitAll(f.dir, 'point elsewhere');
  f.passed('validate');
  const c = config(edited);
  const calls: string[] = [];
  const r = runGates(f.paths, c, env(c), [DEPLOY_GATE], TESTS, { run: fakeSf(calls), now, slots: slots(), task: 'T-1', deploys: true }).results[0]!;
  assert.equal(r.status, 'pass', r.summary);
  assert.ok(calls.find((l) => l.includes('deploy start'))!.includes('--target-org Acme Dev'), 'the committed org');
  assert.ok(!calls.some((l) => l.includes('Evil Org')), 'never the worktree\'s');
  const uat = runGates(f.paths, c, env(c, 'uat'), [DEPLOY_GATE], TESTS, { run: fakeSf(calls), now, slots: slots(), task: 'T-1', deploys: true }).results[0]!;
  assert.equal(uat.status, 'error');
  assert.match(uat.summary, /UAT is protected in uat's committed settings/);
  // The branch's own environment-specific list can't drop a file either: the trusted list still holds it.
  const trusted = trustedSettings({ paths: f.paths, runner: run }, { branch: 'dev' });
  assert.ok(!('problem' in trusted));
  assert.equal(trusted.read('manifest/environment-specific.txt'), 'force-app/main/default/emailservices/EmailToCase.xml-meta.xml\n');
  assert.equal(trusted.read('manifest/nothing.txt'), null);
  write(f.dir, 'manifest/environment-specific.txt', '');
  write(f.dir, 'force-app/main/default/emailservices/EmailToCase.xml-meta.xml', '<z/>\n');
  commitAll(f.dir, 'drop the list, change the file');
  f.passed('validate');
  const dropped = runGates(f.paths, c, env(c), [DEPLOY_GATE], TESTS, { run: fakeSf(calls), now, slots: slots(), task: 'T-1', deploys: true }).results[0]!;
  assert.equal(dropped.status, 'fail');
  assert.match(dropped.summary, /environment-specific files.*EmailToCase\.xml-meta\.xml/);
  // No settings anywhere trusted: an environment this clone has no branch for, and origin hasn't either.
  const nowhere = trustedSettings({ paths: f.paths, runner: run }, { branch: 'nowhere' });
  assert.match((nowhere as { problem: string }).problem, /Couldn't read the project's settings from refs\/remotes\/origin\/nowhere or refs\/heads\/nowhere\. A deploy reads where it goes from the main checkout, or from the environment's branch, never from this checkout's own \.acc\/config\.json/);
  // Settings on the branch that don't parse are a problem too, not a fallback to the worktree's.
  gitIn(f.dir, 'checkout', '-q', 'qa');
  write(f.dir, '.acc/config.json', '{ not json');
  commitAll(f.dir, 'broken');
  gitIn(f.dir, 'checkout', '-q', 'task/T-1-thing');
  assert.match((trustedSettings({ paths: f.paths, runner: run }, { branch: 'qa' }) as { problem: string }).problem, /refs\/heads\/qa's \.acc\/config\.json isn't valid JSON/);
});

test('in a worktree the gate reads the main checkout\'s settings, and errors when they can\'t be read; an environment missing there is nowhere to deploy', () => {
  const main = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(RAW), ...SOURCE, '.gitignore': '.claude/\n.sf/\n' }));
  gitIn(main, 'branch', '-m', 'dev');
  const wt = join(main, '.claude', 'worktrees', 'T-1');
  gitIn(main, 'worktree', 'add', '-q', '-b', 'task/T-1-thing', wt, 'dev');
  const edited = { ...RAW, environments: RAW.environments.map((e) => (e.name === 'Dev' ? { ...e, org: 'Evil Org' } : e)) };
  write(wt, '.acc/config.json', JSON.stringify(edited));
  write(wt, CLASS, 'public class Account { void go() {} }\n');
  commitAll(wt, 'change, and point elsewhere');
  const paths = repoPaths(wt, run);
  const c = config(edited);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, c, [{ source: { kind: 'manual', key: 'T-1' }, title: 'Thing' }], 'human', 'human:test', emit, now);
    l.tasks[0]!.state = 'running';
    l.tasks[0]!.run = { branch: 'task/T-1-thing', worktree: wt };
  });
  const sha = gitIn(wt, 'rev-parse', 'HEAD');
  const at = now().toISOString();
  writeReceipt(paths, { gate: 'validate', sha, env: 'dev', status: 'pass', startedAt: at, finishedAt: at, durationMs: 1, summary: 'Passed.', command: null, log: null });
  const trusted = trustedSettings({ paths, runner: run }, { branch: 'dev' });
  assert.ok(!('problem' in trusted) && trusted.from.startsWith('the main checkout\'s settings'), JSON.stringify(trusted));
  const calls: string[] = [];
  const r = runGates(paths, c, env(c), [DEPLOY_GATE], TESTS, { run: fakeSf(calls, { 'nice -n 15 sf project deploy start': sf({ id: '0Af1', success: true, numberComponentsTotal: 1 }) }), now, slots: slots(), task: 'T-1', deploys: true }).results[0]!;
  assert.equal(r.status, 'pass', r.summary);
  assert.ok(calls.find((l) => l.includes('deploy start'))!.includes('--target-org Acme Dev'), 'the main checkout\'s org, not the worktree\'s');
  // An environment the main checkout doesn't know is nowhere to deploy.
  const stray = parseConfig({ ...edited, environments: [...edited.environments, { name: 'Stray', type: 'developer', org: 'Stray Org' }] }).config!;
  gitIn(main, 'branch', 'stray', 'dev');
  const nowhere = runGates(paths, stray, env(stray, 'stray'), [DEPLOY_GATE], TESTS, { run: fakeSf(calls), now, slots: slots(), task: 'T-1', deploys: true }).results[0]!;
  assert.equal(nowhere.status, 'error');
  assert.match(nowhere.summary, /Stray isn't an environment in the main checkout's settings/);
  // The main checkout's settings gone: nothing is deployed.
  rmSync(join(main, '.acc', 'config.json'));
  const unread = runGates(paths, c, env(c), [DEPLOY_GATE], TESTS, { run: fakeSf(calls), now, slots: slots(), task: 'T-1', deploys: true }).results[0]!;
  assert.equal(unread.status, 'error');
  assert.match(unread.summary, /Couldn't read the project's settings from the main checkout.*Nothing was deployed/);
  assert.equal(calls.filter((l) => l.includes('deploy start')).length, 1, 'only the first deployed');
});

test('production is refused by what Salesforce says the org is, whatever the settings say, and an org sf can\'t show is an error; an unknown kind of URL still deploys', () => {
  const f = fixture();
  const calls: string[] = [];
  const prod = deployRun(f, fakeSf(calls, { 'nice -n 15 sf org display': sf({ username: 'admin@acme.com', id: '00D1', instanceUrl: 'https://acme.my.salesforce.com' }) }));
  assert.equal(prod.status, 'error');
  assert.match(prod.summary, /^Acme Dev is a production org \(admin@acme\.com at https:\/\/acme\.my\.salesforce\.com\), whatever the settings say\. A builder never deploys to production \(D-018\): nothing was deployed\.$/);
  assert.deepEqual(sfCalls(calls), ['nice -n 15 sf org display --target-org Acme Dev --json'], 'nothing after the question');
  assert.equal(ledgerTask(f.paths).deploys, undefined);
  const gone = deployRun(f, fakeSf([], { 'nice -n 15 sf org display': { code: 1, stdout: '', stderr: 'No authorization information found for Acme Dev' } }));
  assert.equal(gone.status, 'error');
  assert.match(gone.summary, /Couldn't ask Salesforce which org Acme Dev is \(sf org display\): is it logged in on this machine\? Nothing was deployed\./);
  const scratch = deployRun(f, fakeSf([], { 'nice -n 15 sf org display': sf({ username: 'test@example.com', instanceUrl: 'https://ability-x.scratch.my.salesforce.com' }) }));
  assert.equal(scratch.status, 'pass', scratch.summary);
  assert.deepEqual([readReceipt(f.paths, f.sha, DEPLOY_GATE)!.details!.orgKind, readReceipt(f.paths, f.sha, DEPLOY_GATE)!.details!.orgId], ['unknown', null]);
  // The reader itself.
  assert.deepEqual(orgDisplayArgs('Acme Dev'), ['org', 'display', '--target-org', 'Acme Dev', '--json']);
  assert.deepEqual(readOrgDisplay(sf(SANDBOX)), { ...SANDBOX, kind: 'sandbox' });
  assert.equal(readOrgDisplay(sf({ username: 'u' })), null, 'no URL is no org');
  assert.equal(readOrgDisplay(sf(SANDBOX, 1)), null, 'a failed display is no org');
  assert.equal(readOrgDisplay({ code: 0, stdout: 'not json', stderr: '' }), null);
});

test('a run that isn\'t the builder\'s own records a skip that says where deploy runs, which a refresh takes but acc done never does; it fails with uncommitted changes, and until validate passed', () => {
  const f = fixture();
  for (const g of ['format', 'stray-files']) f.passed(g);
  const calls: string[] = [];
  const runner = fakeSf(calls);
  // As a refresh, the merge queue or a verify runs it: no deploy, a skip that names the builder's own run.
  const elsewhere = deployRun(f, runner, { deploys: false });
  assert.equal(elsewhere.status, 'skip');
  assert.equal(elsewhere.elsewhere, DEPLOY_ELSEWHERE);
  assert.match(elsewhere.summary, /Not run here: a builder deploys from the task's own worktree, on its branch, with acc gate run deploy\. .*acc done still waits for that deploy/);
  const skipped = readReceipt(f.paths, f.sha, DEPLOY_GATE)!;
  assert.equal(skipped.elsewhere, DEPLOY_ELSEWHERE);
  assert.ok(satisfies(skipped), 'the refresh or the queue is satisfied');
  assert.ok(!countsForDone(skipped), 'acc done isn\'t');
  const hooks = receiptHooks(f.paths, f.c, run);
  const ledger = readLedger(f.paths.ledger);
  const t = ledger.tasks.find((x) => x.id === 'T-1')!;
  assert.deepEqual(hooks.missingGates(t), [DEPLOY_GATE], 'a task that never deployed');
  const note = { landed: ['Deployed'], moved: [], open: [] };
  assert.match(checkMove(ledger, f.c, t, { to: 'review', actor: 'builder', by: 'b', note }, hooks).join(), /haven't passed on the current commit: deploy/);
  // A person's waiver of it counts, as any waiver does (D-031).
  assert.ok(countsForDone({ ...skipped, waived: { by: 'human:jordan', reason: 'the org is being refreshed', at: now().toISOString(), was: 'skip', wasSummary: null } }));
  assert.ok(countsForDone({ status: 'pass', details: {} }) && !countsForDone({ status: 'fail', details: {} }) && !countsForDone(null));
  assert.deepEqual(sfCalls(calls), [], 'nothing asked, nothing deployed');
  // Uncommitted changes, and a commit validate hasn't passed on.
  writeFileSync(join(f.dir, 'scratch.txt'), 'wip');
  const dirty = deployRun(f, runner);
  assert.equal(dirty.status, 'fail');
  assert.match(dirty.summary, /uncommitted changes.*commit, then run acc gate run deploy again/);
  rmSync(join(f.dir, 'scratch.txt'));
  write(f.dir, CLASS, 'public class Account { void go() { } }\n');
  commitAll(f.dir, 'again');
  const unvalidated = deployRun(f, runner);
  assert.equal(unvalidated.status, 'fail');
  assert.match(unvalidated.summary, /validate hasn't passed on this commit\. Run acc gate run validate first/);
  assert.deepEqual(sfCalls(calls), [], 'nothing deployed');
  f.passed('validate');
  assert.equal(deployRun(f, runner).status, 'pass');
});

test('no gate but the deploy gate may run a real deploy, never a quick deploy or a resume, and a command gate can\'t deploy nor take the deploy gate\'s name', () => {
  assertCheckOnly('sf', ['project', 'deploy', 'start', '--target-org', 'x'], DEPLOY_GATE);
  assert.throws(() => assertCheckOnly('sf', ['project', 'deploy', 'start', '--target-org', 'x'], 'validate'), /real deploy/);
  assert.throws(() => assertCheckOnly('sf', ['project', 'deploy', 'start', '--target-org', 'x']), /real deploy/);
  assert.throws(() => assertCheckOnly('sf', ['project', 'deploy', 'quick', '--job-id', '1'], DEPLOY_GATE), /real deploy/);
  assert.throws(() => assertCheckOnly('sf', ['project', 'deploy', 'resume', '--job-id', '1'], DEPLOY_GATE), /real deploy/);
  assertCheckOnly('sf', ['project', 'deploy', 'start', '--dry-run'], 'validate');
  // A command gate runs through the shell, where the runner can't see: the config refuses one that deploys, in any form, and one named deploy (D-T-115).
  const refused = (gates: Record<string, string>, profile = 'salesforce') => parseConfig({ ...(profile === 'salesforce' ? SF_CONFIG : GENERIC_CONFIG), gates: { commands: gates } }).errors.join('\n');
  assert.match(refused({ sneaky: 'sf project deploy start --target-org x' }), /"gates\.commands\.sneaky": its command runs a real deploy \(sf project deploy start\)\. A check never deploys; only the salesforce profile's deploy gate does/);
  assert.match(refused({ sneaky: 'npm test && sfdx force:mdapi:deploy -d out -u x' }), /runs a real deploy \(sfdx force:mdapi:deploy\)/);
  assert.match(refused({ sneaky: 'sf project:deploy:quick --job-id 1' }), /runs a real deploy \(sf project deploy quick\)/);
  assert.match(refused({ sneaky: 'sf deploy metadata -d force-app' }, 'generic'), /runs a real deploy \(sf deploy metadata\)/, 'in any profile');
  assert.match(refused({ deploy: 'true' }), /"gates\.commands\.deploy": deploy is built into the salesforce profile and can't be replaced by a command/);
  assert.equal(refused({ check: 'sf project deploy start --dry-run --target-org x', validate2: 'sfdx force:source:deploy --checkonly -p force-app' }), '', 'a check-only deploy is a check');
  assert.equal(refused({ deploy: 'npm run deploy' }, 'generic'), '', 'a generic project may call a gate deploy');
  assert.equal(commandGateProblem('x', 'echo deploy', 'salesforce'), null);
  // A config built another way gets no further: the gate list refuses it, so nothing runs it.
  const f = fixture();
  const c = config();
  c.gates.commands = { sneaky: 'echo x; sf project deploy start --target-org x' };
  assert.throws(() => gatesFor(c), /runs a real deploy \(sf project deploy start\)/);
  assert.throws(() => runGates(f.paths, c, env(c), ['sneaky'], [], { run: fakeSf([]), now, slots: slots(), deploys: true }), /runs a real deploy/);
});

// ---------------------------------------------------------------- taking turns on one org

test('two deploys to one org take turns on a lock keyed by the org\'s username in acc\'s own folder, which no caller moves: a deploy waits for it, gives up after its timeout, and says what it is while it holds it', () => {
  const f = fixture();
  // acc's own folder, under HOME, whatever ACC_HEAVY_DIR or the run's slot folder says: a builder's environment can't move the lock.
  const home = tempDir('home-');
  const was = { HOME: process.env.HOME, ACC_HEAVY_DIR: process.env.ACC_HEAVY_DIR };
  process.env.HOME = home;
  process.env.ACC_HEAVY_DIR = tempDir('elsewhere-');
  try {
    const lock = orgLockDir('dev@acme.com.dev');
    assert.equal(lock, join(home, '.acc', 'heavy', 'orgs', 'dev_acme.com.dev'), 'beside the heavy-check slots, named for the org\'s username, never its alias');
    assert.equal(orgLockDir('u@x.com'), join(homedir(), '.acc', 'heavy', 'orgs', 'u_x.com'));
    assert.equal(orgLockDir.length, 1, 'the key alone: no base to pass');
    const dir = tempDir('slots-');
    mkdirSync(join(lock, 'slot-0'), { recursive: true });
    writeFileSync(join(lock, 'slot-0', 'owner'), JSON.stringify({ what: 'Deploy to Acme Dev', task: 'T-9', pid: process.pid, at: Date.now() }));
    const calls: string[] = [];
    let waited = 0;
    assert.throws(() => runGates(f.paths, f.c, env(f.c), [DEPLOY_GATE], TESTS, { run: fakeSf(calls), now, slots: { dir, timeoutMs: 150, pollMs: 20 }, task: 'T-1', deploys: true, onWait: () => waited++ }), /stayed taken/);
    assert.equal(waited, 1, 'the builder is told it waits');
    assert.ok(!calls.some((l) => l.includes('deploy start')), 'nothing deployed over the other deploy');
    assert.ok(!existsSync(join(dir, 'orgs')), 'the run\'s slot folder holds no org lock');
    rmSync(join(lock, 'slot-0'), { recursive: true, force: true });
    let owner: Record<string, unknown> | null = null;
    const r = runGates(f.paths, f.c, env(f.c), [DEPLOY_GATE], TESTS, {
      run: fakeSf(calls, { 'nice -n 15 sf project deploy start': () => { owner = JSON.parse(readFileSync(join(lock, 'slot-0', 'owner'), 'utf8')); return sf({ id: '0Af1', success: true }); } }),
      now, slots: { dir, timeoutMs: 1000, pollMs: 20 }, task: 'T-1', deploys: true,
    }).results[0]!;
    assert.equal(r.status, 'pass', r.summary);
    assert.deepEqual([owner!.what, owner!.task, owner!.env], ['Deploy to Acme Dev', 'T-1', 'dev']);
    assert.ok(!existsSync(join(lock, 'slot-0')), 'released afterwards');
  } finally {
    for (const [k, v] of Object.entries(was)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('a deploy stops while another task in flight changes a file it changed, naming the task and file, and goes once that task is done; a task sharing none never waits', () => {
  const f = fixture();
  // T-2 changed Account on its own branch.
  gitIn(f.dir, 'checkout', '-q', 'task/T-2-other');
  write(f.dir, CLASS, 'public class Account { void other() {} }\n');
  commitAll(f.dir, 'T-2');
  gitIn(f.dir, 'checkout', '-q', 'task/T-1-thing');
  const calls: string[] = [];
  const r = deployRun(f, fakeSf(calls));
  assert.equal(r.status, 'fail');
  assert.match(r.summary, /^Waits for T-2's files: force-app\/main\/default\/classes\/Account\.cls\. Deploying now would put this branch's copy over T-2's work in Acme Dev\. Wait until T-2 merges or is set aside, then run acc gate run deploy again\. .*acc block "Waiting to deploy: Shares files with T-2: force-app\/main\/default\/classes\/Account\.cls"$/);
  assert.deepEqual(readReceipt(f.paths, f.sha, DEPLOY_GATE)!.details!.waitsFor, [{ task: 'T-2', files: [CLASS] }]);
  assert.ok(!calls.some((l) => l.includes('deploy start')), 'nothing deployed over T-2');
  assert.equal(ledgerTask(f.paths).deploys, undefined);
  // T-2 merged: it holds nothing, and T-1 deploys.
  mutate(f.paths, now, (l, emit) => {
    l.tasks.find((t) => t.id === 'T-2')!.state = 'done';
    emit({ type: 'task.moved', task: 'T-2', actor: 'human', by: 'human:test', data: { to: 'done' } });
  });
  const merged = deployRun(f, fakeSf(calls));
  assert.equal(merged.status, 'pass', merged.summary);
  // T-3 in flight sharing no file with T-1 doesn't hold it.
  gitIn(f.dir, 'checkout', '-q', '-b', 'task/T-3-apart', 'dev');
  write(f.dir, 'force-app/main/default/classes/Apart.cls', 'public class Apart {}\n');
  commitAll(f.dir, 'T-3');
  gitIn(f.dir, 'checkout', '-q', 'task/T-1-thing');
  mutate(f.paths, now, (l, emit) => {
    upsertTasks(l, f.c, [{ source: { kind: 'manual', key: 'T-3' }, title: 'Apart' }], 'human', 'human:test', emit, now);
    const t = l.tasks.find((x) => x.id === 'T-3')!;
    t.state = 'running';
    t.run = { branch: 'task/T-3-apart' };
  });
  const apart = deployRun(f, fakeSf(calls));
  assert.equal(apart.status, 'pass', apart.summary);
  assert.equal(ledgerTask(f.paths).deploys!.length, 2);
});

test('the overlap check fails closed: a task in flight whose branch isn\'t here is read from origin after a fetch, and one that can\'t be read stops the deploy, naming it', () => {
  const f = fixture();
  // T-4 in flight, its branch nowhere: this clone hasn't it, and there's no origin to fetch it from.
  mutate(f.paths, now, (l, emit) => {
    upsertTasks(l, f.c, [{ source: { kind: 'manual', key: 'T-4' }, title: 'Gone' }], 'human', 'human:test', emit, now);
    const t = l.tasks.find((x) => x.id === 'T-4')!;
    t.state = 'running';
    t.run = { branch: 'task/T-4-gone' };
  });
  const calls: string[] = [];
  const r = deployRun(f, fakeSf(calls));
  assert.equal(r.status, 'error');
  assert.match(r.summary, /^Couldn't read what T-4 changed, so this deploy can't tell whether it would go over their work: T-4, its branch task\/T-4-gone isn't in this clone or on origin\. Nothing was deployed\. .*acc block "Waiting to deploy: can't read T-4's changes"$/);
  assert.ok(!calls.some((l) => l.includes('deploy start')), 'nothing deployed over work it couldn\'t see');
  assert.deepEqual(inFlightFilesStrict(f.paths, readLedger(f.paths.ledger), run, { except: 'T-1' }), { shares: [{ task: 'T-2', files: [] }], unreadable: [{ task: 'T-4', why: 'its branch task/T-4-gone isn\'t in this clone or on origin' }] });
  assert.equal(branchRef(run, f.dir, 'task/T-4-gone', { fetch: true }), null);
  // T-4's branch on origin only, changing Account: fetched, read, and it holds T-1.
  const origin = tempDir('origin-');
  run('git', ['init', '-q', '--bare', origin]);
  gitIn(f.dir, 'remote', 'add', 'origin', origin);
  gitIn(f.dir, 'checkout', '-q', '-b', 'task/T-4-gone', 'dev');
  write(f.dir, CLASS, 'public class Account { void gone() {} }\n');
  commitAll(f.dir, 'T-4');
  gitIn(f.dir, 'push', '-q', 'origin', 'dev', 'task/T-4-gone');
  gitIn(f.dir, 'checkout', '-q', 'task/T-1-thing');
  gitIn(f.dir, 'branch', '-D', 'task/T-4-gone');
  run('git', ['update-ref', '-d', 'refs/remotes/origin/task/T-4-gone'], { cwd: f.dir });
  assert.equal(branchRef(run, f.dir, 'task/T-4-gone'), null, 'not here, and not fetched yet');
  assert.equal(branchRef(run, f.dir, 'task/T-4-gone', { fetch: true }), 'refs/remotes/origin/task/T-4-gone');
  assert.deepEqual(branchFilesAt(run, f.dir, 'dev', 'refs/remotes/origin/task/T-4-gone'), [CLASS], 'read at origin\'s copy');
  assert.throws(() => branchFilesAt(run, f.dir, 'dev', 'refs/heads/task/T-4-gone'), /no dev or origin\/dev branch here to compare with/, 'a ref that isn\'t here has no base, and throws, so the strict reading can say so');
  const held = deployRun(f, fakeSf(calls));
  assert.equal(held.status, 'fail');
  assert.match(held.summary, /^Waits for T-4's files: force-app\/main\/default\/classes\/Account\.cls\./);
  assert.ok(!calls.some((l) => l.includes('deploy start')));
});

// ---------------------------------------------------------------- acc done, the packet's guards, the config

test('acc done refuses a Salesforce task until deploy passed on its last commit, and accepts it after', () => {
  const f = fixture();
  for (const g of ['format', 'stray-files']) f.passed(g);
  const hooks = receiptHooks(f.paths, f.c, run);
  const ledger = readLedger(f.paths.ledger);
  const t = ledger.tasks.find((x) => x.id === 'T-1')!;
  assert.deepEqual(hooks.missingGates(t), [DEPLOY_GATE]);
  const note = { landed: ['Deployed'], moved: [], open: [] };
  assert.match(checkMove(ledger, f.c, t, { to: 'review', actor: 'builder', by: 'b', note }, hooks).join(), /haven't passed on the current commit: deploy\. Commit everything, then run: acc gate run/);
  assert.equal(deployRun(f, fakeSf([])).status, 'pass');
  assert.deepEqual(hooks.missingGates(t), []);
  assert.deepEqual(checkMove(ledger, f.c, t, { to: 'review', actor: 'builder', by: 'b', note }, hooks), []);
  // A new commit needs a new deploy.
  write(f.dir, CLASS, 'public class Account { void go() { } }\n');
  commitAll(f.dir, 'again');
  assert.ok(hooks.missingGates(t).includes(DEPLOY_GATE));
});

test('a builder\'s hand deploy is refused in every form, sf\'s and sfdx\'s, acc gate run deploy is allowed, and acc deploy stays a person\'s; the settings deny the same', () => {
  const b = { task: { id: 'T-1', run: { branch: 'task/T-1-a' } } } as never;
  for (const [line, form] of [
    ['sf project deploy start --source-dir force-app', 'sf project deploy start'],
    ['sf project deploy quick --job-id 0Af', 'sf project deploy quick'],
    ['sf project deploy resume --job-id 0Af', 'sf project deploy resume'],
    ['sf project:deploy:start --source-dir force-app', 'sf project deploy start'],
    ['sf project:deploy:resume --job-id 0Af', 'sf project deploy resume'],
    ['sf deploy metadata --source-dir force-app', 'sf deploy metadata'],
    ['sf deploy:metadata:quick --job-id 0Af', 'sf deploy metadata quick'],
    ['sfdx force:source:deploy -p force-app -u dev', 'sfdx force:source:deploy'],
    ['sfdx force:mdapi:deploy -d out -u dev', 'sfdx force:mdapi:deploy'],
    ['sfdx force:source:push -u scratch', 'sfdx force:source:push'],
    ['sfdx project deploy start --source-dir force-app', 'sfdx project deploy start'],
    ['/usr/local/bin/sf project deploy start --source-dir force-app', 'sf project deploy start'],
    ['npm test && sf project deploy start --source-dir force-app', 'sf project deploy start'],
    // -c on an sf deploy is --ignore-conflicts, a real deploy; only sfdx's older commands take it as --checkonly.
    ['sf project deploy start -c -d force-app -o "Acme UAT"', 'sf project deploy start'],
    ['sf project deploy start --checkonly -d force-app', 'sf project deploy start'],
    ['sf deploy metadata -c -d force-app', 'sf deploy metadata'],
    ['sfdx project deploy start -c -d force-app', 'sfdx project deploy start'],
    ['sfdx force:source:deploy --dry-run -p force-app', 'sfdx force:source:deploy'],
  ] as const) {
    assert.match(guardBash(b, line)!, new RegExp(`never deploy by hand .*${form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is refused\\. acc gate run validate .*acc gate run deploy`), line);
    assert.equal(handDeployIn(line), form, line);
  }
  // Check-only forms are validate's own, and sf's other commands aren't deploys.
  for (const line of ['sf project deploy start --dry-run --source-dir force-app', 'sf project:deploy:start --dry-run', 'sf project deploy start --dry-run -c -d force-app', 'sfdx project deploy start --dry-run -d force-app', 'sfdx force:source:deploy --checkonly -p force-app', 'sfdx force:mdapi:deploy -c -d out', 'sf project deploy validate --source-dir force-app', 'sf project retrieve start', 'sf org display', 'sfdx force:source:retrieve']) {
    assert.equal(guardBash(b, line), null, line);
    assert.equal(handDeployIn(line), null, line);
  }
  assert.equal(deploysByHand(['sf', 'deploy', 'metadata', 'resume', '--dry-run']), 'sf deploy metadata resume', 'a resume saves whatever the dry run says');
  assert.equal(deploysByHand([]), null, 'no command is no deploy');
  assert.equal(guardBash(b, 'acc gate run deploy'), null);
  assert.equal(guardBash(b, 'acc gate run deploy --test AccountTest="covers it"'), null);
  assert.match(guardBash(b, 'acc deploy dev')!, /acc deploy is a person's/);
  const s = builderSettings({ id: 'T-1', environment: 'dev' } as never, config(), '/bin', '/usr/bin') as { permissions: { allow: string[]; deny: string[] } };
  assert.ok(s.permissions.allow.includes('Bash(acc gate run *)'));
  for (const d of [...HAND_DEPLOY_DENIES, 'Bash(acc deploy*)']) assert.ok(s.permissions.deny.includes(d), d);
  assert.ok(HAND_DEPLOY_DENIES.includes('Bash(sf project deploy resume*)') && HAND_DEPLOY_DENIES.includes('Bash(sf project:deploy:*)') && HAND_DEPLOY_DENIES.includes('Bash(sfdx force:source:deploy*)'));
  const generic = builderSettings({ id: 'T-1', environment: 'main' } as never, config(GENERIC_CONFIG), '/bin', '/usr/bin') as { permissions: { deny: string[] } };
  assert.ok(!generic.permissions.deny.some((d) => d.includes('sf ')), 'a generic project has no sf to deny');
});

test('a builder\'s edit under .acc/ in its worktree is refused: the settings are a person\'s, and acc writes the floors itself; so is .git, the worktree\'s link to its git directory', () => {
  const f = fixture();
  const wt = realpathSync(f.dir);
  const b = { task: { id: 'T-1' }, worktree: wt, root: wt } as never;
  // The worktree's .git file, or git's directory where it's one: repointed, the builder's commits would go elsewhere.
  for (const p of ['.git', join(wt, '.git'), '.git/HEAD', '.git/hooks/pre-commit', '.git/config']) assert.match(guardEdit(b, p, [])!, /^\.git(\/[\w./-]+)? is git's own, which git and acc keep; a builder never edits it/, p);
  for (const p of ['.gitignore', '.github/workflows/ci.yml', 'src/.gitkeep']) assert.equal(guardEdit(b, p, []), null, p);
  assert.match(guardEdit(b, join(wt, '.acc', 'config.json'), [])!, /^\.acc\/config\.json is the project's settings, which a person changes; acc writes the files under \.acc\/ itself, such as the floors a check raises\. Leave it/);
  assert.match(guardEdit(b, '.acc/floors.json', [])!, /the project's settings/);
  assert.match(guardEdit(b, '.acc', [])!, /the project's settings/);
  assert.equal(guardEdit(b, join(wt, 'force-app', 'x.cls'), []), null);
  assert.equal(guardEdit(b, 'acc-notes.md', []), null, 'only the folder itself');
  assert.match(guardEdit(b, '../elsewhere/.acc/config.json', [])!, /outside it/, 'outside the worktree is refused as before');
});

test('deploy is a built-in, heavy gate of the salesforce profile, required beside validate wherever validate is; a generic project, or one with no validate, gains none', () => {
  const c = config();
  assert.deepEqual(c.gates.required, ['format', 'validate', 'deploy']);
  assert.ok(c.gates.heavy.includes(DEPLOY_GATE));
  const g = gatesFor(c).find((x) => x.name === DEPLOY_GATE)!;
  assert.deepEqual([g.heavy, g.changeBound, g.about], [true, true, deployGate.about]);
  assert.deepEqual(withDeploy('salesforce', ['validate', 'static']), ['validate', 'deploy', 'static'], 'right after validate');
  assert.deepEqual(withDeploy('salesforce', ['deploy', 'validate']), ['deploy', 'validate'], 'a list that names it keeps its order');
  assert.deepEqual(withDeploy('salesforce', ['format']), ['format']);
  assert.deepEqual(withDeploy('generic', ['validate']), ['validate']);
  assert.match(parseConfig({ ...SF_CONFIG, gates: { ratchets: { deploy: { command: 'x', limit: 'floor', label: 'd' } } } }).errors.join(), /deploy is already a gate, built into the salesforce profile/);
});

// ---------------------------------------------------------------- the pieces

test('the sf arguments, the components asked for, and what sf answers are read as the gate reads them', () => {
  assert.deepEqual(deployGateArgs('Acme Dev', ['a.cls'], []).slice(-2), ['--test-level', 'NoTestRun']);
  assert.ok(deployGateArgs('Acme Dev', ['a.cls'], TESTS).join(' ').endsWith('--test-level RunSpecifiedTests --tests AccountTest'));
  const { known, unknown } = deployedComponents([CLASS, `${CLASS}-meta.xml`, FIELD, 'force-app/main/default/reports/Sales/Pipeline.report-meta.xml', 'force-app/main/default/odd/thing.txt']);
  assert.deepEqual(known.map((c) => [c.type, c.name, c.paths.length]), [['ApexClass', 'Account', 2], ['CustomField', 'Account.Foo__c', 1], ['Report', 'Sales/Pipeline', 1]], 'a class and its -meta.xml are one component');
  assert.deepEqual(unknown, ['force-app/main/default/odd/thing.txt']);
  assert.deepEqual(listMetadataArgs('Acme Dev', { type: 'Report', name: 'Sales/Pipeline' }), ['org', 'list', 'metadata', '--metadata-type', 'Report', '--target-org', 'Acme Dev', '--json', '--folder', 'Sales']);
  assert.deepEqual(listMetadataArgs('Acme Dev', { type: 'Report', name: 'Sales' }).slice(3, 5), ['--metadata-type', 'ReportFolder'], 'a folder is listed as its own type');
  assert.deepEqual(listMetadataArgs('Acme Dev', { type: 'ApexClass', name: 'A' }).slice(3, 5), ['--metadata-type', 'ApexClass']);
  assert.deepEqual(readListed(sf([{ fullName: 'A' }, { type: 'x' }])), ['A']);
  assert.deepEqual(readListed(sf({ fullName: 'One' })), ['One'], 'one result comes as an object');
  assert.equal(readListed(sf([], 1)), null, 'a failed listing is no list');
  assert.equal(readListed({ code: 0, stdout: 'not json', stderr: '' }), null);
  assert.deepEqual(apexTestArgs('Acme Dev', [{ name: 'A', reason: '' }, { name: 'B', reason: '' }]).slice(5, 9), ['--class-names', 'A', '--class-names', 'B']);
  const ran = readApexRun(sf({ summary: { outcome: 'Failed', testsRan: 2, failing: 1, skipped: 0 }, tests: [{ ApexClass: { Name: 'A' }, MethodName: 'm', Outcome: 'Fail', Message: 'x' }, { ApexClass: { Name: 'A' }, MethodName: 'n', Outcome: 'Pass' }] }), ['A'])!;
  assert.deepEqual([ran.tests.outcome, ran.tests.ran, ran.tests.failed, ran.tests.coverage, ran.failures, ran.counts.passed], ['fail', 2, 1, null, ['A.m: x'], 1]);
  assert.equal(readApexRun(sf({ summary: {} }), ['A']), null, 'no run without a count');
  assert.equal(readApexRun({ code: 1, stdout: '', stderr: '' }, ['A']), null);
  assert.equal(testsWords(null), 'no tests: no Apex changed');
  assert.equal(testsWords({ names: ['A'], outcome: 'pass', ran: 1, failed: 0, coverage: null }), '1 test passed in the org');
  assert.equal(testsWords({ names: ['A'], outcome: 'fail', ran: 3, failed: 2, coverage: '50%' }), '2 tests of 3 failed in the org');
  // What the gates share: sf's JSON under result or, from an older sf, data; a failed deploy's problems; the outcome makers.
  assert.deepEqual(parseDeployJson<{ result?: { id: string } }>(ok(JSON.stringify({ status: 0, data: { id: '1' } }))).result, { id: '1' });
  assert.deepEqual(deployProblems({ details: { runTestResult: { failures: [{ name: 'A', methodName: 'm', message: 'x' }] } } }), ['A.m: x']);
  assert.deepEqual(deployProblems(undefined), []);
  assert.equal(outcome.listOf(['a', 'b', 'c', 'd', 'e']), 'a, b, c and 2 more');
  assert.deepEqual([outcome.pass('p').status, outcome.fail('f').status, outcome.error('e').status, outcome.skip('s').status], ['pass', 'fail', 'error', 'skip']);
});

test('latest deploys are one an org, newest first; recordDeploy keeps nothing without a task, or for a task that isn\'t there', () => {
  const d = (org: string, at: string): TaskDeploy => ({ env: 'dev', org, sha: 'a', at, jobId: null, paths: [], components: [], verified: 0, tests: null });
  assert.deepEqual(latestDeploys([d('Dev', '2026-10-23T10:00:00Z'), d('UAT', '2026-10-23T11:00:00Z'), d('Dev', '2026-10-23T12:00:00Z')]).map((x) => [x.org, x.at]), [['Dev', '2026-10-23T12:00:00Z'], ['UAT', '2026-10-23T11:00:00Z']]);
  assert.deepEqual(latestDeploys(undefined), []);
  const f = fixture();
  assert.equal(recordDeploy(f.paths, now, undefined, d('Dev', 'x')), null);
  assert.equal(recordDeploy(f.paths, now, 'T-9', d('Dev', 'x')), null);
  assert.equal(ledgerTask(f.paths).deploys, undefined);
  const tests: DeployTests = { names: ['A'], outcome: 'pass', ran: 1, failed: 0, coverage: '100%' };
  assert.deepEqual(recordDeploy(f.paths, now, 'T-1', { ...d('Dev', 'x'), tests })?.tests, tests);
  assert.equal(ledgerTask(f.paths).deploys!.length, 1);
});

// ---------------------------------------------------------------- after the merge

test('acc deploy after a merge leaves out what a task already deployed itself, says when nothing is left, and sends a file changed since', () => {
  const origin = tempDir('origin-');
  run('git', ['init', '-q', '--bare', origin]);
  const dir = makeRepo({ 'sfdx-project.json': SFDX_PROJECT, 'force-app/main/default/classes/A.cls': 'public class A {}\n' });
  gitIn(dir, 'branch', '-M', 'production');
  gitIn(dir, 'remote', 'add', 'origin', origin);
  gitIn(dir, 'checkout', '-q', '-b', 'dev');
  write(dir, 'force-app/main/default/classes/B.cls', 'public class B {}\n');
  write(dir, 'force-app/main/default/classes/C.cls', 'public class C {}\n');
  commitAll(dir, 'T-1 and T-2 merged');
  gitIn(dir, 'push', '-q', 'origin', 'production', 'dev');
  const head = gitIn(dir, 'rev-parse', 'HEAD');
  const base = gitIn(dir, 'rev-parse', 'production');
  const c = config();
  const paths = repoPaths(dir, run);
  const deployed = (paths: string[]): TaskDeploy => ({ env: 'dev', org: 'Acme Dev', sha: head, at: now().toISOString(), jobId: '0Af1', paths, components: paths, verified: paths.length, tests: null });
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, c, [{ source: { kind: 'manual', key: 'T-1' }, title: 'B' }, { source: { kind: 'manual', key: 'T-2' }, title: 'C' }], 'human', 'h', emit, now);
    l.tasks[0]!.deploys = [deployed(['force-app/main/default/classes/B.cls'])];
    l.tasks[1]!.deploys = [deployed(['force-app/main/default/classes/C.cls'])];
    for (const t of l.tasks) t.state = 'done';
  });
  assert.deepEqual([...deployedByTasks(paths, run, { branch: 'dev' }, head)], [['force-app/main/default/classes/B.cls', 'T-1'], ['force-app/main/default/classes/C.cls', 'T-2']]);
  assert.deepEqual([...deployedByTasks(paths, run, { branch: 'uat' }, head)], [], 'another environment\'s deploys don\'t count');
  const calls: string[] = [];
  const runner = fakeRunner({ 'nice -n 15 sf project deploy start': sf({ id: '0Af9', success: true }) }, calls);
  // Where the org got to, written whole: the deploy starts from it without --since.
  writeDeployRecord(paths, { env: 'dev', org: 'Acme Dev', sha: base, at: now().toISOString(), by: 'human:jordan', jobId: null, files: 0 });
  assert.equal(lastDeploy(paths, 'dev')!.sha, base);
  const r = deploy(paths, c, 'dev', { run: runner, now, slots: slots() }, { by: 'human:jordan' });
  assert.equal(r.deployed, false);
  assert.deepEqual(r.plan.deployedBy, [{ path: 'force-app/main/default/classes/B.cls', task: 'T-1' }, { path: 'force-app/main/default/classes/C.cls', task: 'T-2' }]);
  assert.match(r.summary, /^Nothing's left to deploy to Dev: T-1 and T-2 deployed 2 files themselves, and Dev now counts as at [0-9a-f]{7}\.$/);
  assert.equal(lastDeploy(paths, 'dev')!.sha, head, 'the record moves on, so the next deploy starts here');
  assert.ok(!calls.some((l) => l.includes('deploy start')), 'nothing sent');
  // B changed again after T-1 deployed it: it goes.
  write(dir, 'force-app/main/default/classes/B.cls', 'public class B { void go() {} }\n');
  commitAll(dir, 'hotfix');
  gitIn(dir, 'push', '-q', 'origin', 'dev');
  const again = deploy(paths, c, 'dev', { run: runner, now, slots: slots() }, { by: 'human:jordan' });
  assert.equal(again.deployed, true, again.summary);
  assert.deepEqual([again.plan.files, again.plan.deployedBy], [['force-app/main/default/classes/B.cls'], []]);
});

test('acc deploy sends a file whose latest deploy, by a task set aside, left other content in the org, though the head matches an older deploy; a path is left out only when its latest deploy matches', () => {
  const origin = tempDir('origin-');
  run('git', ['init', '-q', '--bare', origin]);
  const dir = makeRepo({ 'sfdx-project.json': SFDX_PROJECT });
  gitIn(dir, 'branch', '-M', 'dev');
  gitIn(dir, 'remote', 'add', 'origin', origin);
  const before = gitIn(dir, 'rev-parse', 'HEAD');
  const B = 'force-app/main/default/classes/B.cls';
  // T-1 merged B into dev, having deployed it at that content; T-2 then deployed B at other content from its own branch, and was set aside.
  write(dir, B, 'public class B {}\n');
  commitAll(dir, 'T-1 merged');
  const head = gitIn(dir, 'rev-parse', 'HEAD');
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-2-b');
  write(dir, B, 'public class B { void two() {} }\n');
  commitAll(dir, 'T-2');
  const two = gitIn(dir, 'rev-parse', 'HEAD');
  gitIn(dir, 'checkout', '-q', 'dev');
  gitIn(dir, 'push', '-q', 'origin', 'dev');
  const c = config();
  const paths = repoPaths(dir, run);
  const at = (hour: number) => `2026-10-23T${String(hour).padStart(2, '0')}:00:00Z`;
  const deployOf = (sha: string, when: string): TaskDeploy => ({ env: 'dev', org: 'Acme Dev', sha, at: when, jobId: '0Af1', paths: [B], components: [B], verified: 1, tests: null });
  const record = (oneAt: string, twoAt: string) => mutate(paths, now, (l, emit) => {
    if (!l.tasks.length) upsertTasks(l, c, [{ source: { kind: 'manual', key: 'T-1' }, title: 'B' }, { source: { kind: 'manual', key: 'T-2' }, title: 'B again' }], 'human', 'h', emit, now);
    const one = l.tasks.find((t) => t.id === 'T-1')!;
    const second = l.tasks.find((t) => t.id === 'T-2')!;
    one.deploys = [deployOf(head, oneAt)];
    second.deploys = [deployOf(two, twoAt)];
    one.state = 'done';
    second.state = 'todo';
    // The ledger is written only for an event (D-012).
    emit({ type: 'task.updated', task: 'T-2', actor: 'human', by: 'h', data: { deploys: second.deploys } });
  });
  record(at(10), at(12));
  assert.deepEqual([...deployedByTasks(paths, run, { branch: 'dev' }, head)], [], 'T-2 deployed B last, at other content: the org hasn\'t the head\'s B');
  const calls: string[] = [];
  const runner = fakeRunner({ 'nice -n 15 sf project deploy start': sf({ id: '0Af9', success: true }) }, calls);
  writeDeployRecord(paths, { env: 'dev', org: 'Acme Dev', sha: before, at: at(9), by: 'human:jordan', jobId: null, files: 0 });
  const r = deploy(paths, c, 'dev', { run: runner, now, slots: slots() }, { by: 'human:jordan' });
  assert.equal(r.deployed, true, r.summary);
  assert.deepEqual([r.plan.files, r.plan.deployedBy], [[B], []], 'B goes');
  assert.ok(calls.some((l) => l.includes('deploy start') && l.includes(`--source-dir ${B}`)));
  // The other way round, T-1's deploy came last: the org has the head's B, and nothing's left.
  record(at(12), at(10));
  assert.deepEqual([...deployedByTasks(paths, run, { branch: 'dev' }, head)], [[B, 'T-1']]);
  writeDeployRecord(paths, { env: 'dev', org: 'Acme Dev', sha: before, at: at(9), by: 'human:jordan', jobId: null, files: 0 });
  const left = deploy(paths, c, 'dev', { run: runner, now, slots: slots() }, { by: 'human:jordan' });
  assert.equal(left.deployed, false);
  assert.match(left.summary, /^Nothing's left to deploy to Dev: T-1 deployed 1 file itself/);
});
