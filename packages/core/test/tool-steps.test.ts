// Setup's step for the tools a project's checks need (T-68): the config's "tools" list, each tool's check
// run in the repo, and its fix offered when the check fails. A project that lists none skips the step.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { makeContext } from '../src/onboarding/helpers.ts';
import { STEPS } from '../src/onboarding/steps.ts';
import { TOOL_STEPS } from '../src/onboarding/tool-steps.ts';
import { fakeRunner, GENERIC_CONFIG, makeRepo, ok } from './support.ts';

const SHELL = { title: 'The pinned headless shell', why: 'The screenshot run draws with it.', check: 'npm run browser -- --check', fix: 'npm run browser' };
const repoWith = (tools?: unknown) => makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, ...(tools === undefined ? {} : { tools }) }) });
const step = TOOL_STEPS[0]!;

test('the step is registered with Setup\'s, after the required checks', () => {
  const ids = STEPS.map((s) => s.id);
  assert.equal(ids.indexOf('B13.tools'), ids.indexOf('B13.gate-tools') + 1);
});

test('the config reads "tools", and refuses one that is missing a command', () => {
  assert.deepEqual(parseConfig({ ...GENERIC_CONFIG, tools: [SHELL] }).config?.tools, [SHELL]);
  assert.equal(parseConfig(GENERIC_CONFIG).config?.tools, undefined, 'none listed: none');
  const bad = parseConfig({ ...GENERIC_CONFIG, tools: [{ title: 'x', why: 'y', check: 'true' }] });
  assert.equal(bad.config, null);
  assert.match(bad.errors.join('\n'), /"tools" must be a list of tools/);
});

test('a project that lists no tools skips the step', () => {
  const r = step.check(makeContext(repoWith(), fakeRunner({})));
  assert.deepEqual([r.status, r.detail], ['skip', 'The project lists no tools its checks need.']);
});

test('a tool whose check fails fails the step, saying what the check said, and offers its fix', () => {
  const calls: string[] = [];
  const r = step.check(makeContext(repoWith([SHELL]), fakeRunner({ 'sh -c': { code: 1, stdout: '', stderr: 'chrome-headless-shell isn\'t in the cache.\n' } }, calls)));
  assert.equal(r.status, 'fail');
  assert.equal(r.detail, 'The pinned headless shell isn\'t set up yet: chrome-headless-shell isn\'t in the cache. The screenshot run draws with it.');
  assert.equal(r.fix, 'npm run browser');
  assert.ok(calls.includes('sh -c npm run browser -- --check'), calls.join('\n'));
});

test('every listed tool whose check passes passes the step, naming each', () => {
  const r = step.check(makeContext(repoWith([SHELL, { ...SHELL, title: 'Another' }]), fakeRunner({ 'sh -c': ok('') })));
  assert.deepEqual([r.status, r.detail], ['pass', 'Ready: The pinned headless shell, Another.']);
});
