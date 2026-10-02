import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { branchFor, defaultEnvironment, loadConfig, parseConfig, skippedOnRoute, writeConfig } from '../src/config.ts';
import { GENERIC_CONFIG, SF_CONFIG, tempDir } from './support.ts';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const errorsOf = (raw: unknown) => parseConfig(raw).errors.join('\n');

test('a complete Salesforce config parses, with derived branches and Production protected', () => {
  const { config, errors } = parseConfig(clone(SF_CONFIG));
  assert.deepEqual(errors, []);
  assert.ok(config);
  assert.deepEqual(config.environments.map((e) => e.branch), ['production', 'uat', 'dev']);
  assert.equal(config.environments[0]!.protected, true);
  assert.equal(defaultEnvironment(config).branch, 'dev');
  assert.deepEqual(config.secretScan.paths, ['force-app', 'config', 'scripts']);
  assert.equal(config.autonomy, 'manual');
  assert.equal(config.agents.permissionMode, 'acceptEdits');
});

test('a generic config fills its defaults', () => {
  const { config, errors } = parseConfig(clone(GENERIC_CONFIG));
  assert.deepEqual(errors, []);
  assert.equal(config!.environments[0]!.type, 'none');
  assert.equal(config!.agents.max, 3);
  assert.deepEqual(config!.secretScan.paths, ['.']);
});

test('branch names are the lower-cased environment name (D-015)', () => {
  assert.equal(branchFor('Devbox'), 'devbox');
  assert.equal(branchFor('Full Copy'), 'full-copy');
  const raw = clone(SF_CONFIG);
  (raw.environments[2] as Record<string, unknown>).branch = 'develop';
  assert.match(errorsOf(raw), /must be "dev", the environment name in lower case \(D-015\)/);
  (raw.environments[2] as Record<string, unknown>).branch = 'dev';
  assert.equal(errorsOf(raw), '');
});

test('exactly one default environment, and it is not protected', () => {
  const none = clone(SF_CONFIG);
  delete (none.environments[2] as Record<string, unknown>).default;
  assert.match(errorsOf(none), /exactly one environment as "default"/);
  const two = clone(SF_CONFIG);
  (two.environments[1] as Record<string, unknown>).default = true;
  assert.match(errorsOf(two), /exactly one/);
  const prot = clone(SF_CONFIG);
  (prot.environments[0] as Record<string, unknown>).default = true;
  delete (prot.environments[2] as Record<string, unknown>).default;
  assert.match(errorsOf(prot), /can't be protected/);
});

test('Production cannot be unprotected', () => {
  const raw = clone(SF_CONFIG);
  (raw.environments[0] as Record<string, unknown>).protected = false;
  assert.match(errorsOf(raw), /Production is always protected/);
});

test('promotion targets must exist, not loop, and not point at themselves (D-018)', () => {
  const missing = clone(SF_CONFIG);
  missing.environments[2]!.promotesTo = ['qa'];
  assert.match(errorsOf(missing), /promotes to "qa", which isn't a listed environment/);
  const self = clone(SF_CONFIG);
  self.environments[2]!.promotesTo = ['dev'];
  assert.match(errorsOf(self), /can't promote to itself/);
  const loop = clone(SF_CONFIG);
  loop.environments[1]!.promotesTo = ['dev'];
  assert.match(errorsOf(loop), /loop: (dev → uat → dev|uat → dev → uat)/);
});

test('Salesforce environments need a type; bypassPermissions is never allowed', () => {
  const raw = clone(SF_CONFIG);
  delete (raw.environments[1] as Record<string, unknown>).type;
  assert.match(errorsOf(raw), /"type" must be one of/);
  const perm = clone(SF_CONFIG);
  (perm.agents as Record<string, unknown>).permissionMode = 'bypassPermissions';
  assert.match(errorsOf(perm), /bypassPermissions is never allowed/);
});

test('duplicate branches and bad shapes are reported, unknown keys are warnings', () => {
  const dup = clone(SF_CONFIG);
  dup.environments.push({ name: 'DEV', type: 'developer', org: 'x' });
  assert.match(errorsOf(dup), /share the branch "dev"/);
  assert.match(errorsOf({ schema: 2 }), /"schema" must be 1/);
  assert.match(errorsOf({ ...clone(GENERIC_CONFIG), agents: { max: 40 } }), /1 to 16/);
  assert.match(errorsOf({ ...clone(GENERIC_CONFIG), github: { repo: 'nope' } }), /owner\/name/);
  assert.match(errorsOf({ ...clone(GENERIC_CONFIG), trackers: [{ kind: 'jira' }] }), /needs "site" and "project"/);
  assert.deepEqual(parseConfig({ ...clone(GENERIC_CONFIG), colour: 'blue' }).warnings, ['Unknown key "colour" is ignored.']);
});

test('skippedOnRoute names what a direct promotion skips (D-018)', () => {
  const { config } = parseConfig(clone(SF_CONFIG));
  assert.deepEqual(skippedOnRoute(config!, 'dev', 'production'), ['uat']);
  assert.deepEqual(skippedOnRoute(config!, 'dev', 'uat'), []);
  assert.deepEqual(skippedOnRoute(config!, 'uat', 'production'), []);
});

test('writeConfig round-trips and leaves derived branches out of the file', () => {
  const dir = tempDir();
  const file = join(dir, '.acc', 'config.json');
  const { config } = parseConfig(clone(SF_CONFIG));
  writeConfig(file, config!);
  assert.doesNotMatch(readFileSync(file, 'utf8'), /"branch"/);
  assert.deepEqual(loadConfig(file).config, config);
});

test('loadConfig explains a missing or broken file', () => {
  const dir = tempDir();
  assert.throws(() => loadConfig(join(dir, 'nope.json')), /Run "acc init" first/);
});
