// Environments: every promotion path.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { environmentsModel, promotionPaths } from '../src/model/environments.ts';
import { envs, hub } from './support.ts';

test('environments draw every promotion path, including skipping QA (D-018)', () => {
  assert.deepEqual(promotionPaths(envs), [['devbox', 'sandbox', 'production'], ['devbox', 'production']]);
  const m = environmentsModel(hub()).projects[0]!;
  const devbox = m.envs.find((e) => e.branch === 'devbox')!;
  assert.deepEqual(devbox.badges, ['default', 'checked out']);
  assert.ok(!devbox.actions.some((a) => a.label === 'Compare'), 'no comparing a branch with itself');
  assert.deepEqual(m.envs.find((e) => e.branch === 'production')!.badges, ['protected']);
});
