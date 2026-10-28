import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseConfig } from '../src/config.ts';
import { run } from '../src/exec.ts';
import { readLedger } from '../src/ledger.ts';
import { lockHeld, withLock } from '../src/lock.ts';
import { repoPaths } from '../src/paths.ts';
import { makeRepo, SF_CONFIG, tempDir } from './support.ts';

const coreSrc = fileURLToPath(new URL('../src/index.ts', import.meta.url));

test('parallel writers never lose an update or corrupt the ledger', async () => {
  const repo = makeRepo();
  const cfg = JSON.stringify(parseConfig(JSON.parse(JSON.stringify(SF_CONFIG))).config);
  const worker = (n: number) => `
    import * as core from ${JSON.stringify(pathToFileURL(coreSrc).href)};
    const paths = core.repoPaths(${JSON.stringify(repo)}, core.run);
    const config = ${cfg};
    for (let i = 0; i < 15; i++) {
      core.mutate(paths, () => new Date(), (l, emit) =>
        core.upsertTasks(l, config, [{ source: { kind: 'jira', key: 'W${n}-' + i }, title: 'task ' + i }], 'human', 'w${n}', emit, () => new Date()));
    }`;
  const procs = [1, 2, 3, 4].map((n) => new Promise<number>((resolve) => {
    const p = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', worker(n)], { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', (code) => resolve(code ?? 1));
  }));
  assert.deepEqual(await Promise.all(procs), [0, 0, 0, 0]);
  const l = readLedger(repoPaths(repo, run).ledger);
  assert.equal(l.tasks.length, 60);
  assert.equal(l.seq, 60);
  assert.equal(new Set(l.tasks.map((t) => t.id)).size, 60);
});

test('a lock left by a dead process is broken', () => {
  const dir = tempDir();
  const lock = join(dir, 'ledger.lock');
  mkdirSync(lock);
  writeFileSync(join(lock, 'owner'), JSON.stringify({ pid: 999_999_999, at: Date.now() }));
  assert.equal(withLock(lock, () => 'ran', { timeoutMs: 1000 }), 'ran');
});

test('a live lock makes others wait, then time out with a clear message', () => {
  const dir = tempDir();
  const lock = join(dir, 'ledger.lock');
  mkdirSync(lock);
  writeFileSync(join(lock, 'owner'), JSON.stringify({ pid: process.pid, at: Date.now() }));
  assert.throws(() => withLock(lock, () => 'never', { timeoutMs: 150 }), /Another acc process is holding/);
});

test('the lock is released even when the work throws', () => {
  const lock = join(tempDir(), 'ledger.lock');
  assert.throws(() => withLock(lock, () => { throw new Error('boom'); }), /boom/);
  assert.equal(withLock(lock, () => 'again', { timeoutMs: 200 }), 'again');
});

test('a lock is held when mkdir says it exists, and on Windows also when it says EPERM, as for a folder another process is still removing (T-129)', () => {
  for (const platform of ['darwin', 'linux', 'win32'] as const) assert.equal(lockHeld('EEXIST', platform), true, `EEXIST on ${platform}`);
  assert.equal(lockHeld('EPERM', 'win32'), true, 'Windows: a lock being let go');
  assert.equal(lockHeld('EPERM', 'darwin'), false, 'a Mac: a real permission error, thrown');
  assert.equal(lockHeld('EPERM', 'linux'), false, 'Linux: the same');
  for (const code of ['EACCES', 'ENOENT', undefined]) assert.equal(lockHeld(code, 'win32'), false, `${code} is never held`);
});
