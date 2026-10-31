// The deploy guide at the CLI (T-154): acc deploy --guide opens its chat, for a person; the guide deploys its own
// ticket with the yes the person typed in the chat, and nothing else a person does. The deploy itself is tested
// in core, with fake Salesforce and GitHub answers.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { keepTypedYes, typedYesPath } from '../../core/src/deploy-guide.ts';
import { readPick } from '../../core/src/deploy-pick.ts';
import { run } from '../../core/src/exec.ts';
import { mutate } from '../../core/src/ledger.ts';
import { repoPaths } from '../../core/src/paths.ts';
import { SF_CONFIG } from '../../core/test/support.ts';
import { personOrGuide } from '../src/shared.ts';
import { cli, repoWithConfig } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));
const guide = { ACC_ROLE: 'deployer', ACC_TASK: 'T-1' };

test('the guide\'s deploy passes no yes of its own: the deploy reads the person\'s pick or typed name at its own yes step, after its checks (T-156)', () => {
  const dir = repoWithConfig();
  assert.equal(acc(dir, ['add', 'A thing']).code, 0);
  const paths = repoPaths(dir, run);
  keepTypedYes(paths, 'T-1', 'main', null, () => new Date());
  const r = acc(dir, ['deploy', '--task', 'T-1', '--yes', '0Af1'], undefined, guide);
  assert.equal(r.code, 1);
  assert.match(r.err, /isn't a Salesforce project/, 'the deploy\'s own checks come first');
  assert.equal(existsSync(typedYesPath(paths, 'T-1')), true, 'the typed yes is read only at the yes step, which this deploy never reached');
});

/** A Salesforce project with T-1 built and merged, so its deploy guide can open. */
function deployable(): { dir: string; paths: ReturnType<typeof repoPaths> } {
  const dir = repoWithConfig(SF_CONFIG);
  assert.equal(acc(dir, ['add', 'A thing']).code, 0);
  const paths = repoPaths(dir, run);
  mutate(paths, () => new Date(), (l, emit) => {
    const t = l.tasks.find((x) => x.id === 'T-1')!;
    t.state = 'done';
    t.pr = { number: 1, url: 'https://github.com/acme-co/acme-salesforce/pull/1', state: 'merged', mergeSha: 'abc' };
    // The ledger is written only for an event.
    emit({ type: 'task.updated', task: t.id, actor: 'human', by: 'human:test', data: {} });
  });
  return { dir, paths };
}

test('acc deploy <env> --task <id> --guide keeps the person\'s pick of any environment ahead on the path, and refuses any other (T-156)', () => {
  const { dir, paths } = deployable();
  assert.equal(readPick(paths, 'T-1'), null);
  const prod = acc(dir, ['deploy', 'production', '--task', 'T-1', '--guide', '--json']);
  assert.equal(prod.code, 0, prod.err + prod.out);
  assert.equal(prod.json().env.ACC_DEPLOY_TO, 'production');
  assert.equal(prod.json().pick.env, 'production', 'two steps on from Dev, picked');
  const kept = readPick(paths, 'T-1')!;
  assert.equal(kept.env, 'production');
  assert.match(kept.by, /^human:/);
  const uat = acc(dir, ['deploy', '--task', 'T-1', '--guide']);
  assert.equal(uat.code, 0, uat.err);
  assert.match(uat.out, /You picked uat for T-1/, 'with none named, its next step');
  assert.equal(readPick(paths, 'T-1')!.env, 'uat', 'the new pick replaces the old');
  const dev = acc(dir, ['deploy', 'dev', '--task', 'T-1', '--guide']);
  assert.equal(dev.code, 1);
  assert.match(dev.err, /T-1 is in Dev already\. It can go to UAT, Production/);
  assert.equal(readPick(paths, 'T-1')!.env, 'uat', 'edge case: a refused pick changes nothing');
  const other = acc(dir, ['deploy', 'production', '--task', 'T-1', '--guide'], undefined, guide);
  assert.equal(other.code, 1);
  assert.match(other.err, /The deploy guide can't open a deploy guide/, 'security review: the guide can\'t write its own pick');
  assert.equal(readPick(paths, 'T-1')!.env, 'uat');
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

test('acc deploy\'s inner flag names are refused as typed, so a name never gets past the guide\'s guard by them', () => {
  const dir = repoWithConfig();
  for (const flag of ['--confirm-name=Production', '--deploy-check=0Af1']) {
    const r = acc(dir, ['deploy', 'production', '--task', 'T-1', flag], undefined, guide);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /isn't one of acc deploy's flags: use --yes <check-id>, and --confirm-production <name>/);
  }
});
