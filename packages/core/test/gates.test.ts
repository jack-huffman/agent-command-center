import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig, type Config } from '../src/config.ts';
import { drift, driftReportPath } from '../src/drift.ts';
import type { RunOptions, RunResult } from '../src/exec.ts';
import {
  assertCheckOnly, changesFor, gatesFor, gateTarget, readAnalyzer, readDeploy, runGates, validateArgs,
} from '../src/gates.ts';
import { emptyLedger } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { readReceipt, receiptHooks } from '../src/receipts.ts';
import { withSlot } from '../src/semaphore.ts';
import { run } from '../src/exec.ts';
import { fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, ok, SF_CONFIG, tempDir } from './support.ts';

const config = (raw: unknown): Config => {
  const r = parseConfig(raw);
  assert.deepEqual(r.errors, []);
  return r.config!;
};
const now = () => new Date('2026-10-01T12:00:00Z');
const write = (dir: string, rel: string, text: string) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

/** A Salesforce repo on `dev`, with a task branch checked out, so changes are measured against dev. */
function sfRepo(): string {
  const dir = makeRepo({
    'sfdx-project.json': JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }),
    'force-app/main/default/classes/Account.cls': 'public class Account {}\n',
    'force-app/main/default/classes/Old.cls': 'public class Old {}\n',
    'force-app/main/default/emailservices/EmailToCase.xml-meta.xml': '<x/>\n',
    'manifest/environment-specific.txt': '# org-owned\nforce-app/main/default/emailservices/EmailToCase.xml-meta.xml\n',
    'manifest/known-drift.txt': '# expected\nforce-app/main/default/objects/Account/fields/Legacy__c.field-meta.xml\n',
    'manifest/baseline-package.xml': '<Package/>\n',
    '.gitignore': '.sf/\n',
  });
  gitIn(dir, 'branch', '-m', 'dev');
  gitIn(dir, 'checkout', '-q', '-b', 'task/DEV-1-thing');
  return dir;
}
const commitAll = (dir: string, msg = 'change') => { gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-q', '-m', msg); };
const sfConfig = (gates: Record<string, unknown> = SF_CONFIG.gates) => config({ ...SF_CONFIG, gates });
const dev = (c: Config) => c.environments.find((e) => e.branch === 'dev')!;
const slots = () => ({ dir: tempDir('slots-') });

// ---------------------------------------------------------------- the machine-wide slot

test('a heavy check waits for a slot held by a running process, and gives up after its timeout', () => {
  const dir = tempDir('slots-');
  mkdirSync(join(dir, 'slot-0'));
  writeFileSync(join(dir, 'slot-0', 'owner'), JSON.stringify({ pid: process.pid, at: Date.now() }));
  let waited = 0;
  assert.throws(() => withSlot(() => 'ran', { dir, slots: 1, timeoutMs: 150, pollMs: 20, onWait: () => waited++ }), /stayed taken/);
  assert.equal(waited, 1, 'told once that it is waiting');
  assert.equal(withSlot(() => 'ran', { dir, slots: 2, timeoutMs: 150, pollMs: 20 }), 'ran', 'a second slot is free');
  assert.ok(!existsSync(join(dir, 'slot-1')), 'and freed afterwards');
});

test('a slot whose owner has died is taken over, with no age limit on a live one', () => {
  const dir = tempDir('slots-');
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
  mkdirSync(join(dir, 'slot-0'));
  writeFileSync(join(dir, 'slot-0', 'owner'), JSON.stringify({ pid: Number(dead), at: 0 }));
  assert.equal(withSlot(() => 'ran', { dir, slots: 1, timeoutMs: 500, pollMs: 20 }), 'ran');
  assert.throws(() => withSlot(() => { throw new Error('boom'); }, { dir }), /boom/);
  assert.ok(!existsSync(join(dir, 'slot-0')), 'released even when the check throws');
});

// ---------------------------------------------------------------- what changed

test('changes are measured from the environment\'s branch: renames count as deletions, and environment-specific files are set apart', () => {
  const dir = sfRepo();
  write(dir, 'force-app/main/default/classes/Account.cls', 'public class Account { }\n');
  write(dir, 'force-app/main/default/lwc/card/card.js', 'export default class {}\n');
  write(dir, 'force-app/main/default/emailservices/EmailToCase.xml-meta.xml', '<y/>\n');
  gitIn(dir, 'mv', 'force-app/main/default/classes/Old.cls', 'force-app/main/default/classes/New.cls');
  commitAll(dir);
  const c = sfConfig();
  const ch = changesFor(run, dir, c, dev(c));
  assert.equal(ch.base, gitIn(dir, 'rev-parse', 'dev'));
  assert.deepEqual(ch.files.sort(), ['force-app/main/default/classes/Account.cls', 'force-app/main/default/classes/New.cls', 'force-app/main/default/lwc/card/card.js']);
  assert.deepEqual(ch.deleted, ['force-app/main/default/classes/Old.cls']);
  assert.deepEqual(ch.envSpecific, ['force-app/main/default/emailservices/EmailToCase.xml-meta.xml']);
});

test('the gates: Salesforce built-ins, replaced by name from gates.commands; generic projects have only their commands', () => {
  const sf = gatesFor(sfConfig({ required: ['format'], commands: { format: 'npm run prettier:verify', extra: 'true' } }));
  assert.deepEqual(sf.map((g) => g.name), ['lint', 'static', 'lwc-tests', 'validate', 'format', 'extra']);
  assert.equal(sf.find((g) => g.name === 'format')!.about, 'npm run prettier:verify');
  assert.deepEqual(sf.filter((g) => g.heavy).map((g) => g.name), ['static', 'lwc-tests', 'validate']);
  const generic = gatesFor(config({ ...GENERIC_CONFIG, gates: { commands: { check: 'npm run check', lint: 'true' }, heavy: ['lint'] } }));
  assert.deepEqual(generic.map((g) => [g.name, g.heavy]), [['check', false], ['lint', true]], 'gates.heavy replaces the defaults');
  assert.deepEqual(config({ ...GENERIC_CONFIG }).gates.heavy, ['build', 'test', 'check']);
  assert.match(parseConfig({ ...GENERIC_CONFIG, gates: { severity: 9 } }).errors.join(), /severity/);
});

// ---------------------------------------------------------------- validate stays check-only

test('validate is a dry run: NoTestRun without Apex, the named tests with it, and never a real deploy', () => {
  assert.deepEqual(validateArgs('Acme Dev', ['force-app/a.cls'], []).slice(0, 4), ['project', 'deploy', 'start', '--dry-run']);
  const noApex = validateArgs('Acme Dev', ['force-app/x.field-meta.xml'], []);
  assert.deepEqual(noApex.slice(noApex.indexOf('--test-level'), noApex.indexOf('--test-level') + 2), ['--test-level', 'NoTestRun']);
  const apex = validateArgs('Acme Dev', ['force-app/a.cls'], [{ name: 'ATest', reason: 'covers a' }, { name: 'BTest', reason: '' }]);
  assert.ok(apex.join(' ').endsWith('--test-level RunSpecifiedTests --tests ATest --tests BTest'));
  assert.throws(() => assertCheckOnly('sf', ['project', 'deploy', 'start', '--target-org', 'x']), /real deploy/);
  assert.throws(() => assertCheckOnly('/usr/local/bin/sf', ['project', 'deploy', 'quick', '--job-id', '1']), /real deploy/);
  assertCheckOnly('sf', ['project', 'deploy', 'start', '--dry-run']);
  assertCheckOnly('sf', ['project', 'deploy', 'validate']);
  assertCheckOnly('sh', ['-c', 'echo deploy']);
});

test('validate reads sf\'s result: the job id when it passes, the first problems when it fails, and error when sf gives no result', () => {
  const okRun: RunResult = { code: 0, stderr: '', stdout: JSON.stringify({ status: 0, result: { id: '0Af1', success: true, numberComponentsTotal: 2 } }) };
  const passed = readDeploy(okRun, 'Acme Dev', [], 2);
  assert.equal(passed.status, 'pass');
  assert.match(passed.summary, /Validated 2 components against Acme Dev\. Nothing was saved \(job 0Af1\)/);
  assert.equal(passed.details!.jobId, '0Af1');
  const failure = { status: 1, message: 'Deploy failed.', result: { id: '0Af2', success: false, details: { componentFailures: { fileName: 'force-app/a.cls', lineNumber: 3, problem: 'Missing ;' }, runTestResult: { failures: [{ name: 'ATest', methodName: 'works', message: 'Assertion failed' }] } } } };
  const failed = readDeploy({ code: 1, stderr: '', stdout: JSON.stringify(failure) }, 'Acme Dev', [{ name: 'ATest', reason: '' }], 1);
  assert.equal(failed.status, 'fail');
  assert.match(failed.summary, /2 problems: force-app\/a\.cls:3: Missing ;, ATest\.works: Assertion failed/);
  assert.equal(readDeploy({ code: 1, stderr: '', stdout: JSON.stringify({ status: 1, message: 'No authorization for Acme Dev' }) }, 'Acme Dev', [], 1).status, 'error');
  assert.equal(readDeploy({ code: 1, stderr: 'Killed', stdout: '' }, 'Acme Dev', [], 1).status, 'error');
});

test('Code Analyzer results: only violations at the failing severity or worse count', () => {
  const dir = tempDir();
  const file = join(dir, 'r.json');
  writeFileSync(file, JSON.stringify({ violations: [
    { rule: 'ApexCRUDViolation', severity: 2, message: 'Validate CRUD', primaryLocationIndex: 0, locations: [{ file: `${dir}/force-app/a.cls`, startLine: 4 }] },
    { rule: 'NoTrailingWhitespace', severity: 4, message: 'Trailing space', locations: [{ file: 'force-app/a.cls' }] },
  ] }));
  assert.deepEqual(readAnalyzer(file, 2, dir), { worst: ['force-app/a.cls:4 ApexCRUDViolation (sev 2): Validate CRUD'], total: 2 });
  assert.equal(readAnalyzer(file, 1, dir)!.worst.length, 0);
  assert.equal(readAnalyzer(join(dir, 'missing.json'), 2, dir), null);
});

// ---------------------------------------------------------------- running them

test('the Salesforce gates decide from the changes, run under nice, and leave receipts on the commit', () => {
  const dir = sfRepo();
  write(dir, 'force-app/main/default/classes/Account.cls', 'public class Account { }\n');
  commitAll(dir);
  const bin = join(realpathSync(dir), 'node_modules', '.bin'); // git reports the real path (/private/var on macOS)
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'prettier'), '');
  writeFileSync(join(dir, '.git', 'info', 'exclude'), 'node_modules\n');
  const c = sfConfig({ required: ['format', 'lint', 'validate'] });
  const paths = repoPaths(dir, run);
  const calls: string[] = [];
  const deployOk = ok(JSON.stringify({ status: 0, result: { id: '0Af9', success: true, numberComponentsTotal: 1 } }));
  const runner = fakeRunner({ [`nice -n 15 ${join(bin, 'prettier')} --check`]: ok('Checking formatting...\nAll matched files use Prettier code style!'), 'nice -n 15 sf project deploy start --dry-run': deployOk }, calls);

  const first = runGates(paths, c, dev(c), [], [], { run: runner, now, slots: slots() });
  assert.deepEqual(first.results.map((r) => [r.gate, r.status]), [['format', 'pass'], ['lint', 'skip'], ['validate', 'fail']]);
  assert.match(first.results[2]!.summary, /Apex changed .*--test <TestClass>=/);
  assert.ok(!calls.some((l) => l.includes('deploy start')), 'no validation without the tests that cover the Apex');

  const second = runGates(paths, c, dev(c), ['validate'], [{ name: 'AccountTest', reason: 'covers Account' }], { run: runner, now, slots: slots() });
  assert.equal(second.results[0]!.status, 'pass');
  const deploy = calls.find((l) => l.includes('deploy start'))!;
  assert.match(deploy, /^nice -n 15 sf project deploy start --dry-run --target-org Acme Dev .*--source-dir force-app\/main\/default\/classes\/Account\.cls --test-level RunSpecifiedTests --tests AccountTest$/);

  const sha = gitIn(dir, 'rev-parse', 'HEAD');
  const receipt = readReceipt(paths, sha, 'validate')!;
  assert.equal(receipt.status, 'pass');
  assert.equal(receipt.env, 'dev');
  assert.deepEqual(receipt.details!.tests, [{ name: 'AccountTest', reason: 'covers Account' }]);
  assert.ok(existsSync(receipt.log!), 'with its log beside it');
  assert.equal(readReceipt(paths, sha, 'lint')!.status, 'skip');

  // acc done looks at the task branch's commit: everything required has passed or didn't apply.
  const task = { run: { branch: 'task/DEV-1-thing' } } as never;
  assert.deepEqual(receiptHooks(paths, c, run).missingGates(task), []);
  write(dir, 'force-app/main/default/classes/Account.cls', 'public class Account {  }\n');
  commitAll(dir, 'again');
  assert.deepEqual(receiptHooks(paths, c, run).missingGates(task), ['format', 'lint', 'validate'], 'a new commit needs new receipts');
});

test('a missing tool is an error, not a failure, and validate refuses deletions and environment-specific changes', () => {
  const dir = sfRepo();
  write(dir, 'force-app/main/default/lwc/card/card.js', 'export default class {}\n');
  commitAll(dir);
  const c = sfConfig({ required: ['format', 'lint', 'lwc-tests', 'validate'] });
  const paths = repoPaths(dir, run);
  const deployOk = ok(JSON.stringify({ status: 0, result: { id: '0Af9', success: true } }));
  const r = runGates(paths, c, dev(c), [], [], { run: fakeRunner({ 'nice -n 15 sf project deploy start': deployOk }), now, slots: slots() });
  assert.deepEqual(r.results.map((x) => [x.gate, x.status]), [['format', 'error'], ['lint', 'error'], ['lwc-tests', 'error'], ['validate', 'pass']]);
  assert.match(r.results[0]!.summary, /prettier isn't installed .*npm install/);

  gitIn(dir, 'rm', '-q', 'force-app/main/default/classes/Old.cls');
  commitAll(dir, 'delete');
  assert.match(runGates(paths, c, dev(c), ['validate'], [], { run: fakeRunner({}), now, slots: slots() }).results[0]!.summary, /Deletions .* go to a person/);
  write(dir, 'force-app/main/default/emailservices/EmailToCase.xml-meta.xml', '<z/>\n');
  commitAll(dir, 'org-owned');
  assert.match(runGates(paths, c, dev(c), ['validate'], [], { run: fakeRunner({}), now, slots: slots() }).results[0]!.summary, /environment-specific files.*D-016/);
});

test('uncommitted changes: the gates run but record nothing, and an unknown gate is named', () => {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, gates: { required: ['lint'], commands: { lint: 'true', test: 'exit 3' } } }) });
  const c = config(JSON.parse(readFileSync(join(dir, '.acc/config.json'), 'utf8')));
  const paths = repoPaths(dir, run);
  const deps = { run, now, slots: slots() };
  assert.deepEqual(runGates(paths, c, c.environments[0]!, [], [], deps).results.map((x) => [x.gate, x.status, x.recorded]), [['lint', 'pass', true]], 'the required gates by default');
  assert.equal(runGates(paths, c, c.environments[0]!, ['test'], [], deps).results[0]!.status, 'fail');
  writeFileSync(join(dir, 'scratch.txt'), 'wip');
  const dirty = runGates(paths, c, c.environments[0]!, ['lint'], [], deps);
  assert.equal(dirty.dirty, true);
  assert.equal(dirty.results[0]!.recorded, false);
  rmSync(join(dir, 'scratch.txt'));
  assert.throws(() => runGates(paths, c, c.environments[0]!, ['nope'], [], deps), /No gate nope\. This project's gates: lint, test/);
});

test('which environment a checkout is checked against: named, the task\'s, the checked-out branch\'s, or the only one', () => {
  const c = sfConfig();
  const ledger = emptyLedger();
  ledger.tasks.push({ id: 'DEV-1', environment: 'uat', run: { branch: 'task/DEV-1-x' } } as never);
  assert.equal(gateTarget(c, ledger, 'task/DEV-1-x', {}).env.branch, 'uat');
  assert.equal(gateTarget(c, ledger, 'task/DEV-1-x', {}).task!.id, 'DEV-1');
  assert.equal(gateTarget(c, ledger, 'dev', {}).env.branch, 'dev');
  assert.equal(gateTarget(c, ledger, 'feature/x', { env: 'UAT' }).env.branch, 'uat');
  assert.equal(gateTarget(c, ledger, null, { task: 'dev-1' }).env.branch, 'uat');
  assert.throws(() => gateTarget(c, ledger, 'feature/x', {}), /--env <production\|uat\|dev>/);
  assert.throws(() => gateTarget(c, ledger, null, { task: 'DEV-9' }), /No task DEV-9/);
  const g = config(GENERIC_CONFIG);
  assert.equal(gateTarget(g, emptyLedger(), 'whatever', {}).env.branch, 'main');
});

// ---------------------------------------------------------------- drift

/** A fake `sf project retrieve start` that edits the throwaway worktree the way an org's copy would. */
function retrieveInto(edit: (dir: string) => void): (opts?: RunOptions) => RunResult {
  return (opts) => {
    edit(opts!.cwd!);
    return ok(JSON.stringify({ status: 0, result: { success: true } }));
  };
}

test('drift lists what changed and what exists only in the org, leaving out expected differences and tool folders', () => {
  const dir = sfRepo();
  gitIn(dir, 'checkout', '-q', 'dev');
  const c = sfConfig();
  const paths = repoPaths(dir, run);
  let where = '';
  const runner = fakeRunner({ 'nice -n 15 sf project retrieve start': retrieveInto((wt) => {
    where = wt;
    write(wt, 'force-app/main/default/classes/Account.cls', 'public class Account { /* hotfix in the org */ }\n');
    write(wt, 'force-app/main/default/flows/New_Flow.flow-meta.xml', '<Flow/>\n');
    write(wt, 'force-app/main/default/objects/Account/fields/Legacy__c.field-meta.xml', '<x/>\n');
    write(wt, 'force-app/main/default/emailservices/EmailToCase.xml-meta.xml', '<org-only/>\n');
    write(wt, '.sfdx/state.json', '{}');
  }) });
  const r = drift(paths, c, 'Dev', { run: runner, now, slots: slots() });
  assert.deepEqual(r.changed, ['force-app/main/default/classes/Account.cls']);
  assert.deepEqual(r.added, ['force-app/main/default/flows/New_Flow.flow-meta.xml']);
  assert.equal(r.ignored, 2, 'known drift and the environment-specific file');
  assert.equal(r.base, gitIn(dir, 'rev-parse', 'dev'));
  assert.ok(!existsSync(where), 'the throwaway worktree is gone');
  assert.ok(!gitIn(dir, 'worktree', 'list').includes(where));
  assert.deepEqual(JSON.parse(readFileSync(driftReportPath(paths, 'dev'), 'utf8')).changed, r.changed, 'the report is kept for doctor');
  assert.equal(gitIn(dir, 'status', '--porcelain'), '', 'the checkout is untouched');
});

test('drift on a matching org finds nothing, and a failed retrieve cleans up and says why', () => {
  const dir = sfRepo();
  const c = sfConfig();
  const paths = repoPaths(dir, run);
  const clean = drift(paths, c, 'dev', { run: fakeRunner({ 'nice -n 15 sf project retrieve start': retrieveInto(() => {}) }), now, slots: slots() });
  assert.deepEqual([clean.changed, clean.added, clean.ignored], [[], [], 0]);
  const denied = fakeRunner({ 'nice -n 15 sf project retrieve start': { code: 1, stderr: '', stdout: JSON.stringify({ status: 1, message: 'No authorization information found for Acme Dev.' }) } });
  assert.throws(() => drift(paths, c, 'dev', { run: denied, now, slots: slots() }), /retrieve from Acme Dev failed: No authorization/);
  assert.equal(gitIn(dir, 'worktree', 'list').split('\n').length, 1, 'no worktree left behind');
  assert.throws(() => drift(paths, c, 'qa', { run, now }), /No environment "qa"/);
  assert.throws(() => drift(paths, config(GENERIC_CONFIG), 'main', { run, now }), /no orgs/);
});

test('the doctor step for drift reads the last report: never run, clean, or with differences', async () => {
  const { makeContext } = await import('../src/onboarding/helpers.ts');
  const { STEPS } = await import('../src/onboarding/steps.ts');
  const step = STEPS.find((s) => s.id === 'B11.drift')!;
  const dir = sfRepo();
  write(dir, '.acc/config.json', JSON.stringify(SF_CONFIG));
  commitAll(dir, 'config');
  const ctx = () => makeContext(dir, run, {});
  assert.equal(step.check(ctx()).status, 'unknown');
  assert.equal(step.check(ctx()).fix, 'acc drift dev');
  const paths = repoPaths(dir, run);
  mkdirSync(join(paths.stateDir, 'drift'), { recursive: true });
  const report = (changed: string[], checkedAt = new Date().toISOString()) => writeFileSync(driftReportPath(paths, 'dev'), JSON.stringify({ changed, added: [], ignored: 1, checkedAt }));
  report([]);
  assert.equal(step.check(ctx()).status, 'pass');
  report(['force-app/a.cls']);
  assert.match(step.check(ctx()).detail, /had 1 difference .* acc drift dev --keep/);
  report([], new Date(Date.now() - 30 * 86_400_000).toISOString());
  assert.match(step.check(ctx()).detail, /30 days ago\. Check again/);
});


