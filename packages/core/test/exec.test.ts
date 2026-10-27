import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/exec.ts';
import { unpiped } from '../src/start.ts';
import { fakeBin, tempDir } from './support.ts';

/** The variables a program was started with, from its own `env`. */
const envOf = (stdout: string): Record<string, string> => Object.fromEntries(stdout.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

test('every gh acc runs gets no update check and no prompt, on top of the env it was given (D-051)', () => {
  const base = { PATH: process.env.PATH, GH_TOKEN: 'gho_token' };
  const got = envOf(run('gh', [], { env: fakeBin('gh', 'env\n', base) }).stdout);
  assert.deepEqual([got.GH_NO_UPDATE_NOTIFIER, got.GH_PROMPT_DISABLED, got.GH_TOKEN], ['1', '1', 'gho_token']);
  const other = envOf(run('sh', ['-c', 'env'], { env: base }).stdout);
  assert.deepEqual([other.GH_NO_UPDATE_NOTIFIER, other.GH_PROMPT_DISABLED], [undefined, undefined], 'only gh');
});

test('a gh that hangs past its timeout is stopped then, even after its work is done (D-051)', () => {
  const cases = {
    'ignores SIGTERM': "trap '' TERM\necho posted\nsleep 10\n",
    'exits, but a child keeps its output open': 'echo posted\nsleep 10 &\nexit 0\n',
  };
  for (const [name, script] of Object.entries(cases)) {
    const started = Date.now();
    const r = run('gh', ['issue', 'comment', '24'], { env: fakeBin('gh', script), timeoutMs: 500 });
    const took = Date.now() - started;
    assert.ok(took < 5_000, `${name}: stopped at its timeout, not after the 10 s it hangs (took ${took} ms)`);
    assert.deepEqual([r.timedOut, r.code, r.stderr], [true, 127, 'gh didn\'t finish within 0.5 seconds, so acc stopped it.'], name);
  }
  assert.equal(run('gh', [], { env: fakeBin('gh', 'echo fine\n') }).timedOut, undefined, 'a gh that finishes in time isn\'t marked');
});

test('edge case: a gh run asked for lowered priority isn\'t lowered, so its timeout stops gh itself, not a script around it', () => {
  const dir = tempDir('gh-nice-');
  const pidFile = join(dir, 'pid');
  const r = run('gh', ['pr', 'list'], { env: fakeBin('gh', `echo $$ > '${pidFile}'\nexec sleep 10\n`), timeoutMs: 1_000, nice: true });
  assert.equal(r.timedOut, true);
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  assert.ok(pid > 0, 'gh started');
  assert.throws(() => process.kill(pid, 0), /ESRCH/, 'gh was stopped at its timeout, not left running');
});

test('edge case: a program that exits without reading all its input gives its answer, not an EPIPE', () => {
  const r = run(process.execPath, ['-e', 'console.log("answered")'], { input: 'x'.repeat(8 * 1024 * 1024) });
  assert.deepEqual([r.code, r.stdout.trim()], [0, 'answered']);
  const epipe = Object.assign(new Error('spawnSync claude EPIPE'), { code: 'EPIPE' });
  const ran = { pid: 1, output: [], stdout: 'out', stderr: '', status: 0, signal: null, error: epipe };
  assert.deepEqual(unpiped(ran), { pid: 1, output: [], stdout: 'out', stderr: '', status: 0, signal: null });
  const never = { pid: 0, output: [], stdout: '', stderr: '', status: null, signal: null, error: epipe };
  assert.equal(unpiped(never), never, 'a program that never ran keeps its error');
});
