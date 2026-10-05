import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { branchFor, defaultEnvironment, loadConfig, parseConfig, skippedOnRoute, withTracker, writeConfig } from '../src/config.ts';
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

test('autopilot.appendOnly lists files inside the repo; left out, there\'s no section and nothing is append-only (D-058)', () => {
  const plain = parseConfig(clone(GENERIC_CONFIG));
  assert.deepEqual([plain.errors, plain.warnings, plain.config!.autopilot], [[], [], undefined]);
  assert.doesNotMatch(JSON.stringify(plain.config), /autopilot/, 'so writeConfig never adds it to a config that didn\'t have it');

  const listed = parseConfig({ ...clone(GENERIC_CONFIG), autopilot: { appendOnly: ['docs/DECISIONS.md', 'CHANGELOG.md'] } });
  assert.deepEqual([listed.errors, listed.warnings], [[], []]);
  assert.deepEqual(listed.config!.autopilot, { appendOnly: ['docs/DECISIONS.md', 'CHANGELOG.md'] });
  assert.deepEqual(parseConfig({ ...clone(GENERIC_CONFIG), autopilot: {} }).config!.autopilot, { appendOnly: [] });
  const dir = tempDir();
  writeConfig(join(dir, 'config.json'), listed.config!);
  assert.deepEqual(loadConfig(join(dir, 'config.json')).config.autopilot, listed.config!.autopilot, 'written back as it was');

  const why = /"autopilot\.appendOnly" must be a list of paths inside the repo/;
  for (const appendOnly of ['docs/DECISIONS.md', [3], ['/etc/passwd'], ['../other/DECISIONS.md'], ['docs/../../x'], ['']]) {
    assert.match(errorsOf({ ...clone(GENERIC_CONFIG), autopilot: { appendOnly } }), why, JSON.stringify(appendOnly));
  }
  assert.match(errorsOf({ ...clone(GENERIC_CONFIG), autopilot: ['docs/DECISIONS.md'] }), /"autopilot" must be an object/);
  assert.deepEqual(parseConfig({ ...clone(GENERIC_CONFIG), autopilot: { appendOnly: [], appendonly: ['x'] } }).warnings, ['Unknown key "autopilot.appendonly" is ignored.']);
});

test('this repo lists its decision log as append-only', () => {
  const file = join(import.meta.dirname, '..', '..', '..', '.acc', 'config.json');
  assert.deepEqual(loadConfig(file).config.autopilot, { appendOnly: ['docs/DECISIONS.md'] });
});

test('loadConfig explains a missing or broken file', () => {
  const dir = tempDir();
  assert.throws(() => loadConfig(join(dir, 'nope.json')), /Run "acc init" first/);
});

test('an Azure DevOps tracker names its organization and project, and may name a team, board and key prefix', async () => {
  const { parseConfig } = await import('../src/config.ts');
  const base = { schema: 1, project: 'P', profile: 'generic', environments: [{ name: 'main', default: true }] };
  const ok = parseConfig({ ...base, trackers: [{ kind: 'azure', organization: 'acme', project: 'CRM', team: 'Sales', board: 'Stories', prefix: 'av' }] });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.config!.trackers[0], { kind: 'azure', site: null, project: 'CRM', repo: null, organization: 'acme', team: 'Sales', board: 'Stories', prefix: 'AV', skipLabels: [], edits: false });
  assert.match(parseConfig({ ...base, trackers: [{ kind: 'azure', project: 'CRM' }] }).errors.join(), /needs "organization" and "project"/);
  assert.match(parseConfig({ ...base, trackers: [{ kind: 'azure', organization: 'a', project: 'b', board: 3 }] }).errors.join(), /an Azure board's name/);
  assert.match(parseConfig({ ...base, trackers: [{ kind: 'jira', site: 's', project: 'K', board: 'Main' }] }).errors.join(), /Jira board id/);
});

test('a GitHub tracker may name labels whose issues aren\'t imported, and nothing is skipped by default', () => {
  const base = clone(GENERIC_CONFIG);
  assert.deepEqual(parseConfig({ ...base, trackers: [{ kind: 'github' }] }).config!.trackers[0]!.skipLabels, []);
  assert.deepEqual(parseConfig({ ...base, trackers: [{ kind: 'github', skipLabels: ['milestone', 'epic'] }] }).config!.trackers[0]!.skipLabels, ['milestone', 'epic']);
  for (const bad of ['milestone', [3], ['ok', ''], { milestone: true }, null]) {
    assert.match(errorsOf({ ...base, trackers: [{ kind: 'github', skipLabels: bad }] }), /"skipLabels" must be a list of label names/, JSON.stringify(bad));
  }
  const jira = parseConfig({ ...base, trackers: [{ kind: 'jira', site: 's', project: 'K', skipLabels: ['epic'] }] });
  assert.match(jira.warnings.join(), /applies only to a GitHub tracker/);
  assert.deepEqual(jira.config!.trackers[0]!.skipLabels, []);
});

test('a tracker\'s ticket fields are read-only unless it says "edits": true, and only true or false will do (D-???)', () => {
  const base = clone(GENERIC_CONFIG);
  assert.equal(parseConfig({ ...base, trackers: [{ kind: 'jira', site: 's', project: 'K' }] }).config!.trackers[0]!.edits, false);
  assert.equal(parseConfig({ ...base, trackers: [{ kind: 'github', edits: true }] }).config!.trackers[0]!.edits, true);
  assert.equal(parseConfig({ ...base, trackers: [{ kind: 'github', edits: false }] }).config!.trackers[0]!.edits, false);
  for (const bad of ['yes', 1, null, ['true']]) assert.match(errorsOf({ ...base, trackers: [{ kind: 'github', edits: bad }] }), /trackers\[0\]: "edits" must be true or false/, JSON.stringify(bad));
  // Written back, a tracker names edits only when it's on.
  const file = join(tempDir(), '.acc', 'config.json');
  writeConfig(file, parseConfig({ ...base, trackers: [{ kind: 'github', edits: true }, { kind: 'jira', site: 's', project: 'K' }] }).config!);
  const written = JSON.parse(readFileSync(file, 'utf8')).trackers;
  assert.deepEqual([written[0].edits, 'edits' in written[1]], [true, false]);
  assert.deepEqual(withTracker([{ kind: 'github', edits: true }], { kind: 'github', board: 3 }), [{ kind: 'github', edits: true, board: 3 }], 're-adding a tracker keeps edits');
});

test('this repo\'s own GitHub tracker may change its tickets\' fields', () => {
  const file = join(import.meta.dirname, '..', '..', '..', '.acc', 'config.json');
  assert.deepEqual(loadConfig(file).config.trackers.map((t) => [t.kind, t.edits]), [['github', true]]);
});

test('re-adding a tracker keeps the settings it had, in its place; a new one goes last (D-048)', () => {
  const list = [{ kind: 'github', skipLabels: ['milestone'] }, { kind: 'jira', site: 'acme.atlassian.net', project: 'CRM' }];
  assert.deepEqual(withTracker(list, { kind: 'github' }), [{ kind: 'github', skipLabels: ['milestone'] }, list[1]], 'skipLabels survive');
  assert.deepEqual(withTracker(list, { kind: 'jira', site: 'acme.atlassian.net', project: 'CRM', board: 7 }), [list[0], { ...list[1], board: 7 }]);
  assert.deepEqual(withTracker(list, { kind: 'jira', site: 'acme.atlassian.net', project: 'OPS' }).map((t) => t.project), [undefined, 'CRM', 'OPS'], 'another project is another tracker');
});

