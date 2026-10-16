// Leaves no browser running (T-68): a run that is sent SIGTERM stops every browser it started, with each
// one's helper processes, and a run with nothing running stops nothing.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { tempDir } from '../../packages/core/test/support.ts';
import { runningCount, SIGNAL_EXITS, stop, stopAll, stopOnExit, track } from '../scripts/stops.ts';

const scripts = join(import.meta.dirname, '..', 'scripts');

/** A fake browser: starts a helper, as Chrome does, writes both pids into dir, and runs until stopped. */
const FAKE = `
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync(require('node:path').join(process.argv[1], process.pid + '.pid'), String(helper.pid));
setInterval(() => {}, 1000);
`;

/** A run as the screenshot run makes one: stopOnExit, then three jobs at once, each a browser started by runAsync. */
const driver = (dir: string): string => `
import { runAsync, runJobs } from ${JSON.stringify(pathToFileURL(join(scripts, 'jobs.ts')).href)};
import { stopOnExit } from ${JSON.stringify(pathToFileURL(join(scripts, 'stops.ts')).href)};
stopOnExit();
await runJobs([0, 1, 2], 3, () => runAsync(process.execPath, ['-e', ${JSON.stringify(FAKE)}, ${JSON.stringify(dir)}], 600000));
`;

const isUp = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

async function until(ok: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (ok()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return ok();
}

test('a run sent SIGTERM stops every fake browser it started, and each one\'s helper, leaving none running', async () => {
  const dir = tempDir();
  const run = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', driver(dir)], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  run.stderr.on('data', (b: Buffer) => { err += b.toString(); });
  assert.ok(await until(() => readdirSync(dir).length === 3, 20_000), `three fake browsers started: ${err}`);
  const pids = readdirSync(dir).flatMap((f) => [Number(f.replace('.pid', '')), Number(readFileSync(join(dir, f), 'utf8'))]);
  assert.equal(pids.length, 6);
  assert.ok(pids.every(isUp), 'all six running before the signal');
  const exited = new Promise<number | null>((r) => run.on('exit', (code) => r(code)));
  run.kill('SIGTERM');
  assert.equal(await exited, SIGNAL_EXITS.SIGTERM);
  assert.ok(await until(() => !pids.some(isUp), 10_000), `still running: ${pids.filter(isUp).join(', ')}`);
});

test('with nothing running, stopAll stops nothing and stop on a child that never started is ignored', () => {
  assert.equal(runningCount(), 0);
  stopAll();
  const never = spawn('/no/such/browser-t68', [], { detached: true });
  never.on('error', () => {});
  track(never);
  stop(never);
  assert.equal(SIGNAL_EXITS.SIGINT, 130);
  assert.equal(typeof stopOnExit, 'function');
});
