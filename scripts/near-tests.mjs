// This repo's near-tests gate (GH-73): a builder's lighter check runs only the tests near what it
// changed, as acc gives them in ACC_NEAR_TESTS, one path a line. The full check, npm run check, runs once,
// in the merge queue. Tests that read the build (the extension's, the packaging's and the launcher's) get
// one first. With none near the change, there's nothing to run.
import { spawnSync } from 'node:child_process';

const tests = (process.env.ACC_NEAR_TESTS ?? '').split('\n').map((t) => t.trim()).filter(Boolean);
if (!tests.length) {
  console.log('No tests near the change.');
  process.exit(0);
}
console.log(`Tests near the change: ${tests.join(', ')}`);
if (tests.some((t) => /^(extension\/test|scripts\/test)\//.test(t) || t === 'packages/cli/test/launcher.test.ts')) {
  const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const r = spawnSync(process.execPath, ['--no-warnings', '--test', '--test-timeout=300000', '--test-reporter=spec', ...tests], { stdio: 'inherit' });
process.exit(r.status ?? 1);
