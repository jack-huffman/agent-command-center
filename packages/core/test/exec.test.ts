import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run } from '../src/exec.ts';
import { fakeBin } from './support.ts';

/** The variables a program was started with, from its own `env`. */
const envOf = (stdout: string): Record<string, string> => Object.fromEntries(stdout.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

test('every gh acc runs gets no update check and no prompt, on top of the env it was given (D-???)', () => {
  const base = { PATH: process.env.PATH, GH_TOKEN: 'gho_token' };
  const got = envOf(run('gh', [], { env: fakeBin('gh', 'env\n', base) }).stdout);
  assert.deepEqual([got.GH_NO_UPDATE_NOTIFIER, got.GH_PROMPT_DISABLED, got.GH_TOKEN], ['1', '1', 'gho_token']);
  const other = envOf(run('sh', ['-c', 'env'], { env: base }).stdout);
  assert.deepEqual([other.GH_NO_UPDATE_NOTIFIER, other.GH_PROMPT_DISABLED], [undefined, undefined], 'only gh');
});

test('a gh that hangs past its timeout is stopped then, even after its work is done (D-???)', () => {
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
