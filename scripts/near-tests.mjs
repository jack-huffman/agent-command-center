// This repo's near-tests gate (GH-73): a builder's lighter check runs only the tests near what it
// changed, as acc gives them in ACC_NEAR_TESTS, one path a line, and the tests of what reads a per-area
// file it changed in ACC_CHANGED, as scripts/near-reads.ts lists them (GH-117). The full check, npm run
// check, runs once, in the merge queue. Tests that read the build (the extension's, the packaging's, the
// launcher's and acc's junk test, GH-106) get one first. With none near the change, there's nothing to run.
// acc gives every command gate ACC_NEAR_TESTS (GH-117); run without it, as by hand, this fails rather than
// pass having run nothing.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { nearReaders } from './near-reads.ts';

if (process.env.ACC_NEAR_TESTS === undefined) {
  console.error('ACC_NEAR_TESTS isn\'t set. Run this through acc gate run, which sets it.');
  process.exit(1);
}
const lines = (text) => text.split('\n').map((t) => t.trim()).filter(Boolean);
const tracked = () => execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const read = (f) => {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return null;
  }
};
const tests = [...new Set([...lines(process.env.ACC_NEAR_TESTS), ...nearReaders(lines(process.env.ACC_CHANGED ?? ''), tracked, read)])].sort();
if (!tests.length) {
  console.log('No tests near the change.');
  process.exit(0);
}
console.log(`Tests near the change: ${tests.join(', ')}`);
if (tests.some((t) => /^(extension\/test|scripts\/test)\//.test(t) || t === 'packages/cli/test/launcher.test.ts' || t === 'packages/cli/test/junk.test.ts')) {
  const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
// The same compile cache as npm test's (D-165), so each acc these tests start compiles nothing it compiled before.
const cache = new URL('./compile-cache.ts', import.meta.url).href;
const r = spawnSync(process.execPath, ['--no-warnings', '--import', cache, '--test', '--test-timeout=300000', '--test-reporter=spec', ...tests], { stdio: 'inherit' });
process.exit(r.status ?? 1);
