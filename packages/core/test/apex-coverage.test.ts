// Coverage for each Apex class and trigger a ticket changes (T-159): which classes count, how the org is asked,
// how its answer is read, and how a figure is judged against the floor and said. The oracle is a fixed answer
// from sf: ApexCodeCoverageAggregate's records as `sf data query --use-tooling-api --json` gives them.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { changedApex, type ClassCoverage, coverageFloor, coverageQueryArgs, coverageWords, linesWords, percent, reaches, readCoverage, underFloor } from '../src/apex-coverage.ts';
import { COVERAGE_FLOOR, parseConfig } from '../src/config.ts';
import { ok, sf, SF_CONFIG, tempDir } from './support.ts';

const CLASSES = 'force-app/main/default/classes';
const tree = (files: Record<string, string>): string => {
  const root = tempDir('apex-coverage-');
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
};
const cov = (name: string, covered: number, uncovered: number, lines: number[] = []): ClassCoverage => ({ name, covered, uncovered, lines });

test('the floor is Salesforce\'s 75 unless the project\'s settings raise it', () => {
  assert.equal(COVERAGE_FLOOR, 75);
  assert.equal(coverageFloor(parseConfig(SF_CONFIG).config!), 75);
  assert.equal(coverageFloor(parseConfig({ ...SF_CONFIG, gates: { apexCoverage: 95 } }).config!), 95);
  assert.match(parseConfig({ ...SF_CONFIG, gates: { apexCoverage: 74 } }).errors.join('\n'), /"gates\.apexCoverage" must be a whole number from 75 to 100/);
});

test('the classes and triggers that count: never a named test class, an @isTest one, an interface or an enum, nor a meta file; a commented @isTest still counts', () => {
  const root = tree({
    [`${CLASSES}/OrderService.cls`]: 'public with sharing class OrderService {\n  public interface Inner {}\n}\n',
    [`${CLASSES}/OrderServiceTest.cls`]: 'public class OrderServiceTest {}\n',
    [`${CLASSES}/Helper_Test.cls`]: '@isTest\nprivate class Helper_Test {}\n',
    [`${CLASSES}/Pricing.cls`]: 'global interface Pricing extends Base { Decimal price(); }\n',
    [`${CLASSES}/Stage.cls`]: 'public enum Stage { OPEN, CLOSED }\n',
    [`${CLASSES}/Noted.cls`]: '// not @isTest\n/* @isTest */\npublic class Noted {}\n',
    'force-app/main/default/triggers/OrderTrigger.trigger': 'trigger OrderTrigger on Order (before insert) {}\n',
  });
  const source = [
    `${CLASSES}/OrderService.cls`, `${CLASSES}/OrderService.cls-meta.xml`, `${CLASSES}/OrderServiceTest.cls`, `${CLASSES}/Helper_Test.cls`,
    `${CLASSES}/Pricing.cls`, `${CLASSES}/Stage.cls`, `${CLASSES}/Noted.cls`, 'force-app/main/default/triggers/OrderTrigger.trigger',
    'force-app/main/default/objects/Order/fields/Total__c.field-meta.xml',
  ];
  assert.deepEqual(changedApex(root, source, [{ name: 'orderservicetest' }]), [
    { name: 'OrderService', kind: 'class', path: `${CLASSES}/OrderService.cls` },
    { name: 'Noted', kind: 'class', path: `${CLASSES}/Noted.cls` },
    { name: 'OrderTrigger', kind: 'trigger', path: 'force-app/main/default/triggers/OrderTrigger.trigger' },
  ]);
});

test('edge case: a changed class the worktree can\'t read still counts, and an empty change has none', () => {
  assert.deepEqual(changedApex(tree({}), [`${CLASSES}/Gone.cls`], []), [{ name: 'Gone', kind: 'class', path: `${CLASSES}/Gone.cls` }]);
  assert.deepEqual(changedApex(tree({}), [], []), []);
});

test('the org is asked by the Tooling API, by name, and a name that isn\'t Apex never reaches the query', () => {
  const args = coverageQueryArgs('Acme Dev', ['OrderService', 'Bad\' OR Name != \'', 'OrderTrigger']);
  assert.deepEqual(args.slice(0, 7), ['data', 'query', '--use-tooling-api', '--target-org', 'Acme Dev', '--json', '--query']);
  assert.equal(args[7], 'SELECT ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered, Coverage FROM ApexCodeCoverageAggregate WHERE ApexClassOrTrigger.Name IN (\'OrderService\', \'OrderTrigger\')');
});

test('sf\'s answer is read for each wanted class, in the order asked, by name whatever its case; one with no row is one no test ran', () => {
  const answer = sf({ totalSize: 2, done: true, records: [
    { attributes: { type: 'ApexCodeCoverageAggregate' }, ApexClassOrTrigger: { Name: 'orderservice' }, NumLinesCovered: 44, NumLinesUncovered: 6, Coverage: { coveredLines: [1, 2], uncoveredLines: [21, 5, 6] } },
    { ApexClassOrTrigger: { Name: 'OrderTrigger' }, NumLinesCovered: 4, NumLinesUncovered: 0, Coverage: null },
  ] });
  assert.deepEqual(readCoverage(answer, ['OrderTrigger', 'OrderService', 'Never']), [
    { name: 'OrderTrigger', covered: 4, uncovered: 0, lines: [] },
    { name: 'OrderService', covered: 44, uncovered: 6, lines: [5, 6, 21] },
    { name: 'Never', covered: 0, uncovered: 0, lines: [], unran: true },
  ]);
});

test('edge case: an answer that isn\'t one is null: an sf error, no JSON, no records', () => {
  assert.equal(readCoverage(sf(null, 1), ['A']), null);
  assert.equal(readCoverage({ code: 1, stdout: '', stderr: 'boom' }, ['A']), null);
  assert.equal(readCoverage(ok('not json'), ['A']), null);
  assert.equal(readCoverage(sf({ totalSize: 0 }), ['A']), null);
});

test('the floor is judged on the exact share, and a figure is rounded down, so 74% never passes and 74.9% never reads 75%', () => {
  // The mutant that passes a class at 74% is caught here and in the gate.
  assert.equal(reaches(cov('A', 74, 26), 75), false);
  assert.equal(reaches(cov('A', 75, 25), 75), true);
  assert.equal(reaches(cov('A', 749, 251), 75), false);
  assert.equal(percent(cov('A', 749, 251)), 74);
  assert.equal(reaches(cov('A', 89, 11), 90), false);
  assert.equal(reaches(cov('A', 100, 0), 100), true);
  assert.equal(reaches(cov('A', 0, 0), 100), true, 'no line to cover');
  assert.equal(percent(cov('A', 0, 0)), 100);
  const unran: ClassCoverage = { ...cov('A', 0, 0), unran: true };
  assert.equal(reaches(unran, 75), false);
  assert.equal(percent(unran), 0);
});

test('a figure is said as the ticket says it, and the failure names each class under the floor with its lines', () => {
  assert.equal(coverageWords(cov('OrderService', 88, 12)), 'OrderService 88%, 12 lines not covered');
  assert.equal(coverageWords(cov('OrderService', 99, 1)), 'OrderService 99%, 1 line not covered');
  assert.equal(coverageWords(cov('Account', 10, 0)), 'Account 100%');
  assert.equal(coverageWords({ ...cov('Never', 0, 0), unran: true }), 'Never 0%, no test ran it');
  assert.equal(linesWords(cov('A', 1, 1, [7])), 'line 7');
  assert.equal(linesWords(cov('A', 1, 2)), '', 'the org didn\'t say which');
  const many = Array.from({ length: 23 }, (_, i) => i + 1);
  assert.equal(linesWords(cov('A', 0, 23, many)), 'lines 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20 and 3 more');
  assert.deepEqual(underFloor([cov('OrderService', 60, 40, [12, 13]), cov('Account', 10, 0), cov('Bare', 1, 3)], 75), ['OrderService 60%, 40 lines not covered (lines 12, 13)', 'Bare 25%, 3 lines not covered']);
  assert.deepEqual(underFloor([], 75), []);
});
