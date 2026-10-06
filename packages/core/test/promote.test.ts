import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { arrivedAt, carriedTasks } from '../src/carried.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { deploy, deployArgs, lastDeploy, planDeploy } from '../src/deploy.ts';
import { run, type RunOptions } from '../src/exec.ts';
import { planPromotion, promote, promotionBody, promotionCheckArgs, skippedOn } from '../src/promote.ts';
import { repoPaths } from '../src/paths.ts';
import { mutate, type Promotion, readLedger, upsertTasks } from '../src/ledger.ts';
import { sync } from '../src/sync.ts';
import { claimUpdate, draftUpdate, listUpdates, markPosted } from '../src/updates.ts';
import { bad, fakeRunner, gitIn, makeRepo, ok, SF_CONFIG, tempDir } from './support.ts';

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

// ---------------------------------------------------------------- what a promotion tells its tickets (D-???)

const PR9 = { number: 9, url: 'https://github.com/acme-co/acme-salesforce/pull/9' };

/** Done tasks as acc sync leaves them: merged into their environment at a commit, and maybe promoted on since. */
function seed(paths: ReturnType<typeof repoPaths>, c: Config, tasks: { id: string; env?: string; mergeSha: string; promotions?: Promotion[]; manual?: true }[]) {
  mutate(paths, now, (l, emit) => {
    const inputs = tasks.map((s) => ({ source: s.manual ? { kind: 'manual' as const, key: s.id } : { kind: 'jira' as const, key: s.id, url: `https://acme.atlassian.net/browse/${s.id}` }, title: `Task ${s.id}`, environment: s.env ?? 'dev' }));
    assert.deepEqual(upsertTasks(l, c, inputs, 'human', 'human:test', emit, now).errors, []);
    for (const s of tasks) {
      const n = Number(s.id.split('-')[1]);
      Object.assign(l.tasks.find((t) => t.id === s.id)!, { state: 'done', pr: { number: n, url: `https://github.com/acme-co/acme-salesforce/pull/${n}`, state: 'merged', mergeSha: s.mergeSha }, ...(s.promotions ? { promotions: s.promotions } : {}) });
    }
  });
}
const taskIn = (paths: ReturnType<typeof repoPaths>, id: string) => readLedger(paths.ledger).tasks.find((t) => t.id === id)!;
const opened: Promotion = { from: 'dev', to: 'uat', pr: PR9, state: 'open', at: now().toISOString() };
const ghView = (state: string, calls: string[], mergeSha = 'c0ffee'.padEnd(40, '0')) => fakeRunner({
  'gh auth token -u work-account': ok('gho\n'),
  'gh pr view 9': ok(JSON.stringify({ number: 9, state, url: PR9.url, mergeCommit: state === 'MERGED' ? { oid: mergeSha } : null })),
}, calls);

test('a promotion records each task whose change it carries and drafts its ticket\'s update; nothing is posted (D-???)', () => {
  const { dir, paths } = repo();
  const c = config();
  const head = () => gitIn(dir, 'rev-parse', 'HEAD');
  const before = head();
  const uat = gitIn(dir, 'rev-parse', 'uat');
  // On dev: ACME-1 and T-1 change classes the promotion brings, ACME-4 only an environment-specific file,
  // and ACME-6 was in a promotion that closed without merging.
  write(dir, 'force-app/main/default/classes/A.cls', 'public class A { void go() {} void again() {} }\n');
  commit(dir, 'ACME-1 (#1)');
  const one = head();
  write(dir, 'force-app/main/default/classes/B.cls', 'public class B { void b() {} }\n');
  commit(dir, 'T-1');
  const manual = head();
  write(dir, 'force-app/main/default/namedCredentials/Api.namedCredential-meta.xml', '<url>https://dev.example</url>\n');
  commit(dir, 'ACME-4 (#4)');
  const four = head();
  write(dir, 'force-app/main/default/classes/B.cls', 'public class B { void b() {} void c() {} }\n');
  commit(dir, 'ACME-6 (#6)');
  const six = head();
  gitIn(dir, 'push', '-q', 'origin', 'dev');
  // ACME-2 merged after the commit that's promoted.
  write(dir, 'force-app/main/default/classes/A.cls', 'public class A { void later() {} }\n');
  commit(dir, 'ACME-2 (#2)');
  const closed: Promotion = { ...opened, pr: { number: 7, url: 'https://github.com/acme-co/acme-salesforce/pull/7' }, state: 'closed' };
  seed(paths, c, [
    { id: 'ACME-1', mergeSha: one }, { id: 'ACME-2', mergeSha: head() },
    // ACME-3 reached UAT by an earlier promotion; ACME-5 was built on UAT.
    { id: 'ACME-3', mergeSha: before, promotions: [{ ...opened, pr: { number: 5, url: 'https://github.com/acme-co/acme-salesforce/pull/5' }, state: 'merged', mergeSha: uat }] },
    { id: 'ACME-4', mergeSha: four }, { id: 'ACME-5', env: 'uat', mergeSha: uat },
    { id: 'ACME-6', mergeSha: six, promotions: [closed] }, { id: 'T-1', manual: true, mergeSha: manual },
  ]);
  draftUpdate(paths, taskIn(paths, 'ACME-1'), { event: 'merged', env: 'Dev' }, 'acc sync', now);

  const calls: string[] = [];
  const r = promote(paths, c, 'dev', undefined, { run: gh(calls), now, env: {} }, { validate: false, allowDeletions: true, by: 'human:jordan' });
  assert.deepEqual(r.pr, PR9);
  assert.deepEqual([r.tasks, r.warning], [['ACME-1', 'ACME-6', 'T-1'], null], 'a task with no ticket is carried all the same');
  assert.deepEqual(r.updates, [{ task: 'ACME-1', id: 'ACME-1.2', key: 'ACME-1' }, { task: 'ACME-6', id: 'ACME-6.1', key: 'ACME-6' }]);
  const ready = 'The change is ready to go to UAT: https://github.com/acme-co/acme-salesforce/pull/9';
  assert.deepEqual(listUpdates(paths).map((u) => [u.id, u.event, u.env, u.pr, u.state, u.by, u.text]), [
    ['ACME-1.1', 'merged', 'Dev', undefined, 'draft', 'acc sync', 'The change was approved and merged into Dev.'],
    ['ACME-1.2', 'promotion-opened', 'UAT', PR9, 'draft', 'human:jordan', ready],
    ['ACME-6.1', 'promotion-opened', 'UAT', PR9, 'draft', 'human:jordan', ready],
  ], 'the merge into Dev is other news, so it stays');

  const promotions = (id: string) => taskIn(paths, id).promotions;
  assert.deepEqual([promotions('ACME-1'), promotions('T-1'), promotions('ACME-6')], [[opened], [opened], [closed, opened]]);
  assert.deepEqual(['ACME-2', 'ACME-4', 'ACME-5'].map(promotions), [undefined, undefined, undefined]);
  assert.equal(promotions('ACME-3')!.length, 1);
  const logged = JSON.parse(readFileSync(join(paths.stateDir, 'promotions.jsonl'), 'utf8').trim().split('\n').at(-1)!);
  assert.deepEqual([logged.pr, logged.tasks], [PR9, ['ACME-1', 'ACME-6', 'T-1']]);
  assert.deepEqual(calls.map((x) => x.split(' ').slice(0, 3).join(' ')), ['gh auth token', 'gh pr create'], 'nothing is posted on a ticket');
});

test('a promotion that stops before its pull request opens records and drafts nothing (D-???)', () => {
  const { dir, paths } = repo();
  const c = config();
  write(dir, 'force-app/main/default/classes/A.cls', 'public class A { void go() {} void again() {} }\n');
  commit(dir, 'ACME-1 (#1)');
  gitIn(dir, 'push', '-q', 'origin', 'dev');
  seed(paths, c, [{ id: 'ACME-1', mergeSha: gitIn(dir, 'rev-parse', 'HEAD') }]);
  const untouched = (why: string) => assert.deepEqual([listUpdates(paths), taskIn(paths, 'ACME-1').promotions], [[], undefined], why);

  const failing = fakeRunner({ 'gh auth token -u work-account': ok('gho\n'), nice: { code: 1, stderr: '', stdout: JSON.stringify({ status: 1, result: { success: false } }) } });
  const r = promote(paths, c, 'dev', undefined, { run: failing, now, env: {}, slots: { dir: tempDir('slots-') } }, { allowDeletions: true, by: 'human:jordan' });
  assert.deepEqual([r.pr, r.tasks, r.updates], [null, [], []]);
  untouched('validation didn\'t pass');

  const refused = fakeRunner({ 'gh auth token -u work-account': ok('gho\n'), 'gh pr create': bad('HTTP 422') });
  assert.throws(() => promote(paths, c, 'dev', undefined, { run: refused, now, env: {} }, { validate: false, allowDeletions: true, by: 'human:jordan' }), /couldn't open the pull request/);
  untouched('gh couldn\'t open the pull request');

  gitIn(dir, 'checkout', '-q', 'uat');
  gitIn(dir, 'checkout', 'dev', '--', 'force-app/main/default/classes/A.cls', 'force-app/main/default/classes/B.cls');
  gitIn(dir, 'rm', '-q', 'force-app/main/default/classes/Old.cls');
  commit(dir, 'promoted by hand');
  gitIn(dir, 'push', '-q', 'origin', 'uat');
  assert.match(promote(paths, c, 'dev', undefined, { run: gh([]), now, env: {} }, { validate: false, by: 'human:jordan' }).stopped!, /UAT already has everything/);
  untouched('nothing to promote');
});

test('acc sync follows an open promotion: once it merges, each ticket hears its change is in UAT, once; nothing is posted (D-???)', () => {
  const { dir, paths } = repo();
  const c = config();
  const dev = gitIn(dir, 'rev-parse', 'dev');
  const uat = gitIn(dir, 'rev-parse', 'uat');
  const merge = 'c0ffee'.padEnd(40, '0');
  // No task's own pull request is open, only the promotion. ACME-2 reached UAT by an earlier one.
  seed(paths, c, [
    { id: 'ACME-1', mergeSha: dev, promotions: [opened] },
    { id: 'ACME-2', mergeSha: dev, promotions: [{ ...opened, pr: { number: 5, url: 'https://github.com/acme-co/acme-salesforce/pull/5' }, state: 'merged', mergeSha: uat }, opened] },
    { id: 'T-1', manual: true, mergeSha: dev, promotions: [opened] },
  ]);
  draftUpdate(paths, taskIn(paths, 'ACME-1'), { event: 'merged', env: 'Dev' }, 'acc sync', now);
  draftUpdate(paths, taskIn(paths, 'ACME-1'), { event: 'promotion-opened', env: 'UAT', pr: PR9 }, 'human:jordan', now);
  const calls: string[] = [];
  assert.deepEqual(sync(paths, c, { run: ghView('OPEN', calls), now, env: {} }), { checked: 1, changes: [] }, 'still open: nothing changes');
  assert.equal(listUpdates(paths).length, 2);

  const r = sync(paths, c, { run: ghView('MERGED', calls, merge), now, env: {} });
  assert.equal(r.checked, 1);
  assert.deepEqual(r.changes.map((x) => [x.task, x.pr, x.moved, x.note, x.update]), [
    ['ACME-1', 9, null, 'promotion #9 merged into UAT', { id: 'ACME-1.3', key: 'ACME-1' }],
    ['ACME-2', 9, null, 'promotion #9 merged into UAT', undefined],
    ['T-1', 9, null, 'promotion #9 merged into UAT', undefined],
  ], 'ACME-2\'s ticket heard so with the first promotion, and T-1 has none');
  assert.deepEqual(taskIn(paths, 'ACME-1').promotions, [{ ...opened, state: 'merged', mergeSha: merge }]);
  assert.deepEqual([arrivedAt(taskIn(paths, 'ACME-1'), 'uat'), arrivedAt(taskIn(paths, 'ACME-2'), 'uat')], [merge, uat], 'where each change arrived, for a deploy to find');
  assert.deepEqual(listUpdates(paths).map((u) => [u.id, u.event, u.env, u.by, u.text, u.replaces]), [
    ['ACME-1.1', 'merged', 'Dev', 'acc sync', 'The change was approved and merged into Dev.', undefined],
    ['ACME-1.3', 'promoted', 'UAT', 'acc sync', 'The change is now in UAT.', ['ACME-1.2']],
  ], 'it stands in for the draft saying it was ready to go');

  assert.deepEqual(sync(paths, c, { run: ghView('MERGED', calls, merge), now, env: {} }), { checked: 0, changes: [] }, 'followed until it merged, and no further');
  assert.equal(listUpdates(paths).length, 2);
  assert.deepEqual([...new Set(calls.map((x) => x.split(' ').slice(0, 3).join(' ')))], ['gh auth token', 'gh pr view'], 'nothing is posted');
});

test('a promotion closed without merging sets its unposted drafts aside, and the next promotion carries its tasks again (D-???)', () => {
  const { dir, paths } = repo();
  const c = config();
  const dev = gitIn(dir, 'rev-parse', 'dev');
  seed(paths, c, [{ id: 'ACME-1', mergeSha: dev, promotions: [opened] }, { id: 'ACME-6', mergeSha: dev, promotions: [opened] }]);
  draftUpdate(paths, taskIn(paths, 'ACME-1'), { event: 'promotion-opened', env: 'UAT', pr: PR9 }, 'human:jordan', now);
  draftUpdate(paths, taskIn(paths, 'ACME-6'), { event: 'promotion-opened', env: 'UAT', pr: PR9 }, 'human:jordan', now);
  claimUpdate(paths, 'ACME-6.1', 'human:jordan', now);
  markPosted(paths, 'ACME-6.1', { by: 'human:jordan', text: 'Ready for UAT.' }, now);

  const calls: string[] = [];
  const r = sync(paths, c, { run: ghView('CLOSED', calls), now, env: {} });
  assert.deepEqual(r.changes.map((x) => [x.task, x.note, x.update]), [
    ['ACME-1', 'promotion #9 to UAT closed without merging; discarded its unposted update ACME-1.1', undefined],
    ['ACME-6', 'promotion #9 to UAT closed without merging', undefined],
  ]);
  assert.deepEqual(listUpdates(paths).map((u) => [u.id, u.state, u.discarded?.by]), [['ACME-1.1', 'discarded', 'acc sync'], ['ACME-6.1', 'posted', undefined]], 'kept and marked; a posted one is left as it is');
  assert.deepEqual(taskIn(paths, 'ACME-1').promotions!.map((p) => p.state), ['closed']);
  assert.equal(arrivedAt(taskIn(paths, 'ACME-1'), 'uat'), undefined);
  assert.deepEqual(carriedTasks(paths, run, planPromotion(paths, c, 'dev', undefined, { run })).map((t) => t.id), ['ACME-1', 'ACME-6'], 'the next promotion carries them again');
  assert.ok(!calls.some((x) => /^gh (issue|api)/.test(x)), 'nothing is posted');
});

test('promoted, merged, then deployed: a deploy to UAT tells each ticket whose change a merged promotion took there (D-???)', () => {
  const { dir, paths } = repo();
  const c = config();
  // ACME-1 also puts back the class dev's earlier work deleted, so UAT's deploy has no deletion to refuse.
  gitIn(dir, 'checkout', 'production', '--', 'force-app/main/default/classes/Old.cls');
  write(dir, 'force-app/main/default/classes/A.cls', 'public class A { void go() {} void again() {} }\n');
  commit(dir, 'ACME-1 (#1)');
  gitIn(dir, 'push', '-q', 'origin', 'dev');
  seed(paths, c, [{ id: 'ACME-1', mergeSha: gitIn(dir, 'rev-parse', 'HEAD') }]);
  const since = gitIn(dir, 'rev-parse', 'uat');

  const r = promote(paths, c, 'dev', undefined, { run: gh([]), now, env: {} }, { validate: false, by: 'human:jordan' });
  assert.deepEqual([r.plan.deleted, r.tasks, r.updates.map((u) => u.id)], [[], ['ACME-1'], ['ACME-1.1']]);
  // A person merges the promotion on GitHub.
  gitIn(dir, 'fetch', '-q', 'origin', r.branch!);
  gitIn(dir, 'checkout', '-q', 'uat');
  gitIn(dir, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #9', 'FETCH_HEAD');
  gitIn(dir, 'push', '-q', 'origin', 'uat');
  const merged = gitIn(dir, 'rev-parse', 'HEAD');
  assert.equal(sync(paths, c, { run: ghView('MERGED', [], merged), now, env: {} }).changes[0]!.update?.id, 'ACME-1.2');

  const d = deploy(paths, c, 'uat', { run: sfOk([]), now, slots: { dir: tempDir('slots-') } }, { since, by: 'human:jordan' });
  assert.equal(d.deployed, true);
  assert.deepEqual(d.updates, [{ task: 'ACME-1', id: 'ACME-1.3', key: 'ACME-1' }]);
  assert.deepEqual(listUpdates(paths).map((u) => [u.id, u.event, u.env, u.text, u.replaces]), [
    ['ACME-1.3', 'deployed', 'UAT', 'The change is now deployed to UAT.', ['ACME-1.2', 'ACME-1.1']],
  ], 'ready to go, then in UAT, then deployed there: one draft');
});
