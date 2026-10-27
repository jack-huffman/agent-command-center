// Leaves no browser running (T-68): a run that exits, throws, rejects, or is sent SIGINT or SIGTERM stops
// every browser it started, with each one's helper processes, and a run with nothing running stops nothing.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { tempDir } from '../../packages/core/test/support.ts';
import { runningCount, SIGNAL_EXITS, stop, stopAll, stopOnExit, track } from '../scripts/stops.ts';
import { until } from './vscode.ts';
import { skipOnWindows } from '../../scripts/windows-tests.ts';

const scripts = join(import.meta.dirname, '..', 'scripts');

/** A fake browser: starts a helper, as Chrome does, writes both pids into dir, and runs until stopped. */
const FAKE = `
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync(require('node:path').join(process.argv[1], process.pid + '.pid'), String(helper.pid));
setInterval(() => {}, 1000);
`;

/** How the run ends: a signal sent from outside, or the run itself exiting, throwing or leaving a promise rejected. */
type Ending = 'SIGTERM' | 'SIGINT' | 'exit' | 'throw' | 'reject';

/** What the run does once its three browsers are up, for the endings it brings on itself. */
const ENDS: Record<Ending, string> = {
  SIGTERM: '',
  SIGINT: '',
  exit: 'process.exit(0);',
  throw: 'setTimeout(() => { throw new Error(\'boom\'); });',
  reject: 'Promise.reject(new Error(\'boom\'));',
};

/** The exit code each ending gives the run. */
const CODES: Record<Ending, number> = { SIGTERM: SIGNAL_EXITS.SIGTERM, SIGINT: SIGNAL_EXITS.SIGINT, exit: 0, throw: 1, reject: 1 };

/** A run as the screenshot run makes one: stopOnExit, then three jobs at once, each a browser started by runAsync. */
const driver = (dir: string, ending: Ending): string => `
import { readdirSync } from 'node:fs';
import { runAsync, runJobs } from ${JSON.stringify(pathToFileURL(join(scripts, 'jobs.ts')).href)};
import { stopOnExit } from ${JSON.stringify(pathToFileURL(join(scripts, 'stops.ts')).href)};
stopOnExit();
void runJobs([0, 1, 2], 3, () => runAsync(process.execPath, ['-e', ${JSON.stringify(FAKE)}, ${JSON.stringify(dir)}], 600000));
const up = setInterval(() => {
  if (readdirSync(${JSON.stringify(dir)}).length < 3) return;
  clearInterval(up);
  ${ENDS[ending]}
}, 50);
`;

const isUp = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

for (const ending of Object.keys(ENDS) as Ending[]) {
  const name = `a run that ends by ${ending} stops every fake browser it started, and each one's helper, leaving none running`;
  // A signal sent from outside is POSIX's; Windows has none (WINDOWS_SKIPS).
  const skip = ending === 'SIGTERM' || ending === 'SIGINT' ? skipOnWindows('extension/test/stops.test.ts', name) : false;
  test(name, { skip }, async () => {
    const dir = tempDir();
    const run = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', driver(dir, ending)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    run.stderr.on('data', (b: Buffer) => { err += b.toString(); });
    const exited = new Promise<number | null>((r) => run.on('exit', (code) => r(code)));
    await until(() => readdirSync(dir).length === 3, 20_000, `three fake browsers: ${err}`);
    const pids = readdirSync(dir).flatMap((f) => [Number(f.replace('.pid', '')), Number(readFileSync(join(dir, f), 'utf8'))]);
    assert.equal(pids.length, 6);
    if (ending === 'SIGTERM' || ending === 'SIGINT') {
      assert.ok(pids.every(isUp), 'all six running before the signal');
      run.kill(ending);
    }
    assert.equal(await exited, CODES[ending], err);
    if (ending === 'throw' || ending === 'reject') assert.match(err, /boom/, 'the error is printed');
    await until(() => !pids.some(isUp), 10_000, `none of ${pids.join(', ')} running`);
  });
}

test('with nothing running, stopAll stops nothing, and a browser that never started is dropped and its stop ignored', async () => {
  assert.equal(runningCount(), 0);
  assert.doesNotThrow(() => stopAll());
  assert.equal(runningCount(), 0);
  const never = spawn('/no/such/browser-t68', [], { detached: true });
  const failed = new Promise((r) => never.once('error', r));
  track(never);
  assert.equal(runningCount(), 1, 'tracked until it fails to start');
  await failed;
  assert.equal(never.pid, undefined, 'it never had a process');
  assert.doesNotThrow(() => stop(never));
  assert.equal(runningCount(), 0, 'its error drops it');
});

test('a second stopOnExit call adds no second set of listeners (T-70)', () => {
  // A stand-in process: only its listeners are read, so nothing here exits or is signalled.
  const proc = new EventEmitter();
  const EVENTS = ['exit', 'SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'];
  const counts = () => EVENTS.map((e) => proc.listenerCount(e));
  stopOnExit(proc as unknown as NodeJS.Process);
  assert.deepEqual(counts(), [1, 1, 1, 1, 1], 'the first call listens once for each way a run ends');
  stopOnExit(proc as unknown as NodeJS.Process);
  assert.deepEqual(counts(), [1, 1, 1, 1, 1], 'the second call adds none');
});
