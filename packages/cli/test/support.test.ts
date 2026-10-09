// What the CLI's tests share (support.ts) holds for every one of them (GH-148): each runs acc from its source
// through cli(), which builds acc's environment, so no file spawns node on acc with an environment of its own
// making that might miss a variable and reach this machine's own files.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tempDir } from '../../core/test/support.ts';
import { cli, HEAVY_DIR, MACHINE_FILE, REPOS_FILE } from './support.ts';

const HERE = import.meta.dirname;
const MAIN_THROUGH_CLI = 'cli(fileURLToPath(new URL(\'../src/main.ts\', import.meta.url)))';

/** The test files that don't run acc's main.ts, and what each runs instead, which pins how far it reaches. */
const OWN_WAY: Record<string, { why: string; runs: string }> = {
  'junk.test.ts': { why: 'runs the built acc, as people do, in a sandbox whose whole environment it makes up (GH-106)', runs: '\'../../../dist/acc.mjs\'' },
  'launcher.test.ts': { why: 'runs the launcher script, a copy of it with a stand-in acc.mjs, with only the environment given (D-077)', runs: '\'../bin/acc\'' },
};

test('every CLI test runs acc\'s main.ts through cli() in support.ts, and none spawns it with an environment of its own (GH-148)', () => {
  const files = readdirSync(HERE).filter((f) => f.endsWith('.test.ts') && f !== 'support.test.ts');
  assert.ok(files.length >= 12, `${files.length} CLI test files`);
  let throughCli = 0;
  for (const f of files) {
    const text = readFileSync(join(HERE, f), 'utf8');
    const own = OWN_WAY[f];
    if (own) {
      assert.ok(text.includes(own.runs), `${f} ${own.why}`);
      assert.ok(!text.includes(MAIN_THROUGH_CLI), `${f} runs no main.ts`);
      continue;
    }
    // node run any way: spawn or execFile, sync or not, by process.execPath or by name.
    assert.doesNotMatch(text, /\b(?:spawn|spawnSync|execFile|execFileSync)\(\s*(?:process\.execPath\b|['"`]node['"`])/, `${f} spawns node itself: run acc through cli() in support.ts, with spawn options if it needs them`);
    assert.ok(text.includes(MAIN_THROUGH_CLI), `${f} runs main.ts through cli()`);
    throughCli++;
  }
  assert.equal(throughCli, files.length - Object.keys(OWN_WAY).length);
  for (const f of Object.keys(OWN_WAY)) assert.ok(files.includes(f), `${f} is still a test here; take it off the list if it's gone`);
});

test('cli() gives acc the tests\' own machine files, what a call adds over them, and its spawn options, such as a timeout (GH-148)', () => {
  // A stand-in for main.ts that prints the environment acc would get, or waits a minute.
  const main = join(tempDir('acc-cli-'), 'main.mjs');
  const keys = ['ACC_HEAVY_DIR', 'ACC_REPOS_FILE', 'ACC_MACHINE_FILE', 'ACC_ROLE', 'ACC_TASK', 'NO_COLOR', 'ACC_EXTRA'];
  writeFileSync(main, `if (process.argv[2] === 'wait') setTimeout(() => {}, 60_000);
else process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map((k) => [k, process.env[k]]))));\n`);
  const acc = cli(main);
  const r = acc(HERE, ['env'], undefined, { ACC_EXTRA: 'added' });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json(), { ACC_HEAVY_DIR: HEAVY_DIR, ACC_REPOS_FILE: REPOS_FILE, ACC_MACHINE_FILE: MACHINE_FILE, ACC_ROLE: '', ACC_TASK: '', NO_COLOR: '1', ACC_EXTRA: 'added' });
  const started = Date.now();
  const slow = acc(HERE, ['wait'], undefined, {}, { timeout: 300 });
  assert.notEqual(slow.code, 0, 'stopped by its timeout');
  assert.ok(Date.now() - started < 10_000, `stopped ${Date.now() - started} ms after it started, at the timeout, not a minute later`);
});
