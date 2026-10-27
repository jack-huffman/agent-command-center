// The routine's token is kept in the macOS keychain, so on Windows it's not available yet (D-T-123): acc never
// runs the Mac's security command there, Setup's step says why rather than failing, and the Token… button is
// off with that reason. On a Mac nothing changes. A token given in the environment works everywhere.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLOUD_TOKEN_ENV, cloudTokenUnavailable, deleteCloudToken, readCloudToken, writeCloudToken } from '../../packages/core/src/cloud.ts';
import { parseConfig } from '../../packages/core/src/config.ts';
import { CLOUD_STEPS } from '../../packages/core/src/onboarding/cloud-steps.ts';
import type { CheckContext } from '../../packages/core/src/onboarding/types.ts';
import { fakeRunner, GENERIC_CONFIG, ok } from '../../packages/core/test/support.ts';
import { cloudSetting } from '../src/model/settings.ts';

const ROUTINE = 'trig_01ABCDEFGHJKLMNOPQRSTUVW';
const TOKEN = 'tok_0123456789abcdefghij';
const KEYCHAIN = { 'security find-generic-password': ok(`${TOKEN}\n`), 'security delete-generic-password': ok(), 'security -i': ok() };

test('a Mac keeps the token in its keychain; Windows says it isn\'t available there yet; Linux (CI) is unchanged', () => {
  assert.equal(cloudTokenUnavailable('darwin'), null);
  assert.equal(cloudTokenUnavailable('win32'), 'Not available on Windows yet: the routine\'s token is kept in the macOS keychain');
  assert.equal(cloudTokenUnavailable('linux'), null);
});

test('edge case: on Windows acc never runs security, and refuses to keep a token with why', () => {
  const calls: string[] = [];
  const run = fakeRunner(KEYCHAIN, calls);
  assert.equal(readCloudToken(run, 'acme/tool', {}, 'win32'), null);
  assert.equal(deleteCloudToken(run, 'acme/tool', {}, 'win32'), false);
  assert.throws(() => writeCloudToken(run, 'acme/tool', TOKEN, {}, 'win32'), new RegExp(`Not available on Windows yet.*Set ${CLOUD_TOKEN_ENV} to the token instead`));
  assert.deepEqual(calls, [], 'security never ran');
  assert.equal(readCloudToken(run, 'acme/tool', { [CLOUD_TOKEN_ENV]: TOKEN }, 'win32'), TOKEN, 'a token in the environment still works');
  assert.equal(readCloudToken(fakeRunner(KEYCHAIN), 'acme/tool', {}, 'darwin'), TOKEN, 'a Mac reads its keychain as before');
});

test('Setup\'s token step says Windows can\'t keep it yet, as a skip with why, and passes on a token in the environment', () => {
  const step = CLOUD_STEPS.find((s) => s.id === 'B15.cloud-token')!;
  const ctx = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}): CheckContext => ({
    cwd: '/r', run: fakeRunner(KEYCHAIN), env, paths: { root: '/r' } as never, config: parseConfig({ ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'a' }, agents: { max: 2, cloud: { routine: ROUTINE } } }).config, configErrors: [], cache: new Map(), version: null, platform,
  });
  assert.deepEqual(step.check(ctx('win32')), { status: 'skip', detail: 'Not available on Windows yet: the routine\'s token is kept in the macOS keychain.' });
  assert.equal(step.check(ctx('win32', { [CLOUD_TOKEN_ENV]: TOKEN })).status, 'pass');
  assert.equal(step.check(ctx('darwin')).status, 'pass', 'a Mac as before');
});

test('the Token… button is off on Windows with why, and on on a Mac', () => {
  const p = { name: 'P', root: '/p', branch: null, worktrees: [], config: { github: { repo: 'o/r', account: 'a' }, environments: [], profile: 'generic', agents: { cloud: { routine: ROUTINE, default: 'local', quietMinutes: 120, max: 3, review: 'local' } } } } as never;
  const token = (platform: NodeJS.Platform) => cloudSetting(p, undefined, null, platform)!.actions.find((a) => a.command === 'acc.cloud.token')!;
  assert.equal(token('win32').disabled, 'Not available on Windows yet: the routine\'s token is kept in the macOS keychain');
  assert.equal(token('darwin').disabled, null);
});
