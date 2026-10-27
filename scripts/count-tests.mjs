// This repo's tests ratchet (GH-99): prints how many tests npm test runs, without running them. It loads
// every test file with node:test, as npm test does, but each test it declares is marked skipped, so its
// body never runs and node:test counts it all the same. Its last line is the number, as acc reads it. It
// fails, rather than print a number, when it counts none or a file couldn't load. Its own test pins it to
// node:test's count of a full run.
//
// With no arguments it counts the files npm test runs, by the globs in package.json's test script; given
// globs, it counts those.
import { spawnSync } from 'node:child_process';
import { testGlobs } from './test-globs.ts';

// node:test as each test file sees it: every test declared is skipped, so no body runs, and the hooks
// around them do nothing. describe still runs its body, which only declares the tests in it.
const SHIM = `
import * as real from 'node:test';
export * from 'node:test';
const declare = (args) => {
  const name = args.find((a) => typeof a === 'string');
  const fn = args.find((a) => typeof a === 'function');
  const options = args.find((a) => a && typeof a === 'object') ?? {};
  return [name ?? fn?.name ?? '<anonymous>', { ...options, only: false, todo: false, skip: 'counted, not run' }, () => {}];
};
const counted = (real) => Object.assign((...args) => real(...declare(args)), {
  skip: (...args) => real(...declare(args)), todo: (...args) => real(...declare(args)), only: (...args) => real(...declare(args)),
});
const none = () => {};
export const test = counted(real.test);
export const it = counted(real.it);
export { none as before, none as after, none as beforeEach, none as afterEach };
export default test;
`;
const shim = `data:text/javascript,${encodeURIComponent(SHIM)}`;
// A test file that imports node:test gets the shim. The shim itself, a data: URL, gets the real one.
const HOOKS = `export async function resolve(specifier, context, next) {
  if (specifier === 'node:test' && context.parentURL?.startsWith('file:')) return { url: ${JSON.stringify(shim)}, shortCircuit: true };
  return next(specifier, context);
}`;
const register = `import { register } from 'node:module'; register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(HOOKS)}`)});`;

const root = process.cwd();
const globs = process.argv.slice(2).length ? process.argv.slice(2) : testGlobs(root);
if (!globs.length) {
  console.error('No test files to count: package.json\'s test script names no quoted globs.');
  process.exit(1);
}
const env = { ...process.env };
// Counted on their own, not as part of a test run this one is inside.
delete env.NODE_TEST_CONTEXT;
const r = spawnSync(process.execPath, ['--no-warnings', '--import', `data:text/javascript,${encodeURIComponent(register)}`, '--test', '--test-reporter=tap', ...globs], { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const count = (key) => {
  const m = new RegExp(`^# ${key} (\\d+)$`, 'm').exec(r.stdout ?? '');
  return m ? Number(m[1]) : null;
};
const [tests, fail, cancelled] = [count('tests'), count('fail'), count('cancelled')];
if (tests === null) {
  console.error(`node --test gave no count (exit ${r.status}): ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ')}`);
  process.exit(1);
}
if (fail || cancelled) {
  const failed = [...(r.stdout ?? '').matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  console.error(`${fail + cancelled} couldn't be counted, as a file that didn't load: ${failed.slice(0, 3).join(', ')}`);
  process.exit(1);
}
if (tests === 0) {
  console.error(`Counted no tests in ${globs.join(' ')}.`);
  process.exit(1);
}
console.log(String(tests));
