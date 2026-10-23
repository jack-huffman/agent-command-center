import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { BUILT_IN_GATES, builderGatesFor, parseConfig, type Config, requiredGates } from '../src/config.ts';
import { drift, driftReportPath } from '../src/drift.ts';
import type { RunOptions, RunResult, Runner } from '../src/exec.ts';
import {
  assertCheckOnly, changesFor, checkEnv, gatesFor, gateTarget, listLines, nearTests, priorTests, readAnalyzer, readDeploy, readList, runGates, settle, validateArgs, waiveGates,
} from '../src/gates.ts';
import { checkMove, emptyLedger, type Task } from '../src/ledger.ts';
import { builderSettings } from '../src/packet.ts';
import { repoPaths } from '../src/paths.ts';
import { formatFloors, pruneRelaxed, readRelaxed, relaxesFor, relaxFloor } from '../src/ratchets.ts';
import { readReceipt, type Receipt, receiptHooks, satisfies, writeReceipt } from '../src/receipts.ts';
import { NO_COUNTS, type TestCounts } from '../src/test-counts.ts';
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
  // What it adds is kept apart from what it modifies (GH-103): a rename's new path is added.
  assert.deepEqual(ch.added.sort(), ['force-app/main/default/classes/New.cls', 'force-app/main/default/lwc/card/card.js']);
});

test('a generic project that requires nothing runs every gate on a bare acc gate run, its commands and stray-files (GH-103)', () => {
  const dir = makeRepo();
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-1-thing');
  write(dir, 'src/a.ts', 'export {};\n');
  commitAll(dir);
  const c = config({ ...GENERIC_CONFIG, gates: { commands: { lint: 'true', test: 'true' } } });
  assert.deepEqual(requiredGates(c, 'main', 'builder'), ['stray-files'], 'only the built-in is required');
  const ran = runGates(repoPaths(dir, run), c, c.environments[0]!, [], [], { run, now, slots: slots() });
  assert.deepEqual(ran.results.map((r) => [r.gate, r.status]), [['stray-files', 'pass'], ['lint', 'pass'], ['test', 'pass']]);
});

test('the gates: Salesforce built-ins, replaced by name from gates.commands; generic projects have only their commands; both have stray-files (GH-103)', () => {
  const sf = gatesFor(sfConfig({ required: ['format'], commands: { format: 'npm run prettier:verify', extra: 'true' } }));
  assert.deepEqual(sf.map((g) => g.name), ['stray-files', 'lint', 'static', 'lwc-tests', 'validate', 'deploy', 'format', 'extra']);
  assert.equal(sf.find((g) => g.name === 'format')!.about, 'npm run prettier:verify');
  assert.deepEqual(sf.filter((g) => g.heavy).map((g) => g.name), ['static', 'lwc-tests', 'validate', 'deploy']);
  const generic = gatesFor(config({ ...GENERIC_CONFIG, gates: { commands: { check: 'npm run check', lint: 'true' }, heavy: ['lint'] } }));
  assert.deepEqual(generic.map((g) => [g.name, g.heavy]), [['stray-files', false], ['check', false], ['lint', true]], 'gates.heavy replaces the defaults');
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
  assert.deepEqual(first.results.map((r) => [r.gate, r.status]), [['format', 'pass'], ['lint', 'skip'], ['validate', 'fail'], ['deploy', 'fail'], ['stray-files', 'skip']], 'deploy is required beside validate (D-T-115), and asks for the tests as validate does');
  assert.match(first.results[2]!.summary, /Apex changed .*--test <TestClass>=/);
  assert.ok(!calls.some((l) => l.includes('deploy start')), 'no validation without the tests that cover the Apex');

  const second = runGates(paths, c, dev(c), ['validate'], [{ name: 'AccountTest', reason: 'covers Account' }], { run: runner, now, slots: slots() });
  assert.equal(second.results[0]!.status, 'pass');
  const deploy = calls.find((l) => l.includes('deploy start'))!;
  assert.match(deploy, /^nice -n 15 sf project deploy start --dry-run --target-org Acme Dev .*--source-dir force-app\/main\/default\/classes\/Account\.cls --test-level RunSpecifiedTests --tests AccountTest$/);

  const sha = gitIn(dir, 'rev-parse', 'HEAD');
  const receipt = readReceipt(paths, sha, 'validate')!;
  assert.equal(receipt.status, 'pass');
  assert.deepEqual([receipt.counts, receipt.countsNote], [undefined, NO_COUNTS], 'it ran Apex tests, and sf\'s result didn\'t say how many (GH-100)');
  assert.equal(receipt.env, 'dev');
  assert.deepEqual(receipt.details!.tests, [{ name: 'AccountTest', reason: 'covers Account' }]);
  assert.deepEqual(priorTests(paths, c, sha), [{ name: 'AccountTest', reason: 'covers Account' }], 'what a commit made from this one is validated with');
  assert.ok(existsSync(receipt.log!), 'with its log beside it');
  assert.equal(readReceipt(paths, sha, 'lint')!.status, 'skip');

  // acc done looks at the task branch's commit: everything required has passed or didn't apply.
  const task = { run: { branch: 'task/DEV-1-thing' } } as never;
  assert.deepEqual(receiptHooks(paths, c, run).missingGates(task), ['deploy'], 'validate passed; the deploy that follows it (D-T-115) hasn\'t');
  write(dir, 'force-app/main/default/classes/Account.cls', 'public class Account {  }\n');
  commitAll(dir, 'again');
  assert.deepEqual(receiptHooks(paths, c, run).missingGates(task), ['format', 'lint', 'validate', 'deploy', 'stray-files'], 'a new commit needs new receipts');
});

test('prior tests come from the salesforce profile: a commit\'s validate receipt, minus entries that aren\'t tests; none on a generic project', () => {
  const dir = makeRepo();
  const paths = repoPaths(dir, run);
  const sha = gitIn(dir, 'rev-parse', 'HEAD');
  const tests = [{ name: 'AccountTest', reason: 'covers Account' }, { name: 'NoReason' }, 'CaseTest', null, { name: 7, reason: 'x' }, { name: 'CaseTest', reason: 'covers Case' }];
  writeReceipt(paths, { gate: 'validate', sha, env: 'dev', status: 'pass', startedAt: now().toISOString(), finishedAt: now().toISOString(), durationMs: 1, summary: 'Validated.', command: null, log: null, details: { tests } });
  assert.deepEqual(priorTests(paths, sfConfig(), sha), [{ name: 'AccountTest', reason: 'covers Account' }, { name: 'CaseTest', reason: 'covers Case' }]);
  assert.deepEqual(priorTests(paths, config(GENERIC_CONFIG), sha), [], 'a generic project names no tests, whatever a gate called validate wrote');
  assert.deepEqual(priorTests(paths, sfConfig(), 'f'.repeat(40)), [], 'a commit with no validate receipt');
});

test('a missing tool is an error, not a failure, and validate refuses deletions and environment-specific changes', () => {
  const dir = sfRepo();
  write(dir, 'force-app/main/default/lwc/card/card.js', 'export default class {}\n');
  commitAll(dir);
  const c = sfConfig({ required: ['format', 'lint', 'lwc-tests', 'validate'] });
  const paths = repoPaths(dir, run);
  const deployOk = ok(JSON.stringify({ status: 0, result: { id: '0Af9', success: true } }));
  const r = runGates(paths, c, dev(c), [], [], { run: fakeRunner({ 'nice -n 15 sf project deploy start': deployOk }), now, slots: slots() });
  assert.deepEqual(r.results.map((x) => [x.gate, x.status]), [['format', 'error'], ['lint', 'error'], ['lwc-tests', 'error'], ['validate', 'pass'], ['deploy', 'skip'], ['stray-files', 'pass']], 'a run that isn\'t the builder\'s own skips the deploy (D-T-115)');
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
  assert.deepEqual(runGates(paths, c, c.environments[0]!, [], [], deps).results.map((x) => [x.gate, x.status, x.recorded]), [['lint', 'pass', true], ['stray-files', 'skip', true]], 'the required gates by default, and stray-files (GH-103)');
  assert.equal(runGates(paths, c, c.environments[0]!, ['test'], [], deps).results[0]!.status, 'fail');
  writeFileSync(join(dir, 'scratch.txt'), 'wip');
  const dirty = runGates(paths, c, c.environments[0]!, ['lint'], [], deps);
  assert.equal(dirty.dirty, true);
  assert.equal(dirty.results[0]!.recorded, false);
  rmSync(join(dir, 'scratch.txt'));
  assert.throws(() => runGates(paths, c, c.environments[0]!, ['nope'], [], deps), /No gate nope\. This project's gates: stray-files, lint, test/);
});

test('a check runs without a builder\'s identity, so it gives the same answer inside a builder as outside one', () => {
  // A heavy check's own heavy work gets a slot folder of its own: it never waits for its check's slot.
  const gates = { required: ['who', 'nested'], commands: { who: 'test -z "$ACC_TASK$ACC_ROLE"', nested: 'test -n "$ACC_HEAVY_DIR" && test "$ACC_HEAVY_DIR" != /outer' }, heavy: ['nested'] };
  const dir = makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, gates }) });
  const c = config(JSON.parse(readFileSync(join(dir, '.acc/config.json'), 'utf8')));
  const was = { ACC_ROLE: process.env.ACC_ROLE, ACC_TASK: process.env.ACC_TASK, ACC_HEAVY_DIR: process.env.ACC_HEAVY_DIR };
  Object.assign(process.env, { ACC_ROLE: 'builder', ACC_TASK: 'GH-13', ACC_HEAVY_DIR: '/outer' });
  try {
    assert.deepEqual(runGates(repoPaths(dir, run), c, c.environments[0]!, [], [], { run, now, slots: slots() }).results.map((r) => [r.gate, r.status]), [['who', 'pass'], ['nested', 'pass'], ['stray-files', 'skip']]);
  } finally {
    for (const [k, v] of Object.entries(was)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  assert.deepEqual(checkEnv({ ACC_ROLE: 'builder', ACC_TASK: 'T-1', PATH: '/bin' }), { PATH: '/bin' });
  assert.deepEqual(checkEnv({ ACC_CHANGED: 'a.ts', ACC_NEAR_TESTS: 'a.test.ts', PATH: '/bin' }), { PATH: '/bin' }, 'a check run inside another check is told only its own run\'s (GH-95)');
  assert.deepEqual(checkEnv({ PATH: '/bin', ACC_HEAVY_DIR: '/outer' }, '/scratch/heavy'), { PATH: '/bin', ACC_HEAVY_DIR: '/scratch/heavy' });
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

test('drift finds what the branch has and the org lacks, from the retrieve\'s "cannot be found" list', () => {
  const dir = sfRepo();
  write(dir, 'force-app/main/default/flows/Requote.flow-meta.xml', '<Flow/>\n');
  write(dir, 'force-app/main/default/objects/Account/fields/Legacy__c.field-meta.xml', '<x/>\n');
  write(dir, 'force-app/main/default/objects/Case/fields/Days__c.field-meta.xml', '<x/>\n');
  commitAll(dir, 'more');
  gitIn(dir, 'checkout', '-q', 'dev');
  gitIn(dir, 'merge', '-q', '--ff-only', 'task/DEV-1-thing');
  const c = sfConfig();
  const files = [
    { type: 'Flow', fullName: 'Requote', state: 'Failed', error: "Entity of type 'Flow' named 'Requote' cannot be found" },
    { type: 'CustomField', fullName: 'Case.Days__c', state: 'Failed', error: "Entity of type 'CustomField' named 'Case.Days__c' cannot be found" },
    { type: 'CustomField', fullName: 'Account.Legacy__c', state: 'Failed', error: 'Entity of type CustomField named Account.Legacy__c cannot be found' },
    { type: 'CustomObject', fullName: 'DecisionTblFileImportData', state: 'Failed', error: "Can't retrieve non-customizable CustomObject named: DecisionTblFileImportData" },
    { type: 'ApexClass', fullName: 'Account', state: 'Changed', filePath: '/x/force-app/main/default/classes/Account.cls' },
    { type: '', fullName: '', state: 'Failed', error: 'Unknown type name in the manifest' },
  ];
  const runner = fakeRunner({ 'nice -n 15 sf project retrieve start': ok(JSON.stringify({ status: 0, result: { success: true, files } })) });
  const r = drift(repoPaths(dir, run), c, 'dev', { run: runner, now, slots: slots() });
  assert.deepEqual(r.missing, ['force-app/main/default/flows/Requote.flow-meta.xml', 'force-app/main/default/objects/Case/fields/Days__c.field-meta.xml']);
  assert.equal(r.ignored, 1, 'Legacy__c is known drift');
  assert.deepEqual(r.unretrievable, ["CustomObject:DecisionTblFileImportData: Can't retrieve non-customizable CustomObject named: DecisionTblFileImportData", 'Unknown type name in the manifest']);
});

test('a missing component is matched to its own files, not a namesake of another type', async () => {
  const { filesFor } = await import('../src/drift.ts');
  const tracked = [
    'force-app/main/default/classes/Sales.cls', 'force-app/main/default/classes/Sales.cls-meta.xml',
    'force-app/main/default/contentassets/Sales.asset', 'force-app/main/default/contentassets/Sales.asset-meta.xml',
    'force-app/main/default/objects/Task/listViews/Open.listView-meta.xml', 'force-app/main/default/objects/Case/listViews/Open.listView-meta.xml',
    'force-app/main/default/objects/OperatingHours/OperatingHours.object-meta.xml', 'force-app/main/default/objects/OperatingHours/fields/Name.field-meta.xml',
    'force-app/main/default/lwc/card/card.js', 'force-app/main/default/lwc/card/card.html',
  ];
  assert.deepEqual(filesFor('ContentAsset', 'Sales', tracked), ['force-app/main/default/contentassets/Sales.asset', 'force-app/main/default/contentassets/Sales.asset-meta.xml']);
  assert.deepEqual(filesFor('ApexClass', 'Sales', tracked), ['force-app/main/default/classes/Sales.cls', 'force-app/main/default/classes/Sales.cls-meta.xml']);
  assert.deepEqual(filesFor('ListView', 'Task.Open', tracked), ['force-app/main/default/objects/Task/listViews/Open.listView-meta.xml']);
  assert.deepEqual(filesFor('CustomObject', 'OperatingHours', tracked), ['force-app/main/default/objects/OperatingHours/OperatingHours.object-meta.xml']);
  assert.deepEqual(filesFor('CustomField', 'OperatingHours.Name', tracked), ['force-app/main/default/objects/OperatingHours/fields/Name.field-meta.xml']);
  assert.deepEqual(filesFor('LightningComponentBundle', 'card', tracked), ['force-app/main/default/lwc/card/card.js', 'force-app/main/default/lwc/card/card.html']);
});

test('drift on a matching org finds nothing, and a failed retrieve cleans up and says why', () => {
  const dir = sfRepo();
  const c = sfConfig();
  const paths = repoPaths(dir, run);
  const clean = drift(paths, c, 'dev', { run: fakeRunner({ 'nice -n 15 sf project retrieve start': retrieveInto(() => {}) }), now, slots: slots() });
  assert.deepEqual([clean.changed, clean.added, clean.missing, clean.ignored], [[], [], [], 0]);
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



test('logged commands can be pasted back into a shell', async () => {
  const { shellLine } = await import('../src/gates.ts');
  assert.equal(shellLine('sf', ['project', 'deploy', 'start', '--target-org', 'Acme Dev SB', '--source-dir', 'force-app/a.cls']), "sf project deploy start --target-org 'Acme Dev SB' --source-dir force-app/a.cls");
  assert.equal(shellLine('sh', ['-c', "echo 'hi'"]), `sh -c 'echo '\\''hi'\\'''`);
});

test('format checks Apex and LWC code only, never metadata XML (D-025)', () => {
  const dir = sfRepo();
  for (const f of ['force-app/main/default/objects/Account/fields/Tier__c.field-meta.xml', 'force-app/main/default/lwc/card/card.js-meta.xml', 'force-app/main/default/aura/box/box.cmp', 'force-app/main/default/staticresources/data.json', 'README.md']) write(dir, f, '<x/>\n');
  commitAll(dir);
  const c = sfConfig({ required: ['format'] });
  const r = runGates(repoPaths(dir, run), c, dev(c), [], [], { run: fakeRunner({}), now, slots: slots() });
  assert.deepEqual([r.results[0]!.status, r.results[0]!.summary], ['skip', 'No Apex or LWC code has changed.']);

  const bin = join(realpathSync(dir), 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'prettier'), '');
  writeFileSync(join(dir, '.git', 'info', 'exclude'), 'node_modules\n');
  for (const f of ['force-app/main/default/classes/Tier.cls', 'force-app/main/default/triggers/Tier.trigger', 'force-app/main/default/lwc/card/card.js', 'force-app/main/default/lwc/card/card.html', 'force-app/main/default/lwc/card/card.css', 'force-app/main/default/lwc/card/__tests__/card.test.js']) write(dir, f, 'x\n');
  commitAll(dir, 'code');
  const calls: string[] = [];
  runGates(repoPaths(dir, run), c, dev(c), [], [], { run: fakeRunner({ [`nice -n 15 ${join(bin, 'prettier')} --check`]: ok() }, calls), now, slots: slots() });
  const checked = calls.find((l) => l.includes('prettier --check'))!.split(' --check ')[1]!.split(' ').sort();
  assert.deepEqual(checked, [
    'force-app/main/default/classes/Tier.cls', 'force-app/main/default/lwc/card/__tests__/card.test.js', 'force-app/main/default/lwc/card/card.css',
    'force-app/main/default/lwc/card/card.html', 'force-app/main/default/lwc/card/card.js', 'force-app/main/default/triggers/Tier.trigger',
  ]);
});

test('sf output that a colour-loving shell coloured still reads: the T-1 validate that came back as an error', async () => {
  const { parseJsonOutput } = await import('../src/exec.ts');
  const coloured = '\x1b[97m{\x1b[39m\n  \x1b[94m"status"\x1b[39m: \x1b[34m1\x1b[39m,\n  \x1b[94m"result"\x1b[39m: \x1b[97m{\x1b[39m \x1b[94m"id"\x1b[39m: \x1b[92m"0Af1"\x1b[39m, \x1b[94m"success"\x1b[39m: \x1b[91mfalse\x1b[39m \x1b[97m}\x1b[39m\n\x1b[97m}\x1b[39m';
  assert.deepEqual(parseJsonOutput(coloured), { status: 1, result: { id: '0Af1', success: false } });
  assert.deepEqual(parseJsonOutput('Warning: update available\n{"status":0}'), { status: 0 }, 'a notice before the JSON is skipped');
  const out = readDeploy({ code: 1, stderr: 'Warning: @salesforce/cli update available', stdout: coloured }, 'Acme Dev', [{ name: 'ATest', reason: '' }], 3);
  assert.equal(out.status, 'fail', 'a failed validation, not an error about the update notice');
});

test('a person waives a failing gate on one commit, with a reason: it satisfies acc done, and a new commit needs checks again (D-031)', () => {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, gates: { required: ['lint', 'test'], commands: { lint: 'true', test: 'exit 3' } } }) });
  const c = config(JSON.parse(readFileSync(join(dir, '.acc/config.json'), 'utf8')));
  const paths = repoPaths(dir, run);
  const env = c.environments[0]!;
  const deps = { run, now, slots: slots() };
  runGates(paths, c, env, [], [], deps);
  const sha = gitIn(dir, 'rev-parse', 'HEAD').trim();
  const task = { id: 'T-1', run: { branch: gitIn(dir, 'branch', '--show-current').trim() } } as Task;
  const hooks = receiptHooks(paths, c, run);
  assert.deepEqual(hooks.missingGates(task), ['test']);

  const waive = (gates: string[], reason = 'a test task, never promoted') => waiveGates(paths, c, { sha, env, gates, reason, by: 'human:jordan', now });
  assert.throws(() => waive(['test'], '  '), /Say why/);
  assert.throws(() => waive(['nope']), /No gate nope/);
  assert.throws(() => waive(['lint']), /already passes/);
  const [r] = waive(['test']);
  assert.deepEqual([r!.status, r!.summary, r!.waived?.was, r!.waived?.reason], ['skip', 'Waived by jordan: a test task, never promoted', 'fail', 'a test task, never promoted']);
  assert.deepEqual(hooks.missingGates(task), [], 'a waived gate satisfies the required list');

  const again = runGates(paths, c, env, [], [], deps).results.find((x) => x.gate === 'test')!;
  assert.deepEqual([again.status, again.summary], ['skip', r!.summary], 'running the gates again keeps the waiver: the failing command isn\'t rerun');
  assert.equal(readReceipt(paths, sha, 'test')?.waived?.by, 'human:jordan');
  assert.equal(waive(['test'], 'a better reason')[0]!.waived?.was, 'fail', 'waiving again keeps what it was before the first waiver');

  writeFileSync(join(dir, 'next.txt'), 'more');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'next');
  assert.deepEqual(hooks.missingGates(task), ['lint', 'test', 'stray-files'], 'a new commit starts with no checks, waived or not');
});

// ---------------------------------------------------------------- what a test check ran (GH-100)

/** node:test's spec summary, as `npm test` prints it at the end, with each skipped test's line before it. */
const summary = (pass: number, skipped: string[] = [], fail = 0) => [
  ...skipped.map((n) => `﹣ ${n} (0.1ms) # SKIP`),
  `ℹ tests ${pass + fail + skipped.length}`, 'ℹ suites 0', `ℹ pass ${pass}`, `ℹ fail ${fail}`, 'ℹ cancelled 0', `ℹ skipped ${skipped.length}`, 'ℹ todo 0', 'ℹ duration_ms 12.5', '',
].join('\n');
const counted = (run: number, skipped: string[] = []): TestCounts => ({ run, passed: run, failed: 0, skipped: skipped.length, todo: 0, ...(skipped.length ? { skippedNames: skipped } : {}), runner: 'node:test' });

test('a test check\'s outcome, given what it ran: none run, or more skipped than before, needs a person; a fail stays a fail (GH-100)', () => {
  const passed = { status: 'pass' as const, summary: 'Passed.' };
  const check = { tests: true, compared: false, earlier: null, env: 'main' };
  // It ran tests: a pass, with nothing to add.
  assert.deepEqual(settle({ ...passed, counts: counted(312, ['a']) }, check), { ...passed, counts: counted(312, ['a']) });
  // It ran none: a hold, which satisfies nothing.
  const none = settle({ ...passed, counts: counted(0) }, check);
  assert.deepEqual([none.status, none.summary, satisfies(none)], ['hold', 'Ran no tests, so it can\'t vouch for the change.', false]);
  assert.equal(settle({ ...passed, counts: counted(0, ['a', 'b']) }, check).summary, 'Ran no tests (0 run, 2 skipped), so it can\'t vouch for the change.');
  // A fail or an error keeps its status, with what it ran.
  assert.equal(settle({ status: 'fail', summary: 'x', counts: counted(0) }, check).status, 'fail');
  // Output acc can't read: a test check says so, and passes; a check that runs no tests says nothing.
  assert.deepEqual(settle(passed, check), { ...passed, countsNote: NO_COUNTS });
  assert.deepEqual(settle({ status: 'error', summary: 'sh: npm: not found' }, check).countsNote, NO_COUNTS);
  assert.deepEqual(settle(passed, { ...check, tests: false }), passed);
  assert.deepEqual(settle({ status: 'skip', summary: 'No LWC has changed.' }, check), { status: 'skip', summary: 'No LWC has changed.' }, 'one that didn\'t apply ran nothing to count');

  // Compared: with nothing earlier it says so; with fewer skipped before, it's a hold naming the new ones.
  const compared = { ...check, compared: true };
  assert.equal(settle({ ...passed, counts: counted(10, ['a']) }, compared).countsNote, 'Nothing earlier on main to compare its skipped tests with.');
  const earlier = { sha: 'b'.repeat(40), counts: counted(9, ['a']) } as Receipt;
  const more = settle({ ...passed, counts: counted(10, ['a', 'flaky sync']) }, { ...compared, earlier });
  assert.deepEqual([more.status, more.summary, more.countsNote], ['hold', '2 skipped, up from 1 on bbbbbbb: flaky sync newly skipped.', 'Compared with 1 skipped on bbbbbbb, the nearest earlier count on main. Newly skipped: flaky sync.']);
  const same = settle({ ...passed, counts: counted(10, ['b']) }, { ...compared, earlier });
  assert.deepEqual([same.status, same.countsNote], ['pass', 'Compared with 1 skipped on bbbbbbb, the nearest earlier count on main. Newly skipped: b.'], 'as many as before passes, naming the swap');
  assert.equal(settle({ ...passed, counts: counted(10, []) }, { ...compared, earlier }).status, 'pass', 'fewer passes');
});

test('a test check counts what ran on its receipt: zero run is a hold, unreadable output says so, and a check that runs no tests says nothing (GH-100)', () => {
  const gates = {
    required: ['test'], tests: ['listed'],
    commands: { test: 'cat summary.txt', none: `printf '${summary(0).replace(/\n/g, '\\n')}'`, listed: 'echo all good', typecheck: 'echo no errors' },
  };
  const dir = makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, gates }), 'summary.txt': summary(3, ['slow one']) });
  const c = config(JSON.parse(readFileSync(join(dir, '.acc/config.json'), 'utf8')));
  const paths = repoPaths(dir, run);
  const r = runGates(paths, c, c.environments[0]!, ['test', 'none', 'listed', 'typecheck'], [], { run, now, slots: slots() });
  assert.deepEqual(r.results.map((x) => [x.gate, x.status]), [['test', 'pass'], ['none', 'hold'], ['listed', 'pass'], ['typecheck', 'pass']]);
  const sha = gitIn(dir, 'rev-parse', 'HEAD');
  const test = readReceipt(paths, sha, 'test')!;
  assert.deepEqual(test.counts, counted(3, ['slow one']));
  assert.equal(test.countsNote, 'Nothing earlier on main to compare its skipped tests with.');
  // Ran none: needs a person, which acc done won't take.
  const none = readReceipt(paths, sha, 'none')!;
  assert.deepEqual([none.status, none.summary, none.counts?.run, satisfies(none)], ['hold', 'Ran no tests, so it can\'t vouch for the change.', 0, false]);
  // A test gate whose output holds no summary: no counts, and a note saying so. A typecheck: neither.
  const listed = readReceipt(paths, sha, 'listed')!;
  assert.deepEqual([listed.status, listed.counts, listed.countsNote], ['pass', undefined, NO_COUNTS]);
  const typecheck = readReceipt(paths, sha, 'typecheck')!;
  assert.deepEqual([typecheck.counts, typecheck.countsNote], [undefined, undefined]);
});

test('more skipped than the nearest earlier count on the environment\'s branch is a hold; a builder\'s lighter check isn\'t compared; a person\'s waiver keeps the counts and stands for the branch (GH-100)', () => {
  const gates = { required: ['check'], builder: ['near'], tests: ['check', 'near'], commands: { check: 'cat summary.txt', near: 'cat summary.txt' } };
  // Its repo adds summary.txt at the root; stray-files has its own tests (GH-103).
  const raw = { ...GENERIC_CONFIG, autonomy: 'review', autopilot: { autoMerge: true }, gates, strayFiles: { required: false } };
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(raw), 'summary.txt': summary(5, ['old one']) });
  const c = config(raw);
  const paths = repoPaths(dir, run);
  const env = c.environments[0]!;
  const deps = { run, now, slots: slots() };
  const status = (names: string[]) => runGates(paths, c, env, names, [], deps).results.map((x) => [x.gate, x.status]);
  // On main: nothing earlier to compare with.
  assert.deepEqual(status(['check', 'near']), [['check', 'pass'], ['near', 'pass']]);
  const m0 = gitIn(dir, 'rev-parse', 'HEAD');

  // A task skips one more test.
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-1');
  writeFileSync(join(dir, 'summary.txt'), summary(4, ['old one', 'sync retries']));
  commitAll(dir, 'T-1: skip a test');
  const t1 = gitIn(dir, 'rev-parse', 'HEAD');
  assert.deepEqual(status(['check', 'near']), [['check', 'hold'], ['near', 'pass']], 'the lighter check runs the tests near the change, so it isn\'t compared');
  const held = readReceipt(paths, t1, 'check')!;
  assert.equal(held.summary, `2 skipped, up from 1 on ${m0.slice(0, 7)}: sync retries newly skipped.`);
  assert.equal(held.countsNote, `Compared with 1 skipped on ${m0.slice(0, 7)}, the nearest earlier count on main. Newly skipped: sync retries.`);
  assert.equal(readReceipt(paths, t1, 'near')!.countsNote, undefined);
  assert.deepEqual(receiptHooks(paths, c, run).missingGates({ id: 'T-1', run: { branch: 'task/T-1' } } as Task, 'merge'), ['check']);
  // Running it again on the same commit doesn't compare it with itself.
  assert.deepEqual(status(['check']), [['check', 'hold']]);

  // As many skipped as before, but another test: it passes, naming the swap.
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-2', m0);
  writeFileSync(join(dir, 'summary.txt'), summary(5, ['other one']));
  commitAll(dir, 'T-2: swap a skip');
  assert.deepEqual(status(['check']), [['check', 'pass']]);
  assert.match(readReceipt(paths, gitIn(dir, 'rev-parse', 'HEAD'), 'check')!.countsNote!, /^Compared with 1 skipped on [0-9a-f]{7}, .* Newly skipped: other one\.$/);

  // A person waives T-1's hold: the waiver keeps its counts, and what they came from.
  gitIn(dir, 'checkout', '-q', 'task/T-1');
  const [waived] = waiveGates(paths, c, { sha: t1, env, gates: ['check'], reason: 'sync retries are flaky until GH-9', by: 'human:jordan', now });
  assert.deepEqual([waived!.status, waived!.waived?.was, waived!.counts, waived!.command], ['skip', 'hold', held.counts, held.command]);
  assert.equal(held.command, 'sh -c \'cat summary.txt\'');
  // main moves on, and the merge queue merges it into T-1: compared with the count the person accepted on the branch, it passes.
  gitIn(dir, 'checkout', '-q', 'main');
  writeFileSync(join(dir, 'other.txt'), 'more\n');
  commitAll(dir, 'Another task');
  gitIn(dir, 'checkout', '-q', 'task/T-1');
  gitIn(dir, 'merge', '-q', '--no-edit', 'main');
  assert.deepEqual(status(['check']), [['check', 'pass']]);
  assert.match(readReceipt(paths, gitIn(dir, 'rev-parse', 'HEAD'), 'check')!.countsNote!, new RegExp(`^Compared with 2 skipped on ${t1.slice(0, 7)}, `));
});

test('validate counts Apex\'s tests only when it runs some: NoTestRun has none and is never held (GH-100)', () => {
  const apex = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'test-counts', 'apex-deploy.json'), 'utf8'));
  const failed = readDeploy({ code: 1, stderr: '', stdout: JSON.stringify(apex) }, 'Acme Dev', [{ name: 'CaseRoutingTest', reason: '' }], 3);
  assert.deepEqual([failed.status, failed.counts], ['fail', { run: 21, passed: 17, failed: 4, skipped: 0, todo: 0, runner: 'apex' }]);
  const passing = { status: 0, result: { ...apex.result, success: true, numberTestErrors: 0, numberTestsCompleted: 21, details: { runTestResult: { numTestsRun: '21', numFailures: '0' } } } };
  assert.deepEqual(readDeploy(ok(JSON.stringify(passing)), 'Acme Dev', [{ name: 'CaseRoutingTest', reason: '' }], 3).counts?.run, 21);
  const noTests = readDeploy(ok(JSON.stringify({ status: 0, result: { id: '0Af1', success: true, numberComponentsTotal: 2, numberTestsTotal: 0 } })), 'Acme Dev', [], 2);
  assert.deepEqual([noTests.status, noTests.counts], ['pass', undefined]);
  assert.deepEqual(settle(noTests, { tests: false, compared: false, earlier: null, env: 'dev' }), noTests, 'not a test run: no note, no hold');
});

// ---------------------------------------------------------------- a builder's lighter checks (GH-73)

test('the tests near a change: the test files it changed, and those in the same package named for, or importing, each file it changed (GH-73)', () => {
  const tracked = [
    'packages/core/src/merge.ts', 'packages/core/test/merge.test.ts', 'packages/core/test/land.test.ts', 'packages/core/test/queue.test.ts',
    'extension/src/model.ts', 'extension/test/tabs.test.ts', 'extension/test/merge.test.ts', 'app/util.py', 'tests/test_util.py', 'README.md',
  ];
  const text: Record<string, string> = {
    'packages/core/test/queue.test.ts': 'import { mergePr } from \'../src/merge.ts\';\n',
    'extension/test/tabs.test.ts': 'import { homeModel } from \'../src/model.ts\';\n',
    'packages/core/test/land.test.ts': 'import { land } from \'../src/land.ts\';\n',
  };
  const near = (changed: string[]) => nearTests(changed, tracked, (f) => text[f] ?? '');
  assert.deepEqual(near(['packages/core/src/merge.ts']), ['packages/core/test/merge.test.ts', 'packages/core/test/queue.test.ts'], 'named for it, or importing it, in its own package only');
  assert.deepEqual(near(['extension/src/model.ts']), ['extension/test/tabs.test.ts']);
  assert.deepEqual(near(['packages/core/test/land.test.ts']), ['packages/core/test/land.test.ts'], 'a test it changed');
  assert.deepEqual(near(['app/util.py']), ['tests/test_util.py']);
  assert.deepEqual(near(['README.md', 'docs/new.md']), [], 'nothing near a document');
  assert.deepEqual(near(['packages/core/test/gone.test.ts']), [], 'only tests the checkout has');
});

test('a file a folder\'s index gathers is near the tests of that index and of what loads it: the CLI\'s commands, an extension area, a core module (GH-95)', () => {
  // Shaped like this repo after GH-94: each folder of areas has an index, and an entry loads it.
  const text: Record<string, string> = {
    'packages/cli/src/main.ts': 'import { AREAS } from \'./commands/index.ts\';\nimport { tone } from \'./format.ts\';\nimport { VERSION } from \'./shared.ts\';\n',
    'packages/cli/src/commands/index.ts': 'import { area as agents } from \'./agents.ts\';\nimport { area as setup } from \'./setup.ts\';\nimport { area as tasks } from \'./tasks.ts\';\n',
    'packages/cli/src/commands/tasks.ts': 'import { VERSION } from \'../shared.ts\';\n',
    'packages/cli/test/cli.test.ts': 'import { readLedger } from \'../../core/src/index.ts\';\nconst MAIN = fileURLToPath(new URL(\'../src/main.ts\', import.meta.url));\n',
    'packages/cli/test/launcher.test.ts': 'const launcher = \'../bin/acc\';\n',
    'extension/src/extension.ts': 'import { AREAS } from \'./areas.ts\';\nimport { Hub } from \'./hub.ts\';\n',
    'extension/src/areas.ts': 'import { area as agents } from \'./agents.ts\';\nimport { area as runs } from \'./runs.ts\';\nimport { area as tasks } from \'./tasks.ts\';\n',
    'extension/src/runs.ts': 'import { Hub } from \'./hub.ts\';\n',
    'extension/test/activate.test.ts': 'const dist = fileURLToPath(new URL(\'../dist/extension.js\', import.meta.url));\n',
    'extension/webview/main.ts': 'import { AREAS } from \'./areas.ts\';\nimport { state } from \'./state.ts\';\n',
    'extension/webview/areas.ts': 'import { area as agents } from \'./agents.ts\';\nimport { area as overview } from \'./overview.ts\';\nimport { area as tasks } from \'./tasks.ts\';\n',
    'extension/test/screenshot.test.ts': 'assert.ok(page.includes(\'src="webview/main.js"\'));\n',
    'packages/core/src/index.ts': ['config', 'dispatch', 'held', 'ledger', 'paths'].map((m) => `export * from './${m}.ts';\n`).join(''),
    'packages/core/src/dispatch.ts': 'import { holdTask } from \'./held.ts\';\nimport { readLedger } from \'./ledger.ts\';\n',
    'packages/core/test/dispatch.test.ts': 'import { startHeld } from \'../src/held.ts\';\n',
    'packages/core/test/ledger.test.ts': 'import { readLedger } from \'../src/ledger.ts\';\n',
  };
  const tracked = [
    ...Object.keys(text), 'extension/package.json', 'packages/cli/src/format.ts', 'packages/cli/src/shared.ts', 'packages/cli/src/commands/agents.ts', 'packages/cli/src/commands/setup.ts',
    'extension/src/agents.ts', 'extension/src/tasks.ts', 'extension/src/hub.ts', 'extension/webview/agents.ts', 'extension/webview/overview.ts', 'extension/webview/tasks.ts',
    'extension/webview/state.ts', 'packages/core/src/config.ts', 'packages/core/src/held.ts', 'packages/core/src/ledger.ts', 'packages/core/src/paths.ts',
  ];
  const near = (changed: string[]) => nearTests(changed, tracked, (f) => text[f] ?? '');
  assert.deepEqual(near(['packages/cli/src/commands/tasks.ts']), ['packages/cli/test/cli.test.ts'], 'commands/index.ts gathers it, and the tests that run main.ts load that');
  assert.deepEqual(near(['packages/cli/src/shared.ts']), ['packages/cli/test/cli.test.ts'], 'main.ts gathers its own folder');
  assert.deepEqual(near(['extension/src/runs.ts']), ['extension/test/activate.test.ts'], 'areas.ts gathers it, and extension.ts loads that');
  assert.deepEqual(near(['extension/src/hub.ts']), [], 'extension.ts loads it, but gathers too little of its folder to be its index');
  assert.deepEqual(near(['extension/webview/overview.ts']), ['extension/test/screenshot.test.ts'], 'the page\'s tests are its package\'s, in extension/test');
  assert.deepEqual(near(['packages/core/src/held.ts']), ['packages/core/test/dispatch.test.ts'], 'core\'s index gathers it, but nothing in core loads the index, and the CLI is another package');
  assert.deepEqual(near(['packages/core/src/ledger.ts']), ['packages/core/test/ledger.test.ts'], 'dispatch.ts imports it, but gathers too little of its folder to count');
});

test('a file named index has as its tests those that load it by its path, not any that quotes a path ending in index; another index is still found by name (GH-117)', () => {
  // Fixture texts keep their quotes escaped, so this file loads no index by its path itself.
  const text: Record<string, string> = {
    'packages/core/src/index.ts': ['config', 'held', 'ledger'].map((m) => `export * from './${m}.ts';\n`).join(''),
    'packages/core/test/gates.test.ts': 'const tracked = [\'packages/cli/src/commands/index.ts\', \'packages/core/src/index.ts\'];\n',
    'packages/core/test/fixture.test.ts': "const text = 'import { a } from \\'../src/index.ts\\';';\n",
    'packages/core/test/lock.test.ts': 'const coreSrc = fileURLToPath(new URL(\'../src/index.ts\', import.meta.url));\n',
    'packages/core/test/barrel.test.ts': 'import * as core from \'../src\';\n',
    'packages/core/test/index.test.ts': '',
    'packages/core/test/held.test.ts': '',
    'packages/cli/test/cli.test.ts': 'import { readLedger } from \'../../core/src/index.ts\';\n',
    // An index with a name of its own, whose tests load its build.
    'extension/src/extension.ts': 'import { Hub } from \'./hub.ts\';\nimport { runs } from \'./runs.ts\';\nimport { tasks } from \'./tasks.ts\';\n',
    'extension/test/activate.test.ts': 'const dist = fileURLToPath(new URL(\'../dist/extension.js\', import.meta.url));\n',
  };
  const tracked = [
    ...Object.keys(text), 'packages/core/src/config.ts', 'packages/core/src/held.ts', 'packages/core/src/ledger.ts',
    'extension/package.json', 'extension/src/hub.ts', 'extension/src/runs.ts', 'extension/src/tasks.ts',
  ];
  const near = (changed: string[]) => nearTests(changed, tracked, (f) => text[f] ?? '');
  const loaders = ['packages/core/test/barrel.test.ts', 'packages/core/test/index.test.ts', 'packages/core/test/lock.test.ts'];
  assert.deepEqual(near(['packages/core/src/config.ts']), loaders, 'by its path or its folder\'s, or named for it; not data that names an index, nor an escaped fixture, nor another package');
  assert.deepEqual(near(['packages/core/src/held.ts']), [...loaders, 'packages/core/test/held.test.ts'].sort(), 'and its own');
  assert.deepEqual(near(['extension/src/hub.ts']), ['extension/test/activate.test.ts'], 'an index named for itself is still found by name');
});

// A folder whose index imports two of its five other modules: fewer than half, so the guess finds no index.
const PAGE: Record<string, string> = {
  'web/main.ts': 'import { AREAS } from \'./areas.ts\';\n',
  'web/areas.ts': 'import { a } from \'./a.ts\';\nimport { b } from \'./b.ts\';\n',
  'test/main.test.ts': 'const page = \'../web/main.ts\';\n',
  'test/areas.test.ts': '',
};
const PAGE_TRACKED = [...Object.keys(PAGE), 'package.json', 'web/a.ts', 'web/b.ts', 'web/c.ts', 'web/d.ts', 'web/a.css', 'lib/x.ts', 'lib/y.ts', 'lib/z.ts', 'lib/index.ts'];

test('a project names a folder\'s index in gates.nearIndexes: it gathers every code file in its folder, whatever it imports, where the guess finds none (D-155)', () => {
  const near = (changed: string[], indexes?: string[]) => nearTests(changed, PAGE_TRACKED, (f) => PAGE[f] ?? '', indexes);
  assert.deepEqual(near(['web/c.ts']), [], 'without the setting: areas.ts gathers two of five, so it isn\'t c.ts\'s index');
  assert.deepEqual(near(['web/a.ts']), [], 'nor a.ts\'s, which it imports');
  const named = ['web/areas.ts'];
  for (const f of ['web/a.ts', 'web/c.ts', 'web/d.ts']) assert.deepEqual(near([f], named), ['test/areas.test.ts', 'test/main.test.ts'], `${f}: the named index's tests, and those of main.ts, which loads it`);
  assert.deepEqual(near(['web/main.ts'], named), ['test/areas.test.ts', 'test/main.test.ts'], 'what loads the index is gathered too, as code in its folder');
  assert.deepEqual(near(['web/areas.ts'], named), ['test/areas.test.ts'], 'the index isn\'t its own index');
  assert.deepEqual(near(['web/a.css'], named), [], 'it gathers code only');
});

test('a named index reaches only its own folder, and one that isn\'t code in the checkout names nothing, so the folder is guessed at (D-155)', () => {
  const text: Record<string, string> = { ...PAGE, 'lib/index.ts': 'export * from \'./x.ts\';\nexport * from \'./y.ts\';\n', 'test/all.test.ts': 'import { x } from \'../lib/index.ts\';\n' };
  const tracked = [...PAGE_TRACKED, 'test/all.test.ts'];
  const near = (changed: string[], indexes?: string[]) => nearTests(changed, tracked, (f) => text[f] ?? '', indexes);
  assert.deepEqual(near(['lib/y.ts'], ['web/areas.ts']), ['test/all.test.ts'], 'another folder keeps the guess: lib/index.ts gathers both');
  assert.deepEqual(near(['lib/y.ts'], ['lib/z.ts']), [], 'a folder with a named index isn\'t guessed at: z.ts imports nothing, and nothing loads it');
  for (const gone of [['web/gone.ts'], ['web/areas.css'], ['other/areas.ts'], []]) assert.deepEqual(near(['web/c.ts'], gone), [], `${JSON.stringify(gone)} names nothing in web/`);
});

test('the tests near a change read each file once, however many files changed (GH-95)', () => {
  const tracked = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/index.ts', 'test/a.test.ts', 'test/b.test.ts', 'test/all.test.ts'];
  const text: Record<string, string> = { 'src/index.ts': 'export * from \'./a.ts\';\nexport * from \'./b.ts\';\nexport * from \'./c.ts\';\n', 'test/all.test.ts': 'import { a } from \'../src/index.ts\';\n' };
  const reads = new Map<string, number>();
  const found = nearTests(['src/a.ts', 'src/b.ts', 'src/c.ts'], tracked, (f) => {
    reads.set(f, (reads.get(f) ?? 0) + 1);
    return text[f] ?? '';
  });
  assert.deepEqual(found, ['test/a.test.ts', 'test/all.test.ts', 'test/b.test.ts']);
  assert.ok(reads.size >= 4, `${reads.size} files read`);
  assert.deepEqual([...reads].filter(([, n]) => n > 1), [], 'none read twice');
});

test('every command gate is given ACC_NEAR_TESTS, worked out once a run, though its command never names it (GH-117)', () => {
  const out = tempDir('near-env-');
  // Like `npm run test:near` or `make near`: acc can't see what they read, so each is told.
  const gates = ['typecheck', 'near', 'check'];
  const raw = { ...GENERIC_CONFIG, gates: { required: gates, commands: Object.fromEntries(gates.map((g) => [g, `env > '${join(out, g)}'`])) } };
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(raw), 'src/merge.ts': 'a\n', 'test/merge.test.ts': 'b\n', 'test/land.test.ts': 'c\n' });
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-1');
  writeFileSync(join(dir, 'src/merge.ts'), 'a, changed\n');
  gitIn(dir, 'commit', '-q', '-am', 'T-1: change');
  const c = config(raw);
  const lists: string[][] = [];
  const counted: Runner = (cmd, args, opts) => {
    if (cmd === 'git' && args[0] === 'ls-files') lists.push(args);
    return run(cmd, args, opts);
  };
  const was = process.env.ACC_NEAR_TESTS;
  // As when acc's own tests run inside a builder's near-tests gate.
  process.env.ACC_NEAR_TESTS = 'from/outside.test.ts';
  try {
    const ran = runGates(repoPaths(dir, run), c, c.environments[0]!, [], [], { run: counted, now, slots: slots() });
    assert.deepEqual(ran.results.map((r) => [r.gate, r.status]), [...gates.map((g) => [g, 'pass']), ['stray-files', 'skip']]);
  } finally {
    if (was === undefined) delete process.env.ACC_NEAR_TESTS;
    else process.env.ACC_NEAR_TESTS = was;
  }
  for (const g of gates) {
    // One variable at a time, so a failure doesn't print the whole environment.
    const lines = readFileSync(join(out, g), 'utf8').split('\n');
    const line = (name: string) => lines.find((l) => l.startsWith(`${name}=`));
    assert.equal(line('ACC_CHANGED'), 'ACC_CHANGED=src/merge.ts', `${g} is told what changed`);
    assert.equal(line('ACC_NEAR_TESTS'), 'ACC_NEAR_TESTS=test/merge.test.ts', `${g} is told this run's near tests, not the ones acc ran in`);
    assert.ok(!lines.some((l) => l.includes('from/outside')), g);
  }
  assert.equal(lists.length, 1, `the checkout's files are listed once for ${gates.length} gates: ${JSON.stringify(lists)}`);
});

test('the project\'s gates.nearIndexes reaches the near tests a gate is told, and an empty list leaves the guess (D-155)', () => {
  const told = (nearIndexes: string[] | undefined): string => {
    const out = tempDir('near-index-');
    const raw = { ...GENERIC_CONFIG, gates: { required: ['near'], commands: { near: `env > '${join(out, 'near')}'` }, ...(nearIndexes ? { nearIndexes } : {}) } };
    const dir = makeRepo({ '.acc/config.json': JSON.stringify(raw), ...PAGE, ...Object.fromEntries(PAGE_TRACKED.filter((f) => !(f in PAGE)).map((f) => [f, f === 'package.json' ? '{}\n' : 'x\n'])) });
    gitIn(dir, 'checkout', '-q', '-b', 'task/T-1');
    writeFileSync(join(dir, 'web/c.ts'), 'export const c = 2;\n');
    gitIn(dir, 'commit', '-q', '-am', 'T-1: change');
    const c = config(raw);
    const was = process.env.ACC_NEAR_TESTS;
    delete process.env.ACC_NEAR_TESTS;
    try {
      assert.equal(runGates(repoPaths(dir, run), c, c.environments[0]!, [], [], { run, now, slots: slots() }).results[0]!.status, 'pass');
    } finally {
      if (was !== undefined) process.env.ACC_NEAR_TESTS = was;
    }
    // The list is one path a line, so it runs on until the next variable.
    return readFileSync(join(out, 'near'), 'utf8').match(/^ACC_NEAR_TESTS=(.*(?:\n(?![A-Za-z_]\w*=).*)*)/m)![1]!;
  };
  assert.equal(told(['web/areas.ts']), 'test/areas.test.ts\ntest/main.test.ts');
  assert.equal(told(undefined), '', 'left out: no index, so no tests');
  assert.equal(told([]), '', 'an empty list names nothing');
});

test('where the merge queue runs the full check, builders run gates.builder, which acc done takes, and the full check covers; elsewhere both are gates.required (GH-73)', () => {
  const out = join(tempDir('near-'), 'near.out');
  const raw = {
    ...GENERIC_CONFIG, autonomy: 'review', autopilot: { autoMerge: true },
    gates: { required: ['check'], builder: ['typecheck', 'near'], commands: { check: 'exit 3', typecheck: 'true', near: `printf '%s|%s' "$ACC_CHANGED" "$ACC_NEAR_TESTS" > '${out}'` } },
  };
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(raw), 'src/merge.ts': 'a\n', 'test/merge.test.ts': 'b\n', 'test/land.test.ts': 'c\n' });
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-1');
  writeFileSync(join(dir, 'src/merge.ts'), 'a, changed\n');
  gitIn(dir, 'commit', '-q', '-am', 'T-1: change');
  const c = config(raw);
  const paths = repoPaths(dir, run);
  const env = c.environments[0]!;
  const sha = gitIn(dir, 'rev-parse', 'HEAD');
  const task = { id: 'T-1', state: 'running', environment: 'main', deps: [], run: { branch: 'task/T-1' } } as unknown as Task;
  const hooks = receiptHooks(paths, c, run);

  // acc gate run with no names: the builder's checks, told what changed and the tests near it.
  const ran = runGates(paths, c, env, [], [], { run, now, slots: slots() });
  assert.deepEqual(ran.results.map((r) => [r.gate, r.status]), [['typecheck', 'pass'], ['near', 'pass'], ['stray-files', 'skip']]);
  assert.equal(readFileSync(out, 'utf8'), 'src/merge.ts|test/merge.test.ts');
  assert.deepEqual([hooks.missingGates(task), hooks.missingGates(task, 'builder'), hooks.missingGates(task, 'merge')], [[], [], ['check']]);
  // acc done takes them: running → review.
  assert.deepEqual(checkMove(emptyLedger(), c, task, { to: 'review', actor: 'builder', by: 'builder:T-1', note: { landed: ['The merge'], moved: [], open: [] } }, hooks), []);
  assert.equal(readReceipt(paths, sha, 'check'), null, 'the full check didn\'t run');

  // The full check passing, as the queue runs it on its merge, covers a builder's on that commit.
  writeFileSync(join(dir, 'src/merge.ts'), 'a, again\n');
  gitIn(dir, 'commit', '-q', '-am', 'T-1: again');
  const next = gitIn(dir, 'rev-parse', 'HEAD');
  assert.deepEqual(hooks.missingGates(task), ['typecheck', 'near', 'stray-files']);
  // The queue's full check is gates.required and stray-files (GH-103).
  for (const gate of ['check', 'stray-files']) writeReceipt(paths, { gate, sha: next, env: 'main', status: 'pass', startedAt: '', finishedAt: '', durationMs: 0, summary: 'Passed.', command: null, log: null });
  assert.deepEqual([hooks.missingGates(task), hooks.missingGates(task, 'merge')], [[], []]);

  // Auto-merge off, a protected environment or no builder gates: both scopes are the required ones, as before.
  for (const other of [config({ ...raw, autopilot: { autoMerge: false } }), config({ ...raw, autonomy: 'manual' }), config({ ...raw, gates: { ...raw.gates, builder: [] } })]) {
    const h = receiptHooks(paths, other, run);
    assert.deepEqual([requiredGates(other, 'main', 'builder'), requiredGates(other, 'main', 'merge'), builderGatesFor(other, 'main')], [['check', 'stray-files'], ['check', 'stray-files'], false]);
    writeFileSync(join(dir, 'src/merge.ts'), `${Math.random()}\n`);
    gitIn(dir, 'commit', '-q', '-am', 'T-1: once more');
    runGates(paths, other, env, ['typecheck', 'near'], [], { run, now, slots: slots() });
    assert.deepEqual(h.missingGates(task), ['check', 'stray-files'], 'its lighter checks aren\'t enough here');
    assert.deepEqual(runGates(paths, other, env, [], [], { run, now, slots: slots() }).results.map((r) => r.gate), ['check', 'stray-files']);
  }
});

test('blocked work whose checks are settled goes to review by a person; a builder can\'t, and can\'t waive (D-031)', () => {
  const c = config({ ...GENERIC_CONFIG, gates: { required: ['test'], commands: { test: 'true' } } });
  const ledger = emptyLedger();
  const task = { id: 'T-1', state: 'blocked', deps: [], run: { branch: 'task/T-1' } } as unknown as Task;
  const settled = { missingGates: () => [] };
  const missing = { missingGates: () => ['test'] };
  assert.deepEqual(checkMove(ledger, c, task, { to: 'review', actor: 'human', by: 'human:jordan' }, settled), []);
  assert.match(checkMove(ledger, c, task, { to: 'review', actor: 'human', by: 'human:jordan' }, missing).join(' '), /test/);
  assert.match(checkMove(ledger, c, task, { to: 'review', actor: 'builder', by: 'builder:T-1' }, settled).join(' '), /can't move/);
  const deny = (builderSettings({ id: 'T-1' } as never, c, '/acc/bin', '/usr/bin') as { permissions: { deny: string[] } }).permissions.deny;
  assert.ok(deny.includes('Bash(acc gate waive*)'));
  assert.ok(deny.includes('Bash(acc gate relax*)'), 'nor relax a floor (GH-99)');
});

// ---------------------------------------------------------------- ratchets (GH-99)

/**
 * A repo on main whose ratchets read numbers from files, with T-1's branch checked out. The commands log
 * that they ran, outside the repo, so a carried check is seen not to run.
 */
function ratchetRepo(floors: Record<string, unknown> | null = { tests: { floor: 669 } }) {
  const ran = join(tempDir('ran-'), 'ran.log');
  const raw = {
    ...GENERIC_CONFIG,
    // These are about a ratchet; stray-files has its own tests (GH-103).
    strayFiles: { required: false },
    gates: {
      required: ['typecheck', 'tests'],
      commands: { typecheck: `echo typecheck >> '${ran}'` },
      ratchets: { tests: { command: `echo tests >> '${ran}'; cat count.txt`, limit: 'floor', label: 'tests' }, violations: { command: 'cat violations.txt', limit: 'ceiling', label: 'violations' } },
    },
  };
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(raw), 'count.txt': '669\n', 'violations.txt': '10\n', ...(floors ? { '.acc/floors.json': formatFloors(floors as never) } : {}) });
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-1');
  const c = config(raw);
  const paths = repoPaths(dir, run);
  const env = c.environments[0]!;
  const task = { id: 'T-1', state: 'running', environment: 'main', deps: [], run: { branch: 'task/T-1' } } as unknown as Task;
  // The ledger: T-1, and T-9, which a test may start from main as T-1's neighbour (GH-130).
  const tasks = (states: Record<string, string> = {}) => {
    mkdirSync(paths.stateDir, { recursive: true });
    const t9 = { ...task, id: 'T-9', run: { branch: 'task/T-9' } };
    writeFileSync(paths.ledger, JSON.stringify({ ...emptyLedger(), tasks: [task, t9].map((t) => ({ ...t, state: states[t.id] ?? t.state })) }));
  };
  tasks();
  const set = (files: Record<string, string>, msg = 'T-1: change') => {
    for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
    commitAll(dir, msg);
    return gitIn(dir, 'rev-parse', 'HEAD');
  };
  // For the task whose branch is checked out, as acc gate run finds it, unless a test names another.
  const gate = (raise: boolean, names: string[] = [], forTask: string | null = gitIn(dir, 'branch', '--show-current').replace(/^task\//, '')) =>
    runGates(paths, c, env, names, [], { run, now, slots: slots(), raise, ...(forTask ? { task: forTask } : {}) });
  const floorsText = () => readFileSync(join(dir, '.acc/floors.json'), 'utf8');
  const runs = () => (existsSync(ran) ? readFileSync(ran, 'utf8').trim().split('\n') : []);
  return { dir, c, paths, env, task, tasks, set, gate, floorsText, runs, hooks: receiptHooks(paths, c, run) };
}

test('a ratchet is a gate: listed after the commands, heavy when gates.heavy says, and its name can\'t be a built-in\'s (GH-99)', () => {
  const c = config({ ...GENERIC_CONFIG, gates: { commands: { check: 'npm run check' }, ratchets: { tests: { command: 'node scripts/count-tests.mjs', limit: 'floor', label: 'tests' } }, heavy: ['tests'] } });
  assert.deepEqual(gatesFor(c).map((g) => [g.name, g.heavy]), [['stray-files', false], ['check', false], ['tests', true]], 'after the built-in stray-files (GH-103) and the commands');
  assert.equal(gatesFor(c)[2]!.about, 'node scripts/count-tests.mjs (tests, which may only go up)');
  // The names config.ts keeps a ratchet from taking are the Salesforce gates' own.
  assert.deepEqual(gatesFor(sfConfig({ required: [] })).map((g) => g.name).sort(), [...BUILT_IN_GATES.salesforce].sort());
  assert.deepEqual(BUILT_IN_GATES.generic, ['stray-files'], 'and in every profile, stray-files (GH-103)');
});

test('a ratchet that beats its floor in a clean task worktree writes the new floor there; acc done waits for it, and the commit that records it carries its checks (GH-99)', () => {
  const r = ratchetRepo();
  const sha = r.set({ 'count.txt': '674\n' }, 'T-1: five more tests');
  const ran = r.gate(true);
  assert.deepEqual(ran.results.map((x) => [x.gate, x.status, x.summary]), [['typecheck', 'pass', 'Passed.'], ['tests', 'pass', 'tests 674 beats the floor 669: raised it in .acc/floors.json. Commit that file, then run acc gate run again.']]);
  assert.deepEqual(ran.raised, [{ gate: 'tests', label: 'tests', from: 669, to: 674 }]);
  assert.equal(r.floorsText(), formatFloors({ tests: { floor: 674 } }), 'written in the worktree');
  assert.equal(gitIn(r.dir, 'status', '--porcelain'), 'M .acc/floors.json', 'and nothing else');
  assert.deepEqual(readReceipt(r.paths, sha, 'tests')?.details?.ratchet, { label: 'tests', limit: 'floor', value: 674, floor: 669, base: 669, diff: 5, raised: { from: 669, to: 674 } });
  assert.deepEqual(r.hooks.missingGates(r.task), ['tests'], 'acc done waits for the raise to be committed');
  assert.deepEqual(r.runs(), ['typecheck', 'tests']);

  // Committed, alone: its checks carry over from the commit that measured them, and nothing runs again.
  commitAll(r.dir, 'T-1: raise the tests floor');
  const next = gitIn(r.dir, 'rev-parse', 'HEAD');
  const again = r.gate(true);
  assert.deepEqual(again.raised, []);
  assert.deepEqual(again.results.map((x) => [x.gate, x.status, x.summary]), [['typecheck', 'pass', 'Passed.'], ['tests', 'pass', 'tests 674, at its floor.']]);
  assert.deepEqual(r.runs(), ['typecheck', 'tests'], 'carried, not run');
  const carried = readReceipt(r.paths, next, 'tests')!;
  assert.deepEqual([carried.carried, carried.sha, carried.details?.ratchet], [{ from: sha }, next, { label: 'tests', limit: 'floor', value: 674, floor: 674, base: 669, diff: 5 }]);
  assert.deepEqual(readReceipt(r.paths, next, 'typecheck')?.carried, { from: sha });
  assert.deepEqual(r.hooks.missingGates(r.task), []);
  assert.equal(gitIn(r.dir, 'status', '--porcelain'), '');

  // Anything else in the commit, and every check runs again.
  r.set({ 'count.txt': '675\n', '.acc/floors.json': formatFloors({ tests: { floor: 675 } }) }, 'T-1: a hand-made raise and a test');
  r.gate(false);
  assert.deepEqual(r.runs(), ['typecheck', 'tests', 'typecheck', 'tests']);
});

test('acc writes no floor where it may not raise one: with raise off, as a refresh\'s and the merge queue\'s checks run, or with uncommitted changes (GH-99)', () => {
  const r = ratchetRepo();
  r.set({ 'count.txt': '674\n' });
  const before = r.floorsText();
  const off = r.gate(false);
  assert.deepEqual([off.results[1]!.status, off.results[1]!.summary, off.raised], ['pass', 'tests 674 beats the floor 669 by 5.', []]);
  assert.deepEqual([r.floorsText(), gitIn(r.dir, 'status', '--porcelain')], [before, ''], 'byte for byte the same, and the worktree clean');
  assert.deepEqual(r.hooks.missingGates(r.task), [], 'nothing to commit, so it satisfies acc done');

  write(r.dir, 'scratch.txt', 'wip');
  const dirty = r.gate(true);
  assert.deepEqual([dirty.dirty, dirty.results[1]!.summary, dirty.raised, r.floorsText()], [true, 'tests 674 beats the floor 669 by 5.', [], before]);
});

test('below its floor fails; a ceiling fails above it, and is raised by going down (GH-99)', () => {
  const r = ratchetRepo({ tests: { floor: 669 }, violations: { ceiling: 10 } });
  r.set({ 'count.txt': '660\n', 'violations.txt': '12\n' });
  const ran = r.gate(true);
  assert.deepEqual(ran.results.map((x) => [x.gate, x.status]), [['typecheck', 'pass'], ['tests', 'fail']]);
  assert.match(ran.results[1]!.summary, /^tests 660 is below its floor 669, by 9\./);
  assert.deepEqual(r.hooks.missingGates(r.task), ['tests']);
  assert.match(r.gate(true, ['violations']).results[0]!.summary, /^violations 12 is above its ceiling 10, by 2\./);
  r.set({ 'violations.txt': '10\n' });
  assert.equal(r.gate(true, ['violations']).results[0]!.summary, 'violations 10, at its ceiling.');
  r.set({ 'violations.txt': '8\n' });
  assert.deepEqual(r.gate(true, ['violations']).raised, [{ gate: 'violations', label: 'violations', from: 10, to: 8 }]);
  assert.equal(r.floorsText(), formatFloors({ tests: { floor: 669 }, violations: { ceiling: 8 } }), 'the other ratchet\'s entry is kept as it was');
});

test('a floor the builder lowered by hand fails; one a person relaxed, with a reason, passes at that number (GH-99)', () => {
  const r = ratchetRepo();
  r.set({ 'count.txt': '650\n', '.acc/floors.json': formatFloors({ tests: { floor: 640 } }) }, 'T-1: lower the bar');
  const low = r.gate(true);
  assert.equal(low.results[1]!.status, 'fail');
  assert.equal(low.results[1]!.summary, '.acc/floors.json lowers tests\'s floor to 640, from 669 on main, and no person relaxed it. Put it back to 669: only a person relaxes a floor, with acc gate relax.');
  assert.deepEqual([low.raised, r.floorsText()], [[], formatFloors({ tests: { floor: 640 } })], 'nothing raised on a failure');

  // A person puts it back, then relaxes it, saying why.
  r.set({ '.acc/floors.json': formatFloors({ tests: { floor: 669 } }), 'count.txt': '640\n' }, 'T-1: put the floor back');
  relaxFloor(r.paths.relaxed, r.paths.floors, r.dir, r.c, { ratchet: 'tests', to: 640, reason: 'the slow suite moved to its own job', by: 'human:jordan', now, task: 'T-1' });
  commitAll(r.dir, 'T-1: relax the tests floor');
  const relaxed = r.gate(true);
  assert.deepEqual([relaxed.results[1]!.status, relaxed.results[1]!.summary, relaxed.raised], ['pass', 'tests 640, at its floor.', []]);
  assert.deepEqual(relaxed.results[1]!.details?.ratchet, { label: 'tests', limit: 'floor', value: 640, floor: 640, base: 669, diff: -29 });
});

test('a floor a person relaxed, raised again by acc but still below the environment\'s, passes once the raise is committed (GH-99)', () => {
  const r = ratchetRepo();
  relaxFloor(r.paths.relaxed, r.paths.floors, r.dir, r.c, { ratchet: 'tests', to: 640, reason: 'the slow suite moved to its own job', by: 'human:jordan', now, task: 'T-1' });
  const sha = r.set({ 'count.txt': '650\n' }, 'T-1: relax the tests floor, and ten tests back');
  const ran = r.gate(true);
  assert.deepEqual([ran.results[1]!.status, ran.raised], ['pass', [{ gate: 'tests', label: 'tests', from: 640, to: 650 }]]);
  assert.equal(r.floorsText(), formatFloors({ tests: { floor: 650 } }));

  // Committed as the packet says: 650 is still below main's 669, and the person's relax to 640 backs it.
  commitAll(r.dir, 'T-1: raise the tests floor');
  const next = gitIn(r.dir, 'rev-parse', 'HEAD');
  const again = r.gate(true);
  assert.deepEqual([again.results[1]!.status, again.results[1]!.summary, again.raised], ['pass', 'tests 650, at its floor.', []]);
  assert.deepEqual(readReceipt(r.paths, next, 'tests')?.carried, { from: sha });
  assert.deepEqual(r.hooks.missingGates(r.task), []);

  // A fresh run on a later commit passes too; a floor below the one the person relaxed to still fails.
  r.set({ 'note.txt': 'x' }, 'T-1: a change');
  assert.equal(r.gate(true).results[1]!.summary, 'tests 650, at its floor.');
  r.set({ '.acc/floors.json': formatFloors({ tests: { floor: 630 } }), 'count.txt': '630\n' }, 'T-1: lower it again, by hand');
  assert.match(r.gate(true).results[1]!.summary, /^\.acc\/floors\.json lowers tests's floor to 630, from 669 on main, and no person relaxed it\./);
});

test('a person\'s old relax backs no other floor: once the environment\'s floor moves on, a floor lowered by hand fails (GH-99)', () => {
  const r = ratchetRepo();
  // Long ago, on T-1, a person relaxed tests from 669 to 640.
  relaxFloor(r.paths.relaxed, r.paths.floors, r.dir, r.c, { ratchet: 'tests', to: 640, reason: 'the slow suite moved to its own job', by: 'human:jordan', now, task: 'T-1' });
  gitIn(r.dir, 'checkout', '-q', '--', '.acc/floors.json');
  // Since then main's floor rose to 700, and T-9 began there.
  gitIn(r.dir, 'checkout', '-q', 'main');
  r.set({ 'count.txt': '700\n', '.acc/floors.json': formatFloors({ tests: { floor: 700 } }) }, 'main: the floor is 700');
  gitIn(r.dir, 'checkout', '-q', '-b', 'task/T-9');
  r.set({ 'count.txt': '690\n', '.acc/floors.json': formatFloors({ tests: { floor: 690 } }) }, 'T-9: drop ten tests, and lower the bar');
  const ran = r.gate(true);
  assert.equal(ran.results[1]!.status, 'fail');
  assert.equal(ran.results[1]!.summary, '.acc/floors.json lowers tests\'s floor to 690, from 700 on main, and no person relaxed it. Put it back to 700: only a person relaxes a floor, with acc gate relax.');
  assert.deepEqual([ran.raised, r.floorsText()], [[], formatFloors({ tests: { floor: 690 } })]);
});

test('a check\'s stored floor lowered by hand fails that check unrun; one a person relaxed, with a reason, lets it run (T-102)', () => {
  const stored = { tests: { floor: 669 }, 'typecheck.files': { floor: 120 }, 'other.files': { floor: 5 } };
  const r = ratchetRepo(stored);
  r.set({ '.acc/floors.json': formatFloors({ ...stored, 'typecheck.files': { floor: 100 }, 'other.files': { floor: 1 } }) }, 'T-1: lower the bar');
  const low = r.gate(true, ['typecheck']);
  assert.deepEqual(low.results.map((x) => [x.gate, x.status, x.summary]), [['typecheck', 'fail', '.acc/floors.json lowers typecheck.files from 120 to 100, and no person relaxed it. Put it back: only a person relaxes a floor, with acc gate relax <name> --to <n> --reason "<why>".']], 'another check\'s floor isn\'t this one\'s');
  assert.deepEqual(r.runs(), [], 'failed unrun');
  const { 'typecheck.files': _gone, ...dropped } = stored;
  r.set({ '.acc/floors.json': formatFloors(dropped) }, 'T-1: drop it');
  assert.match(r.gate(true, ['typecheck']).results[0]!.summary, /^\.acc\/floors\.json drops typecheck\.files \(120\), and no person relaxed it\./, 'an edge case: a floor dropped is lowered too');

  // A person puts it back, then relaxes it for T-1, saying why: the check runs again, and passes.
  r.set({ '.acc/floors.json': formatFloors(stored) }, 'T-1: put the floor back');
  relaxFloor(r.paths.relaxed, r.paths.floors, r.dir, r.c, { ratchet: 'typecheck.files', to: 100, reason: 'a page went', by: 'human:jordan', now, task: 'T-1' });
  commitAll(r.dir, 'T-1: relax the typecheck floor');
  assert.deepEqual(r.gate(true, ['typecheck']).results.map((x) => [x.gate, x.status]), [['typecheck', 'pass']]);
  assert.deepEqual(r.runs(), ['typecheck']);
  // Another task's branch isn't backed by T-1's relax (GH-130).
  gitIn(r.dir, 'checkout', '-q', '-b', 'task/T-9');
  assert.equal(r.gate(true, ['typecheck']).results[0]!.status, 'fail');
});

test('a relax is for one task: another task that began at the same floor can\'t lower it by hand, even naming the relaxed task (GH-130)', () => {
  const r = ratchetRepo();
  // A person relaxes tests from 669 to 640 for T-1, which commits it.
  relaxFloor(r.paths.relaxed, r.paths.floors, r.dir, r.c, { ratchet: 'tests', to: 640, reason: 'the slow suite moved to its own job', by: 'human:jordan', now, task: 'T-1' });
  r.set({ 'count.txt': '640\n' }, 'T-1: relax the tests floor');
  assert.equal(r.gate(true).results[1]!.summary, 'tests 640, at its floor.', 'T-1\'s own branch is backed');
  // T-9 also began on main at 669, and its builder lowers the floor by hand.
  gitIn(r.dir, 'checkout', '-q', '-b', 'task/T-9', 'main');
  r.set({ 'count.txt': '650\n', '.acc/floors.json': formatFloors({ tests: { floor: 650 } }) }, 'T-9: drop some tests, and lower the bar');
  const lowered = '.acc/floors.json lowers tests\'s floor to 650, from 669 on main, and no person relaxed it. Put it back to 669: only a person relaxes a floor, with acc gate relax.';
  assert.deepEqual([r.gate(true).results[1]!.status, r.gate(true).results[1]!.summary], ['fail', lowered]);
  assert.equal(r.gate(false, [], 'T-1').results[1]!.summary, lowered, 'naming T-1 on T-9\'s branch backs nothing: the record counts only on T-1\'s branch');
  assert.equal(r.gate(false, [], null).results[1]!.status, 'fail', 'nor with no task named');
  assert.equal(readRelaxed(r.paths.relaxed).length, 1, 'the record is kept for T-1');
});

test('a relax stops counting once its task is done or leaves the board, and acc prunes it (GH-130)', () => {
  const r = ratchetRepo();
  relaxFloor(r.paths.relaxed, r.paths.floors, r.dir, r.c, { ratchet: 'tests', to: 640, reason: 'the slow suite moved to its own job', by: 'human:jordan', now, task: 'T-1' });
  r.set({ 'count.txt': '640\n' }, 'T-1: relax the tests floor');
  assert.equal(r.gate(false).results[1]!.status, 'pass');
  const records = readRelaxed(r.paths.relaxed);
  // Later, main is at 669 again, and T-1's branch is checked once more after T-1 was done.
  r.tasks({ 'T-1': 'done' });
  assert.match(r.gate(false).results[1]!.summary, /^\.acc\/floors\.json lowers tests's floor to 640, from 669 on main, and no person relaxed it\./, 'done: it backs nothing');
  assert.deepEqual(relaxesFor(records, { ...emptyLedger(), tasks: [] }, 'T-1', 'task/T-1'), [], 'nor once T-1 has left the ledger');
  assert.equal(relaxesFor(records, { ...emptyLedger(), tasks: [r.task] }, 'T-1', 'task/T-1').length, 1, 'and while it\'s open, it does');

  // acc drops it, and the records of an open task, written whole, stay.
  const t9 = { ...records[0]!, task: 'T-9', to: 650 };
  const old = { ...records[0]!, task: undefined };
  writeFileSync(r.paths.relaxed, [records[0], t9, old].map((x) => `${JSON.stringify(x)}\n`).join(''));
  assert.equal(pruneRelaxed(r.paths.relaxed, { ...emptyLedger(), tasks: [{ ...r.task, state: 'done' }, { ...r.task, id: 'T-9' }] }), 2, 'T-1\'s, done, and one that names no task');
  assert.deepEqual(readRelaxed(r.paths.relaxed), [t9]);
  assert.equal(pruneRelaxed(r.paths.relaxed, { ...emptyLedger(), tasks: [{ ...r.task, id: 'T-9' }] }), 0, 'nothing more to drop');
  assert.deepEqual(readdirSync(r.paths.stateDir).filter((f) => f.endsWith('.tmp')), [], 'no temp file left');
});

test('a ratchet can\'t be waived: a person relaxes its floor instead (GH-99)', () => {
  const r = ratchetRepo();
  const sha = r.set({ 'count.txt': '660\n' });
  r.gate(true);
  assert.throws(
    () => waiveGates(r.paths, r.c, { sha, env: r.env, gates: ['tests'], reason: 'flaky', by: 'human:jordan', now }),
    (e: Error & { code?: string }) => e.code === 'refused' && e.message === 'tests is a ratchet: waived, its number could merge below its floor and fail every task after it. A person relaxes the floor instead: acc gate relax tests --to <n> --reason "<why>".',
  );
  assert.equal(readReceipt(r.paths, sha, 'tests')?.status, 'fail', 'its receipt is as it was');
});

test('listLines reads a path list as readList, promotion and deploy all read it; edge case: empty text, or only comments, gives none (T-70)', () => {
  assert.deepEqual(listLines('config/prod.json\n  # orgs differ\n\n  manifest/a.xml  \n#x\n'), ['config/prod.json', 'manifest/a.xml']);
  assert.deepEqual(listLines(''), []);
  assert.deepEqual(listLines('\n# only a comment\n'), []);
  const root = tempDir();
  writeFileSync(join(root, 'list.txt'), 'a\n# b\n c \n');
  assert.deepEqual(readList(root, 'list.txt'), ['a', 'c'], 'readList gives what listLines gives for the file');
});
