import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type Config, parseConfig } from '../src/config.ts';
import { deploy } from '../src/deploy.ts';
import { run } from '../src/exec.ts';
import { endJob, type Job, jobsDir, jobsUnderWay, startJob, withJob } from '../src/jobs.ts';
import { land } from '../src/land.ts';
import { mutate, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { promote } from '../src/promote.ts';
import { refresh } from '../src/refresh.ts';
import { fakeRunner, GENERIC_CONFIG, makeRepo, SF_CONFIG, tempDir } from './support.ts';

const now = () => new Date('2026-10-06T12:00:00Z');
const deadPid = (): number => Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);
const brief = (jobs: Job[]) => jobs.map((j) => ({ kind: j.kind, task: j.task, env: j.env, from: j.from, step: j.step }));

test('a job\'s marker says it\'s under way while it runs, and is gone when it ends, however it ends (D-092)', () => {
  const paths = { stateDir: tempDir('acc-state-') };
  assert.deepEqual(jobsUnderWay(paths), [], 'no folder yet: nothing under way');
  const key = startJob(paths, { kind: 'land', task: 'T-1', by: 'human:jordan' }, now);
  const [j] = jobsUnderWay(paths);
  assert.deepEqual([j?.key, j?.kind, j?.task, j?.by, j?.pid, j?.startedAt], [key, 'land', 'T-1', 'human:jordan', process.pid, now().toISOString()]);
  endJob(paths, key);
  assert.deepEqual(jobsUnderWay(paths), []);

  let during: Job[] = [];
  assert.throws(() => withJob(paths, { kind: 'deploy', env: 'dev', by: 'human:jordan' }, () => { during = jobsUnderWay(paths); throw new Error('boom'); }), /boom/);
  assert.deepEqual(brief(during), [{ kind: 'deploy', task: undefined, env: 'dev', from: undefined, step: undefined }]);
  assert.deepEqual(jobsUnderWay(paths), [], 'cleared when it throws');
  assert.equal(withJob({ stateDir: '/dev/null/nowhere' }, { kind: 'land', task: 'T-1', by: 'x' }, () => 'ran'), 'ran', 'a marker that can\'t be written never stops the work');
});

test('a marker whose process has gone isn\'t under way, and the next one written clears it; a file that isn\'t a job is skipped', () => {
  const paths = { stateDir: tempDir('acc-state-') };
  mkdirSync(jobsDir(paths), { recursive: true });
  writeFileSync(join(jobsDir(paths), 'land-T-1-1-1.json'), JSON.stringify({ kind: 'land', task: 'T-1', by: 'x', pid: deadPid(), startedAt: now().toISOString() }));
  writeFileSync(join(jobsDir(paths), 'odd.json'), JSON.stringify({ kind: 'nap', pid: process.pid, startedAt: now().toISOString() }));
  writeFileSync(join(jobsDir(paths), 'torn.json'), '{ "kind": "la');
  assert.deepEqual(jobsUnderWay(paths), []);
  const key = startJob(paths, { kind: 'refresh', task: 'T-2', by: 'x' }, now);
  assert.ok(!existsSync(join(jobsDir(paths), 'land-T-1-1-1.json')), 'the dead one is cleared');
  assert.deepEqual(jobsUnderWay(paths).map((j) => j.key), [key]);
});

/** A repo with T-1 in review on a branch, with an open pull request, and a runner whose first git call records what's under way, then fails. */
function stopped(raw: Record<string, unknown>) {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(raw) });
  const config = parseConfig(raw).config as Config;
  const paths = repoPaths(dir, run);
  const wt = tempDir('acc-wt-');
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'Add a sum function' }], 'human', 'human:test', emit, now);
    const t = l.tasks[0]!;
    t.state = 'review';
    t.run = { branch: 'task/T-1-sum', worktree: wt };
    t.pr = { number: 7, url: 'https://github.com/acme/tool/pull/7', state: 'open', sha: 'abc', openedAt: now().toISOString() } as never;
  });
  let seen: Job[] | null = null;
  const runner = fakeRunner({
    git: () => {
      seen ??= jobsUnderWay(paths);
      throw new Error('stopped here');
    },
  });
  return { paths, config, runner, seen: () => seen, id: 'T-1' };
}

test('land, refresh, promote and deploy each say they\'re under way while they run, and clear it when they throw', () => {
  const generic = { ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'jordan-kim' } };
  const l = stopped(generic);
  assert.throws(() => land(l.paths, l.config, l.id, { run: l.runner, now, env: {} }, { by: 'human:jordan' }), /stopped here/);
  assert.deepEqual(brief(l.seen()!), [{ kind: 'land', task: 'T-1', env: undefined, from: undefined, step: undefined }]);
  assert.deepEqual(jobsUnderWay(l.paths), []);

  const r = stopped(generic);
  assert.throws(() => refresh(r.paths, r.config, r.id, { run: r.runner, now, env: {} }, { actor: 'orchestrator', by: 'orchestrator:autopilot' }), /stopped here/);
  assert.deepEqual(brief(r.seen()!), [{ kind: 'refresh', task: 'T-1', env: undefined, from: undefined, step: undefined }]);
  assert.deepEqual(jobsUnderWay(r.paths), []);

  const p = stopped(SF_CONFIG);
  assert.throws(() => promote(p.paths, p.config, 'Dev', undefined, { run: p.runner, now, env: {} }, { by: 'human:jordan' }), /stopped here/);
  assert.deepEqual(brief(p.seen()!), [{ kind: 'promote', task: undefined, env: 'uat', from: 'dev', step: undefined }], 'from Dev to its first promotesTo, by branch');
  assert.deepEqual(jobsUnderWay(p.paths), []);

  const d = stopped(SF_CONFIG);
  assert.throws(() => deploy(d.paths, d.config, 'Dev', { run: d.runner, now }, { by: 'human:jordan' }), /stopped here/);
  assert.deepEqual(brief(d.seen()!), [{ kind: 'deploy', task: undefined, env: 'dev', from: undefined, step: undefined }]);
  assert.deepEqual(readdirSync(jobsDir(d.paths)), [], 'nothing left behind');
});
