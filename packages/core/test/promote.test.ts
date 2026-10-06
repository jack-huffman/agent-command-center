import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig, type Config } from '../src/config.ts';
import { deploy, deployArgs, lastDeploy, planDeploy } from '../src/deploy.ts';
import { run, type RunOptions } from '../src/exec.ts';
import { planPromotion, promote, promotionBody, promotionCheckArgs, skippedOn } from '../src/promote.ts';
import { repoPaths } from '../src/paths.ts';
import { mutate, upsertTasks } from '../src/ledger.ts';
import { listUpdates } from '../src/updates.ts';
import { fakeRunner, gitIn, makeRepo, ok, SF_CONFIG, tempDir } from './support.ts';

const now = () => new Date('2026-10-02T12:00:00Z');
const config = (over: Record<string, unknown> = {}): Config => {
  const r = parseConfig({ ...SF_CONFIG, ...over });
  assert.deepEqual(r.errors, []);
  return r.config!;
};
const write = (dir: string, rel: string, text: string) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const commit = (dir: string, msg: string) => { gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-q', '-m', msg); };

/**
 * Three environment branches on a bare origin. dev has new work; uat has a fix of its own that a
 * promotion must not undo; each keeps its own environment-specific file.
 */
function repo() {
  const origin = tempDir('origin-');
  run('git', ['init', '-q', '--bare', origin]);
  const dir = makeRepo({
    'sfdx-project.json': JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }),
    'manifest/environment-specific.txt': 'force-app/main/default/namedCredentials/Api.namedCredential-meta.xml\n',
    'force-app/main/default/classes/A.cls': 'public class A {}\n',
    'force-app/main/default/classes/Old.cls': 'public class Old {}\n',
    'force-app/main/default/namedCredentials/Api.namedCredential-meta.xml': '<url>https://prod</url>\n',
    'README.md': 'readme\n',
  });
  gitIn(dir, 'branch', '-M', 'production');
  gitIn(dir, 'remote', 'add', 'origin', origin);
  for (const b of ['uat', 'dev']) gitIn(dir, 'branch', b);
  gitIn(dir, 'checkout', '-q', 'uat');
  write(dir, 'force-app/main/default/classes/Hotfix.cls', 'public class Hotfix {}\n');
  write(dir, 'force-app/main/default/namedCredentials/Api.namedCredential-meta.xml', '<url>https://uat</url>\n');
  commit(dir, 'uat: hotfix');
  gitIn(dir, 'checkout', '-q', 'dev');
  write(dir, 'force-app/main/default/classes/A.cls', 'public class A { void go() {} }\n');
  write(dir, 'force-app/main/default/classes/B.cls', 'public class B {}\n');
  rmSync(join(dir, 'force-app/main/default/classes/Old.cls'));
  write(dir, 'force-app/main/default/namedCredentials/Api.namedCredential-meta.xml', '<url>https://dev</url>\n');
  commit(dir, 'dev: new work');
  gitIn(dir, 'push', '-q', 'origin', 'production', 'uat', 'dev');
  return { dir, origin, paths: repoPaths(dir, run) };
}

const gh = (calls: string[]) => {
  const fake = fakeRunner({ 'gh auth token -u work-account': ok('gho\n'), 'gh pr create': ok('https://github.com/acme-co/acme-salesforce/pull/9\n') });
  return (cmd: string, args: string[], opts?: RunOptions) => { if (cmd !== 'git') calls.push([cmd, ...args].join(' ')); return fake(cmd, args, opts); };
};

test('a promotion takes what the source changed, leaves environment-specific files and the destination\'s own fixes alone, and names deletions', () => {
  const { paths } = repo();
  const p = planPromotion(paths, config(), 'dev', undefined, { run });
  assert.equal(p.to.branch, 'uat', 'the usual next step is the first in promotesTo');
  assert.deepEqual(p.files.sort(), ['force-app/main/default/classes/A.cls', 'force-app/main/default/classes/B.cls']);
  assert.deepEqual(p.deleted, ['force-app/main/default/classes/Old.cls']);
  assert.deepEqual(p.leftOut, ['force-app/main/default/namedCredentials/Api.namedCredential-meta.xml']);
  assert.deepEqual(p.skipped, []);
  assert.deepEqual(planPromotion(paths, config(), 'dev', 'production', { run }).skipped.map((e) => e.branch), ['uat'], 'going straight to production skips UAT');
  assert.throws(() => planPromotion(paths, config(), 'uat', 'dev', { run }), /can't promote to Dev/);
  assert.throws(() => planPromotion(paths, config(), 'production', undefined, { run }), /doesn't promote anywhere/);
});

test('promote refuses deletions until told, then opens a pull request from a branch cut from the destination', () => {
  const { dir, origin, paths } = repo();
  const c = config();
  assert.throws(() => promote(paths, c, 'dev', undefined, { run: gh([]), now, env: {} }, { validate: false }), /would delete 1 file.*--allow-deletions/);
  const calls: string[] = [];
  const r = promote(paths, c, 'dev', undefined, { run: gh(calls), now, env: {} }, { validate: false, allowDeletions: true });
  assert.deepEqual(r.pr, { number: 9, url: 'https://github.com/acme-co/acme-salesforce/pull/9' });
  assert.match(calls.find((x) => x.startsWith('gh pr create'))!, /--base uat --head promote\/dev-to-uat-20261002-1200 --title Promote Dev to UAT/);
  const at = (f: string) => run('git', ['show', `${r.branch}:${f}`], { cwd: origin });
  assert.match(at('force-app/main/default/classes/A.cls').stdout, /go\(\)/, 'the change came over');
  assert.equal(at('force-app/main/default/classes/Old.cls').code !== 0, true, 'the deletion came over');
  assert.equal(at('force-app/main/default/classes/Hotfix.cls').code, 0, 'UAT\'s own fix is kept');
  assert.match(at('force-app/main/default/namedCredentials/Api.namedCredential-meta.xml').stdout, /uat/, 'UAT keeps its own environment-specific file');
  assert.equal(gitIn(dir, 'worktree', 'list').trim().split('\n').length, 1, 'the promotion\'s worktree is gone');
  assert.ok(!calls.some((x) => /merge|deploy start/.test(x)), 'it never merges or deploys');
});

test('a promotion the destination already has opens nothing, and the body warns about what it skips and deletes', () => {
  const { dir, paths } = repo();
  // UAT gets dev's changes by hand: nothing is left to promote.
  gitIn(dir, 'checkout', '-q', 'uat');
  gitIn(dir, 'checkout', 'dev', '--', 'force-app/main/default/classes/A.cls', 'force-app/main/default/classes/B.cls');
  gitIn(dir, 'rm', '-q', 'force-app/main/default/classes/Old.cls');
  commit(dir, 'promoted');
  gitIn(dir, 'push', '-q', 'origin', 'uat');
  const r = promote(paths, config(), 'dev', undefined, { run: gh([]), now, env: {} }, { validate: false });
  assert.match(r.stopped!, /UAT already has everything from Dev/);
  const plan = planPromotion(paths, config(), 'dev', 'production', { run });
  const body = promotionBody(plan, null);
  assert.match(body, /Skips `uat` \(UAT\): this change hasn't been validated there\./);
  assert.match(body, /Deletes 1 file in `production`/);
  assert.match(body, /## Left out: environment-specific/);
});

test('the usual path\'s skipped environments: a chain of first choices up to the destination', () => {
  const c = config({ environments: [
    { name: 'Production', type: 'production', org: 'P' },
    { name: 'Staging', type: 'full', org: 'S', promotesTo: ['production'] },
    { name: 'QA', type: 'partial', org: 'Q', promotesTo: ['staging', 'production'] },
    { name: 'Dev', type: 'developer', org: 'D', default: true, promotesTo: ['qa', 'production'] },
  ] });
  const env = (b: string) => c.environments.find((e) => e.branch === b)!;
  assert.deepEqual(skippedOn(c, env('dev'), env('production')).map((e) => e.branch), ['qa', 'staging']);
  assert.deepEqual(skippedOn(c, env('qa'), env('production')).map((e) => e.branch), ['staging']);
  assert.deepEqual(skippedOn(c, env('dev'), env('qa')), []);
});

// ---------------------------------------------------------------- deploys

const sfOk = (calls: string[]) => {
  const fake = fakeRunner({ nice: ok(JSON.stringify({ status: 0, result: { id: '0Af1', success: true } })) });
  return (cmd: string, args: string[], opts?: RunOptions) => { if (cmd !== 'git') calls.push([cmd, ...args].join(' ')); return fake(cmd, args, opts); };
};

test('a deploy sends what changed on the branch since the last one, never an environment-specific file, and remembers where it got to', () => {
  const { dir, paths } = repo();
  const c = config();
  const slots = { dir: tempDir('slots-') };
  assert.throws(() => planDeploy(paths, c, 'dev', { run }), /hasn't been deployed by acc before.*--since/);
  const base = gitIn(dir, 'rev-parse', 'production').trim();
  // Deletions aren't deployed: the first deploy from production's commit has one, so it's refused.
  assert.throws(() => deploy(paths, c, 'dev', { run: sfOk([]), now, slots }, { since: base, by: 'human:jordan' }), /deleted on dev.*doesn't deploy deletions/);
  gitIn(dir, 'checkout', '-q', 'dev');
  write(dir, 'force-app/main/default/classes/C.cls', 'public class C {}\n');
  commit(dir, 'more');
  gitIn(dir, 'push', '-q', 'origin', 'dev');
  const since = gitIn(dir, 'rev-parse', 'HEAD~1').trim();
  const calls: string[] = [];
  const r = deploy(paths, c, 'dev', { run: sfOk(calls), now, slots }, { since, by: 'human:jordan' });
  assert.equal(r.deployed, true);
  assert.equal(r.plan.testLevel, 'RunLocalTests', 'Apex changed, so local tests run');
  assert.match(calls[0]!, /^nice -n 15 sf project deploy start --target-org Acme Dev .*--source-dir force-app\/main\/default\/classes\/C\.cls$/);
  assert.ok(!calls[0]!.includes('namedCredential') && !calls[0]!.includes('--dry-run'));
  assert.equal(lastDeploy(paths, 'dev')?.sha, gitIn(dir, 'rev-parse', 'HEAD').trim());
  assert.equal(deploy(paths, c, 'dev', { run: sfOk([]), now, slots }, { by: 'h' }).deployed, false, 'nothing new since the last deploy');
});

test('a deploy drafts an update for each task whose merged change it carried, and only those; a failed one drafts nothing (D-066)', () => {
  const { dir, paths } = repo();
  const c = config();
  const slots = { dir: tempDir('slots-') };
  gitIn(dir, 'checkout', '-q', 'dev');
  const since = gitIn(dir, 'rev-parse', 'HEAD').trim();
  write(dir, 'force-app/main/default/classes/C1.cls', 'public class C1 {}\n');
  commit(dir, 'ACME-1 (#1)');
  const first = gitIn(dir, 'rev-parse', 'HEAD').trim();
  write(dir, 'force-app/main/default/classes/C2.cls', 'public class C2 {}\n');
  commit(dir, 'ACME-2 (#2)');
  const second = gitIn(dir, 'rev-parse', 'HEAD').trim();
  gitIn(dir, 'push', '-q', 'origin', 'dev');
  // ACME-1 squash-merged (sync kept its merge commit); ACME-2 merged with its own commit, from before
  // acc kept merge commits; ACME-3 was in the last deploy; ACME-4 merged into another environment.
  const merged = (n: number, env: string, pr: Record<string, string>) => ({ number: n, url: `https://github.com/acme-co/acme-salesforce/pull/${n}`, state: 'merged' as const, ...pr, env });
  const done = [merged(1, 'dev', { mergeSha: first }), merged(2, 'dev', { sha: second }), merged(3, 'dev', { mergeSha: since }), merged(4, 'uat', { mergeSha: first })];
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, c, done.map((d) => ({ source: { kind: 'jira' as const, key: `ACME-${d.number}`, url: `https://acme.atlassian.net/browse/ACME-${d.number}` }, title: `Task ${d.number}`, environment: d.env })), 'human', 'human:test', emit, now);
    for (const d of done) {
      const t = l.tasks.find((x) => x.id === `ACME-${d.number}`)!;
      const { env: _env, ...pr } = d;
      Object.assign(t, { state: 'done', pr });
    }
  });
  const failing = fakeRunner({ nice: { code: 1, stderr: '', stdout: JSON.stringify({ status: 1, result: { id: '0Af3', success: false } }) } });
  const failed = deploy(paths, c, 'dev', { run: (cmd, args, opts) => (cmd === 'git' ? run(cmd, args, opts) : failing(cmd, args, opts)), now, slots }, { since, by: 'human:jordan' });
  assert.deepEqual([failed.deployed, failed.updates, listUpdates(paths)], [false, [], []], 'a failed deploy drafts nothing');

  const r = deploy(paths, c, 'dev', { run: sfOk([]), now, slots }, { since, by: 'human:jordan' });
  assert.equal(r.deployed, true);
  assert.deepEqual(r.updates, [{ task: 'ACME-1', id: 'ACME-1.1', key: 'ACME-1' }, { task: 'ACME-2', id: 'ACME-2.1', key: 'ACME-2' }]);
  assert.deepEqual(listUpdates(paths).map((u) => [u.task, u.event, u.env, u.state, u.by, u.text]), [
    ['ACME-1', 'deployed', 'Dev', 'draft', 'human:jordan', 'The change is now deployed to Dev.'],
    ['ACME-2', 'deployed', 'Dev', 'draft', 'human:jordan', 'The change is now deployed to Dev.'],
  ]);
  assert.deepEqual(deploy(paths, c, 'dev', { run: sfOk([]), now, slots }, { by: 'human:jordan' }).updates, [], 'deploying nothing drafts nothing');
  assert.equal(listUpdates(paths).length, 2);
});

test('a protected org needs a person\'s confirmation, and a failed deploy says which components failed', () => {
  const { dir, paths } = repo();
  const c = config();
  const slots = { dir: tempDir('slots-') };
  gitIn(dir, 'checkout', '-q', 'production');
  write(dir, 'force-app/main/default/classes/D.cls', 'public class D {}\n');
  commit(dir, 'prod change');
  gitIn(dir, 'push', '-q', 'origin', 'production');
  const since = gitIn(dir, 'rev-parse', 'HEAD~1').trim();
  assert.throws(() => deploy(paths, c, 'production', { run: sfOk([]), now, slots }, { since, by: 'h' }), /protected.*--confirm-production/);
  const failing = fakeRunner({ nice: { code: 1, stderr: '', stdout: JSON.stringify({ status: 1, result: { id: '0Af2', success: false, details: { componentFailures: { fullName: 'D', problem: 'Invalid type: Foo' } } } }) } });
  const r = deploy(paths, c, 'production', { run: (cmd, args, opts) => (cmd === 'git' ? run(cmd, args, opts) : failing(cmd, args, opts)), now, slots }, { since, confirmed: true, by: 'h' });
  assert.deepEqual([r.deployed, r.jobId], [false, '0Af2']);
  assert.match(r.summary, /D: Invalid type: Foo/);
  assert.equal(lastDeploy(paths, 'production'), null, 'a failed deploy isn\'t remembered as done');
  assert.ok(deployArgs(r.plan).includes('--test-level'));
  assert.throws(() => planDeploy(paths, c, 'production', { run }, { since, noTests: true }), /production: its deploys run the tests\. --no-tests is for sandboxes/);
});

test('a sandbox deploy can skip the tests when a person says so; production never can (D-056)', () => {
  const { dir, paths } = repo();
  const c = config();
  gitIn(dir, 'checkout', '-q', 'dev');
  write(dir, 'force-app/main/default/classes/E.cls', 'public class E {}\n');
  commit(dir, 'apex');
  gitIn(dir, 'push', '-q', 'origin', 'dev');
  const since = gitIn(dir, 'rev-parse', 'HEAD~1').trim();
  assert.equal(planDeploy(paths, c, 'dev', { run }, { since }).testLevel, 'RunLocalTests');
  const calls: string[] = [];
  const r = deploy(paths, c, 'dev', { run: sfOk(calls), now, slots: { dir: tempDir('slots-') } }, { since, noTests: true, by: 'human:jordan' });
  assert.equal(r.plan.testLevel, 'NoTestRun');
  assert.match(calls[0]!, /--test-level NoTestRun/);
});

test('a Salesforce promotion is checked against the destination\'s org first, protected or not, and stops if the check fails', () => {
  const { paths } = repo();
  const c = config();
  const calls: string[] = [];
  const failing = fakeRunner({ 'gh auth token -u work-account': ok('gho\n'), nice: { code: 1, stderr: '', stdout: JSON.stringify({ status: 1, result: { success: false, details: { componentFailures: { fullName: 'A', problem: 'Bad' } } } }) } });
  const r = promote(paths, c, 'dev', 'production', { run: (cmd, args, opts) => { if (cmd !== 'git') calls.push([cmd, ...args].join(' ')); return failing(cmd, args, opts); }, now, env: {}, slots: { dir: tempDir('slots-') } }, { allowDeletions: true });
  assert.equal(r.pr, null);
  assert.match(r.stopped!, /Validation against Production didn't pass/);
  assert.match(calls[0]!, /^nice -n 15 sf project deploy start --dry-run --target-org Acme Production .* --test-level RunLocalTests$/);
  assert.ok(!calls.some((x) => x.startsWith('gh pr create')), 'no pull request for a change that wouldn\'t deploy');
  assert.ok(promotionCheckArgs('X', ['force-app/main/default/lwc/a/a.js']).includes('NoTestRun'), 'no Apex, no tests');
});
