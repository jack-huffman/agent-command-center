import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { parseConfig, type Config } from '../src/config.ts';
import { planDeploy } from '../src/deploy.ts';
import { askOrgFor } from '../src/deploy-gate.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { APEX } from '../src/gates.ts';
import { mutate, readLedger, type Task, upsertTasks } from '../src/ledger.ts';
import { manifestXml } from '../src/manifest.ts';
import { emptyOutside } from '../src/outside-changes.ts';
import { repoPaths } from '../src/paths.ts';
import type { RecordChange } from '../src/records.ts';
import { sfComponent } from '../src/sf-metadata.ts';
import * as real from '../src/task-deploy.ts';
import { confirmsOrg, deployTask, keptCheckPath, NOTHING_TO_CHECK, planTaskDeploy, readKeptCheck, TASK_DEPLOY_COMMAND, taskCheckArgs, taskDeployArgs, taskDeployBody, taskDeployEnabled, taskDeployRoute, ticketCommits, ticketPlace, yesProblem } from '../src/task-deploy.ts';
import { deployerSettings, deployGuideLaunch, deployGuidePrompt, keepTypedYes } from '../src/deploy-guide.ts';
import { keepPick, readPick } from '../src/deploy-pick.ts';
import { listUpdates } from '../src/updates.ts';
import { gitIn, makeRepo, ok, SF_CONFIG, tempDir } from './support.ts';

type Mod = typeof real;
const now = () => new Date('2026-10-28T12:00:00Z');
const D = 'force-app/main/default';
const SPECIFIC = `${D}/namedCredentials/Api.namedCredential-meta.xml`;
const rename: RecordChange = { object: 'Account', action: 'update', match: [{ field: 'Name', value: 'Acme Corp' }], fields: [{ field: 'Name', from: null, to: 'Acme Corporation' }] };
const config = (over: Record<string, unknown> = {}): Config => {
  const r = parseConfig({ ...SF_CONFIG, ...over });
  assert.deepEqual(r.errors, []);
  return r.config!;
};
const write = (dir: string, rel: string, text: string) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const commit = (dir: string, msg: string) => { gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-q', '-m', msg); return gitIn(dir, 'rev-parse', 'HEAD').trim(); };

/**
 * production, uat and dev on a bare origin. On dev, ACME-1 adds Invoice.cls, deletes Old.cls, changes the
 * environment-specific named credential and a note, with a record change; then ACME-2 changes Other.cls.
 * Both are merged (squash), so each has one commit of its own on dev.
 */
function repo() {
  const origin = tempDir('origin-');
  run('git', ['init', '-q', '--bare', origin]);
  const dir = makeRepo({
    'sfdx-project.json': JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '62.0' }),
    'manifest/environment-specific.txt': `${SPECIFIC}\n`,
    [`${D}/classes/Old.cls`]: 'public class Old {}\n',
    [`${D}/classes/Other.cls`]: 'public class Other {}\n',
    [SPECIFIC]: '<url>https://prod</url>\n',
    'NOTES.md': 'notes\n',
  });
  gitIn(dir, 'branch', '-M', 'production');
  gitIn(dir, 'remote', 'add', 'origin', origin);
  for (const b of ['uat', 'dev']) gitIn(dir, 'branch', b);
  gitIn(dir, 'checkout', '-q', 'dev');
  write(dir, `${D}/classes/Invoice.cls`, 'public class Invoice {}\n');
  rmSync(join(dir, `${D}/classes/Old.cls`));
  write(dir, SPECIFIC, '<url>https://dev</url>\n');
  write(dir, 'NOTES.md', 'notes, and ACME-1\n');
  const one = commit(dir, 'ACME-1 (#1)');
  write(dir, `${D}/classes/Other.cls`, 'public class Other { void more() {} }\n');
  const two = commit(dir, 'ACME-2 (#2)');
  gitIn(dir, 'push', '-q', 'origin', 'production', 'uat', 'dev');
  const paths = repoPaths(dir, run);
  const c = config();
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, c, [1, 2].map((n) => ({ source: { kind: 'jira' as const, key: `ACME-${n}`, url: `https://acme.atlassian.net/browse/ACME-${n}` }, title: `Task ${n}`, environment: 'dev' })), 'human', 'human:test', emit, now);
    for (const [n, sha] of [[1, one], [2, two]] as const) {
      Object.assign(l.tasks.find((t) => t.id === `ACME-${n}`)!, { state: 'done', pr: { number: n, url: `https://github.com/acme-co/acme-salesforce/pull/${n}`, state: 'merged', mergeSha: sha }, changes: { at: now().toISOString(), paths: n === 1 ? [`${D}/classes/Invoice.cls`] : [`${D}/classes/Other.cls`] } });
    }
    l.tasks.find((t) => t.id === 'ACME-1')!.outside = { ...emptyOutside(), changes: [{ id: 'c1', kind: 'record', detail: rename, why: 'The brand changed', planned: true, actor: 'builder', by: 'builder:ACME-1', at: now().toISOString() }] };
  });
  return { dir, origin, paths, c, one, two };
}

type Fake = { check?: 'pass' | 'fail'; deploy?: 'pass' | 'fail' | 'crash'; prodUrl?: boolean; merge?: boolean; listed?: string[]; prCreate?: boolean };

/** Salesforce's CLI and gh, faked; git is real. Each sf and gh call is kept. The merge moves origin's branch as GitHub would. */
function fake(origin: string, calls: string[], f: Fake = {}) {
  const sfSays = (o: unknown): RunResult => ok(JSON.stringify(o));
  let head = '';
  let base = '';
  return (cmd: string, args: string[], opts?: RunOptions): RunResult => {
    if (cmd === 'git') return run(cmd, args, opts);
    calls.push(`${cmd} ${args.join(' ')}`);
    const sub = args.slice(0, 3).join(' ');
    const flag = (name: string) => args.flatMap((a, i) => (a === name ? [args[i + 1]!] : []));
    if (cmd === 'sf') {
      if (sub === 'org display --target-org') return sfSays({ status: 0, result: { username: `${args[3]!.replace(/\s/g, '.')}@acme.test`, id: '00D1', instanceUrl: f.prodUrl ? 'https://acme.my.salesforce.com' : 'https://acme--uat.sandbox.my.salesforce.com' } });
      if (sub === 'project generate manifest') {
        const types = new Map<string, string[]>();
        for (const p of flag('--source-dir')) { const c = sfComponent(p)!; types.set(c.type, [...new Set([...(types.get(c.type) ?? []), c.name])]); }
        const file = join(flag('--output-dir')[0]!, 'package.xml');
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, manifestXml([...types].map(([name, members]) => ({ name, members })), '62.0'));
        return sfSays({ status: 0, result: { path: file } });
      }
      if (sub === 'org list metadata') return sfSays({ status: 0, result: (f.listed ?? ['Invoice']).map((fullName) => ({ fullName })) });
      const checking = args.includes('--dry-run');
      const outcome = checking ? f.check ?? 'pass' : f.deploy ?? 'pass';
      if (outcome === 'crash') throw new Error('sf stopped');
      if (outcome === 'fail') return { code: 1, stderr: '', stdout: JSON.stringify({ status: 1, result: { id: checking ? '0AfCHECK' : '0AfDEPLOY', success: false, details: { componentFailures: { fullName: 'Invoice', problem: 'Invalid type: Foo' } } } }) };
      return sfSays({ status: 0, result: { id: checking ? '0AfCHECK' : '0AfDEPLOY', success: true, numberComponentsTotal: 1, numberTestsCompleted: 3 } });
    }
    if (cmd === 'gh') {
      if (sub.startsWith('auth token')) return ok('gho\n');
      if (sub.startsWith('repo view')) return ok(JSON.stringify({ mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: false }));
      if (sub.startsWith('pr create') && f.prCreate === false) return { code: 1, stdout: '', stderr: 'a pull request for this branch already exists' };
      if (sub.startsWith('pr create')) { head = flag('--head')[0]!; base = flag('--base')[0]!; return ok('https://github.com/acme-co/acme-salesforce/pull/40\n'); }
      if (sub.startsWith('pr merge')) {
        if (f.merge === false) return { code: 1, stdout: '', stderr: 'base branch policy prohibits the merge' };
        // A fast-forward stands in for GitHub's merge: the base gets the branch's commit.
        run('git', ['update-ref', `refs/heads/${base}`, `refs/heads/${head}`], { cwd: origin });
        return ok('');
      }
      if (sub.startsWith('pr view')) return f.merge === false ? ok(JSON.stringify({ state: 'OPEN', mergeCommit: null })) : ok(JSON.stringify({ state: 'MERGED', mergeCommit: { oid: run('git', ['rev-parse', `refs/heads/${head}`], { cwd: origin }).stdout.trim() } }));
      if (sub.startsWith('pr close')) return ok('');
    }
    return { code: 127, stdout: '', stderr: `no fixture for ${cmd} ${args.join(' ')}` };
  };
}

const deps = (origin: string, calls: string[], f: Fake = {}) => ({ run: fake(origin, calls, f), now, env: {}, slots: { dir: tempDir('slots-') }, orgLocks: tempDir('orgs-') });
const by = 'human:jordan';
const realDeploys = (calls: string[]) => calls.filter((c) => /^sf project deploy (start|quick)/.test(c) && !c.includes('--dry-run'));
const taskIn = (paths: ReturnType<typeof repoPaths>, id: string): Task => readLedger(paths.ledger).tasks.find((t) => t.id === id)!;
const branchAt = (origin: string, b: string) => run('git', ['rev-parse', `refs/heads/${b}`], { cwd: origin }).stdout.trim();

// ---------------------------------------------------------------- scenarios, run on acc's module and on each mutant

/** Only ACME-1's components go: never ACME-2's Other.cls, merged on dev after it. Returns what's wrong, or nothing. */
function onlyItsComponents(m: Mod): string[] {
  const { origin, paths, c } = repo();
  const calls: string[] = [];
  const p = m.planTaskDeploy(paths, c, 'ACME-1', undefined, deps(origin, calls), { by });
  const wrong: string[] = [];
  if (p.files.join() !== `${D}/classes/Invoice.cls`) wrong.push(`deploys ${p.files.join(', ')}`);
  if (JSON.stringify(p.types) !== JSON.stringify([{ name: 'ApexClass', members: ['Invoice'] }])) wrong.push(`maps ${JSON.stringify(p.types)}`);
  if (calls.some((x) => x.includes('Other'))) wrong.push('sends Other.cls to Salesforce');
  return wrong;
}

/** With a passed check kept, a deploy with no yes is refused and nothing deploys. Returns what's wrong, or nothing. */
function noDeployWithoutYes(m: Mod): string[] {
  const { origin, paths, c } = repo();
  const calls: string[] = [];
  const d = deps(origin, calls);
  m.planTaskDeploy(paths, c, 'ACME-1', 'uat', d, { by });
  const wrong: string[] = [];
  try {
    m.deployTask(paths, c, 'ACME-1', 'uat', d, { by });
    wrong.push('it deployed without a yes');
  } catch (e) {
    if (!/needs the person's yes/.test((e as Error).message)) wrong.push(`it failed another way: ${(e as Error).message}`);
  }
  if (realDeploys(calls).length) wrong.push(`it ran ${realDeploys(calls).join('; ')}`);
  if (calls.some((x) => x.startsWith('gh '))) wrong.push('it touched GitHub');
  return wrong;
}

test('a ticket goes to any environment on its path after where it is now, the person\'s pick; any other is refused, with where it is and where it can go', () => {
  const c = config();
  const t = { id: 'ACME-1', environment: 'dev', promotions: [], deploys: [] } as Pick<Task, 'id' | 'environment' | 'promotions' | 'deploys'>;
  assert.deepEqual(ticketPlace(c, t)!.next.map((e) => e.branch), ['uat', 'production'], 'dev\'s promotesTo, the usual next step first');
  assert.equal(taskDeployRoute(c, t).to.branch, 'uat', 'with none named, the first next step');
  assert.equal(taskDeployRoute(c, t, 'Production').to.branch, 'production');
  assert.throws(() => taskDeployRoute(c, t, 'dev'), /ACME-1 is in Dev already\. It can go to UAT, Production\./);
  assert.throws(() => taskDeployRoute(c, t, 'staging'), /No environment "staging"/);
  // A chain, dev to uat to production: production is two steps on, and still the person's to pick (T-156).
  const chain = config({ environments: [{ name: 'Production', type: 'production', org: 'Acme Production' }, { name: 'UAT', type: 'full', org: 'Acme UAT', promotesTo: ['production'] }, { name: 'Dev', type: 'developer', org: 'Acme Dev', default: true, promotesTo: ['uat'] }] });
  assert.equal(taskDeployRoute(chain, t, 'production').to.branch, 'production', 'not only the next step');
  assert.equal(taskDeployRoute(chain, t).to.branch, 'uat', 'the usual next step when none is picked');
  const inUat = { ...t, deploys: [{ env: 'uat', org: 'Acme UAT', sha: 'a', at: '2026-10-28T10:00:00Z', jobId: 'j', paths: [], components: [], verified: 0, tests: null, checkId: '0Af1' }] };
  assert.equal(ticketPlace(c, inUat)!.at.branch, 'uat', 'a person\'s deploy moves it on');
  assert.throws(() => taskDeployRoute(c, inUat, 'dev'), /Dev isn't on ACME-1's path after UAT, where its change is: from there it can go to Production\. Pick one of those\./, 'the development environment is never a choice');
  const builderOnly = { ...t, deploys: [{ ...inUat.deploys[0]!, checkId: undefined }] };
  assert.equal(ticketPlace(c, builderOnly)!.at.branch, 'dev', 'edge case: a builder\'s own deploy to its org doesn\'t move it on');
  const inProd = { ...t, promotions: [{ from: 'uat', to: 'production', pr: { number: 1, url: 'u' }, state: 'merged' as const, mergeSha: 'b', mergedAt: '2026-10-28T11:00:00Z', at: '2026-10-28T11:00:00Z' }], deploys: inUat.deploys };
  assert.throws(() => taskDeployRoute(c, inProd), /ACME-1 is in Production, the end of its path/);
  assert.equal(ticketPlace(c, { ...t, environment: 'gone' }), null, 'edge case: an environment the settings don\'t have');
});

test('the command is off, with why, for a project that isn\'t Salesforce, has no GitHub, or a task with no work or a builder at work', () => {
  const c = config();
  const t = { id: 'ACME-1', state: 'done', environment: 'dev', promotions: [], deploys: [], pr: { state: 'merged' }, run: null } as unknown as Parameters<typeof taskDeployEnabled>[1];
  assert.deepEqual(TASK_DEPLOY_COMMAND.enabled({ config: c, task: t }), { ok: true });
  assert.equal(TASK_DEPLOY_COMMAND.id, 'acc.task.deploy');
  assert.match(TASK_DEPLOY_COMMAND.params, /check's id/);
  const off = (cfg: Parameters<typeof taskDeployEnabled>[0], task: Parameters<typeof taskDeployEnabled>[1]) => { const r = taskDeployEnabled(cfg, task); return r.ok ? '' : r.why; };
  assert.match(off({ ...c, profile: 'generic' }, t), /isn't a Salesforce project/);
  assert.match(off({ ...c, github: null }, t), /isn't on GitHub/);
  assert.match(off(c, undefined), /no such task/);
  assert.match(off(c, { ...t!, state: 'running' }), /builder is working on it now/);
  assert.match(off(c, { ...t!, pr: null }), /no work yet/);
});

test('the plan deploys exactly this ticket\'s components, leaves out and names environment-specific files, and lists deletions and record changes to make by hand', () => {
  assert.deepEqual(onlyItsComponents(real), []);
  const { origin, paths, c, dir } = repo();
  const calls: string[] = [];
  const p = planTaskDeploy(paths, c, 'ACME-1', undefined, deps(origin, calls), { by });
  assert.deepEqual([p.from.branch, p.to.branch, p.org], ['dev', 'uat', 'Acme UAT']);
  assert.deepEqual(p.leftOut, [SPECIFIC], 'environment-specific, left out (D-016)');
  assert.deepEqual(p.deletions, [{ path: `${D}/classes/Old.cls`, component: 'Apex Class: Old' }], 'a deletion is never deployed');
  assert.deepEqual(p.gitOnly, ['NOTES.md'], 'a file outside the source folders travels in git only');
  assert.deepEqual(p.records, ["Account 'Acme Corp': Name → 'Acme Corporation'"], 'its record change is a step at this deploy');
  assert.equal(p.testLevel, 'RunLocalTests', 'Apex is in it');
  assert.match(p.tests, /local tests/);
  assert.deepEqual(p.commits, [taskIn(paths, 'ACME-1').pr!.mergeSha]);
  assert.equal(p.confirm, false, 'UAT isn\'t protected');
  assert.ok(p.check?.passed && p.check.id === '0AfCHECK');
  const check = calls.find((x) => x.includes('--dry-run'))!;
  assert.match(check, /^sf project deploy start --dry-run --manifest .*package\.xml --target-org Acme UAT --wait 90 --json --test-level RunLocalTests$/);
  const body = taskDeployBody(p);
  assert.match(body, /## Left out: environment-specific/);
  assert.match(body, /## To delete by hand in the org\n\n- Apex Class: Old/);
  assert.match(body, /## Record changes to make by hand/);
  assert.ok(existsSync(dir));
});

test('a plan changes nothing: no deploy, nothing on GitHub, no branch moved, no worktree or branch left, the ledger as it was', () => {
  const { dir, origin, paths, c } = repo();
  const before = { uat: branchAt(origin, 'uat'), ledger: readFileSync(paths.ledger, 'utf8'), branches: gitIn(dir, 'branch', '--list') };
  const calls: string[] = [];
  planTaskDeploy(paths, c, 'ACME-1', 'uat', deps(origin, calls), { by });
  assert.deepEqual(realDeploys(calls), []);
  assert.ok(!calls.some((x) => x.startsWith('gh ')), 'nothing on GitHub');
  assert.equal(branchAt(origin, 'uat'), before.uat);
  assert.equal(run('git', ['branch', '--list', 'deploy/*'], { cwd: origin }).stdout.trim(), '', 'nothing pushed');
  assert.equal(readFileSync(paths.ledger, 'utf8'), before.ledger);
  assert.equal(gitIn(dir, 'branch', '--list'), before.branches, 'no local branch left');
  assert.equal(gitIn(dir, 'worktree', 'list').trim().split('\n').length, 1, 'no worktree left');
  assert.equal(readKeptCheck(paths, 'ACME-1')?.id, '0AfCHECK', 'the check is kept for the yes');
});

test('a failed check stops there with the org\'s errors per component, and its id can\'t be said yes to', () => {
  const { origin, paths, c } = repo();
  const calls: string[] = [];
  const d = deps(origin, calls, { check: 'fail' });
  const p = planTaskDeploy(paths, c, 'ACME-1', 'uat', d, { by });
  assert.equal(p.check!.passed, false);
  assert.deepEqual(p.check!.problems, ['Invoice: Invalid type: Foo']);
  assert.throws(() => deployTask(paths, c, 'ACME-1', 'uat', d, { by, checkId: '0AfCHECK' }), /didn't pass, so it can't deploy/);
  assert.deepEqual(realDeploys(calls), []);
});

test('no deploy without the person\'s yes, or with a yes to another check', () => {
  assert.deepEqual(noDeployWithoutYes(real), []);
  const { origin, paths, c } = repo();
  const calls: string[] = [];
  const d = deps(origin, calls);
  assert.throws(() => deployTask(paths, c, 'ACME-1', 'uat', d, { by, checkId: '0AfCHECK' }), /isn't ACME-1's latest check for UAT\. Make a plan first/, 'edge case: no plan yet');
  planTaskDeploy(paths, c, 'ACME-1', 'uat', d, { by });
  assert.throws(() => deployTask(paths, c, 'ACME-1', 'uat', d, { by, checkId: '0AfOTHER' }), /isn't ACME-1's latest check/);
  assert.deepEqual(realDeploys(calls), []);
});

test('a protected or production org needs its name typed; a wrong name is refused and nothing deploys', () => {
  const { origin, paths, c } = repo();
  const calls: string[] = [];
  const d = deps(origin, calls, { prodUrl: true });
  const p = planTaskDeploy(paths, c, 'ACME-1', 'production', d, { by });
  assert.deepEqual([p.confirm, p.confirmName], [true, 'Production']);
  assert.throws(() => deployTask(paths, c, 'ACME-1', 'production', d, { by, checkId: '0AfCHECK' }), /Production is production\. Type its name, Production, to deploy to it/);
  assert.throws(() => deployTask(paths, c, 'ACME-1', 'production', d, { by, checkId: '0AfCHECK', confirm: 'UAT' }), /Type its name/);
  assert.deepEqual(realDeploys(calls), []);
  assert.equal(deployTask(paths, c, 'ACME-1', 'production', d, { by, checkId: '0AfCHECK', confirm: 'Production' }).deployed, true);
  // Salesforce says it's a production org, though the settings call it a sandbox: the name is typed all the same.
  const { origin: o2, paths: p2 } = repo();
  const sandbox = config({ environments: [{ name: 'Production', type: 'production', org: 'Acme Production' }, { name: 'UAT', type: 'full', org: 'Acme UAT', promotesTo: ['production'] }, { name: 'Dev', type: 'developer', org: 'Acme Dev', default: true, promotesTo: ['uat'] }] });
  assert.equal(planTaskDeploy(p2, sandbox, 'ACME-1', 'uat', deps(o2, [], { prodUrl: true }), { by }).confirm, true);
  assert.throws(() => planTaskDeploy(p2, sandbox, 'ACME-1', 'uat', deps(o2, [], { prodUrl: true }), { by, noTests: true }), /production: its deploys run the tests/);
  assert.equal(confirmsOrg({ confirm: true, to: { name: 'UAT', org: 'Acme UAT' } as Config['environments'][number] }, ' Acme UAT '), true, 'the org\'s alias does too');
});

test('a yes is refused once the ticket\'s commits changed since its check, or what deploys moved under it', () => {
  const { dir, origin, paths, c } = repo();
  const calls: string[] = [];
  const d = deps(origin, calls);
  planTaskDeploy(paths, c, 'ACME-1', 'uat', d, { by });
  // ACME-1's change is squashed again, as a new commit with a new Invoice.cls.
  gitIn(dir, 'checkout', '-q', '-b', 'acme-1-again', `${taskIn(paths, 'ACME-1').pr!.mergeSha}`);
  write(dir, `${D}/classes/Invoice.cls`, 'public class Invoice { void v2() {} }\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '--amend', '-m', 'ACME-1 (#1), again');
  const again = gitIn(dir, 'rev-parse', 'HEAD').trim();
  mutate(paths, now, (l, emit) => { l.tasks.find((t) => t.id === 'ACME-1')!.pr!.mergeSha = again; emit({ type: 'task.updated', task: 'ACME-1', actor: 'human', by: 'human:test', data: {} }); });
  assert.throws(() => deployTask(paths, c, 'ACME-1', 'uat', d, { by, checkId: '0AfCHECK' }), /commits changed since its check/);
  const kept = readKeptCheck(paths, 'ACME-1')!;
  const plan = { task: 'ACME-1', to: c.environments.find((e) => e.branch === 'uat')!, commits: kept.commits };
  assert.match(yesProblem(kept, plan, { [`${D}/classes/Invoice.cls`]: 'other-blob' }, '0AfCHECK')!, /changed since ACME-1's check/);
  assert.equal(yesProblem(kept, plan, kept.blobs, '0AfCHECK'), null);
  assert.deepEqual(realDeploys(calls), []);
});

test('a cherry-pick that conflicts stops before anything deploys, names the files and the other ticket, and leaves nothing behind', () => {
  const { dir, origin, paths, c } = repo();
  // UAT has its own Invoice.cls from ACME-3, not merged on dev's path to UAT yet.
  gitIn(dir, 'checkout', '-q', 'uat');
  write(dir, `${D}/classes/Invoice.cls`, 'public class Invoice { /* uat */ }\n');
  commit(dir, 'uat: its own Invoice');
  gitIn(dir, 'push', '-q', 'origin', 'uat');
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, c, [{ source: { kind: 'manual', key: 'ACME-3' }, title: 'Task 3', environment: 'dev' }], 'human', 'human:test', emit, now);
    l.tasks.find((t) => t.id === 'ACME-3')!.changes = { at: now().toISOString(), paths: [`${D}/classes/Invoice.cls`] };
  });
  const before = branchAt(origin, 'uat');
  const calls: string[] = [];
  assert.throws(() => planTaskDeploy(paths, c, 'ACME-1', 'uat', deps(origin, calls), { by }), /doesn't go onto uat cleanly: force-app\/main\/default\/classes\/Invoice\.cls \(also changed by ACME-3, not in UAT yet\)\. Nothing was deployed or pushed/);
  assert.ok(!calls.some((x) => x.startsWith('sf project deploy') || x.startsWith('gh ')), 'no check, no deploy, nothing on GitHub');
  assert.equal(branchAt(origin, 'uat'), before);
  assert.equal(gitIn(dir, 'worktree', 'list').trim().split('\n').length, 1, 'no worktree left');
  assert.equal(gitIn(dir, 'branch', '--list', 'deploy/*').trim(), '', 'no branch left');
});

test('a ticket that depends on another not yet in the destination is refused with that ticket\'s name', () => {
  const { origin, paths, c } = repo();
  mutate(paths, now, (l, emit) => { l.tasks.find((t) => t.id === 'ACME-1')!.deps = ['ACME-2']; emit({ type: 'task.updated', task: 'ACME-1', actor: 'human', by: 'human:test', data: {} }); });
  const calls: string[] = [];
  assert.throws(() => planTaskDeploy(paths, c, 'ACME-1', 'uat', deps(origin, calls), { by }), /ACME-1 depends on ACME-2, which isn't in UAT yet\. Deploy ACME-2 to UAT first/);
  assert.deepEqual(calls, [], 'refused before it asks Salesforce anything');
});

test('the deploy quick-deploys the checked job, merges its pull request, records it on the task, and a later deploy of the branch doesn\'t send it again', () => {
  const { origin, paths, c } = repo();
  const calls: string[] = [];
  const d = deps(origin, calls);
  const uatBefore = branchAt(origin, 'uat');
  planTaskDeploy(paths, c, 'ACME-1', 'uat', d, { by });
  const r = deployTask(paths, c, 'ACME-1', 'uat', d, { by, checkId: '0AfCHECK' });
  assert.equal(r.deployed, true, r.summary);
  assert.deepEqual(realDeploys(calls), ['sf project deploy quick --job-id 0AfCHECK --target-org Acme UAT --wait 90 --json'], 'exactly the checked job');
  assert.match(calls.find((x) => x.startsWith('gh pr create'))!, /--base uat --head deploy\/ACME-1-to-uat-20261028-1200 --title ACME-1: deploy to UAT/);
  assert.ok(calls.findIndex((x) => x.startsWith('gh pr create')) < calls.findIndex((x) => x.startsWith('sf project deploy quick')), 'the pull request opens before anything deploys');
  assert.match(calls.find((x) => x.startsWith('gh pr merge'))!, /^gh pr merge 40 -R acme-co\/acme-salesforce --squash --match-head-commit [0-9a-f]{40}$/);
  assert.equal(r.merged, true);
  // The branch has ACME-1 alone: not ACME-2's Other.cls, and UAT keeps its own named credential.
  const at = (f: string) => run('git', ['show', `refs/heads/uat:${f}`], { cwd: origin });
  assert.equal(at(`${D}/classes/Invoice.cls`).code, 0);
  assert.equal(at(`${D}/classes/Other.cls`).stdout, 'public class Other {}\n');
  assert.equal(at(SPECIFIC).stdout, '<url>https://prod</url>\n');
  const t = taskIn(paths, 'ACME-1');
  const rec = t.deploys!.at(-1)!;
  assert.deepEqual([rec.env, rec.org, rec.checkId, rec.by, rec.pr?.number, rec.jobId, rec.components, rec.paths], ['uat', 'Acme UAT', '0AfCHECK', by, 40, '0AfDEPLOY', ['Apex Class: Invoice'], [`${D}/classes/Invoice.cls`]]);
  assert.equal(rec.verified, 1, 'the org was asked for Invoice, and lists it');
  assert.ok(calls.findIndex((x) => x.startsWith('sf org list metadata --metadata-type ApexClass --target-org Acme UAT')) > calls.findIndex((x) => x.startsWith('sf project deploy quick')), 'asked after the deploy');
  assert.equal(t.promotions!.at(-1)!.state, 'merged');
  assert.equal(ticketPlace(c, t)!.at.branch, 'uat', 'where it is now, for the page');
  assert.deepEqual(ticketPlace(c, t)!.next.map((e) => e.branch), ['production'], 'its next step');
  // Its record change, and since T-138 the class it deletes, are each a step in UAT.
  assert.deepEqual(t.outside!.steps.map((s) => [s.env, s.state]), [['uat', 'todo'], ['uat', 'todo']], 'its record change and its deletion are steps in UAT');
  assert.deepEqual(t.outside!.changes.filter((x) => x.kind === 'deletion').map((x) => (x.detail as { component: string }).component), ['Apex Class: Old'], 'the deletion is kept as the person\'s, to mark in each org');
  assert.deepEqual(listUpdates(paths).map((u) => [u.task, u.event, u.env, u.state]), [['ACME-1', 'deployed', 'UAT', 'draft']], 'a ticket update is drafted, not posted');
  assert.equal(readKeptCheck(paths, 'ACME-1'), null, 'the check is used up');
  assert.ok(!existsSync(keptCheckPath(paths, 'ACME-1')));
  // acc deploy uat later: Invoice.cls is already in the org by ACME-1's own deploy (D-206).
  const later = planDeploy(paths, c, 'uat', { run }, { since: uatBefore });
  assert.deepEqual(later.files, []);
  assert.deepEqual(later.deployedBy, [{ path: `${D}/classes/Invoice.cls`, task: 'ACME-1' }]);
  assert.deepEqual(later.deleted, [`${D}/classes/Old.cls`], 'its deletion stays a person\'s, there too');
});

test('a failed deploy closes its pull request and records nothing; a merge that fails leaves the deploy recorded and says so', () => {
  const { origin, paths, c } = repo();
  const calls: string[] = [];
  const d = deps(origin, calls, { deploy: 'fail' });
  planTaskDeploy(paths, c, 'ACME-1', 'uat', d, { by });
  const r = deployTask(paths, c, 'ACME-1', 'uat', d, { by, checkId: '0AfCHECK' });
  assert.equal(r.deployed, false);
  assert.match(r.summary, /failed: .*Invoice: Invalid type: Foo.* Its pull request was closed/);
  assert.ok(calls.some((x) => x.startsWith('gh pr close 40')));
  assert.ok(!calls.some((x) => x.startsWith('gh pr merge')));
  assert.equal(taskIn(paths, 'ACME-1').deploys, undefined);
  assert.deepEqual(listUpdates(paths), []);

  const second = repo();
  const d2 = deps(second.origin, [], { merge: false });
  planTaskDeploy(second.paths, c, 'ACME-1', 'uat', d2, { by });
  const r2 = deployTask(second.paths, c, 'ACME-1', 'uat', d2, { by, checkId: '0AfCHECK' });
  assert.deepEqual([r2.deployed, r2.merged], [true, false]);
  assert.match(r2.warning!, /It's in Acme UAT\. Pull request #40 didn't merge .*acc sync follows it/);
  assert.equal(taskIn(second.paths, 'ACME-1').promotions!.at(-1)!.state, 'open', 'acc sync follows the open pull request');
});

test('edge case: a component the org doesn\'t list after the deploy is said, and isn\'t counted as verified', () => {
  const { origin, paths, c } = repo();
  const d = deps(origin, [], { listed: ['Other'] });
  planTaskDeploy(paths, c, 'ACME-1', 'uat', d, { by });
  const r = deployTask(paths, c, 'ACME-1', 'uat', d, { by, checkId: '0AfCHECK' });
  assert.equal(r.deployed, true);
  assert.match(r.warning!, /It's in Acme UAT\. Acme UAT doesn't list Apex Class: Invoice: check the org/);
  assert.equal(taskIn(paths, 'ACME-1').deploys!.at(-1)!.verified, 0);
  const asked = askOrgFor(() => ok(JSON.stringify({ status: 0, result: [{ fullName: 'Invoice' }] })), 'Acme UAT', [`${D}/classes/Invoice.cls`, 'README.md']);
  assert.deepEqual([asked.verified, asked.missing, asked.components], [1, [], ['Apex Class: Invoice', 'README.md']]);
});

test('edge case: a ticket with nothing for the org still opens its pull request with the person\'s yes, merges it, and moves on', () => {
  const { dir, origin, paths, c } = repo();
  write(dir, 'docs/guide.md', 'how ACME-3 works\n');
  const sha = commit(dir, 'ACME-3 (#3)');
  gitIn(dir, 'push', '-q', 'origin', 'dev');
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, c, [{ source: { kind: 'jira' as const, key: 'ACME-3', url: 'https://acme.atlassian.net/browse/ACME-3' }, title: 'Task 3', environment: 'dev' }], 'human', 'human:test', emit, now);
    Object.assign(l.tasks.find((t) => t.id === 'ACME-3')!, { state: 'done', pr: { number: 3, url: 'https://github.com/acme-co/acme-salesforce/pull/3', state: 'merged', mergeSha: sha } });
  });
  const calls: string[] = [];
  const d = deps(origin, calls);
  const p = planTaskDeploy(paths, c, 'ACME-3', 'uat', d, { by });
  assert.deepEqual([p.files, p.gitOnly, p.check?.passed], [[], ['docs/guide.md'], true]);
  assert.ok(p.check!.id!.startsWith(NOTHING_TO_CHECK), 'its yes is for its commits, not an org check');
  assert.ok(!calls.some((x) => x.startsWith('sf project deploy')), 'the org isn\'t asked');
  assert.throws(() => deployTask(paths, c, 'ACME-3', 'uat', d, { by }), /needs the person's yes/, 'still not without the person\'s yes');
  const r = deployTask(paths, c, 'ACME-3', 'uat', d, { by, checkId: p.check!.id! });
  assert.deepEqual([r.deployed, r.merged, r.pr?.number], [false, true, 40]);
  assert.match(r.summary, /Nothing of ACME-3 deploys to Acme UAT, so nothing was sent there\. Pull request #40 merged into uat\./);
  assert.equal(realDeploys(calls).length, 0);
  assert.equal(run('git', ['show', 'refs/heads/uat:docs/guide.md'], { cwd: origin }).code, 0, 'uat\'s branch has it');
  const t = taskIn(paths, 'ACME-3');
  assert.equal(t.deploys, undefined, 'no deploy to an org is recorded');
  assert.equal(t.promotions!.at(-1)!.state, 'merged');
  assert.equal(ticketPlace(c, t)!.at.branch, 'uat', 'it moved on');
});

test('a failure once the branch is pushed takes back its pull request and the branch: a crash in the deploy, and a pull request that won\'t open', () => {
  const { origin, paths, c } = repo();
  const calls: string[] = [];
  const d = deps(origin, calls, { deploy: 'crash' });
  planTaskDeploy(paths, c, 'ACME-1', 'uat', d, { by });
  assert.throws(() => deployTask(paths, c, 'ACME-1', 'uat', d, { by, checkId: '0AfCHECK' }), /sf stopped/);
  assert.ok(calls.some((x) => x.startsWith('gh pr close 40 -R acme-co/acme-salesforce --delete-branch')), 'its pull request is closed, with its branch');
  assert.equal(taskIn(paths, 'ACME-1').deploys, undefined);

  const second = repo();
  const calls2: string[] = [];
  const d2 = deps(second.origin, calls2, { prCreate: false });
  planTaskDeploy(second.paths, c, 'ACME-1', 'uat', d2, { by });
  assert.throws(() => deployTask(second.paths, c, 'ACME-1', 'uat', d2, { by, checkId: '0AfCHECK' }), /gh couldn't open the pull request: a pull request for this branch already exists\. Nothing was deployed/);
  assert.equal(run('git', ['branch', '--list', 'deploy/*'], { cwd: second.origin }).stdout.trim(), '', 'the pushed branch is gone');
  assert.equal(realDeploys(calls2).length, 0);
});

test('a sandbox check without Apex runs no tests and deploys the same manifest rather than a quick deploy', () => {
  const args = taskDeployArgs('Acme UAT', '/x/package.xml', { id: '0Af1', testLevel: 'NoTestRun' });
  assert.deepEqual(args, ['project', 'deploy', 'start', '--manifest', '/x/package.xml', '--target-org', 'Acme UAT', '--wait', '90', '--json', '--test-level', 'NoTestRun']);
  assert.ok(taskCheckArgs('Acme UAT', '/x/package.xml', 'NoTestRun').includes('--dry-run'));
  // Which files are Apex, and so run the org's tests: the one shared test, promote's and validate's too.
  assert.deepEqual([`${D}/classes/A.cls`, `${D}/triggers/T.trigger-meta.xml`, `${D}/flows/F.flow-meta.xml`].map((f) => APEX.test(f)), [true, true, false]);
});

test('a ticket that isn\'t merged yet goes by its branch\'s own commits, never the merges that took others\' work in', () => {
  const { dir, paths } = repo();
  gitIn(dir, 'checkout', '-q', '-b', 'task/ACME-9', 'dev');
  write(dir, `${D}/classes/Nine.cls`, 'public class Nine {}\n');
  const own = commit(dir, 'ACME-9: Nine');
  // dev moves on, and the branch takes that in, as a refresh does.
  gitIn(dir, 'checkout', '-q', 'dev');
  write(dir, 'README.md', 'other work\n');
  commit(dir, 'ACME-5 (#5)');
  gitIn(dir, 'push', '-q', 'origin', 'dev');
  gitIn(dir, 'checkout', '-q', 'task/ACME-9');
  gitIn(dir, 'merge', '-q', '--no-edit', 'dev');
  const t = { id: 'ACME-9', environment: 'dev', pr: null, run: { branch: 'task/ACME-9' } } as unknown as Task;
  assert.deepEqual(ticketCommits(run, paths.root, t), [{ sha: own }]);
  assert.throws(() => ticketCommits(run, paths.root, { ...t, run: { branch: 'task/none' } } as unknown as Task), /has no commits here yet/);
});

// ---------------------------------------------------------------- mutants: the checks above catch them

/** task-deploy.ts with one change, imported from a folder of its own; its imports still reach acc's modules. */
async function mutant(from: string, to: string): Promise<Mod> {
  const src = new URL('../src/task-deploy.ts', import.meta.url);
  const text = readFileSync(src, 'utf8');
  assert.ok(text.includes(from), `the mutant's line is still in task-deploy.ts: ${from}`);
  const changed = text.replace(from, to).replace(/from '\.\/([\w-]+\.ts)'/g, (_, f: string) => `from '${new URL(`../src/${f}`, import.meta.url).href}'`);
  const file = join(tempDir('mutant-'), 'task-deploy.ts');
  writeFileSync(file, changed);
  return await import(pathToFileURL(file).href) as Mod;
}

test('a mutant that deploys without the person\'s yes is caught', async () => {
  const m = await mutant('      if (why) throw new AccError(\'refused\', why);\n', '');
  assert.notDeepEqual(noDeployWithoutYes(m), [], 'the mutant deployed, and the check saw it');
});

/** A guide's deploy with a passed check and no pick is refused, and nothing deploys. Returns what's wrong, or nothing. */
function noGuidedDeployWithoutPick(m: Mod): string[] {
  const { origin, paths, c } = repo();
  const calls: string[] = [];
  const d = deps(origin, calls);
  m.planTaskDeploy(paths, c, 'ACME-1', 'uat', d, { by });
  const wrong: string[] = [];
  try {
    m.deployTask(paths, c, 'ACME-1', 'uat', d, { by, checkId: '0AfCHECK', guided: true });
    wrong.push('the guide deployed without a pick');
  } catch (e) {
    if (!/No one picked where ACME-1 goes/.test((e as Error).message)) wrong.push(`it failed another way: ${(e as Error).message}`);
  }
  if (realDeploys(calls).length) wrong.push(`it ran ${realDeploys(calls).join('; ')}`);
  if (calls.some((x) => x.startsWith('gh '))) wrong.push('it touched GitHub');
  return wrong;
}

/** A guide's deploy to production on a fresh pick, with no name typed, is refused. Returns what's wrong, or nothing. */
function noGuidedProductionWithoutName(m: Mod): string[] {
  const { origin, paths, c } = repo();
  const calls: string[] = [];
  const d = deps(origin, calls, { prodUrl: true });
  m.planTaskDeploy(paths, c, 'ACME-1', 'production', d, { by });
  keepPick(paths, 'ACME-1', 'production', by, now);
  const wrong: string[] = [];
  try {
    m.deployTask(paths, c, 'ACME-1', 'production', d, { by, checkId: '0AfCHECK', guided: true });
    wrong.push('the guide deployed to production on the pick alone');
  } catch (e) {
    if (!/hasn't typed a yes for ACME-1/.test((e as Error).message)) wrong.push(`it failed another way: ${(e as Error).message}`);
  }
  if (realDeploys(calls).length) wrong.push(`it ran ${realDeploys(calls).join('; ')}`);
  return wrong;
}

test('a mutant that lets the guide deploy without the person\'s pick is caught (T-156)', async () => {
  assert.deepEqual(noGuidedDeployWithoutPick(real), []);
  const m = await mutant('if (opts.guided) { takeGuidedYes(paths, id, plan, kept, now, (branch) => environmentByBranch(config, branch)?.name ?? branch); return; }', 'if (opts.guided) return;');
  assert.notDeepEqual(noGuidedDeployWithoutPick(m), [], 'the mutant deployed, and the check saw it');
});

test('a mutant that deploys to production on the pick alone, without the typed name, is caught (T-156)', async () => {
  assert.deepEqual(noGuidedProductionWithoutName(real), []);
  const m = await mutant('confirm: production || to.protected, confirmName', 'confirm: false, confirmName');
  assert.notDeepEqual(noGuidedProductionWithoutName(m), [], 'the mutant deployed, and the check saw it');
});

test('a mutant that deploys another ticket\'s component is caught', async () => {
  const m = await mutant('\'-z\', base, \'HEAD\')', '\'-z\', base, `origin/${task.environment}`)');
  assert.notDeepEqual(onlyItsComponents(m), [], 'the mutant sent ACME-2\'s Other.cls, and the check saw it');
});

test('a deploy guide deploys to the sandbox the person picked on that pick alone, used once, and nowhere else (T-154, T-156)', () => {
  const { origin, paths, c } = repo();
  const calls: string[] = [];
  const d = deps(origin, calls);
  planTaskDeploy(paths, c, 'ACME-1', 'uat', d, { by });
  assert.throws(() => deployTask(paths, c, 'ACME-1', 'uat', d, { by, checkId: '0AfCHECK', confirm: 'UAT', guided: true }), /No one picked where ACME-1 goes/, 'what the guide passes as the name is never the yes');
  keepPick(paths, 'ACME-1', 'production', by, now);
  keepTypedYes(paths, 'ACME-1', 'UAT', null, now);
  assert.throws(() => deployTask(paths, c, 'ACME-1', 'uat', d, { by, checkId: '0AfCHECK', guided: true }), /The person picked Production for ACME-1, not UAT\. The deploy guide deploys only where the person picked/, 'security review: an environment the person didn\'t pick, even with its name typed');
  assert.deepEqual(realDeploys(calls), []);
  keepPick(paths, 'ACME-1', 'uat', by, now);
  const r = deployTask(paths, c, 'ACME-1', 'uat', d, { by, checkId: '0AfCHECK', guided: true });
  assert.equal(r.deployed, true, 'the pick is the yes: no name typed');
  assert.equal(realDeploys(calls).length, 1);
  assert.ok(readPick(paths, 'ACME-1')!.used, 'used once');
  assert.equal(taskIn(paths, 'ACME-1').deploys!.at(-1)!.by, by);
});

test('a deploy guide\'s yes for production, or a protected org, is the name the person typed: the pick alone deploys nothing there', () => {
  const { origin, paths, c } = repo();
  const calls: string[] = [];
  const d = deps(origin, calls, { prodUrl: true });
  planTaskDeploy(paths, c, 'ACME-1', 'production', d, { by });
  keepPick(paths, 'ACME-1', 'production', by, now);
  assert.throws(() => deployTask(paths, c, 'ACME-1', 'production', d, { by, checkId: '0AfCHECK', guided: true }), /The person hasn't typed a yes for ACME-1 in this chat/, 'a fresh pick is no yes for production');
  keepTypedYes(paths, 'ACME-1', 'yes', null, now);
  assert.throws(() => deployTask(paths, c, 'ACME-1', 'production', d, { by, checkId: '0AfCHECK', guided: true }), /The person typed "yes", not Production\. Ask them to type Production in the chat/, 'yes is not the name');
  assert.deepEqual(realDeploys(calls), []);
  keepTypedYes(paths, 'ACME-1', 'Production', null, now);
  assert.equal(deployTask(paths, c, 'ACME-1', 'production', d, { by, checkId: '0AfCHECK', guided: true }).deployed, true);
  assert.equal(typeof readPick(paths, 'ACME-1')!.used, 'string', 'the pick fixed where, and is used up with the deploy');
  // A protected sandbox, by the settings: the same.
  const guarded = repo();
  const gc = config({ environments: [{ name: 'Production', type: 'production', org: 'Acme Production' }, { name: 'UAT', type: 'full', org: 'Acme UAT', protected: true, promotesTo: ['production'] }, { name: 'Dev', type: 'developer', org: 'Acme Dev', default: true, promotesTo: ['uat', 'production'] }] });
  const gd = deps(guarded.origin, []);
  planTaskDeploy(guarded.paths, gc, 'ACME-1', 'uat', gd, { by });
  keepPick(guarded.paths, 'ACME-1', 'uat', by, now);
  assert.throws(() => deployTask(guarded.paths, gc, 'ACME-1', 'uat', gd, { by, checkId: '0AfCHECK', guided: true }), /hasn't typed a yes/, 'edge case: a protected sandbox keeps the typed yes');
});

test('Deploy with an agent opens the guide\'s chat in the main checkout, as the deployer of its ticket, for where it goes next (T-154)', () => {
  const { paths, c } = repo();
  const l = deployGuideLaunch(paths, c, 'ACME-1', undefined, () => 'sess-1');
  assert.equal(l.cwd, paths.root);
  assert.deepEqual(l.env, { ACC_ROLE: 'deployer', ACC_TASK: 'ACME-1', ACC_DEPLOY_TO: 'uat' });
  assert.deepEqual(l.args.slice(0, 7), [deployGuidePrompt('ACME-1', 'Dev', 'UAT'), '--session-id', 'sess-1', '--name', l.name, '--permission-mode', 'default'], 'its first message first, and the person\'s own mode set aside');
  assert.deepEqual(JSON.parse(l.args[8]!), deployerSettings(), 'its settings: ask before each command, and the denies');
  assert.equal(l.args[7], '--settings');
  assert.equal(JSON.parse(deployGuideLaunch(paths, c, 'ACME-1', undefined, () => 's', '/opt/acc').args[8]!).hooks.UserPromptSubmit[0].hooks[0].command, '/opt/acc hook user-prompt-submit');
  assert.match(l.name, /ACME-1 Task 1 · deploy$/);
  assert.equal(deployGuideLaunch(paths, c, 'ACME-1', 'production').env.ACC_DEPLOY_TO, 'production', 'another next step, named');
  assert.throws(() => deployGuideLaunch(paths, c, 'ACME-1', 'dev'), /ACME-1 is in Dev already/, 'only a next step on its path');
  assert.throws(() => deployGuideLaunch(paths, c, 'ACME-9', undefined), /No task ACME-9/);
});
