import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { autoMergeFor, autoMergeOn, branchFor, builderGatesFor, CONFIG_KEYS, defaultEnvironment, fullGates, isEffort, isStr, isTestGate, keyShown, loadConfig, parseConfig, requiredGates, saveTracker, skippedOnRoute, sprintProblem, TIDY_EVERY, tidyEvery, trackerForKey, UNREAD_KEYS, VALIDATOR_ONLY, withTracker, writeConfig } from '../src/config.ts';
import { parseFloors } from '../src/ratchets.ts';
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

test('the team template a project came from round-trips with no warning, and a bad record is refused (GH-80)', () => {
  const template = { name: 'ACME Salesforce', source: 'https://github.com/acme/acc-templates/blob/main/salesforce.json', digest: `sha256:${'a'.repeat(64)}` };
  const { config, errors, warnings } = parseConfig({ ...clone(SF_CONFIG), template });
  assert.deepEqual([errors, warnings], [[], []]);
  assert.deepEqual(config!.template, template);
  const file = join(tempDir(), 'config.json');
  writeConfig(file, config!);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).template, template);
  const again = loadConfig(file);
  assert.deepEqual([again.warnings, again.config], [[], config]);
  assert.equal(parseConfig(clone(SF_CONFIG)).config!.template, undefined, 'without one, there\'s no "template" key');
  for (const bad of [{ ...template, digest: 'md5:abc' }, { ...template, digest: `sha256:${'A'.repeat(64)}` }, { ...template, source: '' }, { name: 'x' }, 'ACME']) {
    assert.match(errorsOf({ ...clone(SF_CONFIG), template: bad }), /"template" needs "name", "source" and "digest"/);
  }
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
  // Its builders run the typecheck and the tests near what they changed; the full check runs in the merge queue (GH-73).
  // Both count the tests npm test runs, a number that may only go up, and quickly enough not to be heavy (GH-99),
  // and both have stray-files, which its config doesn't name (GH-103). Builders also check their UI changes were
  // shot as they are (T-5); the merge queue's checkout has no screenshots, so it doesn't.
  assert.deepEqual([config.gates.builder, config.gates.required, requiredGates(config, 'main', 'builder'), requiredGates(config, 'main', 'merge')], [['typecheck', 'near-tests', 'repo-rules', 'tests', 'screenshots'], ['check', 'tests'], ['typecheck', 'near-tests', 'repo-rules', 'tests', 'screenshots', 'stray-files'], ['check', 'tests', 'stray-files']]);
  assert.deepEqual(Object.keys(config.gates.commands).sort(), ['check', 'near-tests', 'repo-rules', 'screenshots', 'typecheck']);
  assert.deepEqual(config.gates.ratchets, { tests: { command: 'node --no-warnings scripts/count-tests.mjs', limit: 'floor', label: 'tests' } });
  assert.ok(!config.gates.heavy.includes('tests'));
  const floors = parseFloors(readFileSync(join(import.meta.dirname, '..', '..', '..', '.acc', 'floors.json'), 'utf8'));
  assert.ok(floors && Object.keys(floors).length === 1 && (floors.tests?.floor ?? 0) > 0, 'its floors file holds the one floor, measured');
  // Its full check and the tests near a change run tests, so their receipts count what ran (GH-100); the typecheck doesn't.
  assert.deepEqual(['check', 'near-tests', 'typecheck'].map((g) => isTestGate(config, g)), [true, true, false]);
});

test('gates.builder: a list of gate names, kept as written, for builders only where the merge queue runs the full check (GH-73)', () => {
  const raw = { ...clone(GENERIC_CONFIG), autonomy: 'review', autopilot: { autoMerge: true }, gates: { required: ['check'], builder: ['typecheck'], commands: { check: 'npm run check', typecheck: 'tsc' } } };
  const c = parseConfig(raw).config!;
  assert.deepEqual([c.gates.builder, builderGatesFor(c, 'main'), requiredGates(c, 'main', 'builder'), requiredGates(c, 'main', 'merge')], [['typecheck'], true, ['typecheck', 'stray-files'], ['check', 'stray-files']]);
  assert.equal(parseConfig({ ...clone(GENERIC_CONFIG) }).config!.gates.builder, undefined, 'left out: builders run the required checks');
  assert.match(errorsOf({ ...raw, gates: { ...raw.gates, builder: 'typecheck' } }), /"gates\.builder" must be a list of gate names/);
  assert.match(errorsOf({ ...raw, gates: { ...raw.gates, builder: [''] } }), /"gates\.builder" must be a list of gate names/);
  const dir = tempDir();
  writeConfig(join(dir, 'config.json'), c);
  assert.deepEqual(loadConfig(join(dir, 'config.json')).config.gates.builder, ['typecheck'], 'written back as it was');
});

test('gates.ratchets: a command, which way its number may go, and a short label; a name of its own, and written back as it was (GH-99)', () => {
  const tests = { command: 'node scripts/count-tests.mjs', limit: 'floor', label: 'tests' };
  const raw = { ...clone(GENERIC_CONFIG), gates: { required: ['tests'], commands: { check: 'npm run check' }, ratchets: { tests, violations: { command: 'sf code-analyzer run', limit: 'ceiling', label: ' violations ' } } } };
  const c = parseConfig(raw).config!;
  assert.deepEqual(c.gates.ratchets, { tests, violations: { command: 'sf code-analyzer run', limit: 'ceiling', label: 'violations' } });
  assert.equal(parseConfig({ ...clone(GENERIC_CONFIG) }).config!.gates.ratchets, undefined, 'left out: none, and none written');
  const bad = (ratchets: unknown) => errorsOf({ ...raw, gates: { ...raw.gates, ratchets } });
  assert.match(bad([]), /"gates\.ratchets" must map names to \{ "command", "limit", "label" \}/);
  assert.match(bad({ tests: { ...tests, limit: 'up' } }), /"gates\.ratchets\.tests\.limit" must be "floor" \(the number may only go up\) or "ceiling" \(it may only go down\)/);
  assert.match(bad({ tests: { ...tests, command: ' ' } }), /"gates\.ratchets\.tests" needs "command": one whose last line of output is the number/);
  assert.match(bad({ tests: { ...tests, label: '' } }), /"gates\.ratchets\.tests\.label" must be a short name/);
  assert.match(bad({ tests: { ...tests, label: 'the number of tests npm test runs' } }), /up to 24 characters/);
  assert.match(bad({ 'no spaces': tests }), /a ratchet's name is letters, digits/);
  assert.match(bad({ check: tests }), /"gates\.ratchets\.check": check is already a gate in "gates\.commands"\. Give the ratchet a name of its own\./);
  assert.match(errorsOf({ ...clone(SF_CONFIG), gates: { ratchets: { validate: tests } } }), /"gates\.ratchets\.validate": validate is already a gate, built into the salesforce profile/);
  assert.match(parseConfig({ ...raw, gates: { ratchets: { tests: { ...tests, extra: 1 } } } }).warnings.join(), /Unknown key "gates\.ratchets\.tests\.extra" is ignored/);
  const dir = tempDir();
  writeConfig(join(dir, 'config.json'), c);
  assert.deepEqual(loadConfig(join(dir, 'config.json')).config.gates, c.gates, 'written back as it was');
});

test('gates.tests: a list of gate names whose receipts count the tests they ran, besides test and Salesforce\'s lwc-tests (GH-100)', () => {
  const raw = { ...clone(GENERIC_CONFIG), gates: { required: ['check'], tests: ['check'], commands: { check: 'npm run check', test: 'npm test', lint: 'eslint .' } } };
  const c = parseConfig(raw).config!;
  assert.deepEqual(c.gates.tests, ['check']);
  assert.deepEqual(['check', 'test', 'lint', 'lwc-tests'].map((g) => isTestGate(c, g)), [true, true, false, false]);
  assert.equal(isTestGate(parseConfig(clone(SF_CONFIG)).config!, 'lwc-tests'), true, 'Salesforce\'s Jest gate runs tests');
  assert.equal(parseConfig(clone(GENERIC_CONFIG)).config!.gates.tests, undefined, 'left out, only those acc knows');
  for (const bad of ['check', [''], [1], {}]) assert.match(errorsOf({ ...raw, gates: { ...raw.gates, tests: bad } }), /"gates\.tests" must be a list of gate names/, JSON.stringify(bad));
  const dir = tempDir();
  writeConfig(join(dir, 'config.json'), c);
  assert.deepEqual(loadConfig(join(dir, 'config.json')).config.gates.tests, ['check'], 'written back as it was');
});

test('gates.nearIndexes: a list of paths, kept as written; left out or empty, nothing is named; a path that isn\'t a string is refused (D-155)', () => {
  const raw = { ...clone(GENERIC_CONFIG), gates: { required: ['check'], commands: { check: 'npm run check' }, nearIndexes: ['web/main.ts', 'src/cli/index.ts'] } };
  const c = parseConfig(raw).config!;
  assert.deepEqual(c.gates.nearIndexes, ['web/main.ts', 'src/cli/index.ts']);
  assert.deepEqual(parseConfig(raw).warnings, [], 'a key parseConfig knows');
  assert.equal(parseConfig(clone(GENERIC_CONFIG)).config!.gates.nearIndexes, undefined, 'left out, every folder\'s index is guessed');
  assert.deepEqual(parseConfig({ ...raw, gates: { ...raw.gates, nearIndexes: [] } }).config!.gates.nearIndexes, [], 'an empty list names none');
  for (const bad of ['web/main.ts', [1], ['web/main.ts', null], [''], ['  '], {}]) assert.match(errorsOf({ ...raw, gates: { ...raw.gates, nearIndexes: bad } }), /"gates\.nearIndexes" must be a list of paths/, JSON.stringify(bad));
  const dir = tempDir();
  writeConfig(join(dir, 'config.json'), c);
  assert.deepEqual(loadConfig(join(dir, 'config.json')).config.gates.nearIndexes, ['web/main.ts', 'src/cli/index.ts'], 'written back as it was');
});

test('stray-files is required in both profiles and both scopes with nothing set, and strayFiles.required: false turns it off (GH-103)', () => {
  const lighter = { autonomy: 'review', autopilot: { autoMerge: true }, gates: { required: ['check'], builder: ['typecheck'], commands: { check: 'x', typecheck: 'y' } } };
  for (const raw of [clone(GENERIC_CONFIG), { ...clone(GENERIC_CONFIG), ...lighter }, clone(SF_CONFIG)]) {
    const c = parseConfig(raw).config!;
    const env = defaultEnvironment(c).branch;
    assert.deepEqual(c.strayFiles, { required: true, allow: [], data: [] });
    assert.ok(requiredGates(c, env, 'builder').includes('stray-files'), `${c.profile} builder`);
    assert.ok(requiredGates(c, env, 'merge').includes('stray-files'), `${c.profile} merge`);
    assert.ok(fullGates(c).includes('stray-files'));
    const off = parseConfig({ ...raw, strayFiles: { required: false } }).config!;
    assert.ok(![...requiredGates(off, env, 'builder'), ...requiredGates(off, env, 'merge'), ...fullGates(off)].includes('stray-files'), `${c.profile} off`);
  }
  assert.deepEqual(fullGates(parseConfig(clone(SF_CONFIG)).config!), ['format', 'validate', 'stray-files'], 'after the ones the project names');
  assert.deepEqual(fullGates(parseConfig({ ...clone(GENERIC_CONFIG), gates: { required: ['stray-files', 'check'] } }).config!), ['stray-files', 'check'], 'named once');
});

test('strayFiles: allow and data are repo paths, required a boolean, data a warning outside Salesforce, and a team template can\'t set it (GH-103)', () => {
  const sf = parseConfig({ ...clone(SF_CONFIG), strayFiles: { allow: ['LICENSE', 'fixtures/'], data: ['data/samples'] } });
  assert.deepEqual([sf.errors, sf.warnings, sf.config!.strayFiles], [[], [], { required: true, allow: ['LICENSE', 'fixtures/'], data: ['data/samples'] }]);
  assert.match(errorsOf({ ...clone(GENERIC_CONFIG), strayFiles: { allow: ['/etc/passwd'] } }), /"strayFiles\.allow" must be a list of paths inside the repo/);
  assert.match(errorsOf({ ...clone(GENERIC_CONFIG), strayFiles: { allow: ['../x'] } }), /"strayFiles\.allow" must be a list of paths inside the repo/);
  assert.match(errorsOf({ ...clone(SF_CONFIG), strayFiles: { data: 'exports' } }), /"strayFiles\.data" must be a list of folders inside the repo/);
  assert.match(errorsOf({ ...clone(GENERIC_CONFIG), strayFiles: { required: 'no' } }), /"strayFiles\.required" must be true or false/);
  assert.match(errorsOf({ ...clone(GENERIC_CONFIG), strayFiles: ['LICENSE'] }), /"strayFiles" must be an object/);
  const generic = parseConfig({ ...clone(GENERIC_CONFIG), strayFiles: { data: ['exports'] } });
  assert.deepEqual([generic.errors, generic.warnings], [[], ['"strayFiles.data" applies only to a Salesforce project, so it\'s ignored.']]);
});

test('sourceTracking (T-73): left out, a Salesforce project uses it; false is kept; a wrong type is refused; outside Salesforce it\'s ignored with a warning', () => {
  const unset = parseConfig(clone(SF_CONFIG));
  assert.deepEqual([unset.errors, unset.warnings, unset.config!.sourceTracking], [[], [], undefined], 'left out, the project uses source tracking');
  for (const value of [false, true]) {
    const sf = parseConfig({ ...clone(SF_CONFIG), sourceTracking: value });
    assert.deepEqual([sf.errors, sf.warnings, sf.config!.sourceTracking], [[], [], value]);
  }
  for (const wrong of ['no', 0, null, {}]) {
    assert.match(errorsOf({ ...clone(SF_CONFIG), sourceTracking: wrong }), /"sourceTracking" must be true or false: whether the project uses Salesforce source tracking\./, JSON.stringify(wrong));
  }
  const generic = parseConfig({ ...clone(GENERIC_CONFIG), sourceTracking: false });
  assert.deepEqual([generic.errors, generic.warnings], [[], ['"sourceTracking" applies only to a Salesforce project, so it\'s ignored.']]);
  assert.deepEqual(parseConfig({ ...clone(GENERIC_CONFIG), sourceTracking: true }).warnings, [], 'on is the default, so it says nothing to ignore');
  // Written back, a Salesforce project's false stays, and loads again.
  const file = join(tempDir('cfg-'), 'config.json');
  writeConfig(file, parseConfig({ ...clone(SF_CONFIG), sourceTracking: false }).config!);
  assert.equal(loadConfig(file).config.sourceTracking, false);
});

test('code reads the required checks through fullGates and requiredGates, never gates.required itself, but where a template is compared with what the project sets (GH-103)', () => {
  const root = join(import.meta.dirname, '..', '..', '..');
  const files: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else if (/\.ts$/.test(e.name)) files.push(r);
    }
  };
  for (const pkg of readdirSync(join(root, 'packages'))) walk(`packages/${pkg}/src`);
  walk('extension/src');
  assert.ok(files.length > 50, `${files.length} files scanned`);
  // fullGates's own read, and the exceptions, with how far each reaches: in template.ts, B0.template's
  // comparison of the project's raw list with a template's, where stray-files would always differ, and the
  // template's own list as it's shown; and Settings' picker for the required checks, which edits the
  // project's own list (GH-111).
  const EXCEPTIONS: Record<string, number> = { 'packages/core/src/config.ts': 1, 'packages/core/src/template.ts': 2, 'extension/src/limits.ts': 1 };
  const reads = (f: string) => readFileSync(join(root, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /\.gates\.required\b/.test(l)).length;
  assert.deepEqual(Object.fromEntries(files.map((f) => [f, reads(f)]).filter(([, n]) => n)), EXCEPTIONS);
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

test('tidy.every: left out, 8; a whole number from 0 to 100, or an error; it round-trips (GH-104)', () => {
  const plain = parseConfig(clone(GENERIC_CONFIG));
  assert.deepEqual([plain.config!.tidy, tidyEvery(plain.config!), TIDY_EVERY], [undefined, 8, 8]);
  assert.doesNotMatch(JSON.stringify(plain.config), /tidy/, 'writeConfig adds nothing to a config that didn\'t say');
  assert.equal(tidyEvery(parseConfig({ ...clone(GENERIC_CONFIG), tidy: {} }).config!), 8);
  for (const every of [0, 3, 100]) {
    const r = parseConfig({ ...clone(GENERIC_CONFIG), tidy: { every } });
    assert.deepEqual([r.errors, r.warnings, tidyEvery(r.config!)], [[], [], every]);
  }
  let refused = 0;
  for (const every of [-1, 101, 2.5, 'x', null, true]) {
    assert.match(errorsOf({ ...clone(GENERIC_CONFIG), tidy: { every } }), /"tidy\.every" must be a whole number from 0 to 100: how many tasks merge before a tidy-up is offered, or 0 for never\./, JSON.stringify(every));
    refused++;
  }
  assert.equal(refused, 6);
  assert.match(errorsOf({ ...clone(GENERIC_CONFIG), tidy: 8 }), /"tidy" must be an object, such as \{ "every": 8 \}\./);
  assert.deepEqual(parseConfig({ ...clone(GENERIC_CONFIG), tidy: { every: 3, often: 1 } }).warnings, ['Unknown key "tidy.often" is ignored.']);
  const set = parseConfig({ ...clone(GENERIC_CONFIG), tidy: { every: 5 } }).config!;
  const file = join(tempDir(), '.acc', 'config.json');
  writeConfig(file, set);
  assert.deepEqual(loadConfig(file).config.tidy, { every: 5 }, 'written back as it was');
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
  assert.deepEqual(ok.config!.trackers[0], { kind: 'azure', site: null, project: 'CRM', repo: null, organization: 'acme', account: null, workspace: null, channel: null, reaction: null, doneReaction: null, team: 'Sales', board: 'Stories', statusColumn: null, prefix: 'AV', skipLabels: [], epic: null, sprint: null, labels: [], areaPath: null, group: null, edits: false, statusFor: null, changesField: null });
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

test('a monday.com tracker names its account and board, and may name a group, a status column and a key prefix', () => {
  const base = clone(GENERIC_CONFIG);
  const ok = parseConfig({ ...base, trackers: [{ kind: 'monday', account: 'Acme', board: 1234567890, group: 'topics', statusColumn: 'status_1', prefix: 'av' }] });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.config!.trackers[0], { kind: 'monday', site: null, project: null, repo: null, organization: null, account: 'acme', workspace: null, channel: null, reaction: null, doneReaction: null, team: null, board: 1234567890, statusColumn: 'status_1', prefix: 'AV', skipLabels: [], epic: null, sprint: null, labels: [], areaPath: null, group: 'topics', edits: false, statusFor: null, changesField: null });
  for (const bad of [{ board: 1 }, { account: 'acme' }, { account: 'acme', board: '1234' }, { account: 'acme', board: -3 }, { account: 'acme', board: 2 ** 53 }, { account: 'acme.monday.com', board: 1 }]) {
    assert.match(errorsOf({ ...base, trackers: [{ kind: 'monday', ...bad }] }), /a monday\.com tracker needs "account" \(as in acme\.monday\.com\) and "board"/, JSON.stringify(bad));
  }
  assert.match(errorsOf({ ...base, trackers: [{ kind: 'monday', account: 'acme', board: 1, group: 7 }] }), /"group" must be a monday\.com group's id/);
  assert.match(errorsOf({ ...base, trackers: [{ kind: 'monday', account: 'acme', board: 1, edits: 'yes' }] }), /"edits" must be true or false/);
  assert.match(errorsOf({ ...base, trackers: [{ kind: 'linear' }] }), /"kind" must be github, jira, azure, monday or slack/);
  const wrong = parseConfig({ ...base, trackers: [{ kind: 'jira', site: 's', project: 'K', group: 'topics', statusColumn: 'status' }] });
  assert.deepEqual(wrong.errors, []);
  assert.match(wrong.warnings.join('\n'), /trackers\[0\]: "group" applies only to a monday\.com tracker, so it's ignored/);
  assert.match(wrong.warnings.join('\n'), /trackers\[0\]: "statusColumn" applies only to a monday\.com tracker/);
  assert.deepEqual([wrong.config!.trackers[0]!.group, wrong.config!.trackers[0]!.statusColumn], [null, null]);
  // Two trackers whose keys look alike: only the first gets them.
  const twins = parseConfig({ ...base, trackers: [{ kind: 'monday', account: 'acme', board: 1 }, { kind: 'monday', account: 'acme', board: 2 }, { kind: 'jira', site: 's', project: 'AB' }, { kind: 'azure', organization: 'a', project: 'CRM' }] });
  assert.deepEqual(twins.errors, []);
  assert.match(twins.warnings.join('\n'), /trackers\[0\] and trackers\[1\] both give tickets keys like MON-12/);
  assert.match(twins.warnings.join('\n'), /trackers\[2\] and trackers\[3\] both give tickets keys like AB-12/);

  const file = join(tempDir(), '.acc', 'config.json');
  const trackers = [{ kind: 'monday', account: 'acme', board: 1234567890, statusColumn: 'status_1', group: 'topics' }];
  writeConfig(file, parseConfig({ ...base, trackers }).config!);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).trackers, [{ kind: 'monday', account: 'acme', board: 1234567890, statusColumn: 'status_1', group: 'topics' }], 'round-trips, with no empty keys');
});

test('a monday.com key belongs to its board\'s tracker by prefix, and two boards on one account are two trackers', () => {
  const list = [{ kind: 'jira' as const, project: 'MSP', prefix: null }, { kind: 'monday' as const, project: null, prefix: null }, { kind: 'monday' as const, project: null, prefix: 'OPS' }];
  assert.deepEqual(['MON-5', 'mon-1234567890', 'OPS-3', 'MSP-7', 'AB-1'].map((k) => trackerForKey(list, k)), [1, 1, 2, 0, null]);
  const one = withTracker([], { kind: 'monday', account: 'acme', board: 111, group: 'topics' });
  const two = withTracker(one, { kind: 'monday', account: 'acme', board: 555, group: null });
  assert.deepEqual(two, [{ kind: 'monday', account: 'acme', board: 111, group: 'topics' }, { kind: 'monday', account: 'acme', board: 555, prefix: 'MON2' }], 'neither replaces the other, and the second\'s keys are its own');
  assert.deepEqual(withTracker([...two.slice(0, 1), { ...two[1]!, edits: true }], { kind: 'monday', account: 'acme', board: 555, group: 'topics' })[1], { kind: 'monday', account: 'acme', board: 555, prefix: 'MON2', group: 'topics', edits: true }, 'the same board again is the same tracker, with its prefix');
  const three = withTracker(two, { kind: 'monday', account: 'globex', board: 111 });
  assert.deepEqual(three.map((t) => t.prefix), [undefined, 'MON2', 'MON3'], 'another account is another tracker, with the next free prefix');
  assert.deepEqual(withTracker([{ kind: 'jira', site: 's', project: 'MON' }, { kind: 'monday', account: 'acme', board: 1, prefix: 'MON2' }], { kind: 'monday', account: 'acme', board: 2 }).map((t) => t.prefix), [undefined, 'MON2', 'MON3'], 'a Jira project called MON takes MON too');
  assert.equal(withTracker(one, { kind: 'monday', account: 'acme', board: 555, prefix: 'OPS' })[1]!.prefix, 'OPS', 'a prefix it names is kept');
  const parsed = parseConfig({ ...clone(GENERIC_CONFIG), trackers: three });
  assert.deepEqual([parsed.errors, parsed.warnings.filter((w) => /keys like/.test(w))], [[], []], 'no two give the same keys');
  assert.deepEqual(['MON-7', 'MON2-7', 'MON3-7'].map((k) => trackerForKey(parsed.config!.trackers, k)), [0, 1, 2]);
});

test('re-adding a tracker keeps the settings it had, in its place; a new one goes last (D-048)', () => {
  const list = [{ kind: 'github', skipLabels: ['milestone'] }, { kind: 'jira', site: 'acme.atlassian.net', project: 'CRM' }];
  assert.deepEqual(withTracker(list, { kind: 'github' }), [{ kind: 'github', skipLabels: ['milestone'] }, list[1]], 'skipLabels survive');
  assert.deepEqual(withTracker(list, { kind: 'jira', site: 'acme.atlassian.net', project: 'CRM', board: 7 }), [list[0], { ...list[1], board: 7 }]);
  assert.deepEqual(withTracker(list, { kind: 'jira', site: 'acme.atlassian.net', project: 'OPS' }).map((t) => t.project), [undefined, 'CRM', 'OPS'], 'another project is another tracker');
});

test('saveTracker connects a tracker or changes one in .acc/config.json, keeping the rest, and writes nothing that wouldn\'t load (GH-112)', () => {
  const file = join(tempDir('acc-save-'), 'config.json');
  const start = { ...clone(GENERIC_CONFIG), github: { repo: 'acme/tool', account: 'jordan' }, trackers: [{ kind: 'github', skipLabels: ['milestone'] }] };
  writeFileSync(file, JSON.stringify(start));
  const read = () => JSON.parse(readFileSync(file, 'utf8'));
  // Added last, with the rest of the file as it was.
  assert.deepEqual(saveTracker(file, null, { kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', board: 7, epic: 'ACME-3' }), { index: 1, warnings: [] });
  assert.deepEqual(read(), { ...start, trackers: [start.trackers[0], { kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', board: 7, epic: 'ACME-3' }] });
  assert.ok(readFileSync(file, 'utf8').endsWith('}\n'));
  // Re-added, it's the same tracker, in its place: the index withTracker put it at.
  assert.equal(saveTracker(file, null, { kind: 'github', labels: ['billing'] }).index, 0);
  assert.deepEqual(read().trackers[0], { kind: 'github', skipLabels: ['milestone'], labels: ['billing'] }, 'skipLabels kept');
  // Changed at its place: a key named null is taken out, and the rest kept.
  assert.deepEqual(saveTracker(file, 1, { kind: 'jira', epic: null, board: 9 }), { index: 1, warnings: [] });
  assert.deepEqual(read().trackers[1], { kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', board: 9 });
  // Refused, with the file as it was: another kind at that place, a config that wouldn't load, no kind.
  const before = readFileSync(file, 'utf8');
  assert.throws(() => saveTracker(file, 0, { kind: 'jira', board: 3 }), /changed since this page opened/);
  assert.throws(() => saveTracker(file, null, { kind: 'jira', project: 'OPS' }), /would leave .* with problems, so nothing was written:\n- .*needs "site" and "project"/);
  assert.throws(() => saveTracker(file, null, { kind: 'linear' }), /needs a "kind": /);
  assert.throws(() => saveTracker(file, -1, { kind: 'jira' }), /place in the list, from 0/);
  assert.equal(readFileSync(file, 'utf8'), before);
  // A key the kind doesn't use is a warning, as parseConfig says.
  assert.match(saveTracker(file, 0, { kind: 'github', epic: 'X-1' }).warnings.join(' '), /epic/);
  assert.throws(() => saveTracker(join(tempDir('acc-none-'), 'config.json'), null, { kind: 'github' }), /Run "acc init" first/);
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

/** A config that sets every key parseConfig knows: generic, so auto-merge can be on, with a tracker of each kind. */
const EVERY_KEY = {
  schema: 1,
  project: 'Acme',
  profile: 'generic',
  github: { repo: 'acme-co/acme', account: 'work-account' },
  commitIdentity: { name: 'Test Person', email: 'test@example.com' },
  environments: [
    { name: 'Main', branch: 'main', type: 'none', org: 'Acme Dev', default: true, protected: false, promotesTo: ['release'] },
    { name: 'Release', type: 'none', protected: true },
  ],
  environmentSpecific: 'manifest/environment-specific.txt',
  knownDrift: 'manifest/known-drift.txt',
  trackers: [
    { kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', board: 7, epic: 'ACME-3', sprint: 'active', changesField: { id: 'customfield_10042', name: 'Deployment Notes', format: 'adf' } },
    { kind: 'github', repo: 'acme-co/tickets', skipLabels: ['milestone'], labels: ['billing'], edits: true, statusFor: { review: 'QA' } },
    { kind: 'azure', organization: 'acme', project: 'CRM', team: 'Billing', board: 'Stories', prefix: 'AB', areaPath: 'CRM\\Billing' },
    { kind: 'monday', account: 'acme', board: 42, statusColumn: 'status', prefix: 'MON', group: 'topics' },
    { kind: 'slack', workspace: 'acme', channel: 'C0123ABCD', reaction: 'ticket', doneReaction: 'white_check_mark', prefix: 'SL' },
  ],
  agents: {
    max: 4, permissionMode: 'acceptEdits',
    builder: { model: 'sonnet', effort: 'high', fallbackModel: 'haiku' },
    reviewer: { model: 'opus', effort: 'max', fallbackModel: 'sonnet' },
    // Cloud builders (GH-69): opted in, with every key.
    cloud: { routine: 'trig_01ABCDEFGHJKLMNOPQRSTUVW', default: 'local', quietMinutes: 90, max: 2, review: 'cloud' },
  },
  autonomy: 'review',
  worktrees: { root: '.claude/worktrees', setup: ['npm ci'] },
  gates: { required: ['check'], commands: { check: 'npm run check', typecheck: 'npm run typecheck' }, heavy: ['check'], severity: 3, builder: ['typecheck'], tests: ['check'], nearIndexes: ['web/main.ts'],
    ratchets: { tests: { command: 'node scripts/count-tests.mjs', limit: 'floor', label: 'tests' } } },
  secretScan: { paths: ['.'], exclude: ['fixtures'] },
  // A generic project's data folders are ignored, with a warning when it names any.
  strayFiles: { required: true, allow: ['LICENSE', 'fixtures'], data: [] },
  analysis: { required: true },
  // Outside Salesforce nothing reads it, and only false gets a warning.
  sourceTracking: true,
  autopilot: { appendOnly: ['docs/DECISIONS.md'], autoMerge: true },
  dispatch: { shared: ['README.md'] },
  tidy: { every: 12 },
  template: { name: 'Acme', source: '~/templates/acme.json', digest: `sha256:${'a'.repeat(64)}` },
  // The tools the project's checks need (T-68).
  tools: [{ title: 'A pinned browser', why: 'Screenshots draw with it.', check: 'true', fix: 'npm run browser' }],
};

/** The key paths a raw config sets, as CONFIG_KEYS writes them: trackers[].team, gates.commands. */
function pathsIn(v: unknown, at = ''): string[] {
  if ((CONFIG_KEYS as readonly string[]).includes(at)) return [at];
  if (Array.isArray(v)) return v.flatMap((e) => pathsIn(e, `${at}[]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => pathsIn(x, at ? `${at}.${k}` : k));
  return [at];
}

test('a config that sets every key parseConfig knows parses with no error or warning, and writeConfig gives it back (GH-107)', () => {
  assert.deepEqual([...new Set(pathsIn(EVERY_KEY))].sort(), [...CONFIG_KEYS].sort(), 'it sets every key, and only those');
  assert.equal(new Set(CONFIG_KEYS).size, CONFIG_KEYS.length, 'no key listed twice');
  const { config, errors, warnings } = parseConfig(clone(EVERY_KEY));
  assert.deepEqual([errors, warnings], [[], []]);
  const file = join(tempDir(), '.acc', 'config.json');
  writeConfig(file, config!);
  const again = loadConfig(file);
  assert.deepEqual([again.errors, again.warnings], [[], []]);
  assert.deepEqual(again.config, config);
});

test('a key parseConfig doesn\'t know is a warning at every level, named by its place in the file (GH-107)', () => {
  const raw = clone(EVERY_KEY) as Record<string, any>;
  raw.gates.foo = 1;
  raw.trackers[2].foo = 'x';
  raw.agents.builder.foo = 'x';
  raw.environments[1].colour = 'blue';
  raw.worktrees.rooot = '../x';
  raw.secretScan.excludes = [];
  raw.analysis.require = true;
  raw.template.url = 'x';
  raw.github.token = 'x';
  raw.dispatch.shard = [];
  const { config, warnings } = parseConfig(raw);
  assert.ok(config, 'warnings, not errors');
  assert.deepEqual(warnings, [
    'Unknown key "github.token" is ignored.',
    'Unknown key "environments[1].colour" is ignored.',
    'Unknown key "trackers[2].foo" is ignored.',
    'Unknown key "agents.builder.foo" is ignored.',
    'Unknown key "worktrees.rooot" is ignored.',
    'Unknown key "gates.foo" is ignored.',
    'Unknown key "secretScan.excludes" is ignored.',
    'Unknown key "analysis.require" is ignored.',
    'Unknown key "dispatch.shard" is ignored.',
    'Unknown key "template.url" is ignored.',
  ]);
  // A map's keys are values, not keys: a gate's name never warns.
  assert.deepEqual(parseConfig({ ...clone(GENERIC_CONFIG), gates: { commands: { anything: 'x' } } }).warnings, []);
});

test('the keys nothing reads are keys parseConfig knows, each with its reason, and the Command Center hides those listed unread (GH-107)', () => {
  for (const [k, why] of Object.entries({ ...UNREAD_KEYS, ...VALIDATOR_ONLY })) {
    assert.ok((CONFIG_KEYS as readonly string[]).includes(k), k);
    assert.ok(why && why.trim().length > 10, `${k} says why`);
  }
  assert.equal(keyShown('autonomy'), UNREAD_KEYS.autonomy === undefined);
  assert.equal(keyShown('autonomy', { autonomy: 'GH-1 will read it.' }), false);
  assert.equal(keyShown('autonomy', {}), true);
});

test('isEffort accepts each effort level and nothing else, including a missing value and a different case', () => {
  for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) assert.equal(isEffort(level), true, level);
  for (const not of ['default', 'High', '', undefined, null, 3]) assert.equal(isEffort(not), false, String(not));
});


test('isStr: a blank or spaces-only string, and a value that is not a string, are not a string with something in it', () => {
  assert.equal(isStr('main'), true);
  assert.equal(isStr(' x '), true);
  for (const v of ['', '   ', null, undefined, 0, ['a']]) assert.equal(isStr(v), false, String(v));
});

test('a Jira tracker follows a sprint: "active" or an id, alone or with an epic; a wrong value or a tracker that isn\'t Jira is refused (T-78)', () => {
  const base = clone(GENERIC_CONFIG);
  const one = (t: Record<string, unknown>) => parseConfig({ ...base, trackers: [t] });
  assert.equal(one({ kind: 'jira', site: 's', project: 'K', sprint: 'active' }).config!.trackers[0]!.sprint, 'active');
  const both = one({ kind: 'jira', site: 's', project: 'K', sprint: 42, epic: 'k-3' }).config!.trackers[0]!;
  assert.deepEqual([both.sprint, both.epic], [42, 'K-3'], 'a sprint with an epic');
  assert.equal(one({ kind: 'jira', site: 's', project: 'K' }).config!.trackers[0]!.sprint, null, 'unset, the whole board');
  assert.equal(one({ kind: 'jira', site: 's', project: 'K', sprint: null }).config!.trackers[0]!.sprint, null, 'null is unset');

  for (const bad of ['Active', 'now', '42', 0, -3, 1.5, true, [42], { id: 42 }]) {
    assert.match(errorsOf({ ...base, trackers: [{ kind: 'jira', site: 's', project: 'K', sprint: bad }] }), /trackers\[0\]: "sprint" must be "active", for the board's open sprints, or a sprint's id/, JSON.stringify(bad));
  }
  for (const t of [{ kind: 'github', sprint: 'active' }, { kind: 'azure', organization: 'a', project: 'b', sprint: 42 }, { kind: 'monday', account: 'acme', board: 1, sprint: 'active' }]) {
    const r = parseConfig({ ...base, trackers: [t] });
    assert.match(r.errors.join('\n'), /trackers\[0\]: "sprint" applies only to a Jira tracker/, `${t.kind}: refused, not ignored`);
  }
  assert.equal(sprintProblem('jira', 'active'), null);
  assert.equal(sprintProblem('jira', 7), null);
  assert.match(sprintProblem('slack', 7)!, /only to a Jira tracker/, 'the kind is checked before the value');
});
