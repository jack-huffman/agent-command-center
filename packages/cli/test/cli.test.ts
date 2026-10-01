import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GENERIC_CONFIG, makeRepo } from '../../core/test/support.ts';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));

function acc(cwd: string, args: string[], input?: string, env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(process.execPath, ['--no-warnings', MAIN, ...args], {
    cwd, input, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ACC_ROLE: '', ...env },
  });
  return { code: r.status ?? 1, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
}

function repoWithConfig(config: unknown = GENERIC_CONFIG): string {
  return makeRepo({ '.acc/config.json': JSON.stringify(config) });
}

test('help, version and bad usage', () => {
  const dir = makeRepo();
  assert.equal(acc(dir, ['--version']).out.trim(), '0.1.0');
  assert.match(acc(dir, ['help']).out, /acc doctor/);
  assert.equal(acc(dir, ['nope']).code, 2);
  assert.equal(acc(dir, ['--nope']).code, 2);
});

test('init --profile generic writes a config that doctor accepts', () => {
  const dir = makeRepo();
  const r = acc(dir, ['init', '--profile', 'generic', '--project', 'Tool', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().config.environments[0].branch, 'main');
  const cfg = JSON.parse(readFileSync(join(dir, '.acc', 'config.json'), 'utf8'));
  assert.equal(cfg.project, 'Tool');
  assert.equal(acc(dir, ['init', '--profile', 'generic']).code, 1, 'refuses to overwrite without --force');
  const doctor = acc(dir, ['doctor', '--part', 'project', '--json']).json() as { id: string; status: string }[];
  assert.equal(doctor.find((d) => d.id === 'B0.config')!.status, 'pass');
});

test('add, list, ready, set and show: a task through its life', () => {
  const dir = repoWithConfig();
  assert.equal(acc(dir, ['add', 'First thing']).code, 0);
  assert.equal(acc(dir, ['add', 'Second thing', '--dep', 'T-1', '--brief', 'Needs the first']).code, 0);
  const ready = acc(dir, ['ready', '--json']).json() as { id: string }[];
  assert.deepEqual(ready.map((t) => t.id), ['T-1']);
  assert.match(acc(dir, ['list']).out, /T-2\s+○ To do\s+main\s+Second thing\s+T-1/);

  const refused = acc(dir, ['set', 'T-2', 'running']);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /waiting on T-1, which is todo/);

  assert.equal(acc(dir, ['set', 'T-1', 'running']).code, 0);
  assert.equal(acc(dir, ['set', 't-1', 'review', '--as', 'builder']).code, 0, 'ids are case-insensitive');
  assert.equal(acc(dir, ['set', 'T-1', 'done', '--as', 'builder']).code, 1, 'a builder cannot mark work done');
  assert.equal(acc(dir, ['set', 'T-1', 'done']).code, 0);
  assert.deepEqual((acc(dir, ['ready', '--json']).json() as { id: string }[]).map((t) => t.id), ['T-2']);

  const show = acc(dir, ['show', 'T-1']).out;
  assert.match(show, /todo → running {2}by human:/);
  assert.match(show, /review → done/);
});

test('builders are identified from ACC_ROLE and ACC_TASK', () => {
  const dir = repoWithConfig();
  acc(dir, ['add', 'Work']);
  acc(dir, ['set', 'T-1', 'running']);
  const r = acc(dir, ['set', 'T-1', 'blocked', '--reason', 'org is down', '--json'], undefined, { ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().entry.by, 'builder:T-1');
  assert.equal(r.json().task.blocker, 'org is down');
});

test('forced moves need a person and a reason, and are marked as overrides', () => {
  const dir = repoWithConfig();
  acc(dir, ['add', 'Work']);
  assert.match(acc(dir, ['set', 'T-1', 'done']).err, /no rule for todo → done/);
  assert.match(acc(dir, ['set', 'T-1', 'done', '--force']).err, /needs --reason/);
  const r = acc(dir, ['set', 'T-1', 'done', '--force', '--reason', 'finished by hand', '--json']);
  assert.equal(r.code, 0);
  assert.equal(r.json().entry.override, true);
});

test('import adds and refreshes tasks from tracker JSON', () => {
  const dir = repoWithConfig();
  const items = [
    { source: { kind: 'github', key: '#3', url: 'https://github.com/o/r/issues/3' }, title: 'Login page', deps: ['#2'] },
    { source: { kind: 'github', key: '#2' }, title: 'Auth service' },
  ];
  const first = acc(dir, ['import', '--json'], JSON.stringify(items)).json();
  assert.deepEqual(first.added, ['GH-3', 'GH-2']);
  items[0]!.title = 'Login page v2';
  const file = join(dir, 'tasks.json');
  writeFileSync(file, JSON.stringify(items));
  const again = acc(dir, ['import', '--file', file, '--json']).json();
  assert.deepEqual(again.updated, ['GH-3']);
  assert.deepEqual(again.unchanged, ['GH-2']);
  assert.equal(acc(dir, ['import'], '{"not":"a list"}').code, 2);
});

test('commands that need a config say how to get one', () => {
  const r = acc(makeRepo(), ['list']);
  assert.equal(r.code, 1);
  assert.match(r.err, /Run "acc init" first/);
  assert.match(acc(makeRepo(), ['list', '--json']).out, /"error":\s*"no-config"/);
});

test('doctor --step runs only the named checks, and rejects unknown ids', () => {
  const dir = repoWithConfig();
  const r = acc(dir, ['doctor', '--step', 'B0.config', '--step', 'B0.repo', '--json']).json() as { id: string }[];
  assert.deepEqual(r.map((x) => x.id).sort(), ['B0.config', 'B0.repo']);
  assert.equal(acc(dir, ['doctor', '--step', 'Z9.nope']).code, 2);
});
