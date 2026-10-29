// The scheduled task's token on each system (T-145, replacing D-209's "not on Windows yet"). A Mac keeps it in
// its keychain, through acc, so a dispatch typed in a terminal finds it. Windows keeps it in VS Code's secret
// storage, as tracker sign-ins are (D-027), and the Command Center hands it to acc in its environment whenever it
// runs acc for that repo; acc hands it to nothing it starts. A Windows terminal with no token says, in words, to
// start the dispatch from the Command Center. Token… is on everywhere.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLOUD_TOKEN_ENV, cloudNeeds, cloudReason, cloudTokenHome, deleteCloudToken, readCloudToken, WINDOWS_TOKEN_FIX, writeCloudToken } from '../../packages/core/src/cloud.ts';
import { parseConfig } from '../../packages/core/src/config.ts';
import { run } from '../../packages/core/src/exec.ts';
import { CLOUD_STEPS } from '../../packages/core/src/onboarding/cloud-steps.ts';
import type { CheckContext } from '../../packages/core/src/onboarding/types.ts';
import { childEnv, KEPT_FROM_CHILDREN } from '../../packages/core/src/start.ts';
import { fakeRunner, GENERIC_CONFIG, ok, tempDir } from '../../packages/core/test/support.ts';
import { CloudTokens, type SecretStore, tokenKey } from '../src/cloud-setup.ts';
import { cloudSetting } from '../src/model/settings.ts';
import { accRunner } from '../src/run.ts';

const ROUTINE = 'trig_01ABCDEFGHJKLMNOPQRSTUVW';
const TOKEN = 'tok_0123456789abcdefghij';
const KEYCHAIN = { 'security find-generic-password': ok(`${TOKEN}\n`), 'security delete-generic-password': ok(), 'security -i': ok() };
const CONFIG = parseConfig({ ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'a' }, agents: { max: 2, cloud: { routine: ROUTINE } } }).config!;

/** VS Code's secret storage, kept in a map, with each write seen. */
function secrets(): SecretStore & { map: Map<string, string>; writes: string[] } {
  const map = new Map<string, string>();
  const writes: string[] = [];
  return { map, writes, get: async (k) => map.get(k), store: async (k, v) => { writes.push(k); map.set(k, v); } };
}

test('a Mac keeps the token in its keychain, Windows in VS Code; Linux (CI) as a Mac', () => {
  assert.equal(cloudTokenHome('darwin'), 'keychain');
  assert.equal(cloudTokenHome('win32'), 'vscode');
  assert.equal(cloudTokenHome('linux'), 'keychain');
});

test('edge case: on Windows acc never runs security, refuses to keep a token itself, and reads one handed to it', () => {
  const calls: string[] = [];
  const r = fakeRunner(KEYCHAIN, calls);
  assert.equal(readCloudToken(r, 'acme/tool', {}, 'win32'), null);
  assert.equal(deleteCloudToken(r, 'acme/tool', {}, 'win32'), false);
  assert.throws(() => writeCloudToken(r, 'acme/tool', TOKEN, {}, 'win32'), /On Windows the Command Center keeps the scheduled task's token, in VS Code: paste it in Set up cloud builders there/);
  assert.deepEqual(calls, [], 'security never ran');
  assert.equal(readCloudToken(r, 'acme/tool', { [CLOUD_TOKEN_ENV]: TOKEN }, 'win32'), TOKEN, 'handed over in the environment');
  assert.equal(readCloudToken(fakeRunner(KEYCHAIN), 'acme/tool', {}, 'darwin'), TOKEN, 'a Mac reads its keychain as before');
});

test('a cloud dispatch typed in a Windows terminal, with no token in its environment, says to start it from the Command Center', () => {
  const r = fakeRunner({ ...KEYCHAIN, 'claude auth status': ok(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })) });
  const needs = cloudNeeds(CONFIG, r, {}, 'win32');
  const token = needs.find((n) => n.id === 'token')!;
  assert.equal(token.ok, false);
  assert.equal(token.fix, WINDOWS_TOKEN_FIX);
  assert.match(token.fix, /Start this from the Command Center: Build it, then Cloud\./);
  assert.equal(cloudReason(needs, 'win32'), 'Cloud builders need the scheduled task\'s token, which the Command Center keeps on Windows: start it from the Command Center');
  assert.equal(cloudNeeds(CONFIG, r, { [CLOUD_TOKEN_ENV]: TOKEN }, 'win32').find((n) => n.id === 'token')!.ok, true, 'the Command Center handed it over');
  assert.equal(cloudReason(cloudNeeds(CONFIG, fakeRunner({ ...KEYCHAIN, 'security find-generic-password': ok('') }), {}, 'darwin'), 'darwin'), 'Cloud builders need the scheduled task\'s token: Setup says how', 'a Mac says Setup');
});

test('Setup\'s token step on Windows fails with where the token is kept, and passes on one handed over', () => {
  const step = CLOUD_STEPS.find((s) => s.id === 'B15.cloud-token')!;
  const ctx = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}): CheckContext => ({ cwd: '/r', run: fakeRunner(KEYCHAIN), env, paths: { root: '/r' } as never, config: CONFIG, configErrors: [], cache: new Map(), version: null, platform });
  const none = step.check(ctx('win32'));
  assert.equal(none.status, 'fail');
  assert.match(none.detail, /No token for acme\/tool was handed over\. On Windows the Command Center keeps/);
  assert.deepEqual(step.check(ctx('win32', { [CLOUD_TOKEN_ENV]: TOKEN })), { status: 'pass', detail: 'The Command Center keeps the token, and handed it over.' });
  assert.deepEqual(step.check(ctx('darwin')), { status: 'pass', detail: 'The token is in the keychain.' });
});

test('Windows: the token goes into secret storage under its repo, and out only in acc\'s environment, never through the keychain', async () => {
  const s = secrets();
  const keychain: string[] = [];
  const tokens = new CloudTokens(s, 'win32', async (root) => { keychain.push(root); return ok(); });
  assert.equal(tokens.inVsCode, true);
  assert.deepEqual(tokens.env('acme/tool'), {}, 'before it is kept: nothing handed over');
  assert.equal(tokens.has('acme/tool'), false);
  await tokens.keep('/r', 'Acme/Tool', ` ${TOKEN} `);
  assert.deepEqual(s.writes, [tokenKey('acme/tool')]);
  assert.equal(s.map.get('acc.cloud.token:acme/tool'), TOKEN, 'trimmed, by the repo in lower case');
  assert.deepEqual(keychain, [], 'the keychain is a Mac\'s');
  assert.deepEqual(tokens.env('acme/tool'), { [CLOUD_TOKEN_ENV]: TOKEN });
  assert.deepEqual(tokens.env('acme/other'), {}, 'another repo gets none');
  assert.deepEqual(tokens.env(null), {}, 'a folder in no project gets none');
  // A new window reads it back from secret storage as the projects load.
  const again = new CloudTokens(s, 'win32', async () => ok());
  await again.load(['acme/tool', 'acme/tool']);
  assert.deepEqual(again.env('acme/tool'), { [CLOUD_TOKEN_ENV]: TOKEN });
});

test('edge case: a token that isn\'t one is refused before it\'s kept anywhere, and one in storage that isn\'t one is never handed over', async () => {
  const s = secrets();
  const tokens = new CloudTokens(s, 'win32', async () => ok());
  await assert.rejects(tokens.keep('/r', 'acme/tool', 'tok short'), /A token is letters, digits, dashes and underscores, 20 or more/);
  assert.deepEqual(s.writes, []);
  s.map.set(tokenKey('acme/tool'), 'not a token');
  await tokens.load(['acme/tool']);
  assert.deepEqual(tokens.env('acme/tool'), {});
});

test('a Mac: the token goes to the keychain through acc, never to secret storage, and acc\'s environment gets nothing from VS Code', async () => {
  const s = secrets();
  const kept: { root: string; token: string }[] = [];
  const tokens = new CloudTokens(s, 'darwin', async (root, token) => { kept.push({ root, token }); return ok(); });
  await tokens.keep('/r', 'acme/tool', TOKEN);
  assert.deepEqual(kept, [{ root: '/r', token: TOKEN }]);
  assert.deepEqual(s.writes, [], 'nothing in VS Code\'s storage on a Mac');
  assert.equal(tokens.has('acme/tool'), null, 'acc\'s check reads the keychain');
  assert.deepEqual(tokens.env('acme/tool'), {});
  const failed = new CloudTokens(s, 'darwin', async () => ({ code: 1, stdout: JSON.stringify({ message: '✗ The keychain wouldn\'t keep the token: locked' }), stderr: '' }));
  await assert.rejects(failed.keep('/r', 'acme/tool', TOKEN), /^Error: The keychain wouldn't keep the token: locked$/);
});

test('the token is never written to a file or the project\'s settings: CloudTokens and the session write no file, and the config holds no token field', () => {
  const sources = ['../src/cloud-setup.ts', '../src/model/cloud-setup.ts'].map((f) => readFileSync(join(import.meta.dirname, f), 'utf8'));
  for (const src of sources) assert.doesNotMatch(src, /writeFile|appendFile|createWriteStream|node:fs/, 'no file is written');
  assert.equal(Object.hasOwn(CONFIG.agents.cloud!, 'token'), false);
});

test('acc hands the token to no program it starts: a child sees neither the token nor a new one', () => {
  const env = { ...process.env, [CLOUD_TOKEN_ENV]: TOKEN, ACC_CLOUD_TOKEN_NEW: TOKEN, KEEP_ME: 'yes' };
  assert.deepEqual([...KEPT_FROM_CHILDREN], [CLOUD_TOKEN_ENV, 'ACC_CLOUD_TOKEN_NEW']);
  const kept = childEnv(env);
  assert.equal(kept[CLOUD_TOKEN_ENV], undefined);
  assert.equal(kept.ACC_CLOUD_TOKEN_NEW, undefined);
  assert.equal(kept.KEEP_ME, 'yes', 'everything else goes through');
  const r = run(process.execPath, ['-e', `process.stdout.write([process.env.${CLOUD_TOKEN_ENV} ?? 'none', process.env.KEEP_ME].join(','))`], { env });
  assert.equal(r.stdout, 'none,yes');
});

test('the Command Center hands the token to acc: once it says so, the acc it starts sees it in its environment', async () => {
  const { handsTokenToAcc } = await import('../../packages/core/src/start.ts');
  handsTokenToAcc();
  // A stand-in for acc's bundle that prints what it was handed.
  const dir = tempDir('cloud-acc-');
  const script = join(dir, 'acc.mjs');
  writeFileSync(script, `process.stdout.write(process.env.${CLOUD_TOKEN_ENV} ?? 'none')`);
  const r = await accRunner(script, (cwd): Record<string, string> => (cwd === dir ? { [CLOUD_TOKEN_ENV]: TOKEN } : {}))(['dispatch', 'T-1', '--cloud'], dir);
  assert.equal(r.stdout, TOKEN);
  assert.equal((await accRunner(script)(['dispatch'], dir)).stdout, 'none', 'nothing extra given, nothing handed over');
});

test('Token… is on on every system, Windows too, with the scheduled task\'s words', () => {
  const p = { name: 'P', root: '/p', branch: null, worktrees: [], config: { github: { repo: 'o/r', account: 'a' }, environments: [], profile: 'generic', agents: { cloud: { routine: ROUTINE, default: 'local', quietMinutes: 120, max: 3, review: 'local' } } } } as never;
  const token = cloudSetting(p)!.actions.find((a) => a.command === 'acc.cloud.token')!;
  assert.equal(token.disabled, null);
  assert.equal(token.name, 'Token: keep the scheduled task\'s token for P');
});
