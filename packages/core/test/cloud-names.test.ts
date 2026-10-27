// Cloud builders' exports (GH-69), each named by a test that fails without it (T-13): the routine's page and
// prompt, the sign-in and the token, a run's page, opting in and out with the defaults, Setup's cloud steps,
// and where acc keeps what it saw of each environment branch.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { branchesPath, readBranches } from '../src/branches.ts';
import { claudeLogin, CLOUD_TOKEN, cloudOffered, cloudUrl, deleteCloudToken, disableCloud, enableCloud, ROUTINES_URL } from '../src/cloud.ts';
import { BUILDER_PLACES, CLOUD_MAX, CLOUD_QUIET_MINUTES, parseConfig, ROUTINE_ID } from '../src/config.ts';
import { CLOUD_STEPS, ROUTINE_PROMPT } from '../src/onboarding/cloud-steps.ts';
import type { CheckContext } from '../src/onboarding/types.ts';
import { bad, fakeRunner, GENERIC_CONFIG, ok, tempDir } from './support.ts';

const ROUTINE = 'trig_01ABCDEFGHJKLMNOPQRSTUVW';
const RAW = { ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'acme-bot' } };

/** A config file on disk, as enableCloud and disableCloud edit it, and what it parses to. */
function configFile(raw: Record<string, unknown> = RAW): string {
  const file = join(tempDir('cloud-config-'), 'config.json');
  writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  return file;
}
const parsed = (file: string) => parseConfig(JSON.parse(readFileSync(file, 'utf8')));

test('the routine\'s page, its id and its token have one shape each, and a near miss is refused', () => {
  assert.equal(ROUTINES_URL, 'https://claude.ai/code/routines');
  assert.match(cloudOffered({ github: { repo: 'acme/tool' }, agents: { cloud: null } }).find((n) => n.id === 'routine')!.fix, /at https:\/\/claude\.ai\/code\/routines, with an API trigger/);
  assert.equal(ROUTINE_ID.test(ROUTINE), true);
  for (const id of ['trig_short', 'trg_01ABCDEFGHJK', '', `${ROUTINE} `]) assert.equal(ROUTINE_ID.test(id), false, `${JSON.stringify(id)}: not a trigger id`);
  assert.equal(CLOUD_TOKEN.test('tok_0123456789abcdefghij'), true);
  for (const t of ['tok_short', 'tok 0123456789abcdefghij', '', 'tok_0123456789abcdefghij\n']) assert.equal(CLOUD_TOKEN.test(t), false, `${JSON.stringify(t)}: not a token`);
});

test('the routine\'s prompt opts in to the fire\'s text alone, and with no payload does nothing', () => {
  assert.match(ROUTINE_PROMPT, /routine-fire-payload block/);
  assert.match(ROUTINE_PROMPT, /Push only that branch\. Never push any other branch, force-push, merge or open a pull request, or deploy\./);
  assert.match(ROUTINE_PROMPT, /If there is no payload, do nothing and stop\.$/);
});

test('claudeLogin says signed in only for a claude.ai account, and why not for each other answer: no claude, signed out, an API key, junk', () => {
  const login = (r: ReturnType<typeof ok>) => claudeLogin(fakeRunner({ 'claude auth status': r }), {});
  assert.deepEqual(login(ok(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'me@example.com' }))), { ok: true, why: '', email: 'me@example.com' });
  assert.deepEqual(login(ok(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }))), { ok: true, why: '' }, 'no email: none made up');
  assert.deepEqual(login(bad('not found', 127)), { ok: false, why: 'The Claude Code CLI (claude) isn\'t on PATH.' });
  assert.deepEqual(login(ok(JSON.stringify({ loggedIn: false }))), { ok: false, why: 'Claude Code isn\'t signed in.' });
  assert.match(login(ok(JSON.stringify({ loggedIn: true, authMethod: 'console' }))).why, /signed in with console, and cloud sessions need a claude\.ai account/);
  assert.deepEqual(login(ok('not json')), { ok: false, why: 'claude auth status didn\'t answer.' });
});

test('deleteCloudToken takes the repo\'s token out of the keychain, and says false when there was none', () => {
  const calls: string[] = [];
  assert.equal(deleteCloudToken(fakeRunner({ 'security delete-generic-password': ok() }, calls), 'acme/tool', {}, 'darwin'), true);
  assert.deepEqual(calls, ['security delete-generic-password -s acc-cloud-routine -a acme/tool']);
  assert.equal(deleteCloudToken(fakeRunner({ 'security delete-generic-password': bad('not found', 44) }), 'acme/tool', {}, 'darwin'), false);
});

test('cloudUrl is a cloud run\'s session page, and null before the fire answers or for a local run', () => {
  assert.equal(cloudUrl({ cloud: { url: 'https://claude.ai/code/session_01TEST' } }), 'https://claude.ai/code/session_01TEST');
  assert.equal(cloudUrl({ cloud: { url: null as never } }), null);
  assert.equal(cloudUrl({}), null, 'a local run');
  assert.equal(cloudUrl(null), null, 'no run yet');
});

test('enableCloud opts in with the defaults, changes one key at a time after, refuses a bad value, and disableCloud takes the section out: the edge case of an empty change', () => {
  const file = configFile();
  assert.equal(parsed(file).config!.agents.cloud, null, 'off until a person opts in');
  enableCloud(file, {}, null);
  assert.deepEqual(parsed(file).config!.agents.cloud, { routine: null, default: 'local', quietMinutes: CLOUD_QUIET_MINUTES, max: CLOUD_MAX, review: 'local' });
  assert.deepEqual([CLOUD_QUIET_MINUTES, CLOUD_MAX], [120, 3]);
  const current = parsed(file).config!.agents.cloud;
  enableCloud(file, { routine: ROUTINE, default: 'cloud', max: 5 }, current);
  assert.deepEqual(parsed(file).config!.agents.cloud, { routine: ROUTINE, default: 'cloud', quietMinutes: CLOUD_QUIET_MINUTES, max: 5, review: 'local' });
  assert.throws(() => enableCloud(file, { routine: 'trig_bad' }, current), /looks like trig_01ABC/);
  assert.throws(() => enableCloud(file, { default: 'moon' as never }, current), new RegExp(`The default is one of ${BUILDER_PLACES.join(', ')}\\.`));
  assert.deepEqual([...BUILDER_PLACES], ['local', 'cloud']);
  assert.throws(() => enableCloud(file, { quietMinutes: 4 }, current), /from 5 to 1440/);
  assert.throws(() => enableCloud(file, { max: 17 }, current), /from 1 to 16/);
  assert.match(parsed(file).config!.agents.cloud!.routine ?? '', ROUTINE_ID, 'a refused change wrote nothing');
  disableCloud(file);
  assert.equal(parsed(file).config!.agents.cloud, null);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).github.repo, 'acme/tool', 'the rest of the file stays');
});

test('Setup\'s cloud steps skip a project that hasn\'t opted in, and check each need of one that has', () => {
  assert.deepEqual(CLOUD_STEPS.map((s) => s.id), ['B15.cloud-github-app', 'B15.cloud-routine', 'B15.cloud-token', 'B15.cloud-login', 'B15.cloud-guard']);
  const ctx = (cloud: unknown, fixtures: Parameters<typeof fakeRunner>[0] = {}): CheckContext => ({
    cwd: '/r', run: fakeRunner(fixtures), env: {}, paths: { root: '/r' } as never, config: parseConfig({ ...RAW, agents: { max: 2, cloud } }).config, configErrors: [], cache: new Map(), version: null, platform: 'darwin',
  });
  const step = (id: string) => CLOUD_STEPS.find((s) => s.id === id)!;
  for (const s of CLOUD_STEPS) assert.equal(s.check(ctx(null)).status, 'skip', `${s.id}: skipped when not opted in`);
  assert.equal(step('B15.cloud-routine').check(ctx({})).status, 'fail', 'opted in with no routine');
  assert.equal(step('B15.cloud-routine').check(ctx({ routine: ROUTINE })).status, 'pass');
  assert.equal(step('B15.cloud-token').check(ctx({ routine: ROUTINE }, { 'security find-generic-password': ok('tok_0123456789abcdefghij\n') })).status, 'pass');
  assert.equal(step('B15.cloud-token').check(ctx({ routine: ROUTINE }, { 'security find-generic-password': bad('not found', 44) })).status, 'fail');
  assert.equal(step('B15.cloud-login').check(ctx({}, { 'claude auth status': ok(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })) })).status, 'pass');
  assert.equal(step('B15.cloud-login').check(ctx({}, { 'claude auth status': ok(JSON.stringify({ loggedIn: false })) })).status, 'fail');
});

test('branchesPath is where readBranches looks: what is written there is read back, and a missing or broken file reads as none', () => {
  const paths = { stateDir: tempDir('state-') };
  assert.equal(branchesPath(paths), join(paths.stateDir, 'branches.json'));
  assert.deepEqual(readBranches(paths), {}, 'no file yet');
  writeFileSync(branchesPath(paths), JSON.stringify({ main: { head: 'abc' } }));
  assert.deepEqual(readBranches(paths), { main: { head: 'abc' } });
  writeFileSync(branchesPath(paths), '{broken');
  assert.deepEqual(readBranches(paths), {});
});
