// The tests' compile cache (D-165): scripts/compile-cache.ts names a cache in NODE_COMPILE_CACHE before
// node --test starts, so every test file and every process a test starts reuses what Node compiled before.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { tempDir } from '../../packages/core/test/support.ts';
import { CACHE_DIR } from '../compile-cache.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const PRELOAD = join(ROOT, 'scripts', 'compile-cache.ts');

/** Runs `script` in a node that loaded the preload, with `env` over this one's, and gives what it printed. */
function preloaded(script: string, env: Record<string, string | undefined>): string {
  const base = { ...process.env, ...env };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete base[k];
  const r = spawnSync(process.execPath, ['--no-warnings', '--import', PRELOAD, '-e', script], { env: base, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

test('npm test and the near-tests gate both load the compile cache before node --test', () => {
  const script = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.test as string;
  assert.match(script, /^node --no-warnings --import \.\/scripts\/compile-cache\.ts --test /);
  assert.match(readFileSync(join(ROOT, 'scripts', 'near-tests.mjs'), 'utf8'), /'--import', cache, '--test'/);
});

test('with no cache named, or an empty one, the preload names the machine\'s folder, and a process it starts inherits it', () => {
  // The test files run with a TMPDIR of their own (temp-root.ts), so the folder is the one under that node's
  // temp folder: the preloaded node prints what it named, then what the process it started inherited.
  const child = "process.stdout.write(process.env.NODE_COMPILE_CACHE + '\\n' + require('node:child_process').execFileSync(process.execPath, ['-p', 'process.env.NODE_COMPILE_CACHE'], { encoding: 'utf8' }))";
  for (const named of [undefined, '']) {
    const [own, inherited] = preloaded(child, { NODE_COMPILE_CACHE: named }).split('\n');
    assert.equal(own, join(tmpdir(), basename(CACHE_DIR)), named === '' ? 'an empty name is no name' : 'no name gives the machine\'s folder, under the temp folder the child inherits');
    assert.equal(inherited, own, 'the started process inherits the cache');
  }
});

test('a cache the environment already names is kept, and a started process writes what it compiled there', () => {
  const dir = tempDir('compile-cache-');
  const mod = join(tempDir('compile-cache-src-'), 'm.mjs');
  writeFileSync(mod, 'export const n = 1;\n');
  const script = `process.stdout.write(process.env.NODE_COMPILE_CACHE); require('node:child_process').execFileSync(process.execPath, [${JSON.stringify(mod)}])`;
  assert.equal(preloaded(script, { NODE_COMPILE_CACHE: dir }), dir);
  const written = readdirSync(dir, { recursive: true });
  assert.ok(written.length > 0, 'the cache folder holds what Node compiled');
});
