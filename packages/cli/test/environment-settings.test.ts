// acc environments (T-157): the pipeline in path order, the development environment and where each goes next,
// shown to anyone and changed by a person alone. acc runs from its source, in throwaway repos (support.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GENERIC_CONFIG, makeRepo } from '../../core/test/support.ts';
import { cli } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

const SF = {
  ...GENERIC_CONFIG, profile: 'salesforce', autonomy: 'review',
  environments: [
    { name: 'Production', type: 'production', org: 'Acme Prod' },
    { name: 'QA', type: 'partial', org: 'Acme QA', promotesTo: ['production'] },
    { name: 'Dev', type: 'developer', org: 'Acme Dev', default: true, promotesTo: ['qa'] },
  ],
};
const configOf = (dir: string) => JSON.parse(readFileSync(join(dir, '.acc', 'config.json'), 'utf8'));

test('acc environments lists the environments in path order with org, type, protection and next steps, names the development environment, and says the work merges into it on its own', () => {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(SF, null, 2) });
  const r = acc(dir, ['environments']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Environments, in path order; Dev is the development environment:/);
  assert.match(r.out, /Dev\s+developer\s+Acme Dev\s+development → qa\n\s+QA\s+partial\s+Acme QA\s+ → production\n\s+Production\s+production\s+Acme Prod\s+protected\s+→ –/);
  assert.match(r.out, /Reviewed work merges into Dev on its own, once its builder's deploy to the development org passed, while autopilot is on\. Never further\./);
  const json = acc(dir, ['environments', '--json']).json();
  assert.deepEqual([json.development, json.autoMerge, json.merges, json.why], ['Dev', true, true, null]);
  assert.deepEqual(json.environments.map((e: { name: string; development: boolean; protected: boolean; next: string[] }) => [e.name, e.development, e.protected, e.next]), [['Dev', true, false, ['qa']], ['QA', false, false, ['production']], ['Production', false, true, []]]);
});

test('edge case: with merging on its own off, or a project that isn\'t Salesforce, acc environments says so instead', () => {
  const off = makeRepo({ '.acc/config.json': JSON.stringify({ ...SF, autopilot: { autoMerge: false } }) });
  const r = acc(off, ['environments']);
  assert.match(r.out, /Nothing merges on its own: Merging on its own is off for this project/);
  assert.equal(acc(off, ['environments', '--json']).json().merges, false);
  const generic = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  assert.match(acc(generic, ['environments']).out, /This isn't a Salesforce project: acc agents auto-merge says whether its pull requests merge on their own \(off\)\./);
});

test('acc environments development <env> moves the default, for a person to commit; Production, a protected environment and an unknown name are refused', () => {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(SF, null, 2) });
  const r = acc(dir, ['environments', 'development', 'QA']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^QA is the development environment now\. Set in \.acc\/config\.json: commit it to share it\./);
  assert.deepEqual(configOf(dir).environments.map((e: { name: string; default?: boolean }) => [e.name, e.default ?? null]), [['Production', null], ['QA', true], ['Dev', null]]);
  assert.deepEqual(acc(dir, ['environments', 'development', 'qa', '--json']).json().changed, false, 'the same again, by branch');
  const prod = acc(dir, ['environments', 'development', 'Production']);
  assert.equal(prod.code, 1);
  assert.match(prod.err, /Production is Production: it can't be the development environment\. Nothing merges into it on its own\./);
  const unknown = acc(dir, ['environments', 'development', 'Staging']);
  assert.match(unknown.err, /No environment is called "Staging"/);
  assert.match(acc(dir, ['environments', 'development']).err, /acc environments \[development <env> \| next <env> \[<to>\.\.\.\]\]/);
});

test('acc environments next <env> [<to>...] sets where it goes; none means nowhere further; a loop is refused before anything is written', () => {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(SF, null, 2) });
  const r = acc(dir, ['environments', 'next', 'Dev', 'QA', 'Production']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Dev goes to qa, production now\./);
  assert.deepEqual(configOf(dir).environments[2].promotesTo, ['qa', 'production']);
  assert.match(acc(dir, ['environments', 'next', 'QA']).out, /^QA goes to nowhere further now\./);
  assert.equal(configOf(dir).environments[1].promotesTo, undefined);
  const before = readFileSync(join(dir, '.acc', 'config.json'), 'utf8');
  const loop = acc(dir, ['environments', 'next', 'QA', 'Dev']);
  assert.equal(loop.code, 1);
  assert.match(loop.err, /The promotion paths loop/);
  assert.equal(readFileSync(join(dir, '.acc', 'config.json'), 'utf8'), before);
});

test('a builder, a reviewer or an analyst can\'t change the pipeline: refused by role, and the file stays as it was', () => {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(SF, null, 2) });
  const before = readFileSync(join(dir, '.acc', 'config.json'), 'utf8');
  let checked = 0;
  for (const role of ['builder', 'reviewer', 'analyst']) {
    for (const args of [['environments', 'development', 'QA'], ['environments', 'next', 'Dev']]) {
      const r = acc(dir, args, undefined, { ACC_ROLE: role, ACC_TASK: 'T-1' });
      assert.equal(r.code, 1, `${role}: ${args.join(' ')}`);
      assert.match(r.err, new RegExp(`${role === 'analyst' ? 'An' : 'A'} ${role} can't change`));
      checked++;
    }
    assert.equal(acc(dir, ['environments'], undefined, { ACC_ROLE: role, ACC_TASK: 'T-1' }).code, 0, `${role} may look`);
  }
  assert.equal(checked, 6);
  assert.equal(readFileSync(join(dir, '.acc', 'config.json'), 'utf8'), before);
});
