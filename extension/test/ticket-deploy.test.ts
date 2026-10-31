// A ticket's deploy on its Changes tab (T-158): a row for each environment on its path, in order, each with its
// state and when it was read; one environment next at most; Deploy…, which offers at most three environments
// ahead, each saying what happens next, off with why; and the page's messages, which hold no direct deploy. Two
// mutants of the model, each caught: one that shows two environments as next, and one that lets a direct deploy in.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { Config, Environment } from '../../packages/core/src/config.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import type { EnvWhere, TicketWhere } from '../../packages/core/src/where-kept.ts';
import { tempDir } from '../../packages/core/test/support.ts';
import { deletedPaths } from '../src/logic/ticket-deploy.ts';
import * as model from '../src/model/ticket-deploy.ts';

const { area, BUSY_LOOK, choiceThen, deployBlockers, deployOff, deployPick, envRows, MERGE_LOOK, NEXT_LOOK, pickOff, stepsLeftWords, ticketDeploy, WHERE_LOOK } = model;
type Mod = typeof model;

const env = (name: string, more: Partial<Environment> = {}): Environment => ({ name, branch: name.toLowerCase(), type: 'sandbox' as Environment['type'], org: `acme-${name.toLowerCase()}`, default: false, protected: false, promotesTo: [], ...more });
const ENVS = [env('Dev', { default: true, promotesTo: ['qa'] }), env('QA', { promotesTo: ['uat', 'hotfix'] }), env('UAT', { promotesTo: ['production'] }), env('Hotfix'), env('Production', { type: 'production' as Environment['type'], protected: true })];
const config: Pick<Config, 'profile' | 'environments' | 'github'> = { profile: 'salesforce', environments: ENVS, github: { repo: 'acme/app', account: 'jordan-kim' } };
// The screenshot the person sent: the development org goes to a sandbox or straight to Production, and the sandbox to Production.
const TWO = [env('Dev', { default: true, promotesTo: ['sandbox', 'production'] }), env('Sandbox', { promotesTo: ['production'] }), env('Production', { type: 'production' as Environment['type'] })];
const two: Pick<Config, 'profile' | 'environments' | 'github'> = { ...config, environments: TWO };
const AT = '2026-10-30T10:00:00.000Z';
const task = (more: Partial<Task> = {}): Task => ({
  id: 'ACME-7', title: 'x', brief: '', source: { kind: 'manual', key: null, url: null }, environment: 'dev', deps: [], labels: [], state: 'done', blocker: null,
  run: { branch: 'task/acme-7' }, pr: { number: 3, url: 'u', state: 'merged' }, history: [], createdAt: AT, updatedAt: AT, ...more,
} as unknown as Task);
const inQa = (): Task => task({ promotions: [{ from: 'dev', to: 'qa', pr: { number: 4, url: 'u' }, state: 'merged', at: AT, mergedAt: AT }] });
const read = (e: string, state: EnvWhere['state'], more: Partial<EnvWhere> = {}): EnvWhere => {
  const r = { state, differs: [], why: null, at: AT, ...more };
  return { env: e, name: ENVS.find((x) => x.branch === e)!.name, ...r, git: r, org: r, leftOut: [], unchecked: [], notes: [], ...more };
};
const where = (...envs: EnvWhere[]): TicketWhere => ({ v: 1, task: 'ACME-7', envs });
const base = { config, tasks: [] as Task[], deploying: null };

test('a row for each environment on the path, in order, each with its org, its state from the last reading, and when it was read (T-158)', () => {
  const w = where(read('dev', 'deployed'), read('qa', 'deployed'), read('uat', 'partly', { differs: ['Apex Class: Helper', 'Flow: Route'] }), read('production', 'unknown', { why: 'This machine has no access to Production.' }));
  const rows = envRows(config, inQa(), w);
  assert.deepEqual(rows.map((r) => [r.name, r.org, r.look.label, r.readAt]), [['Dev', 'acme-dev', 'Deployed', AT], ['QA', 'acme-qa', 'Deployed', AT], ['UAT', 'acme-uat', 'Partly deployed', AT], ['Production', 'acme-production', 'Can\'t tell', AT]]);
  assert.deepEqual([rows[2]!.detail, rows[2]!.differs], ['2 components differ', ['Apex Class: Helper', 'Flow: Route']], 'partly: how many differ, and which, for the row to open on');
  assert.equal(rows[3]!.detail, 'This machine has no access to Production.', 'can\'t tell: why');
  assert.equal(rows[1]!.at, AT, 'deployed: when, by acc\'s records');
  const none = envRows(config, inQa(), where(read('uat', 'not-deployed', { differs: ['Apex Class: Helper'] })));
  assert.deepEqual([none[2]!.look, none[2]!.at, none[2]!.differs], [WHERE_LOOK['not-deployed'], null, ['Apex Class: Helper']]);
  assert.deepEqual(Object.values(WHERE_LOOK).map((l) => l.tone), ['blue', 'orange', 'orange', 'neutral'], 'orange against blue, each with words');
});

test('edge case: before the first reading, a row is deployed where acc recorded it there, and can\'t tell elsewhere, with no read time, so the row says it isn\'t read yet (T-158)', () => {
  const rows = envRows(config, inQa());
  assert.deepEqual(rows.map((r) => [r.look.label, r.detail, r.readAt]), [['Can\'t tell', null, null], ['Deployed', null, null], ['Can\'t tell', null, null], ['Can\'t tell', null, null]]);
  assert.equal(envRows(config, task({ environment: 'nowhere' })).length, 0, 'an environment not in the settings has no rows');
});

test('only the usual next step is next, though its environment goes two ways, as in the person\'s screenshot (T-158)', () => {
  const rows = envRows(two, task());
  assert.deepEqual(rows.map((r) => r.name), ['Dev', 'Sandbox', 'Production']);
  assert.deepEqual(rows.map((r) => r.next), [null, NEXT_LOOK, null], 'Sandbox alone is next; Production is not a second next');
  assert.equal(envRows(two, task({ promotions: [{ from: 'dev', to: 'sandbox', pr: { number: 4, url: 'u' }, state: 'merged', at: AT, mergedAt: AT }] }))[2]!.next, NEXT_LOOK);
  // Edge: at the end of its path, nothing is next.
  assert.deepEqual(envRows(two, task({ environment: 'production' })).map((r) => r.next), [null]);
});

test('an environment off the usual way has a row after the path while Deploy… offers it, and none once it is no choice (T-158)', () => {
  const rows = (t: Task, w: TicketWhere | null = null) => ticketDeploy({ ...base, task: t, where: w })!.rows.map((r) => r.name);
  assert.deepEqual(rows(inQa()), ['Dev', 'QA', 'UAT', 'Production', 'Hotfix'], 'Hotfix, off QA, is a choice');
  assert.deepEqual(rows(inQa(), where(read('hotfix', 'not-deployed', { differs: ['Apex Class: Helper'] }))).length, 5);
  const inUat = task({ promotions: [{ from: 'qa', to: 'uat', pr: { number: 5, url: 'u' }, state: 'merged', at: AT, mergedAt: AT }] });
  assert.deepEqual(rows(inUat), ['Dev', 'QA', 'UAT', 'Production'], 'edge case: from UAT, Hotfix is no choice, so no row');
  assert.deepEqual(envRows(config, inQa(), null, null, [ENVS[2]!]).map((r) => r.name), ['Dev', 'QA', 'UAT', 'Production'], 'one already on the path is not drawn twice');
  const hotfix = ticketDeploy({ ...base, task: inQa(), where: where(read('hotfix', 'not-deployed', { differs: ['Apex Class: Helper', 'Flow: Route'] })) })!.rows[4]!;
  assert.deepEqual([hotfix.look, hotfix.detail, hotfix.differs.length, hotfix.next], [WHERE_LOOK['not-deployed'], '2 components not in Hotfix', 2, null], 'not deployed: how many are missing, for the row to open on');
});

test('the development environment\'s row says whether the work is merged into its branch, and no other row does (T-158)', () => {
  const merged = (t: Task) => envRows(config, t).map((r) => r.merged && [r.merged.look, r.merged.words]);
  assert.deepEqual(merged(task()), [[MERGE_LOOK.merged, 'Merged into dev'], null, null, null]);
  assert.deepEqual(merged(task({ pr: { number: 3, url: 'u', state: 'open' } }))[0], [MERGE_LOOK.open, 'Not merged into dev yet']);
  assert.deepEqual(merged(task({ pr: null, state: 'running' }))[0], [MERGE_LOOK.building, 'Being built']);
  assert.deepEqual(merged(task({ pr: null, run: null, state: 'todo' }))[0], [MERGE_LOOK.none, 'No work to merge yet'], 'edge case: before there\'s work');
});

test('Deploy… offers at most three environments ahead, in path order, each saying what happens next; Production and a protected org say the person types its name (T-158)', () => {
  const p = deployPick({ ...base, task: task() })!;
  assert.equal(p.label, 'Deploy…');
  assert.equal(p.disabled, null);
  assert.deepEqual(p.choices.map((c) => [c.name, c.then]), [['QA', 'An agent deploys it'], ['UAT', 'An agent deploys it'], ['Hotfix', 'An agent deploys it']], 'four ahead, three offered (D-205)');
  const fromQa = deployPick({ ...base, task: inQa() })!;
  assert.deepEqual(fromQa.choices.map((c) => [c.to, c.then]), [['uat', 'An agent deploys it'], ['hotfix', 'An agent deploys it'], ['production', 'An agent deploys it after you type Production\'s name']]);
  assert.equal(choiceThen(env('UAT', { protected: true })), 'An agent deploys it after you type UAT\'s name', 'a protected sandbox asks for its name too');
  // Edge: at the end of its path there's no Deploy…, and the rows still show.
  const end = ticketDeploy({ ...base, task: task({ environment: 'production' }) })!;
  assert.deepEqual([end.pick, end.rows.map((r) => r.name)], [null, ['Production']]);
  assert.equal(ticketDeploy({ ...base, config: { ...config, profile: 'generic' }, task: inQa() }), null, 'outside Salesforce there\'s none');
});

test('Deploy… is off with its reason when nothing can go; a choice that can\'t be picked says why in it (T-158)', () => {
  assert.match(pickOff({ ...base, task: task({ pr: null, run: null, state: 'todo' }) })!, /has no work yet: build it first/);
  assert.match(pickOff({ ...base, task: task({ state: 'running' }) })!, /builder is working on it now/);
  assert.equal(pickOff({ ...base, task: inQa(), failing: ['validate', 'tests'] }), 'The validate and tests checks failed: fix them, or accept them anyway, first.');
  assert.equal(pickOff({ ...base, task: inQa(), conflicts: 'dev' }), 'It conflicts with dev: take in dev first.');
  assert.match(pickOff({ ...base, task: inQa(), deploying: 'uat' })!, /under way/);
  assert.match(pickOff({ ...base, config: { ...config, github: null }, task: inQa() })!, /isn't on GitHub/);
  const off = deployPick({ ...base, task: inQa(), failing: ['validate'] })!;
  assert.deepEqual([off.disabled, off.choices.every((c) => c.disabled === off.disabled)], ['The validate check failed: fix it, or accept it anyway, first.', true]);
  // One choice off for its own reason: Deploy… stays on, and that choice says why.
  const noOrg = { ...config, environments: ENVS.map((e) => (e.branch === 'hotfix' ? { ...e, org: null } : e)) };
  const one = deployPick({ ...base, config: noOrg, task: inQa() })!;
  assert.deepEqual([one.disabled, one.choices.map((c) => c.disabled)], [null, [null, 'Hotfix has no org in the project\'s settings.', null]]);
  // Edge: every choice off for its own reason, so nothing can go: Deploy… is off, saying each reason once.
  const dep = task({ id: 'ACME-3' });
  const all = deployPick({ ...base, config: two, task: { ...task(), deps: ['ACME-3'] }, tasks: [dep] })!;
  assert.equal(all.disabled, 'It depends on ACME-3, which isn\'t in Sandbox or Production yet.', 'the same dependency missing from each: one line');
  // Edge: each off for a reason of its own: each reason once.
  const mixed = { ...two, environments: TWO.map((e) => (e.branch === 'sandbox' ? { ...e, org: null } : e)) };
  assert.equal(deployPick({ ...base, config: mixed, task: { ...task(), deps: ['ACME-3'] }, tasks: [dep] })!.disabled, 'Sandbox has no org in the project\'s settings. It depends on ACME-3, which isn\'t in Production yet.');
  assert.equal(deployOff({ ...base, task: inQa() }, ENVS[2]!), null);
  assert.deepEqual(deployBlockers([{ gate: 'validate', status: 'fail' }, { gate: 'static', status: 'fail', waived: true }, { gate: 'format', status: 'pass' }, { gate: 'lint', status: 'error' }]), ['validate', 'lint']);
});

test('edge case: a dependency already deployed to the destination holds nothing up; one that isn\'t does, and one it can\'t find doesn\'t (T-138)', async () => {
  const { missingDeps } = await import('../../packages/core/src/task-deploy.ts');
  const t = { ...inQa(), deps: ['ACME-3', 'ACME-4', 'ACME-404'] };
  const there = task({ id: 'ACME-3', deploys: [{ env: 'uat', org: 'acme-uat', sha: 's', at: AT, jobId: '0Af', paths: [], components: [], verified: 0, tests: null, checkId: '0Af' }] } as Partial<Task>);
  assert.deepEqual(missingDeps([there, task({ id: 'ACME-4' })], t, ENVS[2]!), ['ACME-4']);
});

test('a deploy under way shows on its row and on the tab, and Deploy… waits; the tab needs the person for the steps left by hand (T-158)', () => {
  const d = ticketDeploy({ ...base, task: inQa(), deploying: 'uat', stepsLeft: 2 })!;
  assert.deepEqual(d.rows.map((r) => r.busy), [null, null, BUSY_LOOK, null, null]);
  assert.deepEqual([d.status?.words, d.pick?.disabled !== null, d.needs], ['An agent is deploying ACME-7 to UAT.', true, '2 steps to do by hand']);
  // Edge: acc didn't say where it deploys: the tab still says one is under way, on no row.
  const somewhere = ticketDeploy({ ...base, task: inQa(), deploying: '' })!;
  assert.deepEqual([somewhere.status?.words, somewhere.rows.some((r) => r.busy)], ['An agent is deploying ACME-7.', false]);
  assert.equal(ticketDeploy({ ...base, task: inQa() })!.status, null);
  // A read of one environment under way waits on its row alone.
  assert.deepEqual(ticketDeploy({ ...base, task: inQa(), reading: (b) => b === 'uat' })!.rows.map((r) => [r.branch, r.reading]), [['dev', false], ['qa', false], ['uat', true], ['production', false], ['hotfix', false]]);
  assert.equal(stepsLeftWords(0), null);
});

test('the page\'s messages: Deploy…\'s pick and Check again, checked; no direct deploy is let in (T-158)', () => {
  assert.deepEqual(Object.keys(area.messages!).sort(), ['deploy-guide', 'where-check']);
  assert.equal(area.messages!['deploy-guide']!({ project: '/r', task: 'ACME-7', to: 'uat' }), true);
  assert.equal(area.messages!['deploy-guide']!({ project: '/r', task: 'ACME-7' }), false, 'where to is needed');
  assert.equal(area.messages!['where-check']!({ project: '/r', task: 'ACME-7', env: 'uat' }), true);
  assert.equal(area.messages!['where-check']!({ project: '/r', task: 'ACME-7' }), false, 'a row\'s Check again names its environment');
  assert.equal(area.messages!['where-check']!({ project: '/r', task: 'not a key', env: 'uat' }), false);
  const runner = (_c: string, args: string[]) => ({ code: 0, stdout: args.includes('src/a.ts') ? 'src/a.ts\0' : '', stderr: '' });
  assert.deepEqual(deletedPaths(runner as never, '/r', 'task/x', null, ['src/a.ts', 'src/old.ts']), ['src/old.ts']);
  assert.deepEqual(deletedPaths((() => ({ code: 128, stdout: '', stderr: 'bad' })) as never, '/r', 'task/x', null, ['src/a.ts']), [], 'edge case: a branch it can\'t read deletes nothing');
});

// ---------------------------------------------------------------- mutants: the checks below catch them

/** The environments a ticket's rows show as next, for the person's two-way path: one at most. */
const nextOnes = (m: Mod): string[] => m.envRows(two, task()).filter((r) => r.next).map((r) => r.name);
/** The page's messages that deploy without the agent: none. */
const directDeploys = (m: Mod): string[] => Object.keys(m.area.messages!).filter((k) => k !== 'deploy-guide' && k !== 'where-check');

/** model/ticket-deploy.ts with one change, imported from a folder of its own; its imports still reach the real modules. */
async function mutant(from: string, to: string): Promise<Mod> {
  const src = new URL('../src/model/ticket-deploy.ts', import.meta.url);
  const text = readFileSync(src, 'utf8');
  assert.ok(text.includes(from), `the mutant's line is still in ticket-deploy.ts: ${from}`);
  const changed = text.replace(from, to).replace(/from '(\.{1,2}\/[^']+\.ts)'/g, (_, f: string) => `from '${new URL(f, src).href}'`);
  const file = join(tempDir('mutant-'), 'ticket-deploy.ts');
  writeFileSync(file, changed);
  return await import(pathToFileURL(file).href) as Mod;
}

test('the checks pass on the model as it is', () => {
  assert.deepEqual(nextOnes(model), ['Sandbox']);
  assert.deepEqual(directDeploys(model), []);
});

test('a mutant that shows two environments as next is caught', async () => {
  const m = await mutant('next: e.branch === next ? NEXT_LOOK : null', 'next: ticketPlace(config, t, where)?.next.some((x) => x.branch === e.branch) ? NEXT_LOOK : null');
  assert.deepEqual(nextOnes(m), ['Sandbox', 'Production'], 'the mutant showed both as next, and the check saw it');
});

test('a mutant that lets the page deploy without the agent is caught', async () => {
  const m = await mutant("    'where-check': (x) => ticket(x) && short(x.env, 100),\n", "    'where-check': (x) => ticket(x) && short(x.env, 100),\n    'deploy-go': (x) => ticket(x) && short(x.to, 100),\n");
  assert.deepEqual(directDeploys(m), ['deploy-go'], 'the mutant took a direct deploy, and the check saw it');
});
