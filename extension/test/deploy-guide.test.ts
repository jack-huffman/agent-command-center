// Deploy with an agent at the extension (T-154): acc's launch read from its --json, the line the terminal runs,
// the page's message, and the command's spec.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TASK_DEPLOY_GUIDE_COMMAND } from '../../packages/core/src/deploy-guide.ts';
import { TASK_DEPLOY_COMMAND } from '../../packages/core/src/task-deploy.ts';
import { guideLaunch, guideLine } from '../src/logic/deploy-guide.ts';
import { area } from '../src/model/ticket-deploy.ts';

const launch = { cwd: '/repo', sessionId: 's1', name: 'Acme · ACME-1 Regions · deploy', brief: '', args: ['Guide the deploy of ACME-1 from UAT to Production, as the acc:deploy skill says.', '--session-id', 's1'], env: { ACC_ROLE: 'deployer', ACC_TASK: 'ACME-1', ACC_DEPLOY_TO: 'production' } };

test('the launch opens the guide\'s chat; a refusal says why in its own words (edge case: anything else isn\'t taken as a launch)', () => {
  assert.deepEqual(guideLaunch(0, JSON.stringify(launch), ''), { ok: true, launch });
  assert.deepEqual(guideLaunch(1, '', '✗ ACME-1 can\'t be deployed: its builder is at work\nmore'), { ok: false, error: 'ACME-1 can\'t be deployed: its builder is at work' });
  assert.deepEqual(guideLaunch(2, '', ''), { ok: false, error: 'it stopped with code 2' });
  assert.equal(guideLaunch(0, 'not json', '').ok, false);
  assert.equal(guideLaunch(0, JSON.stringify({ ...launch, env: { ACC_ROLE: 'builder' } }), '').ok, false, 'edge case: a launch that isn\'t the deploy guide\'s');
});

test('the terminal runs claude with each argument quoted, so the first message stays one argument', () => {
  const line = guideLine(launch);
  assert.ok(line.startsWith('claude '), line);
  assert.ok(line.includes('--session-id s1'), line);
  assert.match(line, /'Guide the deploy of ACME-1 from UAT to Production, as the acc:deploy skill says\.'/);
});

test('the page\'s message names its task and where it goes; the command is on exactly when Deploy is', () => {
  const ok = area.messages!['deploy-guide']!;
  assert.equal(ok({ type: 'deploy-guide', project: '/repo', task: 'ACME-1', to: 'production' }), true);
  assert.equal(ok({ type: 'deploy-guide', project: '/repo', task: 'ACME-1' }), false, 'where to is needed');
  assert.equal(ok({ type: 'deploy-guide', project: '/repo', task: 'not a key!', to: 'production' }), false);
  assert.equal(TASK_DEPLOY_GUIDE_COMMAND.id, 'acc.task.deployGuide');
  const config = { profile: 'generic' as const, environments: [], github: null };
  assert.deepEqual(TASK_DEPLOY_GUIDE_COMMAND.enabled({ config, task: undefined } as never), TASK_DEPLOY_COMMAND.enabled({ config, task: undefined } as never));
});
