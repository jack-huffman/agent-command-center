// Where a ticket's work went, by acc's own record (T-167): each environment's state is its latest deploy, or a
// deploy that failed after it, else merged into its branch, else not deployed; a failure is kept on the task with
// why. Where the ticket is counts only its usual path, so a deploy off it (Hotfix) never moves it (T-166): a
// mutant that lets an environment off the path move the ticket is caught.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { Environment } from '../src/config.ts';
import type { TaskDeploy } from '../src/deploy-gate.ts';
import { envRecord, oneLine, RECORD_STATES, recordDeployFailure, type TaskDeployFailure } from '../src/deploy-record.ts';
import { parseConfig } from '../src/config.ts';
import { mutate, readLedger, type Task, upsertTasks } from '../src/ledger.ts';
import { run } from '../src/exec.ts';
import { repoPaths } from '../src/paths.ts';
import * as real from '../src/task-deploy.ts';
import { makeRepo, SF_CONFIG, tempDir } from './support.ts';

const now = () => new Date('2026-10-31T12:00:00Z');
const env = (branch: string, promotesTo: string[], more: Partial<Environment> = {}): Environment => ({ name: branch.toUpperCase(), branch, type: 'sandbox', org: `acme-${branch}`, default: false, protected: false, promotesTo, ...more } as Environment);
// Dev, QA, UAT, Production, with Hotfix a step off QA.
const config = { environments: [env('dev', ['qa'], { default: true }), env('qa', ['uat', 'hotfix']), env('uat', ['production']), env('hotfix', []), env('production', [])] };
const deploy = (envName: string, at: string, more: Partial<TaskDeploy> = {}): TaskDeploy => ({ env: envName, org: `acme-${envName}`, sha: 's', at, jobId: '0Af', paths: [], components: [], verified: 0, tests: null, ...more });
const fail = (envName: string, at: string, more: Partial<TaskDeployFailure> = {}): TaskDeployFailure => ({ env: envName, org: `acme-${envName}`, at, reason: 'The deploy to acme failed (job 0Af2), 1 problem: Foo.cls:3: Missing ;\nmore lines', ...more });
const task = (more: Partial<Task> = {}): Task => ({ id: 'ACME-7', environment: 'dev', pr: null, promotions: [], deploys: [], ...more } as unknown as Task);

test('each environment\'s state is acc\'s record: deployed with when and who, failed with why on one line, merged, or not deployed', () => {
  assert.deepEqual(RECORD_STATES, ['deployed', 'failed', 'merged', 'not-deployed']);
  const t = task({
    pr: { number: 3, url: 'u', state: 'merged' } as Task['pr'],
    deploys: [deploy('dev', '2026-10-30T09:00:00Z'), deploy('qa', '2026-10-30T10:00:00Z', { checkId: '0AfC', by: 'human:jordan' })],
    deployFailures: [fail('uat', '2026-10-30T11:00:00Z', { checkId: '0AfD', by: 'human:jordan' })],
    promotions: [{ from: 'uat', to: 'production', pr: { number: 9, url: 'u' }, state: 'merged', at: '2026-10-30T12:00:00Z', mergedAt: '2026-10-30T12:05:00Z' }],
  });
  assert.deepEqual(envRecord(t, 'dev'), { state: 'deployed', at: '2026-10-30T09:00:00Z', by: 'builder', reason: null }, 'the builder\'s deploy gate');
  assert.deepEqual(envRecord(t, 'qa'), { state: 'deployed', at: '2026-10-30T10:00:00Z', by: 'guide', reason: null }, 'the deploy guide\'s, with the person\'s check');
  assert.deepEqual(envRecord(t, 'uat'), { state: 'failed', at: '2026-10-30T11:00:00Z', by: 'guide', reason: 'The deploy to acme failed (job 0Af2), 1 problem: Foo.cls:3: Missing ;' }, 'why, on one line');
  assert.deepEqual(envRecord(t, 'production'), { state: 'merged', at: '2026-10-30T12:05:00Z', by: null, reason: null }, 'a promotion that merged, with no deploy');
  assert.deepEqual(envRecord(t, 'hotfix'), { state: 'not-deployed', at: null, by: null, reason: null });
});

test('edge case: a deploy after a failure is deployed again; a failure after a deploy is failed; its own environment merged with no deploy is merged, with no time', () => {
  const again = task({ deploys: [deploy('dev', '2026-10-30T12:00:00Z')], deployFailures: [fail('dev', '2026-10-30T11:00:00Z')] });
  assert.equal(envRecord(again, 'dev').state, 'deployed');
  const broke = task({ deploys: [deploy('dev', '2026-10-30T10:00:00Z')], deployFailures: [fail('dev', '2026-10-30T11:00:00Z')] });
  assert.deepEqual([envRecord(broke, 'dev').state, envRecord(broke, 'dev').by], ['failed', 'builder']);
  assert.deepEqual(envRecord(task({ pr: { number: 3, url: 'u', state: 'merged' } as Task['pr'] }), 'dev'), { state: 'merged', at: null, by: null, reason: null });
  assert.equal(envRecord(task({ pr: { number: 3, url: 'u', state: 'open' } as Task['pr'] }), 'dev').state, 'not-deployed', 'an open pull request is not merged');
  assert.equal(envRecord(task(), 'dev').state, 'not-deployed', 'before there is any work');
  assert.equal(envRecord(task({ promotions: [{ from: 'dev', to: 'qa', pr: { number: 4, url: 'u' }, state: 'open', at: '2026-10-30T10:00:00Z' }] }), 'qa').state, 'not-deployed', 'an open promotion is not merged');
  assert.equal(oneLine('\n  first  \nsecond'), 'first');
  assert.equal(oneLine(''), '', 'edge case: an empty reason');
});

test('a failed deploy is kept on its task; edge case: nothing without a task, or for a task the ledger doesn\'t hold', () => {
  const root = makeRepo();
  const paths = repoPaths(root, run);
  mutate(paths, now, (l, emit) => upsertTasks(l, parseConfig(SF_CONFIG).config!, [{ source: { kind: 'manual', key: 'ACME-7' }, title: 'x', environment: 'dev' }], 'human', 'human:test', emit, now));
  const f = fail('uat', now().toISOString(), { by: 'human:jordan', checkId: '0AfD' });
  assert.deepEqual(recordDeployFailure(paths, now, 'ACME-7', f, 'human'), f);
  assert.deepEqual(readLedger(paths.ledger).tasks.find((t) => t.id === 'ACME-7')!.deployFailures, [f]);
  assert.equal(recordDeployFailure(paths, now, undefined, f), null);
  assert.equal(recordDeployFailure(paths, now, 'ACME-404', f), null);
  assert.equal(readLedger(paths.ledger).tasks.find((t) => t.id === 'ACME-7')!.deployFailures!.length, 1);
});

/** Where a ticket deployed to QA, then to Hotfix (off QA), is: QA, as Hotfix is off its usual path. */
const placeAfterHotfix = (m: typeof real): string | undefined => m.ticketPlace(config, task({
  deploys: [deploy('qa', '2026-10-30T10:00:00Z', { checkId: '0AfC' }), deploy('hotfix', '2026-10-30T11:00:00Z', { checkId: '0AfH' })],
}))?.at.branch;

test('a deploy to an environment off the usual path never moves where the ticket is (T-166)', () => {
  assert.equal(placeAfterHotfix(real), 'qa');
  const merged = task({ promotions: [{ from: 'qa', to: 'hotfix', pr: { number: 5, url: 'u' }, state: 'merged', at: '2026-10-30T11:00:00Z', mergedAt: '2026-10-30T11:00:00Z' }] });
  assert.equal(real.ticketPlace(config, merged)!.at.branch, 'dev', 'edge case: a merged promotion to Hotfix doesn\'t move it either');
  assert.equal(real.ticketPlace(config, task({ deploys: [deploy('uat', '2026-10-30T10:00:00Z', { checkId: '0AfU' })] }))!.at.branch, 'uat', 'one on the path does');
});

test('a mutant that lets an environment off the path move the ticket is caught (T-166)', async () => {
  const src = new URL('../src/task-deploy.ts', import.meta.url);
  const text = readFileSync(src, 'utf8');
  const from = '(b.at >= a.at && path.has(b.env) ? b : a)';
  assert.ok(text.includes(from), 'the mutant\'s line is still in task-deploy.ts');
  const changed = text.replace(from, '(b.at >= a.at && environmentByBranch(config, b.env) ? b : a)').replace(/from '(\.{1,2}\/[^']+\.ts)'/g, (_, f: string) => `from '${new URL(f, src).href}'`);
  const file = join(tempDir('mutant-'), 'task-deploy.ts');
  writeFileSync(file, changed);
  const m = await import(pathToFileURL(file).href) as typeof real;
  assert.equal(placeAfterHotfix(m), 'hotfix', 'the mutant moved it to Hotfix, and the check saw it');
});
