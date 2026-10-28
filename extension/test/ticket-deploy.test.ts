// A ticket's deploy on its Changes tab (T-138): its path in one line, Deploy to its next environment off with
// why in each case, the sheet's facts from the plan, and the extension side, which checks first and sends the
// person's yes only for a check that passed, with the org's name typed where it's asked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Config, Environment } from '../../packages/core/src/config.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import type { TaskDeployPlan, TaskDeployResult } from '../../packages/core/src/task-deploy.ts';
import { deletedPaths, stepOn, TicketDeploys, yesRefusal } from '../src/logic/ticket-deploy.ts';
import { area, type DeployRun, deployOff, deploySheet, PATH_LOOK, SHEET_LOOK, stepsLeftWords, ticketDeploy, ticketPath } from '../src/model/ticket-deploy.ts';

const env = (name: string, more: Partial<Environment> = {}): Environment => ({ name, branch: name.toLowerCase(), type: 'sandbox' as Environment['type'], org: `acme-${name.toLowerCase()}`, default: false, protected: false, promotesTo: [], ...more });
const ENVS = [env('Dev', { default: true, promotesTo: ['qa'] }), env('QA', { promotesTo: ['uat', 'hotfix'] }), env('UAT', { promotesTo: ['production'] }), env('Hotfix'), env('Production', { type: 'production' as Environment['type'], protected: true })];
const config: Pick<Config, 'profile' | 'environments' | 'github'> = { profile: 'salesforce', environments: ENVS, github: { repo: 'acme/app', account: 'jordan-kim' } };
const AT = '2026-10-28T10:00:00.000Z';
const task = (more: Partial<Task> = {}): Task => ({
  id: 'ACME-7', title: 'x', brief: '', source: { kind: 'manual', key: null, url: null }, environment: 'dev', deps: [], labels: [], state: 'done', blocker: null,
  run: { branch: 'task/acme-7' }, pr: { number: 3, url: 'u', state: 'merged' }, history: [], createdAt: AT, updatedAt: AT, ...more,
} as unknown as Task);
const inQa = (): Task => task({ promotions: [{ from: 'dev', to: 'qa', pr: { number: 4, url: 'u' }, state: 'merged', at: AT, mergedAt: AT }] });

const plan = (more: Partial<TaskDeployPlan> = {}): TaskDeployPlan => ({
  task: 'ACME-7', key: 'ACME-7', from: ENVS[1]!, to: ENVS[2]!, org: 'acme-uat', confirm: false, confirmName: 'UAT', commits: ['a'], base: 'b', files: ['x.cls'], gitOnly: [], leftOut: ['force-app/main/default/settings/Org.settings-meta.xml'],
  deletions: [{ path: 'old.cls', component: 'Apex Class: Old' }], records: ['Update Account Acme'], types: [{ name: 'ApexClass', members: ['A', 'B'] }, { name: 'Flow', members: ['F'] }],
  testLevel: 'RunLocalTests', tests: 'The org\'s local tests, since Apex is in it', check: { passed: true, id: '0Af1', summary: 'Checked 3 components in acme-uat.', problems: [] }, ...more,
});
const run = (more: Partial<DeployRun> = {}): DeployRun => ({ to: 'uat', toName: 'UAT', phase: 'passed', progress: null, plan: plan(), result: null, error: null, ...more });

test('the path line: its own environment merged, each it reached deployed with when, the next step, and later ones (T-138)', () => {
  const p = ticketPath(config, inQa());
  assert.deepEqual(p.map((s) => [s.name, s.look.label, s.at]), [['Dev', 'merged', null], ['QA', 'deployed', AT], ['UAT', 'next', null], ['Production', 'later', null]]);
  assert.deepEqual([PATH_LOOK.deployed.tone, PATH_LOOK.next.tone], ['blue', 'orange'], 'orange against blue, each with words');
  // Edge: not merged yet, it's being built; deployed to its own org by its builder, it says deployed.
  assert.deepEqual(ticketPath(config, task({ pr: null, state: 'running' })).map((s) => s.look.label), ['being built', 'next', 'later', 'later']);
  const own = ticketPath(config, task({ deploys: [{ env: 'dev', org: 'acme-dev', sha: 's', at: AT, jobId: null, paths: [], components: [], verified: 0, tests: null }] }));
  assert.deepEqual([own[0]!.look.label, own[0]!.at], ['deployed', AT]);
});

test('Deploy to the next environment is the one button, the path\'s other next steps go in its menu, and outside Salesforce there\'s none (T-138)', () => {
  const d = ticketDeploy({ config, task: inQa(), tasks: [inQa()], running: false, run: null })!;
  assert.deepEqual([d.deploy?.label, d.deploy?.to, d.deploy?.disabled], ['Deploy to UAT', 'uat', null]);
  assert.deepEqual(d.others.map((o) => o.label), ['Deploy to Hotfix'], 'at most three in the menu (D-205)');
  assert.deepEqual([d.sheet, d.status, d.needs], [null, null, null]);
  assert.equal(ticketDeploy({ config: { ...config, profile: 'generic' }, task: inQa(), tasks: [], running: false, run: null }), null);
  // Edge: at the end of its path there's nothing to deploy to, and the path still shows.
  const end = ticketDeploy({ config, task: task({ environment: 'production' }), tasks: [], running: false, run: null })!;
  assert.deepEqual([end.deploy, end.path.map((s) => s.name)], [null, ['Production']]);
});

test('Deploy is off with its reason in each case: not built yet, a dependency not there, a deploy under way, no org (T-138)', () => {
  const uat = ENVS[2]!;
  const base = { config, tasks: [] as Task[], running: false, run: null };
  assert.match(deployOff({ ...base, task: task({ pr: null, run: null, state: 'todo' }) }, uat)!, /has no work yet: build it first/);
  assert.match(deployOff({ ...base, task: task({ state: 'running' }) }, uat)!, /builder is working on it now/);
  const dep = task({ id: 'ACME-3', promotions: [] });
  assert.equal(deployOff({ ...base, task: { ...inQa(), deps: ['ACME-3'] }, tasks: [dep] }, uat), 'It depends on ACME-3, which isn\'t in UAT yet.');
  assert.match(deployOff({ ...base, task: inQa(), running: true }, uat)!, /under way/);
  assert.match(deployOff({ ...base, task: inQa(), run: run({ phase: 'checking' }) }, uat)!, /under way/, 'a check of its own in this window');
  assert.equal(deployOff({ ...base, task: inQa() }, { ...uat, org: null }), 'UAT has no org in the project\'s settings.');
  assert.match(deployOff({ ...base, config: { ...config, github: null }, task: inQa() }, uat)!, /isn't on GitHub/);
  assert.equal(deployOff({ ...base, task: inQa() }, uat), null);
});

test('the sheet says the destination, the components, the tests, and what\'s left by hand with how many; only a passed check gives a yes (T-138)', () => {
  const s = deploySheet('ACME-7', run());
  assert.deepEqual([s.org, s.components?.count, s.tests, s.checkId, s.confirm, s.look], ['acme-uat', 3, 'The org\'s local tests, since Apex is in it', '0Af1', null, SHEET_LOOK.passed]);
  assert.deepEqual(s.byHand.map((b) => [b.label, b.items.length]), [['Deletions', 1], ['Record changes', 1], ['Environment-specific files, left as the org has them', 1]]);
  const failed = deploySheet('ACME-7', run({ phase: 'failed', plan: plan({ check: { passed: false, id: '0Af2', summary: '1 problem', problems: ['Apex Class A: line 3: missing ;'] } }) }));
  assert.deepEqual([failed.checkId, failed.problems], [null, ['Apex Class A: line 3: missing ;']], 'a failed check offers nothing to say yes to');
  // Edge: before the check comes back, it says what it's doing and holds no facts.
  const checking = deploySheet('ACME-7', run({ phase: 'checking', plan: null }));
  assert.deepEqual([checking.progress, checking.components, checking.checkId], ['Checking against UAT…', null, null]);
  assert.equal(deploySheet('ACME-7', run({ phase: 'checking', plan: null, progress: 'Checking in acme-uat' })).progress, 'Checking in acme-uat');
  assert.equal(deploySheet('ACME-7', run({ plan: plan({ confirm: true, confirmName: 'Production' }) })).confirm, 'Production');
});

test('the tab needs the person for a passed check not yet confirmed, and says a deploy under way or done, with its pull request (T-138)', () => {
  const at = (r: DeployRun) => ticketDeploy({ config, task: inQa(), tasks: [], running: false, run: r })!;
  assert.equal(at(run()).needs, 'Check passed: deploy to UAT');
  assert.equal(at(run({ phase: 'failed' })).needs, null);
  const hidden = at(run({ phase: 'deploying', progress: 'Deploy to UAT', hidden: true }));
  assert.deepEqual([hidden.sheet, hidden.status?.words, hidden.deploy?.disabled !== null], [null, 'Deploy to UAT', true], 'cancelled while it deploys: the tab says what it does');
  const result = { deployed: true, summary: 'Deployed ACME-7 to UAT.', pr: { number: 9, url: 'u9' }, warning: null } as TaskDeployResult;
  const done = at(run({ phase: 'deployed', result }));
  assert.deepEqual([done.status?.words, done.status?.pr?.number, done.sheet?.result?.summary], ['Deployed ACME-7 to UAT.', 9, 'Deployed ACME-7 to UAT.']);
  assert.equal(stepsLeftWords(2), '2 steps to do by hand');
  assert.equal(stepsLeftWords(0), null);
});

test('the page\'s three deploy messages are checked, and anything else about them is refused (T-138)', () => {
  const m = area.messages!;
  const ok = { project: '/r', task: 'ACME-7' };
  assert.equal(m['deploy-check']!({ ...ok, to: 'uat' }), true);
  assert.equal(m['deploy-check']!({ ...ok }), false);
  assert.equal(m['deploy-go']!({ ...ok, to: 'uat', checkId: '0Af1' }), true);
  assert.equal(m['deploy-go']!({ ...ok, to: 'uat' }), false, 'no yes without the check\'s id');
  assert.equal(m['deploy-close']!({ project: '/r', task: 'not a key' }), false);
});

/** A host whose acc answers with what each test gives it, and remembers what it was asked. */
function host(answers: Record<string, unknown>[]) {
  const asked: string[][] = [];
  const h = {
    envName: (_: string, b: string) => ENVS.find((e) => e.branch === b)?.name,
    acc: async (args: string[], _cwd: string, _label: string, onSteps: (s: never) => void) => {
      asked.push(args);
      onSteps({ seen: 1, steps: [{ id: 'check', label: 'Check in acme-uat', state: 'started', note: null, from: 0, to: null }], result: null } as never);
      const a = answers.shift() ?? {};
      return { code: (a.code as number) ?? 0, stdout: JSON.stringify(a.out ?? {}), stderr: '' };
    },
  };
  return { h, asked };
}

test('Deploy to opens the check, which asks for a plan only, and says the step it\'s on; a passed check waits for the person (T-138)', async () => {
  const { h, asked } = host([{ out: plan() }]);
  const seen: string[] = [];
  const d = new TicketDeploys(h, () => { const r = d.run('/r', 'ACME-7'); if (r) seen.push(`${r.phase}:${r.progress ?? ''}`); });
  assert.deepEqual(await d.check('/r', 'acme-7', 'uat'), { ok: true });
  assert.deepEqual(asked, [['deploy', 'uat', '--task', 'ACME-7', '--plan', '--json']], 'the plan only: its check changes nothing');
  assert.deepEqual(seen, ['checking:', 'checking:Check in acme-uat', 'passed:'], 'checking, the step it\'s on, then the result');
  assert.equal(d.run('/r', 'ACME-7')?.plan?.check?.id, '0Af1');
});

test('the yes goes only for a check that passed, with its id, and the typed name of a protected org; a failed check deploys nothing (T-138)', async () => {
  assert.match(yesRefusal(null, 'uat', '0Af1', undefined)!, /no check that passed/);
  assert.match(yesRefusal(run({ phase: 'failed' }), 'uat', '0Af1', undefined)!, /no check that passed/);
  assert.match(yesRefusal(run(), 'uat', 'other', undefined)!, /another check/);
  assert.match(yesRefusal(run(), 'production', '0Af1', undefined)!, /another check/);
  const prod = run({ plan: plan({ confirm: true, confirmName: 'UAT' }) });
  assert.equal(yesRefusal(prod, 'uat', '0Af1', 'uat'), 'Type UAT to deploy to it.', 'its name exactly');
  assert.equal(yesRefusal(prod, 'uat', '0Af1', 'UAT'), null);
  assert.equal(yesRefusal(prod, 'uat', '0Af1', 'acme-uat'), null, 'or its org\'s alias, as acc takes');
  // The extension refuses before acc is asked, after a failed check.
  const failedPlan = plan({ check: { passed: false, id: '0Af2', summary: 'x', problems: ['A: bad'] } });
  const { h, asked } = host([{ code: 1, out: failedPlan }]);
  const d = new TicketDeploys(h);
  await d.check('/r', 'ACME-7', 'uat');
  assert.equal(d.run('/r', 'ACME-7')?.phase, 'failed');
  assert.equal((await d.deploy('/r', 'ACME-7', 'uat', '0Af2')).ok, false);
  assert.equal(asked.length, 1, 'nothing deployed after a failed check');
});

test('the sheet\'s Deploy sends the yes with the check\'s id and the typed name, and the result shows; a deploy that failed says why (T-138)', async () => {
  const result = { deployed: true, summary: 'Deployed ACME-7 to UAT.', pr: { number: 9, url: 'u' }, warning: null, plan: plan() };
  const { h, asked } = host([{ out: plan({ confirm: true }) }, { out: result }]);
  const d = new TicketDeploys(h);
  await d.check('/r', 'ACME-7', 'uat');
  assert.equal((await d.deploy('/r', 'ACME-7', 'uat', '0Af1')).ok, false, 'no typed name, no deploy');
  assert.deepEqual(await d.deploy('/r', 'ACME-7', 'uat', '0Af1', ' UAT '), { ok: true });
  assert.deepEqual(asked[1], ['deploy', 'uat', '--task', 'ACME-7', '--yes', '0Af1', '--confirm-production', 'UAT', '--json']);
  assert.equal(d.run('/r', 'ACME-7')?.phase, 'deployed');
  // Edge: acc says the deploy failed: the sheet says why, in process words, and offers no yes again.
  const bad = host([{ out: plan() }, { code: 1, out: { ...result, deployed: false, summary: 'The deploy of ACME-7 to UAT failed: 1 problem.' } }]);
  const d2 = new TicketDeploys(bad.h);
  await d2.check('/r', 'ACME-7', 'uat');
  assert.equal((await d2.deploy('/r', 'ACME-7', 'uat', '0Af1')).ok, false);
  assert.deepEqual([d2.run('/r', 'ACME-7')?.phase, d2.run('/r', 'ACME-7')?.error], ['error', 'The deploy of ACME-7 to UAT failed: 1 problem.']);
});

test('edge case: Cancel always works: a check cancelled while it runs is let go when it answers; one deploying hides its sheet and goes on (T-138)', async () => {
  let release!: () => void;
  const h = {
    envName: () => 'UAT',
    acc: (_a: string[]) => new Promise<{ code: number; stdout: string; stderr: string }>((res) => { release = () => res({ code: 0, stdout: JSON.stringify(plan()), stderr: '' }); }),
  };
  const d = new TicketDeploys(h);
  const p = d.check('/r', 'ACME-7', 'uat');
  d.close('/r', 'ACME-7');
  release();
  await p;
  assert.equal(d.run('/r', 'ACME-7'), null, 'its plan never shows');
  // A refusal from acc before any plan: the sheet says it, and closes on Cancel.
  const refused = new TicketDeploys({ envName: () => 'UAT', acc: async () => ({ code: 1, stdout: JSON.stringify({ errors: ['ACME-7 has no work yet: build it first.'] }), stderr: '' }) });
  assert.deepEqual(await refused.check('/r', 'ACME-7', 'uat'), { ok: false, error: 'ACME-7 has no work yet: build it first.' });
  refused.close('/r', 'ACME-7');
  assert.equal(refused.run('/r', 'ACME-7'), null);
  // An environment the settings don't have is refused before anything runs.
  assert.equal((await refused.check('/r', 'ACME-7', 'nowhere')).ok, false);
});

test('stepOn names the step acc is on, and none before the first; deletedPaths reads what the branch deletes (T-138)', () => {
  assert.equal(stepOn({ seen: 0, steps: [], result: null }), null);
  assert.equal(stepOn({ seen: 2, steps: [{ id: 'a', label: 'Read its commits', state: 'done', note: null, from: 0, to: 1 }, { id: 'b', label: 'Check in acme-uat', state: 'started', note: null, from: 1, to: null }], result: null }), 'Check in acme-uat');
  const runner = (_c: string, args: string[]) => ({ code: 0, stdout: args.includes('src/a.ts') ? 'src/a.ts\0' : '', stderr: '' });
  assert.deepEqual(deletedPaths(runner as never, '/r', 'task/x', null, ['src/a.ts', 'src/old.ts']), ['src/old.ts']);
  assert.deepEqual(deletedPaths((() => ({ code: 128, stdout: '', stderr: 'bad' })) as never, '/r', 'task/x', null, ['src/a.ts']), [], 'a branch it can\'t read deletes nothing');
  assert.deepEqual(deletedPaths(runner as never, '/r', 'task/x', null, []), []);
});
