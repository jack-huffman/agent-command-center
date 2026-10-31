// A Salesforce project's pipeline (T-157): the development environment, the merge on its own into it and
// nowhere further, and the settings a person changes in Settings' Pipeline section.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { autoMergeFor, autoMergeOn, type Config, parseConfig } from '../src/config.ts';
import { AccError } from '../src/exec.ts';
import { autoMergeDefault, canBeDevelopment, DEVELOPMENT_TYPES, developmentEnvironment, inPromotionOrder, isDevelopmentBranch, notMergingWhy, SALESFORCE_MERGE_WORDS } from '../src/pipeline.ts';
import { developmentName, setDevelopmentEnvironment, setNextSteps } from '../src/pipeline-settings.ts';
import { GENERIC_CONFIG, SF_CONFIG, tempDir } from './support.ts';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const sf = (more: Record<string, unknown> = {}): Config => {
  const r = parseConfig({ ...clone(SF_CONFIG), autonomy: 'review', ...more });
  assert.deepEqual(r.errors, []);
  return r.config!;
};
const env = (name: string, type: string, more: Record<string, unknown> = {}) => ({ name, branch: name.toLowerCase(), type, org: null, default: false, protected: type === 'production', promotesTo: [], ...more }) as Config['environments'][number];

test('a Salesforce project merges on its own by default; any other profile is off until it turns auto-merge on (T-157, D-083)', () => {
  assert.deepEqual([autoMergeDefault('salesforce'), autoMergeDefault('generic'), autoMergeDefault('other')], [true, false, false]);
  assert.equal(autoMergeOn(sf()), true);
  assert.equal(autoMergeOn(parseConfig(clone(GENERIC_CONFIG)).config!), false);
});

test('the development environment is the default environment of any type but Production: Developer, Developer Pro, Partial Copy or Full Copy', () => {
  assert.deepEqual([...DEVELOPMENT_TYPES], ['developer', 'developer_pro', 'partial', 'full']);
  for (const type of DEVELOPMENT_TYPES) {
    const config = { environments: [env('Production', 'production'), env('Work', type, { default: true })] };
    assert.equal(developmentEnvironment(config)?.name, 'Work', type);
    assert.equal(canBeDevelopment(env('Work', type)), true, type);
  }
  assert.equal(developmentEnvironment(sf())?.name, 'Dev');
  assert.equal(isDevelopmentBranch(sf(), 'dev'), true);
  assert.deepEqual([isDevelopmentBranch(sf(), 'uat'), isDevelopmentBranch(sf(), 'production'), isDevelopmentBranch(sf(), 'nowhere')], [false, false, false]);
  assert.equal(canBeDevelopment(env('Production', 'production')), false);
  assert.equal(canBeDevelopment(env('UAT', 'full', { protected: true })), false, 'a protected sandbox can\'t be it either');
  assert.equal(canBeDevelopment(env('Main', 'none')), false, 'a branch with no org isn\'t one');
});

test('edge case: a default that is Production or protected, or no default at all, leaves no development environment, and the words say why nothing merges', () => {
  // The parser refuses these defaults; a config read some other way, or a mutant that drops the type check, gets null.
  const prod = { profile: 'salesforce', environments: [env('Production', 'production', { default: true, protected: false }), env('Dev', 'developer')] };
  assert.equal(developmentEnvironment(prod), null);
  assert.match(notMergingWhy(prod)!, /^The default environment, Production, is Production: nothing merges into Production on its own\.$/);
  assert.equal(isDevelopmentBranch(prod, 'production'), false, 'never Production\'s branch');
  const guarded = { profile: 'salesforce', environments: [env('UAT', 'full', { default: true, protected: true }), env('Dev', 'developer')] };
  assert.equal(developmentEnvironment(guarded), null);
  assert.match(notMergingWhy(guarded)!, /^The default environment, UAT, is protected: a person merges into it\.$/);
  const none = { profile: 'salesforce', environments: [env('Dev', 'developer')] };
  assert.equal(developmentEnvironment(none), null);
  assert.match(notMergingWhy(none)!, /^No environment is the default/);
  assert.equal(notMergingWhy({ profile: 'generic', environments: [] }), null, 'not a Salesforce project: nothing to say');
});

test('why a Salesforce project doesn\'t merge on its own: the switch off, or autonomy that isn\'t review; null when it does', () => {
  assert.equal(notMergingWhy(sf()), null);
  assert.equal(notMergingWhy(sf({ autopilot: { autoMerge: false } })), 'Merging on its own is off for this project: a person merges each pull request.');
  assert.equal(notMergingWhy(sf({ autonomy: 'manual' })), 'Autonomy is manual, so autopilot doesn\'t run and nothing merges on its own.');
  assert.ok(SALESFORCE_MERGE_WORDS.includes('Never into Production') && SALESFORCE_MERGE_WORDS.includes('never a deploy past the development org'));
});

test('autopilot covers the development environment\'s branch alone in a Salesforce project: never Production, a protected one or a further unprotected one (T-157)', () => {
  const config = sf({ environments: [...clone(SF_CONFIG.environments).map((e: Record<string, unknown>) => (e.name === 'UAT' ? { ...e, protected: true } : e)), { name: 'QA', type: 'developer' }] });
  assert.deepEqual(config.environments.map((e) => [e.branch, autoMergeFor(config, e.branch)]), [['production', false], ['uat', false], ['dev', true], ['qa', false]]);
  // The mutant that merges into any unprotected environment: qa is unprotected and still never covered.
  assert.equal(config.environments.find((e) => e.branch === 'qa')!.protected, false);
});

test('environments come in promotion order, dev first and production last; ones on no path keep the config\'s order after them', () => {
  const ordered = inPromotionOrder(sf().environments).map((e) => e.branch);
  assert.deepEqual(ordered, ['dev', 'uat', 'production']);
  assert.deepEqual(inPromotionOrder([env('Loose', 'developer'), env('B', 'full', { promotesTo: ['production'] }), env('A', 'developer', { promotesTo: ['b'] }), env('Production', 'production')]).map((e) => e.name), ['A', 'B', 'Production', 'Loose']);
  assert.deepEqual(inPromotionOrder([]), [], 'edge case: none');
});

// ---------------------------------------------------------------- the settings a person changes

const configFile = (raw: unknown = { ...clone(SF_CONFIG), autonomy: 'review' }): string => {
  const dir = tempDir('pipeline-');
  const file = join(dir, 'config.json');
  writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  return file;
};
const rawOf = (file: string): Record<string, any> => JSON.parse(readFileSync(file, 'utf8'));

test('a person makes another sandbox the development environment: the default moves, the file keeps its shape, and the same one again changes nothing', () => {
  const file = configFile();
  const r = setDevelopmentEnvironment(file, 'UAT');
  assert.equal(r.changed, true);
  assert.equal(developmentName(r.config), 'UAT');
  const raw = rawOf(file);
  assert.deepEqual(raw.environments.map((e: { name: string; default?: boolean }) => [e.name, e.default ?? null]), [['Production', null], ['UAT', true], ['Dev', null]], 'default on UAT alone; the rest as it was');
  assert.deepEqual(Object.keys(raw), Object.keys({ ...clone(SF_CONFIG), autonomy: 'review' }), 'the keys in their order');
  assert.ok(readFileSync(file, 'utf8').startsWith('{\n  "schema"'), 'the indent it had');
  // Reviewed work merges into uat now, and not dev.
  assert.deepEqual([autoMergeFor(r.config, 'uat'), autoMergeFor(r.config, 'dev')], [true, false]);
  const again = setDevelopmentEnvironment(file, 'uat');
  assert.deepEqual([again.changed, developmentName(again.config)], [false, 'UAT'], 'by branch name too');
});

test('edge case: Production, a protected environment and an environment the settings don\'t list can\'t be the development environment, and nothing is written', () => {
  const raw = { ...clone(SF_CONFIG), autonomy: 'review', environments: clone(SF_CONFIG.environments).map((e: Record<string, unknown>) => (e.name === 'UAT' ? { ...e, protected: true } : e)) };
  const file = configFile(raw);
  const before = readFileSync(file, 'utf8');
  assert.throws(() => setDevelopmentEnvironment(file, 'Production'), (e: AccError) => e.code === 'refused' && /Production is Production: it can't be the development environment/.test(e.message));
  assert.throws(() => setDevelopmentEnvironment(file, 'UAT'), (e: AccError) => e.code === 'refused' && /UAT is protected: it can't be the development environment/.test(e.message));
  assert.throws(() => setDevelopmentEnvironment(file, 'Staging'), (e: AccError) => e.code === 'refused' && /No environment is called "Staging"\. The settings list Production, UAT, Dev\./.test(e.message));
  assert.equal(readFileSync(file, 'utf8'), before, 'nothing written');
  assert.throws(() => setDevelopmentEnvironment(join(tempDir('none-'), 'config.json'), 'Dev'), (e: AccError) => e.code === 'bad-config');
});

test('edge case: an environment with no org type, as a generic project\'s are, can\'t be the development environment: refused after the parser allowed it as the default, and the file stays byte for byte', () => {
  // The parser takes "release" as the default; canBeDevelopment refuses its type, none. Before T-157's rework the
  // file was written, then the change refused: the mutant that writes first is caught here.
  const file = configFile({ ...clone(GENERIC_CONFIG), environments: [{ name: 'main', default: true }, { name: 'release' }] });
  const before = readFileSync(file, 'utf8');
  assert.throws(() => setDevelopmentEnvironment(file, 'release'), (e: AccError) => e.code === 'refused' && /^release can't be the development environment: it has no org type\. The development environment is a Developer, Developer Pro, Partial Copy or Full Copy sandbox that isn't protected\.$/.test(e.message));
  assert.equal(readFileSync(file, 'utf8'), before, 'byte for byte as it was: nothing written before the refusal');
  assert.equal(rawOf(file).environments[0].default, true, 'main is still the default');
});

test('a change writes the environments list where it stands and keeps every other character of the settings file: a one-line section, a comment-like spacing and a 4-space indent stay as they were', () => {
  // Hand-written settings, as a person keeps them: 4 spaces, a section on one line, and keys in their own order.
  const text = [
    '{',
    '    "schema": 1,',
    '    "project": "Acme",',
    '    "profile": "salesforce",',
    '    "github": { "repo": "acme-co/acme-salesforce", "account": "work-account" },',
    '    "environments": [',
    '        { "name": "Production", "type": "production", "org": "Acme Production" },',
    '        { "name": "UAT", "type": "full", "org": "Acme UAT", "promotesTo": ["production"] },',
    '        { "name": "Dev", "type": "developer", "org": "Acme Dev", "default": true, "promotesTo": ["uat"] }',
    '    ],',
    '    "agents": { "max": 2 },',
    '    "gates": { "required": ["format", "validate"] },',
    '    "autonomy": "review"',
    '}',
    '',
  ].join('\n');
  const dir = tempDir('pipeline-');
  const file = join(dir, 'config.json');
  writeFileSync(file, text);
  assert.equal(setDevelopmentEnvironment(file, 'UAT').changed, true);
  const after = readFileSync(file, 'utf8');
  const outside = (s: string) => s.replace(/"environments": \[[\s\S]*?\n {4}\]/, '"environments": […]');
  assert.equal(outside(after), outside(text), 'everything outside the environments list is as it was, the one-line github section among it');
  assert.match(after, /\n {8}\{\n {12}"name": "UAT"/, 'the list is written in the file\'s own indentation, four spaces');
  assert.deepEqual(rawOf(file).environments.map((e: { name: string; default?: boolean }) => [e.name, e.default ?? null]), [['Production', null], ['UAT', true], ['Dev', null]]);
  assert.equal(setNextSteps(file, 'UAT', ['Production']).changed, false, 'the same next steps again change nothing, and write nothing');
  assert.equal(readFileSync(file, 'utf8'), after);
});

test('a person changes where an environment goes next: by name or branch, none means nowhere further, and the parser\'s rules hold before anything is written', () => {
  const file = configFile();
  const r = setNextSteps(file, 'Dev', ['UAT']);
  assert.equal(r.changed, true);
  assert.deepEqual(rawOf(file).environments[2].promotesTo, ['uat']);
  assert.deepEqual(r.config.environments.find((e) => e.branch === 'dev')!.promotesTo, ['uat']);
  assert.deepEqual(setNextSteps(file, 'dev', ['uat']).changed, false, 'the same again');
  const none = setNextSteps(file, 'UAT', []);
  assert.equal(none.changed, true);
  assert.equal(rawOf(file).environments[1].promotesTo, undefined, 'nowhere further is no key');
  assert.deepEqual(setNextSteps(file, 'UAT', []).changed, false);
  const before = readFileSync(file, 'utf8');
  assert.throws(() => setNextSteps(file, 'Dev', ['Dev']), (e: AccError) => e.code === 'refused' && /"Dev" can't promote to itself/.test(e.message));
  assert.throws(() => setNextSteps(file, 'Dev', ['Nowhere']), (e: AccError) => e.code === 'refused' && /No environment is called "Nowhere"/.test(e.message));
  assert.equal(readFileSync(file, 'utf8'), before, 'nothing written');
  // A loop: uat → dev while dev → uat.
  assert.throws(() => setNextSteps(file, 'UAT', ['Dev']), (e: AccError) => e.code === 'refused' && /The promotion paths loop/.test(e.message));
  assert.equal(readFileSync(file, 'utf8'), before, 'still nothing written');
});
