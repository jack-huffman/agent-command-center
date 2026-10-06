import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { awakePath, holdAwake, keepAwakeFor, releaseAwake } from '../src/awake.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { run } from '../src/exec.ts';
import { moveTask, mutate, noGateHooks, readLedger, type State, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { fakeAwake, GENERIC_CONFIG, makeRepo, tempDir } from './support.ts';

const now = () => new Date('2026-10-05T22:20:00Z');

test('on macOS acc holds caffeinate -i -w <pid>, and only -i: the display and a closed lid still sleep (D-???)', () => {
  const a = fakeAwake();
  const held = holdAwake(4242, a.deps)!;
  assert.deepEqual(a.spawned, [['caffeinate', '-i', '-w', '4242']], 'idle sleep only, for as long as that process lives');
  held.release();
  assert.deepEqual(a.killed, [held.pid]);
  assert.equal(holdAwake(0, a.deps), null, 'no process, nothing to watch');
});

test('off macOS nothing is started, nothing is written, and nothing fails', () => {
  const stateDir = tempDir();
  for (const platform of ['linux', 'win32'] as const) {
    const a = fakeAwake(platform);
    assert.equal(holdAwake(4242, a.deps), null);
    assert.equal(keepAwakeFor({ stateDir }, 'T-1', 4242, a.deps), null);
    assert.deepEqual(a.spawned, []);
    assert.equal(existsSync(awakePath({ stateDir }, 'T-1')), false);
    assert.equal(releaseAwake({ stateDir }, 'T-1', a.deps), false);
  }
});

test('a task\'s caffeinate is written down, replaced by its next one, and ended on release', () => {
  const stateDir = tempDir();
  const a = fakeAwake();
  const first = keepAwakeFor({ stateDir }, 'T-1', 100, a.deps)!;
  assert.deepEqual(JSON.parse(readFileSync(awakePath({ stateDir }, 'T-1'), 'utf8')), { pid: first.pid, watch: 100 });
  const second = keepAwakeFor({ stateDir }, 'T-1', 200, a.deps)!;
  assert.deepEqual(a.killed, [first.pid], 'one caffeinate a task');
  assert.equal(releaseAwake({ stateDir }, 'T-1', a.deps), true);
  assert.deepEqual(a.killed, [first.pid, second.pid]);
  assert.equal(existsSync(awakePath({ stateDir }, 'T-1')), false);
  assert.equal(releaseAwake({ stateDir }, 'T-1', a.deps), false, 'nothing left to end');
});

test('a task that leaves running ends its caffeinate: acc done, acc block and abandon; and a pid that isn\'t caffeinate is never killed', () => {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  const config = parseConfig(GENERIC_CONFIG).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => { upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'Write the changelog' }], 'human', 'human:test', emit, now); });
  const moves: { to: State; reason: string | null }[] = [{ to: 'review', reason: null }, { to: 'blocked', reason: 'needs a date' }, { to: 'todo', reason: 'abandoned' }];
  for (const m of moves) {
    mutate(paths, now, (l, emit) => { l.tasks[0]!.state = 'running'; emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'human:test', data: {} }); });
    // This test's own pid stands in: it isn't a caffeinate, so release forgets it and leaves it running.
    mkdirSync(dirname(awakePath(paths, 'T-1')), { recursive: true });
    writeFileSync(awakePath(paths, 'T-1'), JSON.stringify({ pid: process.pid, watch: 1 }));
    moveTask(paths, config, 'T-1', { to: m.to, actor: 'human', by: 'human:test', reason: m.reason }, noGateHooks, now);
    assert.equal(readLedger(paths.ledger).tasks[0]!.state, m.to);
    assert.equal(existsSync(awakePath(paths, 'T-1')), false, `running → ${m.to} releases it`);
  }
  // A move that isn't out of running leaves a caffeinate alone.
  writeFileSync(awakePath(paths, 'T-1'), JSON.stringify({ pid: process.pid, watch: 1 }));
  moveTask(paths, config, 'T-1', { to: 'blocked', actor: 'human', by: 'human:test', reason: 'waiting' }, noGateHooks, now);
  assert.equal(existsSync(awakePath(paths, 'T-1')), true);
});
