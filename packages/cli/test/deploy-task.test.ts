// acc deploy --task (T-137): one ticket to its next environment. Its flags that take a value, how its plan
// reads, and who may run it. The deploy itself is tested in core, with fake Salesforce and GitHub answers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseConfig, type Config } from '../../core/src/config.ts';
import type { TaskDeployPlan } from '../../core/src/task-deploy.ts';
import { SF_CONFIG } from '../../core/test/support.ts';
import { taskDeployArgv, taskPlanLines } from '../src/commands/environments.ts';
import { cli, repoWithConfig } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));
const config = parseConfig(SF_CONFIG).config as Config;
const env = (b: string) => config.environments.find((e) => e.branch === b)!;

const plan = (over: Partial<TaskDeployPlan> = {}): TaskDeployPlan => ({
  task: 'ACME-1', key: 'ACME-1', from: env('dev'), to: env('uat'), org: 'Acme UAT', confirm: false, confirmName: 'UAT',
  commits: ['a'.repeat(40)], base: 'b'.repeat(40), files: ['force-app/main/default/classes/Invoice.cls'], gitOnly: ['NOTES.md'],
  leftOut: ['force-app/main/default/namedCredentials/Api.namedCredential-meta.xml'],
  deletions: [{ path: 'force-app/main/default/classes/Old.cls', component: 'Apex Class: Old' }], records: ['Account \'Acme Corp\': Name → \'Acme Corporation\''],
  types: [{ name: 'ApexClass', members: ['Invoice'] }], testLevel: 'RunLocalTests', tests: 'The org\'s local tests, since Apex is in it',
  check: { passed: true, id: '0AfCHECK', summary: 'Checked 1 component in Acme UAT (job 0AfCHECK).', problems: [] }, ...over,
});

test('a ticket\'s --yes and --confirm-production take a value; without --task they stay on/off flags', () => {
  assert.deepEqual(taskDeployArgv(['deploy', 'uat', '--task', 'ACME-1', '--yes', '0Af1', '--confirm-production', 'UAT']), ['deploy', 'uat', '--task', 'ACME-1', '--deploy-check=0Af1', '--confirm-name=UAT']);
  assert.deepEqual(taskDeployArgv(['deploy', 'uat', '--confirm-production']), ['deploy', 'uat', '--confirm-production'], 'a branch deploy is unchanged');
  assert.deepEqual(taskDeployArgv(['deploy', '--task=ACME-1', '--yes']), ['deploy', '--task=ACME-1', '--yes'], 'edge case: --yes with no value is left for the parser');
  assert.deepEqual(taskDeployArgv(['deploy', '--task', 'ACME-1', '--yes', '--plan']), ['deploy', '--task', 'ACME-1', '--yes', '--plan'], 'edge case: a flag is never taken as the value');
});

test('the plan reads as where, what, what\'s left out, what\'s by hand, and the check; a failed check lists the org\'s errors', () => {
  const lines = taskPlanLines(plan()).join('\n');
  assert.match(lines, /^ACME-1: Dev → UAT \(Acme UAT\)/);
  assert.match(lines, /1 component from 1 commit of its own\. Tests: The org's local tests/);
  assert.match(lines, /ApexClass\n {6}Invoice/);
  assert.match(lines, /Left out, environment-specific: .*Api\.namedCredential-meta\.xml/);
  assert.match(lines, /! Delete by hand in UAT: Apex Class: Old/);
  assert.match(lines, /! Make by hand in UAT: Account 'Acme Corp'/);
  assert.match(lines, /✓ The check passed/);
  const failed = taskPlanLines(plan({ check: { passed: false, id: '0Af2', summary: '1 problem', problems: ['Invoice: Invalid type: Foo'] } })).join('\n');
  assert.match(failed, /! The check failed: 1 problem\n {4}Invoice: Invalid type: Foo/);
  assert.match(taskPlanLines(plan({ check: null, files: [], types: [] })).join('\n'), /Nothing of it deploys, so nothing was checked/, 'edge case: nothing to check');
  assert.match(taskPlanLines(plan({ confirm: true, confirmName: 'Production', to: env('production') })).join('\n'), /protected: type Production to deploy/);
});

test('a builder can\'t deploy a ticket, and a project that isn\'t Salesforce refuses it with why', () => {
  const dir = repoWithConfig();
  const builder = acc(dir, ['deploy', '--task', 'T-1'], undefined, { ACC_ROLE: 'builder' });
  assert.equal(builder.code, 1);
  assert.match(builder.err, /A builder can't deploy a ticket\. A person does that/);
  const generic = acc(dir, ['deploy', '--task', 'T-1', '--yes', '0Af1']);
  assert.equal(generic.code, 1);
  assert.match(generic.err, /isn't a Salesforce project/);
});
