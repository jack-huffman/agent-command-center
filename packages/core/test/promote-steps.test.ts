import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { openSteps } from '../src/change-steps.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { run, type RunOptions } from '../src/exec.ts';
import { mutate, readLedger, upsertTasks } from '../src/ledger.ts';
import { emptyOutside } from '../src/outside-changes.ts';
import { repoPaths } from '../src/paths.ts';
import { promote } from '../src/promote.ts';
import type { RecordChange } from '../src/records.ts';
import { fakeRunner, gitIn, makeRepo, ok, SF_CONFIG, tempDir } from './support.ts';

const now = () => new Date('2026-10-22T12:00:00Z');
const rename: RecordChange = { object: 'Account', action: 'update', match: [{ field: 'Name', value: 'Acme Corp' }], fields: [{ field: 'Name', from: null, to: 'Acme Corporation' }] };

/** dev with ACME-1's merged change, on a bare origin with uat and production. */
function repo() {
  const origin = tempDir('origin-');
  run('git', ['init', '-q', '--bare', origin]);
  const dir = makeRepo({ 'sfdx-project.json': JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }), 'force-app/main/default/classes/A.cls': 'public class A {}\n' });
  gitIn(dir, 'branch', '-M', 'production');
  gitIn(dir, 'remote', 'add', 'origin', origin);
  for (const b of ['uat', 'dev']) gitIn(dir, 'branch', b);
  gitIn(dir, 'checkout', '-q', 'dev');
  mkdirSync(join(dir, 'force-app/main/default/classes'), { recursive: true });
  writeFileSync(join(dir, 'force-app/main/default/classes/A.cls'), 'public class A { void go() {} }\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'ACME-1 (#1)');
  const sha = gitIn(dir, 'rev-parse', 'HEAD');
  gitIn(dir, 'push', '-q', 'origin', 'production', 'uat', 'dev');
  const c = parseConfig(SF_CONFIG).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, c, [{ source: { kind: 'jira', key: 'ACME-1', url: 'https://acme.atlassian.net/browse/ACME-1' }, title: 'Rename Acme', environment: 'dev' }], 'human', 'human:test', emit, now);
    Object.assign(l.tasks[0]!, {
      state: 'done', pr: { number: 1, url: 'https://github.com/acme-co/acme-salesforce/pull/1', state: 'merged', mergeSha: sha },
      outside: { ...emptyOutside(), changes: [{ id: 'c1', kind: 'record', detail: rename, why: 'The brand changed', planned: true, actor: 'builder', by: 'builder:ACME-1', at: now().toISOString() }] },
    });
  });
  return { paths, c };
}

test('a promotion turns each carried ticket\'s record changes into steps for its destination, and its pull request lists them', () => {
  const { paths, c } = repo();
  let body = '';
  const fake = fakeRunner({ 'gh auth token -u work-account': ok('gho\n'), 'gh pr create': ok('https://github.com/acme-co/acme-salesforce/pull/9\n') });
  const runner = (cmd: string, args: string[], opts?: RunOptions) => {
    if (cmd === 'gh' && args[1] === 'create') body = readFileSync(args[args.indexOf('--body-file') + 1]!, 'utf8');
    return fake(cmd, args, opts);
  };
  const r = promote(paths, c, 'dev', 'uat', { run: runner, now, env: {} }, { validate: false, by: 'human:jordan' });
  assert.deepEqual([r.tasks, r.steps], [['ACME-1'], 1]);
  const task = readLedger(paths.ledger).tasks[0]!;
  assert.deepEqual(openSteps(task).map((s) => [s.step.env, s.step.org, s.step.state]), [['uat', 'Acme UAT', 'todo']]);
  assert.match(body, /## Changes outside git to make by hand \(1\)/);
  assert.match(body, /sf data update record --target-org "Acme UAT" --sobject Account --where "Name='Acme Corp'"/);
  assert.match(body, /Nothing makes them by itself/);
});

test('edge case: a promotion whose tasks changed nothing outside git adds no steps and no section', () => {
  const { paths, c } = repo();
  mutate(paths, now, (l, emit) => { delete l.tasks[0]!.outside; emit({ type: 'task.updated', task: 'ACME-1', actor: 'human', by: 'test', data: {} }); });
  let body = '';
  const fake = fakeRunner({ 'gh auth token -u work-account': ok('gho\n'), 'gh pr create': ok('https://github.com/acme-co/acme-salesforce/pull/9\n') });
  const r = promote(paths, c, 'dev', 'uat', { run: (cmd, args, opts) => { if (cmd === 'gh' && args[1] === 'create') body = readFileSync(args[args.indexOf('--body-file') + 1]!, 'utf8'); return fake(cmd, args, opts); }, now, env: {} }, { validate: false });
  assert.equal(r.steps, 0);
  assert.ok(body.length > 0);
  assert.doesNotMatch(body, /by hand/);
});
