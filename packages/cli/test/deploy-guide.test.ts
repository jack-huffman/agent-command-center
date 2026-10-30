// The deploy guide at the CLI (T-154): acc deploy --guide opens its chat, for a person; the guide deploys its own
// ticket with the yes the person typed in the chat, and nothing else a person does. The deploy itself is tested
// in core, with fake Salesforce and GitHub answers.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { keepTypedYes, typedYesPath } from '../../core/src/deploy-guide.ts';
import { run } from '../../core/src/exec.ts';
import { repoPaths } from '../../core/src/paths.ts';
import { personOrGuide } from '../src/shared.ts';
import { cli, repoWithConfig } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));
const guide = { ACC_ROLE: 'deployer', ACC_TASK: 'T-1' };

test('the guide\'s deploy needs the person\'s typed yes, and uses it up; with one, it goes on to the deploy\'s own checks', () => {
  const dir = repoWithConfig();
  assert.equal(acc(dir, ['add', 'A thing']).code, 0);
  const none = acc(dir, ['deploy', '--task', 'T-1', '--yes', '0Af1'], undefined, guide);
  assert.equal(none.code, 1);
  assert.match(none.err, /The person hasn't typed a yes for T-1 in this chat\. Ask the person to type it in the chat/);
  const paths = repoPaths(dir, run);
  keepTypedYes(paths, 'T-1', 'yes', null, () => new Date());
  const typed = acc(dir, ['deploy', '--task', 'T-1', '--yes', '0Af1'], undefined, guide);
  assert.equal(typed.code, 1);
  assert.match(typed.err, /isn't a Salesforce project/, 'past the yes, the deploy refuses a project that isn\'t Salesforce');
  assert.equal(existsSync(typedYesPath(paths, 'T-1')), false, 'the yes is used up');
});

test('the guide deploys its own ticket only, never types the org\'s name, and can\'t open another guide', () => {
  const dir = repoWithConfig();
  const other = acc(dir, ['deploy', '--task', 'T-2', '--yes', '0Af1'], undefined, guide);
  assert.equal(other.code, 1);
  assert.match(other.err, /The deploy guide for T-1 can't deploy a ticket for T-2/);
  const named = acc(dir, ['deploy', 'production', '--task', 'T-1', '--yes', '0Af1', '--confirm-production', 'Production'], undefined, guide);
  assert.equal(named.code, 1);
  assert.match(named.err, /never types the org's name/);
  const open = acc(dir, ['deploy', '--task', 'T-1', '--guide'], undefined, guide);
  assert.equal(open.code, 1);
  assert.match(open.err, /The deploy guide can't open a deploy guide\. A person does that/);
  assert.match(acc(dir, ['promote', 'main'], undefined, guide).err, /The deploy guide can't promote/, 'nor anything else a person does');
});

test('a builder can\'t open a deploy guide, and a person is told why a ticket can\'t be deployed', () => {
  const dir = repoWithConfig();
  assert.equal(acc(dir, ['add', 'A thing']).code, 0);
  assert.match(acc(dir, ['deploy', '--task', 'T-1', '--guide'], undefined, { ACC_ROLE: 'builder' }).err, /A builder can't open a deploy guide/);
  const person = acc(dir, ['deploy', '--task', 'T-1', '--guide']);
  assert.equal(person.code, 1);
  assert.match(person.err, /T-1 can't be deployed: .*Salesforce/);
});

test('edge case: the guide marks its own ticket\'s steps, and no other ticket\'s', () => {
  const dir = repoWithConfig();
  const other = acc(dir, ['change', 'step', 'T-2', 'c1', '--env', 'main', '--done'], undefined, guide);
  assert.equal(other.code, 1);
  assert.match(other.err, /The deploy guide for T-1 can't mark a promotion's step for T-2/);
});

test('personOrGuide: a person as before, the guide for its own ticket alone (edge case: its id in any case)', () => {
  const was = { role: process.env.ACC_ROLE, task: process.env.ACC_TASK };
  try {
    delete process.env.ACC_ROLE;
    assert.match(personOrGuide({ json: false }, 'deploy a ticket', 'T-1'), /^human:/);
    Object.assign(process.env, { ACC_ROLE: 'deployer', ACC_TASK: 't-1' });
    assert.equal(personOrGuide({ json: false }, 'deploy a ticket', 'T-1'), 'deployer:T-1');
    assert.throws(() => personOrGuide({ json: false }, 'deploy a ticket', 'T-2'), /The deploy guide for T-1 can't deploy a ticket for T-2/);
    Object.assign(process.env, { ACC_ROLE: 'builder' });
    assert.throws(() => personOrGuide({ json: false }, 'deploy a ticket', 'T-1'), /A builder can't deploy a ticket/);
  } finally {
    for (const [k, v] of [['ACC_ROLE', was.role], ['ACC_TASK', was.task]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
