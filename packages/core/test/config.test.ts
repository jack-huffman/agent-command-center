import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { autoMergeFor, autoMergeOn, branchFor, defaultEnvironment, loadConfig, parseConfig, skippedOnRoute, trackerForKey, withTracker, writeConfig } from '../src/config.ts';
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

test('a config acc writes with trackers loads again: what a tracker doesn\'t set stays out of the file, as acc init --jira-site writes it', () => {
  const trackers = [{ kind: 'jira', site: 'acme.atlassian.net', project: 'MSP' }, { kind: 'github', skipLabels: ['milestone'], edits: true }];
  const { config, errors } = parseConfig({ ...clone(SF_CONFIG), trackers });
  assert.deepEqual(errors, []);
  const file = join(tempDir(), 'config.json');
  writeConfig(file, config!);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).trackers, trackers, 'no "prefix": null, which wouldn\'t load');
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

test('this repo lists its decision log as append-only, and lets autopilot merge under autonomy review (GH-67)', () => {
  const file = join(import.meta.dirname, '..', '..', '..', '.acc', 'config.json');
  const { config } = loadConfig(file);
  assert.deepEqual(config.autopilot, { appendOnly: ['docs/DECISIONS.md'], autoMerge: true });
  assert.equal(config.autonomy, 'review');
  assert.equal(autoMergeFor(config, 'main'), true);
});

test('autopilot.autoMerge: off unless it\'s true, a boolean, never in a Salesforce project, and never into a protected environment (GH-67)', () => {
  const on = parseConfig({ ...clone(GENERIC_CONFIG), autonomy: 'review', autopilot: { autoMerge: true } });
  assert.deepEqual([on.errors, on.warnings, on.config!.autopilot], [[], [], { appendOnly: [], autoMerge: true }]);
  assert.deepEqual(parseConfig({ ...clone(GENERIC_CONFIG), autopilot: { autoMerge: false } }).config!.autopilot, { appendOnly: [] }, 'false is the same as left out');
  assert.match(errorsOf({ ...clone(GENERIC_CONFIG), autopilot: { autoMerge: 'yes' } }), /"autopilot\.autoMerge" must be true or false/);
  const sf = parseConfig({ ...clone(SF_CONFIG), autopilot: { autoMerge: true } });
  assert.equal(sf.config, null);
  assert.deepEqual(sf.errors, ['"autopilot.autoMerge" can\'t be on in a Salesforce project: a person merges every pull request there.']);
  assert.deepEqual(parseConfig({ ...clone(SF_CONFIG), autopilot: { autoMerge: false } }).errors, [], 'off is fine');

  // A protected environment, and one that isn't listed, are never covered; nor is any under manual.
  const envs = { environments: [{ name: 'main', default: true }, { name: 'release', protected: true }] };
  const config = parseConfig({ ...clone(GENERIC_CONFIG), ...envs, autonomy: 'review', autopilot: { autoMerge: true } }).config!;
  assert.deepEqual([autoMergeOn(config), autoMergeFor(config, 'main'), autoMergeFor(config, 'release'), autoMergeFor(config, 'nowhere')], [true, true, false, false]);
  assert.equal(autoMergeFor({ ...config, autonomy: 'manual' }, 'main'), false);
  assert.equal(autoMergeFor({ ...config, autopilot: { appendOnly: [] } }, 'main'), false);
  // A config the parser refused can't get past either: Salesforce is off whatever it says.
  assert.equal(autoMergeOn({ profile: 'salesforce', autopilot: { autoMerge: true } }), false);

  const dir = tempDir();
  writeConfig(join(dir, 'config.json'), on.config!);
  assert.deepEqual(loadConfig(join(dir, 'config.json')).config.autopilot, { appendOnly: [], autoMerge: true }, 'written back as it was');
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
  assert.deepEqual(ok.config!.trackers[0], { kind: 'azure', site: null, project: 'CRM', repo: null, organization: 'acme', team: 'Sales', board: 'Stories', prefix: 'AV', skipLabels: [], epic: null, labels: [], areaPath: null, edits: false });
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

test('a tracker\'s ticket fields are read-only unless it says "edits": true, and only true or false will do (D-066)', () => {
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

test('a ticket key belongs to the tracker that owns it: GitHub, the Azure prefix, the Jira project, not the first of its kind (D-066)', () => {
  const list = [{ kind: 'jira' as const, project: 'OPS', prefix: null }, { kind: 'azure' as const, project: 'CRM', prefix: 'AV' }, { kind: 'jira' as const, project: 'MSP', prefix: null }, { kind: 'github' as const, project: null, prefix: null }];
  assert.deepEqual(['MSP-7', 'msp-7', 'OPS-1', 'AV-12', 'GH-41', 'AB-3', 'CRM-2'].map((k) => trackerForKey(list, k)), [2, 2, 0, 1, 3, null, null]);
  assert.equal(trackerForKey([{ kind: 'azure', project: 'CRM', prefix: null }], 'AB-3'), 0, 'Azure keys are AB- by default');
});

test('re-adding a tracker keeps the settings it had, in its place; a new one goes last (D-048)', () => {
  const list = [{ kind: 'github', skipLabels: ['milestone'] }, { kind: 'jira', site: 'acme.atlassian.net', project: 'CRM' }];
  assert.deepEqual(withTracker(list, { kind: 'github' }), [{ kind: 'github', skipLabels: ['milestone'] }, list[1]], 'skipLabels survive');
  assert.deepEqual(withTracker(list, { kind: 'jira', site: 'acme.atlassian.net', project: 'CRM', board: 7 }), [list[0], { ...list[1], board: 7 }]);
  assert.deepEqual(withTracker(list, { kind: 'jira', site: 'acme.atlassian.net', project: 'OPS' }).map((t) => t.project), [undefined, 'CRM', 'OPS'], 'another project is another tracker');
});

test('a tracker names its place: a Jira epic, GitHub labels or an Azure area path; a wrong type is an error, the wrong kind a warning (D-072)', () => {
  const base = clone(GENERIC_CONFIG);
  const one = (t: Record<string, unknown>) => parseConfig({ ...base, trackers: [t] });
  const jira = one({ kind: 'jira', site: 's', project: 'ACME', epic: 'acme-3' }).config!.trackers[0]!;
  assert.deepEqual([jira.epic, jira.labels, jira.areaPath], ['ACME-3', [], null], 'an epic key is upper-cased');
  assert.deepEqual(one({ kind: 'github', labels: ['billing', 'invoices'] }).config!.trackers[0]!.labels, ['billing', 'invoices']);
  assert.equal(one({ kind: 'azure', organization: 'a', project: 'CRM', areaPath: 'CRM\\Billing' }).config!.trackers[0]!.areaPath, 'CRM\\Billing');
  const plain = one({ kind: 'jira', site: 's', project: 'K' }).config!.trackers[0]!;
  assert.deepEqual([plain.epic, plain.labels, plain.areaPath], [null, [], null], 'unset, the whole project');

  for (const bad of ['Premium Support', 3, ['ACME-3']]) assert.match(errorsOf({ ...base, trackers: [{ kind: 'jira', site: 's', project: 'K', epic: bad }] }), /trackers\[0\]: "epic" must be a Jira epic's key/, JSON.stringify(bad));
  for (const bad of ['billing', [3], ['ok', '']]) assert.match(errorsOf({ ...base, trackers: [{ kind: 'github', labels: bad }] }), /trackers\[0\]: "labels" must be a list of label names/, JSON.stringify(bad));
  for (const bad of ['', 7, ['CRM']]) assert.match(errorsOf({ ...base, trackers: [{ kind: 'azure', organization: 'a', project: 'b', areaPath: bad }] }), /trackers\[0\]: "areaPath" must be an Azure DevOps area path/, JSON.stringify(bad));

  const wrong = parseConfig({ ...base, trackers: [{ kind: 'github', epic: 'ACME-3', areaPath: 'CRM' }, { kind: 'jira', site: 's', project: 'K', labels: ['billing'] }] });
  assert.deepEqual(wrong.errors, []);
  assert.match(wrong.warnings.join('\n'), /trackers\[0\]: "epic" applies only to a Jira tracker, so it's ignored/);
  assert.match(wrong.warnings.join('\n'), /trackers\[0\]: "areaPath" applies only to an Azure DevOps tracker/);
  assert.match(wrong.warnings.join('\n'), /trackers\[1\]: "labels" applies only to a GitHub tracker/);
  assert.deepEqual([wrong.config!.trackers[0]!.epic, wrong.config!.trackers[1]!.labels], [null, []], 'and it isn\'t kept');
});

test('a place is written as it was given, left out when unset, and re-adding a tracker as the whole project clears it (D-072)', () => {
  const base = clone(GENERIC_CONFIG);
  const file = join(tempDir(), '.acc', 'config.json');
  const trackers = [{ kind: 'jira', site: 's', project: 'ACME', epic: 'ACME-3' }, { kind: 'github', labels: ['billing'] }, { kind: 'azure', organization: 'a', project: 'CRM', areaPath: 'CRM\\Billing' }, { kind: 'jira', site: 's', project: 'OPS' }];
  writeConfig(file, parseConfig({ ...base, trackers }).config!);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).trackers, trackers, 'round-trips, with no empty keys');
  assert.deepEqual(loadConfig(file).config.trackers.map((t) => [t.epic, t.labels, t.areaPath]), [['ACME-3', [], null], [null, ['billing'], null], [null, [], 'CRM\\Billing'], [null, [], null]]);

  assert.deepEqual(withTracker([trackers[0]!], { kind: 'jira', site: 's', project: 'ACME', epic: null }), [{ kind: 'jira', site: 's', project: 'ACME' }], 'null clears the epic');
  assert.deepEqual(withTracker([{ kind: 'github', labels: ['billing'], skipLabels: ['milestone'] }], { kind: 'github', labels: null }), [{ kind: 'github', skipLabels: ['milestone'] }], 'and the labels, keeping the rest');
  assert.deepEqual(withTracker([trackers[2]!], { kind: 'azure', organization: 'a', project: 'CRM', board: 'Stories', areaPath: null }), [{ kind: 'azure', organization: 'a', project: 'CRM', board: 'Stories' }]);
  assert.deepEqual(withTracker([], { kind: 'jira', site: 's', project: 'ACME', epic: null }), [{ kind: 'jira', site: 's', project: 'ACME' }], 'a new one is written without it');
  assert.deepEqual(withTracker([trackers[0]!], { kind: 'jira', site: 's', project: 'ACME', epic: 'ACME-9' }), [{ ...trackers[0], epic: 'ACME-9' }], 'or picks another');
});

