// The deploy gate (D-T-115): a Salesforce builder deploys its change to its build org, checks each component is
// there, and runs the named Apex tests in the org, with a fake sf that records every call. It refuses where it
// mustn't, takes turns on one org, waits while another task in flight changes a file it changed, and acc done
// refuses a Salesforce task until it passed on the last commit.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type Config, parseConfig, withDeploy } from '../src/config.ts';
import { deploy, deployedByTasks, lastDeploy, writeDeployRecord } from '../src/deploy.ts';
import {
  apexTestArgs, DEPLOY_GATE, deployedComponents, deployGate, deployGateArgs, type DeployTests, latestDeploys, listMetadataArgs, orgLockDir, readApexRun, readListed, recordDeploy, type TaskDeploy, testsWords,
} from '../src/deploy-gate.ts';
import { run, type RunResult } from '../src/exec.ts';
import { assertCheckOnly, deployProblems, gatesFor, outcome, parseDeployJson, runGates } from '../src/gates.ts';
import { guardBash } from '../src/hooks.ts';
import { checkMove, mutate, readLedger, type Task, upsertTasks } from '../src/ledger.ts';
import { builderSettings } from '../src/packet.ts';
import { repoPaths } from '../src/paths.ts';
import { readReceipt, receiptHooks, writeReceipt } from '../src/receipts.ts';
import { fakeRunner, gitIn, makeRepo, ok, sf, SF_CONFIG, tempDir } from './support.ts';

const now = () => new Date('2026-10-23T12:00:00Z');
const config = (raw: unknown = SF_CONFIG): Config => {
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

/**
 * A Salesforce repo on dev, with uat beside it, T-1 running on its own branch (checked out here) with Account
 * changed and a field added, and T-2 running on a branch of its own that changed nothing yet. validate passed
 * on T-1's commit, as a deploy follows a check-only one.
 */
function fixture() {
  const dir = makeRepo({
    'sfdx-project.json': JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }),
    [CLASS]: 'public class Account {}\n',
    'force-app/main/default/classes/Old.cls': 'public class Old {}\n',
    'force-app/main/default/emailservices/EmailToCase.xml-meta.xml': '<x/>\n',
    'manifest/environment-specific.txt': 'force-app/main/default/emailservices/EmailToCase.xml-meta.xml\n',
    'manifest/known-drift.txt': '',
    '.gitignore': '.sf/\n',
  });
  gitIn(dir, 'branch', '-m', 'dev');
  gitIn(dir, 'branch', 'uat', 'dev');
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

/** A fake sf: the deploy, the org's listings, and the test run, each recorded. `over` replaces any of them. */
function fakeSf(calls: string[], over: Record<string, RunResult | (() => RunResult)> = {}) {
  return fakeRunner({
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

// ---------------------------------------------------------------- the deploy, its check and its tests

test('the deploy gate deploys the changed source with the named tests, asks the org for each component, runs the tests there, and records it all', () => {
  const f = fixture();
  const calls: string[] = [];
  const r = deployRun(f, fakeSf(calls));
  assert.equal(r.status, 'pass', r.summary);
  assert.match(r.summary, /^Deployed 2 components to Acme Dev \(job 0Af1\): 2 listed in the org; 3 tests passed in the org, 91% coverage\.$/);
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
  // The receipt: what was deployed, the job, the tests and their result, with every command in its log.
  const receipt = readReceipt(f.paths, f.sha, DEPLOY_GATE)!;
  assert.equal(receipt.status, 'pass');
  assert.equal(receipt.details!.jobId, '0Af1');
  assert.deepEqual(receipt.details!.components, ['Apex Class: Account', 'Custom Field: Account.Foo__c']);
  assert.deepEqual([receipt.details!.verified, receipt.details!.missing, receipt.details!.unchecked], [2, [], []]);
  assert.deepEqual(receipt.details!.tests, TESTS);
  assert.deepEqual(receipt.details!.testRun, { id: '707x1', names: ['AccountTest'], outcome: 'pass', ran: 3, failed: 0, coverage: '91%', failures: [] });
  assert.deepEqual(receipt.counts, { run: 3, passed: 3, failed: 0, skipped: 0, todo: 0, runner: 'apex' });
  assert.match(receipt.command!, /^sf project deploy start --target-org 'Acme Dev'/);
  const log = readFileSync(receipt.log!, 'utf8');
  assert.ok(log.includes('$ sf project deploy start') && log.includes('$ sf org list metadata') && log.includes('$ sf apex run test'), 'each step is logged');
  // The task's record: the org, the components, the time, the tests.
  const t = ledgerTask(f.paths);
  assert.equal(t.deploys!.length, 1);
  const d = t.deploys![0]!;
  assert.deepEqual([d.env, d.org, d.sha, d.at, d.jobId, d.paths, d.verified], ['dev', 'Acme Dev', f.sha, now().toISOString(), '0Af1', [CLASS, FIELD], 2]);
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
  const against = (c: Config, branch: string, tests = TESTS) => runGates(f.paths, c, env(c, branch), [DEPLOY_GATE], tests, { run: runner, now, slots: slots(), task: 'T-1', deploys: true }).results[0]!;
  const noOrg = config({ ...SF_CONFIG, environments: SF_CONFIG.environments.map((e) => (e.name === 'Dev' ? { name: 'Dev', type: 'developer', default: true } : e)) });
  assert.match(against(noOrg, 'dev').summary, /Dev has no org alias/);
  assert.equal(against(noOrg, 'dev').status, 'error');
  const guarded = config({ ...SF_CONFIG, environments: SF_CONFIG.environments.map((e) => (e.name === 'UAT' ? { ...e, protected: true } : e)) });
  const uat = against(guarded, 'uat');
  assert.equal(uat.status, 'error');
  assert.match(uat.summary, /UAT is protected\. A builder deploys only to its own unprotected build org \(D-018\)/);
  gitIn(f.dir, 'branch', 'production', 'dev');
  assert.match(against(f.c, 'production').summary, /Production is production\./);
  write(f.dir, 'force-app/main/default/emailservices/EmailToCase.xml-meta.xml', '<z/>\n');
  commitAll(f.dir, 'org-owned');
  const specific = against(f.c, 'dev');
  assert.equal(specific.status, 'fail');
  assert.match(specific.summary, /environment-specific files.*\(D-016\): force-app\/main\/default\/emailservices\/EmailToCase\.xml-meta\.xml/);
  gitIn(f.dir, 'checkout', '-q', 'dev', '--', 'force-app/main/default/emailservices/EmailToCase.xml-meta.xml');
  gitIn(f.dir, 'rm', '-q', 'force-app/main/default/classes/Old.cls');
  commitAll(f.dir, 'delete');
  const deleted = against(f.c, 'dev');
  assert.equal(deleted.status, 'fail');
  assert.match(deleted.summary, /Deletions \(and renames\) stay a person's: force-app\/main\/default\/classes\/Old\.cls\. acc never deploys a deletion/);
  gitIn(f.dir, 'checkout', '-q', 'dev', '--', 'force-app/main/default/classes/Old.cls');
  commitAll(f.dir, 'restore');
  const untested = against(f.c, 'dev', []);
  assert.equal(untested.status, 'fail');
  assert.match(untested.summary, /Apex changed \(force-app\/main\/default\/classes\/Account\.cls\)\. Name the test classes .* acc gate run deploy --test/);
  assert.deepEqual(calls.filter((l) => l.startsWith('nice -n 15 sf')), [], 'none of these reached sf');
});

test('the gate skips when the run isn\'t the builder\'s own, fails with uncommitted changes, and fails until validate passed on the commit', () => {
  const f = fixture();
  const calls: string[] = [];
  const runner = fakeSf(calls);
  const elsewhere = deployRun(f, runner, { deploys: false });
  assert.equal(elsewhere.status, 'skip');
  assert.match(elsewhere.summary, /Not run here: a builder deploys from its own worktree, on its branch, with acc gate run deploy/);
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
  assert.deepEqual(calls.filter((l) => l.startsWith('nice -n 15 sf')), [], 'nothing deployed');
  f.passed('validate');
  assert.equal(deployRun(f, runner).status, 'pass');
});

test('no gate but the deploy gate may run a real deploy, and it never runs a quick deploy or a resume', () => {
  assertCheckOnly('sf', ['project', 'deploy', 'start', '--target-org', 'x'], DEPLOY_GATE);
  assert.throws(() => assertCheckOnly('sf', ['project', 'deploy', 'start', '--target-org', 'x'], 'validate'), /real deploy/);
  assert.throws(() => assertCheckOnly('sf', ['project', 'deploy', 'start', '--target-org', 'x']), /real deploy/);
  assert.throws(() => assertCheckOnly('sf', ['project', 'deploy', 'quick', '--job-id', '1'], DEPLOY_GATE), /real deploy/);
  assert.throws(() => assertCheckOnly('sf', ['project', 'deploy', 'resume', '--job-id', '1'], DEPLOY_GATE), /real deploy/);
  assertCheckOnly('sf', ['project', 'deploy', 'start', '--dry-run'], 'validate');
  // A gate made with the runner's exec is guarded by its own name: a custom gate given a deploy start is refused.
  const f = fixture();
  const c = config({ ...SF_CONFIG, gates: { required: ['validate'], commands: { sneaky: 'sf project deploy start --target-org x' } } });
  assert.doesNotThrow(() => runGates(f.paths, c, env(c), ['sneaky'], [], { run: fakeSf([]), now, slots: slots(), deploys: true }), 'a shell command isn\'t inspected: the builder\'s hook and deny list refuse it');
});

// ---------------------------------------------------------------- taking turns on one org

test('two deploys to one org take turns: a deploy waits for the org\'s lock, gives up after its timeout, and says what it is while it holds it', () => {
  const f = fixture();
  const dir = tempDir('slots-');
  const lock = orgLockDir('Acme Dev', dir);
  assert.equal(lock, join(dir, 'orgs', 'Acme_Dev'), 'beside the heavy-check slots, named for the org');
  mkdirSync(join(lock, 'slot-0'), { recursive: true });
  writeFileSync(join(lock, 'slot-0', 'owner'), JSON.stringify({ what: 'Deploy to Acme Dev', task: 'T-9', pid: process.pid, at: Date.now() }));
  const calls: string[] = [];
  let waited = 0;
  assert.throws(() => runGates(f.paths, f.c, env(f.c), [DEPLOY_GATE], TESTS, { run: fakeSf(calls), now, slots: { dir, timeoutMs: 150, pollMs: 20 }, task: 'T-1', deploys: true, onWait: () => waited++ }), /stayed taken/);
  assert.equal(waited, 1, 'the builder is told it waits');
  assert.ok(!calls.some((l) => l.includes('deploy start')), 'nothing deployed over the other deploy');
  rmSync(join(lock, 'slot-0'), { recursive: true, force: true });
  let owner: Record<string, unknown> | null = null;
  const r = runGates(f.paths, f.c, env(f.c), [DEPLOY_GATE], TESTS, {
    run: fakeSf(calls, { 'nice -n 15 sf project deploy start': () => { owner = JSON.parse(readFileSync(join(lock, 'slot-0', 'owner'), 'utf8')); return sf({ id: '0Af1', success: true }); } }),
    now, slots: { dir, timeoutMs: 1000, pollMs: 20 }, task: 'T-1', deploys: true,
  }).results[0]!;
  assert.equal(r.status, 'pass', r.summary);
  assert.deepEqual([owner!.what, owner!.task, owner!.env], ['Deploy to Acme Dev', 'T-1', 'dev']);
  assert.ok(!existsSync(join(lock, 'slot-0')), 'released afterwards');
});

test('a deploy waits while another task in flight changes a file it changed, naming the task and file, and goes once that task is done; a task sharing none never waits', () => {
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
  assert.ok(!calls.some((l) => l.startsWith('nice -n 15 sf')), 'nothing deployed over T-2');
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

test('a builder\'s raw sf project deploy start is still refused, acc gate run deploy is allowed, and acc deploy stays a person\'s', () => {
  const b = { task: { id: 'T-1', run: { branch: 'task/T-1-a' } } } as never;
  assert.match(guardBash(b, 'sf project deploy start --source-dir force-app')!, /never deploy by hand .*acc gate run deploy/);
  assert.match(guardBash(b, 'sf project deploy quick --job-id 0Af')!, /never deploy by hand/);
  assert.match(guardBash(b, 'sf project deploy resume --job-id 0Af')!, /never deploy by hand/);
  assert.equal(guardBash(b, 'sf project deploy start --dry-run --source-dir force-app'), null);
  assert.equal(guardBash(b, 'acc gate run deploy'), null);
  assert.equal(guardBash(b, 'acc gate run deploy --test AccountTest="covers it"'), null);
  assert.match(guardBash(b, 'acc deploy dev')!, /acc deploy is a person's/);
  const s = builderSettings({ id: 'T-1', environment: 'dev' } as never, config(), '/bin', '/usr/bin') as { permissions: { allow: string[]; deny: string[] } };
  assert.ok(s.permissions.allow.includes('Bash(acc gate run *)'));
  for (const d of ['Bash(sf project deploy start*)', 'Bash(sf project deploy quick*)', 'Bash(acc deploy*)']) assert.ok(s.permissions.deny.includes(d), d);
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
  const dir = makeRepo({ 'sfdx-project.json': JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }), 'force-app/main/default/classes/A.cls': 'public class A {}\n' });
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
